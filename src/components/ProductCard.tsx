"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { formatPrice, type Product } from "@/data/products";

export function ProductCard({ product }: { product: Product }) {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [shopClicks, setShopClicks] = useState(0);
  const [visibleDetailLength, setVisibleDetailLength] = useState(0);
  const closeTimer = useRef<number | null>(null);
  const descriptionId = `description-${product.slug}`;

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
    }, 15_000);
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

    let characterCount = 0;
    let timer: number;
    const typeNextCharacter = () => {
      characterCount = Math.min(characterCount + 1, product.detail.length);
      setVisibleDetailLength(characterCount);

      if (characterCount < product.detail.length) {
        const justTyped = product.detail[characterCount - 1];
        timer = window.setTimeout(typeNextCharacter, justTyped === " " ? 120 : 28);
      }
    };

    timer = window.setTimeout(typeNextCharacter, 50);
    return () => window.clearTimeout(timer);
  }, [descriptionOpen, product.detail]);

  return (
    <article className="product-card" data-product-card>
      <div className="product-image">
        <Image src={product.image} alt={product.imageAlt} fill unoptimized sizes="(max-width: 640px) 46vw, (max-width: 1000px) 30vw, 22vw" />
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
            <p title={product.detail} aria-label={product.detail}>
              {product.detail.slice(0, visibleDetailLength)}
            </p>
            <div className="description-click-count">
              <span>Shop clicks this session</span>
              <strong>{shopClicks}</strong>
            </div>
          </div>
        )}
        <div className="product-card-info" data-tone={product.overlayTone}>
          <Image className="advertiser-avatar" src={product.makerImage} alt="" width={36} height={36} unoptimized />
          <button
            className="product-description-preview animate-pulse"
            type="button"
            aria-expanded={descriptionOpen}
            aria-controls={descriptionId}
            aria-label={descriptionOpen ? "Close product description" : "Open full product description"}
            onClick={toggleDescription}
            onPointerEnter={() => descriptionOpen && resetCloseTimer()}
          >
            {product.description}
          </button>
          <a
            className="product-visit-button"
            href={product.externalUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Visit shop for ${product.name}`}
            onClick={() => {
              setShopClicks((count) => count + 1);
              if (descriptionOpen) resetCloseTimer();
            }}
          >
            {formatPrice(product.price)} <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
}