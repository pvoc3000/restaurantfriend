// Where a pay-period record lives, and how you get back to the list.
//
// One function, because the same string feeds BOTH the row's link and the found
// set the list publishes for the record book — if those two ever disagree the
// book walks you somewhere the list wasn't pointing (the `vendorDetailHref`
// rule).
//
// Separate from `lib/payPeriods.ts` on purpose: that module is pure arithmetic
// over plain data and is compiled by the fixture harness, which has no reason
// to pull in the breadcrumb machinery. Same split `lib/locations.ts` makes.

import { withFrom, type Crumb } from "./breadcrumbs";

export const PAY_PERIODS_CRUMB: Crumb = { href: "/pay-periods", label: "Pay Periods" };

export function payPeriodDetailHref(id: string): string {
  return withFrom(`/pay-periods/${id}`, PAY_PERIODS_CRUMB);
}
