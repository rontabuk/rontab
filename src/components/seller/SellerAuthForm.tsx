"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

export function SellerAuthForm({ mode }: { mode: "register" | "login" }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      setMessage("Seller access is not configured yet.");
      setIsSubmitting(false);
      return;
    }

    const supabase = createBrowserClient<Database>(supabaseUrl, supabaseKey);

    if (mode === "register") {
      const shopName = String(formData.get("shop_name") ?? "").trim();
      const shopSlug = String(formData.get("shop_slug") ?? "").trim().toLowerCase();

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug)) {
        setMessage("Use lowercase letters, numbers, and hyphens for the shop URL.");
        setIsSubmitting(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            account_type: "seller",
            display_name: shopName,
            shop_name: shopName,
            shop_slug: shopSlug,
          },
          emailRedirectTo: `${window.location.origin}/seller/login`,
        },
      });

      if (error) {
        setMessage("We could not create this seller account. Check the details or shop URL.");
        setIsSubmitting(false);
        return;
      }

      if (!data.session) {
        setMessage("Check your email to confirm the account. Your shop will be reviewed before it can publish products.");
        setIsSubmitting(false);
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error || !data.user) {
        setMessage("The email or password is incorrect.");
        setIsSubmitting(false);
        return;
      }

      const { data: seller, error: sellerError } = await supabase
        .from("seller_profiles")
        .select("id")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (sellerError || !seller) {
        await supabase.auth.signOut();
        setMessage("This account does not have a seller profile.");
        setIsSubmitting(false);
        return;
      }
    }

    router.replace("/seller");
    router.refresh();
  }

  return (
    <form className="seller-auth-form" onSubmit={handleSubmit}>
      {mode === "register" && (
        <>
          <label htmlFor="shop-name">Shop name</label>
          <input id="shop-name" name="shop_name" autoComplete="organization" required />
          <label htmlFor="shop-slug">Shop URL name</label>
          <input id="shop-slug" name="shop_slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="off" required />
        </>
      )}
      <label htmlFor="seller-email">Email</label>
      <input id="seller-email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="seller-password">Password</label>
      <input id="seller-password" name="password" type="password" minLength={8} autoComplete={mode === "register" ? "new-password" : "current-password"} required />
      {message && <p className="seller-auth-message" role="status">{message}</p>}
      <button className="seller-auth-submit" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Please wait…" : mode === "register" ? "Create seller account" : "Sign in"}
      </button>
      <p className="seller-auth-switch">
        {mode === "register" ? "Already registered?" : "New to Rontab?"}{" "}
        <Link href={mode === "register" ? "/seller/login" : "/seller/register"}>
          {mode === "register" ? "Sign in" : "Create a seller account"}
        </Link>
      </p>
    </form>
  );
}