import "server-only";

import type { SupportedCity, SupportedCountry } from "@/components/CityPicker";
import { createSupabasePublicClient } from "@/lib/supabase/server";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const CITY_COLUMNS = "city_id,city_name,city_ascii,admin_name,country_code";

export async function getSupportedLocations(): Promise<{ countries: SupportedCountry[]; cities: SupportedCity[] }> {
  const supabase = createSupabasePublicClient();
  const [countriesResult, citiesResult] = await Promise.all([
    supabase.from("supported_countries").select("country_code,country_name").eq("is_enabled", true).order("country_name"),
    supabase.from("supported_cities").select(CITY_COLUMNS).eq("is_enabled", true).order("city_name"),
  ]);
  if (countriesResult.error) throw new Error(countriesResult.error.message);
  if (citiesResult.error) throw new Error(citiesResult.error.message);

  return { countries: countriesResult.data, cities: citiesResult.data };
}

// Looked up separately so a saved city stays visible even after it is no longer enabled.
export async function getSavedCity(supabase: ServerClient, cityId: string | null): Promise<SupportedCity | null> {
  if (!cityId) return null;

  const { data, error } = await supabase.from("supported_cities").select(CITY_COLUMNS).eq("city_id", cityId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
