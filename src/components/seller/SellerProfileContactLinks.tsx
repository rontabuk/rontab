import "server-only";

import { Globe2, Link2, Mail, MapPin, Phone, Store } from "lucide-react";
import { SiFacebook, SiInstagram, SiTiktok, SiWhatsapp, SiX, SiYoutube } from "@icons-pack/react-simple-icons";
import { getSellerAccount } from "@/lib/seller/access";
import { sellerSocialPlatforms } from "@/lib/seller/social-links";
import { normalizeUkPostcode } from "@/lib/validation";
import { createSupabasePublicClient } from "@/lib/supabase/server";

const socialIcons = { facebook: SiFacebook, x: SiX, youtube: SiYoutube, tiktok: SiTiktok };
const contactIcons = { ...socialIcons, location: MapPin, phone: Phone, shop: Store, website: Globe2, instagram: SiInstagram, other: Link2 };
const contactLabels = { facebook: "Facebook", x: "X (Twitter)", youtube: "YouTube", tiktok: "TikTok", location: "Business location", phone: "Phone", shop: "Shop website", website: "Website", instagram: "Instagram", other: "Social profile" };

type ContactLink = { label: string; href: string; icon: typeof Mail | typeof SiInstagram; kind: string };

function ContactLinks({ links, owner }: { links: ContactLink[]; owner: boolean }) {
  if (!links.length) return null;
  return <nav className="public-shop-owner-contacts" aria-label={owner ? "Your saved contact links" : "Shop contact links"}>
    {links.map(({ label, href, icon: Icon, kind }) => <a key={`${label}-${href}`} href={href} data-contact-kind={kind} aria-label={label} title={label}
      target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}><Icon size={19} aria-hidden="true" /></a>)}
  </nav>;
}

export async function SellerProfileContactLinks({ sellerProfileId, shopUrl, publicPhone, isOwner }: {
  sellerProfileId: string;
  shopUrl: string | null;
  publicPhone: string | null;
  isOwner: boolean;
}) {
  if (!isOwner) {
    const result = await createSupabasePublicClient().rpc("get_public_seller_contact_links", { p_seller_profile_id: sellerProfileId });
    if (result.error && result.error.code !== "PGRST202") throw new Error(result.error.message);
    const entries = result.error ? [
      ...(shopUrl ? [{ kind: "shop", href: shopUrl }] : []),
      ...(publicPhone ? [{ kind: "phone", href: `tel:${publicPhone}` }] : []),
    ] : result.data ?? [];
    const links = entries.map(({ kind, href }) => {
      const key = kind in contactIcons ? kind as keyof typeof contactIcons : "other";
      let whatsapp = false;
      try { whatsapp = ["wa.me", "whatsapp.com", "www.whatsapp.com", "api.whatsapp.com", "web.whatsapp.com"].includes(new URL(href).hostname); } catch { whatsapp = false; }
      return { kind: whatsapp ? "whatsapp" : key, href, label: whatsapp ? "WhatsApp" : contactLabels[key], icon: whatsapp ? SiWhatsapp : contactIcons[key] };
    });
    return <ContactLinks links={links} owner={false} />;
  }
  const { supabase, seller } = await getSellerAccount();
  const [authResult, contactResult, socialResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("seller_contact_details").select("business_postcode,website_url,instagram_url,facebook_url,twitter_url,youtube_url,tiktok_url").eq("seller_profile_id", seller.id).maybeSingle(),
    supabase.from("member_social_links").select("platform,profile_url").eq("user_id", seller.user_id).order("position"),
  ]);
  for (const result of [authResult, contactResult, socialResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const contact = contactResult.data;
  const postcode = normalizeUkPostcode(contact?.business_postcode ?? "");
  const email = authResult.data.user?.email;
  const links = [
    ...(postcode ? [{ label: `Business location: ${postcode}`, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${postcode}, United Kingdom`)}`, icon: MapPin, kind: "location" }] : []),
    ...(email ? [{ label: "Email", href: `mailto:${email}`, icon: Mail, kind: "email" }] : []),
    ...(publicPhone ? [{ label: "Phone", href: `tel:${publicPhone}`, icon: Phone, kind: "phone" }] : []),
    ...(seller.shop_url ? [{ label: "Shop website", href: seller.shop_url, icon: Store, kind: "shop" }] : []),
    ...(contact?.website_url && contact.website_url !== seller.shop_url ? [{ label: "Website", href: contact.website_url, icon: Globe2, kind: "website" }] : []),
    ...(contact?.instagram_url ? [{ label: "Instagram", href: contact.instagram_url, icon: SiInstagram, kind: "instagram" }] : []),
    ...sellerSocialPlatforms.flatMap((platform) => contact?.[platform.field]
      ? [{ label: platform.label, href: contact[platform.field]!, icon: socialIcons[platform.kind], kind: platform.kind }] : []),
    ...(socialResult.data ?? []).flatMap((link) => {
      let url: URL;
      try { url = new URL(link.profile_url); } catch { return []; }
      if (!["https:", "http:"].includes(url.protocol)) return [];
      if ([contact?.instagram_url, contact?.website_url, seller.shop_url].includes(link.profile_url)
        || sellerSocialPlatforms.some((platform) => contact?.[platform.field] === link.profile_url)) return [];
      const whatsapp = ["wa.me", "whatsapp.com", "www.whatsapp.com", "api.whatsapp.com", "web.whatsapp.com"].includes(url.hostname);
      return [{ label: whatsapp ? "WhatsApp" : link.platform === "x" ? "X (Twitter)" : link.platform === "other" ? "Social profile" : `${link.platform[0].toUpperCase()}${link.platform.slice(1)}`,
        href: link.profile_url, icon: whatsapp ? SiWhatsapp : link.platform === "instagram" ? SiInstagram : link.platform in socialIcons ? socialIcons[link.platform as keyof typeof socialIcons] : Link2,
        kind: whatsapp ? "whatsapp" : link.platform }];
    }),
  ];
  return <ContactLinks links={links} owner />;
}