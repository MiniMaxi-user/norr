import { MainSkeleton } from "@/components/shell/main-skeleton";

// Route-level Suspense fallback (issue #140) for `/` (`app/(app)/page.tsx`) —
// reuses the same `MainSkeleton` that page already renders as its own
// internal `<Suspense>` fallback for `WelcomePanel`, so first paint and the
// nested streamed-in panel never visually disagree.
export default function DashboardLoading() {
  return <MainSkeleton />;
}
