import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
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
  title: {
    default: "Aqua Terminal",
    template: "%s · Aqua Terminal",
  },
  description:
    "Ship, watch and dock self-custodial liquidity positions on 1inch Aqua. Strategies compile to SwapVM programs and tokens stay in your wallet until a trade pulls them.",
  applicationName: "Aqua Terminal",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: COLOR_SRGB.bg,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-body text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
