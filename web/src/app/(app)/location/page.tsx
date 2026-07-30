import { LocationDetail } from "./LocationDetail";

// The body lives in LocationDetail; this page is its shell, like the other
// detail screens. Singular and id-less on purpose: it is always the location
// you're working at, and the header switcher — which lists closed locations
// too — is how you get to a different one (Mark, 2026-07-30).
export default function LocationPage() {
  return <LocationDetail />;
}
