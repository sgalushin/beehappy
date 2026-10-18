import type { SentenceInput } from '@beehappy/contract';

export function validSpan(sentence: SentenceInput): boolean {
  const { text, targetStart: start, targetEnd: end } = sentence;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length ||
    !text.slice(start, end).trim()
  )
    return false;
  for (const offset of [start, end]) {
    if (
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[offset])
    )
      return false;
  }
  return true;
}

/** Return only a single, whole-token occurrence; ambiguous or inflected targets need explicit selection. */
export function inferTarget(text: string, word: string): { start: number; end: number } | null {
  if (!word.trim()) return null;
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...text.matchAll(new RegExp(`(?=(${escaped}))`, 'giu'))].filter((match) => {
    const index = match.index;
    const before = Array.from(text.slice(0, index)).at(-1) ?? '';
    const after = Array.from(text.slice(index + match[1].length))[0] ?? '';
    return !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
  });
  if (matches.length !== 1) return null;
  return { start: matches[0].index, end: matches[0].index + matches[0][1].length };
}
