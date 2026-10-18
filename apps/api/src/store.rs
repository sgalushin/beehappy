use crate::{
    error::{storage, ApiError, ApiResult},
    model::{GradeRequest, ReviewEvent, Word},
};
use aws_sdk_dynamodb::{
    types::{AttributeValue, Delete, Put, TransactWriteItem},
    Client,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;

type Item = HashMap<String, AttributeValue>;
#[derive(Clone)]
pub struct Store {
    client: Client,
    table: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct WordRecord {
    pub pk: String,
    pub sk: String,
    pub version: u64,
    pub deleted: bool,
    pub word: Word,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameRecord {
    pub pk: String,
    pub sk: String,
    pub word_id: String,
}
#[derive(Serialize, Deserialize)]
pub struct EventRecord {
    pub pk: String,
    pub sk: String,
    pub request: GradeRequest,
    pub event: ReviewEvent,
}
pub fn partition(user: &str) -> String {
    format!("USER#{user}")
}
pub fn word_key(id: &str) -> String {
    format!("WORD#{id}")
}
pub fn event_prefix(id: &str) -> String {
    format!("EVENT#{id}#")
}
pub fn event_key(id: &str, event_id: &str) -> String {
    format!("{}{event_id}", event_prefix(id))
}

impl Store {
    pub fn new(client: Client, table: String) -> Self {
        Self { client, table }
    }
    pub async fn get<T: DeserializeOwned>(&self, pk: &str, sk: &str) -> ApiResult<Option<T>> {
        let result = self
            .client
            .get_item()
            .table_name(&self.table)
            .key("pk", AttributeValue::S(pk.into()))
            .key("sk", AttributeValue::S(sk.into()))
            .consistent_read(true)
            .send()
            .await
            .map_err(storage)?;
        result
            .item
            .map(serde_dynamo::aws_sdk_dynamodb_1::from_item)
            .transpose()
            .map_err(storage)
    }
    pub async fn query<T: DeserializeOwned>(&self, pk: &str, prefix: &str) -> ApiResult<Vec<T>> {
        let mut result = Vec::new();
        let mut start = None;
        loop {
            let output = self
                .client
                .query()
                .table_name(&self.table)
                .key_condition_expression("pk = :pk AND begins_with(sk, :sk)")
                .expression_attribute_values(":pk", AttributeValue::S(pk.into()))
                .expression_attribute_values(":sk", AttributeValue::S(prefix.into()))
                .consistent_read(true)
                .set_exclusive_start_key(start.take())
                .send()
                .await
                .map_err(storage)?;
            for item in output.items.unwrap_or_default() {
                result.push(serde_dynamo::aws_sdk_dynamodb_1::from_item(item).map_err(storage)?);
            }
            match output.last_evaluated_key {
                Some(key) if !key.is_empty() => start = Some(key),
                _ => break,
            }
        }
        Ok(result)
    }
    pub fn put<T: Serialize>(
        &self,
        value: &T,
        version: Option<u64>,
        absent: bool,
    ) -> ApiResult<TransactWriteItem> {
        let item: Item = serde_dynamo::aws_sdk_dynamodb_1::to_item(value).map_err(storage)?;
        let mut put = Put::builder().table_name(&self.table).set_item(Some(item));
        if absent {
            put = put.condition_expression("attribute_not_exists(pk)");
        }
        if let Some(version) = version {
            put = put
                .condition_expression("#version = :version AND #deleted = :false")
                .expression_attribute_names("#version", "version")
                .expression_attribute_names("#deleted", "deleted")
                .expression_attribute_values(":version", AttributeValue::N(version.to_string()))
                .expression_attribute_values(":false", AttributeValue::Bool(false));
        }
        Ok(TransactWriteItem::builder()
            .put(put.build().map_err(storage)?)
            .build())
    }
    pub fn delete(&self, pk: &str, sk: &str) -> ApiResult<TransactWriteItem> {
        Ok(TransactWriteItem::builder()
            .delete(
                Delete::builder()
                    .table_name(&self.table)
                    .key("pk", AttributeValue::S(pk.into()))
                    .key("sk", AttributeValue::S(sk.into()))
                    .build()
                    .map_err(storage)?,
            )
            .build())
    }
    pub async fn transact(&self, writes: Vec<TransactWriteItem>) -> ApiResult<bool> {
        match self
            .client
            .transact_write_items()
            .set_transact_items(Some(writes))
            .send()
            .await
        {
            Ok(_) => Ok(true),
            Err(error) => {
                if let Some(aws_sdk_dynamodb::operation::transact_write_items::TransactWriteItemsError::TransactionCanceledException(cancelled)) = error.as_service_error() {
                    if cancelled.cancellation_reasons().iter().any(|reason| matches!(reason.code(), Some("ConditionalCheckFailed" | "TransactionConflict"))) { return Ok(false); }
                }
                Err(storage(error))
            }
        }
    }
    pub async fn words(&self, user: &str) -> ApiResult<Vec<Word>> {
        let records: Vec<WordRecord> = self.query(&partition(user), "WORD#").await?;
        let mut words: Vec<_> = records
            .into_iter()
            .filter(|record| !record.deleted)
            .map(|record| record.word)
            .collect();
        words.sort_by_cached_key(|word| crate::validation::identity(&word.text));
        Ok(words)
    }
    pub async fn word_record(&self, user: &str, id: &str) -> ApiResult<WordRecord> {
        self.get(&partition(user), &word_key(id))
            .await?
            .ok_or_else(ApiError::missing)
    }
    pub async fn word(&self, user: &str, id: &str) -> ApiResult<Word> {
        let record = self.word_record(user, id).await?;
        if record.deleted {
            return Err(ApiError::missing());
        }
        Ok(record.word)
    }
    pub async fn remove(&self, user: &str, id: &str) -> ApiResult<()> {
        // The conditional tombstone linearizes deletion before history cleanup. A grade
        // cannot resurrect a removed word, even if it read the word before this write.
        let mut record = self.word_record(user, id).await?;
        if !record.deleted {
            let expected = record.version;
            record.version = expected
                .checked_add(1)
                .ok_or_else(|| ApiError::unavailable("Version overflow."))?;
            record.deleted = true;
            if !self
                .transact(vec![
                    self.put(&record, Some(expected), false)?,
                    self.delete(&record.pk, &crate::validation::name_key(&record.word.text))?,
                ])
                .await?
            {
                return Err(ApiError::conflict(
                    "Word changed while deleting. Reload and retry.",
                ));
            }
        }
        let events: Vec<EventRecord> = self.query(&record.pk, &event_prefix(id)).await?;
        for chunk in events.chunks(100) {
            let writes = chunk
                .iter()
                .map(|event| self.delete(&record.pk, &event.sk))
                .collect::<ApiResult<Vec<_>>>()?;
            if !self.transact(writes).await? {
                return Err(ApiError::conflict(
                    "History cleanup conflicted; retry deletion.",
                ));
            }
        }
        if !self
            .transact(vec![self.delete(&record.pk, &record.sk)?])
            .await?
        {
            return Err(ApiError::conflict("Deletion conflicted; retry."));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "Requires the isolated local DynamoDB table on port 4586"]
    async fn real_transactions_keep_event_and_card_atomic_and_never_resurrect_deleted_words() {
        use crate::model::{CardState, Meaning, Mode, Rating};
        let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(aws_sdk_dynamodb::config::Region::new("us-east-2"))
            .credentials_provider(aws_sdk_dynamodb::config::Credentials::new(
                "test", "test", None, None, "test",
            ))
            .endpoint_url("http://127.0.0.1:4586")
            .load()
            .await;
        let store = Store::new(Client::new(&shared), "beehappy-local".into());
        let user = format!("test-{}", uuid::Uuid::new_v4());
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let original = WordRecord {
            pk: partition(&user),
            sk: word_key(&id),
            version: 0,
            deleted: false,
            word: Word {
                id: id.clone(),
                text: "transaction regression".into(),
                meanings: vec![Meaning {
                    part_of_speech: "noun".into(),
                    definition: "An atomicity regression.".into(),
                }],
                sentences: vec![],
                card: CardState::new(now),
                created_at: now,
                updated_at: now,
            },
        };
        assert!(store
            .transact(vec![store.put(&original, None, true).unwrap()])
            .await
            .unwrap());
        let mut graded = original.clone();
        graded.word.card = crate::schedule::grade(&original.word.card, Rating::Good, now).unwrap();
        graded.version = graded.word.card.version;
        let request = GradeRequest {
            event_id: "first".into(),
            mode: Mode::Word,
            rating: Rating::Good,
            version: 0,
        };
        let event = EventRecord {
            pk: original.pk.clone(),
            sk: event_key(&id, "first"),
            request: request.clone(),
            event: ReviewEvent {
                id: "first".into(),
                word_id: id.clone(),
                mode: Mode::Word,
                rating: Rating::Good,
                reviewed_at: now,
                interval: graded.word.card.due - now,
            },
        };
        assert!(store
            .transact(vec![
                store.put(&graded, Some(0), false).unwrap(),
                store.put(&event, None, true).unwrap()
            ])
            .await
            .unwrap());
        assert!(!store
            .transact(vec![
                store.put(&graded, Some(0), false).unwrap(),
                store.put(&event, None, true).unwrap()
            ])
            .await
            .unwrap());
        let stale_event = EventRecord {
            pk: original.pk.clone(),
            sk: event_key(&id, "stale"),
            request: GradeRequest {
                event_id: "stale".into(),
                ..request.clone()
            },
            event: ReviewEvent {
                id: "stale".into(),
                ..event.event.clone()
            },
        };
        assert!(!store
            .transact(vec![
                store.put(&graded, Some(0), false).unwrap(),
                store.put(&stale_event, None, true).unwrap()
            ])
            .await
            .unwrap());
        assert!(store
            .get::<EventRecord>(&original.pk, &stale_event.sk)
            .await
            .unwrap()
            .is_none());
        assert_eq!(store.word(&user, &id).await.unwrap().card.reps, 1);
        let mut edited = graded.clone();
        edited.version += 1;
        edited.word.card.version = edited.version;
        edited.word.text = "edited transaction regression".into();
        assert!(store
            .transact(vec![store
                .put(&edited, Some(graded.version), false)
                .unwrap()])
            .await
            .unwrap());
        let state = crate::AppState {
            store: store.clone(),
            http: reqwest::Client::new(),
            provider_key: None,
            production: false,
            dev_user: user.clone(),
        };
        let result = crate::routes::grade(
            axum::extract::State(state),
            crate::auth::User(user.clone()),
            axum::extract::Path(id.clone()),
            Ok(axum::Json(request)),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(result.status, "duplicate");
        assert_eq!(result.word.card.version, edited.version);
        assert_eq!(result.word.text, "edited transaction regression");
        store.remove(&user, &id).await.unwrap();
        assert!(!store
            .transact(vec![
                store.put(&graded, Some(edited.version), false).unwrap(),
                store.put(&stale_event, None, true).unwrap()
            ])
            .await
            .unwrap());
        assert!(store
            .get::<WordRecord>(&original.pk, &original.sk)
            .await
            .unwrap()
            .is_none());
        assert!(store
            .query::<EventRecord>(&original.pk, &event_prefix(&id))
            .await
            .unwrap()
            .is_empty());
    }
    #[test]
    fn tenant_and_event_keys_never_cross_user_or_word_boundaries() {
        assert_ne!(partition("alice"), partition("bob"));
        assert_ne!(event_key("a", "bc"), event_key("ab", "c"));
        assert!(event_key("a", "retry-1").starts_with(&event_prefix("a")));
        assert!(!event_key("ab", "retry-1").starts_with(&event_prefix("a")));
    }
}
