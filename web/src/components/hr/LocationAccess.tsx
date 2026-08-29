"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PickSet } from "@/components/ui/PickSet";
import type { Role } from "@/lib/roles";

/**
 * Which shops this member may work at — FMP's ADMIN tab access grid, at last
 * (Mark, 2026-08-29). 001 predicted the table by name and CLAUDE.md has
 * carried it as an open thread since August.
 *
 * EMPTY MEANS EVERY SHOP, which is 073's central rule and — happily —
 * `ui/PickSet`'s own semantics, so the control says "All shops" without being
 * taught to. That matters more than it looks: an empty grid is what every
 * member has the moment the migration runs, and a control that read it as
 * "no shops" would describe the whole company as locked out.
 *
 * OWNER AND ADMIN ARE NEVER RESTRICTED, so for them this states the fact
 * instead of offering a choice that `may_work_at` would ignore. A picker whose
 * answer the database discards is worse than no picker.
 *
 * There is deliberately no DEFAULT LOCATION beside it. FMP had one; Mark's own
 * reading is that it is redundant (2026-08-29) — `employees.main_location_id`
 * already assigns the shop and `org_members.last_active_location_id` carries
 * every session after the first, so a third column would be a second answer to
 * a question that has one.
 */
export function LocationAccess({
  orgId,
  userId,
  role,
  locations,
  allowed,
  editable,
  fullWidth = false,
}: {
  orgId: string;
  /** The member's auth user id — `employees.user_id`. */
  userId: string;
  role: Role | null;
  locations: { id: string; code: string; name: string }[];
  /** The location ids already on the grid. Empty = unrestricted. */
  allowed: string[];
  editable: boolean;
  /** Fill the field track, so this and the Role picker share one edge. */
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [chosen, setChosen] = useState<string[]>(allowed);
  const [failed, setFailed] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const unrestrictedByRole = role === "owner" || role === "admin";

  function save(next: string[]) {
    const before = chosen;
    setChosen(next);
    startTransition(async () => {
      // Delete-then-insert, because PostgREST has no transaction and the set is
      // the unit being written rather than any one row. The failure direction
      // is deliberate: a delete that succeeds and an insert that fails leaves
      // the member UNRESTRICTED, which is the safe way round — it shows them
      // more than intended rather than locking them out of the shop they are
      // standing in, and the screen says so.
      const del = await supabase
        .from("location_members")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .select("location_id");
      if (del.error) {
        setFailed(del.error.message);
        setChosen(before);
        return;
      }

      if (next.length > 0) {
        const ins = await supabase
          .from("location_members")
          .insert(next.map((location_id) => ({ org_id: orgId, user_id: userId, location_id })))
          .select("location_id");
        if (ins.error) {
          setFailed(
            `${ins.error.message} — this member is unrestricted until that is fixed.`
          );
          setChosen([]);
          router.refresh();
          return;
        }
      }

      setFailed(null);
      router.refresh();
    });
  }

  if (unrestrictedByRole) {
    return (
      <p className="text-sm text-muted">
        Every shop &mdash; a manager&rsquo;s access is not restricted by shop.
      </p>
    );
  }

  if (!editable) {
    return (
      <p className="text-sm">
        {chosen.length === 0
          ? "Every shop"
          : locations
              .filter((l) => chosen.includes(l.id))
              .map((l) => l.code)
              .join(", ")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <PickSet
        options={locations.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
        value={chosen}
        onChange={save}
        allLabel="All shops"
        label="Which shops this member may work at"
        noun="shop"
        className={fullWidth ? "w-full" : ""}
      />
      {failed ? <p className="text-sm text-accent">{failed}</p> : null}
    </div>
  );
}
