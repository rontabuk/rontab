import { Shield, Star } from "lucide-react";
import { getCreatorInfluenceLevel, type CreatorInfluence } from "@/lib/creator/influence";
import { formatNumber } from "@/lib/format";
import "./CreatorInfluence.css";

export function CreatorInfluenceBadge({ points }: { points: number }) {
  const { level } = getCreatorInfluenceLevel(points);
  if (level.symbol === "none") return null;
  const Icon = level.symbol === "shield" ? Shield : Star;
  const title = `${level.label}: ${formatNumber(points)} qualified first referrals. Not identity verification or a guarantee of sales.`;
  return (
    <span className={`creator-influence-badge is-${level.tone}`} title={title} aria-label={title}>
      <Icon size={16} aria-hidden="true" />
      <span>{level.label}</span>
    </span>
  );
}

export function CreatorInfluenceSummary({ influence, showProgress = false }: { influence?: CreatorInfluence; showProgress?: boolean }) {
  if (!influence) return <p className="creator-influence-unavailable" role="status">Influence data currently unavailable.</p>;
  const { level, next, remaining } = getCreatorInfluenceLevel(influence.qualified_referrals);
  return (
    <section className="creator-influence" aria-label="Rontab audience influence">
      <div className="creator-influence-heading">
        <h2>Rontab influence</h2>
        <CreatorInfluenceBadge points={influence.qualified_referrals} />
      </div>
      <dl className="creator-influence-metrics">
        <div><dt>Influence points</dt><dd>{formatNumber(influence.qualified_referrals)}</dd></div>
        <div><dt>Active referrals (30 days)</dt><dd>{formatNumber(influence.active_referrals_30d)}</dd></div>
        <div><dt>First referrals</dt><dd>{formatNumber(influence.first_referral_count)}</dd></div>
        <div><dt>Rontab fans</dt><dd>{formatNumber(influence.fan_count)}</dd></div>
      </dl>
      {showProgress && (
        <div className="creator-influence-progress">
          {next ? <><label htmlFor="creator-influence-progress">{formatNumber(remaining)} more qualified referrals to {next.label.toLowerCase()}</label><progress id="creator-influence-progress" value={influence.qualified_referrals - level.minimum} max={next.minimum - level.minimum} /></> : <p>Gold shield achieved</p>}
        </div>
      )}
      <details className="creator-influence-definition">
        <summary>Qualification & badge levels</summary>
        <p>One influence point per first-referred visitor with a verified email, an enabled market, and an earned product-visit point after attribution. Suspended accounts, sellers, creators, admins, and self-referrals are excluded. Influence points are a reputation measure only and are not spendable. Code attribution does not prove an external-platform conversion or guarantee sales.</p>
        <p>Bronze star: 100. Silver star: 500. Gold star: 1,000. Silver shield: 5,000. Gold shield: 10,000.</p>
      </details>
    </section>
  );
}