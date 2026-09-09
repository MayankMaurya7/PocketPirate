import { Bone, ListSkeleton, PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="expenses" title="Expenses">
      <Bone className="mt-6 h-9 w-32 rounded-lg" />
      <div className="mt-6 flex gap-2">
        <Bone className="h-8 w-16 rounded-full" />
        <Bone className="h-8 w-20 rounded-full" />
        <Bone className="h-8 w-24 rounded-full" />
        <Bone className="h-8 w-20 rounded-full" />
      </div>
      <Bone className="mt-4 h-4 w-40" />
      <div className="mt-3">
        <ListSkeleton rows={6} />
      </div>
    </PageSkeleton>
  );
}
