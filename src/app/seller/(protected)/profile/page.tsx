import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSellerAccount } from "@/lib/seller/access";

export const metadata: Metadata = { title: "Seller profile", robots: { index: false, follow: false } };
export const instant = false;

export default async function SellerProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  await connection();
  const [{ seller }, { saved }] = await Promise.all([getSellerAccount(), searchParams]);
  redirect(`/shops/${encodeURIComponent(seller.slug)}${saved === "1" ? "?saved=1" : ""}`);
}
