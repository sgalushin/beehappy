import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Stats } from '@beehappy/contract';
import { Api, errorMessage, percent } from '../core/api';

@Component({
  selector: 'app-progress',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="page-header">
      <div>
        <h1>Progress</h1>
        <p class="lede">Vocabulary, review activity, and recall statistics.</p>
      </div>
      <button class="button" (click)="load()" [disabled]="loading()">Refresh progress</button>
    </header>
    @if (loading()) {
      <section class="panel empty" role="status">
        <div class="loading-line"></div>
        <p>Gathering your practice…</p>
      </section>
    } @else if (error()) {
      <section class="notice error" role="alert">
        <p>{{ error() }}</p>
        <button class="button" (click)="load()">Try again</button>
      </section>
    } @else if (stats(); as stats) {
      <section class="stat-grid" aria-label="Vocabulary overview">
        <div class="panel stat-card">
          <p>Words collected</p>
          <strong>{{ stats.totalWords }}</strong
          ><span>Your growing vocabulary</span>
        </div>
        <a routerLink="/review" class="panel stat-card accent-card"
          ><p>Ready to review</p>
          <strong>{{ stats.dueWords }}</strong
          ><span>{{
            stats.dueWords ? 'A good moment to practice →' : 'Let your memory settle'
          }}</span></a
        >
        <div class="panel stat-card">
          <p>Learning & relearning</p>
          <strong>{{ stats.learningWords + stats.relearningWords }}</strong
          ><span>Building stronger memories</span>
        </div>
        <div class="panel stat-card">
          <p>Current streak</p>
          <strong
            >{{ stats.streak }} <small>{{ stats.streak === 1 ? 'day' : 'days' }}</small></strong
          ><span>Days with review activity</span>
        </div>
      </section>
      @if (!stats.totalWords) {
        <div class="notice welcome-notice">
          <div>
            <h3>Your progress starts with one word.</h3>
            <p>Keep a new discovery, then come back here to watch your practice take shape.</p>
          </div>
          <a routerLink="/vocabulary/new" class="button primary">Add your first word</a>
        </div>
      }
      <div class="progress-layout">
        <section class="panel chart-panel">
          <div class="section-heading">
            <div>
              <h2>Review activity</h2>
            </div>
            <span class="badge neutral">{{ recentReviews() }} reviews</span>
          </div>
          <p class="small muted">
            Each bar is a local calendar day. All answers count as practice.
          </p>
          <div
            class="activity-chart"
            role="list"
            aria-label="Review activity over the last 30 days"
          >
            @for (day of stats.days; track day.date) {
              <div
                class="activity-column"
                role="listitem"
                [attr.aria-label]="
                  dayLabel(day.date) +
                  ': ' +
                  day.reviews +
                  ' reviews, ' +
                  day.correct +
                  ' good answers, ' +
                  day.words +
                  ' distinct words'
                "
                [attr.title]="
                  dayLabel(day.date) +
                  ' · ' +
                  day.reviews +
                  ' reviews · ' +
                  day.correct +
                  ' good · ' +
                  day.words +
                  ' words'
                "
              >
                <div
                  class="activity-bar"
                  [class.zero]="!day.reviews"
                  [style.height.%]="day.reviews ? 10 + (day.reviews / maximumActivity()) * 90 : 2"
                ></div>
              </div>
            }
          </div>
          <div class="chart-axis">
            <span>{{ dayLabel(stats.days[0]?.date ?? '') }}</span
            ><span>{{ dayLabel(stats.days[stats.days.length - 1]?.date ?? '') }}</span>
          </div>
          <div class="chart-key">
            <span><i class="legend-swatch"></i> Review answers</span><span>{{ timeZone }}</span>
          </div>
        </section>
        <section class="panel chart-panel">
          <div class="section-heading">
            <div>
              <h2>Upcoming reviews</h2>
            </div>
          </div>
          <p class="small muted">
            Words currently scheduled over the next seven days. Today includes overdue words.
          </p>
          <div class="forecast-chart" aria-label="Seven-day review forecast">
            @for (day of stats.upcoming; track day.date; let i = $index) {
              <div class="forecast-row">
                <span>{{ i === 0 ? 'Today' : dayLabel(day.date) }}</span>
                <div class="forecast-track" aria-hidden="true">
                  <span [style.width.%]="(day.words / maximumForecast()) * 100"></span>
                </div>
                <strong>{{ day.words }}<span class="sr-only"> words</span></strong>
              </div>
            }
          </div>
          <p class="small muted">
            Reviewing changes the forecast. This is a schedule, not a daily quota.
          </p>
        </section>
      </div>
      <div class="progress-layout">
        <section class="panel detail-section">
          <h2>Observed recall</h2>
          <div class="accuracy-heading">
            <strong>{{ percent(stats.accuracy) }}</strong
            ><span class="muted">observed answer accuracy</span>
          </div>
          <p class="small muted">
            {{ stats.correctReviews }} Good answers out of {{ stats.reviews }} lifetime reviews. An
            Again answer is useful feedback, not a failure.
          </p>
          <div class="mode-breakdown">
            @for (mode of stats.modes; track mode.mode) {
              <div class="mode-stat">
                <div class="row between">
                  <h3>{{ mode.mode === 'word' ? 'Word only' : 'In context' }}</h3>
                  <strong>{{
                    mode.reviews ? percent(mode.correct / mode.reviews) : 'No reviews yet'
                  }}</strong>
                </div>
                <p class="small muted">{{ mode.correct }} Good / {{ mode.reviews }} answers</p>
                <div
                  class="accuracy-track"
                  role="meter"
                  [attr.aria-label]="(mode.mode === 'word' ? 'Word' : 'Context') + ' accuracy'"
                  [attr.aria-valuenow]="mode.reviews ? (mode.correct / mode.reviews) * 100 : 0"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <span
                    [style.width.%]="mode.reviews ? (mode.correct / mode.reviews) * 100 : 0"
                  ></span>
                </div>
              </div>
            }
          </div>
        </section>
        <section class="panel detail-section">
          <h2>Learning states</h2>
          <p class="muted">
            FSRS estimates how likely you are to recall each word right now. This probability
            changes over time and is different from the accuracy measured from your answers.
          </p>
          <a routerLink="/vocabulary" class="text-link">See each word’s FSRS recall estimate →</a>
          <dl class="phase-breakdown">
            <div>
              <dt><i class="status-dot new" aria-hidden="true"></i>New</dt>
              <dd>{{ stats.newWords }}</dd>
            </div>
            <div>
              <dt><i class="status-dot learning" aria-hidden="true"></i>Learning</dt>
              <dd>{{ stats.learningWords }}</dd>
            </div>
            <div>
              <dt><i class="status-dot review" aria-hidden="true"></i>In review</dt>
              <dd>{{ stats.reviewWords }}</dd>
            </div>
            <div>
              <dt><i class="status-dot relearning" aria-hidden="true"></i>Relearning</dt>
              <dd>{{ stats.relearningWords }}</dd>
            </div>
          </dl>
          <p class="small muted">
            Both modes update the same memory. Switching modes does not create another card.
          </p>
        </section>
      </div>
      <p class="dashboard-note small muted">
        Calendar days and streaks use {{ timeZone }}. Totals reflect words currently in your
        vocabulary and their review history.
      </p>
    }
  `,
})
export class ProgressPage implements OnInit {
  private readonly api = inject(Api);
  readonly stats = signal<Stats | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly percent = percent;
  readonly recentReviews = computed(
    () => this.stats()?.days.reduce((sum, day) => sum + day.reviews, 0) ?? 0,
  );
  readonly maximumActivity = computed(() =>
    Math.max(1, ...(this.stats()?.days.map((day) => day.reviews) ?? [])),
  );
  readonly maximumForecast = computed(() =>
    Math.max(1, ...(this.stats()?.upcoming.map((day) => day.words) ?? [])),
  );

  dayLabel(date: string): string {
    if (!date) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(`${date}T12:00:00`),
    );
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.stats.set(await this.api.stats());
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
