"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ProseField } from "./fields";

/**
 * The narrative — FMP's page 7, and the field with the most value in the whole
 * report. Nine years of it in FileMaker runs to a median 557 characters and
 * only 43 of 13,059 are empty, which is a better argument for its worth than
 * anything this comment could add.
 *
 * The prompt is FMP's, verbatim, including the part that is a house rule
 * rather than an instruction.
 */
export function ReportPage({
  reportId,
  narrative,
  editable,
}: {
  reportId: string;
  narrative: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [, startTransition] = useTransition();

  const save = useCallback(
    (next: string | null) => {
      startTransition(async () => {
        await supabase
          .from("shift_reports")
          .update({ narrative: next })
          .eq("id", reportId)
          .select("id");
        router.refresh();
      });
    },
    [reportId, router, supabase]
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em]">How was the shift?</p>
        <p className="text-sm font-semibold italic">
          (Please be polite, concise, and constructive. This is not a place to vent.)
        </p>
      </div>
      <ProseField
        value={narrative}
        onCommit={save}
        disabled={!editable}
        ariaLabel="How was the shift"
        placeholder="What happened today?"
      />
    </div>
  );
}
