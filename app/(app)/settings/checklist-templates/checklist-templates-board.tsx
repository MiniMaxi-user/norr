import { listChecklistTemplates, listChecklistTemplateItemsForTemplates } from "@/lib/checklist-templates/actions";
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
 * template's items in one bulk query (`listChecklistTemplateItemsForTemplates`,
 * issue #85 — previously one `getChecklistTemplate` round-trip per template).
 * Eager-fetching every template's items up front — same "fetch everything,
 * no per-row lazy load" choice `ReferenceListsBoard` makes across its 9 fixed
 * lists — keeps the Disclosure-based UI below simple (no client-side
 * fetch-on-expand).
 */
export async function ChecklistTemplatesBoard({ canWrite }: { canWrite: boolean }) {
  const templatesResult = await listChecklistTemplates();
  const templates = templatesResult.data?.templates ?? [];

  const itemsResult = await listChecklistTemplateItemsForTemplates(templates.map((template) => template.id));
  const itemsByTemplateId = itemsResult.data?.itemsByTemplateId ?? {};

  return (
    <ChecklistTemplatesManager
      templates={templates}
      itemsByTemplateId={itemsByTemplateId}
      loadError={templatesResult.error}
      canWrite={canWrite}
    />
  );
}
