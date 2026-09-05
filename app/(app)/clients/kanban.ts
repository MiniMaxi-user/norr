import type { BadgeVariant } from "@yourorg/ui";
import type { ClientRecord } from "./actions";

/**
 * Kanban grouping for the Clients board view (issue #58, "Als gebruiker wil
 * ik een kanban bord hebben voor mijn klanten") — replaces the old
 * `groupClientsForKanban`/`ClientStage`/`ClientKanbanColumn` "has a
 * site/phone yet" heuristic (see git history for that version's own long
 * doc comment) now that a real `clients.status` column exists
 * (`clientStatusSchema` in `./schema.ts`, migration
 * `20260827100000_clients_kanban_status.sql`). Exactly the swap that old
 * file's doc comment called for: "the moment a real `clients.stage` column
 * exists, swap this function's body for a `.reduce` over that instead."
 */

export type ClientStatus = "lead" | "qualified" | "proposal" | "won";

export interface ClientKanbanColumn {
  status: ClientStatus;
  label: string;
  /** Top-border + count-badge color, threaded straight into `Board.Column`'s
   * `accentColor` prop — a `var(--ui-*)` token reference, not a raw hex, so
   * this keeps tracking the design system's token values if they're ever
   * retuned. */
  accentColor: string;
  /** Background tint, threaded into `Board.Column`'s `tint` prop. */
  tint: string;
  clients: ClientRecord[];
  /** Sum of `potential_value` (treating `null` as 0) across every client in
   * `clients` — i.e. AFTER the Won column's 4-week visibility filter below,
   * but this is the full column's total, not affected by any "show first N"
   * cap a caller applies on top for rendering. */
  totalPotentialValue: number;
}

/** "Won" clients only stay on the board for 4 weeks after their most recent
 * `won_at` — per the story: "Daarna verdwijnen ze" ("after that they
 * disappear"). A client whose `status` is still `'won'` but whose `won_at`
 * has aged past this window is excluded from the board ENTIRELY (not moved
 * to some other bucket) — see `groupClientsForKanban` below. */
const WON_VISIBILITY_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** Column order + labels + colors are fixed (issue #58's own spec) — exact
 * matches to existing `@yourorg/ui` design tokens (`styles.css`), not
 * hardcoded hex, so a future retune of the token scale carries through here
 * automatically. */
const COLUMN_DEFINITIONS: readonly Pick<ClientKanbanColumn, "status" | "label" | "accentColor" | "tint">[] = [
  { status: "lead", label: "Lead", accentColor: "var(--ui-gray-600)", tint: "var(--ui-gray-50)" },
  { status: "qualified", label: "Qualified", accentColor: "var(--ui-accent-500)", tint: "var(--ui-accent-25)" },
  { status: "proposal", label: "Proposal", accentColor: "var(--ui-warning-500)", tint: "var(--ui-warning-50)" },
  { status: "won", label: "Won", accentColor: "var(--ui-success-500)", tint: "var(--ui-success-50)" },
];

/** Plain hardcoded options for the Status `<Select>` on both client forms
 * (`new-client-panel.tsx`/`edit-client-panel.tsx`) and the kanban header's
 * Status filter (`clients-explorer.tsx`) — NOT a reference-list fetch, since
 * `clientStatusSchema` is a fixed enum, not tenant-configurable data. Order/
 * labels reuse `COLUMN_DEFINITIONS` so all three places (form selects, filter
 * select, board columns) can never drift out of sync with each other. */
export const CLIENT_STATUS_OPTIONS: readonly { value: ClientStatus; label: string }[] = COLUMN_DEFINITIONS.map(
  ({ status, label }) => ({ value: status, label }),
);

/** Status badge color per column — mirrors `COLUMN_DEFINITIONS`'s own accent
 * grouping (gray/accent/warning/success for lead/qualified/proposal/won), so
 * any status badge anywhere in the Clients module (kanban cards, the Details
 * tab's Pipeline section) stays visually consistent with the kanban column it
 * lives in. Previously a private copy inside `clients-kanban.tsx` — hoisted
 * here (issue: Details tab redo) so `client-pipeline-section.tsx` can reuse
 * it without duplicating the mapping. */
export const CLIENT_STATUS_BADGE_VARIANT: Record<ClientStatus, BadgeVariant> = {
  lead: "muted",
  qualified: "accent",
  proposal: "warning",
  won: "success",
};

function isWonStillVisible(client: ClientRecord, now: number): boolean {
  if (!client.won_at) return false;
  return now - new Date(client.won_at).getTime() <= WON_VISIBILITY_WINDOW_MS;
}

export function groupClientsForKanban(clients: ClientRecord[]): ClientKanbanColumn[] {
  const now = Date.now();
  const buckets: Record<ClientStatus, ClientRecord[]> = { lead: [], qualified: [], proposal: [], won: [] };

  for (const client of clients) {
    const status = client.status as ClientStatus;
    if (status === "won") {
      // A client whose status is still 'won' but whose won_at has aged past
      // the 4-week window is excluded from the board entirely — never
      // re-bucketed into a different column. See `WON_VISIBILITY_WINDOW_MS`.
      if (isWonStillVisible(client, now)) buckets.won.push(client);
      continue;
    }
    if (status === "lead" || status === "qualified" || status === "proposal") {
      buckets[status].push(client);
    }
    // Any other value is unreachable given the DB's `clients_status_check`
    // CHECK constraint + `clientStatusSchema`'s matching enum — silently
    // excluded rather than thrown, the same defensive-but-not-fatal posture
    // this codebase takes elsewhere for "shouldn't happen" data shapes.
  }

  return COLUMN_DEFINITIONS.map((definition) => {
    const columnClients = buckets[definition.status];
    return {
      ...definition,
      clients: columnClients,
      totalPotentialValue: columnClients.reduce((sum, client) => sum + (client.potential_value ?? 0), 0),
    };
  });
}

/**
 * Currency formatting for the kanban's "Potential" figures (card row, column
 * total, page-header "Pipeline potential" stat) — deliberately not
 * `lib/format/currency.ts`'s `formatCurrency`: that one always shows cents
 * (`Intl`'s standard currency style), a different shape than this design's
 * whole-thousand rounding, so it wasn't a fit to import/rename. Returns
 * `"—"` for `null` (no potential value set); otherwise whole-euro for values
 * under 1000, rounded-to-the-nearest-thousand "k" shorthand at/above it —
 * matches the mockup's own "€ 42k" style rounding. Both this and
 * `formatCurrency` are EUR-only (issue #108) — no multi-currency support
 * exists yet.
 */
export function formatPotentialValue(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1000) return `€ ${Math.round(value / 1000)}k`;
  return `€ ${Math.round(value)}`;
}
