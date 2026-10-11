import Link from "next/link";
import { informationPages } from "@/data/information";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner page-shell">
        <Link className="wordmark" href="/" aria-label="Rontab home">rontab<span>.</span></Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner page-shell">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="wordmark wordmark-light" href="/">rontab<span>.</span></Link>
            <p>Good things for the everyday home.</p>
          </div>
          <nav className="footer-links" aria-label="Information">
            {informationPages.map((page) => <Link href={`/${page.slug}`} key={page.slug}>{page.label}</Link>)}
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© Rontab</span>
          <span>{process.env.NODE_ENV === "development" ? "Demo catalogue · fictional products and prices" : "Independent home & kitchen finds"}</span>
        </div>
      </div>
    </footer>
  );
}