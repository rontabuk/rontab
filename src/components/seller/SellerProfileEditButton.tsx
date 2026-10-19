import Link from "next/link";
import { Pencil } from "lucide-react";

export function SellerProfileEditButton() {
  return (
    <Link className="seller-profile-edit-button" href="/seller/profile/edit" aria-label="Edit shop profile">
      <Pencil size={14} aria-hidden="true" />Edit
    </Link>
  );
}