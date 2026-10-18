import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:9860';
const headers = { 'Content-Type': 'application/json' };
if (process.env.SMOKE_TOKEN) headers.Authorization = `Bearer ${process.env.SMOKE_TOKEN}`;
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
const suffix = randomUUID().slice(0, 8);
const text = `fortitude ${suffix}`;
const sentence = `📖 She showed ${text} during the difficult negotiations.`;
const start = sentence.indexOf(text);
const input = {
  text,
  meanings: [{ partOfSpeech: 'noun', definition: 'Courage in the face of pain or adversity.' }],
  sentences: [
    {
      text: sentence,
      targetStart: start,
      targetEnd: start + text.length,
      origin: 'encountered',
      source: 'Disposable integration scenario',
    },
  ],
};
const baseline = await request('/stats?timeZone=America%2FLos_Angeles');
let id;
try {
  const word = await request('/words', 'POST', input, 201);
  id = word.id;
  assert.equal(
    word.sentences[0].text.slice(word.sentences[0].targetStart, word.sentences[0].targetEnd),
    text,
    'Unicode sentence selection must survive persistence',
  );
  await request('/words', 'POST', { ...input, text: text.toUpperCase() }, 409);
  const updated = await request(`/words/${id}`, 'PUT', {
    ...input,
    meanings: [
      ...input.meanings,
      {
        partOfSpeech: 'noun',
        definition: 'Mental and emotional strength when confronting difficulty.',
      },
    ],
    version: word.card.version,
  });
  assert.equal(updated.meanings.length, 2, 'Adding a meaning preserves the word identity');
  assert.equal(updated.card.reps, 0, 'Editing must not fabricate reviews');
  await request(`/words/${id}`, 'PUT', { ...input, version: word.card.version }, 409);
  const eventId = randomUUID();
  const grade = { eventId, mode: 'context', rating: 'good', version: updated.card.version };
  const applied = await request(`/words/${id}/reviews`, 'POST', grade);
  assert.equal(applied.status, 'applied');
  assert.equal(applied.word.card.reps, 1);
  assert.ok(
    applied.word.card.due > applied.word.card.lastReview,
    'A successful review must schedule the next review',
  );
  const duplicate = await request(`/words/${id}/reviews`, 'POST', grade);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.word.card.reps, 1, 'Network retry must not double-grade');
  await request(`/words/${id}/reviews`, 'POST', { ...grade, mode: 'word' }, 409);
  await request(`/words/${id}/reviews`, 'POST', { ...grade, eventId: randomUUID() }, 409);
  const detail = await request(`/words/${id}`);
  assert.equal(detail.history.length, 1);
  assert.equal(detail.history[0].mode, 'context');
  const queue = await request('/review?mode=word&limit=100');
  assert.ok(
    !queue.words.some((entry) => entry.id === id),
    'A context review must also reschedule the word-only card',
  );
  const stats = await request('/stats?timeZone=America%2FLos_Angeles');
  assert.equal(
    stats.reviews,
    baseline.reviews + 1,
    'Retries and stale grades must not inflate statistics',
  );
  assert.equal(stats.correctReviews, baseline.correctReviews + 1);
  if (process.env.SMOKE_AI === '1') {
    const meanings = await request('/ai/meanings', 'POST', {
      text: 'fortitude',
      sentences: ['She showed fortitude throughout the negotiations.'],
    });
    assert.ok(
      meanings.meanings.some((meaning) =>
        /courage|strength|adversity|resilien/i.test(meaning.definition),
      ),
      'Generated meanings must explain the requested word',
    );
    const examples = await request('/ai/sentences', 'POST', {
      text: 'fortitude',
      meanings: meanings.meanings,
      count: 2,
    });
    assert.equal(examples.sentences.length, 2);
    for (const example of examples.sentences)
      assert.match(
        example.text.slice(example.targetStart, example.targetEnd),
        /fortitude/i,
        'AI output must identify the exact target occurrence',
      );
    console.log('Real Sonnet meaning and sentence generation passed.');
  }
  console.log(
    'Passed: Unicode spans, multiple meanings, duplicate words, stale edits, atomic grading, duplicate/conflicting/stale events, shared scheduling, and statistics.',
  );
} finally {
  if (id) await request(`/words/${id}`, 'DELETE', undefined, 204);
}
