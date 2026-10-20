import { Star } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { formatDate } from "@/lib/format";
import type { FormState } from "@/lib/form-state";
import "./collaboration.css";

const progressSteps = [
  { status: "open", label: "Offers" },
  { status: "awarded", label: "Creator selected" },
  { status: "delivered", label: "Delivered" },
  { status: "completed", label: "Completed" },
] as const;

export const opportunityStatusLabels: Record<string, string> = {
  open: "Open for offers",
  awarded: "In progress",
  delivered: "Delivered · awaiting seller",
  completed: "Completed",
  closed: "Closed",
};

export function CollaborationProgress({ status }: { status: string }) {
  if (status === "closed") return null;
  const currentIndex = progressSteps.findIndex((step) => step.status === status);
  return (
    <ol className="collaboration-progress" aria-label="Collaboration progress">
      {progressSteps.map((step, index) => (
        <li key={step.status} className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : undefined} aria-current={index === currentIndex ? "step" : undefined}>
          <span aria-hidden="true">{index + 1}</span>{step.label}
        </li>
      ))}
    </ol>
  );
}

export function RatingSummary({ average, count, label = "collaboration rating" }: { average?: number | null; count?: number | null; label?: string }) {
  if (!count) return <span className="collaboration-rating is-empty">No ratings yet</span>;
  return (
    <span className="collaboration-rating" aria-label={`${average} out of 5 ${label} from ${count} ratings`}>
      <Star size={13} aria-hidden="true" />
      <strong>{Number(average).toFixed(1)}</strong>
      <small>({count} {count === 1 ? "rating" : "ratings"})</small>
    </span>
  );
}

export function CollaborationRatingForm({
  action,
  title,
  hiddenFields,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  title: string;
  hiddenFields: Record<string, string>;
}) {
  return (
    <ActionForm className="collaboration-rating-form" action={action}>
      {Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <h3>{title}</h3>
      <fieldset>
        <legend>Your rating</legend>
        <div className="collaboration-rating-stars">
          {[5, 4, 3, 2, 1].map((value) => (
            <label key={value}>
              <input type="radio" name="rating" value={value} required />
              <span>{value} <Star size={12} aria-hidden="true" /></span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>Comment (optional)<textarea name="comment" maxLength={500} rows={3} placeholder="Share what went well or what could improve." /></label>
      <button type="submit">Submit rating</button>
    </ActionForm>
  );
}

export function CollaborationReviews({
  reviews,
}: {
  reviews: { reviewer_role: "seller" | "creator"; rating: number; comment: string | null; created_at: string }[];
}) {
  if (!reviews.length) return null;
  return (
    <ul className="collaboration-reviews">
      {reviews.map((review) => (
        <li key={review.reviewer_role}>
          <p><strong>{review.reviewer_role === "seller" ? "Seller rating" : "Creator rating"}</strong><span className="collaboration-rating"><Star size={13} aria-hidden="true" /><strong>{review.rating}</strong><small>/ 5</small></span></p>
          {review.comment && <p>{review.comment}</p>}
          <small>{formatDate(review.created_at)}</small>
        </li>
      ))}
    </ul>
  );
}
