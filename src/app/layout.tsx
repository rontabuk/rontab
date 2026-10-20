import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import { BetaBanner } from "@/components/BetaBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: "Discover products",
    template: "%s",
  },
  description:
    "A considered edit of useful, characterful finds for the everyday home.",
  appleWebApp: { capable: true, title: "RonTab", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-48.svg", sizes: "48x48", type: "image/svg+xml" },
      { url: "/brand/favicon-32.svg", sizes: "32x32", type: "image/svg+xml" },
      { url: "/brand/favicon-16.svg", sizes: "16x16", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#eef2f3",
  // Without "cover", iOS reports env(safe-area-inset-*) as 0 and the home indicator overlaps the bottom nav.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerifDisplay.variable}`} data-scroll-behavior="smooth">
      <body>
        <BetaBanner />
        {children}
        <Suspense fallback={null}>
          <MobileBottomNav />
        </Suspense>
        <Suspense fallback={null}>
          <InstallPrompt />
        </Suspense>
      </body>
    </html>
  );
}
