import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Meaning, SentenceInput, WordInput } from '@beehappy/contract';
import { Api, errorMessage, isConflict } from '../core/api';
import { SentenceText } from '../shared/sentence';
import { inferTarget, validSpan } from '../shared/sentence-target';

@Component({
  selector: 'app-word-editor',
  standalone: true,
  imports: [FormsModule, RouterLink, SentenceText],
  template: `
    <a [routerLink]="id ? ['/vocabulary', id] : ['/vocabulary']" class="back-link"
      >← {{ id ? 'Back to word' : 'Your vocabulary' }}</a
    >
    <header class="page-header">
      <div>
        <h1>{{ id ? 'Edit word' : 'Add a word' }}</h1>
        <p class="lede">Save meanings and sentences in American English.</p>
      </div>
    </header>
    @if (loading()) {
      <div class="panel empty" role="status">Loading your word…</div>
    } @else if (loadError()) {
      <div class="notice error" role="alert">
        <p>{{ loadError() }}</p>
        <button class="button" (click)="load()">Try again</button>
      </div>
    } @else {
      <form (ngSubmit)="save()" class="editor-layout">
        <fieldset class="editor-main" [disabled]="saving()">
          <section class="panel editor-section">
            <div class="section-heading">
              <div>
                <h2>Word</h2>
              </div>
            </div>
            <label for="word-text">Word or phrase</label
            ><input
              id="word-text"
              class="word-input"
              name="text"
              [(ngModel)]="draft.text"
              required
              maxlength="200"
              autocomplete="off"
              placeholder="e.g. serendipity"
            />
            <p class="field-hint">
              English words and phrases, exactly as you want to remember them.
            </p>
          </section>
          <section class="panel editor-section">
            <div class="section-heading">
              <div>
                <h2>Meanings</h2>
              </div>
              <button
                type="button"
                class="button subtle"
                (click)="generateMeanings()"
                [disabled]="meaningBusy() || !draft.text.trim() || draft.meanings.length >= 30"
              >
                {{ meaningBusy() ? 'Finding meanings…' : 'Suggest with AI' }}
              </button>
            </div>
            <p class="muted">
              American English definitions, with no translations. Add as many senses as you need.
            </p>
            @for (meaning of draft.meanings; track $index; let i = $index) {
              <div class="meaning-editor">
                <div class="row between">
                  <span class="item-number">Meaning {{ i + 1 }}</span
                  ><button
                    type="button"
                    class="icon-button danger-text"
                    (click)="draft.meanings.splice(i, 1)"
                    [attr.aria-label]="'Remove meaning ' + (i + 1)"
                  >
                    Remove
                  </button>
                </div>
                <div class="meaning-fields">
                  <div>
                    <label [for]="'pos-' + i">Part of speech</label
                    ><input
                      [id]="'pos-' + i"
                      [name]="'pos-' + i"
                      [(ngModel)]="meaning.partOfSpeech"
                      placeholder="noun"
                      maxlength="100"
                      required
                    />
                  </div>
                  <div>
                    <label [for]="'definition-' + i">Definition</label
                    ><textarea
                      [id]="'definition-' + i"
                      [name]="'definition-' + i"
                      [(ngModel)]="meaning.definition"
                      rows="3"
                      placeholder="A precise English definition…"
                      maxlength="3000"
                      required
                    ></textarea>
                  </div>
                </div>
              </div>
            }
            <button
              type="button"
              class="button"
              (click)="draft.meanings.push({ partOfSpeech: '', definition: '' })"
              [disabled]="draft.meanings.length >= 30"
            >
              ＋ Add a meaning
            </button>
            @if (meaningError()) {
              <p class="notice error" role="alert">{{ meaningError() }}</p>
            }
            @if (meaningPreview().length) {
              <div class="ai-preview">
                <div class="row between">
                  <div>
                    <span class="badge honey">AI suggestions · not saved</span>
                    <h3>Suggested meanings</h3>
                  </div>
                  <button
                    type="button"
                    class="icon-button"
                    (click)="meaningPreview.set([])"
                    aria-label="Dismiss suggested meanings"
                  >
                    Dismiss
                  </button>
                </div>
                <p class="small muted">
                  Review for accuracy. Appending leaves your existing meanings untouched.
                </p>
                @for (meaning of meaningPreview(); track $index; let i = $index) {
                  <div class="preview-item">
                    <div>
                      <span class="part-of-speech">{{ meaning.partOfSpeech }}</span>
                      <p>{{ meaning.definition }}</p>
                    </div>
                    <button
                      type="button"
                      class="button small-button"
                      (click)="appendMeaning(i)"
                      [disabled]="draft.meanings.length >= 30"
                    >
                      Append
                    </button>
                  </div>
                }
                <button
                  type="button"
                  class="button"
                  (click)="appendAllMeanings()"
                  [disabled]="draft.meanings.length + meaningPreview().length > 30"
                >
                  Append all meanings
                </button>
              </div>
            }
          </section>
          <section class="panel editor-section">
            <div class="section-heading">
              <div>
                <h2>Sentences</h2>
              </div>
              <button
                type="button"
                class="button subtle"
                (click)="generateSentences()"
                [disabled]="
                  sentenceBusy() ||
                  !draft.text.trim() ||
                  !hasMeaning() ||
                  draft.sentences.length >= 100
                "
              >
                {{ sentenceBusy() ? 'Writing sentences…' : 'Suggest with AI' }}
              </button>
            </div>
            <p class="muted">
              Keep sentences you encountered or create examples. Highlight the exact occurrence to
              appear in bold during context reviews.
            </p>
            @for (sentence of draft.sentences; track $index; let i = $index) {
              <div class="sentence-editor">
                <div class="row between">
                  <span class="item-number">Sentence {{ i + 1 }}</span
                  ><button
                    type="button"
                    class="icon-button danger-text"
                    (click)="draft.sentences.splice(i, 1)"
                    [attr.aria-label]="'Remove sentence ' + (i + 1)"
                  >
                    Remove
                  </button>
                </div>
                <label [for]="'sentence-' + i">Sentence text</label
                ><textarea
                  #sentenceInput
                  [id]="'sentence-' + i"
                  [name]="'sentence-' + i"
                  [ngModel]="sentence.text"
                  (ngModelChange)="updateSentence(i, $event)"
                  (select)="captureSelection(i, sentenceInput)"
                  rows="3"
                  maxlength="5000"
                  required
                  placeholder="Paste or write the sentence where this word belongs…"
                ></textarea>
                <div class="selection-help">
                  <span class="small" [class.danger-text]="!isValid(sentence)">{{
                    isValid(sentence)
                      ? 'Bold target: “' +
                        sentence.text.slice(sentence.targetStart, sentence.targetEnd) +
                        '”'
                      : 'Select the exact target word or phrase in the text above.'
                  }}</span
                  ><button
                    type="button"
                    class="button small-button"
                    (click)="captureSelection(i, sentenceInput)"
                    [attr.aria-label]="'Use selected text as target in sentence ' + (i + 1)"
                  >
                    Use selection
                  </button>
                </div>
                <p class="field-hint">
                  One exact whole-word match is detected automatically. For repeated words or
                  inflected forms, select the occurrence yourself.
                </p>
                @if (isValid(sentence)) {
                  <blockquote class="sentence-preview">
                    <app-sentence [sentence]="sentence" />
                  </blockquote>
                }
                <div class="sentence-meta-fields">
                  <div>
                    <label [for]="'origin-' + i">Provenance</label
                    ><select
                      [id]="'origin-' + i"
                      [name]="'origin-' + i"
                      [(ngModel)]="sentence.origin"
                    >
                      <option value="encountered">Encountered</option>
                      <option value="generated">AI-generated</option>
                    </select>
                  </div>
                  <div>
                    <label [for]="'source-' + i">Source <span class="muted">(optional)</span></label
                    ><input
                      [id]="'source-' + i"
                      [name]="'source-' + i"
                      [(ngModel)]="sentence.source"
                      maxlength="2000"
                      placeholder="Book, article, conversation, or URL"
                    />
                  </div>
                </div>
              </div>
            }
            @if (!draft.sentences.length) {
              <p class="subtle-empty">
                No sentences yet. Word review works without them; add one to unlock context review.
              </p>
            }
            <button
              type="button"
              class="button"
              (click)="addSentence()"
              [disabled]="draft.sentences.length >= 100"
            >
              ＋ Add a sentence
            </button>
            @if (sentenceError()) {
              <p class="notice error" role="alert">{{ sentenceError() }}</p>
            }
            @if (sentencePreview().length) {
              <div class="ai-preview">
                <div class="row between">
                  <div>
                    <span class="badge honey">AI suggestions · not saved</span>
                    <h3>Suggested sentences</h3>
                  </div>
                  <button
                    type="button"
                    class="icon-button"
                    (click)="sentencePreview.set([])"
                    aria-label="Dismiss suggested sentences"
                  >
                    Dismiss
                  </button>
                </div>
                <p class="small muted">
                  Review each sentence, then append and edit as needed. Nothing is saved yet.
                </p>
                @for (sentence of sentencePreview(); track $index; let i = $index) {
                  <div class="preview-item">
                    <blockquote><app-sentence [sentence]="sentence" /></blockquote>
                    <button
                      type="button"
                      class="button small-button"
                      (click)="appendSentence(i)"
                      [disabled]="draft.sentences.length >= 100"
                    >
                      Append
                    </button>
                  </div>
                }
                <button
                  type="button"
                  class="button"
                  (click)="appendAllSentences()"
                  [disabled]="draft.sentences.length + sentencePreview().length > 100"
                >
                  Append all sentences
                </button>
              </div>
            }
          </section>
        </fieldset>
        <aside class="editor-aside">
          <div class="panel save-panel">
            <h3>Save word</h3>
            <p class="muted small">
              One word, one learning schedule. Practice the word alone or in context—both strengthen
              the same memory.
            </p>
            @if (!id) {
              <p class="small">New words are ready for review immediately.</p>
            }
            @if (saveError()) {
              <div class="notice error" role="alert">{{ saveError() }}</div>
            }
            @if (conflict()) {
              <p class="small">
                Your draft is still here. Copy any changes you want to keep before loading the
                latest saved version.
              </p>
              <button type="button" class="button full" (click)="reloadLatest()">
                Load latest version
              </button>
            }
            <button
              type="submit"
              class="button primary full"
              [disabled]="saving() || meaningBusy() || sentenceBusy()"
            >
              {{
                saving() ? 'Saving your word…' : id ? 'Save changes' : 'Add to vocabulary'
              }}</button
            ><a
              [routerLink]="id ? ['/vocabulary', id] : ['/vocabulary']"
              class="button subtle full"
              [class.disabled]="saving()"
              >Cancel</a
            >
            <p class="small muted">AI suggestions are optional. Your entries stay private.</p>
          </div>
        </aside>
      </form>
    }
  `,
})
export class WordEditorPage implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly id = this.route.snapshot.paramMap.get('id');
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly conflict = signal(false);
  readonly meaningBusy = signal(false);
  readonly sentenceBusy = signal(false);
  readonly meaningError = signal('');
  readonly sentenceError = signal('');
  readonly meaningPreview = signal<Meaning[]>([]);
  readonly sentencePreview = signal<SentenceInput[]>([]);
  readonly isValid = validSpan;
  draft: WordInput = { text: '', meanings: [{ partOfSpeech: '', definition: '' }], sentences: [] };
  private version: number | undefined;
  private baseline = JSON.stringify(this.draft);
  private saved = false;

  async ngOnInit(): Promise<void> {
    if (this.id) await this.load();
  }

  async load(): Promise<void> {
    if (!this.id) return;
    this.loading.set(true);
    this.loadError.set('');
    try {
      const { word } = await this.api.word(this.id);
      this.draft = {
        text: word.text,
        meanings: word.meanings.map((meaning) => ({ ...meaning })),
        sentences: word.sentences.map(({ text, targetStart, targetEnd, origin, source }) => ({
          text,
          targetStart,
          targetEnd,
          origin,
          source,
        })),
      };
      this.version = word.card.version;
      this.baseline = JSON.stringify(this.draft);
      this.conflict.set(false);
      this.saveError.set('');
      this.meaningPreview.set([]);
      this.sentencePreview.set([]);
    } catch (error) {
      this.loadError.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  canLeave(): boolean {
    if (this.saving() && !this.saved) return false;
    return (
      this.saved ||
      JSON.stringify(this.draft) === this.baseline ||
      window.confirm('Leave without saving your word? Your unsaved changes will be lost.')
    );
  }

  async reloadLatest(): Promise<void> {
    if (window.confirm('Replace this unsaved draft with the latest saved version?'))
      await this.load();
  }

  hasMeaning(): boolean {
    return this.draft.meanings.some(
      (meaning) => meaning.partOfSpeech.trim() && meaning.definition.trim(),
    );
  }

  addSentence(): void {
    this.draft.sentences.push({
      text: '',
      targetStart: -1,
      targetEnd: -1,
      origin: 'encountered',
      source: '',
    });
  }

  updateSentence(index: number, text: string): void {
    const sentence = this.draft.sentences[index];
    const match = inferTarget(text, this.draft.text);
    this.draft.sentences[index] = {
      ...sentence,
      text,
      targetStart: match?.start ?? -1,
      targetEnd: match?.end ?? -1,
    };
  }

  captureSelection(index: number, element: HTMLTextAreaElement): void {
    if (element.selectionEnd <= element.selectionStart) return;
    this.draft.sentences[index] = {
      ...this.draft.sentences[index],
      targetStart: element.selectionStart,
      targetEnd: element.selectionEnd,
    };
  }

  async generateMeanings(): Promise<void> {
    if (this.meaningBusy() || !this.draft.text.trim()) return;
    this.meaningBusy.set(true);
    this.meaningError.set('');
    try {
      const result = await this.api.meanings({
        text: this.draft.text.trim(),
        sentences: this.draft.sentences
          .map((sentence) => sentence.text)
          .filter((text) => text.trim()),
      });
      this.meaningPreview.set(result.meanings);
      if (!result.meanings.length)
        this.meaningError.set(
          'No meanings were returned. Try adding context or enter a meaning yourself.',
        );
    } catch (error) {
      this.meaningError.set(errorMessage(error));
    } finally {
      this.meaningBusy.set(false);
    }
  }

  async generateSentences(): Promise<void> {
    if (this.sentenceBusy() || !this.draft.text.trim() || !this.hasMeaning()) return;
    this.sentenceBusy.set(true);
    this.sentenceError.set('');
    try {
      const meanings = this.draft.meanings
        .filter((meaning) => meaning.partOfSpeech.trim() && meaning.definition.trim())
        .map((meaning) => ({
          partOfSpeech: meaning.partOfSpeech.trim(),
          definition: meaning.definition.trim(),
        }));
      const result = await this.api.sentences({ text: this.draft.text.trim(), meanings, count: 3 });
      this.sentencePreview.set(result.sentences);
      if (!result.sentences.length)
        this.sentenceError.set(
          'No sentences were returned. Try again or write an example yourself.',
        );
    } catch (error) {
      this.sentenceError.set(errorMessage(error));
    } finally {
      this.sentenceBusy.set(false);
    }
  }

  appendMeaning(index: number): void {
    if (this.draft.meanings.length >= 30) return;
    this.draft.meanings.push({ ...this.meaningPreview()[index] });
    this.meaningPreview.update((meanings) => meanings.filter((_, i) => i !== index));
  }

  appendAllMeanings(): void {
    if (this.draft.meanings.length + this.meaningPreview().length > 30) return;
    this.draft.meanings.push(...this.meaningPreview().map((meaning) => ({ ...meaning })));
    this.meaningPreview.set([]);
  }

  appendSentence(index: number): void {
    if (this.draft.sentences.length >= 100) return;
    this.draft.sentences.push({ ...this.sentencePreview()[index] });
    this.sentencePreview.update((sentences) => sentences.filter((_, i) => i !== index));
  }

  appendAllSentences(): void {
    if (this.draft.sentences.length + this.sentencePreview().length > 100) return;
    this.draft.sentences.push(...this.sentencePreview().map((sentence) => ({ ...sentence })));
    this.sentencePreview.set([]);
  }

  async save(): Promise<void> {
    if (this.saving() || this.meaningBusy() || this.sentenceBusy()) return;
    this.saveError.set('');
    this.conflict.set(false);
    if (!this.draft.text.trim()) {
      this.saveError.set('Enter the word or phrase you want to keep.');
      return;
    }
    if (
      !this.draft.meanings.length ||
      this.draft.meanings.some(
        (meaning) => !meaning.partOfSpeech.trim() || !meaning.definition.trim(),
      )
    ) {
      this.saveError.set(
        'Every meaning needs a part of speech and a definition. Add at least one complete meaning.',
      );
      return;
    }
    const invalid = this.draft.sentences.findIndex(
      (sentence) => !sentence.text.trim() || !validSpan(sentence),
    );
    if (invalid !== -1) {
      this.saveError.set(
        `Sentence ${invalid + 1} needs text and a selected target. Highlight the exact occurrence in its text area.`,
      );
      return;
    }
    this.saving.set(true);
    try {
      const body = {
        text: this.draft.text.trim(),
        meanings: this.draft.meanings.map((meaning) => ({
          partOfSpeech: meaning.partOfSpeech.trim(),
          definition: meaning.definition.trim(),
        })),
        sentences: this.draft.sentences.map((sentence) => ({
          ...sentence,
          source: sentence.source.trim(),
        })),
        ...(this.id ? { version: this.version } : {}),
      };
      const word = this.id ? await this.api.update(this.id, body) : await this.api.create(body);
      this.saved = true;
      await this.router.navigate(['/vocabulary', word.id]);
    } catch (error) {
      this.saveError.set(errorMessage(error));
      this.conflict.set(!!this.id && isConflict(error));
    } finally {
      this.saving.set(false);
    }
  }
}
