import { signOutSeller } from "@/app/seller/(protected)/actions";

export function SellerSignOutButton() {
  return (
    <form action={signOutSeller}>
      <button className="admin-signout-button" type="submit">Sign out</button>
    </form>
  );
}