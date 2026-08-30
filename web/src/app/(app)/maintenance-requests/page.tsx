import { TasksPage } from "@/components/tasks/TasksPage";
import type { RawSearchParams } from "@/lib/itemFilters";

export default async function MaintenanceRequests({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const open = typeof params.open === "string" ? params.open : undefined;
  return <TasksPage kind="maintenance" openRowKey={open} />;
}
