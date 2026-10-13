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

export const metadata: Metadata = {
  title: {
    default: "Rontab | Good things, well found",
    template: "%s | Rontab",
  },
  description:
    "A considered edit of useful, characterful finds for the everyday home.",
  appleWebApp: { capable: true, title: "Ron.Tab", statusBarStyle: "default" },
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
        <InstallPrompt />
      </body>
    </html>
  );
}
