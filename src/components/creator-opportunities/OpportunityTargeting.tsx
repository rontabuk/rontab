"use client";

import { useState } from "react";
import { MultiCityPicker } from "@/components/MultiCityPicker";
import type { SupportedCity } from "@/components/CityPicker";

export function OpportunityTargeting({ cities }: { cities: SupportedCity[] }) {
  const [isNationwide, setIsNationwide] = useState(false);

  return (
    <div className="creator-opportunity-targeting">
      <label className="creator-opportunity-nationwide">
        <input name="is_nationwide" type="checkbox" checked={isNationwide} onChange={(event) => setIsNationwide(event.target.checked)} />
        <span>Show to suitable creators across the United Kingdom</span>
      </label>
      <p>Or select up to 15 cities where you want to reach an audience.</p>
      <MultiCityPicker cities={cities} name="target_city_id" maxSelected={15} disabled={isNationwide} />
    </div>
  );
}
