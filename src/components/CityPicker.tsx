"use client";

import { useState } from "react";
import type { Database } from "@/lib/supabase/database.types";

export type SupportedCountry = Pick<Database["public"]["Tables"]["supported_countries"]["Row"], "country_code" | "country_name">;
export type SupportedCity = Database["public"]["Functions"]["search_supported_cities"]["Returns"][number];
export type LocationRegistrationCount = Database["public"]["Functions"]["seller_get_location_registration_counts"]["Returns"][number];
export type EligibleOfferAudienceCount = Database["public"]["Functions"]["admin_get_loyalty_offer_audience_counts"]["Returns"][number];

export function CityPicker({
  countries,
  cities,
  initialCity,
  initialCountryCode,
  name,
  userCounts,
  eligibleAudienceCounts,
  disabled = false,
  required = false,
  onSelect,
}: {
  countries: SupportedCountry[];
  cities: SupportedCity[];
  initialCity: SupportedCity | null;
  initialCountryCode: string | null;
  name: string;
  userCounts?: LocationRegistrationCount[];
  eligibleAudienceCounts?: EligibleOfferAudienceCount[] | null;
  disabled?: boolean;
  required?: boolean;
  onSelect?: (city: SupportedCity | null) => void;
}) {
  const initialCountry = initialCountryCode ?? initialCity?.country_code ?? (required ? "" : countries[0]?.country_code ?? "");
  const [countryCode, setCountryCode] = useState(initialCountry);
  const [selectedCity, setSelectedCity] = useState<SupportedCity | null>(initialCity);
  const countryCounts = new Map((userCounts ?? []).filter((count) => count.city_id === null).map((count) => [count.country_code, count.registered_count]));
  const cityCounts = new Map((userCounts ?? []).filter((count) => count.city_id !== null).map((count) => [count.city_id, count.registered_count]));
  const eligibleCountryCounts = new Map((eligibleAudienceCounts ?? []).filter((count) => count.city_id === null).map((count) => [count.country_code, count.eligible_visitor_count]));
  const eligibleCityCounts = new Map((eligibleAudienceCounts ?? []).filter((count) => count.city_id !== null).map((count) => [count.city_id, count.eligible_visitor_count]));
  const selectedCountryCount = countryCounts.get(countryCode);
  const selectedCityCount = selectedCity ? cityCounts.get(selectedCity.city_id) : undefined;
  const selectedCountryEligibleCount = eligibleCountryCounts.get(countryCode);
  const selectedCityEligibleCount = selectedCity ? eligibleCityCounts.get(selectedCity.city_id) ?? 0 : undefined;
  const hasEligibleAudienceCounts = eligibleAudienceCounts !== undefined && eligibleAudienceCounts !== null;
  const hasCounts = (userCounts?.length ?? 0) > 0 || hasEligibleAudienceCounts;
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
        <span className={`city-picker-control${hasCounts ? " has-counts" : ""}`}>
          <select value={countryCode} onChange={(event) => selectCountry(event.target.value)} disabled={disabled} required={required}>
            <option value="">Choose a country</option>
            {countries.map((country) => {
              const count = countryCounts.get(country.country_code);
              const eligibleCount = eligibleCountryCounts.get(country.country_code);
              const countLabel = hasEligibleAudienceCounts
                ? ` (${formatCount(eligibleCount ?? 0)} eligible)`
                : count === undefined ? "" : ` (${formatCount(count)} registered)`;
              return <option value={country.country_code} key={country.country_code}>{country.country_name}{countLabel}</option>;
            })}
          </select>
          {hasEligibleAudienceCounts
            ? <span className="city-picker-count" aria-label={`${formatCount(selectedCountryEligibleCount ?? 0)} eligible visitors in selected country`}>{formatCount(selectedCountryEligibleCount ?? 0)} eligible</span>
            : selectedCountryCount !== undefined && <span className="city-picker-count" aria-label={`${formatCount(selectedCountryCount)} registered users in selected country`}>{formatCount(selectedCountryCount)}</span>}
        </span>
      </label>
      <label className="city-picker-city">
        City or town
        <span className={`city-picker-control${hasCounts ? " has-counts" : ""}`}>
          <select value={selectedCity?.city_id ?? ""} onChange={(event) => selectCity(event.target.value)} disabled={disabled || !countryCode} required={required}>
            <option value="">{countryCode ? "Choose a city" : "Choose a country first"}</option>
            {cityOptions.map((city) => {
              const count = cityCounts.get(city.city_id);
              const eligibleCount = eligibleCityCounts.get(city.city_id);
              const countLabel = hasEligibleAudienceCounts
                ? ` (${formatCount(eligibleCount ?? 0)} eligible)`
                : count === undefined ? "" : ` (${formatCount(count)} registered)`;
              return <option value={city.city_id} key={city.city_id}>{city.city_name}{countLabel}</option>;
            })}
          </select>
          {hasEligibleAudienceCounts
            ? selectedCity && <span className="city-picker-count" aria-label={`${formatCount(selectedCityEligibleCount ?? 0)} eligible visitors in selected city`}>{formatCount(selectedCityEligibleCount ?? 0)} eligible</span>
            : selectedCityCount !== undefined && <span className="city-picker-count" aria-label={`${formatCount(selectedCityCount)} registered users in selected city`}>{formatCount(selectedCityCount)}</span>}
        </span>
      </label>
    </div>
  );
}

function formatCount(count: number) {
  return count.toLocaleString("en-GB");
}