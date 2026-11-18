"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { WebCard, WebDataTableEmpty } from "@yourorg/ui/web";
import { FilterBar } from "@yourorg/ui/web-client";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import type { ClientRecord, SiteRecord } from "../actions";
import { CLIENT_STATUS_OPTIONS, formatPotentialValue } from "../kanban";
import { ClientsKanban } from "./clients-kanban";

/**
 * Kanban alternative view of the Clients list (`?view=kanban`): the whole
 * pipeline (up to 200 clients, unpaginated) on the `Board`, under the same
 * FilterBar as the table (search, Status, Account manager, count, Clear
 * filters). Filtering is client-side over the fetched set; the card meta
 * carries the former hero stats (clients shown, pipeline potential).
 */
export function ClientsKanbanView({
  clients,
  canWrite,
  primarySiteByClientId,
  accountManagers,
}: {
  clients: ClientRecord[];
  canWrite: boolean;
  primarySiteByClientId: Record<string, SiteRecord | null>;
  accountManagers: AccountManagerRecord[];
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [managerId, setManagerId] = useState("");

  const managerNameById = useMemo(
    () => new Map(accountManagers.map((m) => [m.id, `${m.first_name} ${m.last_name}`])),
    [accountManagers],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      if (status && client.status !== status) return false;
      if (managerId && client.account_manager_id !== managerId) return false;
      if (!query) return true;
      const site = primarySiteByClientId[client.id];
      const manager = client.account_manager_id ? (managerNameById.get(client.account_manager_id) ?? "") : "";
      return [client.name, site?.city, site?.phone, manager].some((field) => (field ?? "").toLowerCase().includes(query));
    });
  }, [clients, search, status, managerId, primarySiteByClientId, managerNameById]);

  const potential = filtered.reduce((sum, client) => sum + (client.potential_value ?? 0), 0);
  const filtersActive = Boolean(search.trim() || status || managerId);

  function clear() {
    setSearch("");
    setStatus("");
    setManagerId("");
  }

  return (
    <WebCard title="Pipeline" meta={`${filtered.length} · ${formatPotentialValue(potential)} potential`}>
      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search clients…"
        dropdowns={[
          {
            id: "status",
            label: "Status",
            value: status,
            options: CLIENT_STATUS_OPTIONS.map(({ value, label }) => ({ value, label })),
            onChange: setStatus,
          },
          {
            id: "am",
            label: "Account manager",
            value: managerId,
            options: accountManagers.map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` })),
            onChange: setManagerId,
          },
        ]}
        shownCount={filtered.length}
        totalCount={clients.length}
        filtersActive={filtersActive}
        onClear={clear}
      />
      {clients.length === 0 ? (
        <WebDataTableEmpty>
          No clients yet.{" "}
          {canWrite ? (
            <Link href="/clients/new" className="web-rail-link">
              Create client
            </Link>
          ) : null}
        </WebDataTableEmpty>
      ) : filtered.length === 0 ? (
        <WebDataTableEmpty>
          No clients match these filters.{" "}
          <button type="button" className="web-rail-link" onClick={clear}>
            Clear filters
          </button>
        </WebDataTableEmpty>
      ) : (
        <div className="web-list-board">
          <ClientsKanban
            clients={filtered}
            canWrite={canWrite}
            primarySiteByClientId={primarySiteByClientId}
            accountManagers={accountManagers}
          />
        </div>
      )}
    </WebCard>
  );
}
