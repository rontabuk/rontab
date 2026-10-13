import type { Metadata } from "next";
import { connection } from "next/server";
import { RontabSplash } from "@/components/RontabSplash";
import { getSafeVisitorPath } from "@/lib/visitor/paths";
import "./splash.css";

export const metadata: Metadata = { title: { absolute: "Rontab | Connect · Market · Grow" } };
export const instant = false;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string; next?: string }>;
}) {
  await connection();
  const { welcome, next } = await searchParams;
  return <RontabSplash showOnly={welcome === "1"} destination={getSafeVisitorPath(next)} />;
}
