import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this app. Without it Next walks up looking for a lockfile,
  // finds ~/pnpm-lock.yaml (outside the repo) and warns on every build/dev start.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
