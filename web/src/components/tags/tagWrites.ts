import type { SupabaseClient } from "@supabase/supabase-js";
import { duplicateTitle } from "@/lib/productionPlans";
import { TAG_BUCKET, TAG_SELECT, TAG_SIZES, tagImagePath, type DisplayTag, type TagSize } from "@/lib/displayTags";

/**
 * The two writes that have more than one door — the list's selection bar and
 * row menu, and the record's own buttons — so the confirm's count, the
 * `.select()` discipline and the write ORDER are remembered in one place
 * (`renderPoPdf` / `deleteOrders`' rule).
 */

/** Row first, then the objects: a tag's image rows cascade with it, and an
 *  orphaned object is invisible where a row pointing at nothing is not. Every
 *  write `.select()`s its own result — a refused delete removes zero rows and
 *  returns NO error. */
export async function deleteTags(
  supabase: SupabaseClient,
  tags: readonly { id: string; paths: readonly string[] }[]
): Promise<{ deleted: number; error: string | null }> {
  const ids = tags.map((t) => t.id);
  const { data, error } = await supabase.from("display_tags").delete().in("id", ids).select("id");
  if (error) return { deleted: 0, error: error.message };
  const gone = new Set((data ?? []).map((r) => r.id as string));
  const paths = tags.filter((t) => gone.has(t.id)).flatMap((t) => [...t.paths]);
  if (paths.length > 0) await supabase.storage.from(TAG_BUCKET).remove(paths);
  return {
    deleted: gone.size,
    error: gone.size === ids.length ? null : `${ids.length - gone.size} of ${ids.length} were not deleted — you may not have permission.`,
  };
}

/**
 * A copy of a tag — title "… copy", the same item, description and state,
 * and every background COPIED in the bucket under the new tag's own folder
 * (095's policies authorise off the folder, so the copy cannot share the
 * original's objects). Written parent-first; if a background fails to copy
 * the tag still exists and the failure is named, since a record with two of
 * three sizes is a real thing to land on and fix.
 */
export async function duplicateTag(
  supabase: SupabaseClient,
  orgId: string,
  tagId: string
): Promise<{ id: string | null; warning: string | null; error: string | null }> {
  const [{ data: tag, error }, { data: images }, { data: titles }] = await Promise.all([
    supabase.from("display_tags").select(TAG_SELECT).eq("id", tagId).maybeSingle(),
    supabase.from("display_tag_images").select("size, storage_path, file_name, content_type, byte_size").eq("tag_id", tagId),
    supabase.from("display_tags").select("title").eq("org_id", orgId),
  ]);
  if (error) return { id: null, warning: null, error: error.message };
  if (!tag) return { id: null, warning: null, error: "That tag no longer exists." };
  const source = tag as unknown as DisplayTag;
  const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { data: created, error: insertError } = await supabase
    .from("display_tags")
    .insert({
      org_id: orgId,
      title: duplicateTitle((titles ?? []).map((t) => t.title as string), source.title),
      description: source.description,
      production_item_id: source.production_item_id,
      is_active: source.is_active,
      created_by: uid,
    })
    .select("id")
    .single();
  if (insertError || !created) return { id: null, warning: null, error: insertError?.message ?? "The copy was not created." };

  const failed: string[] = [];
  for (const size of TAG_SIZES) {
    const img = (images ?? []).find((i) => i.size === size);
    if (!img) continue;
    const to = tagImagePath(orgId, created.id, (img.file_name as string | null) ?? img.storage_path);
    const copy = await supabase.storage.from(TAG_BUCKET).copy(img.storage_path as string, to);
    if (copy.error) { failed.push(size); continue; }
    const { data: row, error: rowError } = await supabase
      .from("display_tag_images")
      .insert({
        org_id: orgId,
        tag_id: created.id,
        size: size as TagSize,
        storage_path: to,
        file_name: img.file_name,
        content_type: img.content_type,
        byte_size: img.byte_size,
        uploaded_by: uid,
      })
      .select("id");
    if (rowError || !row || row.length === 0) {
      await supabase.storage.from(TAG_BUCKET).remove([to]);
      failed.push(size);
    }
  }
  return {
    id: created.id,
    warning: failed.length ? `The ${failed.join(", ")} background${failed.length === 1 ? " did" : "s did"} not copy — attach it on the new tag.` : null,
    error: null,
  };
}
