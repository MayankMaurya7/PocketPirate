import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the source-only shared workspace package so its TypeScript is
  // compiled by Next rather than requiring a separate build step.
  transpilePackages: ["@expense-tracker/shared"],

  experimental: {
    // How long the client router keeps a fully prefetched page. The nav tabs
    // other than Stats use `prefetch={true}` (NavTabs), so their pages are
    // fetched in the background on landing and a tab switch within this
    // window renders at once, with no skeleton. 300 s is Next's default,
    // written out because it is a product decision: what is shown first can
    // be this old. It does not stay old — RefreshOnNavigate refreshes in the
    // background after the switch (at most once a minute), RefreshOnResume on
    // coming back to the app, and every mutation calls router.refresh(),
    // which drops all prefetched pages and re-warms the tabs. The minimum
    // Next accepts is 30.
    //
    // `dynamic` is the same idea for a page that was opened rather than
    // prefetched (a group, Stats): Next's default of 0 re-renders it on the
    // server every time, so leaving a group and coming straight back showed
    // the skeleton again. With 300 a revisit inside five minutes renders at
    // once from the router cache, and RefreshOnNavigate brings it up to date
    // in the background exactly as it does for the tabs. Keep both numbers
    // equal to CACHE_MS in components/refresh-on-navigate.tsx.
    staleTimes: { static: 300, dynamic: 300 },
  },

  async headers() {
    return [
      {
        // The service worker must be revalidated on every check so a new
        // deploy's worker is picked up promptly (browsers cap this at 24h
        // anyway; this removes even that).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
