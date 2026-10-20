// Single switch for every beta-only behaviour. Fail-safe: beta stays on unless explicitly set to "false".
// NEXT_PUBLIC_ values are inlined at build time, so changing it requires a rebuild/redeploy.
export function isBetaMode(): boolean {
  return process.env.NEXT_PUBLIC_BETA_MODE?.trim().toLowerCase() !== "false";
}
