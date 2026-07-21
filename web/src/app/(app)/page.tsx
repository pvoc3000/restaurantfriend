import Link from "next/link";
import { getAppSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getAppSession();

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">
        Working at{" "}
        {session.activeLocation
          ? `${session.activeLocation.code} — ${session.activeLocation.name}`
          : "no location"}
      </h1>

      <p className="text-sm text-neutral-600">
        Signed in as {session.email} ({session.membership.role}). Switch
        locations in the header; the choice is saved to your membership row.
      </p>

      <ul className="text-sm">
        <li>
          <Link href="/vendors" className="text-blue-700 hover:underline">
            Vendors →
          </Link>
        </li>
      </ul>
    </div>
  );
}
