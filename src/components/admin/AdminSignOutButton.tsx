import { signOutAdmin } from "@/app/admin/(protected)/actions";

export function AdminSignOutButton() {
  return (
    <form action={signOutAdmin}>
      <button className="admin-signout-button" type="submit">Sign out</button>
    </form>
  );
}