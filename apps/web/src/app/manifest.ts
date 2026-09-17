import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest (Next adds the
 * `<link rel="manifest">` for this file convention automatically).
 *
 * `theme_color` is the brand emerald: it colours the splash screen and the
 * installed app's title bar before the page has loaded. Once loaded, the
 * page's own `theme-color` meta tags (see `viewport` in layout.tsx) take
 * over and follow the header — white in light mode, zinc-900 in dark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PocketPirate",
    short_name: "PocketPirate",
    description: "Track expenses solo or with your flatmates.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en",
    categories: ["finance", "productivity"],
    background_color: "#fafafa",
    theme_color: "#059669",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
