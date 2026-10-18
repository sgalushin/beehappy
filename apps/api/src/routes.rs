use crate::{
    auth::User,
    error::{ApiError, ApiResult},
    model::*,
    schedule,
    store::{event_key, event_prefix, partition, word_key, EventRecord, NameRecord, WordRecord},
    validation, AppState,
};
use axum::{
    extract::{rejection::JsonRejection, Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

pub fn body<T>(value: Result<Json<T>, JsonRejection>) -> ApiResult<T> {
    value.map(|Json(value)| value).map_err(|error| {
        ApiError(
            error.status(),
            match error.status() {
                StatusCode::PAYLOAD_TOO_LARGE => "Request exceeds the 512 KiB body limit.".into(),
                _ => format!("Invalid JSON request: {}", error.body_text()),
            },
        )
    })
}
pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}
pub async fn words(State(state): State<AppState>, User(user): User) -> ApiResult<Json<Vec<Word>>> {
    Ok(Json(state.store.words(&user).await?))
}
pub async fn detail(
    State(state): State<AppState>,
    User(user): User,
    Path(id): Path<String>,
) -> ApiResult<Json<WordDetail>> {
    validation::identifier(&id)?;
    let word = state.store.word(&user, &id).await?;
    let records: Vec<EventRecord> = state
        .store
        .query(&partition(&user), &event_prefix(&id))
        .await?;
    let mut history: Vec<_> = records.into_iter().map(|record| record.event).collect();
    history.sort_by(|a, b| {
        b.reviewed_at
            .cmp(&a.reviewed_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    let recall_probability = schedule::recall(&word.card, chrono::Utc::now().timestamp_millis());
    Ok(Json(WordDetail {
        word,
        history,
        recall_probability,
    }))
}
pub async fn create(
    State(state): State<AppState>,
    User(user): User,
    input: Result<Json<SaveWordRequest>, JsonRejection>,
) -> ApiResult<(StatusCode, Json<Word>)> {
    let input = body(input)?;
    validation::save(&input)?;
    if input.version.is_some() {
        return Err(ApiError::bad("A new word must not include a version."));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let id = Uuid::new_v4().to_string();
    let word = Word {
        id: id.clone(),
        text: input.text,
        meanings: input.meanings,
        sentences: input
            .sentences
            .into_iter()
            .map(|input| Sentence {
                id: Uuid::new_v4().to_string(),
                input,
            })
            .collect(),
        card: CardState::new(now),
        created_at: now,
        updated_at: now,
    };
    let record = WordRecord {
        pk: partition(&user),
        sk: word_key(&id),
        version: 0,
        deleted: false,
        word: word.clone(),
    };
    let name = NameRecord {
        pk: record.pk.clone(),
        sk: validation::name_key(&word.text),
        word_id: id,
    };
    if !state
        .store
        .transact(vec![
            state.store.put(&record, None, true)?,
            state.store.put(&name, None, true)?,
        ])
        .await?
    {
        return Err(ApiError::conflict(
            "This word or phrase already exists. Add meanings to the existing entry.",
        ));
    }
    Ok((StatusCode::CREATED, Json(word)))
}
pub async fn update(
    State(state): State<AppState>,
    User(user): User,
    Path(id): Path<String>,
    input: Result<Json<SaveWordRequest>, JsonRejection>,
) -> ApiResult<Json<Word>> {
    validation::identifier(&id)?;
    let input = body(input)?;
    validation::save(&input)?;
    let version = input
        .version
        .ok_or_else(|| ApiError::bad("Editing requires the current card version."))?;
    let mut record = state.store.word_record(&user, &id).await?;
    if record.deleted {
        return Err(ApiError::missing());
    }
    if record.version != version {
        return Err(ApiError::conflict("Word changed. Reload before editing."));
    }
    let old_name = validation::name_key(&record.word.text);
    let new_name = validation::name_key(&input.text);
    // Reuse identifiers for exact unchanged sentences, including repeated occurrences.
    let mut old_sentences = std::mem::take(&mut record.word.sentences);
    let mut sentences = Vec::with_capacity(input.sentences.len());
    for input in input.sentences {
        let existing = old_sentences.iter().position(|sentence| {
            sentence.input.text == input.text
                && sentence.input.target_start == input.target_start
                && sentence.input.target_end == input.target_end
                && sentence.input.source == input.source
                && std::mem::discriminant(&sentence.input.origin)
                    == std::mem::discriminant(&input.origin)
        });
        let id = existing
            .map(|index| old_sentences.swap_remove(index).id)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        sentences.push(Sentence { id, input });
    }
    record.word.text = input.text;
    record.word.meanings = input.meanings;
    record.word.sentences = sentences;
    record.version = version
        .checked_add(1)
        .ok_or_else(|| ApiError::unavailable("Version overflow."))?;
    record.word.card.version = record.version;
    record.word.updated_at = chrono::Utc::now().timestamp_millis();
    let mut writes = vec![state.store.put(&record, Some(version), false)?];
    if old_name != new_name {
        writes.push(state.store.delete(&record.pk, &old_name)?);
        writes.push(state.store.put(
            &NameRecord {
                pk: record.pk.clone(),
                sk: new_name,
                word_id: id,
            },
            None,
            true,
        )?);
    }
    if !state.store.transact(writes).await? {
        return Err(ApiError::conflict(
            "Word changed or the new name already exists. Reload and retry.",
        ));
    }
    Ok(Json(record.word))
}
pub async fn remove(
    State(state): State<AppState>,
    User(user): User,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    validation::identifier(&id)?;
    state.store.remove(&user, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct ReviewQuery {
    mode: Mode,
    limit: Option<usize>,
}
pub async fn review(
    State(state): State<AppState>,
    User(user): User,
    Query(query): Query<ReviewQuery>,
) -> ApiResult<Json<ReviewSession>> {
    let limit = query.limit.unwrap_or(20);
    if !(1..=100).contains(&limit) {
        return Err(ApiError::bad("Review limit must be between 1 and 100."));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let mut words: Vec<_> = state
        .store
        .words(&user)
        .await?
        .into_iter()
        .filter(|word| {
            word.card.due <= now && (query.mode == Mode::Word || !word.sentences.is_empty())
        })
        .collect();
    words.sort_by(|a, b| {
        a.card
            .due
            .cmp(&b.card.due)
            .then_with(|| a.created_at.cmp(&b.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    let due = words.len();
    words.truncate(limit);
    Ok(Json(ReviewSession { words, due }))
}
pub fn duplicate(existing: &GradeRequest, request: &GradeRequest) -> ApiResult<()> {
    if existing != request {
        return Err(ApiError::conflict(
            "This eventId was already used with a different grade payload.",
        ));
    }
    Ok(())
}
pub async fn grade(
    State(state): State<AppState>,
    User(user): User,
    Path(id): Path<String>,
    request: Result<Json<GradeRequest>, JsonRejection>,
) -> ApiResult<Json<GradeResult>> {
    validation::identifier(&id)?;
    let request = body(request)?;
    validation::identifier(&request.event_id)?;
    let pk = partition(&user);
    let sk = event_key(&id, &request.event_id);
    if let Some(existing) = state.store.get::<EventRecord>(&pk, &sk).await? {
        duplicate(&existing.request, &request)?;
        return Ok(Json(GradeResult {
            status: "duplicate",
            word: state.store.word(&user, &id).await?,
        }));
    }
    let mut record = state.store.word_record(&user, &id).await?;
    if record.deleted {
        return Err(ApiError::missing());
    }
    if record.version != request.version {
        return Err(ApiError::conflict(
            "Card changed. Reload this review before grading.",
        ));
    }
    if request.mode == Mode::Context && record.word.sentences.is_empty() {
        return Err(ApiError::bad("Context reviews require a sentence."));
    }
    let now = chrono::Utc::now().timestamp_millis();
    if record.word.card.due > now {
        return Err(ApiError::conflict(
            "This card is not due yet. Reload the review queue.",
        ));
    }
    record.word.card = schedule::grade(&record.word.card, request.rating, now)?;
    record.version = record.word.card.version;
    record.word.updated_at = now;
    let event = EventRecord {
        pk,
        sk,
        request: request.clone(),
        event: ReviewEvent {
            id: request.event_id.clone(),
            word_id: id.clone(),
            mode: request.mode,
            rating: request.rating,
            reviewed_at: now,
            interval: record.word.card.due - now,
        },
    };
    if state
        .store
        .transact(vec![
            state.store.put(&record, Some(request.version), false)?,
            state.store.put(&event, None, true)?,
        ])
        .await?
    {
        return Ok(Json(GradeResult {
            status: "applied",
            word: record.word,
        }));
    }
    if let Some(existing) = state.store.get::<EventRecord>(&event.pk, &event.sk).await? {
        duplicate(&existing.request, &request)?;
        return Ok(Json(GradeResult {
            status: "duplicate",
            word: state.store.word(&user, &id).await?,
        }));
    }
    Err(ApiError::conflict(
        "Card changed while grading. Reload the review queue.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn event_retries_must_match_every_payload_field() {
        let original = GradeRequest {
            event_id: "one".into(),
            mode: Mode::Word,
            rating: Rating::Good,
            version: 4,
        };
        assert!(duplicate(&original, &original).is_ok());
        let mut changed = original.clone();
        changed.mode = Mode::Context;
        assert!(duplicate(&original, &changed).is_err());
        changed = original.clone();
        changed.version = 5;
        assert!(duplicate(&original, &changed).is_err());
        changed = original.clone();
        changed.rating = Rating::Again;
        assert!(duplicate(&original, &changed).is_err());
    }
}
