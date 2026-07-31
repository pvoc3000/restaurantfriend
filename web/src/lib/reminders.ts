// Order reminders — FMP's Messages table, rebuilt as spec §1 describes it:
// "a note attached to a date + location (optionally a vendor or item) that
// surfaces when the relevant order guide opens". Rarely triggered, valued when
// it is: the thing you'd otherwise remember on Tuesday about a Monday order.
//
// The table (`purchase_reminders`, from migration 001 via 005's rename) has been
// there since the beginning with nothing reading or writing it. Migration 018
// adds the index the guide's every-load query needs.

export type Reminder = {
  id: string;
  show_on_date: string;
  message: string;
  vendor_id: string | null;
  inventory_item_id: string | null;
  vendors: { id: string; name: string } | null;
  inventory_items: { id: string; name: string } | null;
};

/** What the guide selects. Kept here so the page and the component agree. */
export const REMINDER_SELECT = `
  id, show_on_date, message, vendor_id, inventory_item_id,
  vendors ( id, name ), inventory_items ( id, name )
`;

/**
 * How overdue a reminder is, in days, for the "3 days ago" chip.
 *
 * Both dates are plain `YYYY-MM-DD` strings — `guideDate` already comes from
 * the ORG's timezone (see lib/orderGuide's guideToday), so this must not go
 * near `new Date()` on the server, which would reintroduce exactly the UTC
 * drift that migration 007 exists to prevent. Parsed as UTC midnight on both
 * sides, which makes the subtraction a pure calendar-day count.
 */
export function daysOverdue(showOnDate: string, guideDate: string): number {
  const a = Date.parse(`${showOnDate}T00:00:00Z`);
  const b = Date.parse(`${guideDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
