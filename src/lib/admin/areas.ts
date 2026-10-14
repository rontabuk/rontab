export const adminAreas = [
  { href: "/admin/products", label: "Product review", description: "Review submissions and feature approved products." },
  { href: "/admin/sellers", label: "Sellers", description: "Approve shops, control visibility, and grant click credits." },
  { href: "/admin/seller-offers", label: "Offer review", description: "Review seller promotions, set points and daily quotas, and publish approved offers." },
  { href: "/admin/support", label: "Support cases", description: "Review product, seller, reward, and voucher reports." },
  { href: "/admin/visitors", label: "Visitors", description: "Review registered visitors and suspend or restore access." },
  { href: "/admin/rewards", label: "Loyalty & rewards", description: "Create offers, run draws, and record gift fulfilment." },
  { href: "/admin/categories", label: "Categories", description: "Organise the product discovery taxonomy." },
  { href: "/admin/video-ads", label: "Video ads", description: "Videos and images rotating in the banner above the catalogue." },
  { href: "/admin/notifications", label: "Notifications", description: "Send announcements to the bell for visitors, sellers, or everyone." },
  { href: "/admin/settings", label: "Settings", description: "Approval rules, Featured and New windows, and click value." },
  { href: "/admin/audit-log", label: "Audit log", description: "Review sensitive administrative activity recorded by the database." },
] as const;

export const plannedAdminAreas = [
  { label: "Plans & billing", description: "Seller plans and subscriptions, once a payment provider is connected." },
] as const;
