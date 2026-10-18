import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { WordDetail } from '@beehappy/contract';
import { Api, errorMessage, intervalLabel, percent } from '../core/api';
import { SentenceText } from '../shared/sentence';

@Component({
  selector: 'app-word-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, DecimalPipe, SentenceText],
  template: `
    <a routerLink="/vocabulary" class="back-link">← Your vocabulary</a>
    @if (loading()) {
      <div class="panel empty" role="status">Opening your word…</div>
    } @else if (error()) {
      <div class="notice error" role="alert">
        <p>{{ error() }}</p>
        <button class="button" (click)="load()">Try again</button>
      </div>
    } @else if (detail(); as detail) {
      <header class="page-header detail-header">
        <div>
          <div class="row">
            <span class="badge" [class.due]="detail.word.card.due <= now()">{{
              detail.word.card.due <= now() ? 'Ready for review' : detail.word.card.phase
            }}</span
            ><span class="small muted"
              >Collected {{ detail.word.createdAt | date: 'MMM d, y' }}</span
            >
          </div>
          <h1>{{ detail.word.text }}</h1>
        </div>
        <div class="row wrap">
          <a [routerLink]="['/vocabulary', detail.word.id, 'edit']" class="button">Edit word</a
          ><a routerLink="/review" class="button primary">Practice vocabulary</a>
        </div>
      </header>
      <div class="detail-layout">
        <div class="detail-main">
          <section class="panel detail-section">
            <div class="section-heading">
              <div>
                <h2>Meanings</h2>
              </div>
              <span class="count-label"
                >{{ detail.word.meanings.length }}
                {{ detail.word.meanings.length === 1 ? 'sense' : 'senses' }}</span
              >
            </div>
            <ol class="meanings-list">
              @for (meaning of detail.word.meanings; track $index) {
                <li>
                  <span class="part-of-speech">{{ meaning.partOfSpeech }}</span>
                  <p>{{ meaning.definition }}</p>
                </li>
              }
            </ol>
          </section>
          <section class="panel detail-section">
            <div class="section-heading">
              <div>
                <h2>Sentences</h2>
              </div>
              <span class="count-label"
                >{{ detail.word.sentences.length }}
                {{ detail.word.sentences.length === 1 ? 'sentence' : 'sentences' }}</span
              >
            </div>
            @for (sentence of detail.word.sentences; track sentence.id) {
              <figure class="sentence-card">
                <blockquote><app-sentence [sentence]="sentence" /></blockquote>
                <figcaption>
                  <span class="badge neutral">{{
                    sentence.origin === 'generated' ? 'AI-generated' : 'Encountered'
                  }}</span>
                  @if (sentence.source) {
                    <span class="source-text">{{ sentence.source }}</span>
                  }
                </figcaption>
              </figure>
            } @empty {
              <div class="subtle-empty">
                <p>No sentences yet. Add a sentence to practice this word in context.</p>
                <a [routerLink]="['/vocabulary', detail.word.id, 'edit']" class="text-link"
                  >Add a sentence →</a
                >
              </div>
            }
          </section>
          <section class="panel detail-section">
            <div class="section-heading">
              <div>
                <h2>Review history</h2>
              </div>
              <span class="count-label">{{ detail.history.length }} reviews</span>
            </div>
            @if (!detail.history.length) {
              <p class="subtle-empty">
                Your first review is waiting. Each practice will appear here.
              </p>
            } @else {
              <div class="table-scroll">
                <table>
                  <caption class="sr-only">
                    Review history for
                    {{
                      detail.word.text
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Mode</th>
                      <th scope="col">Answer</th>
                      <th scope="col">Next interval</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (event of history(); track event.id) {
                      <tr>
                        <td>{{ event.reviewedAt | date: 'MMM d, y, h:mm a' }}</td>
                        <td>{{ event.mode === 'word' ? 'Word' : 'Context' }}</td>
                        <td>
                          <span
                            class="badge"
                            [class.success]="event.rating === 'good'"
                            [class.again]="event.rating === 'again'"
                            >{{ event.rating === 'good' ? 'Good' : 'Again' }}</span
                          >
                        </td>
                        <td>{{ interval(event.interval) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        </div>
        <aside class="detail-aside">
          <section class="panel detail-section">
            <h3>Schedule</h3>
            <p class="next-due">
              {{
                detail.word.card.due <= now()
                  ? 'Due now'
                  : (detail.word.card.due | date: 'MMM d, h:mm a')
              }}
            </p>
            <p class="small muted">Word and context reviews update the same FSRS memory.</p>
            <dl class="schedule-list">
              <div>
                <dt>Stage</dt>
                <dd class="capitalize">{{ detail.word.card.phase }}</dd>
              </div>
              <div>
                <dt>Stability</dt>
                <dd>{{ detail.word.card.stability | number: '1.0-1' }} days</dd>
              </div>
              <div>
                <dt>Difficulty</dt>
                <dd>{{ detail.word.card.difficulty | number: '1.0-1' }} / 10</dd>
              </div>
              <div>
                <dt>Reviews</dt>
                <dd>{{ detail.word.card.reps }}</dd>
              </div>
              <div>
                <dt>Lapses</dt>
                <dd>{{ detail.word.card.lapses }}</dd>
              </div>
              <div>
                <dt>Last practiced</dt>
                <dd>
                  {{
                    detail.word.card.lastReview
                      ? (detail.word.card.lastReview | date: 'MMM d, h:mm a')
                      : 'Not yet'
                  }}
                </dd>
              </div>
            </dl>
          </section>
          <section class="panel detail-section">
            <h3>Recall statistics</h3>
            <div class="recall-stat">
              <span>{{ percent(detail.recallProbability) }}</span>
              <p>FSRS estimated recall now</p>
            </div>
            <p class="small muted">
              A model estimate based on time and your memory schedule—not a measured success rate.
            </p>
            <div class="recall-stat observed">
              <span>{{ percent(accuracy()) }}</span>
              <p>Observed answer accuracy</p>
            </div>
            <p class="small muted">Good answers divided by all recorded reviews for this word.</p>
            <div class="mode-results">
              @for (mode of modeResults(); track mode.mode) {
                <div>
                  <span>{{ mode.mode === 'word' ? 'Word only' : 'In context' }}</span
                  ><strong>{{ mode.good }} / {{ mode.total }} good</strong>
                </div>
              }
            </div>
          </section>
          <section class="danger-zone">
            <button class="button danger full" (click)="remove()" [disabled]="deleting()">
              {{ deleting() ? 'Deleting…' : 'Delete word' }}
            </button>
            @if (deleteError()) {
              <p class="notice error" role="alert">{{ deleteError() }}</p>
            }
            <p class="small muted">Removes this word and its review history.</p>
          </section>
        </aside>
      </div>
    }
  `,
})
export class WordDetailPage implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly detail = signal<WordDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly deleting = signal(false);
  readonly deleteError = signal('');
  readonly now = signal(Date.now());
  readonly percent = percent;
  readonly interval = intervalLabel;
  readonly history = computed(() =>
    [...(this.detail()?.history ?? [])].sort((a, b) => b.reviewedAt - a.reviewedAt),
  );
  readonly accuracy = computed(() => {
    const history = this.history();
    return history.length
      ? history.filter((event) => event.rating === 'good').length / history.length
      : null;
  });
  readonly modeResults = computed(() =>
    (['word', 'context'] as const).map((mode) => {
      const events = this.history().filter((event) => event.mode === mode);
      return {
        mode,
        total: events.length,
        good: events.filter((event) => event.rating === 'good').length,
      };
    }),
  );

  async ngOnInit(): Promise<void> {
    await this.load();
  }
  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.loading.set(true);
    this.error.set('');
    try {
      this.detail.set(await this.api.word(id));
      this.now.set(Date.now());
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async remove(): Promise<void> {
    const detail = this.detail();
    if (
      !detail ||
      this.deleting() ||
      !window.confirm(
        `Delete “${detail.word.text}” and all its review history? This cannot be undone.`,
      )
    )
      return;
    this.deleting.set(true);
    this.deleteError.set('');
    try {
      await this.api.remove(detail.word.id);
      await this.router.navigate(['/vocabulary']);
    } catch (error) {
      this.deleteError.set(errorMessage(error));
    } finally {
      this.deleting.set(false);
    }
  }
}
