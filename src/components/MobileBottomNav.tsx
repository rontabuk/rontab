import { informationPages } from "@/data/information";
import { adminAreas } from "@/lib/admin/areas";
import { getViewer } from "@/lib/auth/viewer";
import { formatNumber } from "@/lib/format";
import { getNotificationFeed } from "@/lib/notifications/feed";
import { MobileBottomNavBar, type MobileNavConfig } from "@/components/MobileBottomNavBar";

const infoLinks = informationPages.map((page) => ({ href: `/${page.slug}`, label: page.label }));

const guestNav: MobileNavConfig = {
  label: "Visitor navigation",
  items: [
    { href: "/products", label: "Home", icon: "home", exact: true },
    { href: "/riders", label: "Riders", icon: "riders", disabled: true },
    { href: "/account", label: "Account", icon: "account", exact: true },
  ],
  menuLinks: [
    { href: "/account?mode=register&next=%2Fvisitor", label: "Create a free account" },
    { href: "/seller/register", label: "Sell on Rontab" },
    { href: "/seller/login", label: "Seller sign in" },
    ...infoLinks,
  ],
};

export async function MobileBottomNav() {
  const viewer = await getViewer();

  if (viewer.role === "visitor") {
    const feed = await getNotificationFeed();
    const unreadOfferCount = feed.items.filter((item) => {
      if (item.kind !== "loyalty-offer" || feed.readIds.includes(item.id)) return false;
      return !feed.lastSeenAt || Date.parse(item.createdAt) > Date.parse(feed.lastSeenAt);
    }).length;
    return (
      <MobileBottomNavBar
        config={{
          label: "Visitor navigation",
          items: [
            { href: "/products", label: "Home", icon: "home", exact: true },
            { href: "/riders", label: "Riders", icon: "riders", disabled: true },
            {
              href: "/visitor/rewards",
              label: "Rewards",
              icon: "rewards",
              badge: unreadOfferCount ? formatNumber(unreadOfferCount) : undefined,
              ariaLabel: unreadOfferCount ? `Rewards, ${unreadOfferCount} new offers` : "Rewards",
            },
            { href: "/visitor", label: "Account", icon: "account", exact: true },
          ],
          menuLinks: [{ href: "/seller/register", label: "Sell on Rontab" }, ...infoLinks],
          signOutTo: "/",
        }}
      />
    );
  }

  if (viewer.role === "seller") {
    return (
      <MobileBottomNavBar
        config={{
          label: "Seller navigation",
          items: [
            { href: "/products", label: "Home", icon: "home", exact: true },
            { href: "/seller/advertising", label: "Ads", icon: "ads", dot: viewer.hasNewAdCreditGrants, ariaLabel: viewer.hasNewAdCreditGrants ? "Ads, new click-credit grant" : undefined },
            { href: "/seller", label: "Add", icon: "add", exact: true, highlight: true, ariaLabel: "Add a product" },
            { href: "/seller/products", label: "Products", icon: "products" },
          ],
          menuLinks: [{ href: "/seller/profile", label: "Profile" }, ...infoLinks],
          signOutTo: "/seller/login",
        }}
      />
    );
  }

  if (viewer.role === "admin") {
    const primary = ["/admin/products", "/admin/sellers", "/admin/rewards"];
    return (
      <MobileBottomNavBar
        config={{
          label: "Admin navigation",
          items: [
            { href: "/admin", label: "Overview", icon: "overview", exact: true },
            { href: "/admin/products", label: "Review", icon: "review" },
            { href: "/admin/sellers", label: "Sellers", icon: "sellers" },
            { href: "/admin/rewards", label: "Rewards", icon: "rewards" },
          ],
          menuLinks: [
            ...adminAreas.filter((area) => !primary.includes(area.href)).map(({ href, label }) => ({ href, label })),
            { href: "/products", label: "View the catalogue" },
          ],
          signOutTo: "/admin/login",
        }}
      />
    );
  }

  return <MobileBottomNavBar config={guestNav} />;
}
