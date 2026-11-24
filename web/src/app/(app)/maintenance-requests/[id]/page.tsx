import { TaskDetail } from "@/components/tasks/TaskDetail";
import type { RawSearchParams } from "@/lib/itemFilters";

export default async function MaintenanceRequestRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  return <TaskDetail kind="maintenance" id={id} rawParams={await searchParams} />;
}
