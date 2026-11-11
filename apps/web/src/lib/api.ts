export type Item = Record<string, any>;
export type Actions = { action: (fn: () => Promise<unknown>, message?: string) => Promise<void>; busy: boolean; revision?: number };
export function navigate(path: string) { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }
export async function api(path: string, method = 'GET', data?: unknown) {
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Arena-Request': '1' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) dispatchEvent(new Event('session-expired')); throw new Error(result.error || '请求失败'); }
  return result;
}
export const date = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const count = (value?: number) => value == null ? '—' : value.toLocaleString('zh-CN');
