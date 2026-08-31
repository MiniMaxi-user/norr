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
 */
export const REFERENCE_LIST_SECTIONS = [
  {
    key: "asset_type",
    title: "Asset Type",
    description: "Equipment categories used across your assets — e.g. HVAC, Electrical, Generator.",
  },
  {
    key: "asset_status",
    title: "Asset Status",
    description: "Lifecycle states an asset can be in — e.g. Active, In Repair, Decommissioned.",
  },
  {
    key: "asset_subtype",
    title: "Asset Sub-type",
    description:
      "Finer-grained equipment categories, each scoped to one Asset Type — e.g. Compressor, Thermostat, and Ductwork all belong under HVAC.",
  },
  {
    key: "asset_brand",
    title: "Asset Brand",
    description: "Manufacturer brands used across your assets — e.g. Kyocera, Canon, Ricoh, Xerox.",
  },
  {
    key: "contact_role",
    title: "Contact Role",
    description: "Roles a client contact can have — e.g. Primary, Billing, Site manager, Technical.",
  },
  {
    key: "work_order_status",
    title: "Work Order Status",
    description: "Lifecycle stages a work order moves through — e.g. New, Scheduled, En Route, In Progress, Completed, Invoiced.",
  },
  {
    key: "work_order_priority",
    title: "Work Order Priority",
    description: "Urgency levels for a work order — e.g. Low, Normal, High, Urgent.",
  },
  {
    key: "contract_type",
    title: "Contract Type",
    description: "Kinds of service agreement — e.g. Maintenance, Service, Installation, Warranty.",
  },
  {
    key: "sla_tier",
    title: "SLA Tier",
    description:
      "Service level tiers, each scoped to one Contract Type — e.g. Standard, Priority, and Premium all belong under Maintenance.",
  },
  {
    key: "billing_terms",
    title: "Billing Terms",
    description: "How a contract is billed — e.g. Monthly, Quarterly, Annually, Per-visit, One-time.",
  },
  {
    key: "quote_status",
    title: "Quote Status",
    description: "Lifecycle stages a quote moves through — e.g. Draft, Sent, Accepted, Rejected, Expired.",
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
  },
  {
    key: "article_manufacturer",
    title: "Article Manufacturer",
    description: "Manufacturer brands used across your article catalog — e.g. Bosch, Grohe, Danfoss.",
  },
  {
    key: "vat_rate",
    title: "VAT Rate",
    description: "VAT percentages available on an article — e.g. 0%, 9%, 21%.",
  },
] as const;

export type ReferenceListSectionKey = (typeof REFERENCE_LIST_SECTIONS)[number]["key"];
