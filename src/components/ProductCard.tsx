"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Eye, Image as ImageIcon, Pause, Play, Tag, UsersRound } from "lucide-react";
import type { Product } from "@/data/products";
import { ShopFollowButton } from "@/components/ShopFollowButton";
import { ShopVisitLink } from "@/components/ShopVisitLink";
import { SellerVerificationBadge } from "@/components/seller/SellerVerificationBadge";
import { formatCompactNumber, formatPrice } from "@/lib/format";
import { DEFAULT_CLIENT_PREFERENCES, readClientPreferences, subscribeToClientPreferences } from "@/lib/preferences/client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ProductCard({
  product,
  isFeatured = false,
  compact = false,
  previewOnly = false,
  showUploadPlaceholder = false,
  isShopFollowed = false,
  muteAutoplay = false,
  priceBesideMaker = false,
  hideSellerName = false,
  showSellerOfferActions = false,
  priority = false,
}: {
  product: Product;
  isFeatured?: boolean;
  compact?: boolean;
  previewOnly?: boolean;
  showUploadPlaceholder?: boolean;
  isShopFollowed?: boolean;
  muteAutoplay?: boolean;
  priceBesideMaker?: boolean;
  hideSellerName?: boolean;
  showSellerOfferActions?: boolean;
  priority?: boolean;
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [visibleDetailLength, setVisibleDetailLength] = useState(0);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_CLIENT_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [desktopSoundEnabled, setDesktopSoundEnabled] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoProgress, setVideoProgress] = useState(0);
  const audioMuted = muteAutoplay || !preferences.reelSoundEnabled || soundBlocked;
  const [viewCount, setViewCount] = useState(product.viewCount ?? 0);
  const closeTimer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const automaticReplayCount = useRef(0);
  const cardRef = useRef<HTMLElement>(null);
  const viewRecorded = useRef(false);
  const descriptionId = `description-${product.slug}`;
  const descriptionCloseDelay = Math.min(180_000, Math.max(15_000, product.description.length * 60 + 5_000));

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const resetCloseTimer = () => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setDescriptionOpen(false);
      closeTimer.current = null;
    }, descriptionCloseDelay);
  };

  const closeDescription = () => {
    clearCloseTimer();
    setDescriptionOpen(false);
  };

  const toggleDescription = () => {
    if (descriptionOpen) {
      closeDescription();
      return;
    }

    setVisibleDetailLength(0);
    setDescriptionOpen(true);
    resetCloseTimer();
  };

  const toggleVideoPlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    document.querySelectorAll<HTMLVideoElement>("[data-product-card] .product-card-media").forEach((other) => {
      if (other !== video) other.pause();
    });
    setDesktopSoundEnabled(true);
    video.muted = false;
    void video.play().catch(() => setIsPlaying(false));
  };

  useEffect(() => () => clearCloseTimer(), []);

  useEffect(() => {
    const syncPreferences = () => {
      setPreferences(readClientPreferences());
      setSoundBlocked(false);
      setPreferencesReady(true);
    };
    syncPreferences();
    return subscribeToClientPreferences(syncPreferences);
  }, []);

  useEffect(() => {
    if (product.mediaType !== "video") return;
    const video = videoRef.current;
    if (!video) return;

    const showPreview = () => {
      if (video.paused && video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(0.1, video.duration / 2);
      }
    };

    showPreview();
    video.addEventListener("loadedmetadata", showPreview);
    return () => video.removeEventListener("loadedmetadata", showPreview);
  }, [product.image, product.mediaType]);

  useEffect(() => {
    if (product.mediaType !== "video") return;
    const viewport = window.matchMedia("(min-width: 761px)");
    const syncViewport = () => setIsDesktop(viewport.matches);
    syncViewport();
    viewport.addEventListener("change", syncViewport);
    return () => viewport.removeEventListener("change", syncViewport);
  }, [product.mediaType]);

  useEffect(() => {
    if (!descriptionOpen) return;

    const description = product.description;
    let characterCount = 0;
    let timer: number;
    const typeNextCharacter = () => {
      characterCount = Math.min(characterCount + 1, description.length);
      setVisibleDetailLength(characterCount);

      if (characterCount < description.length) {
        const justTyped = description[characterCount - 1];
        timer = window.setTimeout(typeNextCharacter, justTyped === " " ? 120 : 28);
      }
    };

    timer = window.setTimeout(typeNextCharacter, 50);
    return () => window.clearTimeout(timer);
  }, [descriptionOpen, product.description]);

  useEffect(() => {
    if (product.mediaType !== "video") return;
    const video = videoRef.current;
    if (!video) return;

    if (!preferencesReady || isDesktop !== false || !preferences.autoplayReels) {
      video.pause();
      return;
    }

    let cancelled = false;
    const canAutoplay = () => !cancelled
      && !window.matchMedia("(min-width: 761px)").matches
      && readClientPreferences().autoplayReels;
    const play = () => {
      if (!canAutoplay()) return;
      video.muted = audioMuted || !preferences.reelSoundEnabled;
      void video.play().catch(() => {
        if (!canAutoplay()) return;
        video.muted = true;
        setSoundBlocked(true);
        void video.play().catch(() => {});
      });
    };

    if (previewOnly) {
      play();
      return () => {
        cancelled = true;
        video.pause();
      };
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) play();
      else video.pause();
    }, { rootMargin: "0px" });

    observer.observe(video);
    return () => {
      cancelled = true;
      observer.disconnect();
      video.pause();
    };
  }, [audioMuted, isDesktop, preferencesReady, previewOnly, preferences.autoplayReels, preferences.reelSoundEnabled, product.mediaType]);

  useEffect(() => {
    const productId = product.id;
    const card = cardRef.current;
    if (previewOnly || !productId || !product.image || !card || typeof IntersectionObserver === "undefined") return;

    const supabase = createSupabaseBrowserClient();
    const viewerSessionId = getProductViewSessionId();
    if (!supabase || !viewerSessionId) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (viewRecorded.current || !entry.isIntersecting || entry.intersectionRatio < 0.5) return;

      viewRecorded.current = true;
      observer.unobserve(card);
      void supabase.rpc("record_product_view", { p_product_id: productId, p_viewer_session_id: viewerSessionId }).then(({ data, error }) => {
        if (!error && typeof data === "number") setViewCount(data);
      }, () => {});
    }, { threshold: 0.5 });

    observer.observe(card);
    return () => observer.disconnect();
  }, [previewOnly, product.id, product.image]);

  const mediaElement = !product.image && previewOnly && showUploadPlaceholder ? (
    <div className="seller-upload-preview-placeholder" role="img" aria-label="Preview placeholder for your product photo or Reel">
      <div className="seller-upload-preview-topline"><span>YOUR SHOP</span><span>4:5 PORTRAIT</span></div>
      <div className="seller-upload-preview-art" aria-hidden="true">
        <span className="seller-upload-preview-shape seller-upload-preview-shape-one" />
        <span className="seller-upload-preview-shape seller-upload-preview-shape-two" />
        <span className="seller-upload-preview-shape seller-upload-preview-shape-three" />
        <span className="seller-upload-preview-icon"><ImageIcon size={23} /></span>
      </div>
      <div className="seller-upload-preview-copy">
        <span>PRODUCT PHOTO OR REEL</span>
        <strong>{product.name === "Product name" ? "Your next great find" : product.name}</strong>
        <small>Your uploaded media will appear here</small>
      </div>
    </div>
  ) : !product.image ? (
    <div className="product-media-placeholder" aria-label="No product image">
      <ImageIcon size={28} aria-hidden="true" />
    </div>
  ) : product.mediaType === "video" ? (
    <video
      ref={videoRef}
      className="product-card-media"
      src={product.image}
      aria-label={product.imageAlt}
      muted={isDesktop === true ? !desktopSoundEnabled : audioMuted}
      playsInline
      preload="metadata"
      onPlay={() => {
        setIsPlaying(true);
        if (window.matchMedia("(min-width: 761px)").matches) {
          document.querySelectorAll<HTMLVideoElement>("[data-product-card] .product-card-media").forEach((other) => {
            if (other !== videoRef.current) other.pause();
          });
        }
      }}
      onPause={() => setIsPlaying(false)}
      onDurationChange={(event) => {
        const duration = event.currentTarget.duration;
        setVideoDuration(Number.isFinite(duration) ? duration : 0);
      }}
      onTimeUpdate={(event) => {
        const video = event.currentTarget;
        setVideoProgress(Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration * 100 : 0);
      }}
      onEnded={(event) => {
        setIsPlaying(false);
        const video = event.currentTarget;
        if (window.matchMedia("(min-width: 761px)").matches || !preferencesReady || !readClientPreferences().autoplayReels || automaticReplayCount.current >= 3) {
          video.pause();
          video.currentTime = Math.min(0.1, video.duration / 2);
          setVideoProgress(0);
          return;
        }

        automaticReplayCount.current += 1;
        video.currentTime = 0;
        video.muted = audioMuted || !preferences.reelSoundEnabled;
        void video.play().catch(() => {
          video.muted = true;
          setSoundBlocked(true);
          void video.play().catch(() => {});
        });
      }}
    />
  ) : (
    <Image src={product.image} alt={product.imageAlt} fill unoptimized={previewOnly} priority={priority} sizes={`(max-width: 760px) ${compact ? "46vw" : "100vw"}, (max-width: 1000px) 30vw, 22vw`} />
  );

  const sellerOfferActions = showSellerOfferActions && !previewOnly && product.id ? (
    <div className="product-owner-actions" role="group" aria-label={`Offer actions for ${product.name}`}>
      {!compact && <span className="product-visit-price">{product.price === null ? "On request" : formatPrice(product.price)}</span>}
      <Link className="product-owner-action" href={`/seller/products/${product.id}/offer`} aria-label={`Offer ${product.name} to the public`} title="Offer to the public"><Tag size={17} aria-hidden="true" />{compact && <span>Public offer</span>}</Link>
      <Link className="product-owner-action" href={`/seller/products/${product.id}/creator-opportunity`} aria-label={`Offer ${product.name} to a creator`} title="Offer to a creator"><UsersRound size={18} aria-hidden="true" />{compact && <span>Creator offer</span>}</Link>
    </div>
  ) : null;

  const visitLabel = (
    <>
      <span className="product-visit-price">{product.price === null ? "On request" : formatPrice(product.price)}</span>
      <span className="product-visit-meta">
        <ArrowUpRight className="product-visit-arrow" size={16} strokeWidth={3} aria-hidden="true" />
        {product.clickCount !== undefined && <span className="product-click-count" aria-label={`${product.clickCount} shop clicks`}>{formatCompactNumber(product.clickCount)}</span>}
      </span>
    </>
  );

  const compactVisitLabel = (
    <>
      <span>Visit shop</span>
      <span className="product-visit-meta">
        <ArrowUpRight className="product-visit-arrow" size={16} strokeWidth={3} aria-hidden="true" />
        {product.clickCount !== undefined && <span className="product-click-count" aria-label={`${product.clickCount} shop clicks`}>{formatCompactNumber(product.clickCount)}</span>}
      </span>
    </>
  );

  const productTitleContent = (
    <>
      {!hideSellerName && <span className="product-description-name">
        <span className="product-description-name-text">{product.maker}</span>
        {product.sellerBadge && <SellerVerificationBadge isBlue={product.sellerBadge === "blue"} />}
      </span>}
      <span className="product-description-maker">
        <span className="product-description-maker-name">{product.name}</span>
      </span>
    </>
  );

  const productTitleButton = (
    <button
      className="product-description-preview animate-pulse"
      type="button"
      aria-expanded={descriptionOpen}
      aria-controls={descriptionId}
      aria-label={descriptionOpen ? "Close product description" : "Open full product description"}
      onClick={toggleDescription}
      onPointerEnter={() => descriptionOpen && resetCloseTimer()}
    >
      {productTitleContent}
    </button>
  );

  const descriptionPanel = descriptionOpen && (
    <div
      className="description-panel"
      id={descriptionId}
      role="region"
      aria-label="Full product description"
      tabIndex={0}
      onPointerMove={resetCloseTimer}
      onPointerDown={resetCloseTimer}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeDescription();
        else resetCloseTimer();
      }}
    >
      <p title={product.description} aria-label={product.description}>
        {product.description.slice(0, visibleDetailLength)}
      </p>
      {!previewOnly && visibleDetailLength >= product.description.length && product.sellerProfileId && product.shopSlug && (
        <ShopFollowButton sellerProfileId={product.sellerProfileId} shopSlug={product.shopSlug} initialFollowing={isShopFollowed} />
      )}
    </div>
  );

  return (
    <article ref={cardRef} className="product-card" data-product-card data-compact={compact || undefined} data-preview-only={previewOnly || undefined}>
      <div className="product-image" data-media-type={product.mediaType ?? "image"} data-tone={product.overlayTone}>
        {previewOnly ? (
          <div className="product-image-link">{mediaElement}</div>
        ) : (
          <Link className="product-image-link" href={`/products/${product.slug}`} aria-label={`View details for ${product.name}`}>
            {mediaElement}
          </Link>
        )}
        {product.mediaType === "video" && product.image && (
          <div className="product-reel-controls" role="group" aria-label={`Video controls for ${product.name}`}>
            <button type="button" onClick={toggleVideoPlayback} aria-label={isPlaying ? "Pause video" : "Play video with sound"} title={isPlaying ? "Pause" : "Play with sound"}>
              {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={videoProgress}
              disabled={videoDuration <= 0}
              aria-label="Video progress"
              onChange={(event) => {
                const video = videoRef.current;
                if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
                video.currentTime = Number(event.currentTarget.value) / 100 * video.duration;
                setVideoProgress(Number(event.currentTarget.value));
              }}
            />
          </div>
        )}
        {product.image && (
          <span className="product-view-count-badge" aria-label={`${formatCompactNumber(viewCount)} views`}>
            <Eye size={12} aria-hidden="true" />
            <span aria-hidden="true">{formatCompactNumber(viewCount)}</span>
          </span>
        )}
        {isFeatured && <span className="product-featured-badge">Featured</span>}
      </div>
      <div className={`product-card-footer${compact ? " product-card-footer-compact" : ""}`} data-tone={product.overlayTone}>
        {compact ? (
          <div className="product-card-info product-card-info-compact">
            {priceBesideMaker ? (
              <div className="product-card-compact-title">
                <div className="product-card-compact-seller">
                  <span className="product-description-name">
                    <span className="product-description-name-text">{hideSellerName ? product.name : product.maker}</span>
                    {!hideSellerName && product.sellerBadge && <SellerVerificationBadge isBlue={product.sellerBadge === "blue"} />}
                  </span>
                  <span className="product-card-compact-price">{product.price === null ? "On request" : formatPrice(product.price)}</span>
                </div>
                {!hideSellerName && <span className="product-description-maker"><span className="product-description-maker-name">{product.name}</span></span>}
              </div>
            ) : (
              <>
                <span className="product-card-compact-price">{product.price === null ? "On request" : formatPrice(product.price)}</span>
                <div className="product-card-compact-title">
                  {!hideSellerName && <span className="product-description-name">
                    <span className="product-description-name-text">{product.maker}</span>
                    {product.sellerBadge && <SellerVerificationBadge isBlue={product.sellerBadge === "blue"} />}
                  </span>}
                  <span className="product-description-maker"><span className="product-description-maker-name">{product.name}</span></span>
                </div>
              </>
            )}
            <p className="product-card-compact-description" title={product.description}>{product.description}</p>
            {sellerOfferActions ?? (previewOnly ? (
              <span className="product-visit-button product-visit-button-compact">{compactVisitLabel}</span>
            ) : (
              <ShopVisitLink
                className="product-visit-button product-visit-button-compact"
                slug={product.slug}
                productName={product.name}
              >
                {compactVisitLabel}
              </ShopVisitLink>
            ))}
          </div>
        ) : (
          <div className="product-card-info">
            {product.shopSlug && !previewOnly ? (
              <Link className="advertiser-avatar-link" href={`/shops/${product.shopSlug}`} aria-label={`View ${product.maker} shop profile`}>
                {product.makerImage
                  ? <Image className="advertiser-avatar" src={product.makerImage} alt="" width={36} height={36} unoptimized />
                  : <span className="advertiser-avatar advertiser-avatar-placeholder" aria-hidden="true">{getMakerInitials(product.maker)}</span>}
              </Link>
            ) : product.makerImage ? (
              <Image className="advertiser-avatar" src={product.makerImage} alt="" width={36} height={36} unoptimized />
            ) : (
              <span className="advertiser-avatar advertiser-avatar-placeholder" aria-hidden="true">{getMakerInitials(product.maker)}</span>
            )}
            {productTitleButton}
            <div className="product-card-desktop-identity">{productTitleContent}</div>
            <p className="product-card-desktop-description">{product.description}</p>
            {sellerOfferActions ?? (previewOnly ? (
              <span className="product-visit-button">{visitLabel}</span>
            ) : (
              <ShopVisitLink
                className="product-visit-button"
                slug={product.slug}
                productName={product.name}
              >
                {visitLabel}
              </ShopVisitLink>
            ))}
          </div>
        )}
        {!compact && descriptionPanel}
      </div>
    </article>
  );
}

function getMakerInitials(maker: string) {
  return maker.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "R";
}

function getProductViewSessionId() {
  try {
    const storageKey = "rontab-product-view-session";
    const existingId = window.sessionStorage.getItem(storageKey);
    if (existingId) return existingId;

    const sessionId = window.crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, sessionId);
    return sessionId;
  } catch {
    return null;
  }
}