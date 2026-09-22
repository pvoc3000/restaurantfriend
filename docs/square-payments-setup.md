# Square payments — setting up the pay link

The pay link (migration 119) puts a **Pay** link in a special order's invoice
email. It opens `/pay/{token}`, a public page where the customer pays the
balance due by card, Apple Pay, Google Pay or Square gift card. The payment is
charged through Square and recorded on the order automatically: a
`special_order_payments` row with the type `Square Online`, the Square payment
id as its reference, and the paid date stamped when the balance reaches zero.

Why it is built this way is in CLAUDE.md's customer-invoices thread (decided
2026-09-22). In short: Square collects, on our own page, into a Square
location of its own, so invoiced sales never appear in a shop's daily figures.

**Nothing changes until Step 5.** An invoice carries a pay link only once both
Square ids are filled in on the settings screen.

---

## Step 1 — apply migration 119

Paste `supabase/migrations/119_pay_link.sql` into the Supabase SQL editor and
run it. The SQL starts at line 75; everything above that is comment.

Check it by running these in the SQL editor:

```sql
select public.pay_by_token('nope');   -- {"state": "unknown"}
```

## Step 2 — make a Square location for invoiced sales

In the Square dashboard: **Settings → Account & Settings → Business →
Locations → Create location**. Name it something like `Orders`. Every pay-link
payment lands here and nowhere else.

**Do not add it to any shop on `/locations`.** `sync-square-sales` only reads
the Square locations that a shop's Operations tab names, and this one staying
unnamed is exactly what keeps a $2,000 wedding order out of DF01's Tuesday.

Optionally, point this location's payouts at their own bank account (Square:
**Balance → Transfers**, per location). That is only needed if you want its
deposits kept apart as well as its reports.

Copy its **Location ID** (Developer dashboard → your application → Locations,
or the dashboard's location page). It looks like `L8Y2…`.

## Step 3 — test in the Sandbox first

The `restaurantfriend` application from `docs/square-setup.md` already exists.
Open it at [developer.squareup.com](https://developer.squareup.com), and with
the environment toggle on **Sandbox**:

1. Copy the **Sandbox Application ID** (it starts `sandbox-sq0idb-`) and the
   **Sandbox Access token**.
2. Under **Locations**, copy the sandbox's default location id. The sandbox has
   its own locations, separate from your real ones.

Set the function's secrets. These are separate from `sync-square-sales`'s
`SQUARE_ACCESS_TOKEN` on purpose: a sandbox token there would silently empty
the nightly sales sync.

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj SQUARE_PAY_ENV=sandbox
```

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj SQUARE_PAY_ACCESS_TOKEN='EAAA…sandbox…'
```

Deploy the new function, and redeploy the email function, which now retires
old pay links when an invoice is re-sent:

```bash
npx supabase functions deploy square-pay --project-ref kltxioacvneshbyhxtaj
```

```bash
npx supabase functions deploy send-special-order-email --project-ref kltxioacvneshbyhxtaj
```

Then go to **Settings → General → Online payment (Square)**
and fill in: Environment **Sandbox**, the sandbox Application ID, and the
sandbox location id.

Send yourself an invoice on a test order and pay it with Square's test card:
**4111 1111 1111 1111**, any future expiry, CVV 111, any ZIP. Square's full
list of test cards and test gift cards is under "Sandbox payments" in their
developer docs.

## Step 4 — switch to production

1. In the application, switch the toggle to **Production** and copy the
   Production Application ID (`sq0idp-…`).
2. Use the production access token. The one `sync-square-sales` uses can
   charge as well as read, so it is fine to reuse it here.
3. Update the secrets and the settings screen:

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj SQUARE_PAY_ENV=production
```

```bash
npx supabase secrets set --project-ref kltxioacvneshbyhxtaj SQUARE_PAY_ACCESS_TOKEN='EAAA…'
```

   On the settings screen: Environment **Production**, the production
   Application ID, and the **Orders** location id from Step 2.

The environment on the settings screen and `SQUARE_PAY_ENV` must match. A
sandbox card token sent to production (or the other way round) is declined.

## Step 5 — put the link in the invoice email

**Your saved invoice template does not have the link yet.** It still says
"You have been sent an online invoice from Square". A saved template takes
precedence over the built-in default, which does carry the link. On
**Settings → Messages → Invoice**, replace that sentence
with `{pay_line}`, on its own line. It becomes a short paragraph with the link.
On an order with nothing owed, or before online payment is set up, it
disappears.

## Step 6 — Apple Pay (optional; the other methods work without it)

Apple Pay only appears in Safari, and only after the domain is verified:

1. In the Square Developer dashboard → your application → **Apple Pay** →
   **Add domain**, enter the app's domain (the same host as `APP_URL`).
2. Download the domain-association file Square offers and save it as
   `web/public/.well-known/apple-developer-merchantid-domain-association`
   (no extension). Commit and deploy.
3. Back in the dashboard, press **Verify**.

Google Pay needs no setup.

---

## What happens when

- **The invoice is sent** → a pay token is minted and bound to the invoice as
  sent, including its total. Any earlier pay link for the order now reads
  "This invoice has been updated".
- **The customer opens the link** → the invoice, what has been paid, and the
  **amount due** (the total at send minus every payment recorded since,
  including ones entered by hand).
- **They pay** → `square-pay` claims the link for two minutes, so a second tab
  cannot charge it too, then charges the amount due. It never takes an amount
  from the browser. It records the payment and emails a confirmation with
  Square's receipt link.
- **The order was edited after sending** → the link still charges the total as
  sent. Re-send the invoice to update it.
- **The order is cancelled or fully paid** → the link says so and offers
  nothing to pay.

## When it goes wrong

- **"Online payment isn't available"** on the page → a Square id is missing on
  the settings screen, or Square's script could not load.
- **"This link isn't valid"** on every link → migration 119 is not applied (the
  browser console says `pay_by_token failed`).
- **The payment went through but the order shows no payment** → the order's
  history has a line starting "Paid online, but…" naming the Square payment
  id. Record that payment by hand with the type `Square Online` and the id as
  its reference.
- **Every card is declined** → `SQUARE_PAY_ENV` and the settings screen's
  environment disagree, or the access token is from the other environment.
  The function's logs (Supabase → Edge Functions → square-pay → Logs) show
  Square's own error code.

## Not built yet

These are the later phases, in order:

1. ACH bank payments, with a signed Square webhook
2. Loyalty points
3. Posting the payment to QuickBooks against the pushed invoice
4. `customer_invoices`, one invoice covering several orders
5. Wholesale autopay from a saved card or bank account
