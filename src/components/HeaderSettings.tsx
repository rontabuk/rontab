"use client";

import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import {
  DEFAULT_CLIENT_PREFERENCES,
  readClientPreferences,
  subscribeToClientPreferences,
  updateClientPreferences,
} from "@/lib/preferences/client";

export function HeaderSettings() {
  const [preferences, setPreferences] = useState(DEFAULT_CLIENT_PREFERENCES);

  useEffect(() => {
    const syncPreferences = () => setPreferences(readClientPreferences());
    syncPreferences();
    return subscribeToClientPreferences(syncPreferences);
  }, []);

  return (
    <details className="site-menu-settings">
      <summary><Settings size={16} aria-hidden="true" /><span>Settings</span></summary>
      <section className="site-menu-settings-options" aria-label="Settings">
        <label>
          <span>Reel sound</span>
          <input
            type="checkbox"
            checked={preferences.reelSoundEnabled}
            onChange={(event) => setPreferences(updateClientPreferences({ reelSoundEnabled: event.currentTarget.checked }))}
          />
        </label>
        <label>
          <span>Auto-play reels</span>
          <input
            type="checkbox"
            checked={preferences.autoplayReels}
            onChange={(event) => setPreferences(updateClientPreferences({ autoplayReels: event.currentTarget.checked }))}
          />
        </label>
        <label>
          <span>Language</span>
          <select disabled><option>English</option></select>
        </label>
        <label>
          <span>Appearance</span>
          <select disabled><option>Light</option></select>
        </label>
      </section>
    </details>
  );
}