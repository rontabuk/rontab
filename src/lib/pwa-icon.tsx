import { ImageResponse } from "next/og";

export function renderAppIcon(size: number) {
  const glyph = Math.round(size * 0.58);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "linear-gradient(145deg, #4f7a5a, #2f5a3f)" }}>
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="21" r="1" />
          <circle cx="19" cy="21" r="1" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
        <svg style={{ position: "absolute", top: Math.round(size * 0.16), right: Math.round(size * 0.16) }} width={Math.round(size * 0.24)} height={Math.round(size * 0.24)} viewBox="0 0 24 24" fill="none" stroke="#ffb48f" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 7h10v10" />
          <path d="M7 17 17 7" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
