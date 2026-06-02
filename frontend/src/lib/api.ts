const API = '/api';
const API_TOKEN = (window as any).__API_TOKEN || '';

function apiHeaders(headers: Record<string, string> = {}): Record<string, string> {
  if (API_TOKEN) headers['X-API-Token'] = API_TOKEN;
  return headers;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: apiHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
  return res.json();
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
  return res.json();
}

export async function apiPut<T = any>(path: string, body: any): Promise<T> {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
  return res.json();
}

export async function apiDel(path: string): Promise<void> {
  const res = await fetch(API + path, { method: 'DELETE', headers: apiHeaders() });
  if (!res.ok) throw new Error((await res.json()).error || await res.text());
}
