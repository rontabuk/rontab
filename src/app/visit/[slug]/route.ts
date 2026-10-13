import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";

const unavailable = () => new Response("Product visit is temporarily unavailable.", { status: 503 });

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const visitPath = `/visit/${encodeURIComponent(slug)}`;
  const requestedGuest = new URL(request.url).searchParams.get("asGuest") === "1";
  const redirectToAccount = (needsConfirmation = false) => {
    const accountUrl = new URL("/account", request.url);
    accountUrl.searchParams.set("next", visitPath);
    if (needsConfirmation) accountUrl.searchParams.set("confirm", "1");
    return NextResponse.redirect(accountUrl, 307);
  };

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  const isGuest = requestedGuest && !user;
  if (!isGuest && (authError || !user)) return redirectToAccount();
  if (user && !user.email_confirmed_at) return redirectToAccount(true);

  let clickClient;
  try {
    clickClient = createSupabaseServiceRoleClient();
  } catch (error) {
    console.error("Product visit service client is unavailable:", error instanceof Error ? error.message : "Unknown configuration error.");
    return unavailable();
  }

  const { data: product, error: productError } = await clickClient
    .from("products")
    .select("id,external_url,seller_profile_id")
    .eq("slug", slug)
    .maybeSingle();

  if (productError) {
    console.error("Product visit lookup failed:", productError.message);
    return unavailable();
  }
  if (!product) return new Response("Product not found.", { status: 404 });

  const visitShop = (canVisit: boolean | null) => canVisit
    ? NextResponse.redirect(product.external_url, 307)
    : NextResponse.redirect(new URL("/products", request.url), 307);

  if (isGuest) {
    const { data: canVisit, error: availabilityError } = await clickClient.rpc("is_product_click_credit_available", {
      p_product_id: product.id,
    });
    if (availabilityError) {
      console.error("Product availability check failed:", availabilityError.message);
      return unavailable();
    }
    return visitShop(canVisit);
  }
  if (!user) return redirectToAccount();

  const { data: productSeller, error: sellerError } = await clickClient
    .from("seller_profiles")
    .select("user_id")
    .eq("id", product.seller_profile_id)
    .maybeSingle();

  if (sellerError) {
    console.error("Product seller lookup failed:", sellerError.message);
    return unavailable();
  }
  // Sellers previewing their own listing never spend click credits.
  if (productSeller?.user_id === user.id) return visitShop(true);

  const { data: canVisit, error: clickError } = await clickClient.rpc("record_product_shop_click", {
    p_product_id: product.id,
    p_visitor_id: user.id,
  });

  if (clickError) {
    console.error("Product click accounting failed:", clickError.message);
    return unavailable();
  }

  return visitShop(canVisit);
}