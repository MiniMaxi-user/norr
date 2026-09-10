import { ChecklistTemplatesSkeleton } from "./checklist-templates-skeleton";

// Route-level Suspense fallback (issue #140) for
// `/settings/checklist-templates` — reuses the exact skeleton `page.tsx`
// already renders as its own `<Suspense>` fallback around
// `ChecklistTemplatesBoard`.
export default function ChecklistTemplatesLoading() {
  return <ChecklistTemplatesSkeleton />;
}
