/**
 * The screen behind a menu item that doesn't exist yet.
 *
 * The whole menu is walkable before the modules are written, so every tab has
 * to land somewhere honest. Deliberately plain: a kicker, the screen's name,
 * one sentence. No breadcrumbs, no action bar, nothing to mistake for a
 * feature.
 */
export function NotBuiltYet({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">{kicker}</p>
      <h1 className="mt-1 text-[28px] leading-tight font-bold uppercase tracking-[0.06em] text-ink">
        {title}
      </h1>
      <div className="mt-4 border-t-2 border-ink" />
      <p className="mt-6 max-w-[72ch] text-sm text-muted">
        This screen hasn&rsquo;t been built yet. It&rsquo;s in the menu so the shape of the
        system is visible while the modules are written one at a time — Purchasing is
        the one that works today.
      </p>
    </div>
  );
}
