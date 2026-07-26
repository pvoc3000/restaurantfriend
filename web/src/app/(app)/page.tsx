import Link from "next/link";
import { getAppSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getAppSession();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {session.activeLocation
            ? `${session.activeLocation.code} — ${session.activeLocation.name}`
            : "No location"}
        </h1>
        <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
          {session.email} · {session.membership.role}
        </p>
      </div>

      <p className="text-sm text-muted">
        Switch locations in the header; the choice is saved to your membership
        row.
      </p>

      <ul className="text-sm">
        <li>
          <Link
            href="/vendors"
            className="text-ink underline decoration-neutral-400 underline-offset-[3px] hover:decoration-neutral-900"
          >
            Vendors →
          </Link>
        </li>
      </ul>
    </div>
  );
}
