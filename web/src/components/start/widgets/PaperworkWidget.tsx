import { DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/employeeDocuments";
import { employeeName } from "@/lib/employees";
import { paperworkAlerts } from "@/lib/startPage";

import { CARD_ITEMS, StartCard, type CardSummary } from "../StartCard";
import { shortDate, type Result, type StartContext, type Supabase } from "./shared";

export async function PaperworkWidget(ctx: StartContext) {
  return <StartCard {...paperworkSummary({ result: await loadPaperwork(ctx.supabase, ctx.shop.id), today: ctx.today })} />;
}

type PaperworkData = {
  employees: { id: string; first_name: string; last_name: string; food_handler_expires: string | null }[];
  docs: { employee_id: string; kind: DocumentKind; expires_on: string | null }[];
};

async function loadPaperwork(supabase: Supabase, loc: string): Promise<Result<PaperworkData>> {
  const [{ data: employees, error }, { data: docs, error: docError }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, food_handler_expires")
      .eq("main_location_id", loc)
      .neq("status", "inactive"),
    supabase.from("employee_documents").select("employee_id, kind, expires_on").order("id").limit(1000),
  ]);
  if (error) return { data: null, error: error.message };
  if (docError) return { data: null, error: docError.message };
  return {
    data: {
      employees: (employees ?? []) as PaperworkData["employees"],
      docs: (docs ?? []) as PaperworkData["docs"],
    },
    error: null,
  };
}

function paperworkSummary({ result, today }: { result: Result<PaperworkData>; today: string }): CardSummary {
  if (result.data === null) {
    return { lines: [], error: result.error };
  }
  const { employees, docs } = result.data;
  const alerts = paperworkAlerts(employees, docs, today);
  const nameOf = new Map(employees.map((e) => [e.id, employeeName(e)]));
  const expired = alerts.filter((a) => a.state === "expired");
  const soon = alerts.filter((a) => a.state === "soon");

  return {
    lines: [
      { count: expired.length, label: "current staff with a lapsed document", href: "/employees" },
      { count: soon.length, label: "expiring in the next 60 days", href: "/employees" },
    ],
    items: alerts.slice(0, CARD_ITEMS).map((a) => ({
      primary: nameOf.get(a.employeeId) ?? "Unknown",
      secondary: `${DOCUMENT_KIND_LABEL[a.kind]} · ${a.state === "expired" ? "lapsed" : "expires"} ${shortDate(a.on)}`,
      href: `/employees/${a.employeeId}?tab=documents`,
    })),
  };
}
