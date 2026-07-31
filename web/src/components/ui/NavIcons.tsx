// The left navigation rail's section marks.
//
// Material Symbols, SHARP cut, weight 300, optical size 24 — Google, Apache
// License 2.0 (github.com/google/material-design-icons). The paths are copied in
// rather than pulled from a package: six marks don't justify a dependency, and
// the design system's rule is "do not introduce an icon library; it will read as
// someone else's product". Sharp is the cut with square corners and mitered
// joins, which is the one that matches this product — the system is square
// everywhere (radius tokens are all 0) and flat.
//
// A note on construction, because it differs from the two marks we drew
// ourselves: HomeIcon and GearIcon in ui/IconButton are STROKED paths — 1.5px,
// square caps, no fill. Material Symbols are FILLED paths that read as outlines.
// At weight 300 and 24px the apparent line lands close to our 1.5px, but they
// are not the same construction, and the two sit side by side in the sidebar's
// top bar. If they ever stop looking like one family, this is why.
//
// Deliberately NOT in lib/nav.ts: that module is pure data and pure functions
// with no React import, and the whole menu — top bar and rail alike — reads from
// it. The slug→mark map lives here so the sidebar can be deleted without
// touching the menu's own model.

const PATHS: Record<string, string> = {
  // storefront
  location:
    "M830.61-521.08V-130H130.62v-391.85q-24.16-19.84-36.27-51.5-12.12-31.65-.5-68.34L151.77-830h656.92l58.69 188.31q11.62 36.69-.5 68.11-12.11 31.43-36.27 52.5ZM568.62-550q32.77 0 49.27-20.04t13.5-43.04L607.08-770h-96.47v158q0 25.23 17.08 43.62Q544.77-550 568.62-550Zm-180 0q27.61 0 44.8-18.38 17.2-18.39 17.2-43.62v-158h-96.47l-24.3 158.46q-3.24 21.31 13.38 41.43Q359.85-550 388.62-550Zm-178 0q22.23 0 38.23-15.5 16-15.5 19.77-38.96L292.15-770h-97.61l-41.93 141.69q-7.92 25.77 7.47 52.04Q175.46-550 210.62-550Zm540 0q32.46 0 49.69-25.5 17.23-25.5 8.31-52.81L765.08-770h-96l23.53 165.54q3.77 23.46 19.77 38.96t38.24 15.5ZM190.61-190h580.01v-303.54q-6.54 2.39-10.93 2.96-4.38.58-9.07.58-27 0-47.5-9.77t-39.74-31.31q-16.84 18.77-39.84 29.93-23 11.15-52.46 11.15-25.46 0-48-10.58-22.54-10.57-42.46-30.5-18.54 19.93-42 30.5Q415.15-490 391.08-490q-27.08 0-50.77-9.81-23.69-9.81-41.69-31.27-25.24 25.23-46.51 33.16-21.26 7.92-41.49 7.92-4.7 0-9.7-.58-5-.57-10.31-2.96V-190Z",
  // group
  hr: "M71.93-187.69v-88.93q0-30.92 15.96-55.19 15.96-24.27 42.63-37.76 57.02-27.89 114.67-43.01 57.66-15.11 126.73-15.11 69.08 0 126.73 15.11 57.66 15.12 114.68 43.01 26.67 13.49 42.63 37.76 15.96 24.27 15.96 55.19v88.93H71.93Zm679.99 0v-93.85q0-39.38-19.28-75.07-19.29-35.68-54.72-61.23 40.23 6 76.39 18.57 36.15 12.58 69 29.73 31 16.54 47.88 38.99 16.88 22.44 16.88 49.01v93.85H751.92Zm-380-304.62q-57.75 0-98.87-41.12-41.12-41.13-41.12-98.88 0-57.75 41.12-98.87 41.12-41.13 98.87-41.13 57.75 0 98.88 41.13 41.12 41.12 41.12 98.87 0 57.75-41.12 98.88-41.13 41.12-98.88 41.12Zm345.38-140q0 57.75-41.12 98.88-41.12 41.12-98.87 41.12-6.77 0-17.23-1.54-10.47-1.54-17.23-3.38 23.66-28.45 36.37-63.12 12.7-34.67 12.7-72 0-37.34-12.96-71.73-12.96-34.38-36.11-63.3 8.61-3.08 17.23-4 8.61-.93 17.23-.93 57.75 0 98.87 41.13 41.12 41.12 41.12 98.87ZM131.92-247.69h480v-28.93q0-12.53-6.27-22.3-6.26-9.77-19.88-17.08-49.38-25.46-101.69-38.58-52.31-13.11-112.16-13.11-59.84 0-112.15 13.11-52.31 13.12-101.69 38.58-13.62 7.31-19.89 17.08-6.27 9.77-6.27 22.3v28.93Zm240-304.62q33 0 56.5-23.5t23.5-56.5q0-33-23.5-56.5t-56.5-23.5q-33 0-56.5 23.5t-23.5 56.5q0 33 23.5 56.5t56.5 23.5Z",
  // checklist
  operations:
    "M227.77-221.92 100-349.69l41.77-41.77 85 85 170-170 41.77 42.77-210.77 211.77Zm0-304.62L100-654.31l41.77-41.77 85 85 170-170 41.77 42.77-210.77 211.77Zm292.61 228.85v-60h340v60h-340Zm0-304.62v-60h340v60h-340Z",
  // factory
  production:
    "M100-100v-447.54l240-102.07v79.23l200-80V-540h320v440H100Zm60-60h640v-320H480v-82l-200 80v-78l-120 53v347Zm284.62-89.23h70.76v-141.54h-70.76v141.54Zm-160 0h70.76v-141.54h-70.76v141.54Zm320 0h70.76v-141.54h-70.76v141.54ZM860-540H697.69l40-304.61h84.62L860-540Z",
  // inventory_2
  purchasing:
    "M140-100v-512.31h-40V-860h760v247.69h-40V-100H140Zm60-60h560v-452.31H200V-160Zm-40-512.31h640V-800H160v127.69Zm207.69 249.62h224.62V-480H367.69v57.31ZM480-386.15Z",
  // receipt_long
  "special-orders":
    "M240-100q-41.92 0-70.96-29.04Q140-158.08 140-199.82V-300h120v-552.31l55.39 47.7 56.15-47.7 56.15 47.7 56.16-47.7 56.15 47.7 56.15-47.7 56.16 47.7 56.15-47.7 56.15 47.7 55.39-47.7V-200q0 41.92-29.04 70.96Q761.92-100 720-100H240Zm480-60q17 0 28.5-11.5T760-200v-560H320v460h360v100q0 17 11.5 28.5T720-160ZM367.69-610v-60h226.92v60H367.69Zm0 120v-60h226.92v60H367.69Zm310-114.62q-14.69 0-25.04-10.34-10.34-10.35-10.34-25.04t10.34-25.04q10.35-10.34 25.04-10.34t25.04 10.34q10.35 10.35 10.35 25.04t-10.35 25.04q-10.35 10.34-25.04 10.34Zm0 120q-14.69 0-25.04-10.34-10.34-10.35-10.34-25.04t10.34-25.04q10.35-10.34 25.04-10.34t25.04 10.34q10.35 10.35 10.35 25.04t-10.35 25.04q-10.35 10.34-25.04 10.34ZM240-160h380v-80H200v40q0 17 11.5 28.5T240-160Z",
  // menu — the rail's own expand/collapse, not a section
  menu: "M140-254.62v-59.99h680v59.99H140ZM140-450v-60h680v60H140Zm0-195.39v-59.99h680v59.99H140Z",
};

/**
 * One 24px mark. Material Symbols are drawn on a 960 grid with the origin at the
 * baseline, hence the unusual viewBox — it is theirs, not a mistake.
 */
export function NavIcon({ name }: { name: string }) {
  const d = PATHS[name];
  if (!d) return null;

  return (
    <svg
      viewBox="0 -960 960 960"
      width="24"
      height="24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
