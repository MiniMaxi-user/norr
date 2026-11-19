"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusText, WebDataTableCard, type StatusTone, type WebColumn } from "@yourorg/ui/web-client";
import type { AccountManagerRecord } from "@/lib/account-managers/actions";
import { formatDateWeb } from "@/lib/format/web";
import type { ClientRecord, SiteRecord } from "../actions";
import { CLIENT_STATUS_OPTIONS, formatPotentialValue } from "../kanban";
import { CLIENTS_PAGE_SIZE } from "./clients-query";
import { DeleteClientDialog } from "./delete-client-dialog";

const STATUS_TONE: Record<string, StatusTone> = {
  lead: "neutral",
  qualified: "info",
  proposal: "warning",
  won: "success",
};

interface ClientRow {
  client: ClientRecord;
  site: SiteRecord | null;
  manager: string | null;
}

const POTENTIAL_SEGMENT = {
  label: "Potential value",
  defaultValue: "all",
  options: [
    { value: "set", label: "Set" },
    { value: "unset", label: "Not set" },
    { value: "all", label: "All" },
  ] as const,
};

/**
 * The Clients list table (list-page shell, issue #222): a `WebDataTableCard`
 * in server mode. The server (`listClients`, driven by the `q`, `status`,
 * `am`, `seg`, `sort`, `dir` and `page` URL params) returns the filtered
 * page; this component only renders it. Columns: Name (opens the client),
 * Status, Account manager, Phone, Location (primary site), Potential, Client
 * since. Row actions (Open, Delete) live in one ··· menu; Delete asks for
 * confirmation via `DeleteClientDialog`.
 */
export function ClientsTableCard({
  clients,
  total,
  unfilteredTotal,
  page,
  primarySiteByClientId,
  accountManagers,
  canCreate,
  canDelete,
}: {
  clients: ClientRecord[];
  total: number;
  unfilteredTotal?: number;
  page: number;
  primarySiteByClientId: Record<string, SiteRecord | null>;
  accountManagers: AccountManagerRecord[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ClientRecord | null>(null);

  const rows = useMemo<ClientRow[]>(() => {
    const managerById = new Map(accountManagers.map((m) => [m.id, `${m.first_name} ${m.last_name}`]));
    return clients.map((client) => ({
      client,
      site: primarySiteByClientId[client.id] ?? null,
      manager: client.account_manager_id ? (managerById.get(client.account_manager_id) ?? null) : null,
    }));
  }, [clients, primarySiteByClientId, accountManagers]);

  const columns = useMemo<WebColumn<ClientRow>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        primary: true,
        sortable: true,
        render: ({ client }) => (
          <>
            {client.name}
            {client.organization_is_active === true ? (
              <>{" "}<StatusText display="auto">Tenant</StatusText></>
            ) : client.organization_is_active === false ? (
              <>{" "}<StatusText display="auto" tone="danger">Tenant deactivated</StatusText></>
            ) : null}
          </>
        ),
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        render: ({ client }) => {
          const label = CLIENT_STATUS_OPTIONS.find((option) => option.value === client.status)?.label ?? client.status;
          return <StatusText display="auto" tone={STATUS_TONE[client.status] ?? "neutral"}>{label}</StatusText>;
        },
      },
      { id: "manager", header: "Account manager", render: (row) => row.manager },
      { id: "phone", header: "Phone", render: (row) => row.site?.phone || null },
      {
        id: "location",
        header: "Location",
        render: ({ site }) => (site ? [site.city, site.country].filter(Boolean).join(", ") || null : null),
      },
      {
        id: "potential",
        header: "Potential",
        align: "end",
        sortable: true,
        render: ({ client }) => (client.potential_value === null ? null : formatPotentialValue(client.potential_value)),
      },
      { id: "since", header: "Client since", sortable: true, render: ({ client }) => formatDateWeb(client.created_at) },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      { id: "status", label: "Status", options: CLIENT_STATUS_OPTIONS.map(({ value, label }) => ({ value, label })) },
      {
        id: "am",
        label: "Account manager",
        options: accountManagers.map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` })),
      },
    ],
    [accountManagers],
  );

  return (
    <>
      <WebDataTableCard<ClientRow>
        rows={rows}
        getRowKey={(row) => row.client.id}
        columns={columns}
        noun="clients"
        dropdowns={dropdowns}
        segment={POTENTIAL_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: CLIENTS_PAGE_SIZE }}
        defaultSort={{ columnId: "name", direction: "asc" }}
        rowHref={(row) => `/clients/${row.client.id}`}
        rowLabel={(row) => row.client.name}
        rowActions={(row) => [
          { key: "open", label: "Open", href: `/clients/${row.client.id}` },
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeleteTarget(row.client) },
              ]
            : []),
        ]}
        emptyAction={
          canCreate ? (
            <Link href="/clients/new" className="web-rail-link">
              Create client
            </Link>
          ) : null
        }
      />
      {canDelete ? (
        <DeleteClientDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          client={deleteTarget}
        />
      ) : null}
    </>
  );
}
