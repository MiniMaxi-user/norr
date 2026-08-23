import {
  getChecklistTemplate,
  listChecklistTemplates,
  type ChecklistTemplateItemRecord,
} from "@/lib/checklist-templates/actions";
import { ChecklistTemplatesManager } from "./components/checklist-templates-manager";

/**
 * The data-fetching heart of the Checklist Templates screen, rendered inside
 * a `Suspense` boundary by `page.tsx` (docs/ARCHITECTURE.md "route-level
 * streaming") so the page shell (heading, back link) paints immediately —
 * same shape `ReferenceListsBoard` gives its own Suspense boundary.
 *
 * Unlike reference lists (one flat items array per fixed list key),
 * checklist templates are a tenant-managed COLLECTION of templates, each
 * with its own items — so this fetches the template list, then every
 * template's items in parallel (`getChecklistTemplate` per template).
 * Tenant checklist-template counts are expected to stay small (a handful of
 * inspection forms, each with a dozen or so items), so eager-fetching every
 * template's items up front — same "fetch everything, no per-row lazy load"
 * choice `ReferenceListsBoard` makes across its 9 fixed lists — keeps the
 * Disclosure-based UI below simple (no client-side fetch-on-expand) without
 * a real cost at this scale.
 */
export async function ChecklistTemplatesBoard({ canWrite }: { canWrite: boolean }) {
  const templatesResult = await listChecklistTemplates();
  const templates = templatesResult.data?.templates ?? [];

  const itemResults = await Promise.all(templates.map((template) => getChecklistTemplate(template.id)));

  const itemsByTemplateId: Record<string, ChecklistTemplateItemRecord[]> = {};
  templates.forEach((template, index) => {
    itemsByTemplateId[template.id] = itemResults[index]?.data?.items ?? [];
  });

  return (
    <ChecklistTemplatesManager
      templates={templates}
      itemsByTemplateId={itemsByTemplateId}
      loadError={templatesResult.error}
      canWrite={canWrite}
    />
  );
}
