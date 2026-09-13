import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";

/* CSS order matters, and this is the order.
   `globals.css` declares the cascade-layer order (theme, base, mantine, components, utilities)
   on its first line and then pulls in Tailwind. Mantine's `styles.layer.css` variants wrap
   their own rules in `@layer mantine`, which the declaration above has already slotted between
   Tailwind's preflight and Tailwind's utilities. Importing the plain `styles.css` instead would
   put Mantine's component CSS outside every layer, where it would beat every Tailwind utility. */
import "./globals.css";
import "@mantine/core/styles.layer.css";
import "@mantine/dates/styles.layer.css";
import "@mantine/notifications/styles.layer.css";

import { Providers } from "./providers";
import { COLOR_SRGB } from "@/lib/ui/tokens";

/** Proportional family: UI, labels, prose. */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/** Monospace family: every number, address, hash, opcode and byte string. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  /* The terminal names its own instrument, so a tab reads `WETH/USDC · Strikeline` — the pair
     first, because that is what someone with nine tabs open is scanning for, and the product after
     it, because a tab with only a pair in it could be anybody's. The default carries the category
     for anything that renders without a title of its own — the not-found page — and is one string
     to change when the name does. The icon beside it is `icon.svg`, with `favicon.ico`
     redrawn from the same file by `scripts/favicon.mjs` for everything that still asks for one. */
  title: {
    default: "Koers — covered calls",
    template: "%s · Koers",
  },
  description:
    "Covered calls written as price curves inside 1inch Aqua. No vault, no option token, no oracle and no keeper: the collateral stays in the maker's wallet and several offers stand behind one balance.",
  applicationName: "Koers",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: COLOR_SRGB.bg,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /* `mantineHtmlProps` adds `data-mantine-color-scheme` and `suppressHydrationWarning`. The
       attribute is what Mantine's CSS keys its variables off, so it has to be in the server-rendered
       HTML or the first paint is unstyled; the suppression is what stops React from warning when
       ColorSchemeScript rewrites it inline before hydration. */
    <html
      lang="en"
      {...mantineHtmlProps}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before first paint. This app has one theme and it is dark, so this forces rather
            than restores: no localStorage read, no OS query, no flash. */}
        <ColorSchemeScript forceColorScheme="dark" defaultColorScheme="dark" />
      </head>
      <body className="flex min-h-full flex-col bg-bg font-sans text-body text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
