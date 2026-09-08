import path from "node:path";
import type { NextConfig } from "next";

/**
 * The diagnostics routes are opt-in, and the opt-in is at the router rather than inside the page.
 *
 * `/dev` and `/dev/theme` are debugging surfaces and `/dev/diag` is a JSON probe; none of them is
 * one of the five product screens, and all three used to appear in `next build`'s route table and
 * ship to anyone who guessed the URL. A client-side env check would not have helped — the bundle is
 * built either way. So their files are named `page.dev.tsx` / `route.dev.ts` and the `.dev.*`
 * extensions only count as routes when `DEV_ROUTES=1` is set, which is what `make web-dev-routes` does.
 * With it unset Next does not see them at all: no route, no prerender, no bundle.
 */
const DEV_ROUTE_EXTENSIONS = ["dev.tsx", "dev.ts"];
const PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this app. Without it Next walks up looking for a lockfile,
  // finds ~/pnpm-lock.yaml (outside the repo) and warns on every build/dev start.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  pageExtensions:
    process.env.DEV_ROUTES === "1" ? [...DEV_ROUTE_EXTENSIONS, ...PAGE_EXTENSIONS] : PAGE_EXTENSIONS,
};

export default nextConfig;
