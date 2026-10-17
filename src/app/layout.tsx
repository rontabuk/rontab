import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import { InstallPrompt } from "@/components/InstallPrompt";
import { MobileBottomNav } from "@/components/MobileBottomNav";
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

const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const metadataBase = process.env.NEXT_PUBLIC_SITE_URL
  ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
  : new URL(deploymentHost ? `https://${deploymentHost}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "RonTab | Good things, well found",
    template: "%s | RonTab",
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
  themeColor: "#f5f2eb",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerifDisplay.variable}`} data-scroll-behavior="smooth">
      <body>
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
