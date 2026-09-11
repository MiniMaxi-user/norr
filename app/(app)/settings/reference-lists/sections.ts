/**
 * One entry per tenant-configurable picklist (docs/ARCHITECTURE.md
 * "Tenant-configurable reference data"). Adding a future list (Phase 2's
 * Contract Type, say) is exactly one more entry here — `ReferenceListManager`
 * is already generic over `listKey`, not hand-built per list.
 *
 * Moved out of `reference-lists-board.tsx` (issue #110, Settings admin
 * shell) so the new grouped settings nav (`../components/settings-nav-items.ts`)
 * can source its item labels from the same single source of truth instead of
 * re-typing them — `reference-lists-board.tsx` still imports this array
 * unchanged.
 *
 * `showDefaultDuration` (issue #165) opts a list into the "Default duration
 * (minutes)" field/column in `ReferenceItemFormDialog`/`ReferenceListManager`
 * — explicitly `false` on every list except `activity_type` on purpose (a
 * plain reference-data field like `default_duration_minutes` on
 * `reference_list_items` is generic at the DB layer, same as `color`/`icon`,
 * but a "Priority" or "Status" list showing a random duration input would be
 * wrong — this flag is the opt-in that keeps it scoped to lists that actually
 * mean something by it).
 */
export const REFERENCE_LIST_SECTIONS = [
  {
    key: "asset_type",
    title: "Asset Type",
    description: "Equipment categories used across your assets — e.g. HVAC, Electrical, Generator.",
    showDefaultDuration: false,
  },
  // Activity Type (issue #165, "Op activity subtypes wordt ook Activity type
  // getoond"): a root-level, non-dependent list (Activity Subtypes hang off
  // it via `activity_subtypes.type_id`, but the type itself has no parent
  // list of its own) — needs nothing beyond this entry to also work as a
  // standalone `/settings/reference-lists/activity_type` route, same as every
  // other list here. Also embedded directly on `../activity-subtypes/page.tsx`
  // (above the subtype tree) via `../components/activity-types-panel.tsx`,
  // since that's literally where this story's gap was: "there's a place for
  // subtypes, there wasn't one for the type itself."
  {
    key: "activity_type",
    title: "Activity Type",
    description:
      "Top-level categories used to classify each Activity — e.g. Preventive Maintenance, Repair, Inspection. Each value can carry a default work-item duration and a color, both reused later by the Planning module.",
    showDefaultDuration: true,
  },
  {
    key: "asset_status",
    title: "Asset Status",
    description: "Lifecycle states an asset can be in — e.g. Active, In Repair, Decommissioned.",
    showDefaultDuration: false,
  },
  {
    key: "asset_subtype",
    title: "Asset Sub-type",
    description:
      "Finer-grained equipment categories, each scoped to one Asset Type — e.g. Compressor, Thermostat, and Ductwork all belong under HVAC.",
    showDefaultDuration: false,
  },
  {
    key: "asset_brand",
    title: "Asset Brand",
    description: "Manufacturer brands used across your assets — e.g. Kyocera, Canon, Ricoh, Xerox.",
    showDefaultDuration: false,
  },
  {
    key: "contact_role",
    title: "Contact Role",
    description: "Roles a client contact can have — e.g. Primary, Billing, Site manager, Technical.",
    showDefaultDuration: false,
  },
  {
    key: "work_order_status",
    title: "Work Order Status",
    description: "Lifecycle stages a work order moves through — e.g. New, Scheduled, En Route, In Progress, Completed, Invoiced.",
    showDefaultDuration: false,
  },
  {
    key: "work_order_priority",
    title: "Work Order Priority",
    description: "Urgency levels for a work order — e.g. Low, Normal, High, Urgent.",
    showDefaultDuration: false,
  },
  {
    key: "contract_type",
    title: "Contract Type",
    description: "Kinds of service agreement — e.g. Maintenance, Service, Installation, Warranty.",
    showDefaultDuration: false,
  },
  {
    key: "sla_tier",
    title: "SLA Tier",
    description:
      "Service level tiers, each scoped to one Contract Type — e.g. Standard, Priority, and Premium all belong under Maintenance.",
    showDefaultDuration: false,
  },
  {
    key: "billing_terms",
    title: "Billing Terms",
    description: "How a contract is billed — e.g. Monthly, Quarterly, Annually, Per-visit, One-time.",
    showDefaultDuration: false,
  },
  {
    key: "quote_status",
    title: "Quote Status",
    description: "Lifecycle stages a quote moves through — e.g. Draft, Sent, Accepted, Rejected, Expired.",
    showDefaultDuration: false,
  },
  // Articles (issue #92, "Artikel database"): three plain, non-dependent
  // picklists — `article_unit`/`article_manufacturer`/`vat_rate` — need
  // nothing beyond an entry here; `ReferenceListManager` already handles the
  // rest generically. `article_groups` is NOT one of these (it's a dedicated
  // table, unlimited-depth tree — see `ArticleGroupManager` instead).
  {
    key: "article_unit",
    title: "Article Unit",
    description: "Units of measure for an article — e.g. Piece, Meter, Kilogram, Hour, Liter.",
    showDefaultDuration: false,
  },
  {
    key: "article_manufacturer",
    title: "Article Manufacturer",
    description: "Manufacturer brands used across your article catalog — e.g. Bosch, Grohe, Danfoss.",
    showDefaultDuration: false,
  },
  {
    key: "vat_rate",
    title: "VAT Rate",
    description: "VAT percentages available on an article — e.g. 0%, 9%, 21%.",
    showDefaultDuration: false,
  },
  // Volume (issue #131, "Beheren 'Volume'"): a dependent list scoped to
  // `article_unit`, exactly like `asset_subtype` -> `asset_type` and
  // `sla_tier` -> `contract_type` above — needs nothing beyond this entry,
  // the existing parent-item picker plumbing already handles it generically.
  {
    key: "volume",
    title: "Volume",
    description:
      "Pre-agreed usage allowances or bundles that can be linked to a contract line item — e.g. 10,000 cups of coffee per year, or 1,000 B/W prints. Each Volume value is scoped to one Article Unit.",
    showDefaultDuration: false,
  },
] as const;

export type ReferenceListSectionKey = (typeof REFERENCE_LIST_SECTIONS)[number]["key"];
