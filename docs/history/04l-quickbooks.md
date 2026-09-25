<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4l. ✅ **QUICKBOOKS ONLINE — migrations 081–086, ALL APPLIED, and LIVE ON THE
   REAL BOOKS since 2026-09-02.** Mark: "Research how to link with quickbooks
   online so we can send invoices we generate in the app to my QBO account for
   payment."
   Approved vendor bills go to QuickBooks as **Bills**, with their coding and
   their scanned invoice attached; special orders go as **Invoices** with the
   customer's own sheet attached. **Nothing is collected or emailed by
   QuickBooks** — no Payments merchant account, no Intuit-sent documents; the
   app keeps sending its own. Setup and the switch procedure:
   **`docs/quickbooks-setup.md`**.
   Mark's settled decisions: both directions, A/P first; QBO **records only**;
   **one summary line per document** (two for A/R, see the tax split); status
   **pulled by a button**, no webhooks and no cron; **one company file for both
   shops**; **every QBO setting on the vendor's per-location row, the QBO vendor
   included**; and **QuickBooks computes the sales tax and we warn on a
   mismatch** — his first choice was to send ours, and three probes proved QBO
   drops it, then overrides it.
   **THE A/R HALF IS PROVISIONAL AND COMES OUT IF SQUARE INVOICING LANDS**
   (Mark, 2026-09-02). Special-order collection is expected to move to Square
   invoicing, which syncs to QBO on its own — at which point pushing an Invoice
   from here would book the same revenue twice. It is NOT double-counted today,
   which is Mark's own reading of his books: another app records and categorises
   Square SALES in QBO nightly, and special orders are not invoiced through
   Square yet. **Removing it is about an hour** and touches nothing shared — the
   `push_invoice` mode, `PushOrderToQuickBooks`, `CustomerAccounting`, the
   customers/items/tax-code lookups, two settings pickers and five pure
   functions. Everything expensive is A/P's and stays. Leave the migrations:
   nullable columns nobody writes cost nothing (082's precedent).
   **THE CONNECTION KEPT "DISCONNECTING" AND IT WAS US** (found 2026-09-12,
   when the invoice menu's QuickBooks rows vanished). The live row read
   `disconnected` with Intuit's `invalid_grant` refusal — not the Disconnect
   button, which clears the token expiry, and a refresh had plainly succeeded a
   day after the 2026-09-08 reconnect. Two causes, both in `_shared/qbo.ts`:
   **a race** — Settings → Accounting and the vendor record's QuickBooks block
   each fired FOUR calls at once, so after an idle hour four requests refreshed
   with one token, the losers were refused, and each refusal marked the
   connection disconnected OVER the good token the winner had saved; and
   **a stale object** — a request making several calls never updated `conn`
   after refreshing, so its second call re-spent the dead token. Fixed and
   DEPLOYED the same day (`qbo-sync`, and `qbo-oauth` with `--no-verify-jwt`):
   a refresh updates `conn` in place; the save is compare-and-swap on the spent
   refresh token; a refusal re-reads the row (four tries over ~1.5s) and adopts
   a token another request rotated; and `markDisconnected` takes `onlyIf` so it
   only ends the connection against the token that actually failed (the 401
   path passes the access token it used). The two screens also make their
   calls one after another now. **A connection already marked still needs one
   reconnect.**
   **THE CREDENTIAL STORY IS THE THING TO GET RIGHT, because Intuit refused the
   production-key questionnaire over it** (2026-09-02): *"Any Intuit credentials
   including customer IDs, app client ID and client secret must be stored
   securely and not be exposed within your app."* Two of the three were true of
   this app and both are fixed:
   **CUSTOMER ID IS INTUIT'S NAME FOR THE REALM ID.**
   `accounting_connection_status()` returned it to every org member, so it rode
   the RPC response on every settings load and was RENDERED whenever the company
   name had not arrived — which is every fresh open ("COMPANY
   9341457832962518"). **086 drops it from the function** and returns `connected`
   instead; the screen shows the NAME, which `meta` already fetches.
   **THE CLIENT ID WAS IN A RESPONSE WE SERVE.** `authorize_url` built the whole
   Intuit consent URL and handed it back as JSON. It now returns the handshake
   token alone and **`qbo-oauth?start=<state>` builds the URL where the secret
   lives and 302s**, so the client id appears only in the address bar during the
   hop to Intuit — the protocol itself, and never in anything this app serves.
   That start path **spends no state**: it is the callback's to consume, in the
   same UPDATE that verifies it.
   The third was already true: the client id and secret have only ever been the
   edge secret **`QBO_CREDS`**, the tokens live in a table with RLS and **ZERO
   policies** (081, deliberately — the row holds a live bearer credential), no
   credential has ever been committed, and failures log a status, Intuit's
   `intuit_tid`, a query-stripped path and Intuit's own fault text.
   **On the questionnaire this is Security Q3, and the answer is YES.** Q2
   (security team) and Q4 (MFA) are honestly No and must stay No — Intuit
   rejected on one item, and a false answer to a question they did not ask is a
   worse position than an honest No.
   **THE SEVEN MEASURED TRAPS**, every one found by pushing rather than reading,
   and three of them the SAME mistake — reassembling a ref and dropping a field,
   each only visible on a SECOND push:
   **(a) A REFUSED ATTACHMENT RETURNS HTTP 200**, with the fault inside
   `AttachableResponse[0].Fault` — `extract-invoice`'s `stop_reason: "refusal"`
   shape. Read the ITEM, never the status: believed once, a refusal stores
   nothing, reports success, and the next push attaches a second copy.
   **(b) A SECOND UPLOAD MAKES A SECOND COPY.** There is no upsert. What has
   gone up is recorded on the document's own `external_ref`, keyed by OUR row id
   and never by a filename somebody can rename inside QuickBooks. A bill's scan
   never changes and is left alone; the customer sheet is re-rendered from live
   figures, so its previous copy is DELETED first.
   **(c) ATTACHING A FILE BUMPS THE PARENT'S OWN SyncToken**, and so does
   deleting one. The push response carries the token from BEFORE that, so
   recording it leaves the row one behind and the NEXT push fails 5010 —
   measured on Bill 145, stored 9 against a live 10. Both modes re-read the
   token after attachment work, and only then.
   **(d) `push_invoice` RETURNED NO `sync_token` AT ALL**, which the attachment
   record exposed rather than caused. **A ref with no token is not a failed
   update, it is a CREATE** — a second invoice in a customer's books, from
   pressing Update. So neither caller rebuilds a ref: both push modes RETURN the
   ref they recorded and the caller adds to it. Fixture-pinned through `qboRef`
   and `pushMode`.
   **(e) A PUSH MUST NOT FORGET WHAT IT ALREADY ATTACHED.** 081's merge is
   `external_ref || p_ref` at the TOP level, so it replaces the whole `qbo`
   branch — a ref built from the push response alone ERASES the attachment
   record, and the next push duplicates the file. Both modes carry it forward.
   **(f) A STALE DOCUMENT RE-READS AND PUSHES AGAIN, ONCE** (`postDocument`).
   Anything touching the document in QuickBooks moves its token — a bookkeeper
   editing the bill, or an attachment — and before this the refusal was
   UNRECOVERABLE FROM THE APP. Once, and only on an UPDATE: a create names no Id
   and cannot be stale, and retrying one that failed for another reason writes
   it twice. Matched on the CODE (5010), never the message, which names a
   colleague ("You and Craig Carlson were working on this at the same time").
   It SAYS SO afterwards — a silent retry hides that your update landed on top
   of a change you have not seen.
   **(g) QUICKBOOKS WILL NOT TAKE WEBP** (fault 6041) though `ATTACHMENT_ACCEPT`
   offers it, so it gets its own sentence — the one refusal somebody can walk
   into having done nothing wrong. Latent: every filed document is a PDF.
   Also measured: **the SyncToken is IGNORED on an Attachable delete** (a
   deliberately wrong "9" deleted it anyway), so replacing the sheet needs no
   extra round trip; a 4.57 MB scan uploads in 4.1s; and **QBO wants `VendorRef`
   and `Line` even on a sparse update** or it faults 2020 and never reaches the
   token check — which is why the first stale-object probe proved nothing.
   **THE TAX SPLIT IS TWO LINES AND THE SPLIT IS THE POINT.** `orderTotals` does
   not tax delivery or rush, and a US line's `TaxCodeRef` may only be TAX or NON
   (measured), so an invoice goes as a taxable line and a `— not taxed` line.
   `invoiceSplit` derives the non-taxable half **by SUBTRACTION** so the two
   always sum to total − tax. An EMPTY `TxnTaxDetail` computes NOTHING — it must
   NAME a code, and 0 of 5 sandbox customers carried a `DefaultTaxCodeRef` to
   fall back on, which is what **084** exists for.
   **`taxDisagreement` LIVES IN `lib/quickbooks` AND THE FUNCTION DOES NOT
   DECIDE.** It shipped as an inline twin in `qbo-sync` while the fixture-tested
   one had NO CALLER — 016's `nextDeliveryDate` trap, where the tested
   implementation is not the one in force. Deno cannot import from `web/`, so
   the cure is not a shared module: it is to stop deciding there. `push_invoice`
   returns the figure QuickBooks decided and the caller words the sentence. Only
   compose a warning in the function for something the CLIENT cannot see — the
   coding QuickBooks accepted and then silently dropped, which is what
   `push_bill`'s own warnings are.
   **A CLASS RIDES THE LINE AND A LOCATION RIDES THE HEADER.** A Bill takes its
   `ClassRef` per expense line — a header one is accepted and ignored — and its
   `DepartmentRef` on the header. QuickBooks accepts either and **SILENTLY
   DISCARDS it when the matching preference is off**, with a 200 and no fault,
   so both pushes compare what QuickBooks KEPT against what was sent and warn.
   Found on Mark's own first bill, where the class stuck and the location
   vanished. A **create** honours `TrackDepartments` where a sparse **update**
   skips the check, which is why an early probe wrongly cleared the preference.
   **A REALM CHANGE FORGETS EVERY REALM-SCOPED ID, and only on a CHANGE** —
   reconnecting the same company keeps mappings that are still correct. It
   clears `vendor_locations` (the account, QBO Location, Class and the QBO
   vendor), `customers`, and — the half with money in it — the QuickBooks id,
   token and attachment ids on every pushed bill and invoice, with `synced_at`.
   **The document ids are the serious one**: left in place, `pushMode` reads the
   id and answers "update", so pressing Send after a switch would overwrite
   whatever document happens to carry that id in the REAL books and the bill
   would never be created. **Every clear is checked and a partial one is named
   on the settings banner** — nothing can retry once the realm has moved.
   It was clearing `vendors`, which **083 made unread**; measured before fixing,
   it cleared 2 rows nobody reads and left 20 live ids pointing at the old
   company.
   **THE ENVIRONMENT PICKER IS SHOWN WHILE CONNECTED**, which is the whole point
   of it: it used to render only when disconnected, so the one moment anybody
   needs it — moving a working sandbox connection to the real books — it was
   absent and Reconnect silently reused "sandbox". The OAuth endpoints are
   SHARED, so that fails in the worst way available: signing in SUCCEEDS and
   then every call goes to the sandbox host with a production realm.
   **Two edge functions, and `_shared` is compiled in AT DEPLOY TIME, so they go
   together.** `qbo-oauth` is the callback and the consent hop and **must be
   deployed `--no-verify-jwt`** — Intuit's callback is a top-level browser
   navigation with no header to attach, so with verification on it is 401'd
   before a line runs and the symptom is "authorize works, the app never
   connects". `qbo-sync` is everything a signed-in person asks for, on the
   CALLER's JWT, with the service_role escalation **bounded to the token row**.
   **THE MIGRATION LEDGER.** *Probe, don't read this line; it has been wrong in
   both directions for four different migrations.*
   **081** the connection table (RLS, **zero policies**), its three definer
   functions, `vendors`/`customers.external_ref`, `special_orders.synced_at` ·
   **082** `vendors.expense_account_ref` — **superseded by 083 and now read by
   nobody**, kept because it ran · **083** the six QBO columns on
   `vendor_locations`, which is where every mapping actually lives · **084**
   `accounting_connections.tax_code_ref` · **085** widens
   `accounting_connection_status()` to RETURN 084's columns · **086** drops
   `realm_id` from it and returns `connected` · **088**
   `vendor_invoices.qbo_balance` + `qbo_checked_at`, the A/P payment cache.
   Probe 088 with `select column_name from information_schema.columns where
   table_name = 'vendor_invoices' and column_name in ('qbo_balance',
   'qbo_checked_at')` — two rows.
   **084 WITHOUT 085 IS THE WORST STATE and it shipped that way**: the write
   goes through `qbo-sync`, which sees the column, so Settings saves the tax
   code and reports success — while every reader goes through the status
   function, which 084 did not widen. The picker reads "Choose a tax code" and
   the first TAXABLE order refuses by naming the screen you just used. A
   ZERO-TAX order does not show it, which is why phase 4 was walked clean
   against wholesale bagels. **`create or replace` cannot change a
   `returns table` column list** — 085 and 086 both drop and recreate, and a
   dropped function takes its privileges, so both revokes and the grant are
   restated each time.
   Probes: `select pg_get_function_result(oid) from pg_proc where proname =
   'accounting_connection_status'` names `connected` and NO realm or token;
   `select count(*) from pg_proc where proname = 'accounting_connection_status'`
   is **1** (two means an overload is live — 033's `freeze_pay_period` trap);
   `select count(*) from pg_policy where polrelid =
   'public.accounting_connections'::regclass` is **0**, and must stay 0.
   **A FUNCTION'S OUT PARAMETERS ARE NOT IN `information_schema.columns`**, so
   the obvious "does it leak a token column" probe returns ZERO ROWS for a
   healthy function and passes vacuously. Use `pg_get_function_result`.
   **LIVE ON THE REAL BOOKS 2026-09-02** — realm `123145755476194`, Donut
   Friend, Inc. The switch was verified afterwards rather than trusted: vendors,
   customers and pushed orders all cleared to zero, the two surviving vendor
   mappings were provably production values (account `601 Food COGs` against the
   sandbox's `80`), and Mark's first real bill read back from QuickBooks with
   **all five fields intact** — vendor, account, class, location and a 3.70 MB
   scan attached, `IncludeOnSend false`.
   **NOT BUILT, deliberately:** any A/R status pull. `special_order_payments`
   already answers whether a customer paid, and two sources for one customer's
   money is the shape this codebase treats as a bug. **A/P is the opposite and
   is the right place to pull** — the app has no vendor payments table by
   design, so QuickBooks is the only place that fact exists. `refresh_status`
   already returns `Balance`. **BUILT 2026-09-02 — see the status ladder
   below**; the decision it was waiting on was whether to store the figure WITH
   its `checked_at`, and the answer is yes: the rule against storing was written
   for a bare figure rendered as current, which is a different thing.
   **SHIPPED 2026-09-02 — THE STATUS LADDER, Open · Approved · Submitted ·
   Paid** (Mark: "when we push a bill to QBO, the status should be 'Submitted'
   as in Submitted for payment. When it's paid, the status should be 'Paid'").
   **THE TOP TWO RUNGS ARE DERIVED AND THERE IS NO NEW STATUS COLUMN**
   (`billStage` in `lib/invoices`): `status` still holds only what WE decided —
   open, approved, void — and the ladder is that plus what QuickBooks last said.
   A status column repeating `synced_at` would be two answers to one question.
   **`void` IS TESTED FIRST**, because it is an exit from the ladder rather than
   a position on it, and a voided bill that still carries a link would otherwise
   read as Submitted. **PAID IS A NUMERIC ZERO AND NOTHING ELSE** — null is
   "nobody asked" or "QuickBooks no longer has it", neither of which is paid,
   which is the whole of 088's tri-state.
   **088 STORES THE BALANCE, WHICH INVERTS DECISION 7, AND `qbo_checked_at` IS
   WHY.** That decision refused to store a QBO figure because it would be "stale
   the moment it lands and rendered as if current" — true of a bare number, and
   the fix is the timestamp rather than the absence: `billPaymentNote` returns
   NOTHING without one, so no claim about payment can ever appear without the
   day it was true. It is a CACHE OF THEIR FACT, never ours — this app still
   records no vendor payment, which is what keeps QuickBooks the single source.
   A bill can be PART paid, so "Submitted · $412 still owed" is a sentence
   rather than a fifth rung.
   **"Submitted" can only ever mean ON THE BOOKS, never sent for payment** —
   QuickBooks Bill Pay is a QBO interface feature and the Accounting API can
   RECORD a `BillPayment` but not initiate one.
   **QuickBooks Payments was considered and declined** (2026-09-02): it would
   mean a second merchant account beside Square, it fights the document flow
   this app deliberately owns (its own quote PDF, the `/q/{token}` approval, the
   signed artifact), and it would make QuickBooks a second writer of a fact
   `special_order_payments` already owns. The live question there is **ACH on
   wholesale** — Cafe Knotted's ~$1,700 weekly balance costs ~$50 a week in card
   fees — and that belongs with Square, not Intuit.
   **`Balance` CANNOT BE NAMED IN A SELECT LIST ON A `VendorCredit`, AND THE
   FIELD IS NOT MISSING** (2026-09-22, the first credit ever pushed). Check
   QuickBooks on `/bills` calls `refresh_status` with no ids — over EVERY linked
   bill at once — so the single credit in the set took the whole sweep down:
   *"QueryValidationError: Property Balance not found for Entity VendorCredit
   (fault 4001)"*. QuickBooks' QUERY schema and its RESPONSE schema disagree for
   this entity. Measured against the real books that day: `select * from
   VendorCredit` comes back WITH `Balance`, carrying exactly the meaning
   `balanceOwed` relies on — 38.23 on an unapplied credit, 0 on two applied ones
   — while naming that same column in a select list is refused. So
   `refresh_status` asks for a credit WHOLE and keeps the narrow column list for
   a `Bill`, which is nearly all of the set and would otherwise drag every
   `Line` back with it. `find_bills` never hit this because it had always used
   `select *`, which is why LINKING a credit worked and CHECKING one did not —
   and why the failure waited for the first credit to be adopted.
   **The general trap: a property QuickBooks RETURNS on a document is not
   therefore QUERYABLE.** Probe with the `query` mode before naming a column.

   **QUICKBOOKS AS A SECOND PAYMENT PROCESSOR ON CUSTOMER INVOICES (2026-09-24,
   migration 131).** Mark: "i want to build a QBO workflow into our customer
   invoice system so I can test it out … I have a hunch that QBO will be better
   for us, but until I try it I won't know for sure." The app is not live, so
   two payment paths side by side is fine. This REVERSES, for the experiment,
   "QBO records only" and the QuickBooks Payments kill above. His answers:
   - **Per invoice**: `customer_invoices.processor` is `square` (the default)
     or `quickbooks`, set on the draft (Collect through, on the record and in
     Create Invoice…) and LOCKED ONCE SENT by a trigger.
   - **Our email, QuickBooks' link.** Send pushes the invoice
     (`qbo-sync` `push_customer_invoice`), reads back `InvoiceLink`
     (`?include=invoiceLink`; needs `BillEmail` and Payments on) and swaps it
     for the body's placeholder, THEN emails. A failed push sends nothing. Our
     template, CC, PDF, send history and re-send are unchanged; no `/pay` token
     is minted. Send Again is a sparse update of the same QBO invoice, so the
     link stays the same.
   - **One line per order**, "Order #n · title · date", split TAX/NON only
     where an order has both (`buildCustomerInvoicePayload`, fixture-tested);
     the item follows Sold as — `invoice_item_ref` for special orders, the new
     `wholesale_item_ref` (Settings → Accounting) for wholesale. A wholesale
     week is exactly one NON line per day.
   - **Refused for now**: an order with a payment taken outside the invoice (a
     deposit) — the line is short of the order's total and QBO would bill the
     whole of it.
   - **QuickBooks' pay page lets the CUSTOMER CHOOSE THE AMOUNT** (Mark,
     2026-09-25) — unlike `/pay`, which always charges the balance due. So a
     QuickBooks invoice can be part-paid by the customer, and any payment that
     comes back may be less than the invoice; `allocate_customer_invoice_payment`
     splits whatever arrives, oldest event first.
   - **Void** (and Delete of a draft that reached QBO) voids it in QuickBooks
     first; QBO's own refusal (a payment applied) stops it here too.
   - **Payment comes back by WEBHOOK**: `qbo-webhook` (deployed
     `--no-verify-jwt`) checks `intuit-signature` against the secret
     `QBO_WEBHOOK_VERIFIER`, reads the Payment back from QuickBooks, and calls
     `record_qbo_invoice_payment` → `allocate_customer_invoice_payment` as
     payment type `QuickBooks Payments`. 124's Square Online unique index is
     widened to that type, so a retried notification is a no-op (measured in
     the harness both ways). A payment voided or deleted in QBO is logged, not
     reversed. It reads both the classic and the CloudEvents payload and logs
     which arrived.
   - **Not double-counted**: the money goes through QuickBooks Payments, never
     Square, so the nightly Square journal entry never sees it.
   Setup, done by hand: apply 131; deploy `qbo-sync`, `qbo-oauth`,
   `send-special-order-email` and `qbo-webhook`; in the Intuit developer app add
   the webhook URL `https://kltxioacvneshbyhxtaj.supabase.co/functions/v1/qbo-webhook`
   subscribed to Payment; `supabase secrets set QBO_WEBHOOK_VERIFIER=…`; choose
   the Wholesale item in Settings → Accounting; link each test customer to its
   QBO customer on their record.
   Also fixed in passing: `push_invoice` posted with a second connection object
   (`conn2`) while its attachment calls used the first, so a token refresh
   during the post could leave those calls on a spent token.

   **ONE QUICKBOOKS CUSTOMER FOR EVERY SPECIAL-ORDER CUSTOMER (2026-09-24,
   migration 132).** Mark created "Special Orders Customer" in QuickBooks and
   081's `customers_external_ref_qbo_unique` refused a second link — ours, not
   QuickBooks'. The guard stays; the catch-all is a SETTING instead
   (`accounting_connections.special_order_customer_ref`, Settings → Accounting →
   Special order customer). `quickBooksCustomerFor`: a linked customer bills to
   their own record; an unlinked one to the catch-all, with their real name and
   address as the invoice's `BillAddr` so QuickBooks' invoice and pay page don't
   read "Special Orders Customer"; an unlinked WHOLESALE invoice is refused —
   wholesale clients keep records of their own (Mark). `push_customer_invoice`
   accepts the catch-all only for an unlinked customer.
   **OPEN, check before relying on it:** whether QuickBooks' pay page shows a
   customer's OTHER open invoices (pay-several). With a shared customer that
   would show one customer everyone else's unpaid special orders. Test: two
   open invoices on the catch-all, different emails, open the first's link.

   **THE CATCH-ALL FAILED THE PRIVACY TEST AND IS RETIRED (2026-09-24).** Mark
   sent two invoices on "Special Orders Customer" to two addresses: **each pay
   page showed the other invoice.** QuickBooks' pay page lists every open
   invoice on a customer, so a shared customer is a leak, not just a bookkeeping
   shortcut — and 081's one-to-one index is now a PRIVACY guard as well. The
   fallback is gone from the builder, `push_customer_invoice` and Settings;
   132's two columns stay, unread (082's precedent).
   **Replaced by LINK OR CREATE, one QuickBooks customer per customer of ours,
   made only when they are billed through QuickBooks**
   (`QuickBooksCustomerStep`, on the customer record and at Send for an unlinked
   customer). `qbo-sync` `find_customer` looks for the SAME EMAIL — filtered by
   QuickBooks, or over every page if it refuses that filter — and hides any
   match already linked to another of ours; `link_customer` re-checks the email
   against QuickBooks' record before linking; `create_customer` requires our
   customer's own email in the payload and answers 6240 (name taken) so the
   step retries once as "Name (tag)", the tag being the FileMaker id or six
   characters of ours (`qboDisplayName`). No name is ever matched
   automatically. The manual picker on the customer record still links by
   name, for wholesale accounts — a manager's deliberate choice.

   **SEND TO QUICKBOOKS BY HAND (2026-09-24).** Mark kept the push at Send
   (a draft's lines follow its orders, drafts get deleted, and a QuickBooks
   invoice books revenue on its date) and asked for a manual command beside it:
   **Send to QuickBooks… / Update in QuickBooks…** in the invoice's Actions
   menu, shown only when it collects through QuickBooks. The same push as Send,
   PDF attached, the link step for an unlinked customer — and NO email, and the
   invoice is not marked sent. Once an invoice is in QuickBooks its Collect
   through is read-only even as a draft; void it to change its mind.

   **THE WEBHOOK GOT A BACKUP: `sync_qbo_payments` (2026-09-24).** Two paid
   test invoices (1006 and the next) and not one invocation of `qbo-webhook` —
   the first because Payment was not subscribed in Intuit's portal, the second
   with it subscribed and still nothing. Intuit's own guidance is that
   notifications can be missed, so the app now also ASKS: `qbo-sync`
   `sync_qbo_payments` reads each open, pushed QuickBooks invoice's LinkedTxn
   (`select *` — named properties are not always queryable), reads those
   payments, and records each one's share through `record_qbo_invoice_payment`,
   the webhook's own step, so whichever arrives first wins. Run when an open
   QuickBooks invoice is opened (`QuickBooksPaymentCheck`, silent unless it
   records something) and from **Check QuickBooks for Payments** on the
   Invoices list, shown while a QuickBooks invoice is waiting on money. Both
   query shapes were checked read-only against 1006/550739 before deploying.
   This is the "A/R pull" killed on 2026-09-02, reopened with the experiment:
   it still stores nothing QuickBooks-side — the payment row here is the one
   record.
