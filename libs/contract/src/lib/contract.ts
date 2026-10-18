export type ReviewMode = 'word' | 'context';
export type Rating = 'again' | 'good';
export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';
export interface Meaning {
  partOfSpeech: string;
  definition: string;
}
/** Offsets use JavaScript UTF-16 code units; text.slice(start, end) is the selected occurrence. */
export interface SentenceInput {
  text: string;
  targetStart: number;
  targetEnd: number;
  origin: 'encountered' | 'generated';
  source: string;
}
export interface Sentence extends SentenceInput {
  id: string;
}
export interface WordInput {
  text: string;
  meanings: Meaning[];
  sentences: SentenceInput[];
}
export interface CardState {
  phase: CardPhase;
  due: number;
  lastReview: number | null;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  step: number;
  version: number;
}
export interface Word extends Omit<WordInput, 'sentences'> {
  id: string;
  sentences: Sentence[];
  card: CardState;
  createdAt: number;
  updatedAt: number;
}
export interface SaveWordRequest extends WordInput {
  version?: number;
}
export interface ReviewEvent {
  id: string;
  wordId: string;
  mode: ReviewMode;
  rating: Rating;
  reviewedAt: number;
  interval: number;
}
export interface WordDetail {
  word: Word;
  history: ReviewEvent[];
  recallProbability: number | null;
}
export interface ReviewSession {
  words: Word[];
  due: number;
}
export interface GradeRequest {
  eventId: string;
  mode: ReviewMode;
  rating: Rating;
  version: number;
}
export interface GradeResult {
  status: 'applied' | 'duplicate';
  word: Word;
}
export interface ActivityDay {
  date: string;
  reviews: number;
  correct: number;
  words: number;
}
export interface UpcomingDay {
  date: string;
  words: number;
}
export interface Stats {
  totalWords: number;
  newWords: number;
  learningWords: number;
  reviewWords: number;
  relearningWords: number;
  dueWords: number;
  reviews: number;
  correctReviews: number;
  accuracy: number | null;
  streak: number;
  days: ActivityDay[];
  upcoming: UpcomingDay[];
  modes: { mode: ReviewMode; reviews: number; correct: number }[];
}
export interface GenerateMeaningsRequest {
  text: string;
  sentences: string[];
}
export interface GenerateMeaningsResult {
  meanings: Meaning[];
}
export interface GenerateSentencesRequest {
  text: string;
  meanings: Meaning[];
  count: number;
}
export interface GenerateSentencesResult {
  sentences: SentenceInput[];
}
export interface ApiError {
  error: string;
}
