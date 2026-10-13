"use client";

import { useState } from "react";
import type { Database } from "@/lib/supabase/database.types";

export type SupportedCountry = Pick<Database["public"]["Tables"]["supported_countries"]["Row"], "country_code" | "country_name">;
export type SupportedCity = Database["public"]["Functions"]["search_supported_cities"]["Returns"][number];

export function CityPicker({
  countries,
  cities,
  initialCity,
  initialCountryCode,
  name,
  disabled = false,
  required = false,
  onSelect,
}: {
  countries: SupportedCountry[];
  cities: SupportedCity[];
  initialCity: SupportedCity | null;
  initialCountryCode: string | null;
  name: string;
  disabled?: boolean;
  required?: boolean;
  onSelect?: (city: SupportedCity | null) => void;
}) {
  const initialCountry = initialCountryCode ?? initialCity?.country_code ?? countries[0]?.country_code ?? "";
  const [countryCode, setCountryCode] = useState(initialCountry);
  const [selectedCity, setSelectedCity] = useState<SupportedCity | null>(initialCity);
  const countryCities = cities.filter((city) => city.country_code === countryCode);
  // Keep a previously saved city visible even after it is removed from the supported list.
  const cityOptions = initialCity && initialCity.country_code === countryCode && !countryCities.some((city) => city.city_id === initialCity.city_id)
    ? [initialCity, ...countryCities]
    : countryCities;

  function selectCountry(nextCountryCode: string) {
    setCountryCode(nextCountryCode);
    setSelectedCity(null);
    onSelect?.(null);
  }

  function selectCity(cityId: string) {
    const city = cityOptions.find((option) => option.city_id === cityId) ?? null;
    setSelectedCity(city);
    onSelect?.(city);
  }

  return (
    <div className="city-picker">
      <input type="hidden" name={name} value={selectedCity?.city_id ?? ""} />
      <input type="hidden" name={`${name}_country_code`} value={selectedCity?.country_code ?? countryCode} />
      <label className="city-picker-country">
        Country
        <select value={countryCode} onChange={(event) => selectCountry(event.target.value)} disabled={disabled}>
          <option value="">Choose a country</option>
          {countries.map((country) => <option value={country.country_code} key={country.country_code}>{country.country_name}</option>)}
        </select>
      </label>
      <label className="city-picker-city">
        City or town
        <select value={selectedCity?.city_id ?? ""} onChange={(event) => selectCity(event.target.value)} disabled={disabled || !countryCode} required={required}>
          <option value="">{countryCode ? "Choose a city" : "Choose a country first"}</option>
          {cityOptions.map((city) => <option value={city.city_id} key={city.city_id}>{city.city_name}</option>)}
        </select>
      </label>
    </div>
  );
}