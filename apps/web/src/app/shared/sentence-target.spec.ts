import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SentenceInput } from '@beehappy/contract';
import { inferTarget, validSpan } from './sentence-target';

test('unambiguous case-insensitive targets preserve UTF-16 offsets after astral characters', () => {
  const text = '𝄞 The WORD belongs here.';
  const target = inferTarget(text, 'word');
  assert.deepEqual(target, { start: 7, end: 11 });
  assert.equal(text.slice(target!.start, target!.end), 'WORD');
});

test('repeated, embedded, and inflected occurrences require explicit selection', () => {
  assert.equal(inferTarget('Word after word.', 'word'), null);
  assert.equal(inferTarget('a a a', 'a a'), null);
  assert.equal(inferTarget('The wording is clear.', 'word'), null);
  assert.equal(inferTarget('She ran home.', 'run'), null);
  assert.equal(inferTarget('éword wordé', 'word'), null);
  assert.equal(inferTarget('There is nothing to select.', '  '), null);
});

test('literal phrases and regular-expression punctuation are matched safely', () => {
  assert.deepEqual(inferTarget('An a+b example.', 'a+b'), { start: 3, end: 6 });
  assert.deepEqual(inferTarget('We take it for granted.', 'for granted'), { start: 11, end: 22 });
});

test('a manually selected inflection or repeated occurrence remains valid', () => {
  const sentence: SentenceInput = {
    text: 'She ran, then ran again.',
    targetStart: 14,
    targetEnd: 17,
    origin: 'encountered',
    source: '',
  };
  assert.equal(validSpan(sentence), true);
  assert.equal(sentence.text.slice(sentence.targetStart, sentence.targetEnd), 'ran');
});

test('invalid offsets, empty selections, whitespace, and split surrogate pairs are rejected', () => {
  const sentence: SentenceInput = {
    text: '𝄞 word',
    targetStart: 3,
    targetEnd: 7,
    origin: 'encountered',
    source: '',
  };
  assert.equal(validSpan(sentence), true);
  for (const [targetStart, targetEnd] of [
    [-1, 2],
    [0, 0],
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 99],
    [3.5, 5],
    [Number.NaN, 5],
  ]) {
    assert.equal(
      validSpan({ ...sentence, targetStart, targetEnd }),
      false,
      `span ${targetStart}:${targetEnd}`,
    );
  }
  assert.equal(validSpan({ ...sentence, targetStart: 0, targetEnd: 2 }), true);
});
