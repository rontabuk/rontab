import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Gift, Tag } from "lucide-react";
import type { AvailableSellerOffer } from "@/lib/seller/available-offers";
import { formatNumber } from "@/lib/format";

export function ProfileOffers({ offers, cityId, available }: { offers: AvailableSellerOffer[]; cityId: string | null; available: boolean }) {
  return <section className="visitor-profile-offers" aria-labelledby="profile-offers-title">
    <header><h2 id="profile-offers-title">Offers for you</h2><Link href="/visitor/offers">View all<ArrowRight size={14} aria-hidden="true" /></Link></header>
    {!cityId ? <p>Choose a city on your profile to see local offers.</p> : !available ? <p>Offers are temporarily unavailable. Your points are unchanged.</p> : <>
      {(["general", "reward"] as const).map((audience) => {
        const items = offers.filter((offer) => (offer.points_cost > 0) === (audience === "reward") && offer.remainingClaims !== 0).slice(0, 2);
        return <div className="visitor-profile-offer-group" key={audience}>
          <h3>{audience === "reward" ? <Gift size={15} aria-hidden="true" /> : <Tag size={15} aria-hidden="true" />}{audience === "reward" ? "Exclusive rewards" : "Public offers"}</h3>
          {items.length ? <div className="visitor-profile-offer-items">{items.map((offer) => <Link className="visitor-profile-offer" key={offer.id} href={`/visitor/offers?view=${audience}#offer-${offer.id}`}>
            <div className="visitor-profile-offer-media">{offer.mediaDisplayUrl && (offer.media_type === "video" ? <video src={offer.mediaDisplayUrl} muted playsInline preload="metadata" aria-label={offer.title} /> : <Image src={offer.mediaDisplayUrl} alt={offer.title} fill sizes="72px" unoptimized />)}</div>
            <div><strong>{offer.title}</strong><span>{offer.benefit_details}</span><small>{offer.points_cost > 0 ? `${formatNumber(offer.points_cost)} points` : "No points needed"}</small></div>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>)}</div> : <p>No {audience === "reward" ? "exclusive rewards" : "public offers"} in your city yet.</p>}
        </div>;
      })}
    </>}
  </section>;
}