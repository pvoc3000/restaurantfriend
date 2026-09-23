# Square payments — setting up the pay link

The pay link (migration 119) puts a **Pay** link in a special order's invoice
email. It opens `/pay/{token}`, a public page where the customer pays the
balance due by card, Apple Pay, Google Pay or Square gift card. The payment is
charged through Square and recorded on the order automatically: a
`special_order_payments` row with the type `Square Online`, the Square payment
id as its reference, and the paid date stamped when the balance reaches zero.

Why it is built this way is in CLAUDE.md's customer-invoices thread (decided
2026-09-22). In short: Square collects, on our own page, and **the money lands
at the Square location of the shop that makes the order** (migration 120) — the
order's kitchen, or its pickup shop if the kitchen has no Square location. It
therefore shows in that shop's Square sales and the nightly journal entry,
exactly as a hand-sent Square invoice's payment does, so **do not also push a
pay-link order to QuickBooks as an invoice** — that books it twice.

**Nothing changes until Step 4.** An invoice carries a pay link only once the
Square application id is filled in on the settings screen.

---

## Step 1 — apply migrations 119 and 120

119 is applied. Paste `supabase/migrations/120_pay_link_follows_the_kitchen.sql`
into the Supabase SQL editor and run it; the SQL starts at line 40.

Nothing in Square needs creating: DF01 and DF02 already carry their Square
location ids (each shop's Operations tab on `/locations`), and those are where
the payments go.

## Step 2 — test in the Sandbox first

The `restaurantfriend` application from `docs/square-setup.md` already exists.
Open it at [developer.squareup.com](https://developer.squareup.com), and with
the environment toggle on **Sandbox**:

1. Copy the **Sandbox Application ID** (it starts `sandbox-sq0idb-`) and the
   **Sandbox Access token**.
2. Under **Locations**, copy the sandbox's default location id. The sandbox is
   a separate Square account with its own locations, so while the environment
   is Sandbox every test payment goes there, whichever shop makes the order.

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
**Sandbox location ID**.

Send yourself an invoice on a test order and pay it with Square's test card:
**4111 1111 1111 1111**, any future expiry, CVV 111, any ZIP. Square's full
list of test cards and test gift cards is under "Sandbox payments" in their
developer docs.

### The "Special Order" item (migration 123)

Every pay-link payment is sold as your existing **Special Order** item, which
has a variable price and sits in the **Special Orders** category. That files
the goods under Special Orders, the tax as sales tax and delivery as a service
charge, so the nightly journal entry books each to its own account. Without
the item id the payment still works, but reports as Uncategorized.

Square's dashboard doesn't show the id, so ask Square for it. Paste the right
token in place of `EAAA…`:

```bash
curl -s https://connect.squareup.com/v2/catalog/search -X POST -H "Authorization: Bearer EAAA…" -H "Square-Version: 2026-07-15" -H "Content-Type: application/json" -d '{"object_types":["ITEM"],"query":{"text_query":{"keywords":["Special Order"]}}}' | grep -o '"type":"ITEM_VARIATION","id":"[^"]*"'
```

Paste the printed id into **"Special Order" item variation ID**. The sandbox
has its own catalog, so for testing, create a variable-priced "Special Order"
item in the sandbox test account's dashboard (Developer dashboard → Sandbox
test accounts → Open). Run the same command against
`connect.squareupsandbox.com` with the sandbox token, and paste the result into
**Sandbox item variation ID**.

**Since 2026-09-23 these are pickers, and the curl is only a fallback.** The
`square-catalog` function (deploy it like the others) lists every item in the
catalog of the environment the pay link charges into, so on Settings → General
the fields for THAT environment offer your Square items by name, with the
category beside each. The other environment's fields stay typed boxes, since
their catalog is in an account this token can't see.

### The "Wholesale Order" item (migration 125)

A payment for **wholesale** (every order being paid was made by a standing
order, such as Cafe Knotted's week on one customer invoice) is sold as a
second item, so Square files it under its own category. Create a
variable-priced **Wholesale Order** item in a **Wholesale** category in the
Square dashboard, then pick it in **"Wholesale Order" item** (and the sandbox
twin for testing). Until you do, wholesale payments are sold as the Special
Order item as before.

Then map the new category in **Settings → Accounting → Sales from Square**:
the Wholesale row appears after the first nightly sync that sees a sale in it,
and until it's mapped (to Wholesale Income) that sale posts to Uncategorized
Income and is named on the day's receipt. It never blocks the day.

## Step 3 — switch to production

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

   On the settings screen: Environment **Production** and the production
   Application ID. The sandbox location id can stay; it is ignored in
   production.

The environment on the settings screen and `SQUARE_PAY_ENV` must match. A
sandbox card token sent to production (or the other way round) is declined.

## Step 4 — put the link in the invoice email

**Your saved invoice template does not have the link yet.** It still says
"You have been sent an online invoice from Square". A saved template takes
precedence over the built-in default, which does carry the link. On
**Settings → Messages → Invoice**, replace that sentence
with `{pay_line}`, on its own line. It becomes a short paragraph with the link.
On an order with nothing owed, or before online payment is set up, it
disappears.

## Step 5 — Apple Pay (optional; the other methods work without it)

Apple Pay only appears in Safari, and only after the domain is verified:

1. In the Square Developer dashboard → your application → **Apple Pay** →
   **Add domain**, enter the app's domain (the same host as `APP_URL`).
2. Download the domain-association file Square offers and save it as
   `web/public/.well-known/apple-developer-merchantid-domain-association`
   (no extension). Commit and deploy.
3. Back in the dashboard, press **Verify**.

Google Pay needs no setup.

---

## Refunds

A manager or the owner can refund a pay-link payment from the order's Payments
section: **Refund…** on the payment row. It asks for an amount (the whole
payment to start with, or less for a part refund) and a reason. The money goes
back through Square to the card or gift card it came from. The refund is
recorded as a negative **Square Refund** payment, so the balance follows. The
order's status and to-do are left alone.

It needs its own function deployed once:

```bash
npx supabase functions deploy square-refund --project-ref kltxioacvneshbyhxtaj
```

Only pay-link payments carry the Square payment id this needs. Payments typed
in by hand ("Square Invoice") are refunded in the Square dashboard, and their
refund recorded by hand. A payment made in sandbox can't be refunded in
production, or the other way round.

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

- **"Online payment isn't available"** on the page → the application id is
  missing on the settings screen; or the order's kitchen and pickup shop both
  lack a Square location id (or, in Sandbox, the sandbox location id is
  empty); or Square's script could not load.
- **"This link isn't valid"** on every link → the pay link's migrations are not
  applied (the browser console says `pay_by_token failed`).
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
