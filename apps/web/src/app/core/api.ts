import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  GenerateMeaningsRequest,
  GenerateMeaningsResult,
  GenerateSentencesRequest,
  GenerateSentencesResult,
  GradeRequest,
  GradeResult,
  ReviewMode,
  ReviewSession,
  SaveWordRequest,
  Stats,
  Word,
  WordDetail,
} from '@beehappy/contract';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  words(): Promise<Word[]> {
    return firstValueFrom(this.http.get<Word[]>('/api/words'));
  }
  word(id: string): Promise<WordDetail> {
    return firstValueFrom(this.http.get<WordDetail>(`/api/words/${encodeURIComponent(id)}`));
  }
  create(body: SaveWordRequest): Promise<Word> {
    return firstValueFrom(this.http.post<Word>('/api/words', body));
  }
  update(id: string, body: SaveWordRequest): Promise<Word> {
    return firstValueFrom(this.http.put<Word>(`/api/words/${encodeURIComponent(id)}`, body));
  }
  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/words/${encodeURIComponent(id)}`));
  }
  review(mode: ReviewMode): Promise<ReviewSession> {
    return firstValueFrom(this.http.get<ReviewSession>(`/api/review?mode=${mode}&limit=20`));
  }
  grade(id: string, body: GradeRequest): Promise<GradeResult> {
    return firstValueFrom(
      this.http.post<GradeResult>(`/api/words/${encodeURIComponent(id)}/reviews`, body),
    );
  }
  stats(): Promise<Stats> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return firstValueFrom(
      this.http.get<Stats>(`/api/stats?timeZone=${encodeURIComponent(timeZone)}`),
    );
  }
  meanings(body: GenerateMeaningsRequest): Promise<GenerateMeaningsResult> {
    return firstValueFrom(this.http.post<GenerateMeaningsResult>('/api/ai/meanings', body));
  }
  sentences(body: GenerateSentencesRequest): Promise<GenerateSentencesResult> {
    return firstValueFrom(this.http.post<GenerateSentencesResult>('/api/ai/sentences', body));
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const payload: unknown = error.error;
    if (
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
    )
      return payload.error;
    if (error.status === 0) return 'Unable to reach Beehappy. Check your connection and try again.';
    if (error.status === 404) return 'This word could not be found. It may have been deleted.';
    if (error.status === 409)
      return 'This word changed in another session. Reload the latest version before trying again.';
    return `The request could not be completed (${error.status}). Please try again.`;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function isConflict(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409;
}
export function percent(value: number | null): string {
  return value === null ? 'Not yet measured' : `${Math.round(value * 100)}%`;
}
export function intervalLabel(milliseconds: number): string {
  if (milliseconds < 60_000) return 'Less than a minute';
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`;
  if (milliseconds < 86_400_000) return `${Math.round(milliseconds / 3_600_000)} hr`;
  const days = Math.round(milliseconds / 86_400_000);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
