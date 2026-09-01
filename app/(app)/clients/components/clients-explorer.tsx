"use client";

import { useMemo, useState } from "react";
import { Breadcrumbs, Button, Card, EmptyState, Input, OverviewHeroBand, Select, Stack, Text } from "@yourorg/ui";
import { Users, X } from "@yourorg/ui/icons";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import type { ClientRecord, SiteRecord } from "../actions";
import { CLIENT_STATUS_OPTIONS, formatPotentialValue } from "../kanban";
import { ClientsKanban } from "./clients-kanban";
import { ClientsPagination } from "./clients-pagination";
import { ClientsTable } from "./clients-table";
import { DeleteClientDialog } from "./delete-client-dialog";
import { EditClientPanel } from "./edit-client-panel";
import { NewClientPanel } from "./new-client-panel";
import { ViewToggle, type ViewOption } from "./view-toggle";

export type ClientsView = "list" | "kanban";

const VIEW_OPTIONS: readonly ViewOption<ClientsView>[] = [
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
];

/**
 * Client component owning all Clients-list interactivity: search/filter
 * (client-side, over the already-fetched page — server-side search is a
 * later improvement per the task spec), the list/kanban view switch, the
 * "Add client" slide-in panel, the "Edit" slide-in panel, and the delete
 * confirmation dialog. As of issue #43, creating a client opens
 * `NewClientPanel` (a `Dialog` `size="panel"`) instead of navigating to a
 * full page; as of issue #46, editing a client opens `EditClientPanel` the
 * same way instead of navigating to the old `/clients/[id]/edit` route
 * (route deleted) — both are explicit, confirmed overrides of this app's
 * usual "Popup vs. full page" default (see docs/ARCHITECTURE.md "Popup vs.
 * full page — pick by weight, not habit", and each panel's own doc comment).
 * `editTarget` mirrors `deleteTarget`'s lifted-dialog pattern: whichever
 * client is currently being edited, or `null` when the panel is closed.
 * `clients`/`count` are fetched once server-side (`clients-board.tsx`) and
 * passed down as props; a delete calls `router.refresh()` (inside the
 * dialog) to re-fetch rather than mutating this component's local copy,
 * keeping this component's own state limited to pure UI state (search text,
 * which view, which client is pending deletion).
 *
 * NOTE on scope: as of issue #58, list and kanban no longer share the same
 * fetched dataset — `clients-board.tsx` fetches a single paginated page for
 * List, but the (near-)whole org's clients (up to 200, unpaginated) for
 * Kanban, since a kanban board needs every status to group correctly rather
 * than whichever page the list happens to be on. Which fetch actually ran is
 * decided server-side from the user's last-used-view preference BEFORE this
 * component renders — flipping the `ViewToggle` mid-session doesn't
 * retroactively re-fetch; a page reload picks the newly-appropriate fetch
 * back up (same class of simplification the pre-#58 version of this note
 * already flagged for the list/kanban split in general).
 *
 * Both views share one header shape: a full-bleed dark `OverviewHeroBand`
 * (issue #116 — "Customer overview" title + `ViewToggle` + "Add client",
 * matching the same dark-fjord band already used on detail pages, see
 * `docs/ARCHITECTURE.md`'s "Overview-page header pattern") followed by a
 * plain light `Card` filter row below it. Kanban's stats (the "Klanten"/
 * "Pipeline potential" readout) render in the band's own `stats` slot;
 * kanban's filter `Card` additionally carries the Account manager/Status
 * selects — List's filter `Card` is just its own search input. Its
 * breadcrumb lives in the Topbar via `usePageHeader`, mirroring
 * `client-detail.tsx`'s pattern, and only while kanban view is active — List
 * view has never shown a breadcrumb.
 */
export function ClientsExplorer({
  clients,
  count,
  page,
  pageSize,
  canWrite,
  defaultView,
  primarySiteByClientId,
  accountManagers,
  articles,
  todayIso,
}: {
  clients: ClientRecord[];
  count: number;
  page: number;
  pageSize: number;
  canWrite: boolean;
  defaultView: ClientsView;
  /** Each client's primary site (or `null` if it has none yet), keyed by
   * `client.id` — see `clients-board.tsx`'s `fetchPrimarySiteByClientId`.
   * Threaded down to both `ClientsTable` and `ClientsKanban` so every
   * standard client overview shows the same primary-address data
   * ("Primary adres is zichtbaar in alle standaardoverzichten"). */
  primarySiteByClientId: Record<string, SiteRecord | null>;
  /** Every account manager in this org (issue #58) — fetched once in
   * `clients-board.tsx`, threaded down into `ClientsKanban` (each card's
   * Account Manager row), the kanban header's Account manager filter
   * `<Select>`, and both client forms' own Account manager picker. */
  accountManagers: AccountManagerRecord[];
  /** `listArticlesForSelect()`'s result (issue #93) — fetched once in
   * `clients-board.tsx`, threaded down into both client forms' "Rate"
   * section article pickers. */
  articles: ArticleSelectOption[];
  /** Server-computed `YYYY-MM-DD` "today", for `NewClientPanel`'s "Client
   * since" default — see `clients-board.tsx`. */
  todayIso: string;
}) {
  const [view, setView] = useState<ClientsView>(defaultView);
  const [search, setSearch] = useState("");
  const [kanbanSearch, setKanbanSearch] = useState("");
  const [kanbanAccountManagerId, setKanbanAccountManagerId] = useState("");
  const [kanbanStatus, setKanbanStatus] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);
  const [editTarget, setEditTarget] = useState<ClientRecord | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);

  const accountManagerById = useMemo(
    () => new Map(accountManagers.map((manager) => [manager.id, manager])),
    [accountManagers],
  );

  // List view's own search — unchanged from before issue #58 (name/phone/city).
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => {
      const primarySite = primarySiteByClientId[client.id];
      return [client.name, primarySite?.phone, primarySite?.city].some((field) =>
        (field ?? "").toLowerCase().includes(query),
      );
    });
  }, [clients, search, primarySiteByClientId]);

  // Kanban view's own filter set (issue #58): search matches name/city/
  // account-manager-name; Account manager and Status each narrow to one
  // specific value or "All ...". Filtering by status here just hides 3 of
  // the 4 columns entirely (status is what determines a card's column in
  // the first place) — matches the design mockup's own behavior.
  const kanbanFiltered = useMemo(() => {
    const query = kanbanSearch.trim().toLowerCase();
    return clients.filter((client) => {
      if (kanbanStatus && client.status !== kanbanStatus) return false;
      if (kanbanAccountManagerId && client.account_manager_id !== kanbanAccountManagerId) return false;
      if (!query) return true;
      const primarySite = primarySiteByClientId[client.id];
      const manager = client.account_manager_id ? accountManagerById.get(client.account_manager_id) : undefined;
      const managerName = manager ? `${manager.first_name} ${manager.last_name}` : "";
      return [client.name, primarySite?.city, managerName].some((field) =>
        (field ?? "").toLowerCase().includes(query),
      );
    });
  }, [clients, kanbanSearch, kanbanStatus, kanbanAccountManagerId, primarySiteByClientId, accountManagerById]);

  const kanbanFiltersActive = Boolean(kanbanSearch.trim() || kanbanAccountManagerId || kanbanStatus);

  function clearKanbanFilters() {
    setKanbanSearch("");
    setKanbanAccountManagerId("");
    setKanbanStatus("");
  }

  // Breadcrumb lives in the Topbar (`usePageHeader`), not inline in the page
  // body — mirrors `client-detail.tsx`'s exact pattern. Only kanban view
  // shows one (List view never has); `usePageHeader` itself is still called
  // unconditionally since it's a hook, we just vary what's passed to it.
  const breadcrumbItems = useMemo(() => [{ label: "Norr", href: "/" }, { label: "Clients" }], []);
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  const activeHeaderNode = useMemo(
    () => (view === "kanban" ? breadcrumbNode : null),
    [view, breadcrumbNode],
  );
  usePageHeader(activeHeaderNode);

  if (clients.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Users />}
          heading="No clients yet"
          text="Add your first client to start tracking their sites and assets."
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setNewClientOpen(true)}>
                Add client
              </Button>
            ) : undefined
          }
        />
        {canWrite && (
          <NewClientPanel
            open={newClientOpen}
            onOpenChange={setNewClientOpen}
            accountManagers={accountManagers}
            articles={articles}
            todayIso={todayIso}
          />
        )}
      </>
    );
  }

  const headerActions = (
    <>
      <ViewToggle moduleKey="clients" value={view} options={VIEW_OPTIONS} onChange={setView} />
      {canWrite && (
        <Button variant="primary" onClick={() => setNewClientOpen(true)}>
          Add client
        </Button>
      )}
    </>
  );

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Customer overview"
        actions={headerActions}
        stats={
          view === "kanban" ? (
            <div className="ui-clients-kanban-stats">
              <div className="ui-clients-kanban-stat">
                <div className="ui-clients-kanban-stat-label">Klanten</div>
                <div className="ui-clients-kanban-stat-value">{kanbanFiltered.length}</div>
              </div>
              <div className="ui-clients-kanban-stat">
                <div className="ui-clients-kanban-stat-label">Pipeline potential</div>
                <div className="ui-clients-kanban-stat-value">
                  {formatPotentialValue(
                    kanbanFiltered.reduce((sum, client) => sum + (client.potential_value ?? 0), 0),
                  )}
                </div>
              </div>
            </div>
          ) : undefined
        }
      />

      {view === "kanban" ? (
        <Card>
          <div className="ui-clients-page-filters">
            <div className="ui-clients-page-filters-search">
              <Input
                aria-label="Search clients"
                placeholder="Search by name, city, or account manager…"
                value={kanbanSearch}
                onChange={(event) => setKanbanSearch(event.target.value)}
              />
            </div>
            <div className="ui-clients-kanban-filters-select">
              <Select
                aria-label="Filter by account manager"
                value={kanbanAccountManagerId}
                onChange={(event) => setKanbanAccountManagerId(event.target.value)}
              >
                <option value="">All account managers</option>
                {accountManagers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.first_name} {manager.last_name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="ui-clients-kanban-filters-select">
              <Select
                aria-label="Filter by status"
                value={kanbanStatus}
                onChange={(event) => setKanbanStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                {CLIENT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            {kanbanFiltersActive && (
              <Button type="button" variant="ghost" size="sm" onClick={clearKanbanFilters}>
                <X aria-hidden /> Clear filters
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="ui-clients-page-filters">
            <div className="ui-clients-page-filters-search">
              <Input
                aria-label="Search clients"
                placeholder="Search by name, phone, or city…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      {view === "list" ? (
        filtered.length === 0 ? (
          <Text tone="muted">No clients match &ldquo;{search}&rdquo;.</Text>
        ) : (
          <ClientsTable
            clients={filtered}
            canWrite={canWrite}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
            primarySiteByClientId={primarySiteByClientId}
          />
        )
      ) : kanbanFiltered.length === 0 ? (
        <Text tone="muted">No clients match the current filters.</Text>
      ) : (
        <ClientsKanban
          clients={kanbanFiltered}
          canWrite={canWrite}
          primarySiteByClientId={primarySiteByClientId}
          accountManagers={accountManagers}
        />
      )}

      {view === "list" && <ClientsPagination page={page} pageSize={pageSize} count={count} />}

      {canWrite && editTarget && (
        <EditClientPanel
          client={editTarget}
          accountManagers={accountManagers}
          articles={articles}
          open={Boolean(editTarget)}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}

      {canWrite && (
        <DeleteClientDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          client={deleteTarget}
        />
      )}

      {canWrite && (
        <NewClientPanel
          open={newClientOpen}
          onOpenChange={setNewClientOpen}
          accountManagers={accountManagers}
          articles={articles}
          todayIso={todayIso}
        />
      )}
    </Stack>
  );
}
