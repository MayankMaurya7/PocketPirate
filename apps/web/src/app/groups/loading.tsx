import { Bone, ListSkeleton, PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="groups" title="Groups">
      <Bone className="mt-2 h-4 w-72 max-w-full" />
      <Bone className="mt-6 h-9 w-32 rounded-lg" />
      <div className="mt-6">
        <ListSkeleton rows={3} />
      </div>
    </PageSkeleton>
  );
}
