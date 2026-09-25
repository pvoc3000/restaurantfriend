import type { MetadataRoute } from "next";

/**
 * THE HOME-SCREEN WEB APP (Mark, 2026-09-25: "hide the url bar and make it
 * look more app like"). `display: standalone` is what drops Safari's toolbar
 * when the app is opened from its home-screen icon; the tablet bar's own Back
 * and Home replace the browser's. Served signed out — `proxy.ts`'s matcher
 * skips `.webmanifest`, because iPadOS fetches this when the icon is added,
 * before anybody has signed in.
 *
 * `start_url` is `/`, which already lands per role and per shell.
 *
 * THE ICONS ARE DONUT FRIEND'S ARTWORK, a static file rather than
 * `orgs.settings` — a bend of design rule 2, accepted while there is one org:
 * the manifest is fetched with no session, so it has no org to read.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Restaurant Friend",
    short_name: "Restaurant Friend",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
