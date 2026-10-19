import { adminAreas } from "@/lib/admin/areas";
import { getViewer } from "@/lib/auth/viewer";
import { formatNumber } from "@/lib/format";
import { getNotificationFeed } from "@/lib/notifications/feed";
import { getCreatorWorkspaceLabel } from "@/lib/creator/workspace";
import { MobileBottomNavBar, type MobileNavConfig } from "@/components/MobileBottomNavBar";

const guestNav: MobileNavConfig = {
  label: "Main navigation",
  items: [
    { href: "/products", label: "Home", icon: "home", exact: true },
    { href: "/creators", label: "Creators", icon: "creators" },
    { href: "/notifications", label: "Inbox", icon: "inbox" },
  ],
  menuLinks: [
    { href: "/account?next=%2Fvisitor", label: "Sign in" },
    { href: "/account?mode=register&next=%2Fvisitor", label: "Create a free account" },
    { href: "/seller/register", label: "Open your shop" },
  ],
};

export async function MobileBottomNav() {
  const viewer = await getViewer();
  const feed = await getNotificationFeed();

  if (viewer.role === "visitor") {
    const unreadOfferCount = feed.items.filter((item) => {
      if (item.kind !== "loyalty-offer" || feed.readIds.includes(item.id)) return false;
      return !feed.lastSeenAt || Date.parse(item.createdAt) > Date.parse(feed.lastSeenAt);
    }).length;
    const creatorIsPublic = viewer.creatorProfileIsPublic;
    const creatorLabel = getCreatorWorkspaceLabel(viewer.creatorProfileStatus, creatorIsPublic);
    return (
      <MobileBottomNavBar
        notifications={feed}
        config={{
          label: "Account navigation",
          account: { href: "/visitor", displayName: viewer.displayName, avatarUrl: viewer.avatarUrl, label: "My account" },
          items: [
            { href: "/products", label: "Home", icon: "home", exact: true },
            { href: "/visitor/offers", label: "Offers", icon: "ticket" },
            {
              href: "/visitor/rewards",
              label: "Rewards",
              icon: "rewards",
              badge: unreadOfferCount ? formatNumber(unreadOfferCount) : undefined,
              ariaLabel: unreadOfferCount ? `Rewards, ${unreadOfferCount} new offers` : "Rewards",
            },
            { href: "/notifications", label: "Inbox", icon: "inbox" },
          ],
          menuLinks: [
            { href: "/visitor", label: "My account" },
            { href: "/visitor/creator", label: creatorLabel },
            { href: "/visitor/creator/opportunities", label: "Creator opportunities" },
            { href: "/visitor/fans", label: "I'm a fan of" },
            { href: "/visitor/shops-following", label: "Shops I follow" },
            { href: "/visitor/offers?view=vouchers", label: "My vouchers" },
            { href: "/seller/register", label: "Open your shop" },
          ],
          signOutTo: "/",
        }}
      />
    );
  }

  if (viewer.role === "seller") {
    return (
      <MobileBottomNavBar
        notifications={feed}
        config={{
          label: "Seller navigation",
          account: { href: "/seller/profile", displayName: viewer.displayName, avatarUrl: viewer.avatarUrl, label: "Seller profile" },
          items: [
            { href: "/products", label: "Home", icon: "home", exact: true },
            { href: "/seller/advertising", label: "Ads", icon: "ads", dot: viewer.hasNewAdCreditGrants, ariaLabel: viewer.hasNewAdCreditGrants ? "Ads, new click-credit grant" : undefined },
            { href: "/seller", label: "Add", icon: "add", exact: true, highlight: true, ariaLabel: "Add a product" },
            { href: "/notifications", label: "Inbox", icon: "inbox" },
          ],
          menuLinks: [{ href: "/seller/products", label: "Products" }, { href: "/seller/offers", label: "Offer requests" }, { href: "/seller/profile", label: "Profile" }],
          signOutTo: "/seller/login",
        }}
      />
    );
  }

  if (viewer.role === "admin") {
    const primary = ["/admin/products", "/admin/sellers"];
    return (
      <MobileBottomNavBar
        notifications={feed}
        config={{
          label: "Admin navigation",
          items: [
            { href: "/admin", label: "Overview", icon: "overview", exact: true },
            { href: "/admin/products", label: "Review", icon: "review" },
            { href: "/admin/sellers", label: "Sellers", icon: "sellers" },
            { href: "/notifications", label: "Inbox", icon: "inbox" },
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

  return <MobileBottomNavBar config={guestNav} notifications={feed} />;
}
