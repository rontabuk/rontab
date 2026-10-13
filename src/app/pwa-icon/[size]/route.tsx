import { renderAppIcon } from "@/lib/pwa-icon";

const allowedSizes = new Set([192, 512]);

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!allowedSizes.has(size)) return new Response("Not found", { status: 404 });
  return renderAppIcon(size);
}
