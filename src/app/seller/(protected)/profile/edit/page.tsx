import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Globe2, MapPin, Store } from "lucide-react";
import { SiFacebook, SiInstagram, SiTiktok, SiX, SiYoutube } from "@icons-pack/react-simple-icons";
import { connection } from "next/server";
import { saveSellerProfile, sendSellerPhoneConfirmation } from "@/app/seller/(protected)/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProfileImageUpload } from "@/components/ProfileImageUpload";
import { CityPicker } from "@/components/CityPicker";
import { formatDate } from "@/lib/format";
import { getSavedCity, getSupportedLocations } from "@/lib/locations";
import { getSellerAccount } from "@/lib/seller/access";
import { sellerSocialPlatforms } from "@/lib/seller/social-links";

const socialIcons = { facebook: SiFacebook, x: SiX, youtube: SiYoutube, tiktok: SiTiktok };

export const metadata: Metadata = { title: "Edit seller profile", robots: { index: false, follow: false } };
export const instant = false;

export default async function EditSellerProfilePage({ searchParams }: {
  searchParams: Promise<{ verificationSent?: string; phoneConfirmed?: string; verificationError?: string }>;
}) {
  await connection();
  const { verificationSent, phoneConfirmed, verificationError } = await searchParams;
  const { supabase, seller } = await getSellerAccount();
  const [{ data: authResult, error: authError }, { data: contact, error: contactError }, { countries, cities }, savedCity] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("seller_contact_details")
      .select("*")
      .eq("seller_profile_id", seller.id).maybeSingle(),
    getSupportedLocations(),
    getSavedCity(supabase, seller.shop_city_id),
  ]);
  if (authError) throw new Error(authError.message);
  if (contactError) throw new Error(contactError.message);
  const registeredEmail = authResult.user?.email ?? "";
  const isRegisteredEmailVerified = Boolean(authResult.user?.email_confirmed_at);

  return (
    <main className="admin-overview seller-overview">
      <header className="seller-profile-edit-heading">
        <Link className="back-link" href="/seller/profile"><ArrowLeft size={18} aria-hidden="true" />Back to profile</Link>
        <h1>Edit shop profile</h1>
      </header>
      {phoneConfirmed === "1" && <p className="admin-save-success" role="status">Phone contact confirmed.</p>}
      {verificationSent === "1" && <p className="admin-save-success" role="status">Confirmation sent to {registeredEmail}.</p>}
      {verificationError === "1" && <p className="seller-profile-verification-error" role="alert">Link expired or invalid. Request another.</p>}
      <ActionForm className="seller-profile-form" action={saveSellerProfile}>
        <div className="seller-profile-section-heading">
          <h2>Shop details</h2>
        </div>
        <label>
          Shop name
          <input name="shop_name" defaultValue={seller.shop_name} minLength={2} maxLength={100} required />
        </label>
        <label>
          Shop link
          <span className="seller-link-field" data-contact-kind="shop"><Store size={18} aria-hidden="true" /><input name="shop_url" type="url" defaultValue={seller.shop_url ?? ""} placeholder="https://your-shop.com" /></span>
        </label>
        <CityPicker name="shop_city_id" countries={countries} cities={cities} initialCity={savedCity} initialCountryCode={savedCity?.country_code ?? null} />
        <label className="seller-profile-description">
          Bio
          <textarea name="description" defaultValue={seller.description ?? ""} rows={3} maxLength={500} placeholder="A few words about your shop" />
          <small>500 characters max.</small>
        </label>
        <ProfileImageUpload
          className="seller-profile-logo" inputId="seller-logo-image" name="logo_image" removeName="remove_logo"
          label="Shop logo" removeLabel="Remove logo" currentUrl={seller.logo_url} compact
          alt={`${seller.shop_name} logo`} fallbackText={seller.shop_name.slice(0, 1).toUpperCase()}
        />
        <details className="seller-profile-logo-url seller-profile-logo-link">
          <summary>Use a logo link</summary>
          <label>Image URL<input name="logo_url" type="url" defaultValue={seller.logo_url ?? ""} placeholder="https://" /></label>
        </details>
        <div className="seller-profile-section-heading">
          <h2>Contact details</h2>
        </div>
        <label>
          Email
          <input value={registeredEmail} readOnly aria-describedby="seller-email-verification" />
          <small id="seller-email-verification" className={isRegisteredEmailVerified ? "seller-profile-verified" : "seller-profile-unverified"}>
            {isRegisteredEmailVerified ? "Verified" : "Not verified"}
          </small>
        </label>
        <label>
          Contact person
          <input name="contact_name" defaultValue={contact?.contact_name ?? ""} maxLength={100} placeholder="Full name" />
        </label>
        <label>
          Phone number
          <input name="phone" type="tel" autoComplete="tel" defaultValue={contact?.phone ?? ""} maxLength={32} placeholder="+44..." />
          <small>Contact confirmation via email.</small>
        </label>
        <label>
          Phone visibility
          <select name="phone_visibility" defaultValue={contact?.phone_visibility ?? "collaborations"}>
            <option value="collaborations">Selected creators only</option>
            <option value="public">Public</option>
          </select>
          <small>Public sharing requires confirmation.</small>
        </label>
        <label>
          Website
          <span className="seller-link-field" data-contact-kind="website"><Globe2 size={18} aria-hidden="true" /><input name="website_url" type="url" defaultValue={contact?.website_url ?? ""} placeholder="https://" /></span>
        </label>
        <label>
          Instagram
          <span className="seller-link-field" data-contact-kind="instagram"><SiInstagram size={18} aria-hidden="true" /><input name="instagram_url" type="url" defaultValue={contact?.instagram_url ?? ""} placeholder="https://www.instagram.com/your-shop" /></span>
        </label>
        {sellerSocialPlatforms.map((platform) => {
          const Icon = socialIcons[platform.kind];
          return (
            <label key={platform.field}>
              {platform.label}
              <span className="seller-link-field" data-contact-kind={platform.kind}>
                <Icon size={18} aria-hidden="true" />
                <input name={platform.field} type="url" maxLength={500} defaultValue={contact?.[platform.field] ?? ""} placeholder={platform.placeholder} />
              </span>
            </label>
          );
        })}
        <label className="seller-profile-business-address">
          Business postcode
          <span className="seller-link-field" data-contact-kind="location">
            <MapPin size={18} aria-hidden="true" />
            <input name="business_postcode" defaultValue={contact?.business_postcode ?? ""} autoComplete="postal-code" autoCapitalize="characters" maxLength={8} placeholder="DN1 1AA" aria-describedby="seller-postcode-help" />
          </span>
          <small id="seller-postcode-help">Shown on your profile. Opens in Maps.</small>
        </label>
        <input type="hidden" name="business_address" value={contact?.business_address ?? ""} />
        <section className="seller-profile-status" aria-label="Account status">
          <span>Account status <span className={`admin-status admin-status-${seller.status}`}>{seller.status}</span></span>
          <span>Public shop <strong>{seller.is_public ? "Visible" : "Hidden"}</strong></span>
        </section>
        <div className="seller-profile-edit-actions">
          <button className="admin-primary-button" type="submit">Save changes</button>
          <Link className="seller-edit-cancel" href="/seller/profile">Cancel</Link>
        </div>
      </ActionForm>
      {contact?.phone && !contact.phone_contact_confirmed_at && (
        <section className="seller-phone-verification" aria-labelledby="seller-phone-verification-title">
          <div>
            <h2 id="seller-phone-verification-title">Confirm phone contact</h2>
            <p>Confirmation via {registeredEmail}. No SMS verification.</p>
          </div>
          <ActionForm action={sendSellerPhoneConfirmation}>
            <button className="admin-approve-button" type="submit">Send email link</button>
          </ActionForm>
        </section>
      )}
      {contact?.phone_contact_confirmed_at && <p className="seller-profile-phone-confirmed" role="status">Phone contact confirmed via email: {formatDate(contact.phone_contact_confirmed_at)}.</p>}
    </main>
  );
}