-- ============================================================================
-- 221 — THE BAKER'S PERCENTAGE COUNTS FROM A LINE YOU CHOOSE
--
-- The `%` column reads every line as a share of one line at 100%. Until now
-- that line was the FIRST one that could be weighed, which is the flour in a
-- dough and an accident everywhere else (Mark, 2026-11-03: "we should have to
-- set which row is the reference element"). The ingredient sheet gains a Base
-- column, one radio per line, and the chosen line is the 100%.
--
-- One flag per line, at most one per version — the partial unique index is
-- 036's one-master rule applied to lines. Nothing is backfilled: a version with
-- no base set keeps counting from its first weighable line, and its radio shows
-- that line, so no percentage changes until somebody picks.
--
-- The lines' existing update policy covers the new column. The app clears the
-- old base before setting the new one, the order the index needs.
--
-- Two statements, both below. Run after 220. Wrap in begin/commit. RERUNNABLE.
-- ============================================================================

alter table public.production_recipe_lines
  add column if not exists percent_base boolean not null default false;

create unique index if not exists production_recipe_lines_one_percent_base
  on public.production_recipe_lines (version_id)
  where percent_base;
