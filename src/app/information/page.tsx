import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = { title: "Site information" };

export default function SiteInformationPage() {
  return (
    <>
      <SiteHeader />
      <main className="information-page page-shell">
        <h1>Site information</h1>
      </main>
      <SiteFooter />
    </>
  );
}