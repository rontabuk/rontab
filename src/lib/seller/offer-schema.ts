type SchemaCacheError = { code?: string; message?: string } | null;

export function isSellerOfferSchemaUnavailable(error: SchemaCacheError) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "PGRST202") return true;
  return Boolean(error.message?.includes("schema cache") && /seller_offer_/i.test(error.message));
}