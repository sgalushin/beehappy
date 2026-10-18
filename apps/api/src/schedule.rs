use crate::{
    error::{ApiError, ApiResult},
    model::{CardState, Phase, Rating},
};
use fsrs::{current_retrievability, MemoryState, DEFAULT_PARAMETERS, FSRS};
pub const DAY: i64 = 86_400_000;
const MINUTE: i64 = 60_000;

pub fn grade(card: &CardState, rating: Rating, now: i64) -> ApiResult<CardState> {
    if now < 0 || card.last_review.is_some_and(|last| now < last) {
        return Err(ApiError::bad("Review timestamps must be chronological."));
    }
    if card.phase == Phase::Learning && card.step > 2 {
        return Err(ApiError::unavailable("Stored learning step is invalid."));
    }
    let memory = if card.stability > 0.0
        && card.stability.is_finite()
        && card.difficulty.is_finite()
        && (1.0..=10.0).contains(&card.difficulty)
    {
        Some(MemoryState {
            stability: card.stability,
            difficulty: card.difficulty,
        })
    } else if card.phase == Phase::New && card.reps == 0 {
        None
    } else {
        return Err(ApiError::unavailable("Stored FSRS memory is invalid."));
    };
    let elapsed = card
        .last_review
        .map_or(0, |last| ((now - last) / DAY).min(u32::MAX as i64) as u32);
    thread_local! { static MODEL: Result<FSRS, fsrs::FSRSError> = FSRS::new(&DEFAULT_PARAMETERS); }
    let forecast = MODEL.with(|model| {
        let model = model
            .as_ref()
            .map_err(|_| ApiError::unavailable("FSRS could not initialize."))?;
        model.next_states(memory, 0.9, elapsed).map_err(|error| {
            tracing::error!(?error, "FSRS forecast failed");
            ApiError::unavailable("FSRS scheduling is unavailable.")
        })
    })?;
    let item = match rating {
        Rating::Again => forecast.again,
        Rating::Good => forecast.good,
    };
    if !item.interval.is_finite()
        || item.interval <= 0.0
        || !item.memory.stability.is_finite()
        || !item.memory.difficulty.is_finite()
    {
        return Err(ApiError::unavailable("FSRS returned invalid memory."));
    }
    let interval = (f64::from(item.interval.clamp(1.0, 36_500.0)) * DAY as f64) as i64;
    let (phase, step, delay) = match (card.phase, rating) {
        (Phase::New | Phase::Learning, Rating::Again) => (Phase::Learning, 0, MINUTE),
        (Phase::New, Rating::Good) => (Phase::Learning, 1, MINUTE),
        (Phase::Learning, Rating::Good) => match card.step {
            0 => (Phase::Learning, 1, MINUTE),
            1 => (Phase::Learning, 2, 10 * MINUTE),
            _ => (Phase::Review, 0, interval),
        },
        (Phase::Review | Phase::Relearning, Rating::Again) => (Phase::Relearning, 0, 10 * MINUTE),
        (Phase::Review | Phase::Relearning, Rating::Good) => (Phase::Review, 0, interval),
    };
    Ok(CardState {
        phase,
        step,
        due: now
            .checked_add(delay)
            .ok_or_else(|| ApiError::unavailable("Schedule overflow."))?,
        last_review: Some(now),
        stability: item.memory.stability,
        difficulty: item.memory.difficulty,
        reps: card
            .reps
            .checked_add(1)
            .ok_or_else(|| ApiError::unavailable("Review count overflow."))?,
        lapses: card
            .lapses
            .checked_add(u64::from(
                card.phase == Phase::Review && rating == Rating::Again,
            ))
            .ok_or_else(|| ApiError::unavailable("Lapse count overflow."))?,
        version: card
            .version
            .checked_add(1)
            .ok_or_else(|| ApiError::unavailable("Version overflow."))?,
    })
}
pub fn recall(card: &CardState, now: i64) -> Option<f64> {
    let last = card.last_review?;
    if card.stability <= 0.0 || !card.stability.is_finite() || now < last {
        return None;
    }
    let probability = current_retrievability(
        MemoryState {
            stability: card.stability,
            difficulty: card.difficulty,
        },
        (now - last) as f32 / DAY as f32,
        DEFAULT_PARAMETERS[20],
    );
    probability
        .is_finite()
        .then_some(f64::from(probability.clamp(0.0, 1.0)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn learning_and_relearning_share_one_memory_and_count_single_lapse() {
        let mut card = CardState::new(0);
        card = grade(&card, Rating::Good, 0).unwrap();
        assert_eq!(
            (card.phase, card.step, card.due),
            (Phase::Learning, 1, MINUTE)
        );
        card = grade(&card, Rating::Good, MINUTE).unwrap();
        assert_eq!(
            (card.phase, card.step, card.due),
            (Phase::Learning, 2, 11 * MINUTE)
        );
        card = grade(&card, Rating::Good, 11 * MINUTE).unwrap();
        assert_eq!(card.phase, Phase::Review);
        assert!(card.due >= 11 * MINUTE + DAY);
        let due = card.due;
        card = grade(&card, Rating::Again, due).unwrap();
        assert_eq!((card.phase, card.lapses), (Phase::Relearning, 1));
        card = grade(&card, Rating::Again, due + 10 * MINUTE).unwrap();
        assert_eq!(card.lapses, 1);
        card = grade(&card, Rating::Good, card.due).unwrap();
        assert_eq!((card.phase, card.reps, card.version), (Phase::Review, 6, 6));
        assert!(recall(&card, card.last_review.unwrap()).unwrap() > 0.99);
        assert!(recall(&card, card.due).unwrap() <= 1.0);
    }
    #[test]
    fn again_resets_learning_and_invalid_time_never_updates_memory() {
        let first = grade(&CardState::new(100), Rating::Again, 100).unwrap();
        assert_eq!((first.phase, first.step), (Phase::Learning, 0));
        assert!(grade(&first, Rating::Good, 99).is_err());
        assert_eq!(grade(&first, Rating::Good, first.due).unwrap().step, 1);
        assert_eq!(recall(&CardState::new(0), 0), None);
    }
}
