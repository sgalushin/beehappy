import {
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { GradeRequest, Rating, ReviewMode, Word } from '@beehappy/contract';
import { Api, errorMessage, isConflict } from '../core/api';
import { SentenceText } from '../shared/sentence';

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [RouterLink, SentenceText],
  template: `
    <header class="page-header">
      <div>
        <p class="eyebrow">A little practice, every day</p>
        <h1>Make it stay.</h1>
        <p class="lede">Recall first. Reveal when you’re ready. Let your memory set the pace.</p>
      </div>
    </header>
    <div class="review-toolbar">
      <div class="segmented" role="group" aria-label="Review mode">
        <button
          (click)="changeMode('word')"
          [class.active]="mode() === 'word'"
          [attr.aria-pressed]="mode() === 'word'"
          [disabled]="loading() || grading() || !!pending()"
        >
          Word only</button
        ><button
          (click)="changeMode('context')"
          [class.active]="mode() === 'context'"
          [attr.aria-pressed]="mode() === 'context'"
          [disabled]="loading() || grading() || !!pending()"
        >
          In context
        </button>
      </div>
      <p class="small muted">Two ways to practice. One shared schedule.</p>
    </div>
    @if (notice()) {
      <p class="notice" role="status">{{ notice() }}</p>
    }
    @if (loading()) {
      <section class="panel empty" role="status">
        <div class="loading-line"></div>
        <p>Finding the words that are ready…</p>
      </section>
    } @else if (loadError()) {
      <section class="panel empty">
        <h2>Practice will be right here.</h2>
        <p class="notice error" role="alert">{{ loadError() }}</p>
        <button class="button primary" (click)="load()">Try again</button>
      </section>
    } @else if (current(); as word) {
      <div class="review-progress">
        <span role="status">{{ completed() }} practiced · {{ queue().length }} in this batch</span
        ><span>{{ totalDue() }} due when you started</span>
      </div>
      <div
        class="progress-track"
        role="progressbar"
        aria-label="Review batch progress"
        [attr.aria-valuenow]="completed()"
        [attr.aria-valuemax]="batchSize()"
        aria-valuemin="0"
      >
        <span [style.width.%]="batchSize() ? (completed() / batchSize()) * 100 : 0"></span>
      </div>
      <section class="panel review-card" aria-live="polite">
        <p class="eyebrow">
          {{ mode() === 'word' ? 'Bring the meaning to mind' : 'Recall the word in its context' }}
        </p>
        @if (mode() === 'context' && context(); as sentence) {
          <blockquote class="review-context"><app-sentence [sentence]="sentence" /></blockquote>
          <p class="small muted review-source">
            {{ sentence.origin === 'generated' ? 'AI-generated example' : 'Encountered sentence' }}
            @if (sentence.source) {
              · {{ sentence.source }}
            }
          </p>
        } @else {
          <h2 class="review-word">{{ word.text }}</h2>
        }
        @if (!revealed()) {
          <p class="review-prompt">
            What does {{ mode() === 'context' ? 'the highlighted word' : 'this word' }} mean?
          </p>
          <button #revealButton class="button primary reveal-button" (click)="revealed.set(true)">
            Reveal meanings <kbd>Space</kbd>
          </button>
        } @else {
          <div class="review-answer">
            @if (mode() === 'context') {
              <h2>{{ word.text }}</h2>
            }
            <ol class="meanings-list">
              @for (meaning of word.meanings; track $index) {
                <li>
                  <span class="part-of-speech">{{ meaning.partOfSpeech }}</span>
                  <p>{{ meaning.definition }}</p>
                </li>
              }
            </ol>
          </div>
          <p class="review-prompt">Did you recall the meaning?</p>
          @if (gradeError()) {
            <div class="notice error" role="alert">
              <p>{{ gradeError() }}</p>
              <p class="small">
                Your answer has been kept. Retrying uses the same review ID, so it cannot be counted
                twice.
              </p>
              <div class="row wrap">
                <button class="button" (click)="retryGrade()" [disabled]="grading()">
                  {{ grading() ? 'Saving answer…' : 'Retry the same answer' }}</button
                ><button class="button subtle" (click)="refreshAfterError()" [disabled]="grading()">
                  Refresh due cards
                </button>
              </div>
            </div>
          }
          <div class="rating-buttons">
            <button
              class="button rating again-button"
              (click)="grade('again')"
              [disabled]="grading() || !!pending()"
            >
              <span>Again</span><small>I need another look <kbd>1</kbd></small></button
            ><button
              class="button rating good-button"
              (click)="grade('good')"
              [disabled]="grading() || !!pending()"
            >
              <span>Good</span><small>I remembered it <kbd>2</kbd></small>
            </button>
          </div>
          @if (grading()) {
            <p class="small muted" role="status">Saving your answer…</p>
          }
        }
      </section>
      <div class="review-footnote">
        <p>Honest answers make a better schedule.</p>
        <a [routerLink]="['/vocabulary', word.id]" class="text-link">View word details →</a>
      </div>
    } @else {
      <section class="panel empty review-complete">
        <span class="empty-mark" aria-hidden="true">{{ completed() ? '✓' : 'Aa' }}</span>
        <p class="eyebrow">
          {{ completed() ? 'A little stronger than before' : 'Room to let it settle' }}
        </p>
        <h2>{{ completed() ? 'A good place to pause.' : 'You’re up to date.' }}</h2>
        @if (completed()) {
          <p>
            You practiced {{ completed() }} {{ completed() === 1 ? 'word' : 'words' }} in this
            batch. Every encounter makes the next one easier.
          </p>
        } @else {
          <p>
            {{
              mode() === 'context'
                ? 'No sentence cards are due right now. Context mode only includes words with saved sentences—add one to bring a word into this mode.'
                : 'No words are due right now. Add a new discovery or come back when your next review is ready.'
            }}
          </p>
        }
        <div class="row wrap center">
          <button class="button primary" (click)="load()">Check for due words</button
          ><a routerLink="/vocabulary" class="button">Back to vocabulary</a>
        </div>
        <p class="small muted">
          Again answers may become due shortly. Checking again uses the actual schedule.
        </p>
      </section>
    }
  `,
})
export class ReviewPage implements OnInit {
  private readonly api = inject(Api);
  readonly mode = signal<ReviewMode>('word');
  readonly queue = signal<Word[]>([]);
  readonly current = computed(() => this.queue()[0] ?? null);
  readonly context = computed(() => {
    const word = this.current();
    return word?.sentences.length ? word.sentences[word.card.reps % word.sentences.length] : null;
  });
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly gradeError = signal('');
  readonly notice = signal('');
  readonly revealed = signal(false);
  readonly grading = signal(false);
  readonly completed = signal(0);
  readonly totalDue = signal(0);
  readonly batchSize = signal(0);
  readonly pending = signal<{ wordId: string; body: GradeRequest } | null>(null);
  private readonly revealButton = viewChild<ElementRef<HTMLButtonElement>>('revealButton');

  constructor() {
    effect(() => {
      const button = this.revealButton();
      if (button) button.nativeElement.focus({ preventScroll: true });
    });
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async changeMode(mode: ReviewMode): Promise<void> {
    if (this.loading() || this.grading() || this.pending() || mode === this.mode()) return;
    this.mode.set(mode);
    this.notice.set('');
    await this.load();
  }

  async load(): Promise<void> {
    if (this.grading()) return;
    this.loading.set(true);
    this.loadError.set('');
    this.gradeError.set('');
    this.pending.set(null);
    this.revealed.set(false);
    this.completed.set(0);
    try {
      const session = await this.api.review(this.mode());
      this.queue.set(session.words);
      this.totalDue.set(session.due);
      this.batchSize.set(session.words.length);
    } catch (error) {
      this.loadError.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async grade(rating: Rating): Promise<void> {
    const word = this.current();
    if (!word || !this.revealed() || this.grading() || this.pending()) return;
    this.pending.set({
      wordId: word.id,
      body: { eventId: crypto.randomUUID(), mode: this.mode(), rating, version: word.card.version },
    });
    await this.submitGrade();
  }

  async retryGrade(): Promise<void> {
    if (this.pending() && !this.grading()) await this.submitGrade();
  }

  async refreshAfterError(): Promise<void> {
    this.notice.set(
      'The due list has been refreshed from your saved schedule. Any answer already saved is not counted again.',
    );
    await this.load();
  }

  private async submitGrade(): Promise<void> {
    const pending = this.pending();
    if (!pending || this.grading()) return;
    this.grading.set(true);
    this.gradeError.set('');
    let stale = false;
    try {
      await this.api.grade(pending.wordId, pending.body);
      this.queue.update((words) => words.filter((word) => word.id !== pending.wordId));
      this.completed.update((count) => count + 1);
      this.pending.set(null);
      this.revealed.set(false);
    } catch (error) {
      if (isConflict(error)) stale = true;
      else this.gradeError.set(errorMessage(error));
    } finally {
      this.grading.set(false);
    }
    if (stale) {
      this.notice.set(
        'This word changed in another session. We refreshed the due list and did not apply this stale answer.',
      );
      await this.load();
    }
  }

  @HostListener('document:keydown', ['$event'])
  async onKeydown(event: KeyboardEvent): Promise<void> {
    const target = event.target;
    if (
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this.loading() ||
      this.grading() ||
      this.pending() ||
      !this.current() ||
      (target instanceof HTMLElement &&
        (target.isContentEditable ||
          !!target.closest('input, textarea, select, button, a, [role="textbox"]')))
    )
      return;
    if (!this.revealed() && (event.code === 'Space' || event.key === 'Enter')) {
      event.preventDefault();
      this.revealed.set(true);
    } else if (this.revealed() && (event.key === '1' || event.key === '2')) {
      event.preventDefault();
      await this.grade(event.key === '1' ? 'again' : 'good');
    }
  }
}
