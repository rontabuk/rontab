"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setMessage("Seller access is temporarily unavailable.");
      setIsSubmitting(false);
      return;
    }

    if (mode === "register") {
      const shopName = String(formData.get("shop_name") ?? "").trim();
      const shopSlug = String(formData.get("shop_slug") ?? "").trim().toLowerCase();

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shopSlug)) {
        setMessage("Use lowercase letters, numbers, and hyphens for your shop handle.");
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
          emailRedirectTo: `${window.location.origin}/seller/login?registered=1&confirmation=1`,
        },
      });

      if (error) {
        setMessage("We could not create this seller account. Check your details, including your shop handle, and try again.");
        setIsSubmitting(false);
        return;
      }

      if (!data.session) {
        router.replace("/?welcome=1&next=%2Fseller%2Flogin%3Fregistered%3D1%26confirmation%3D1");
        router.refresh();
        return;
      }

      await supabase.auth.signOut();
      router.replace("/?welcome=1&next=%2Fseller%2Flogin%3Fregistered%3D1");
      router.refresh();
      return;
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

    window.location.replace("/?welcome=1&next=%2Fproducts");
  }

  return (
    <form className="seller-auth-form" onSubmit={handleSubmit}>
      {mode === "register" && (
        <>
          <label htmlFor="shop-name">Shop name</label>
          <input id="shop-name" name="shop_name" autoComplete="organization" minLength={2} maxLength={100} placeholder="The name buyers will see" aria-describedby="shop-name-hint" required />
          <small id="shop-name-hint">Shown on your shop page and on every product you list.</small>
          <label htmlFor="shop-slug">Shop handle</label>
          <input id="shop-slug" name="shop_slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="off" placeholder="e.g. b2bmisr" aria-describedby="shop-handle-hint" required />
          <small id="shop-handle-hint">Your unique shop identifier, not a website address. Use lowercase letters, numbers or hyphens.</small>
        </>
      )}
      <label htmlFor="seller-email">Email</label>
      <input id="seller-email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="seller-password">Password</label>
      <input id="seller-password" name="password" type="password" minLength={8} autoComplete={mode === "register" ? "new-password" : "current-password"} required />
      {mode === "login" && <Link className="seller-auth-switch" href="/auth/forgot-password?returnTo=%2Fseller%2Flogin">Forgot password?</Link>}
      {message && <p className="seller-auth-message" role="status">{message}</p>}
      <button className="seller-auth-submit" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Please wait…" : mode === "register" ? "Create seller account" : "Sign in"}
      </button>
      <p className="seller-auth-switch">
        {mode === "register" ? "Already registered?" : "New here?"}{" "}
        <Link href={mode === "register" ? "/seller/login" : "/seller/register"}>
          {mode === "register" ? "Sign in" : "Create a seller account"}
        </Link>
      </p>
    </form>
  );
}