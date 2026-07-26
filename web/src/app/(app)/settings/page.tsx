import { NotBuiltYet } from "@/components/NotBuiltYet";

// Where the masthead's gear points. Org and location settings live in
// orgs.settings / locations.settings jsonb today and are edited in Supabase;
// this is the slot for the screen that will edit them properly.
export default function SettingsPage() {
  return <NotBuiltYet kicker="Restaurant Friend" title="Settings" />;
}
