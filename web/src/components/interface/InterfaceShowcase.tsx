"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue } from "@/components/catalog/InlineValue";
import {
  InventoryItemChooser,
  type ChosenItem,
} from "@/components/catalog/InventoryItemChooser";
import {
  ListFilters,
  type ActiveFilter,
  type StaleFilter,
} from "@/components/catalog/ListFilters";
import { WEEKDAY_PICKER_WIDTH, WeekdayPicker } from "@/components/catalog/WeekdayPicker";
import { ScoreChip } from "@/components/inspections/InspectionsList";
import { StatusChip } from "@/components/payroll/PayPeriodStatusChip";
import { ActionBar, ActionBarButton } from "@/components/ui/ActionBar";
import { BackToTop } from "@/components/ui/BackToTop";
import {
  BUTTON_CLASS,
  DANGER_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { useCalcField } from "@/components/ui/CalcPad";
import { CalendarGrid } from "@/components/ui/CalendarGrid";
import { Checkbox } from "@/components/ui/Checkbox";
import { ControlField } from "@/components/ui/ControlField";
import { DateField } from "@/components/ui/DateField";
import {
  DIALOG_CANCEL_CLASS,
  DIALOG_COMMIT_CLASS,
  DIALOG_DANGER_CLASS,
  Dialog,
} from "@/components/ui/Dialog";
import { DocumentChip } from "@/components/ui/DocumentChip";
import { DocumentViewer } from "@/components/ui/DocumentViewer";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { FilterMenus } from "@/components/ui/FilterMenus";
import { MacTitleBar } from "@/components/ui/MacTitleBar";
import { MenuButton } from "@/components/ui/MenuButton";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { PageHeading } from "@/components/ui/PageHeading";
import { PageLoading } from "@/components/ui/PageLoading";
import { Pane, PaneHeader } from "@/components/ui/Pane";
import { PickList, type PickOption } from "@/components/ui/PickList";
import { PickSet } from "@/components/ui/PickSet";
import { ProgressBand } from "@/components/ui/ProgressBand";
import { RangePicker } from "@/components/ui/RangePicker";
import { RecordNav } from "@/components/ui/RecordNav";
import { RevealPanel } from "@/components/ui/RevealPanel";
import { RowMenu } from "@/components/ui/RowMenu";
import { SearchGlyph } from "@/components/ui/SearchGlyph";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SectionNav } from "@/components/ui/SectionNav";
import { StickyFooter } from "@/components/ui/StickyFooter";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { TimePicker } from "@/components/ui/TimePicker";
import { evaluateNumeric } from "@/lib/calc";
import { alertDialog, confirmDialog, confirmDialogWithOption } from "@/lib/confirm";
import type { DateRange } from "@/lib/dateRange";
import { applyListFilters, type FilterDimension, type FilterValues } from "@/lib/filterMenus";
import { BILL_STAGE_CLASS, BILL_STAGE_LABEL, BILL_STAGE_ORDER } from "@/lib/invoices";
import { PAY_PERIOD_STATUS } from "@/lib/payPeriods";
import { PO_STATUS_CLASS, PO_STATUS_LABEL, PO_STATUS_ORDER } from "@/lib/purchaseOrders";
import { usePublishRecordSet } from "@/lib/recordSet";

/**
 * EVERY SHARED CONTROL, ON ONE PAGE, WORKING (Mark, 2026-09-10). Fake data, and
 * nothing here writes to the database: `InlineValue`, `ActiveToggle` and
 * `WeekdayPicker` are handed `onWrite`, which replaces their UPDATE with a
 * local one. `InventoryItemChooser` is the one exception that touches the
 * server, and it only READS — it searches the real catalog.
 *
 * Organised by kind of control, each specimen captioned with the part and its
 * variant, so a thing that looks wrong here can be found in the code by name.
 * The Mac-page switch at the top wraps everything in `.mac-page`, the location
 * record's experiment, so both looks can be tried side by side.
 */

/* ---- fake data --------------------------------------------------------- */

const VENDORS = [
  "BakeMark",
  "Chefs Warehouse",
  "Restaurant Depot",
  "Sysco",
  "Amoretti",
  "Dawn Foods",
  "Unified Paper",
  "Action Sales",
  "Smart & Final",
  "Costco",
];

const CATEGORIES = ["Dry Goods", "Dairy", "Paper", "Chemicals", "Produce"];

const VENDOR_OPTIONS: PickOption[] = VENDORS.map((v, i) => ({
  value: v,
  label: v,
  hint: `${12 + i * 7} items`,
  inactive: v === "Costco",
}));

const UNIT_OPTIONS: PickOption[] = [
  { value: "ea", label: "each", group: "Count" },
  { value: "dz", label: "dozen", group: "Count" },
  { value: "lbs", label: "pounds", group: "Weight" },
  { value: "oz", label: "ounces", group: "Weight" },
  { value: "gal", label: "gallons", group: "Volume" },
  { value: "qt", label: "quarts", group: "Volume" },
  { value: "CS", label: "case", group: "Package" },
  { value: "BAG", label: "bag", group: "Package" },
];

type DemoRow = {
  id: string;
  active: boolean;
  name: string;
  category: string;
  vendor: string;
  pack: string;
  price: number;
  par: number | null;
  lastOrdered: string | null;
  days: number[];
  note: string;
};

const INITIAL_ROWS: DemoRow[] = [
  { id: "r1", active: true, name: "Flour, All Purpose", category: "Dry Goods", vendor: "BakeMark", pack: "1 × 50 lbs", price: 21.4, par: 300, lastOrdered: "2026-09-07", days: [1, 4], note: "" },
  { id: "r2", active: true, name: "Sugar, Granulated", category: "Dry Goods", vendor: "Restaurant Depot", pack: "1 × 25 lbs", price: 18.9, par: 150, lastOrdered: "2026-09-01", days: [1], note: "Ballast for BakeMark's minimum" },
  { id: "r3", active: true, name: "Milk, Whole", category: "Dairy", vendor: "Chefs Warehouse", pack: "4 × 1 gal", price: 16.2, par: 8, lastOrdered: "2026-09-09", days: [1, 3, 5], note: "" },
  { id: "r4", active: true, name: "Butter, Unsalted", category: "Dairy", vendor: "Sysco", pack: "36 × 1 lbs", price: 118.5, par: 36, lastOrdered: "2026-08-28", days: [2, 5], note: "" },
  { id: "r5", active: false, name: "Cream Cheese", category: "Dairy", vendor: "Sysco", pack: "10 × 3 lbs", price: 64.0, par: null, lastOrdered: "2024-03-12", days: [], note: "Retired with the old glaze" },
  { id: "r6", active: true, name: "Donut Boxes, Dozen", category: "Paper", vendor: "Unified Paper", pack: "250 EA", price: 88.75, par: 500, lastOrdered: "2026-08-31", days: [3], note: "" },
  { id: "r7", active: true, name: "Napkins", category: "Paper", vendor: "Unified Paper", pack: "12 × 500 EA", price: 42.1, par: 12, lastOrdered: "2026-07-14", days: [3], note: "" },
  { id: "r8", active: true, name: "Sanitizer, Quat", category: "Chemicals", vendor: "Action Sales", pack: "4 × 1 gal", price: 51.3, par: 4, lastOrdered: "2026-06-02", days: [], note: "" },
  { id: "r9", active: true, name: "Bananas, Ripe", category: "Produce", vendor: "Restaurant Depot", pack: "40 lbs", price: 24.0, par: 40, lastOrdered: null, days: [4], note: "" },
  { id: "r10", active: true, name: "Vanilla Extract", category: "Dry Goods", vendor: "Amoretti", pack: "1 × 1 gal", price: 96.4, par: 2, lastOrdered: "2026-08-15", days: [1], note: "" },
  { id: "r11", active: true, name: "Glaze Base", category: "Dry Goods", vendor: "Dawn Foods", pack: "1 × 50 lbs", price: 74.9, par: 100, lastOrdered: "2026-09-04", days: [1, 4], note: "" },
  { id: "r12", active: true, name: "Gloves, Nitrile L", category: "Paper", vendor: "Smart & Final", pack: "10 × 100 EA", price: 69.0, par: 10, lastOrdered: "2025-11-20", days: [], note: "" },
];

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const SAMPLE_DOC_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100" viewBox="0 0 850 1100">
    <rect width="850" height="1100" fill="#fff"/>
    <rect x="50" y="50" width="750" height="90" fill="#000"/>
    <text x="80" y="110" font-family="Helvetica" font-size="40" font-weight="bold" fill="#fff">INVOICE 73358289</text>
    <text x="80" y="200" font-family="Helvetica" font-size="22">Sample Vendor, Inc.</text>
    <text x="80" y="232" font-family="Helvetica" font-size="22">Ship date 2026-09-08 · Net 30</text>
    ${Array.from({ length: 12 }, (_, i) =>
      `<line x1="80" x2="770" y1="${300 + i * 50}" y2="${300 + i * 50}" stroke="#ccc"/><text x="80" y="${290 + i * 50}" font-family="Helvetica" font-size="18">Line ${i + 1} · Sample product · CS</text><text x="700" y="${290 + i * 50}" font-family="Helvetica" font-size="18">$${(12 + i * 3.5).toFixed(2)}</text>`
    ).join("")}
    <text x="580" y="960" font-family="Helvetica" font-size="28" font-weight="bold">TOTAL $472.13</text>
  </svg>`
)}`;

/* ---- page scaffolding -------------------------------------------------- */

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 space-y-6">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** One control, captioned with the part and its variant. */
function Specimen({
  name,
  children,
  wide = false,
}: {
  name: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 space-y-2 ${wide ? "md:col-span-2 xl:col-span-3" : ""}`}>
      <p className="font-mono text-[11px] text-subtle">{name}</p>
      {children}
    </div>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-12 gap-y-10 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

/** What a control last reported, so a test can see it did something. */
function Readout({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-muted">{children}</p>;
}

const INDEX = [
  ["buttons", "Buttons"],
  ["choosing", "Choosing"],
  ["typing", "Typing"],
  ["dates", "Dates & times"],
  ["toggles", "Toggles"],
  ["inline", "Inline editing"],
  ["menus", "Menus"],
  ["tables", "Tables & filters"],
  ["navigation", "Navigation"],
  ["panels", "Panels & dialogs"],
  ["documents", "Documents"],
  ["status", "Status & progress"],
] as const;

/* ---- the page ---------------------------------------------------------- */

export function InterfaceShowcase({ today }: { today: string }) {
  const [mac, setMac] = useState(false);

  return (
    <div className={`${mac ? "mac-page " : ""}space-y-16 pb-24`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            Interface
          </h1>
          <Checkbox size="lg" checked={mac} onChange={setMac}>
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">Mac page look</span>
          </Checkbox>
        </div>
        <nav aria-label="Sections" className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] uppercase tracking-[0.06em]">
          {INDEX.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="text-muted underline decoration-neutral-300 underline-offset-4 hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <ButtonsBlock />
      <ChoosingBlock />
      <TypingBlock />
      <DatesBlock today={today} />
      <TogglesBlock />
      <InlineBlock />
      <MenusBlock />
      <TablesBlock />
      <NavigationBlock />
      <PanelsBlock />
      <DocumentsBlock />
      <StatusBlock />

      <BackToTop />
    </div>
  );
}

/* ---- buttons ----------------------------------------------------------- */

function ButtonsBlock() {
  const [last, setLast] = useState("nothing yet");
  const press = (what: string) => () => setLast(what);

  return (
    <Block id="buttons" title="Buttons">
      <Grid>
        <Specimen name="BUTTON_CLASS">
          <div className="flex flex-wrap gap-3">
            <button type="button" className={BUTTON_CLASS} onClick={press("Button")}>
              New item
            </button>
            <button type="button" className={BUTTON_CLASS} disabled>
              Disabled
            </button>
          </div>
        </Specimen>
        <Specimen name="PRIMARY_BUTTON_CLASS">
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={press("Primary")}>
            Resolve the issue
          </button>
        </Specimen>
        <Specimen name="DANGER_BUTTON_CLASS">
          <button type="button" className={DANGER_BUTTON_CLASS} onClick={press("Danger")}>
            Delete
          </button>
        </Specimen>
        <Specimen name="DIALOG_CANCEL_CLASS · DIALOG_COMMIT_CLASS">
          <div className="flex items-center gap-5">
            <button type="button" className={DIALOG_CANCEL_CLASS} onClick={press("Cancel")}>
              Cancel
            </button>
            <button type="button" className={DIALOG_COMMIT_CLASS} onClick={press("Commit")}>
              Create
            </button>
          </div>
        </Specimen>
        <Specimen name="DIALOG_DANGER_CLASS">
          <button type="button" className={DIALOG_DANGER_CLASS} onClick={press("Dialog danger")}>
            Delete for good
          </button>
        </Specimen>
        <Specimen name="text link">
          <button
            type="button"
            onClick={press("Link")}
            className="text-sm text-ink underline decoration-neutral-400 underline-offset-4 hover:decoration-ink"
          >
            Open the record
          </button>
        </Specimen>
      </Grid>
      <Readout>Last pressed: {last}</Readout>
    </Block>
  );
}

/* ---- choosing ---------------------------------------------------------- */

function ChoosingBlock() {
  const [inline, setInline] = useState<string | null>("BakeMark");
  const [boxed, setBoxed] = useState<string | null>("lbs");
  const [field, setField] = useState<string | null>(null);
  const [fit, setFit] = useState<string | null>("received");
  const [grown, setGrown] = useState<string | null>("Dairy");
  const [masthead, setMasthead] = useState<string | null>("DF01");
  const [large, setLarge] = useState<string | null>("closing");
  const [set, setSet] = useState<string[]>([]);
  const [setBoxedValue, setSetBoxedValue] = useState<string[]>(["DF01"]);
  const [tab, setTab] = useState<"favorites" | "all" | "skipped" | "will">("favorites");
  const [small, setSmall] = useState<"auto" | "split" | "stacked">("auto");
  const [chosen, setChosen] = useState<ChosenItem | null>(null);

  return (
    <Block id="choosing" title="Choosing">
      <Grid>
        <Specimen name='PickList · variant="inline"'>
          <PickList value={inline} options={VENDOR_OPTIONS} onPick={setInline} ariaLabel="Vendor" clearable />
        </Specimen>
        <Specimen name='PickList · inline boxed, grouped'>
          <PickList value={boxed} options={UNIT_OPTIONS} onPick={setBoxed} ariaLabel="Unit" boxed />
        </Specimen>
        <Specimen name='PickList · variant="field"'>
          <PickList
            variant="field"
            value={field}
            placeholder="Choose a vendor"
            options={VENDOR_OPTIONS}
            onPick={setField}
            ariaLabel="Vendor"
          />
        </Specimen>
        <Specimen name='PickList · field, fit, counts as hints'>
          <ControlField label="Status">
            <PickList
              variant="field"
              fit
              value={fit}
              onPick={setFit}
              ariaLabel="Status"
              options={[
                { value: "all", label: "All", hint: "148" },
                { value: "open", label: "Open", hint: "21" },
                { value: "draft", label: "Draft", hint: "4" },
                { value: "sent", label: "Sent", hint: "17" },
                { value: "received", label: "Received", hint: "102" },
              ]}
            />
          </ControlField>
        </Specimen>
        <Specimen name="PickList · allowNew">
          <PickList
            variant="field"
            value={grown}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            onPick={setGrown}
            allowNew
            ariaLabel="Category"
          />
        </Specimen>
        <Specimen name='PickList · size="lg"'>
          <PickList
            variant="field"
            size="lg"
            value={large}
            onPick={setLarge}
            ariaLabel="Shift"
            options={[
              { value: "opening", label: "Opening" },
              { value: "mid", label: "Mid" },
              { value: "closing", label: "Closing" },
              { value: "offsite", label: "Off-site" },
            ]}
          />
        </Specimen>
        <Specimen name='PickList · variant="masthead"'>
          <div className="flex h-16 items-center justify-end bg-ink px-4">
            <PickList
              variant="masthead"
              value={masthead}
              onPick={setMasthead}
              ariaLabel="Working location"
              panelMinWidth={300}
              align="right"
              options={[
                { value: "DF01", label: "DF01", hint: "Donut Friend 01 Highland Park" },
                { value: "DF02", label: "DF02", hint: "Donut Friend 02 DTLA" },
              ]}
            />
          </div>
        </Specimen>
        <Specimen name="PickList · disabled">
          <PickList variant="field" value="Sysco" options={VENDOR_OPTIONS} onPick={() => {}} disabled ariaLabel="Vendor" />
        </Specimen>
        <Specimen name="PickSet (filter row)">
          <PickSet
            options={VENDORS.map((v) => ({ value: v, label: v, hint: "12" }))}
            value={set}
            onChange={setSet}
            allLabel="All vendors"
            label="Vendors"
            noun="vendors"
          />
        </Specimen>
        <Specimen name="PickSet · boxed">
          <PickSet
            boxed
            options={[
              { value: "DF01", label: "DF01" },
              { value: "DF02", label: "DF02" },
              { value: "DF03", label: "DF03" },
            ]}
            value={setBoxedValue}
            onChange={setSetBoxedValue}
            allLabel="All shops"
            label="Works at"
            noun="shops"
          />
        </Specimen>
        <Specimen name="TabPicker · counts" wide>
          <TabPicker
            ariaLabel="Tier"
            value={tab}
            onChange={setTab}
            options={[
              { key: "favorites", label: "Favorites", count: 230 },
              { key: "all", label: "All", count: 394 },
              { key: "skipped", label: "Skipped", count: 12 },
              { key: "will", label: "Will order", count: 41 },
            ]}
          />
        </Specimen>
        <Specimen name='TabPicker · size="sm"'>
          <TabPicker
            size="sm"
            ariaLabel="Layout"
            value={small}
            onChange={setSmall}
            options={[
              { key: "auto", label: "Auto" },
              { key: "split", label: "Side by side" },
              { key: "stacked", label: "Stacked" },
            ]}
          />
        </Specimen>
        <Specimen name="InventoryItemChooser (searches the real catalog, writes nothing)">
          <InventoryItemChooser value={chosen} onPick={setChosen} />
          <Readout>Chosen: {chosen ? `${chosen.name}${chosen.base_unit ? ` (${chosen.base_unit})` : ""}` : "none"}</Readout>
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- typing ------------------------------------------------------------ */

function TypingBlock() {
  const [plain, setPlain] = useState("Flour, All Purpose");
  const [search, setSearch] = useState("");
  const [full, setFull] = useState("");
  const [small, setSmall] = useState("");
  const [calc, setCalc] = useState("2 * 6");
  const [notes, setNotes] = useState("");
  const calcField = useCalcField();
  const result = evaluateNumeric(calc);

  return (
    <Block id="typing" title="Typing">
      <Grid>
        <Specimen name="TextInput">
          <TextInput value={plain} onValueChange={setPlain} aria-label="Name" className="w-72" />
        </Specimen>
        <Specimen name="TextInput · search, SearchGlyph">
          <TextInput
            search
            value={search}
            onValueChange={setSearch}
            aria-label="Search items"
            icon={<SearchGlyph />}
          />
        </Specimen>
        <Specimen name="TextInput · fullWidth">
          <TextInput fullWidth value={full} onValueChange={setFull} aria-label="Subject" placeholder="Subject" />
        </Specimen>
        <Specimen name='TextInput · size="sm"'>
          <TextInput size="sm" value={small} onValueChange={setSmall} aria-label="Dense" className="w-48" />
        </Specimen>
        <Specimen name="useCalcField (a calculator on touch)">
          <TextInput value={calc} onValueChange={setCalc} aria-label="Quantity" className="w-48" {...calcField} />
          <Readout>= {result === null ? "not a number" : result}</Readout>
        </Specimen>
        <Specimen name="FORM_TEXTAREA">
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-label="Details"
            className={FORM_TEXTAREA}
          />
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- dates and times --------------------------------------------------- */

function DatesBlock({ today }: { today: string }) {
  const [cell, setCell] = useState<string | null>(today);
  const [boxed, setBoxed] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(today);
  const [timeCell, setTimeCell] = useState<string | null>("09:30");
  const [timeField, setTimeField] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>("14:00");
  const [range, setRange] = useState<DateRange | null>(null);
  const [rangeBoxed, setRangeBoxed] = useState<DateRange | null>({ from: today, to: today });
  const [month, setMonth] = useState(today);
  const [day, setDay] = useState<string | null>(today);

  return (
    <Block id="dates" title="Dates & times">
      <Grid>
        <Specimen name='DateField · variant="cell"'>
          <DateField value={cell} onChange={setCell} ariaLabel="Ordered" />
        </Specimen>
        <Specimen name="DateField · cell, boxed">
          <DateField value={boxed} onChange={setBoxed} ariaLabel="Delivery date" boxed />
        </Specimen>
        <Specimen name='DateField · variant="field"'>
          <DateField value={field} onChange={setField} ariaLabel="Event date" variant="field" />
        </Specimen>
        <Specimen name='DateField · variant="title", max today'>
          <DateField value={title} onChange={setTitle} ariaLabel="Guide day" variant="title" max={today} />
        </Specimen>
        <Specimen name="TimePicker · cell (unboxed)">
          <TimePicker value={timeCell} onChange={setTimeCell} ariaLabel="Opens" />
        </Specimen>
        <Specimen name='TimePicker · variant="field"'>
          <TimePicker value={timeField} onChange={setTimeField} ariaLabel="Pickup time" variant="field" />
        </Specimen>
        <Specimen name="TimePicker · boxed">
          <div className="w-40">
            <TimePicker value={picked} onChange={setPicked} ariaLabel="Close time" boxed />
          </div>
        </Specimen>
        <Specimen name="RangePicker (filter row)">
          <div className="w-52">
            <RangePicker
              value={range}
              onChange={setRange}
              today={today}
              ariaLabel="Order date"
              presets={["today", "yesterday", "last_week", "this_week", "previous_week", "this_month", "last_month", "this_year"]}
            />
          </div>
        </Specimen>
        <Specimen name="RangePicker · boxed">
          <RangePicker
            boxed
            value={rangeBoxed}
            onChange={setRangeBoxed}
            today={today}
            ariaLabel="Window"
            presets={["today", "last_week", "this_month", "year_to_date"]}
          />
        </Specimen>
        <Specimen name="CalendarGrid">
          <CalendarGrid
            month={month}
            today={today}
            painted={day ? { from: day, to: day } : null}
            onMonth={setMonth}
            onTap={setDay}
          />
          <Readout>Picked: {day ?? "none"}</Readout>
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- toggles ----------------------------------------------------------- */

function TogglesBlock() {
  const [check, setCheck] = useState(true);
  const [check2, setCheck2] = useState(false);
  const [lg, setLg] = useState(true);
  const [lg2, setLg2] = useState(false);

  return (
    <Block id="toggles" title="Toggles">
      <Grid>
        <Specimen name='Checkbox · size="md"'>
          <div className="flex flex-col items-start gap-3">
            <Checkbox checked={check} onChange={setCheck} label="Receive as ordered">
              Receive as ordered
            </Checkbox>
            <Checkbox checked={check2} onChange={setCheck2} label="Also file as a bill">
              Also file as a bill
            </Checkbox>
            <Checkbox checked disabled label="Disabled">
              Disabled
            </Checkbox>
          </div>
        </Specimen>
        <Specimen name='Checkbox · size="lg" (what every switch became)'>
          <div className="flex flex-col items-start gap-3">
            <Checkbox size="lg" checked={lg} onChange={setLg}>
              Ignore ordering days
            </Checkbox>
            <Checkbox size="lg" checked={false} disabled>
              Disabled
            </Checkbox>
          </div>
        </Specimen>
        <Specimen name='Checkbox · lg, no visible label'>
          <Checkbox size="lg" checked={lg2} onChange={setLg2} label="Require a photo" />
        </Specimen>
        <Specimen name="ActiveToggle (local write)">
          <div className="flex items-center gap-6">
            <ActiveToggle table="demo" id="demo" active onWrite={async () => ({ error: null })} />
            <ActiveToggle
              table="demo"
              id="demo"
              active={false}
              label="Refuses (demo)"
              onWrite={async () => ({ error: "refused" })}
            />
          </div>
        </Specimen>
        <Specimen name="ActiveToggle · readOnly, yesNo">
          <ActiveToggle table="demo" id="demo" active readOnly yesNo />
        </Specimen>
        <Specimen name="ActiveToggle · readOnly">
          <ActiveToggle table="demo" id="demo" active readOnly />
        </Specimen>
        <Specimen name="WeekdayPicker (local write)">
          <WeekdayPicker table="demo" id="demo" column="days" label="Order days" value={[1, 4]} onWrite={async () => ({ error: null })} />
        </Specimen>
        <Specimen name="WeekdayPicker · readOnly">
          <WeekdayPicker table="demo" id="demo" column="days" label="Delivery days" value={[2, 5]} readOnly />
        </Specimen>
        <Specimen name="DataTable row expander (▶)">
          <DataTable
            rows={INITIAL_ROWS.slice(0, 3)}
            columns={[
              { key: "name", label: "Item", width: 220, pinned: true, render: (r) => r.name },
              { key: "price", label: "Price", width: 90, align: "right", render: (r) => money(r.price) },
            ]}
            rowKey={(r) => r.id}
            storageKey="interface.disclosure"
            resetFooter={false}
            expand={{ render: (r) => <p className="px-4 py-3 text-sm">{r.pack} from {r.vendor}</p> }}
          />
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- inline editing ---------------------------------------------------- */

function InlineBlock() {
  const [values, setValues] = useState<Record<string, string | number | null>>({
    name: "Flour, All Purpose",
    brand: null,
    price: 21.4,
    date: "2026-09-07",
    time: "06:00:00",
    unit: "lbs",
    notes: "Ballast for BakeMark's minimum. Order a pallet when the price drops below $20.",
    title: "Chefs Warehouse",
  });
  const write =
    (key: string) =>
    async (next: string | number | null): Promise<{ error: string | null }> => {
      setValues((v) => ({ ...v, [key]: next }));
      return { error: null };
    };
  const cell = (key: string) => ({ table: "demo", column: key, value: values[key] ?? null, onWrite: write(key) });

  return (
    <Block id="inline" title="Inline editing">
      <Grid>
        <Specimen name="InlineValue · text, underlined (a title)">
          <h2 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
            <InlineValue {...cell("title")} ariaLabel="Vendor name" />
          </h2>
        </Specimen>
        <Specimen name="InlineValue · text, boxed">
          <InlineValue {...cell("name")} boxed ariaLabel="Name" />
        </Specimen>
        <Specimen name="InlineValue · text, boxed, empty">
          <InlineValue {...cell("brand")} boxed ariaLabel="Brand" />
        </Specimen>
        <Specimen name='InlineValue · kind="number", format'>
          <InlineValue {...cell("price")} kind="number" boxed align="right" ariaLabel="Price" format={(v) => money(Number(v))} />
        </Specimen>
        <Specimen name='InlineValue · kind="date"'>
          <InlineValue {...cell("date")} kind="date" boxed ariaLabel="Ordered" />
        </Specimen>
        <Specimen name='InlineValue · kind="time"'>
          <InlineValue {...cell("time")} kind="time" boxed ariaLabel="Workday starts" />
        </Specimen>
        <Specimen name='InlineValue · kind="pick"'>
          <InlineValue {...cell("unit")} kind="pick" options={UNIT_OPTIONS} boxed ariaLabel="Base unit" />
        </Specimen>
        <Specimen name="InlineValue · multiline, rows 8">
          <InlineValue {...cell("notes")} multiline rows={8} boxed ariaLabel="Notes" />
        </Specimen>
        <Specimen name="InlineValue · readOnly">
          <InlineValue {...cell("name")} boxed readOnly ariaLabel="Name" />
        </Specimen>
        <Specimen name="InlineValue · a write that fails">
          <InlineValue
            table="demo"
            column="x"
            value="Edit me and press Enter"
            boxed
            ariaLabel="Refusing field"
            onWrite={async () => ({ error: "refused by the database (demo)" })}
          />
        </Specimen>
        <Specimen name="ControlField · captioned fields">
          <div className="flex items-end gap-3">
            <ControlField label="Shows">
              <PickList variant="field" fit value="active" onPick={() => {}} ariaLabel="Shows" options={[{ value: "active", label: "Active" }, { value: "all", label: "All" }]} />
            </ControlField>
            <ControlField label="Group by">
              <PickList variant="field" fit value="type" onPick={() => {}} ariaLabel="Group by" options={[{ value: "type", label: "Type" }, { value: "none", label: "None" }]} />
            </ControlField>
          </div>
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- menus ------------------------------------------------------------- */

function MenusBlock() {
  const [last, setLast] = useState("nothing yet");
  const commands = [
    { label: "Duplicate", onSelect: () => setLast("Duplicate") },
    { label: "Open vendor item", hint: "the full record", onSelect: () => setLast("Open") },
    { label: "Unavailable", disabled: true, hint: "withdraw approval first", onSelect: () => {} },
    { label: "Delete", danger: true, onSelect: () => setLast("Delete") },
  ];

  return (
    <Block id="menus" title="Menus">
      <Grid>
        <Specimen name="MenuButton · caret">
          <MenuButton label="Preview" trigger="Preview" triggerClassName={BUTTON_CLASS} caret items={commands} />
        </Specimen>
        <Specimen name="RowMenu (⋯)">
          <RowMenu label="Row commands" items={commands} align="left" />
        </Specimen>
        <Specimen name="MenuButton · disabled">
          <MenuButton label="Email" trigger="Email…" triggerClassName={BUTTON_CLASS} caret disabled items={commands} />
        </Specimen>
        <Specimen name="ActionMenu · nested submenus">
          <ActionMenu
            align="left"
            ariaLabel="Actions for this record"
            items={[
              ...(["Preview", "Download", "Email…"] as const).map((verb) => ({
                label: verb,
                items: ["Quote", "Invoice", "Receipt", "Order"].map((doc) => ({
                  label: doc,
                  onSelect: () => setLast(`${verb.replace("…", "")} ${doc}`),
                })),
              })),
              { label: "Duplicate", onSelect: () => setLast("Duplicate"), separatorBefore: true },
              { label: "Flag…", onSelect: () => setLast("Flag") },
              { label: "Schedule Production…", onSelect: () => setLast("Schedule"), separatorBefore: true },
              { label: "Cancel Order", danger: true, onSelect: () => setLast("Cancel Order"), separatorBefore: true },
              { label: "Delete", danger: true, onSelect: () => setLast("Delete") },
            ]}
          />
        </Specimen>
      </Grid>
      <Readout>Last command: {last}</Readout>
    </Block>
  );
}

/* ---- tables and filters ------------------------------------------------ */

function TablesBlock() {
  const [rows, setRows] = useState<DemoRow[]>(INITIAL_ROWS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterValues>({ category: "", vendor: "", state: "" });
  const [grouped, setGrouped] = useState(true);

  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("");
  const [active, setActive] = useState<ActiveFilter>("active");
  const [stale, setStale] = useState<StaleFilter>("any");

  const dimensions: FilterDimension<DemoRow>[] = [
    {
      key: "category",
      label: "Category",
      allLabel: "All categories",
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
      matches: (row, value) => row.category === value,
    },
    {
      key: "vendor",
      label: "Vendor",
      allLabel: "All vendors",
      options: VENDORS.map((v) => ({ value: v, label: v })),
      matches: (row, value) => row.vendor === value,
    },
    {
      key: "state",
      label: "Active",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
      matches: (row, value) => (value === "active" ? row.active : !row.active),
    },
  ];

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.name} ${r.vendor}`.toLowerCase().includes(q)) : rows;
  }, [rows, search]);
  const shown = applyListFilters(searched, dimensions, filters);

  const update = (id: string, patch: Partial<DemoRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const allSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));

  const columns: DataColumn<DemoRow>[] = [
    {
      key: "select",
      label: "",
      // The expand arrow rides in the first cell (22px + a 12px gap), so the
      // box needs room beyond its own 16px or it is clipped past the cell.
      width: 90,
      minWidth: 64,
      header: (
        <Checkbox
          checked={allSelected}
          label="Select every row"
          onChange={(on) => setSelected(on ? new Set(shown.map((r) => r.id)) : new Set())}
        />
      ),
      render: (row) => (
        <Checkbox
          checked={selected.has(row.id)}
          label={`Select ${row.name}`}
          onChange={(on) =>
            setSelected((s) => {
              const next = new Set(s);
              if (on) next.add(row.id);
              else next.delete(row.id);
              return next;
            })
          }
        />
      ),
    },
    {
      key: "active",
      label: "Active",
      width: 80,
      sortValue: (r) => (r.active ? 1 : 0),
      render: (row) => (
        <Checkbox size="lg" checked={row.active} onChange={() => update(row.id, { active: !row.active })} label={`${row.name} active`} />
      ),
    },
    {
      key: "name",
      label: "Item",
      width: 220,
      pinned: true,
      sortValue: (r) => r.name,
      render: (row) => (
        <InlineValue
          table="demo"
          column="name"
          value={row.name}
          ariaLabel="Item name"
          onWrite={async (next) => {
            update(row.id, { name: String(next ?? "") });
            return { error: null };
          }}
        />
      ),
    },
    { key: "category", label: "Category", width: 130, sortValue: (r) => r.category, render: (r) => r.category },
    {
      key: "vendor",
      label: "Vendor",
      width: 170,
      sortValue: (r) => r.vendor,
      render: (row) => (
        <InlineValue
          table="demo"
          column="vendor"
          kind="pick"
          options={VENDOR_OPTIONS}
          value={row.vendor}
          ariaLabel="Vendor"
          onWrite={async (next) => {
            update(row.id, { vendor: String(next ?? "") });
            return { error: null };
          }}
        />
      ),
    },
    { key: "pack", label: "Pack", width: 120, hideWhenCompact: true, render: (r) => r.pack },
    {
      key: "price",
      label: "Price",
      width: 100,
      align: "right",
      sortValue: (r) => r.price,
      render: (row) => (
        <InlineValue
          table="demo"
          column="price"
          kind="number"
          align="right"
          value={row.price}
          ariaLabel="Price"
          format={(v) => money(Number(v))}
          onWrite={async (next) => {
            update(row.id, { price: Number(next ?? 0) });
            return { error: null };
          }}
        />
      ),
    },
    {
      key: "par",
      label: "Par",
      width: 70,
      align: "right",
      sortValue: (r) => r.par,
      render: (r) => (r.par === null ? <span className="text-faint">—</span> : r.par),
    },
    {
      key: "last",
      label: "Last ordered",
      width: 120,
      hideWhenCompact: true,
      sortValue: (r) => r.lastOrdered,
      render: (r) => r.lastOrdered ?? <span className="bg-mark-fill px-1">never</span>,
    },
    {
      key: "days",
      label: "Order days",
      width: WEEKDAY_PICKER_WIDTH,
      minWidth: WEEKDAY_PICKER_WIDTH,
      render: (row) => (
        <WeekdayPicker
          table="demo"
          id={row.id}
          column="days"
          label="Order days"
          value={row.days}
          onWrite={async (next) => {
            update(row.id, { days: next });
            return { error: null };
          }}
        />
      ),
    },
    {
      key: "menu",
      label: "",
      width: 60,
      render: (row) => (
        <RowMenu
          label={`${row.name} commands`}
          items={[
            {
              label: "Duplicate",
              onSelect: () =>
                setRows((rs) => [...rs, { ...row, id: `${row.id}-copy-${rs.length}`, name: `${row.name} copy` }]),
            },
            {
              label: "Delete",
              danger: true,
              onSelect: async () => {
                if (!(await confirmDialog({ title: `Delete ${row.name}?`, body: "This is a demo row.", tone: "danger", confirmLabel: "Delete" }))) return;
                setRows((rs) => rs.filter((r) => r.id !== row.id));
              },
            },
          ]}
        />
      ),
    },
  ];

  const listRows = INITIAL_ROWS.filter(
    (r) =>
      (!term || r.name.toLowerCase().includes(term.toLowerCase())) &&
      (!category || r.category === category) &&
      (active === "all" || (active === "active" ? r.active : !r.active))
  );

  return (
    <Block id="tables" title="Tables & filters">
      <Specimen name="PageHeading" wide>
        <PageHeading title="Inventory" code="DF01" visible={shown.length} total={rows.length} noun="items" />
      </Specimen>

      <Specimen name="FilterMenus · leading search · rowAction" wide>
        <FilterMenus
          rows={searched}
          dimensions={dimensions}
          values={filters}
          onChange={setFilters}
          total={rows.length}
          noun="items"
          leading={
            <TextInput search value={search} onValueChange={setSearch} aria-label="Search items" icon={<SearchGlyph />} />
          }
          rowAction={
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { ...INITIAL_ROWS[0], id: `new-${rs.length}`, name: `New item ${rs.length + 1}`, lastOrdered: null },
                ])
              }
            >
              New item
            </button>
          }
        />
      </Specimen>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-4 border border-ink bg-white px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">{selected.size} selected</span>
          <button
            type="button"
            className={DANGER_BUTTON_CLASS}
            onClick={async () => {
              if (!(await confirmDialog({ title: `Delete ${selected.size} items?`, tone: "danger", confirmLabel: "Delete" }))) return;
              setRows((rs) => rs.filter((r) => !selected.has(r.id)));
              setSelected(new Set());
            }}
          >
            Delete
          </button>
          <button type="button" className="ml-auto text-[12px] uppercase tracking-[0.06em] text-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <Specimen name="DataTable · sort, resize, reorder, columns eye, group, totals, expand" wide>
        <DataTable
          rows={shown}
          columns={columns}
          rowKey={(r) => r.id}
          storageKey="interface.demo-table"
          defaultSort={{ key: "category" }}
          columnChooser
          compactBelow={1280}
          leading={
            <div className="flex items-center gap-3">
              <span className="text-[12px] uppercase tracking-[0.06em] text-subtle">Bands</span>
              <Checkbox size="lg" checked={grouped} onChange={setGrouped} label="Group by category" />
              <button type="button" className="text-[12px] uppercase tracking-[0.06em] text-muted underline underline-offset-4 hover:text-ink" onClick={() => setRows(INITIAL_ROWS)}>
                Reset rows
              </button>
            </div>
          }
          group={grouped ? { label: (r) => r.category, sortKey: "category", summary: (rs) => ({ price: money(rs.reduce((s, r) => s + r.price, 0)) }) } : undefined}
          totals={(rs) => ({ name: `${rs.length} items`, price: money(rs.reduce((s, r) => s + r.price, 0)) })}
          rowClassName={(r) => (r.active ? "" : "text-muted")}
          expand={{
            canExpand: (r) => r.note !== "",
            summary: (r) => (r.note ? "note" : null),
            render: (r) => <p className="px-4 py-3 text-sm">{r.note}</p>,
          }}
          empty={<p className="px-4 py-6 text-sm text-muted">No items match.</p>}
        />
      </Specimen>

      <Specimen name="DataTable · scroll pane, dense" wide>
        <DataTable
          rows={rows}
          columns={columns.filter((c) => ["name", "vendor", "price"].includes(c.key))}
          rowKey={(r) => r.id}
          storageKey="interface.demo-pane"
          scroll
          dense
          maxHeightClass="max-h-72"
        />
      </Specimen>

      <Specimen name="ListFilters (the older fixed row)" wide>
        <ListFilters
          term={term}
          onTerm={setTerm}
          placeholder="Search vendor items…"
          categories={CATEGORIES}
          category={category}
          onCategory={setCategory}
          active={active}
          onActive={setActive}
          stale={stale}
          onStale={setStale}
          staleCounts={{ never: 1, over2y: 1, "1to2y": 1, within1y: 9 }}
          totalCount={INITIAL_ROWS.length}
        />
        <Readout>
          {listRows.length} of {INITIAL_ROWS.length} match: {listRows.map((r) => r.name).join(", ") || "none"}
        </Readout>
      </Specimen>
    </Block>
  );
}

/* ---- navigation -------------------------------------------------------- */

const BOOK = ["1", "2", "3", "4", "5", "6"].map((id) => ({ id, href: `/interface?record=${id}` }));
const SECTION_ITEMS = [
  { key: "info", label: "Info" },
  { key: "items", label: "Items", count: 95 },
  { key: "orders", label: "Purchase Orders", count: 19 },
  { key: "invoices", label: "Invoices", count: 10 },
] as const;

function NavigationBlock() {
  usePublishRecordSet("/interface", BOOK);
  const params = useSearchParams();
  const record = params.get("record") ?? "1";
  const [vertical, setVertical] = useState<(typeof SECTION_ITEMS)[number]["key"]>("info");
  const [horizontal, setHorizontal] = useState<(typeof SECTION_ITEMS)[number]["key"]>("items");

  return (
    <Block id="navigation" title="Navigation">
      <Specimen name="Breadcrumbs · RecordNav in trailing" wide>
        <Breadcrumbs
          trail={[{ href: "/interface", label: "Interface" }]}
          current={`Sample record ${record}`}
          trailing={<RecordNav listKey="/interface" id={record} />}
        />
      </Specimen>
      <Grid>
        <Specimen name="SectionNav · vertical">
          <div className="flex gap-8">
            <SectionNav items={SECTION_ITEMS} value={vertical} onSelect={setVertical} ariaLabel="Record sections" className="w-40" />
            <p className="text-sm">Showing: {vertical}</p>
          </div>
        </Specimen>
        <Specimen name='SectionNav · horizontal, size="lg"'>
          <SectionNav
            items={SECTION_ITEMS}
            value={horizontal}
            onSelect={setHorizontal}
            orientation="horizontal"
            size="lg"
            ariaLabel="Record sections, horizontal"
          />
        </Specimen>
        <Specimen name="BackToTop">
          <Readout>Scroll down the page: the round button appears at the lower left.</Readout>
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- panels and dialogs ------------------------------------------------ */

function PanelsBlock() {
  const [dialog, setDialog] = useState<"form" | "long" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string | null>("physical");
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [last, setLast] = useState("nothing yet");
  const [bottom, setBottom] = useState<"none" | "action" | "sticky">("none");
  const [closed, setClosed] = useState(false);

  const close = () => setDialog(null);
  const longRows = Array.from({ length: 40 }, (_, i) => `Vendor item ${i + 1}`).filter((r) =>
    r.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Block id="panels" title="Panels & dialogs">
      <Grid>
        <Specimen name="Dialog · form, Enter commits">
          <button type="button" className={BUTTON_CLASS} onClick={() => setDialog("form")}>
            New location…
          </button>
        </Specimen>
        <Specimen name="Dialog · toolbar, long body">
          <button type="button" className={BUTTON_CLASS} onClick={() => setDialog("long")}>
            Add item…
          </button>
        </Specimen>
        <Specimen name="confirmDialog · alertDialog">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={async () => setLast((await confirmDialog({ title: "Close this order?", body: "1 line's price differs from the catalog." })) ? "confirmed" : "cancelled")}
            >
              Confirm
            </button>
            <button
              type="button"
              className={DANGER_BUTTON_CLASS}
              onClick={async () => setLast((await confirmDialog({ title: "Delete purchase order 132-181227-01?", body: "This cannot be undone.", tone: "danger", confirmLabel: "Delete" })) ? "deleted" : "kept")}
            >
              Danger confirm
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={async () => {
                const outcome = await confirmDialogWithOption({ title: "Complete this order?", option: { label: "Also file invoice 120274 as a bill", defaultChecked: true } });
                setLast(`${outcome.ok ? "completed" : "cancelled"}, option ${outcome.option ? "on" : "off"}`);
              }}
            >
              With option
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              onClick={async () => {
                await alertDialog({ title: "This batch cannot be deleted", body: "It is on 14 plan slots." });
                setLast("alert dismissed");
              }}
            >
              Alert
            </button>
          </div>
          <Readout>Result: {last}</Readout>
        </Specimen>
        <Specimen name="MacTitleBar · a window">
          {closed ? (
            <button type="button" className={BUTTON_CLASS} onClick={() => setClosed(false)}>
              Reopen the window
            </button>
          ) : (
            <div className="w-72 border-2 border-ink bg-white shadow-[4px_4px_0_0_#000]">
              <MacTitleBar title="Opening time" onClose={() => setClosed(true)} />
              <p className="p-4 text-sm">The close box closes this window.</p>
            </div>
          )}
        </Specimen>
        <Specimen name="MacTitleBar · no close box">
          <div className="w-72 border-2 border-ink bg-white">
            <MacTitleBar title="Who are you?" />
            <p className="p-4 text-sm">Rules run to both edges.</p>
          </div>
        </Specimen>
        <Specimen name="RevealPanel">
          <RevealPanel
            label="the filed paperwork"
            header={(toggle) => (
              <div className="flex items-center gap-3 border border-ink bg-white px-4 py-3">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">Paperwork · 3</span>
                <span className="ml-auto">{toggle}</span>
              </div>
            )}
          >
            <ul className="space-y-1 border border-t-0 border-ink bg-white px-4 py-3 text-sm">
              <li>Invoice 73358289.pdf</li>
              <li>Delivery photo.jpg</li>
              <li>Credit memo.pdf</li>
            </ul>
          </RevealPanel>
        </Specimen>
        <Specimen name="Pane · PaneHeader" wide>
          <div className="grid h-64 gap-4 md:grid-cols-2">
            <Pane>
              <PaneHeader>
                <span className="truncate text-[12px] font-semibold uppercase tracking-[0.06em]">Invoice 73358289.pdf</span>
                <button type="button" className={`${BUTTON_CLASS} ml-auto shrink-0`}>
                  Open
                </button>
              </PaneHeader>
              <div className="p-4 text-sm">The document column.</div>
            </Pane>
            <Pane>
              <PaneHeader>
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em]">15 lines</span>
              </PaneHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
                {Array.from({ length: 20 }, (_, i) => (
                  <p key={i}>Line {i + 1}</p>
                ))}
              </div>
            </Pane>
          </div>
        </Specimen>
        <Specimen name="ActionBar · StickyFooter (pinned to the window)" wide>
          <TabPicker
            ariaLabel="Bottom bar"
            value={bottom}
            onChange={setBottom}
            options={[
              { key: "none", label: "None" },
              { key: "action", label: "ActionBar" },
              { key: "sticky", label: "StickyFooter" },
            ]}
          />
        </Specimen>
      </Grid>

      {bottom === "action" && (
        <ActionBar trailing={<ActionBarButton onClick={() => setLast("Generate POs")}>Generate POs…</ActionBarButton>}>
          <ActionBarButton onClick={() => setLast("Next favorite")}>Next favorite</ActionBarButton>
          <ActionBarButton onClick={() => setLast("Clear guide")}>Clear guide</ActionBarButton>
          <ActionBarButton disabled>Disabled</ActionBarButton>
        </ActionBar>
      )}
      {bottom === "sticky" && (
        <StickyFooter>
          <div className="flex items-center gap-4 border-t border-hairline pt-2">
            <span className="text-[12px] uppercase tracking-[0.06em] text-subtle">24 trays on this plan</span>
            <button type="button" className={`${BUTTON_CLASS} ml-auto`} onClick={() => setLast("Add tray")}>
              Add tray
            </button>
          </div>
        </StickyFooter>
      )}

      {dialog === "form" && (
        <Dialog
          title="New location"
          onClose={close}
          onSubmit={name.trim() ? close : undefined}
          footer={
            <>
              <button type="button" className={DIALOG_CANCEL_CLASS} onClick={close}>
                Cancel
              </button>
              <button type="button" className={DIALOG_COMMIT_CLASS} disabled={!name.trim()} onClick={close}>
                Create location
              </button>
            </>
          }
        >
          <div className="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-4 text-sm">
            <label htmlFor="demo-name" className="text-subtle">
              Name
            </label>
            <TextInput id="demo-name" fullWidth value={name} onValueChange={setName} autoFocus />
            <span className="text-subtle">Kind</span>
            <PickList
              variant="field"
              value={kind}
              onPick={setKind}
              ariaLabel="Kind"
              options={[
                { value: "physical", label: "Physical", hint: "a building you walk into" },
                { value: "virtual", label: "Virtual", hint: "off-site events" },
              ]}
            />
            <span className="text-subtle">Opens</span>
            <DateField variant="field" value={date} onChange={setDate} ariaLabel="Opens" />
            <span className="text-subtle">At</span>
            <TimePicker variant="field" value={time} onChange={setTime} ariaLabel="Opening time" />
          </div>
        </Dialog>
      )}

      {dialog === "long" && (
        <Dialog
          title="Add item"
          onClose={close}
          width="max-w-2xl"
          toolbar={<TextInput search fullWidth value={filter} onValueChange={setFilter} aria-label="Find a vendor item" icon={<SearchGlyph />} />}
          footer={
            <button type="button" className={DIALOG_COMMIT_CLASS} onClick={close}>
              Done
            </button>
          }
        >
          <ul className="divide-y divide-hairline text-sm">
            {longRows.map((r) => (
              <li key={r} className="flex items-center justify-between py-2">
                {r}
                <button type="button" className={BUTTON_CLASS}>
                  Add to PO
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </Block>
  );
}

/* ---- documents --------------------------------------------------------- */

function DocumentsBlock() {
  const [dropped, setDropped] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);

  return (
    <Block id="documents" title="Documents">
      <Grid>
        <Specimen name="FileDropZone (PNG, JPEG, PDF)">
          <FileDropZone
            accept={["image/png", "image/jpeg", "application/pdf"]}
            label="Drop to attach"
            onFiles={(files) => setDropped(files.map((f) => f.name))}
            onReject={(files) => setRejected(files.map((f) => f.name))}
            className="border border-ink bg-white px-4 py-10 text-center text-sm"
          >
            Drag a file onto this box.
          </FileDropZone>
          <Readout>
            Accepted: {dropped.join(", ") || "none"} · Refused: {rejected.join(", ") || "none"}
          </Readout>
        </Specimen>
        <Specimen name="DocumentChip">
          <div className="w-44">
            <DocumentChip url={SAMPLE_DOC_URL} fileName="invoice-73358289.svg" contentType="image/svg+xml">
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em]">Invoice</p>
              <p className="text-[11px] text-muted">2026-09-08</p>
            </DocumentChip>
          </div>
        </Specimen>
        <Specimen name="DocumentViewer · image">
          <div className="h-96 border border-ink">
            <DocumentViewer url={SAMPLE_DOC_URL} fileName="invoice-73358289.svg" image />
          </div>
        </Specimen>
      </Grid>
    </Block>
  );
}

/* ---- status and progress ----------------------------------------------- */

function StatusBlock() {
  return (
    <Block id="status" title="Status & progress">
      <Grid>
        <Specimen name="PO_STATUS_CLASS">
          <div className="flex flex-wrap gap-2">
            {PO_STATUS_ORDER.map((s) => (
              <span key={s} className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${PO_STATUS_CLASS[s]}`}>
                {PO_STATUS_LABEL[s]}
              </span>
            ))}
          </div>
        </Specimen>
        <Specimen name="BILL_STAGE_CLASS">
          <div className="flex flex-wrap gap-2">
            {BILL_STAGE_ORDER.map((s) => (
              <span key={s} className={`inline-flex h-6 items-center px-2 text-[12px] font-semibold uppercase tracking-[0.12em] ${BILL_STAGE_CLASS[s]}`}>
                {BILL_STAGE_LABEL[s]}
              </span>
            ))}
          </div>
        </Specimen>
        <Specimen name="StatusChip (pay period)">
          <div className="flex flex-wrap gap-2">
            {PAY_PERIOD_STATUS.map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </div>
        </Specimen>
        <Specimen name="ScoreChip">
          <div className="flex flex-wrap items-center gap-2">
            <ScoreChip score="97" />
            <ScoreChip score="85" />
            <ScoreChip score="72" />
            <ScoreChip score="A" />
            <ScoreChip score={null} />
          </div>
        </Specimen>
        <Specimen name="mark fill · go · stop · accent ink">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="bg-mark-fill px-1">worth your eye</span>
            <span className="bg-go px-1">ordered</span>
            <span className="bg-[var(--rf-red-200)] px-1">zeroed</span>
            <span className="text-accent">refused</span>
            <span className="text-go-ink">+12%</span>
          </div>
        </Specimen>
        <Specimen name="ProgressBand">
          <ProgressBand label="Reading the invoice" note="This takes about thirty seconds." />
        </Specimen>
        <Specimen name="PageLoading">
          <PageLoading label="the vendor list" />
        </Specimen>
      </Grid>
    </Block>
  );
}
