/**
 * Validates a "where to go next" value taken from a query string. Only a
 * relative path on this site passes (`/join/abc`, `/groups/1?x=y`); anything
 * that could send the browser elsewhere — absolute URLs, protocol-relative
 * `//evil.example`, bare words — is rejected so `next` can never be an open
 * redirect. Used by the auth callback and the login page.
 */
export function safeRelativePath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  // Backslashes are treated as slashes by some browsers ("/\evil.example").
  if (value.includes("\\")) {
    return null;
  }
  return value;
}
