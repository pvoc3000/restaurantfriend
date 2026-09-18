<!-- Moved verbatim from CLAUDE.md on 2026-09-18 (Claude Code /doctor). Everything below line 2 is the original text. -->

4b. 🚧 **The Location module** — the first screen outside Purchasing (Mark,
   2026-07-30). `locations` was the one table with no UI at all: nothing in
   `web/src` wrote to it, and its six rows still carried raw FileMaker text in
   `settings` (`"10am␝10am␝…"` for hours, `LaborRate_n` as a string) while 42
   of FMP's 51 location columns had been dropped at transform time. Shipped:
   **`/locations`** (list) **+ `/locations/[id]`** (record). Blocks: identity,
   the two addresses, operating hours, tax/labor/registers, the production
   mapping (retired by 102), four counts, and a read-only statement of which
   email tier POs go through.
   **THE RECORD IS THREE TABS SINCE 2026-09-12** (Mark: "Info — everything
   above the addresses. Addresses — the shipping and billing addresses.
   Operations — everything below the addresses"), `ui/SectionNav` and the tab
   helpers in `lib/locations`, the production item record's pattern a fifth
   time — title above the split and indented `lg:ml-48`, the tab in the URL
   under `tab`, `info` writing no parameter so `locationDetailHref` stays the
   record's one canonical address, and `RecordNav` carrying the tab when you
   page. **`WorkingHere` STAYS WITH THE TITLE**, above the split: adopting the
   shop you are reading about is not a fact ABOUT the shop, it is what you do
   having read one, and it must not go missing because you happen to be on
   Addresses.
   **It shipped as ONE PAGE WITH NO TABS** on the reasoning that FMP's INFO2
   was SMTP credentials (replaced by the provider layer, and never to be
   displayed) plus three unbuilt modules, and REQUESTS three more — which was
   right about there being nothing to ADD and wrong, once seven blocks were
   there, about there being nothing to SPLIT.
   Measured at 1440 and 1024: the identity's left edge is the content column's
   (240, 208), the two addresses hold `max-w-md` and 376.5px columns without
   clipping, and the page does not overflow at either. **ACTIVE IS A SWITCH
   AGAIN** here and on the list — it was one beside the title, then a large Mac
   checkbox in the `dl` (2026-09-10), and is now the shape `ui/Switch` took
   back for a record's own durable state, in the `dl` where Mark put it. **`/shop-sections`** — the 168 rows that
   order the guide's walk, editable at last, location-scoped, with a guarded
   delete (the FK is `on delete set null`, so deleting a section moves its
   items to "No section" rather than deleting them).
   `components/InactiveLocationGate.tsx` in the (app) layout replaces every
   screen except the `/locations` ones with a sentence and an Activate button —
   an inactive location is a record you maintain, not a shop you work in.
   Without it those screens don't break, they just render as inexplicably empty
   tables. One component; delete it and the wiring line to go back. Schema:
   migration 017 + `migration/backfill-locations.mjs`.
   Rebuilt 2026-08-01 on Mark's FileMaker shape, after living with the
   masthead's `<select>`: **the working location is CHOSEN FROM A LIST**, and
   `components/LocationSwitcher.tsx` is deleted.
   **A masthead picker came BACK on 2026-08-27** (Mark) —
   `components/WorkingLocation.tsx`, last in the utilities row, after the gear.
   That is not the 2026-08-01 decision being reversed, it is being HALVED: this
   list is still the right place to READ about a shop and then act on the row in
   front of you, and what it turned out not to be is a good place to SWITCH
   from, because switching is something you do on the way to somewhere else and
   it made you leave wherever you were. Both routes exist and the Working column
   below stays.
   Three things about it worth not rediscovering.
   It is a **`ui/PickList`, not a `<select>`** — there are none of those left in
   the app and a masthead is where an OS menu looks most out of place — which
   needed a third trigger dress, **`variant="masthead"`**: yellow type, a caret,
   NO BOX and no horizontal padding (Mark, 2026-08-27, in two steps). The box
   went the way `Sign out`'s did: up there a box reads as a different KIND of
   object from the type it stands among, and the padding went with it because
   without the border it held the code 8px off the page gutter `Sign out` sits
   on directly beneath (measured — both right edges are the same pixel, and the
   gap to the gear matches Home-to-gear). Everything is STATED rather than
   overridden, because Tailwind resolves competing utilities by stylesheet order
   and a caller passing `bg-transparent` through `className` could not be relied
   on to beat `field`'s `bg-white`. Hover BRIGHTENS (yellow-500 → yellow-200,
   14.67:1 → 18.05:1) where every other quiet control in the app darkens —
   yellow-500 is already near the top of its range. `h-6` stays whatever the
   dress, so the box is a nav tier tall and the masthead's two columns line up.
   Its panel needed **`panelMinWidth`** (`MenuButton`'s idiom, now on
   `PickList`): a four-character trigger opens rows carrying a shop's full name,
   and at the shared 168px floor "Donut Friend 01 Highland Park" broke over four
   lines. 300 puts every row on one.
   **It offers ACTIVE locations only**, which is `WorkingHere`'s rule and not
   the old switcher's — that one listed closed shops because switching to one
   was the only way to reach its record, and this list killed that reason. The
   working shop is listed even if somebody has just closed it, hinted
   "inactive", or the trigger would show a raw id instead of a code.
   The list leads with the Active
   toggle (purchaser+ only, per 001's policy) and ENDS with the **Working**
   column (Mark, 2026-08-01 — read the row, then act on it, and the control you
   press repeatedly sits against the right edge, like the guide's stepper) —
   `components/location/WorkingHere.tsx`, three states: a YELLOW `WORKING HERE`
   chip on the one you're at (`bg-mark-fill`; it was a BLACK fill until
   2026-08-02, when Mark read it as a button — down a table column the boxes sit
   56px apart, so they aren't read as one segmented control the way a
   TabPicker's abutting cells are, and alone a filled box with a label is a
   button. Yellow is already this app's mark for WHICH SHOP YOU ARE AT, and no
   button anywhere is filled yellow. (Where that mark LIVES has moved twice
   without its meaning changing: when this was written the nav marked its active
   SECTION yellow; from 2026-08-06 selection was white in both bands and the
   yellow belonged to the location TAB alone; since 2026-08-27 the tab is
   ordinary and the masthead's picker wears it. Two places carry it now — the
   control that SETS the working shop, and this chip on the row that IS it.) The 130×30 optical compensation went with the black — a pale fill is
   a light area like the outlined box beside it), a `Work here` button
   on any other ACTIVE one, and **nothing at all on an inactive one**. Chip and
   button are ONE box — same width, height and border, only the fill differs —
   or the column's edge moves as the working location moves down the list. The
   working row is `font-bold`; a closed one is **not** dimmed (Mark,
   2026-08-01): its links work like any other row's, and greying text you can
   still click reads as disabled and lies. Only an
   open shop can be worked at (Mark, 2026-08-01): switching to a closed one
   used to be the only way to reach its record, and the list reaches it
   directly. That's a UI rule — `set_my_member_profile` checks only that the
   location is in your org, which is also why the gate is still load-bearing:
   the Active toggle is now one tap from the shop you're standing in.
   The list is **deliberately NOT keyed by the working location**, unlike every
   other location-scoped screen: its rows ARE the locations, so none goes stale
   when the working one changes, and remounting would throw away the reader's
   search and sort on every tap. It writes through the same `setActiveLocation`
   action the switcher used, whose `revalidatePath("/", "layout")` re-renders
   in place — no refresh, no navigation.
   The RECORD is keyed by its id, and that key is the point: `/locations/A` →
   `/locations/B` through the record book is a soft navigation within one
   dynamic segment, so `OperatingHours`, `ProductionMapping` and `ActiveToggle`
   — all `useState(props)` — would show A's data beside B's text.
   Its "In the system" counts are **figures, not links** (Mark, 2026-08-01:
   "drop the links, but keep the info. It's handy."): those screens follow the
   WORKING location, so from any record the link was right by coincidence and
   wrong on the other five. `/location` survives as a redirect shim to
   `/locations/<working id>`; the nav's tier-2 item became "Locations"
   (`lib/nav.ts` — one line) and is **"All"** since 2026-08-27, and the tier-1
   tab wore the working code from this change until the same day, when the
   masthead picker took it back.
