/**
 * The organisation's documents — the pure half (migration 094).
 *
 * "A place to store, retrieve, and print the documents the organization uses"
 * (Mark, 2026-09-05): forms, checklists, signs, cheat sheets, job
 * descriptions, manuals. A record and its file(s); nothing else.
 */
import type { FiledDocumentsTarget } from "@/components/documents/FiledDocuments";
import { PHOTO_ACCEPT } from "./facilityPhotos";

export type OrgDocument = {
  id: string;
  location_id: string | null;
  title: string;
  version: string | null;
  category: string | null;
  description: string | null;
  notes: string | null;
  submitted_by: string | null;
  added_on: string | null;
};

/** ONE string literal — `EVENT_SELECT`'s reason. */
export const DOCUMENT_SELECT =
  "id, location_id, title, version, category, description, notes, submitted_by, added_on, created_at";

export const DOCUMENT_BUCKET = "org-documents";

/** PDFs mostly, a PNG sign now and then (FileMaker holds one). */
export const DOCUMENT_ACCEPT = ["application/pdf", ...PHOTO_ACCEPT] as const;

export function documentRejection(file: { name: string; type: string }): string | null {
  if ((DOCUMENT_ACCEPT as readonly string[]).includes(file.type)) return null;
  return `${file.name} isn't a file the app can file here. PDF, JPEG, PNG or WebP.`;
}

export const ORG_DOCUMENT_FILES: FiledDocumentsTarget = {
  table: "org_document_files",
  ownerColumn: "document_id",
  bucket: DOCUMENT_BUCKET,
  accept: DOCUMENT_ACCEPT,
  rejection: documentRejection,
  heading: "File",
  noun: "the file",
};

/**
 * FileMaker's export named each file `{shop}_{category}_{title}_{version}_{original}`
 * — "the filenames should help you associate the document with the right
 * record" (Mark). This is that association: the prefix the record would have
 * produced, compared exactly. `ALL` is a document with no shop.
 */
export function exportPrefix(record: {
  location_code: string | null;
  category: string | null;
  title: string;
  version: string | null;
}): string {
  return `${record.location_code ?? "ALL"}_${record.category ?? ""}_${record.title}_${record.version ?? ""}_`;
}

export function fileMatchesRecord(
  fileName: string,
  record: { location_code: string | null; category: string | null; title: string; version: string | null }
): boolean {
  return fileName.startsWith(exportPrefix(record));
}
