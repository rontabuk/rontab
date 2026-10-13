const VISIT_PATH_PATTERN = /^\/visit\/[a-z0-9-]+(?:\?asGuest=1)?$/i;

// Only same-site visitor destinations are allowed after sign-in or the welcome splash.
export function getSafeVisitorPath(value: string | null | undefined) {
  if (value === "/products" || value === "/visitor") return value;
  if (value && VISIT_PATH_PATTERN.test(value)) return value;
  return "/products";
}
