const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CITY_ID_PATTERN = /^[A-Z]{2}-[A-Za-z0-9_-]{1,60}$/;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function isCityId(value: string) {
  return CITY_ID_PATTERN.test(value);
}

export function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUkPostcode(value: string): string | null {
  const compact = value.replace(/\s/g, "").toUpperCase();
  if (!compact) return "";
  const postcode = `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return /^(GIR 0AA|[A-PR-UWYZ](?:[0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPSTUW]|[A-HK-Y][0-9][ABEHMNPRVWXY]) [0-9][ABD-HJLNP-UW-Z]{2})$/.test(postcode) ? postcode : null;
}

export const PROFILE_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function getProfileImageProblem(file: File, label: string) {
  if (!Object.hasOwn(PROFILE_IMAGE_TYPES, file.type)) return `${label} must be a JPEG, PNG, or WebP image.`;
  if (file.size > 5 * 1024 * 1024) return `${label} must be 5 MB or smaller.`;
  return null;
}
