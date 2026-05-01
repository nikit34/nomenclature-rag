export function cosineSim(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) continue;
    s += av * bv;
  }
  return s;
}

export type DenseHit = {
  index: number;
  score: number;
};

export function topKDense(
  query: Float32Array,
  vectors: Float32Array[],
  k: number,
): DenseHit[] {
  const heap: DenseHit[] = [];
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v) continue;
    const score = cosineSim(query, v);
    if (heap.length < k) {
      heap.push({ index: i, score });
      heap.sort((a, b) => a.score - b.score);
    } else if (heap[0] && score > heap[0].score) {
      heap[0] = { index: i, score };
      heap.sort((a, b) => a.score - b.score);
    }
  }
  return heap.sort((a, b) => b.score - a.score);
}
