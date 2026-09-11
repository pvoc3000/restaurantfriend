"use client";

/**
 * THE CLASSIC MAC TITLE BAR (Mark, 2026-09-10, with a System 6 window as the
 * reference): six 1px rules across white, a close box in a white break on the
 * left, and the title in a white break in the middle.
 *
 * The rules are a gradient on their own layer, so the close box and the title
 * break them simply by being white. It sits at the top of a window drawn as a
 * 2px black frame (`border-2 border-ink`) with a hard shadow; the bar supplies
 * the 2px rule beneath itself.
 *
 * `onClose` is what the close box DOES, and each window says: the time picker
 * commits, like a click away; the lock screen goes back to the names. With no
 * `onClose` the close box is not drawn, but its break in the rules is kept, so
 * the bar looks the same whether or not it can close.
 */
export function MacTitleBar({
  title,
  onClose,
  closeLabel = "Close",
  titleAs: Title = "span",
}: {
  title: string;
  onClose?: () => void;
  closeLabel?: string;
  /** `h1` where the window IS the page (the lock screen) — the heading has to
   *  be the title itself, since an `h1` cannot hold the bar's block layout. */
  titleAs?: "span" | "h1";
}) {
  return (
    <div className="relative flex h-[22px] shrink-0 items-center border-b-2 border-ink bg-white px-[5px]">
      <div
        aria-hidden
        className="absolute inset-x-[3px] inset-y-[4px]"
        style={{
          backgroundImage: "repeating-linear-gradient(to bottom, #000 0 1px, transparent 1px 2px)",
        }}
      />
      {onClose ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="relative bg-white px-[3px]"
        >
          <span className="block h-[13px] w-[13px] border-2 border-ink bg-white active:bg-ink" />
        </button>
      ) : (
        <span aria-hidden className="relative block h-[13px] w-[19px] bg-white" />
      )}
      <Title className="absolute left-1/2 max-w-[60%] -translate-x-1/2 truncate bg-white px-2 text-[13px] leading-[14px] font-bold text-ink">
        {title}
      </Title>
    </div>
  );
}
