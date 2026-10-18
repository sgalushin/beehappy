import { Component, input } from '@angular/core';
import type { SentenceInput } from '@beehappy/contract';
import { validSpan } from './sentence-target';

@Component({
  selector: 'app-sentence',
  standalone: true,
  template: `@if (isValid(sentence())) {
      <span>{{ sentence().text.slice(0, sentence().targetStart) }}</span
      ><strong>{{ sentence().text.slice(sentence().targetStart, sentence().targetEnd) }}</strong
      ><span>{{ sentence().text.slice(sentence().targetEnd) }}</span>
    } @else {
      <span>{{ sentence().text }}</span>
    }`,
})
export class SentenceText {
  readonly sentence = input.required<SentenceInput>();
  readonly isValid = validSpan;
}
