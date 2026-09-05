import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the source-only shared workspace package so its TypeScript is
  // compiled by Next rather than requiring a separate build step.
  transpilePackages: ["@expense-tracker/shared"],

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
