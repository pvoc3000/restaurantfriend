import { TasksPage } from "@/components/tasks/TasksPage";
import type { RawSearchParams } from "@/lib/itemFilters";

export default async function Tasks({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const open = typeof params.open === "string" ? params.open : undefined;
  return <TasksPage kind="task" openRowKey={open} />;
}
