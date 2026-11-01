import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root so the unrelated ~/package-lock.json is not picked as the workspace root.
  turbopack: { root: path.resolve(import.meta.dirname) },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
