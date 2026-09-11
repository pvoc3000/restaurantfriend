"use client";

/**
 * IS THE HIDDEN-FRAME ROUTE ANY GOOD ON THIS DEVICE? On iOS and iPadOS every
 * browser is WebKit, and WebKit there prints only the FIRST PAGE of a PDF
 * inside a frame — so an eight-page manual prints as one page, silently, which
 * is worse than not printing at all. iPadOS 13+ reports itself as "MacIntel"
 * with touch points, which is what the second test is for.
 *
 * KEYED ON THE PLATFORM, NOT THE SHELL (`useShell`), which is `CalendarGrid`'s
 * and `TimePicker`'s rule in this app: which engine is drawing the page is a
 * capability, where the shell is a posture somebody chose — a manager reading
 * the desk shell on their own iPad has the same WebKit underneath.
 */
function framePrintsWholeDocument(): boolean {
  if (typeof navigator === "undefined") return true;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !ios;
}

/**
 * Print a filed document from the page it is shown on (Mark, 2026-09-06:
 * "Is it possible to add a 'print' option … along with open, download, and
 * remove?"). It is, by one route: a PDF served from ANOTHER origin cannot be
 * printed by the page directly — `window.open(url).print()` is refused
 * cross-origin — but the signed URL already allows the app's origin to FETCH
 * it, and a blob: URL is same-origin. So: fetch the bytes, put them in a
 * hidden iframe, and ask that frame to print. The technique print-js uses.
 *
 * ON iOS THE FILE IS OPENED IN A NEW TAB INSTEAD (Mark, 2026-09-11: "I need to
 * be able to print the documents using preview … I can on a desktop but not on
 * a tablet"), where the share sheet's Print is AirPrint — the route every
 * react-pdf document in this app already takes on an iPad. The tab is opened
 * BEFORE any `await`, so it is still inside the click gesture: a window opened
 * after one is silently blocked (`openWindowNow`'s rule). Callers must
 * therefore reach this from a click handler, not after awaiting something else.
 *
 * Resolves once the print dialog has been asked for, not when printing is
 * done — there is no reliable "done" across browsers.
 */
export async function printDocument(url: string, contentType: string | null): Promise<void> {
  if (!framePrintsWholeDocument()) {
    const win = window.open(url, "_blank");
    if (!win) throw new Error("The browser blocked the new tab. Allow pop-ups for this site, then try again.");
    return;
  }
  return printInFrame(url, contentType);
}

async function printInFrame(url: string, contentType: string | null): Promise<void> {
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
