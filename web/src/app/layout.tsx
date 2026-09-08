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
    "Name a price you would be happy to sell your ETH at. Whoever takes it pays you for the wait, and the ETH never leaves your wallet. If you already trade options: covered calls written as price curves inside 1inch Aqua, with no vault, no option token, no oracle and no keeper.",
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
