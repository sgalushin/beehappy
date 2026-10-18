use crate::{
    auth::User,
    error::{ApiError, ApiResult},
    model::*,
    store::{partition, EventRecord},
    AppState,
};
use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{Days, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsQuery {
    time_zone: String,
}
pub async fn stats(
    State(state): State<AppState>,
    User(user): User,
    Query(query): Query<StatsQuery>,
) -> ApiResult<Json<Stats>> {
    let zone: Tz = query
        .time_zone
        .parse()
        .map_err(|_| ApiError::bad("timeZone must be a valid IANA time zone."))?;
    let words = state.store.words(&user).await?;
    let records: Vec<EventRecord> = state.store.query(&partition(&user), "EVENT#").await?;
    let events = records
        .into_iter()
        .map(|record| record.event)
        .collect::<Vec<_>>();
    Ok(Json(calculate(
        &words,
        &events,
        zone,
        Utc::now().timestamp_millis(),
    )?))
}
fn date(timestamp: i64, zone: Tz) -> Option<NaiveDate> {
    zone.timestamp_millis_opt(timestamp)
        .single()
        .map(|time| time.date_naive())
}
fn calculate(words: &[Word], events: &[ReviewEvent], zone: Tz, now: i64) -> ApiResult<Stats> {
    let today = date(now, zone).ok_or_else(|| ApiError::bad("Invalid current date."))?;
    let live: HashSet<_> = words.iter().map(|word| word.id.as_str()).collect();
    let mut activity: HashMap<NaiveDate, (usize, usize, HashSet<&str>)> = HashMap::new();
    let mut modes = vec![
        ModeStats {
            mode: Mode::Word,
            reviews: 0,
            correct: 0,
        },
        ModeStats {
            mode: Mode::Context,
            reviews: 0,
            correct: 0,
        },
    ];
    let mut reviews = 0;
    let mut correct = 0;
    for event in events {
        if event.reviewed_at > now || !live.contains(event.word_id.as_str()) {
            continue;
        }
        let Some(day) = date(event.reviewed_at, zone) else {
            continue;
        };
        let entry = activity.entry(day).or_default();
        entry.0 += 1;
        entry.1 += usize::from(event.rating == Rating::Good);
        entry.2.insert(&event.word_id);
        reviews += 1;
        correct += usize::from(event.rating == Rating::Good);
        let mode = &mut modes[usize::from(event.mode == Mode::Context)];
        mode.reviews += 1;
        mode.correct += usize::from(event.rating == Rating::Good);
    }
    let mut days = Vec::with_capacity(30);
    for offset in (0..30).rev() {
        let day = today
            .checked_sub_days(Days::new(offset))
            .ok_or_else(|| ApiError::bad("Date out of range."))?;
        let (reviews, correct, count) = activity
            .get(&day)
            .map_or((0, 0, 0), |entry| (entry.0, entry.1, entry.2.len()));
        days.push(ActivityDay {
            date: day.to_string(),
            reviews,
            correct,
            words: count,
        });
    }
    let mut upcoming = Vec::with_capacity(7);
    for offset in 0..7 {
        let day = today
            .checked_add_days(Days::new(offset))
            .ok_or_else(|| ApiError::bad("Date out of range."))?;
        let count = words
            .iter()
            .filter(|word| {
                date(word.card.due, zone)
                    .is_some_and(|due| due == day || (offset == 0 && due < today))
            })
            .count();
        upcoming.push(UpcomingDay {
            date: day.to_string(),
            words: count,
        });
    }
    let mut streak = 0;
    let mut cursor = if activity.contains_key(&today) {
        Some(today)
    } else {
        today.pred_opt()
    };
    while let Some(day) = cursor {
        if !activity.contains_key(&day) {
            break;
        }
        streak += 1;
        cursor = day.pred_opt();
    }
    Ok(Stats {
        total_words: words.len(),
        new_words: words
            .iter()
            .filter(|word| word.card.phase == Phase::New)
            .count(),
        learning_words: words
            .iter()
            .filter(|word| word.card.phase == Phase::Learning)
            .count(),
        review_words: words
            .iter()
            .filter(|word| word.card.phase == Phase::Review)
            .count(),
        relearning_words: words
            .iter()
            .filter(|word| word.card.phase == Phase::Relearning)
            .count(),
        due_words: words.iter().filter(|word| word.card.due <= now).count(),
        reviews,
        correct_reviews: correct,
        accuracy: (reviews > 0).then(|| correct as f64 / reviews as f64),
        streak,
        days,
        upcoming,
        modes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_dates_streak_future_filter_and_deletion_remain_consistent() {
        let now = Utc
            .with_ymd_and_hms(2026, 3, 9, 5, 30, 0)
            .unwrap()
            .timestamp_millis();
        let word = Word {
            id: "a".into(),
            text: "word".into(),
            meanings: vec![],
            sentences: vec![],
            card: CardState::new(now),
            created_at: now,
            updated_at: now,
        };
        let make = |id: &str, at: i64, rating| ReviewEvent {
            id: id.into(),
            word_id: "a".into(),
            mode: Mode::Word,
            rating,
            reviewed_at: at,
            interval: 60000,
        };
        let events = vec![
            make("1", now - 86_400_000, Rating::Good),
            make("2", now - 1000, Rating::Again),
            make("future", now + 1, Rating::Good),
        ];
        let stats = calculate(&[word], &events, chrono_tz::America::New_York, now).unwrap();
        assert_eq!(
            (stats.reviews, stats.correct_reviews, stats.streak),
            (2, 1, 2)
        );
        assert_eq!(stats.accuracy, Some(0.5));
        assert_eq!(stats.days.len(), 30);
        assert_eq!(stats.upcoming.len(), 7);
        assert_eq!(stats.days.last().unwrap().date, "2026-03-09");
        let empty = calculate(&[], &events, chrono_tz::America::New_York, now).unwrap();
        assert_eq!((empty.reviews, empty.streak, empty.accuracy), (0, 0, None));
    }
}
