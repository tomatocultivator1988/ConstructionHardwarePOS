const cache = new Map<string, { data: any; expires: number }>();
const DEFAULT_TTL = 30_000;

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache(key: string, data: any, ttl = DEFAULT_TTL): void {
  cache.set(key, { data, expires: Date.now() + ttl });
}

export function clearCache(pattern: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(pattern)) cache.delete(key);
  }
}
