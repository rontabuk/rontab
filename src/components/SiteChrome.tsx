import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { CircleUserRound, Compass, House, Menu, Search } from "lucide-react";
import { informationPages } from "@/data/information";
import { formatNumber } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner page-shell">
        <Link className="wordmark" href="/" aria-label="Rontab home">rontab<span>.</span></Link>

        <Suspense fallback={<AccountLinksFallback />}>
          <AccountLinks />
        </Suspense>
      </div>
    </header>
  );
}

function AccountLinksFallback() {
  return (
    <HeaderActions accountHref="/account?next=%2Fvisitor" accountLabel="Sign in">
      <Link href="/seller/register">For sellers</Link>
    </HeaderActions>
  );
}

async function AccountLinks() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email_confirmed_at) return <AccountLinksFallback />;

  if (user.app_metadata?.role === "admin") {
    return (
      <HeaderActions accountHref="/admin" accountLabel="Admin workspace">
        <Link href="/seller/register">For sellers</Link>
      </HeaderActions>
    );
  }

  const { data: seller } = await supabase
    .from("seller_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (seller) {
    return (
      <HeaderActions accountHref="/seller/profile" accountLabel="Seller profile">
        <Link href="/seller">Seller workspace</Link>
        <Link href="/seller/advertising">Advertising</Link>
      </HeaderActions>
    );
  }

  const { data: points, error: pointsError } = await supabase.rpc("get_visitor_loyalty_points");

  return (
    <HeaderActions accountHref="/visitor" accountLabel="My account" points={pointsError ? null : Number(points)}>
      <Link href="/visitor/rewards">Points & rewards</Link>
      <Link href="/seller/register">For sellers</Link>
    </HeaderActions>
  );
}

function HeaderActions({
  accountHref,
  accountLabel,
  points = null,
  children,
}: {
  accountHref: string;
  accountLabel: string;
  points?: number | null;
  children: React.ReactNode;
}) {
  const menu = (
    <>
      <div className="site-menu-extras">
        <Link className="site-menu-account" href={accountHref}>{accountLabel}</Link>
      </div>
      <div className="site-menu-extras">
        {points !== null && (
          <span className="visitor-points-badge" aria-label={`${points} Rontab points`}>Points <strong>{formatNumber(points)}</strong></span>
        )}
        {children}
      </div>
    </>
  );

  return (
    <>
      <div className="header-actions">
        <details className="site-menu">
          <summary className="site-menu-trigger" aria-label="Open navigation menu" title="Menu">
            <Menu size={19} aria-hidden="true" />
            <span className="visually-hidden">Open navigation menu</span>
          </summary>
          <div className="site-menu-panel">{menu}</div>
        </details>
      </div>
      <Link className="header-account-link" href={accountHref}>
        <CircleUserRound size={18} aria-hidden="true" />
        <span>{accountLabel}</span>
        {points !== null && <strong aria-label={`${points} Rontab points`}>{formatNumber(points)}</strong>}
      </Link>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <Link href="/" aria-label="Home" title="Home"><House size={22} aria-hidden="true" /></Link>
        <details className="mobile-nav-menu">
          <summary aria-label="Open menu" title="Menu">
            <Menu size={22} aria-hidden="true" />
            <span className="visually-hidden">Open menu</span>
          </summary>
          <div className="site-menu-panel mobile-nav-menu-panel">{menu}</div>
        </details>
        <Link href="/products#product-search" aria-label="Search" title="Search"><Search size={22} aria-hidden="true" /></Link>
        <Link href="/products#discover" aria-label="Discover" title="Discover"><Compass size={22} aria-hidden="true" /></Link>
        <Link href={accountHref} aria-label={accountLabel} title={accountLabel}><CircleUserRound size={22} aria-hidden="true" /></Link>
      </nav>
    </>
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
          <span>Independent home & kitchen finds</span>
        </div>
      </div>
    </footer>
  );
}