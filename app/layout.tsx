import type { Metadata, Viewport } from "next";
import { Chakra_Petch } from "next/font/google";
import "./globals.css";

// Self-hosted at build time; the Vietnamese subset renders "Tam Thái Tử" and
// player names with stacked diacritics correctly on every OS.
const chakraPetch = Chakra_Petch({
  weight: ["600", "700"],
  style: ["normal", "italic"],
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-chakra",
});

export const metadata: Metadata = {
  title: "Tam Thái Tử",
  description: "A brutally fast neon endless runner. Die. Retry. One more run.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#05010f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={chakraPetch.variable}>
      <body className="bg-void text-white antialiased">{children}</body>
    </html>
  );
}
