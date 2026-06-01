/** Extract a user-visible message from an Angular HttpClient error. */
export function httpErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { error?: { message?: string | string[] } })?.error;
  const m = body?.message;
  if (Array.isArray(m) && m.length) return String(m[0]);
  if (typeof m === 'string' && m.length) return m;
  return fallback;
}
