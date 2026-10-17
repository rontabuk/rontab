import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export async function renderBrandImage(assetName: string, width: number, height: number) {
  const svg = await readFile(join(process.cwd(), "public/brand", assetName));
  const png = await sharp(svg).resize(width, height, { fit: "contain" }).png().toBuffer();

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}