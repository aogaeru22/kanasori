import test from 'node:test';
import assert from 'node:assert/strict';
import { createSilenceDetector } from '../js/silence-monitor.js';

test('waits for speech, tolerates short pauses, stops at two seconds of silence', () => {
  const detect = createSilenceDetector();
  assert.equal(detect(0, 0), false);
  assert.equal(detect(0.002, 10000), false); // Initial silence and low background noise.
  assert.equal(detect(0.08, 10100), false);
  assert.equal(detect(0.001, 12099), false);
  assert.equal(detect(0.001, 12100), true);
});
test('resuming speech resets the silence clock and a new attempt starts fresh', () => {
  const detect = createSilenceDetector();
  assert.equal(detect(0.08, 0), false);
  assert.equal(detect(0, 1900), false);
  assert.equal(detect(0.05, 1950), false);
  assert.equal(detect(0, 3949), false);
  assert.equal(detect(0, 3950), true);
  assert.equal(createSilenceDetector()(0, 100000), false);
});
