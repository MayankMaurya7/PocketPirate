import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the source-only shared workspace package so its TypeScript is
  // compiled by Next rather than requiring a separate build step.
  transpilePackages: ["@expense-tracker/shared"],
};

export default nextConfig;
