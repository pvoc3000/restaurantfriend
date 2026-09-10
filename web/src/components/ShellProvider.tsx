"use client";

import { createContext, useContext } from "react";

import type { Shell } from "@/lib/shell";

/**
 * Which shell the page is inside, for the few shared components that behave
 * differently under the tablet bar — today only `ui/RecordNav`, which moves
 * into the bar rather than sitting in the breadcrumb row. Provided by the
 * `(app)` layout; the `(fullscreen)` runners have no bar and no provider, so
 * they read "desk", which is the render they have always had.
 */
const ShellContext = createContext<Shell>("desk");

export function ShellProvider({ shell, children }: { shell: Shell; children: React.ReactNode }) {
  return <ShellContext.Provider value={shell}>{children}</ShellContext.Provider>;
}

export function useShell(): Shell {
  return useContext(ShellContext);
}
