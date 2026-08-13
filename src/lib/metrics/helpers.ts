export function hashSymbol(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function deterministicInRange(seedStr: string, min: number, max: number): number {
  const h = hashSymbol(seedStr);
  const v = (h % 100000) / 100000;
  return min + v * (max - min);
}

export function deterministicBool(seedStr: string, p = 0.5): boolean {
  const h = hashSymbol(seedStr);
  return (h % 1000) / 1000 < p;
}
