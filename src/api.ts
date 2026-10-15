let csrfToken = '';
export function setCsrfToken(token: string) { csrfToken = token; }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  let response: Response;
  try {
    response = await fetch(`/api${url}`, { ...options, headers, credentials: 'same-origin' });
  } catch {
    throw new Error('Der Server ist nicht erreichbar. Bitte prüfe die Verbindung und versuche es erneut.');
  }
  if (!response.ok) {
    const data: { error?: string } = await response.json().catch(() => ({}));
    if (response.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.error ?? `Anfrage fehlgeschlagen (${response.status}).`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const money = (cents: number) => `${(cents / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
export const date = (value: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('de-DE') : 'Nicht angegeben';
export const timestamp = (value: string) => new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
export const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
