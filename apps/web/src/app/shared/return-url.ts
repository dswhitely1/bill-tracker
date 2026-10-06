/**
 * Narrows a `returnUrl` query parameter to an in-application path.
 *
 * Without this, signing in from `/login?returnUrl=https://evil.example`
 * hands the visitor straight to another site immediately after they typed
 * a password — an open redirect, and a convincing one because the hop
 * happens at the exact moment they expect to be sent somewhere.
 *
 * A protocol-relative `//host` and a `/\host` are both rejected: the first
 * is a URL that merely looks like a path, and some browsers normalise the
 * backslash in the second into a slash.
 */
export function safeReturnUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value === '') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
