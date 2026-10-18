import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Word } from '@beehappy/contract';
import { Api, errorMessage } from '../core/api';

@Component({
  selector: 'app-vocabulary',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <header class="page-header">
      <div>
        <h1>Vocabulary</h1>
        <p class="lede">Your saved words, meanings, and sentences.</p>
      </div>
      <a routerLink="/vocabulary/new" class="button primary"
        ><span aria-hidden="true">＋</span> Add a word</a
      >
    </header>
    <section class="collection-summary" aria-label="Collection summary">
      <span
        ><strong>{{ words().length }}</strong> words collected</span
      ><span
        ><i class="status-dot due" aria-hidden="true"></i><strong>{{ dueCount() }}</strong> ready to
        review</span
      ><a routerLink="/review" class="text-link">Start review →</a>
    </section>
    <div class="toolbar">
      <label class="search-field"
        ><span class="sr-only">Search words, definitions, and sentences</span
        ><span class="search-symbol" aria-hidden="true">⌕</span
        ><input
          type="search"
          placeholder="Find a word, meaning, or sentence…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)" /></label
      ><label class="filter-field"
        ><span class="sr-only">Filter by learning status</span
        ><select [ngModel]="filter()" (ngModelChange)="filter.set($event)">
          <option value="all">All words</option>
          <option value="due">Due for review</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="review">Review</option>
          <option value="relearning">Relearning</option>
          <option value="no-context">Without sentences</option>
        </select></label
      ><button
        class="button subtle"
        (click)="load()"
        [disabled]="loading()"
        aria-label="Refresh vocabulary"
      >
        Refresh
      </button>
    </div>
    @if (loading()) {
      <div class="panel empty" role="status">
        <div class="loading-line"></div>
        <p>Opening your collection…</p>
      </div>
    } @else if (error()) {
      <div class="notice error" role="alert">
        <p>{{ error() }}</p>
        <button class="button" (click)="load()">Try again</button>
      </div>
    } @else if (!words().length) {
      <section class="panel empty">
        <h2>No words yet</h2>
        <p>Add a word and the sentence where you encountered it.</p>
        <a routerLink="/vocabulary/new" class="button primary">Add your first word</a>
      </section>
    } @else if (!filtered().length) {
      <section class="panel empty">
        <h2>No matching words</h2>
        <p>Try a different search or a broader filter.</p>
        <button class="button" (click)="query.set(''); filter.set('all')">Clear filters</button>
      </section>
    } @else {
      <div class="list-heading">
        <span>{{ filtered().length }} {{ filtered().length === 1 ? 'word' : 'words' }}</span
        ><span>Most recently collected</span>
      </div>
      <div class="word-grid">
        @for (word of filtered(); track word.id) {
          <a class="word-card" [routerLink]="['/vocabulary', word.id]"
            ><div class="row between">
              <span class="badge" [class.due]="word.card.due <= now()">{{
                word.card.due <= now() ? 'Due now' : word.card.phase
              }}</span
              ><span class="card-arrow" aria-hidden="true">↗</span>
            </div>
            <h2>{{ word.text }}</h2>
            <p class="part-of-speech">{{ word.meanings[0]?.partOfSpeech }}</p>
            <p class="word-definition">{{ word.meanings[0]?.definition }}</p>
            <div class="word-card-footer">
              <span
                >{{ word.sentences.length }}
                {{ word.sentences.length === 1 ? 'sentence' : 'sentences' }}</span
              ><span>{{
                word.card.due <= now()
                  ? 'Ready to practice'
                  : 'Due ' + (word.card.due | date: 'MMM d')
              }}</span>
            </div></a
          >
        }
      </div>
    }
  `,
})
export class VocabularyPage implements OnInit {
  private readonly api = inject(Api);
  readonly words = signal<Word[]>([]);
  readonly query = signal('');
  readonly filter = signal('all');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly now = signal(Date.now());
  readonly dueCount = computed(
    () => this.words().filter((word) => word.card.due <= this.now()).length,
  );
  readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('en-US');
    return this.words()
      .filter((word) => {
        const filter = this.filter();
        if (filter === 'due' && word.card.due > this.now()) return false;
        if (filter === 'no-context' && word.sentences.length) return false;
        if (!['all', 'due', 'no-context'].includes(filter) && word.card.phase !== filter)
          return false;
        return (
          !query ||
          [
            word.text,
            ...word.meanings.map((meaning) => `${meaning.partOfSpeech} ${meaning.definition}`),
            ...word.sentences.map((sentence) => sentence.text),
          ].some((text) => text.toLocaleLowerCase('en-US').includes(query))
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  });
  async ngOnInit(): Promise<void> {
    await this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.words.set(await this.api.words());
      this.now.set(Date.now());
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
