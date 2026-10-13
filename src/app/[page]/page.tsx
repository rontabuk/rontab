import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { informationPages, supportEmail } from "@/data/information";

type InformationRouteProps = { params: Promise<{ page: string }> };

export function generateStaticParams() {
  return informationPages.map(({ slug }) => ({ page: slug }));
}

export async function generateMetadata({ params }: InformationRouteProps): Promise<Metadata> {
  const { page: slug } = await params;
  return { title: informationPages.find((item) => item.slug === slug)?.label ?? "Page not found" };
}

async function InformationPageContent({ params }: InformationRouteProps) {
  const { page: slug } = await params;
  const page = informationPages.find((item) => item.slug === slug);
  if (!page) notFound();

  return (
    <>
      <SiteHeader />
      <main className="information-page page-shell">
        <Link className="back-link" href="/products"><ArrowLeft size={15} aria-hidden="true" /> Back to Rontab</Link>
        <div className="information-copy">
          <p className="eyebrow">{page.eyebrow}</p>
          <h1>{page.title}</h1>
          <p className="information-intro">{page.intro}</p>
          {page.slug === "contact" && <a className="button button-dark" href={`mailto:${supportEmail}`}><Mail size={16} aria-hidden="true" /> Email support</a>}
          <div className="information-sections">
            {page.sections.map((section) => (
              <section key={section.heading}><h2>{section.heading}</h2><p>{section.body}</p></section>
            ))}
          </div>
          {page.slug === "for-sellers" && (
            <div className="seller-entry-actions">
              <Link className="button button-dark" href="/seller/register">Apply to sell <ArrowRight size={15} aria-hidden="true" /></Link>
              <Link className="text-link" href="/seller/login">Seller sign in</Link>
            </div>
          )}
          <Link className="text-link information-link" href="/products">Explore available products <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

export default function InformationRoute({ params }: InformationRouteProps) {
  return (
    <Suspense fallback={<main className="information-page page-shell" aria-busy="true" />}>
      <InformationPageContent params={params} />
    </Suspense>
  );
}