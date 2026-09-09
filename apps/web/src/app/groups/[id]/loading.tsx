import { AppHeader } from "@/components/app-header";
import { Bone, ListSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email="" current="groups" />
      <main
        aria-busy="true"
        className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 sm:pt-10"
      >
        <Bone className="h-4 w-20" />
        <Bone className="mt-4 h-7 w-48 max-w-full" />
        <Bone className="mt-3 h-7 w-24 rounded-full" />
        <Bone className="mt-8 h-4 w-20" />
        <Bone className="mt-3 h-14 w-full rounded-2xl" />
        <Bone className="mt-8 h-4 w-40" />
        <Bone className="mt-3 h-3 w-64 max-w-full" />
        <div className="mt-4">
          <ListSkeleton rows={5} />
        </div>
      </main>
    </div>
  );
}
