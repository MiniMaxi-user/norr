import { TeamSkeleton } from "./team-skeleton";

// Route-level Suspense fallback (issue #140) for `/settings/team` — reuses
// the exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback around `TeamBoard`.
export default function TeamLoading() {
  return <TeamSkeleton />;
}
