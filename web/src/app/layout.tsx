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
    default: "Strikeline",
    template: "%s · Strikeline",
  },
  description:
    "A covered call written as a price curve, living in your own wallet. Strikeline compiles an option ladder to 1inch SwapVM programs on Aqua: no vault, no option token, no oracle, no keeper. The tokens never move until a fill.",
  applicationName: "Strikeline",
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
