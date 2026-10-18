use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meaning {
    pub part_of_speech: String,
    pub definition: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceInput {
    pub text: String,
    pub target_start: usize,
    pub target_end: usize,
    pub origin: Origin,
    #[serde(default)]
    pub source: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Encountered,
    Generated,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sentence {
    pub id: String,
    #[serde(flatten)]
    pub input: SentenceInput,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    New,
    Learning,
    Review,
    Relearning,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardState {
    pub phase: Phase,
    pub due: i64,
    pub last_review: Option<i64>,
    pub stability: f32,
    pub difficulty: f32,
    pub reps: u64,
    pub lapses: u64,
    pub step: u8,
    pub version: u64,
}
impl CardState {
    pub fn new(now: i64) -> Self {
        Self {
            phase: Phase::New,
            due: now,
            last_review: None,
            stability: 0.0,
            difficulty: 0.0,
            reps: 0,
            lapses: 0,
            step: 0,
            version: 0,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub id: String,
    pub text: String,
    pub meanings: Vec<Meaning>,
    pub sentences: Vec<Sentence>,
    pub card: CardState,
    pub created_at: i64,
    pub updated_at: i64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWordRequest {
    pub text: String,
    pub meanings: Vec<Meaning>,
    pub sentences: Vec<SentenceInput>,
    pub version: Option<u64>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Word,
    Context,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Rating {
    Again,
    Good,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GradeRequest {
    pub event_id: String,
    pub mode: Mode,
    pub rating: Rating,
    pub version: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewEvent {
    pub id: String,
    pub word_id: String,
    pub mode: Mode,
    pub rating: Rating,
    pub reviewed_at: i64,
    pub interval: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordDetail {
    pub word: Word,
    pub history: Vec<ReviewEvent>,
    pub recall_probability: Option<f64>,
}
#[derive(Serialize)]
pub struct ReviewSession {
    pub words: Vec<Word>,
    pub due: usize,
}
#[derive(Serialize)]
pub struct GradeResult {
    pub status: &'static str,
    pub word: Word,
}
#[derive(Serialize)]
pub struct ActivityDay {
    pub date: String,
    pub reviews: usize,
    pub correct: usize,
    pub words: usize,
}
#[derive(Serialize)]
pub struct UpcomingDay {
    pub date: String,
    pub words: usize,
}
#[derive(Serialize)]
pub struct ModeStats {
    pub mode: Mode,
    pub reviews: usize,
    pub correct: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total_words: usize,
    pub new_words: usize,
    pub learning_words: usize,
    pub review_words: usize,
    pub relearning_words: usize,
    pub due_words: usize,
    pub reviews: usize,
    pub correct_reviews: usize,
    pub accuracy: Option<f64>,
    pub streak: usize,
    pub days: Vec<ActivityDay>,
    pub upcoming: Vec<UpcomingDay>,
    pub modes: Vec<ModeStats>,
}
#[derive(Deserialize)]
pub struct GenerateMeaningsRequest {
    pub text: String,
    pub sentences: Vec<String>,
}
#[derive(Serialize, Deserialize)]
pub struct GenerateMeaningsResult {
    pub meanings: Vec<Meaning>,
}
#[derive(Deserialize)]
pub struct GenerateSentencesRequest {
    pub text: String,
    pub meanings: Vec<Meaning>,
    pub count: usize,
}
#[derive(Serialize)]
pub struct GenerateSentencesResult {
    pub sentences: Vec<SentenceInput>,
}
