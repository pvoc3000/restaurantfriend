"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Asks `calendar-sync` to read the subscribed calendars that have gone stale,
 * then refreshes the page so what it found is drawn.
 *
 * THERE IS NO CRON IN THIS APP, so an outside calendar is read the way standing
 * orders are topped up: when somebody opens the screen that shows it. The page
 * decides WHETHER (`subscriptionIsStale`, on the server, from the stored
 * last-read time) and mounts this only when there is something to do; this
 * does it once per mount and draws nothing. The function itself declines to
 * re-read anything fetched in the last five minutes, so thirty people opening
 * the calendar together are one fetch.
 *
 * A failure is not reported here: the function writes it onto the
 * subscription, and the refreshed page shows it by name.
 */
export function FeedRefresher({ staleKey }: { staleKey: string }) {
  const router = useRouter();
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (asked.current === staleKey) return;
    asked.current = staleKey;
    let cancelled = false;
    void createClient()
      .functions.invoke("calendar-sync", { body: {} })
      .then(() => {
        if (!cancelled) router.refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [staleKey, router]);

  return null;
}
