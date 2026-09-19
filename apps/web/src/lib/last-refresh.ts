/**
 * When the background refreshers (`RefreshOnNavigate`, `RefreshOnResume`)
 * last asked the server for fresh data, so together they do it at most once
 * per throttle window. Browser-only state: it starts at page load, when
 * everything on screen has just come from the server.
 *
 * Saves do not stamp it — they call `router.refresh()` themselves, and an
 * extra background refresh shortly after one is harmless.
 */
let lastRefreshAt = Date.now();

export function markRefreshed() {
  lastRefreshAt = Date.now();
}

export function msSinceRefresh() {
  return Date.now() - lastRefreshAt;
}
