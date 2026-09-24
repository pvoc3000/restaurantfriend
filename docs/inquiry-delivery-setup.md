# Inquiry form: delivery estimate setup

The public `/inquiry` form can show a delivery estimate: **base fee + per
driving mile from one shop**, up to a maximum distance. The
`inquiry-delivery-quote` edge function works it out, and `submit-inquiry`
writes it onto the lead. Both call Google's Routes API.
History: `docs/history/04g-special-orders.md` (2026-09-24).

## 1. A Google Maps API key

1. In Google Cloud Console, create or choose a project, and enable
   **Routes API** (APIs & Services ▸ Library ▸ "Routes API").
2. Create a key under APIs & Services ▸ Credentials ▸ Create credentials ▸
   API key.
3. **Restrict it:** under API restrictions, allow **Routes API** only. Leave
   application restrictions as **None**, because the key is used from Supabase's
   servers, never from a browser.
4. Set a billing budget alert. Each estimate is one `computeRoutes` call
   (Essentials SKU). The form only asks when the address field loses focus,
   answers are cached for an hour per address, and each IP is capped.

## 2. The secret

Supabase dashboard ▸ Edge Functions ▸ Secrets:

    GOOGLE_MAPS_API_KEY = <the key>

Without it, both functions quietly offer no estimate. The form then says
"added to your quote".

## 3. Deploy

    supabase functions deploy inquiry-delivery-quote
    supabase functions deploy submit-inquiry

## 4. Settings ▸ General ▸ Delivery estimate

- **Measured from:** the shop deliveries leave from. Its **shipping** address
  on the Location record is the route's origin.
- **Base fee ($)**, **Per mile ($)**, **Farthest we estimate (miles)**.

No estimate is offered until the shop and the per-mile rate are both set.
Beyond the maximum, the form says "we'll quote it".
