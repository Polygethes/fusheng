// Deterministic pseudo-random number generator (LCG / Mulberry32 style)
// Server-side safe: strictly no dependencies on browser or stage TUI code.

export function createRng(seed = 1) {
  let s = (Math.floor(seed) >>> 0) || 1;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
