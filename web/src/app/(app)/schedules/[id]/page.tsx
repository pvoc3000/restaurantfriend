import { ScheduleDetail } from "./ScheduleDetail";

// The body lives in ScheduleDetail; this page is its shell.
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const rawParams = await searchParams;
  return <ScheduleDetail id={id} rawParams={rawParams} />;
}
