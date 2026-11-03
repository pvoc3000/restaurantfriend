-- ============================================================================
-- 222 — A RECIPE LINE CAN BE A DIVIDER OR A SPACER
--
-- Mark, 2026-11-03: "I think we used to be able to add dividers between rows
-- … dividers and spacers." Neither FileMaker nor this app ever had them as a
-- feature; FileMaker's bakers typed "-" as an ingredient to draw a break, and
-- 13 such lines came over (the blueberry glazes), each reading here as an
-- ingredient named "-".
--
-- `kind` says what a line IS: 'ingredient' (every line until now, and the
-- default, so no writer has to learn about it), 'divider' (a rule across the
-- sheet) or 'spacer' (an empty row). Neither of the two new kinds carries an
-- ingredient or an amount — the check says so, which is also what keeps them
-- out of costing, the % column and the batch view's amounts.
--
-- The "-" lines are converted: element-less, no amount, label exactly "-".
-- Their label is cleared with them, since a divider draws a rule, not text.
--
-- The lines' existing policies cover the column. Three statements, in order:
-- the column, the backfill, then the check (which the backfill must satisfy).
-- Run after 221. Wrap in begin/commit. RERUNNABLE.
-- ============================================================================

alter table public.production_recipe_lines
  add column if not exists kind text not null default 'ingredient';

update public.production_recipe_lines
   set kind = 'divider', label = null
 where kind = 'ingredient'
   and element_id is null
   and qty is null
   and btrim(label) = '-';

alter table public.production_recipe_lines
  drop constraint if exists production_recipe_lines_kind_check;

alter table public.production_recipe_lines
  add constraint production_recipe_lines_kind_check check (
    kind in ('ingredient', 'divider', 'spacer')
    and (kind = 'ingredient' or (element_id is null and qty is null))
  );
