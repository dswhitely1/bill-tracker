import { describe, expect, it } from 'vitest';
import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('accepts an absolute path within the application', () => {
    expect(safeReturnUrl('/bills/abc-123', '/upcoming')).toBe('/bills/abc-123');
  });

  it('keeps a query string', () => {
    expect(safeReturnUrl('/bills?isActive=true', '/upcoming')).toBe('/bills?isActive=true');
  });

  it('does not touch an interior space in a query string', () => {
    // The leading-control-character trim is anchored with "^"; it must
    // never reach past the start of the string.
    expect(safeReturnUrl('/bills?q=a b', '/upcoming')).toBe('/bills?q=a b');
  });

  it('rejects a protocol-relative URL, which would leave the site', () => {
    // "//evil.example" is a URL, not a path. Navigating to it after a
    // successful sign-in is an open redirect.
    expect(safeReturnUrl('//evil.example/phish', '/upcoming')).toBe('/upcoming');
  });

  it('rejects an absolute URL', () => {
    expect(safeReturnUrl('https://evil.example', '/upcoming')).toBe('/upcoming');
  });

  it('rejects a backslash-prefixed path, which some browsers normalise to a slash', () => {
    expect(safeReturnUrl('/\\evil.example', '/upcoming')).toBe('/upcoming');
  });

  it('rejects a relative path', () => {
    expect(safeReturnUrl('bills', '/upcoming')).toBe('/upcoming');
  });

  it('falls back for null, undefined, an array, and the empty string', () => {
    expect(safeReturnUrl(null, '/upcoming')).toBe('/upcoming');
    expect(safeReturnUrl(undefined, '/upcoming')).toBe('/upcoming');
    expect(safeReturnUrl(['/bills'], '/upcoming')).toBe('/upcoming');
    expect(safeReturnUrl('', '/upcoming')).toBe('/upcoming');
  });

  it.each([
    ['/\t/evil.example', 'a tab'],
    ['/\n/evil.example', 'a newline'],
    ['/\r/evil.example', 'a carriage return'],
  ])('rejects %j, where %s splits a protocol-relative URL', (value) => {
    // URL parsing removes the control character, so the browser resolves
    // this to //evil.example even though it does not start with "//".
    expect(safeReturnUrl(value, '/upcoming')).toBe('/upcoming');
  });

  it('rejects an absolute URL hidden behind leading whitespace', () => {
    expect(safeReturnUrl('  https://evil.example', '/upcoming')).toBe('/upcoming');
  });

  it('returns the normalised path, not the raw input', () => {
    // Whatever is returned is what gets navigated to, so it must be the
    // same string that was validated.
    expect(safeReturnUrl('/bi\tlls', '/upcoming')).toBe('/bills');
  });

  it.each([
    ['\u0000//evil.example', 'a NUL'],
    ['\u0001//evil.example', 'a C0 control'],
    ['\u001f//evil.example', 'the last C0 control'],
  ])('rejects %j, prefixed by %s', (value) => {
    // These fail safe via the startsWith('/') check, not the leading-
    // control-character trim: none of them starts with "/" even before
    // trimming, so this does not by itself prove the trim works. It pins
    // the outcome; the corrected character class above is what makes
    // the claim in that comment true.
    expect(safeReturnUrl(value, '/upcoming')).toBe('/upcoming');
  });
});
