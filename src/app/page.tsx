import type { Metadata } from "next";
import { connection } from "next/server";
import { RontabSplash } from "@/components/RontabSplash";
import { getSafeVisitorPath } from "@/lib/visitor/paths";
import "./splash.css";

export const metadata: Metadata = { title: { absolute: "RonTab" } };
export const instant = false;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; next?: string; verificationEmail?: string }>;
}) {
  await connection();
  const { welcome, next, verificationEmail } = await searchParams;
  const authenticationDestinations = ["/admin", "/seller/login?registered=1", "/seller/login?registered=1&confirmation=1"];
  const destination = next && authenticationDestinations.includes(next) ? next : getSafeVisitorPath(next);
  const separator = destination.includes("?") ? "&" : "?";
  const nextPath = verificationEmail === "sent" || verificationEmail === "failed"
    ? `${destination}${separator}verificationEmail=${verificationEmail}`
    : destination;
  return <RontabSplash showOnly={welcome === "1"} destination={nextPath} />;
}
