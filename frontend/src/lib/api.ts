const API = '/api';
const CACHE_TTL = 30000;

const cache = new Map<string, { data: any; ts: number }>();

function invalidatePattern(pattern: string) {
  for (const key of cache.keys()) {
    if (key.startsWith('/' + pattern) || key.startsWith(pattern)) cache.delete(key);
  }
}

function apiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('buildpro_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function handleResponse(res: Response) {
  if (res.status === 401) {
    localStorage.removeItem('buildpro_token');
    localStorage.removeItem('buildpro_user');
    (window as any).showLogin?.();
    throw new Error('Session expired. Please login again.');
  }
  if (res.status === 403) {
    throw new Error('Access denied. Admin only.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || 'Request failed');
  }
  return res;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let transientResponse = false;
    try {
      const res = await fetch(API + path, { headers: apiHeaders() });
      transientResponse = [500, 502, 503, 504].includes(res.status);
      if (transientResponse && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      await handleResponse(res);
      const data = await res.json();
      cache.set(path, { data, ts: Date.now() });
      return data;
    } catch (e: any) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (!transientResponse && !/failed to fetch|networkerror|network error/i.test(lastError.message)) throw lastError;
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError || new Error('Request failed');
}

async function mutate(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(API + path, {
    method,
    headers: apiHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  await handleResponse(res);
  invalidatePattern(path.split('/')[1]);
  return res.status !== 204 ? res.json() : undefined;
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  return mutate('POST', path, body);
}

export async function apiPut<T = any>(path: string, body: any): Promise<T> {
  return mutate('PUT', path, body);
}

export async function apiDel(path: string): Promise<void> {
  await mutate('DELETE', path);
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem('buildpro_token');
}

export function getCurrentUser(): { id: string; username: string; role: string } | null {
  const u = localStorage.getItem('buildpro_user');
  return u ? JSON.parse(u) : null;
}

export function isAdmin(): boolean {
  return getCurrentUser()?.role === 'admin';
}
