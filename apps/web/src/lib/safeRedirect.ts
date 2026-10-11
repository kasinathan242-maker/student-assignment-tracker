/**
 * Only same-origin, path-absolute redirects are honoured. Rejects protocol-relative ("//evil"),
 * backslash variants ("/\\evil", which browsers normalise to "//"), and any scheme.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.includes('\\') ||
    /^\/[a-z][a-z0-9+.-]*:/i.test(next)
  )
    return fallback;
  try {
    const url = new URL(next, 'https://placeholder.invalid');
    if (url.origin !== 'https://placeholder.invalid') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
