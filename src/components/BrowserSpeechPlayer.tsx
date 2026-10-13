"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Play, Square } from "lucide-react";

type BrowserVoice = SpeechSynthesisVoice;

function subscribeToSpeechSupport() {
  return () => {};
}

function hasSpeechSynthesis() {
  return "speechSynthesis" in window;
}

function shortVoiceLabel(voice: BrowserVoice) {
  const language = voice.lang.split(/[-_]/)[0]?.toUpperCase() || "VOICE";
  const name = voice.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, "")
    .replace(/\s+(Speech|Text to Speech|Voice|Online|Desktop|Natural)\b/gi, "")
    .split(/\s+-\s+/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const compactName = name || "Voice";
  return `${compactName.slice(0, 16).trimEnd()}${compactName.length > 16 ? "…" : ""} (${language})`;
}

export function BrowserSpeechPlayer({ text, preview = false }: { text: string; preview?: boolean }) {
  const [voices, setVoices] = useState<BrowserVoice[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);
  const [voiceUri, setVoiceUri] = useState("");
  const supported = useSyncExternalStore(subscribeToSpeechSupport, hasSpeechSynthesis, () => true);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      return;
    }

    const synthesis = window.speechSynthesis;
    const updateVoices = () => {
      setVoices(synthesis.getVoices().filter((voice) => voice.localService));
      setVoicesReady(true);
    };
    updateVoices();
    synthesis.addEventListener("voiceschanged", updateVoices);
    return () => {
      synthesis.removeEventListener("voiceschanged", updateVoices);
      synthesis.cancel();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function stop() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
  }

  function play() {
    const spokenText = text.trim();
    if (!spokenText || !supported || !("speechSynthesis" in window)) return;

    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    const utterance = new SpeechSynthesisUtterance(spokenText);
    const voice = voices.find((item) => item.voiceURI === voiceUri) ?? voices.find((item) => item.default) ?? voices[0];
    if (!voice) return;
    utterance.lang = voice.lang;
    utterance.rate = 1;
    utterance.voice = voice;
    utterance.onstart = () => {
      setPlaying(true);
      timerRef.current = window.setTimeout(stop, 30_000);
    };
    utterance.onend = stop;
    utterance.onerror = stop;
    synthesis.speak(utterance);
  }

  return (
    <div className={`browser-speech-player${preview ? " is-preview" : ""}`}>
      <div className="browser-speech-controls">
        <button
          className="browser-speech-button"
          type="button"
          onClick={playing ? stop : play}
          disabled={!supported || !voices.length || !text.trim()}
          aria-pressed={playing}
          aria-label={playing ? "Stop audio summary" : "Listen to seller's audio summary"}
          title={playing ? "Stop audio" : voices.length ? "Listen to audio summary" : "No local voice is installed"}
        >
          {playing ? <Square size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
          <span>{playing ? "Stop audio" : preview ? "Preview audio" : "Listen to description"}</span>
        </button>
        {voices.length > 1 && (
          <label className="browser-speech-voice">
            <span className="visually-hidden">Voice on this device</span>
            <select value={voiceUri} onChange={(event) => setVoiceUri(event.target.value)} aria-label="Voice on this device">
              <option value="">Default voice</option>
              {voices.map((item) => <option key={item.voiceURI} value={item.voiceURI}>{shortVoiceLabel(item)}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="browser-speech-note" role="status">
        {!supported
          ? "Speech playback is not supported by this browser."
          : !voicesReady
            ? "Checking for an installed local voice…"
            : !voices.length
              ? "No local speech voice is installed. Add a voice in your device language settings to enable playback."
          : !text.trim()
            ? "Add an audio summary to enable playback."
            : preview
              ? "Preview uses an installed voice on this device; visitors may have different voices."
              : "Uses an installed voice on this device. Playback stops after 30 seconds."}
      </p>
    </div>
  );
}
