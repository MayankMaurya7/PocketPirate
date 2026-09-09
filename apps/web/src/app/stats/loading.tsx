import { Bone, PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton current="stats" title="Stats">
      <Bone className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Bone key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Bone className="mt-6 h-64 rounded-2xl" />
      <Bone className="mt-6 h-48 rounded-2xl" />
    </PageSkeleton>
  );
}
