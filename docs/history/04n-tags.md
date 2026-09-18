<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4n. ✅ **TAGS — the case signs, priced at print time (migration 095, APPLIED
   and LOADED 2026-09-06: 86 tags, 249 backgrounds; a second `--apply` filed
   0).** Mark: "Tags are the display signs we use in different parts of the
   shop. They are linked to production items so they are aware of price … we
   use a custom font and they require special kerning and line breaks, so
   chose instead to make the tags outside of FMP, and overlay the price on top
   when printing. There are three sizes: 2x3.5", 2x8" and 2x10"."
   *Probe, don't read this line*: `select count(*) from display_tags` (86),
   `… from display_tag_images` (249), `… from display_tags where
   production_item_id is null` (5).
   FMP's `DisplaySigns` table (DF-Premade-Production) → `display_tags` +
   `display_tag_images` (one row per SIZE, `unique (tag_id, size)`), a private
   `display-tags` bucket, membership read and purchaser+ write (the Page
   Permissions row). **NO PRICE COLUMN**: the art carries the price of the day
   it was made, and the whole point is to cover it with the linked item's
   CURRENT price — `resolveItemPrice` at the WORKING shop, exactly as
   `/production-items` shows it.
   **THE GEOMETRY LIVES ONCE, in `lib/displayTags.ts`**, read by the PDF
   (`components/tags/pdf/TagSheetPdf`) and the CSS preview (`TagPreview`), so
   they can differ only by font metrics. It was MEASURED: over 151 raster
   files the baked-in price sits at x 0.442–0.557 / y 0.808–0.880 (2x3.5) and
   x 0.462–0.537 / y 0.773–0.887 (2x8), every file agreeing to three
   decimals, which is what makes one black box per size safe. Built-in
   Helvetica-Bold at 15 / 23 pt (Mark: no font file). Sheets are plain paper,
   cut by hand: 2x3.5 8-up (2×4 portrait), **2x8 AND 2x10 3-up LANDSCAPE** —
   10" does not fit portrait, and 2x8 went landscape the same day because a
   portrait sheet left a quarter-inch side margin inside some printers'
   unprintable edge, losing the cut marks — packed edge to edge, centred,
   hairline cut marks in the margins (every margin ≥ ½", fixture-pinned).
   **EVERY "2x10" FILE IS THE 2x8 ARTWORK** (2400×600 px, 8"×2"); a 2x10 is
   that art centred on a 10" black label, an inch of black each side, which
   is seamless because the backgrounds are black.
   **The images are in `~/Desktop/fmpdocs/`, not the Tags export folder**,
   named `{Title}_{size}_{original}`; `migration/load-tags.mjs` (`--dir`)
   matches on title + size, rasterises the 22 PDF backgrounds with poppler's
   `pdftoppm` at 300 dpi (the app itself REFUSES a PDF — `TAG_IMAGE_ACCEPT`),
   and links by `PI:<DonutID>` verbatim (zero-padded). Five records carry a
   stale DonutID and load UNLINKED — Hüsker Blü and MC5 Spice both say 26,
   Lemon at Work 230, Eggnostic Front 102, "The Billie-Ache" blank — and the
   first "The Jelly Sound" (51) points at Lemon At Work; the loader names all
   of them and the record's Item picker is the fix.
   Screens: `/tags` opens on **On the plan** — tags whose donut is on the
   working shop's plans in force ON THE PICKED DAY, that day's WEEKDAY, par
   null or > 0 (`onPlanItemIds`) — with All tags and a search that reaches
   everything. **The day is a calendar box in the filter row** (Mark, the
   same day: "default is the current day, and 'on the plan' finds the donuts
   that are on the plan for whatever day it's set to"), riding in the URL as
   `?date=` because the SERVER decides which plans are in force (`/events`'
   window rule: a `router.push`, the default writing no param;
   `planDateParam` refuses a rolled-over date). It first read the whole
   week; measured on DF01 the weekday matters — Monday 23, every other day
   24. `DateField boxed` in a `w-44` wrapper is the filter row's h-9 dress;
   `variant="field"` is the public form's 48px box and ran the row over. The
   row reads **All tags 84 · On plan 23 · FOR 09/06/2026** (three passes the
   same day): the count sits between the cell and the box, so the box needed a
   word of its own or two numbers ran together. **Search and tier ride in the
   URL** (`?q=`, `?tier=all`, `replaceState`, seeded from the address bar —
   `urlFilterParams`' rule) so the breadcrumb restores the view; a bare
   `useState("")` had lost a search on the way back from a record. Default
   sort is **Item**. No tagline under the heading; the selection bar sits
   under the FILTER ROW, not the table.
   **Delete and Duplicate have three doors and ONE implementation each**
   (`components/tags/tagWrites.ts`): the selection bar's Delete (names the
   tag when one, the count when several, and how many backgrounds go), a ⋯
   row menu (Duplicate · Delete, unlabelled so the Columns menu never offers
   it, purchaser+ only), and the record's own two buttons. Duplicate makes
   "… copy" (`duplicateTitle`) with the same item, description and state and
   every background COPIED in the bucket under the new tag's folder — 095's
   policies authorise off the folder, so a copy cannot share objects — and
   lands on it; a size that failed to copy is named on arrival (`?warning=`).
   **2x8 prints LANDSCAPE as well as 2x10** (Mark: a portrait sheet's
   quarter-inch side margin lost the cut marks inside some printers'
   unprintable edge); every sheet margin ≥ ½", fixture-pinned. a selection column
   for every role (printing is a read act) and a bar with Print 2x3.5 / 2x8 /
   2x10, each counting the selected tags that have THAT background AND a
   price. `/tags/[id]`: title, item, active, description, then the three
   sizes previewed with the shop's price over them and Attach / Replace /
   Remove per slot (upload = storage then upsert on `(tag_id, size)` then the
   old object; remove = row then object).
   Verified: harness as real roles (supervisor updates 0 with no error,
   purchaser writes, anon 0, cascade and set-null); the real sheets rendered
   in Node over the real art BEFORE the load (`renderToBuffer`, data: URIs,
   `pdftoppm` to look); live at DF01: 24 of 86 on the plan, a 23-tag 2x8 run
   built IN THE BROWSER from the signed URLs (8 pages, 23 images, portrait),
   a throwaway tag created, a canvas PNG attached, removed (object gone — the
   signed URL still answers 200 for a while, which is the storage CDN's cache
   and not a failed delete) and deleted, back to 86 / 249. **1641 fixtures.**

