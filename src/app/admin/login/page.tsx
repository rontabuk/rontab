import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="admin-login-page">
      <section className="admin-login-panel" aria-labelledby="admin-login-title">
        <p className="admin-eyebrow">Private access</p>
        <h1 id="admin-login-title">Admin sign in</h1>
        <p className="admin-login-copy">This area is reserved for authorized administrators.</p>
        <AdminLoginForm />
        <p className="admin-security-note">Admin access is managed separately from public and seller accounts.</p>
      </section>
    </main>
  );
}