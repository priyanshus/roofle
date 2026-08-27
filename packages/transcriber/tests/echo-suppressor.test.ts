import assert from 'node:assert/strict';
import test from 'node:test';
import { EchoSuppressor } from '../src/pipeline/echo-suppressor';
import { AudioSource, type TimestampedAudioFrame } from '../src/types';

function makeSystemFrame(rms: number): TimestampedAudioFrame {
  // Build a float32 buffer whose RMS is approximately `rms`.
  const sampleCount = 1600;
  const data = Buffer.alloc(sampleCount * Float32Array.BYTES_PER_ELEMENT);
  const samples = new Float32Array(
    data.buffer,
    data.byteOffset,
    sampleCount
  );
  const amplitude = rms * Math.SQRT2; // RMS of a constant signal == amplitude
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = amplitude;
  }
  return {
    data,
    sampleRate: 16_000,
    channels: 1,
    format: 'float32',
    source: AudioSource.SYSTEM_AUDIO,
    captureTimestampMs: Date.now(),
    durationMs: 100,
  };
}

test('mic passes when disabled', () => {
  const suppressor = new EchoSuppressor({ enabled: false, threshold: 0.01, hangoverMs: 500 });
  suppressor.updateSystem(makeSystemFrame(0.5));
  assert.equal(suppressor.shouldPassMic(), true);
});

test('mic is suppressed while speaker is active', () => {
  const suppressor = new EchoSuppressor({ enabled: true, threshold: 0.01, hangoverMs: 500 });
  suppressor.updateSystem(makeSystemFrame(0.5));
  assert.equal(suppressor.shouldPassMic(), false);
});

test('mic passes when speaker is silent', () => {
  const suppressor = new EchoSuppressor({ enabled: true, threshold: 0.01, hangoverMs: 500 });
  suppressor.updateSystem(makeSystemFrame(0.001));
  assert.equal(suppressor.shouldPassMic(), true);
});

test('mic stays suppressed during hangover after speaker goes silent', () => {
  const suppressor = new EchoSuppressor({ enabled: true, threshold: 0.01, hangoverMs: 500 });
  suppressor.updateSystem(makeSystemFrame(0.5));
  assert.equal(suppressor.shouldPassMic(), false);
  // Speaker goes silent, but hangover has not elapsed yet.
  suppressor.updateSystem(makeSystemFrame(0.001));
  assert.equal(suppressor.shouldPassMic(), false);
});

test('mic passes after hangover elapses', () => {
  let now = 1000;
  const suppressor = new EchoSuppressor({
    enabled: true,
    threshold: 0.01,
    hangoverMs: 0,
    now: () => now,
  });
  suppressor.updateSystem(makeSystemFrame(0.5));
  assert.equal(suppressor.shouldPassMic(), false);
  // Advance the clock past the hangover, then the next check passes.
  now += 1;
  suppressor.updateSystem(makeSystemFrame(0.001));
  assert.equal(suppressor.shouldPassMic(), true);
});
