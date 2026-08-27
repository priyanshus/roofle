import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioChunker } from '../src/pipeline/audio-chunker';

test('chunker emits fixed-size chunks and preserves remainder', () => {
  const chunker = new AudioChunker(4);

  const first = chunker.push(Buffer.from([1, 2, 3]));
  assert.equal(first.length, 0);

  const second = chunker.push(Buffer.from([4, 5, 6, 7, 8]));
  assert.equal(second.length, 2);
  assert.deepEqual(Array.from(second[0]), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(second[1]), [5, 6, 7, 8]);

  const remainder = chunker.flushRemainder();
  assert.equal(remainder, null);
});
