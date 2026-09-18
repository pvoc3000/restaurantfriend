import Link from "next/link";

export const metadata = {
  title: "Guides — restaurantfriend",
};

/** Every guide, newest first. Add a row when a guide ships. */
const GUIDES = [
  {
    href: "/guides/shift-report",
    title: "The Shift Report",
    audience: "Supervisors",
    summary:
      "Setting up your account, signing in, using the shop iPad, and filling in and sending the shift report.",
  },
];

export default function GuidesIndex() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Guides
      </h1>
      <ul className="space-y-3">
        {GUIDES.map((g) => (
          <li key={g.href}>
            <Link
              href={g.href}
              className="block border border-ink bg-white px-4 py-3 hover:bg-neutral-100"
            >
              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">
                {g.audience}
              </span>
              <span className="block text-[18px] font-bold">{g.title}</span>
              <span className="block text-[14px] text-muted">{g.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
