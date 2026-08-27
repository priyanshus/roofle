import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedAudioQueue } from '../src/pipeline/bounded-audio-queue';
import type { AudioFrame } from '../src/types';

function makeFrame(bytes: number, captureTimestampMs: number): AudioFrame {
  return {
    data: Buffer.alloc(bytes),
    sampleRate: 48_000,
    channels: 2,
    format: 'float32',
    captureTimestampMs,
  };
}

test('queue drops oldest when full', async () => {
  const queue = new BoundedAudioQueue(10);

  queue.push(makeFrame(6, 1));
  queue.push(makeFrame(6, 2));

  assert.equal(queue.droppedCount(), 1);

  const first = await queue.pop();
  assert.equal(first?.captureTimestampMs, 2);
});
