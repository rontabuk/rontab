const numberFormatter = new Intl.NumberFormat("en-GB");
const compactNumberFormatter = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

export function formatPrice(price: number | null, currency = "GBP") {
  if (price === null) return "Price on request";

  const fractionDigits = Number.isInteger(price) ? 0 : 2;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(price);
}
