import { describe, expect, it } from 'vitest';
import { cosineSim, topKDense } from './vector.js';

describe('cosineSim', () => {
  it('returns 1 for identical normalized vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSim(a, a)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSim(a, b)).toBe(0);
  });

  it('handles different lengths by truncating to min', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0]);
    expect(cosineSim(a, b)).toBe(1);
  });
});

describe('topKDense', () => {
  it('returns top-K sorted by score descending', () => {
    const q = new Float32Array([1, 0]);
    const docs = [
      new Float32Array([1, 0]),
      new Float32Array([0, 1]),
      new Float32Array([0.7, 0.7]),
      new Float32Array([0.9, 0.4]),
    ];
    const out = topKDense(q, docs, 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.index).toBe(0);
    expect(out[0]?.score).toBeCloseTo(1, 5);
    expect(out[1]?.index).toBe(3);
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it('handles K larger than vector pool', () => {
    const q = new Float32Array([1, 0]);
    const docs = [new Float32Array([1, 0])];
    const out = topKDense(q, docs, 5);
    expect(out).toHaveLength(1);
  });
});
