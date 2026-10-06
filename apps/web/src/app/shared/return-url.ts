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

  // URL parsing strips tab, LF and CR from anywhere in a URL and trims
  // leading C0 controls and spaces, so "/\t/evil.example" is parsed as
  // "//evil.example" — a protocol-relative URL that the prefix checks
  // below would otherwise have let through. Normalise to the string a
  // browser would actually resolve, validate that, and return that:
  // validating one string and returning another is its own bypass.
  const url = value.replace(/[\t\n\r]/g, '').replace(/^[ - ]+/, '');

  if (url === '' || !url.startsWith('/')) return fallback;
  if (url.startsWith('//') || url.startsWith('/\\')) return fallback;
  return url;
}
