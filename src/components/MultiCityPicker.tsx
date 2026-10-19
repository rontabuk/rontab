"use client";

import { useState } from "react";
import type { SupportedCity } from "@/components/CityPicker";

export function MultiCityPicker({
  cities,
  name,
  initialCityIds = [],
  maxSelected,
  disabled = false,
  cityDetails,
  emptySelectionLabel,
}: {
  cities: SupportedCity[];
  name: string;
  initialCityIds?: string[];
  maxSelected: number;
  disabled?: boolean;
  cityDetails?: Record<string, string>;
  emptySelectionLabel?: string;
}) {
  const [selectedIds, setSelectedIds] = useState(() => [...new Set(initialCityIds)].slice(0, maxSelected));
  const [query, setQuery] = useState("");
  const selected = selectedIds.flatMap((cityId) => {
    const city = cities.find((entry) => entry.city_id === cityId);
    return city ? [city] : [];
  });
  const filteredCities = cities.filter((city) => {
    const text = `${city.city_name} ${city.admin_name}`.toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase());
  }).slice(0, 100);

  function toggleCity(cityId: string) {
    setSelectedIds((current) => current.includes(cityId)
      ? current.filter((selectedId) => selectedId !== cityId)
      : current.length < maxSelected ? [...current, cityId] : current);
  }

  return (
    <div className="multi-city-picker">
      {selectedIds.map((cityId) => <input key={cityId} type="hidden" name={name} value={cityId} />)}
      <label className="multi-city-search">
        <span>Find a city</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by city or region" disabled={disabled} />
      </label>
      <p className="multi-city-count" role="status">{selectedIds.length === 0 && emptySelectionLabel ? emptySelectionLabel : `${selectedIds.length} of ${maxSelected} selected`}</p>
      {selected.length > 0 && (
        <ul className="multi-city-selected" aria-label="Selected cities">
          {selected.map((city) => (
            <li key={city.city_id}>
              <span>{city.city_name}{city.admin_name ? `, ${city.admin_name}` : ""}{cityDetails?.[city.city_id] && <small className="multi-city-audience">{cityDetails[city.city_id]}</small>}</span>
              <button type="button" onClick={() => toggleCity(city.city_id)} aria-label={`Remove ${city.city_name}`} disabled={disabled}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="multi-city-options">
        <legend>Available cities</legend>
        {filteredCities.map((city) => {
          const checked = selectedIds.includes(city.city_id);
          const atLimit = !checked && selectedIds.length >= maxSelected;
          return (
            <label key={city.city_id}>
              <input type="checkbox" checked={checked} disabled={disabled || atLimit} onChange={() => toggleCity(city.city_id)} />
              <span>{city.city_name}{city.admin_name ? `, ${city.admin_name}` : ""}{cityDetails?.[city.city_id] && <small className="multi-city-audience">{cityDetails[city.city_id]}</small>}</span>
            </label>
          );
        })}
        {filteredCities.length === 0 && <p>No supported cities match that search.</p>}
      </fieldset>
    </div>
  );
}
