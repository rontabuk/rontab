"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Image as ImageIcon, Play, Volume2, VolumeX } from "lucide-react";
import type { Product } from "@/data/products";
import { ShopFollowButton } from "@/components/ShopFollowButton";
import { ShopVisitLink } from "@/components/ShopVisitLink";
import { formatCompactNumber, formatPrice } from "@/lib/format";

export function ProductCard({
  product,
  isFeatured = false,
  previewOnly = false,
  showUploadPlaceholder = false,
  isShopFollowed = false,
}: {
  product: Product;
  isFeatured?: boolean;
  previewOnly?: boolean;
  showUploadPlaceholder?: boolean;
  isShopFollowed?: boolean;
}) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [visibleDetailLength, setVisibleDetailLength] = useState(0);
  const [previewMuted, setPreviewMuted] = useState(true);
  const closeTimer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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

  useEffect(() => () => clearCloseTimer(), []);

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

    if (previewOnly) {
      void video.play().catch(() => {});
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void video.play().catch(() => {});
      else video.pause();
    }, { rootMargin: "100px" });

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, [previewOnly, product.mediaType]);

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
      loop
      muted={previewOnly ? previewMuted : true}
      playsInline
      preload="none"
    />
  ) : (
    <Image src={product.image} alt={product.imageAlt} fill unoptimized sizes="(max-width: 640px) 46vw, (max-width: 1000px) 30vw, 22vw" />
  );

  const visitLabel = (
    <>
      <span className="product-visit-price">{product.price === null ? "On request" : formatPrice(product.price)}</span>
      <span className="product-visit-meta">
        <ArrowUpRight className="product-visit-arrow" size={16} strokeWidth={3} aria-hidden="true" />
        {product.clickCount !== undefined && <span className="product-click-count" aria-label={`${product.clickCount} shop clicks`}>{formatCompactNumber(product.clickCount)}</span>}
      </span>
    </>
  );

  return (
    <article className="product-card" data-product-card data-preview-only={previewOnly || undefined}>
      <div className="product-image" data-media-type={product.mediaType ?? "image"}>
        {previewOnly ? (
          <div className="product-image-link">{mediaElement}</div>
        ) : (
          <Link className="product-image-link" href={`/products/${product.slug}`} aria-label={`View details for ${product.name}`}>
            {mediaElement}
          </Link>
        )}
        {product.image && (
          <span className="product-media-badge">
            {product.mediaType === "video" ? <Play size={11} fill="currentColor" aria-hidden="true" /> : <ImageIcon size={12} aria-hidden="true" />}
            {product.mediaType === "video" ? "Reel" : "Image"}
          </span>
        )}
        {isFeatured && <span className="product-featured-badge">Featured</span>}
        {previewOnly && product.mediaType === "video" && (
          <button
            className="product-preview-audio-toggle"
            type="button"
            aria-label={previewMuted ? "Enable preview sound" : "Mute preview"}
            aria-pressed={!previewMuted}
            title={previewMuted ? "Enable sound" : "Mute sound"}
            onClick={() => setPreviewMuted((muted) => !muted)}
          >
            {previewMuted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          </button>
        )}
        {descriptionOpen && (
          <div
            className="description-panel"
            data-tone={product.overlayTone}
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
        )}
        <div className="product-card-info" data-tone={product.overlayTone}>
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
          <button
            className="product-description-preview animate-pulse"
            type="button"
            aria-expanded={descriptionOpen}
            aria-controls={descriptionId}
            aria-label={descriptionOpen ? "Close product description" : "Open full product description"}
            onClick={toggleDescription}
            onPointerEnter={() => descriptionOpen && resetCloseTimer()}
          >
            <span className="product-description-name">{product.name}</span>
            <span className="product-description-maker">{product.maker}</span>
          </button>
          {previewOnly ? (
            <span className="product-visit-button">{visitLabel}</span>
          ) : (
            <ShopVisitLink
              className="product-visit-button"
              slug={product.slug}
              productName={product.name}
            >
              {visitLabel}
            </ShopVisitLink>
          )}
        </div>
      </div>
    </article>
  );
}

function getMakerInitials(maker: string) {
  return maker.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "R";
}