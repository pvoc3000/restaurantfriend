import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import type { RawSearchParams } from "@/lib/itemFilters";
import { parseTrail } from "@/lib/breadcrumbs";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  fetchPoWithLines,
  fetchSignedAttachments,
} from "@/lib/purchaseOrderQueries";
import { Receiving } from "@/components/purchasing/Receiving";

/** The receiving screen's whole body — every query lives here. */
export async function ReceivingView({
  id,
  rawParams,
}: {
  id: string;
  rawParams: RawSearchParams;
}) {
  const trail = parseTrail(rawParams, { href: "/purchase-orders", label: "POs" });
  const session = await getAppSession();
  const supabase = await createClient();

  // A lazy thenable sends nothing until it's awaited, so calling .then() on the
  // first is what puts these on the wire together rather than one after the
  // other.
  const attachmentsPromise = fetchSignedAttachments(supabase, id).then((r) => r);
  const { order, lines, error, lineError } = await fetchPoWithLines(supabase, id);
  const { attachments, error: attachmentError } = await attachmentsPromise;

  if (error) {
    return <p className="text-sm text-accent">Could not load order: {error}</p>;
  }
  if (!order) notFound();

  // The PO's OWN location, resolved over the full list rather than the active
  // one — you can be working at DF01 and open an order that belongs to DF02,
  // and it should say so instead of an em dash (CLAUDE.md rule 3).
  const locationCode =
    session.locations.find((l) => l.id === order.location_id)?.code ?? "—";

  // Every write on this screen is purchaser+, which is what the RLS policies
  // allow. Below that it renders read-only rather than 404ing: a staff member
  // seeing what arrived is legitimate, and offering controls the database would
  // reject is not.
  const canReceive = ["owner", "admin", "purchaser"].includes(session.membership.role);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[...trail, { href: `/purchase-orders/${id}`, label: order.po_number }]}
        current="Receive"
      />

      {lineError ? (
        <p className="text-sm text-accent">Could not load order lines: {lineError}</p>
      ) : (
        <Receiving
          order={order}
          lines={lines}
          locationCode={locationCode}
          orgId={session.membership.org_id}
          canReceive={canReceive}
          attachments={attachments}
          // Said out loud rather than swallowed: if this query fails on its own
          // columns, an empty document pane would read as "no invoice yet"
          // instead of "this isn't wired up at this end".
          attachmentError={attachmentError}
        />
      )}
    </div>
  );
}
