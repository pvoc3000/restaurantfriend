"use client";

/**
 * Print a filed document from the page it is shown on (Mark, 2026-09-06:
 * "Is it possible to add a 'print' option … along with open, download, and
 * remove?"). It is, by one route: a PDF served from ANOTHER origin cannot be
 * printed by the page directly — `window.open(url).print()` is refused
 * cross-origin — but the signed URL already allows the app's origin to FETCH
 * it, and a blob: URL is same-origin. So: fetch the bytes, put them in a
 * hidden iframe, and ask that frame to print. The technique print-js uses.
 *
 * Known limit, not fixable from here: iOS Safari prints only the first page
 * of a PDF inside a frame. On an iPad, Open and the viewer's own print button
 * is the whole-document route, which is why Open stays beside this.
 *
 * Resolves once the print dialog has been asked for, not when printing is
 * done — there is no reliable "done" across browsers.
 */
export async function printDocument(url: string, contentType: string | null): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the file (${res.status}).`);
  const blob = await res.blob();
  const isImage = (contentType ?? blob.type).startsWith("image/");
  const objectUrl = URL.createObjectURL(blob);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";

  const cleanup = () => {
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      frame.remove();
    }, 60_000); // Long enough for the dialog; the frame is invisible meanwhile.
  };

  await new Promise<void>((resolve, reject) => {
    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("The print frame did not open.");
        win.focus();
        win.print();
        cleanup();
        resolve();
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    frame.onerror = () => {
      cleanup();
      reject(new Error("The print frame could not load the file."));
    };
    if (isImage) {
      // An image prints from a page of its own, sized to the sheet.
      frame.srcdoc = `<!doctype html><html><head><style>html,body{margin:0}img{max-width:100%;max-height:100vh}</style></head><body><img src="${objectUrl}" onload="" /></body></html>`;
    } else {
      frame.src = objectUrl;
    }
    document.body.appendChild(frame);
  });
}
