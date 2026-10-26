"use client";

import { createContext, useContext, useState } from "react";
import { TextInput } from "@/components/ui/TextInput";
import { SearchGlyph } from "@/components/ui/SearchGlyph";

/**
 * A SCHEDULE'S NAME SEARCH, shared between two places that are far apart on
 * the page (Mark, 2026-10-26): the box sits in the record's field grid beside
 * Sells at and Made at, while the table it filters is `ScheduleLines`, well
 * below. The record screen is a server component, so the term cannot live in
 * it; this provider wraps both and holds it.
 */
const ScheduleSearchContext = createContext<{
  search: string;
  setSearch: (s: string) => void;
}>({ search: "", setSearch: () => {} });

export function ScheduleSearchProvider({ children }: { children: React.ReactNode }) {
  const [search, setSearch] = useState("");
  return (
    <ScheduleSearchContext.Provider value={{ search, setSearch }}>
      {children}
    </ScheduleSearchContext.Provider>
  );
}

export function useScheduleSearch() {
  return useContext(ScheduleSearchContext).search;
}

export function ScheduleSearchBox() {
  const { search, setSearch } = useContext(ScheduleSearchContext);
  return (
    <TextInput
      value={search}
      onValueChange={setSearch}
      aria-label="Search items by name"
      clearLabel="Clear the search"
      search
      fullWidth
      icon={<SearchGlyph />}
    />
  );
}
