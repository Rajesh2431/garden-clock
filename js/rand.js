// Small deterministic helpers shared by the garden and weather layers.

export function mulberry32(seed) {
  let a = Number(seed) >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] || 1;
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 || 1;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const easeOutBack = (t) => {
  const x = clamp(t, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
