import type { Metadata } from "next";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/admin/access";
import { deleteTopVideoAd, updateTopVideoAd } from "@/app/admin/(protected)/actions";
import { TopVideoAdUploadForm } from "@/components/admin/TopVideoAdUploadForm";

export const metadata: Metadata = { title: "Video ads", robots: { index: false, follow: false } };
export const instant = false;

export default async function AdminVideoAdsPage() {
  await connection();
  const { supabase } = await requireAdmin();
  const { data: ads, error } = await supabase
    .from("top_video_ads")
    .select("id,title,storage_path,media_type,display_seconds,target_url,is_active,sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">ADVERTISING</p>
        <h1>Video ads</h1>
        <p>Videos and images shown in the banner at the top of the product catalogue (about 15% of the screen height). Active items play in order: each video plays to the end, each image stays for its display time, then the next one appears. Visitors cannot pause the banner.</p>
      </header>
      <section className="admin-category-create" aria-labelledby="new-video-ad-title">
        <h2 id="new-video-ad-title">Add video or image</h2>
        <TopVideoAdUploadForm />
      </section>
      <section className="admin-category-list" aria-label="Existing video ads">
        {ads.map((ad) => {
          const mediaUrl = supabase.storage.from("top-video-ads").getPublicUrl(ad.storage_path).data.publicUrl;
          return (
          <div className="admin-video-ad-row" key={ad.id}>
            {ad.media_type === "video" ? (
              <video className="admin-video-ad-preview" src={mediaUrl} muted playsInline preload="metadata" aria-label={ad.title} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- small admin preview of a public storage file
              <img className="admin-video-ad-preview" src={mediaUrl} alt={ad.title} />
            )}
            <form className="admin-category-row" action={updateTopVideoAd}>
              <input type="hidden" name="ad_id" value={ad.id} />
              <label>Title<input name="title" defaultValue={ad.title} maxLength={120} required /></label>
              <label>Link<input name="target_url" type="url" pattern="https://.*" defaultValue={ad.target_url ?? ""} /></label>
              <label>Order<input name="sort_order" type="number" step="1" defaultValue={ad.sort_order} required /></label>
              {ad.media_type === "image" ? (
                <label>Seconds<input name="display_seconds" type="number" min="3" max="60" step="1" defaultValue={ad.display_seconds} required /></label>
              ) : (
                <input type="hidden" name="display_seconds" value={ad.display_seconds} />
              )}
              <label className="admin-checkbox-label"><input name="is_active" type="checkbox" defaultChecked={ad.is_active} /> Active</label>
              <button className="admin-approve-button" type="submit">Save</button>
            </form>
            <form action={deleteTopVideoAd}>
              <input type="hidden" name="ad_id" value={ad.id} />
              <button className="admin-reject-button" type="submit">Delete</button>
            </form>
          </div>
          );
        })}
        {!ads.length && <p className="admin-empty-note">Nothing in the banner yet.</p>}
      </section>
    </main>
  );
}
