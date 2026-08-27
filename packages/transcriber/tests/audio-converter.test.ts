import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioConverter } from '../src/pipeline/audio-converter';
import type { AudioFrame } from '../src/types';

function sineStereoFloat32(frameCount: number, sampleRate: number): Buffer {
  const out = new Float32Array(frameCount * 2);

  for (let i = 0; i < frameCount; i += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.2;
    out[i * 2] = sample;
    out[i * 2 + 1] = sample;
  }

  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

test('converter outputs pcm16 mono and downsamples to 16kHz', async () => {
  const converter = new AudioConverter(16_000, 1);

  const frameCount = 4_800; // 100ms at 48k
  const frame: AudioFrame = {
    data: sineStereoFloat32(frameCount, 48_000),
    sampleRate: 48_000,
    channels: 2,
    format: 'float32',
    captureTimestampMs: Date.now(),
  };

  const output = await converter.convert(frame);
  converter.dispose();

  const outputSamples = output.byteLength / 2;
  assert.ok(outputSamples >= 1500 && outputSamples <= 1700);
});
