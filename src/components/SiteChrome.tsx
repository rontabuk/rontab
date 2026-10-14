import Link from "next/link";
import { Suspense } from "react";
import { CircleUserRound, Menu } from "lucide-react";
import { DismissibleDetails } from "@/components/DismissibleDetails";
import { NotificationBell } from "@/components/NotificationBell";
import { informationPages } from "@/data/information";
import { getViewer } from "@/lib/auth/viewer";
import { formatNumber } from "@/lib/format";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner page-shell">
        <Link className="wordmark" href="/products" aria-label="Rontab products">rontab<span>.</span></Link>

        <Suspense fallback={<AccountLinksFallback />}>
          <AccountLinks />
        </Suspense>
      </div>
    </header>
  );
}

function AccountLinksFallback({ bell = null }: { bell?: React.ReactNode }) {
  return (
    <HeaderActions accountHref="/account?next=%2Fvisitor" accountLabel="Sign in" bell={bell}>
      <Link href="/account?mode=register&next=%2Fvisitor">Create an account</Link>
      <Link href="/seller/register">For sellers</Link>
    </HeaderActions>
  );
}

async function AccountLinks() {
  const viewer = await getViewer();
  const bell = <NotificationBell />;

  if (viewer.role === "admin") {
    return (
      <HeaderActions accountHref="/admin" accountLabel="Admin workspace" bell={bell}>
        <Link href="/seller/register">For sellers</Link>
      </HeaderActions>
    );
  }

  if (viewer.role === "seller") {
    return (
      <HeaderActions accountHref="/seller/profile" accountLabel="Seller profile" bell={bell}>
        <Link href="/seller">Seller workspace</Link>
        <Link href="/seller/advertising">Advertising</Link>
        <Link href="/seller/offers">Offer requests</Link>
      </HeaderActions>
    );
  }

  if (viewer.role === "visitor") {
    return (
      <HeaderActions accountHref="/visitor" accountLabel="My account" points={viewer.points} bell={bell}>
        <Link href="/visitor/offers">Offer gallery</Link>
        <Link href="/visitor/rewards">Points & rewards</Link>
        <Link href="/seller/register">For sellers</Link>
      </HeaderActions>
    );
  }

  return <AccountLinksFallback bell={bell} />;
}

function HeaderActions({
  accountHref,
  accountLabel,
  points = null,
  bell,
  children,
}: {
  accountHref: string;
  accountLabel: string;
  points?: number | null;
  bell: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="header-actions">
        <DismissibleDetails className="site-menu">
          <summary className="site-menu-trigger" aria-label="Open navigation menu" title="Menu">
            <Menu size={19} aria-hidden="true" />
            <span className="visually-hidden">Open navigation menu</span>
          </summary>
          <div className="site-menu-panel">
            <div className="site-menu-extras">
              <Link className="site-menu-account" href={accountHref}>{accountLabel}</Link>
            </div>
            <div className="site-menu-extras">
              {points !== null && (
                <span className="visitor-points-badge" aria-label={`${points} Rontab points`}>Points <strong>{formatNumber(points)}</strong></span>
              )}
              {children}
            </div>
          </div>
        </DismissibleDetails>
        {bell}
      </div>
      <div className="header-end">
        <Link className="header-account-link" href={accountHref}>
          <CircleUserRound size={18} aria-hidden="true" />
          <span>{accountLabel}</span>
          {points !== null && <strong aria-label={`${points} Rontab points`}>{formatNumber(points)}</strong>}
        </Link>
      </div>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner page-shell">
        <div className="footer-top">
          <div className="footer-brand">
            <Link className="wordmark wordmark-light" href="/products">rontab<span>.</span></Link>
            <p>Good things for the everyday home.</p>
          </div>
          <nav className="footer-links" aria-label="Information">
            {informationPages.map((page) => <Link href={`/${page.slug}`} key={page.slug}>{page.label}</Link>)}
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© Rontab</span>
          <span>Independent home & kitchen finds</span>
        </div>
      </div>
    </footer>
  );
}