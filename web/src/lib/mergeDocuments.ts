"use client";

/**
 * Roll several filed documents into ONE PDF (Mark, 2026-09-11: "selecting
 * multiple documents should roll them into a single pdf before opening").
 * Printing five signs then means one tab and one print, rather than five of
 * each — and on an iPad, where Safari allows about one new tab per tap, it is
 * the difference between printing a selection and printing the first of it.
 *
 * IMPORT THIS DYNAMICALLY (`await import(...)`) FROM A CLICK HANDLER, the rule
 * every PDF path in this app follows: pdf-lib is about a megabyte, and no
 * screen should carry it just in case somebody merges something.
 *
 * A PDF contributes its pages; an image contributes a page of its own, scaled
 * to fit a Letter sheet. Anything that cannot be read is SKIPPED AND NAMED
 * rather than failing the merge — a corrupt scan among five documents should
 * not cost you the other four, and a silent omission is worse than either.
 */

export type MergeSource = {
  /** A signed URL the app's own origin may fetch. */
  url: string;
  fileName: string | null;
  contentType: string | null;
};

export type MergeResult = {
  blob: Blob;
  /** Files left out, by name — shown to the reader, never swallowed. */
  skipped: string[];
  /** How many files really went in. Zero means nothing could be read. */
  merged: number;
};

/** US Letter, the size every document here is printed on. */
const LETTER = { width: 612, height: 792 };

function isPdf(bytes: Uint8Array, contentType: string | null): boolean {
  if ((contentType ?? "").includes("pdf")) return true;
  // "%PDF" — trust the bytes over a content type somebody's upload guessed.
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Anything that is not JPEG or PNG — a WebP sign, say — through a canvas,
 * which is the only image decoder a browser hands out. pdf-lib embeds those
 * two formats and no others.
 */
async function toPngBytes(bytes: Uint8Array, contentType: string | null): Promise<Uint8Array> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: contentType ?? "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not read that image.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("The browser could not convert that image.");
  return new Uint8Array(await png.arrayBuffer());
}

export async function mergeToSinglePdf(sources: readonly MergeSource[]): Promise<MergeResult> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  const skipped: string[] = [];
  let merged = 0;

  for (const source of sources) {
    const name = source.fileName ?? "a file";
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());

      if (isPdf(bytes, source.contentType)) {
        // `ignoreEncryption`: a vendor's own PDF is often stamped
        // print-protected, which is not a reason to refuse to print it.
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(doc, doc.getPageIndices());
        pages.forEach((page) => out.addPage(page));
        merged++;
        continue;
      }

      const type = source.contentType ?? "";
      const image =
        type.includes("jpeg") || type.includes("jpg")
          ? await out.embedJpg(bytes)
          : type.includes("png")
            ? await out.embedPng(bytes)
            : await out.embedPng(await toPngBytes(bytes, source.contentType));

      // A sheet the long way up or across, whichever wastes less paper, with
      // the picture scaled to fit and centred.
      const landscape = image.width > image.height;
      const width = landscape ? LETTER.height : LETTER.width;
      const height = landscape ? LETTER.width : LETTER.height;
      const page = out.addPage([width, height]);
      const scale = Math.min(width / image.width, height / image.height);
      const drawn = { width: image.width * scale, height: image.height * scale };
      page.drawImage(image, {
        x: (width - drawn.width) / 2,
        y: (height - drawn.height) / 2,
        width: drawn.width,
        height: drawn.height,
      });
      merged++;
    } catch {
      skipped.push(name);
    }
  }

  const saved = await out.save();
  return { blob: new Blob([saved as unknown as BlobPart], { type: "application/pdf" }), skipped, merged };
}

/** What the merged file is called when it lands in somebody's downloads. */
export function mergedFileName(today: string, count: number, prefix = "documents"): string {
  return `${prefix}-${today}-${count}-files.pdf`;
}
