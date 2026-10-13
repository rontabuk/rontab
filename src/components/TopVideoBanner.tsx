"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Maximize, Volume2, VolumeX } from "lucide-react";
import type { TopVideoAd } from "@/lib/supabase/catalog";

function formatTime(seconds: number) {
  const whole = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function TopVideoBanner({ ads }: { ads: readonly TopVideoAd[] }) {
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ad = ads[index];
  const hasMany = ads.length > 1;
  const showNext = () => setIndex((value) => (value + 1) % ads.length);

  useEffect(() => {
    if (!ad || ad.mediaType !== "image" || ads.length < 2) return;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % ads.length), ad.displaySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [ad, ads.length]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Browsers may block unmuted autoplay; fall back to muted so the slot never stalls.
    void video.play().catch(() => {
      video.muted = true;
      setMuted(true);
      void video.play().catch(() => {});
    });
  }, [index]);

  if (!ad) return null;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <section className="top-video-banner page-shell" aria-label="Sponsored">
      <div className="top-video-frame" ref={frameRef}>
        {ad.mediaType === "video" ? (
          <video
            key={ad.id}
            ref={videoRef}
            className="top-video-media"
            src={ad.mediaUrl}
            aria-label={ad.title}
            muted={muted}
            playsInline
            autoPlay
            loop={!hasMany}
            preload="auto"
            onLoadedMetadata={(event) => setTime({ current: 0, duration: event.currentTarget.duration })}
            onTimeUpdate={(event) => setTime({ current: event.currentTarget.currentTime, duration: event.currentTarget.duration })}
            onEnded={showNext}
            onError={() => hasMany && showNext()}
          />
        ) : (
          <Image key={ad.id} className="top-video-media" src={ad.mediaUrl} alt={ad.title} fill unoptimized priority sizes="100vw" />
        )}
        {ad.targetUrl && (
          <a className="top-video-link" href={ad.targetUrl} target="_blank" rel="noopener noreferrer sponsored" aria-label={`Open ${ad.title}`} />
        )}
        <div className="top-video-controls">
          {ad.mediaType === "video" && (
            <>
              <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute video" : "Mute video"} aria-pressed={!muted}>
                {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
              </button>
              <span className="top-video-time">{formatTime(time.current)} / {formatTime(time.duration)}</span>
            </>
          )}
          {hasMany && (
            <span className="top-video-dots" aria-hidden="true">
              {ads.map((item, itemIndex) => <i key={item.id} data-active={itemIndex === index || undefined} />)}
            </span>
          )}
          <button type="button" onClick={toggleFullscreen} aria-label="Full screen">
            <Maximize size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
