import type { Metadata } from "next";
import Image from "next/image";
import { ArrowUpRight, Globe2, MapPin, Phone, Store } from "lucide-react";
import { connection } from "next/server";
import { saveSellerProfile, sendSellerPhoneConfirmation } from "@/app/seller/(protected)/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProfileImageUpload } from "@/components/ProfileImageUpload";
import { CityPicker } from "@/components/CityPicker";
import { ProductCard } from "@/components/ProductCard";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { SellerProfileEditButton } from "@/components/seller/SellerProfileEditButton";
import { formatDate, formatNumber } from "@/lib/format";
import { getSavedCity, getSupportedLocations } from "@/lib/locations";
import { getSellerAccount } from "@/lib/seller/access";
import { getPublicCatalog } from "@/lib/supabase/catalog";

export const metadata: Metadata = { title: "Seller profile", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; verificationSent?: string; phoneConfirmed?: string; verificationError?: string }>;
}) {
  await connection();
  const { saved, verificationSent, phoneConfirmed, verificationError } = await searchParams;
  const { supabase, seller } = await getSellerAccount();
  const [{ data: authResult, error: authError }, { data: contact, error: contactError }, { data: shopFollowerCount, error: followerCountError }, { countries, cities }, savedCity, { data: publicPhone, error: publicPhoneError }, { data: badges, error: badgesError }, catalog] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("seller_contact_details")
      .select("contact_name,phone,phone_contact_confirmed_at,phone_visibility,website_url,instagram_url,business_address")
      .eq("seller_profile_id", seller.id)
      .maybeSingle(),
    supabase.rpc("seller_get_shop_follower_count"),
    getSupportedLocations(),
    getSavedCity(supabase, seller.shop_city_id),
    supabase.rpc("get_public_seller_contact_phone", { p_seller_profile_id: seller.id }),
    supabase.rpc("get_public_seller_verification_badges", { p_seller_profile_ids: [seller.id] }),
    getPublicCatalog(),
  ]);

  if (authError) throw new Error(authError.message);
  if (contactError) throw new Error(contactError.message);
  if (followerCountError) throw new Error(followerCountError.message);
  if (publicPhoneError) throw new Error(publicPhoneError.message);
  if (badgesError) throw new Error(badgesError.message);
  const registeredEmail = authResult.user?.email ?? "";
  const isRegisteredEmailVerified = Boolean(authResult.user?.email_confirmed_at);
  const sellerBadge = badges?.find((badge) => badge.is_verified);
  const products = catalog.products.filter((product) => product.sellerProfileId === seller.id);

  return (
    <main className="admin-overview seller-overview">
      {saved === "1" && <p className="admin-save-success" role="status">Seller profile saved successfully.</p>}
      {phoneConfirmed === "1" && <p className="admin-save-success" role="status">Phone contact confirmed through your registered email.</p>}
      <section className="seller-account-profile" aria-label="Shop overview">
        <div className="seller-account-identity">
          <div className="seller-account-logo">
            {seller.logo_url
              ? <Image src={seller.logo_url} alt={`${seller.shop_name} logo`} width={80} height={80} unoptimized />
              : <Store size={30} aria-hidden="true" />}
          </div>
          <div className="seller-account-details">
            <div className="seller-account-name-line">
              <h1>{seller.shop_name}{sellerBadge && <SellerVerificationBadge isBlue={sellerBadge.is_blue} />}</h1>
              <SellerProfileEditButton targetId="seller-profile-editor" />
            </div>
            <p><MapPin size={14} aria-hidden="true" />{savedCity ? `${savedCity.city_name}, ${savedCity.country_code}` : "Shop location not set"}</p>
          </div>
        </div>
        {seller.description && <p className="seller-profile-public-description">{seller.description}</p>}
        <div className="seller-profile-public-meta">
          {seller.shop_url && <a href={seller.shop_url} target="_blank" rel="noreferrer"><Globe2 size={14} aria-hidden="true" />Shop website<ArrowUpRight size={13} aria-hidden="true" /></a>}
          {publicPhone && <a href={`tel:${publicPhone}`}><Phone size={14} aria-hidden="true" />{publicPhone}</a>}
        </div>
        <div className="seller-account-stats" aria-label="Shop activity">
          <div><strong>{formatNumber(shopFollowerCount ?? 0)}</strong><span>Followers</span></div>
          <div><strong>{seller.status === "active" ? "Active" : seller.status}</strong><span>Account status</span></div>
          <div><strong>{seller.is_public ? "Visible" : "Hidden"}</strong><span>Public shop</span></div>
        </div>
      </section>
      <section className="seller-profile-products" aria-labelledby="seller-profile-products-title">
        <div className="seller-profile-products-heading">
          <h2 id="seller-profile-products-title">Products</h2>
          <span>{formatNumber(products.length)}</span>
        </div>
        {products.length
          ? <div className="seller-profile-product-grid">{products.map((product) => <ProductCard product={product} compact muteAutoplay priceBesideMaker key={product.slug} />)}</div>
          : <p className="seller-profile-products-empty">Published products will appear here.</p>}
      </section>
      <details id="seller-profile-editor" className="seller-profile-editor">
        <summary>
          <span>Edit shop profile</span>
          <small>Update shop details and private contact information.</small>
        </summary>
      <ActionForm className="seller-profile-form" action={saveSellerProfile}>
        <div className="seller-profile-section-heading">
          <h2>Shop details</h2>
          <p>These details describe your shop to customers.</p>
        </div>
        <label>
          Shop name
          <input name="shop_name" defaultValue={seller.shop_name} minLength={2} maxLength={100} required />
        </label>
        <label>
          Shop handle
          <input value={seller.slug} readOnly />
          <small>Internal identifier only; use the next field for your actual website link.</small>
        </label>
        <label>
          External shop website
          <input name="shop_url" type="url" defaultValue={seller.shop_url ?? ""} placeholder="https://your-shop.com" />
          <small>Optional HTTPS address shown to customers on your product details.</small>
        </label>
        <CityPicker
          name="shop_city_id"
          countries={countries}
          cities={cities}
          initialCity={savedCity}
          initialCountryCode={savedCity?.country_code ?? null}
        />
        <label className="seller-profile-description">
          Shop description
          <textarea name="description" defaultValue={seller.description ?? ""} rows={5} maxLength={500} />
          <small>Up to 500 characters.</small>
        </label>
        <ProfileImageUpload
          className="seller-profile-logo"
          inputId="seller-logo-image"
          name="logo_image"
          removeName="remove_logo"
          label="Shop logo image"
          removeLabel="Remove current shop logo"
          currentUrl={seller.logo_url}
          alt={`${seller.shop_name} logo`}
          fallbackText={seller.shop_name.slice(0, 1).toUpperCase()}
        />
        <p className="seller-profile-logo-help">JPEG, PNG, or WebP. Maximum 5 MB. This image appears beside your product name on cards.</p>
        <label className="seller-profile-logo-url">
          Or use an image URL
          <input name="logo_url" type="url" defaultValue={seller.logo_url ?? ""} placeholder="https://" />
          <small>Leave blank to keep the current logo, unless you select Remove current shop logo.</small>
        </label>
        <div className="seller-profile-section-heading">
          <h2>Contact details</h2>
          <p>Your phone stays private unless you choose to show it on public product pages.</p>
        </div>
        <label>
          Registered email
          <input value={registeredEmail} readOnly aria-describedby="seller-email-verification" />
          <small id="seller-email-verification" className={isRegisteredEmailVerified ? "seller-profile-verified" : "seller-profile-unverified"}>
            {isRegisteredEmailVerified ? "Account email verified" : "Account email not verified"}
          </small>
        </label>
        <label>
          Contact person
          <input name="contact_name" defaultValue={contact?.contact_name ?? ""} maxLength={100} placeholder="Name of the person we should contact" />
        </label>
        <label>
          Phone number
          <input name="phone" type="tel" autoComplete="tel" defaultValue={contact?.phone ?? ""} maxLength={32} placeholder="+44…" />
          <small>A confirmation link will be sent to your registered email to confirm this contact number.</small>
        </label>
        <label>
          Phone visibility
          <select name="phone_visibility" defaultValue={contact?.phone_visibility ?? "collaborations"}>
            <option value="collaborations">Only creators you select for a campaign</option>
            <option value="public">Public on my product pages</option>
          </select>
          <small>Collaboration-only numbers stay hidden from ordinary visitors. Public visibility requires a confirmed phone.</small>
        </label>
        <label>
          Business website
          <input name="website_url" type="url" defaultValue={contact?.website_url ?? ""} placeholder="https://" />
        </label>
        <label>
          Instagram profile
          <input name="instagram_url" type="url" defaultValue={contact?.instagram_url ?? ""} placeholder="https://www.instagram.com/your-shop" />
        </label>
        <label className="seller-profile-business-address">
          Business address
          <textarea name="business_address" defaultValue={contact?.business_address ?? ""} rows={3} maxLength={300} placeholder="Business address for administration" />
          <small>Private; visible to administration only.</small>
        </label>
        <section className="seller-profile-status" aria-label="Account status">
          <span>Account status <span className={`admin-status admin-status-${seller.status}`}>{seller.status}</span></span>
          <span>Public shop <strong>{seller.is_public ? "Visible" : "Hidden"}</strong></span>
          {seller.status === "active" && seller.is_public && <span>Shop followers <strong>{formatNumber(shopFollowerCount ?? 0)}</strong></span>}
        </section>
        <button className="admin-primary-button" type="submit">Save profile</button>
      </ActionForm>
      </details>
      {contact?.phone && !contact.phone_contact_confirmed_at && (
        <section className="seller-phone-verification" aria-labelledby="seller-phone-verification-title">
          <div>
            <h2 id="seller-phone-verification-title">Confirm your phone contact</h2>
            <p>We will send a confirmation link to {registeredEmail}. This confirms the contact details through your account email; it does not independently verify phone-network ownership.</p>
          </div>
          <ActionForm action={sendSellerPhoneConfirmation}>
            <button className="admin-approve-button" type="submit">Send confirmation link to email</button>
          </ActionForm>
          {verificationSent === "1" && <p role="status">A confirmation link was sent to {registeredEmail}. Open it to confirm this contact number.</p>}
          {verificationError === "1" && <p className="seller-profile-verification-error" role="alert">The confirmation link could not be used. Request a new link and try again.</p>}
        </section>
      )}
      {contact?.phone_contact_confirmed_at && (
        <p className="seller-profile-phone-confirmed" role="status">Phone contact confirmed through registered email on {formatDate(contact.phone_contact_confirmed_at)}.</p>
      )}
    </main>
  );
}
