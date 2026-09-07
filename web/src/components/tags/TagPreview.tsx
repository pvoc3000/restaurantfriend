import {
  LABEL_POINTS,
  PRICE_FONT_SIZE,
  imageBoxFor,
  priceBoxFor,
  type TagSize,
} from "@/lib/displayTags";

/**
 * One label as it will print, in CSS — the PDF's twin, reading the same
 * constants from `lib/displayTags`. `scale` is CSS pixels per point; the three
 * sizes on a record share one scale so they read against each other.
 *
 * The `<img>` is keyed by its storage path by the caller: the signed URL is
 * minted afresh on every server render, and without the key a `router.refresh`
 * after a quantity edit would flicker every background on the page.
 */
export function TagPreview({
  size,
  url,
  price,
  scale,
}: {
  size: TagSize;
  url: string | null;
  /** "$4.95", or null to leave the art's own price showing (nothing to say). */
  price: string | null;
  scale: number;
}) {
  const label = LABEL_POINTS[size];
  const art = imageBoxFor(size);
  const box = priceBoxFor(size);
  const px = (n: number) => `${n * scale}px`;
  return (
    <div
      className="relative overflow-hidden border border-hairline"
      style={{ width: px(label.w), height: px(label.h), backgroundColor: size === "2x10" ? "#000" : "#fff" }}
      aria-label={`${size} preview`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed private URL, sized by the label, not by the viewport
        <img
          src={url}
          alt=""
          className="absolute"
          style={{ left: px(art.x), top: px(art.y), width: px(art.w), height: px(art.h) }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[12px] uppercase tracking-[0.08em] text-faint">
          No {size} background
        </div>
      )}
      {url && price ? (
        <div
          className="absolute flex items-center justify-center bg-black text-white"
          style={{
            left: px(box.x),
            top: px(box.y),
            width: px(box.w),
            height: px(box.h),
            fontFamily: "Helvetica, Arial, sans-serif",
            fontWeight: 700,
            fontSize: px(PRICE_FONT_SIZE[size]),
            lineHeight: 1,
          }}
        >
          {price}
        </div>
      ) : null}
    </div>
  );
}
