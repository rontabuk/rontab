import type { Metadata } from "next";
import { connection } from "next/server";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/admin/access";
import { createAnnouncement, setAnnouncementActive } from "@/app/admin/(protected)/actions";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };
export const instant = false;

const audienceLabels = { everyone: "Everyone", visitors: "Signed-in visitors", sellers: "Sellers" } as const;

export default async function AdminNotificationsPage() {
  await connection();
  const { supabase } = await requireAdmin();
  const { data: announcements, error } = await supabase
    .from("site_announcements")
    .select("id,title,body,link_url,audience,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  return (
    <main className="admin-overview">
      <header className="admin-page-heading">
        <p className="admin-eyebrow">COMMUNICATION</p>
        <h1>Notifications</h1>
        <p>Announcements appear in the bell at the top of the site for 60 days. Newly published products and email-confirmation reminders are added automatically.</p>
      </header>
      <section className="admin-category-create" aria-labelledby="new-announcement-title">
        <h2 id="new-announcement-title">Send an announcement</h2>
        <ActionForm className="admin-category-form" action={createAnnouncement}>
          <label>Title<input name="title" maxLength={120} required /></label>
          <label>Audience
            <select name="audience" defaultValue="everyone">
              {Object.entries(audienceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>Link (optional)<input name="link_url" placeholder="/products or https://…" /></label>
          <label className="admin-announcement-body">Message<textarea name="body" maxLength={500} rows={3} required /></label>
          <button className="admin-primary-button" type="submit">Send to the bell</button>
        </ActionForm>
      </section>
      <section className="admin-category-list" aria-label="Sent announcements">
        {announcements.map((announcement) => (
          <article className="admin-announcement-row" key={announcement.id} data-active={announcement.is_active || undefined}>
            <div>
              <strong>{announcement.title}</strong>
              <p>{announcement.body}</p>
              <small>
                {audienceLabels[announcement.audience]} · {new Date(announcement.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                {announcement.link_url && <> · {announcement.link_url}</>}
                {!announcement.is_active && <> · Hidden</>}
              </small>
            </div>
            <form action={setAnnouncementActive}>
              <input type="hidden" name="announcement_id" value={announcement.id} />
              <input type="hidden" name="is_active" value={String(!announcement.is_active)} />
              <button className={announcement.is_active ? "admin-reject-button" : "admin-approve-button"} type="submit">
                {announcement.is_active ? "Hide" : "Show again"}
              </button>
            </form>
          </article>
        ))}
        {!announcements.length && <p className="admin-empty-note">No announcements sent yet.</p>}
      </section>
    </main>
  );
}
