import type { NextConfig } from "next";
import path from "node:path";

const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@releasedesk/core", "@releasedesk/lead"],
  serverExternalPackages: [],
  // Keep workspace packages resolving from the monorepo root.
  outputFileTracingRoot: monorepoRoot,
};

export default nextConfig;
