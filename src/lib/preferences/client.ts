export type ClientPreferences = {
  reelSoundEnabled: boolean;
  autoplayReels: boolean;
};

const STORAGE_KEY = "rontab-client-preferences-v1";
const CHANGE_EVENT = "rontab-client-preferences-change";

export const DEFAULT_CLIENT_PREFERENCES: ClientPreferences = {
  reelSoundEnabled: false,
  autoplayReels: true,
};

export function readClientPreferences(): ClientPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_CLIENT_PREFERENCES;

    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return DEFAULT_CLIENT_PREFERENCES;

    const value = parsed as Partial<ClientPreferences>;
    return {
      reelSoundEnabled: typeof value.reelSoundEnabled === "boolean" ? value.reelSoundEnabled : DEFAULT_CLIENT_PREFERENCES.reelSoundEnabled,
      autoplayReels: typeof value.autoplayReels === "boolean" ? value.autoplayReels : DEFAULT_CLIENT_PREFERENCES.autoplayReels,
    };
  } catch {
    return DEFAULT_CLIENT_PREFERENCES;
  }
}

export function updateClientPreferences(changes: Partial<ClientPreferences>) {
  const next = { ...readClientPreferences(), ...changes };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    return next;
  }
  return next;
}

export function subscribeToClientPreferences(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}