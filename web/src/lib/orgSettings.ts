/**
 * The org settings screen's sections (Mark, 2026-09-05: "break it up into
 * different tabs, with the tabpick being vertical like we do on other pages").
 * `ui/SectionNav`'s pattern, the employee record's: the tab in the URL, the
 * default writing no parameter so the screen keeps one canonical address, and
 * anything unrecognised falling back to the first tab rather than an error.
 */
export type SettingsTab = "general" | "messages" | "accounting" | "devices";

export const SETTINGS_TABS: SettingsTab[] = ["general", "messages", "accounting", "devices"];

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  general: "General",
  messages: "Messages",
  accounting: "Integrations",
  devices: "Shared devices",
};

export function parseSettingsTab(raw: string | string[] | undefined): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SETTINGS_TABS as string[]).includes(value ?? "") ? (value as SettingsTab) : "general";
}

export function settingsTabHref(tab: SettingsTab): string {
  return tab === "general" ? "/settings" : `/settings?tab=${tab}`;
}

/**
 * THE MESSAGES TAB'S OWN TABS (Mark, 2026-10-01: "the messages tab in settings
 * is getting too big… Add a horizontal tab along the top"). Grouped by WHO
 * READS THE MESSAGE, which is also the order somebody meets them:
 *   · Orders     — the customer's order papers: inquiry, quote, receipt, the
 *                  pickup/delivery paragraph they share, and the standing Cc;
 *   · Invoices   — the invoice and the payment-received note;
 *   · Delivery   — the two emails to the delivery company;
 *   · Internal   — what only the shop reads: the kitchen order, the notices
 *                  when a customer acts, and shift reports.
 * In the URL as `?tab=messages&messages=…`, the first writing no parameter.
 */
export type MessagesTab = "orders" | "invoices" | "delivery" | "internal";

export const MESSAGES_TABS: MessagesTab[] = ["orders", "invoices", "delivery", "internal"];

export const MESSAGES_TAB_LABEL: Record<MessagesTab, string> = {
  orders: "Orders",
  invoices: "Invoices",
  delivery: "Delivery",
  internal: "Internal",
};

export function parseMessagesTab(raw: string | string[] | undefined): MessagesTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (MESSAGES_TABS as string[]).includes(value ?? "") ? (value as MessagesTab) : "orders";
}

export function messagesTabHref(tab: MessagesTab): string {
  return tab === "orders" ? "/settings?tab=messages" : `/settings?tab=messages&messages=${tab}`;
}
