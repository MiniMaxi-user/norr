"use client";

import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Callout, Checkbox, Label, Textarea } from "@yourorg/ui";
import {
  PwaActionBar,
  PwaBody,
  PwaCardPad,
  PwaNote,
  PwaPageHeader,
  PwaScreen,
  PwaStack,
  WebButton,
  WebCard,
  WebTypeBadge,
} from "@yourorg/ui/web";
import * as UiIcons from "@yourorg/ui/icons";
import { AlertTriangle, Check, ChevronRight, type Icon } from "@yourorg/ui/icons";
import { useOnline } from "@/lib/use-online";
import { PickerSheet, type PickerRow } from "./picker-sheet";
import { useDebounced, useRemoteList } from "./use-remote-list";

interface ClientItem {
  id: string;
  name: string;
  city: string | null;
}
interface SiteItem {
  id: string;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
}
interface AssetItem {
  id: string;
  name: string;
  serialNumber: string | null;
  modelName: string | null;
}
interface TypeItem {
  id: string;
  value: string;
  label: string;
  color: string | null;
  icon: string | null;
}

type FieldKey = "clientId" | "siteId" | "assetId" | "typeId" | "description";
type FieldErrors = Partial<Record<FieldKey, string>>;

const MIN_CLIENT_QUERY = 2;
const OFFLINE_MESSAGE = "You need an internet connection to create a work order.";

function siteLabel(site: SiteItem): string {
  const cityLine = [site.postalCode, site.city].filter(Boolean).join(" ");
  return [site.addressLine1, cityLine].filter(Boolean).join(", ") || "Site without address";
}

/** The API serves the type's icon as a lucide-style name ("AlertTriangle");
 * resolved against the ui icon set, omitted when the set has no such glyph. */
function resolveIcon(name: string | null): Icon | null {
  if (!name) return null;
  const candidate = (UiIcons as Record<string, unknown>)[name];
  return typeof candidate === "function" ? (candidate as Icon) : null;
}

/** One tappable "field" that opens a picker sheet — label above, current
 * value (or placeholder) inside, chevron at the end. */
function PickerField({
  label,
  value,
  placeholder,
  error,
  disabled,
  onOpen,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  error?: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const errorId = `${id}-error`;
  return (
    <div className="pwa-field">
      <span className="pwa-field-label" id={labelId}>
        {label} <span aria-hidden>*</span>
      </span>
      <button
        type="button"
        className="pwa-pick-row"
        disabled={disabled}
        onClick={onOpen}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={error ? errorId : undefined}
      >
        <span className="pwa-list-main">
          <span id={valueId} className={value ? "pwa-list-title" : "pwa-list-ref"}>
            {value ?? placeholder}
          </span>
        </span>
        <ChevronRight aria-hidden className="pwa-sheet-chevron" />
      </button>
      {error && (
        <PwaNote tone="danger" id={errorId} role="alert">
          {error}
        </PwaNote>
      )}
    </div>
  );
}

/**
 * "New work order" screen (issue #223). Client -> site -> asset are dependent
 * pickers (changing a parent resets its children; a client with exactly one
 * site preselects it), then type, description and "Assign to me" (default on:
 * the main scenario is the engineer doing it right away). Online-only: no
 * offline queue — offline shows a clear message and a failed request shows an
 * error, the form stays as-is for a retry.
 */
export function NewWorkOrderForm() {
  const router = useRouter();
  const online = useOnline();

  const [client, setClient] = useState<ClientItem | null>(null);
  const [site, setSite] = useState<SiteItem | null>(null);
  const [asset, setAsset] = useState<AssetItem | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [assignToSelf, setAssignToSelf] = useState(true);

  const [openSheet, setOpenSheet] = useState<"client" | "site" | "asset" | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const debouncedClientQuery = useDebounced(clientQuery.trim());
  const debouncedAssetQuery = useDebounced(assetQuery.trim());

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const clientSearchActive = openSheet === "client" && debouncedClientQuery.length >= MIN_CLIENT_QUERY;
  const clients = useRemoteList<ClientItem>(
    clientSearchActive ? `/api/clients/search?q=${encodeURIComponent(debouncedClientQuery)}` : null,
  );
  const sites = useRemoteList<SiteItem>(client ? `/api/clients/${client.id}/sites` : null);
  const assets = useRemoteList<AssetItem>(
    openSheet === "asset" && site
      ? `/api/sites/${site.id}/assets${debouncedAssetQuery ? `?q=${encodeURIComponent(debouncedAssetQuery)}` : ""}`
      : null,
  );
  const types = useRemoteList<TypeItem>("/api/work-order-types");

  // A client with exactly one site: preselect it (never overrides a choice
  // already made for this client).
  useEffect(() => {
    const only = sites.items[0];
    if (site || sites.status !== "ready" || sites.items.length !== 1 || !only) return;
    setSite(only);
  }, [sites.items, sites.status, site]);

  const typeItems = useMemo(() => types.items, [types.items]);

  function clearError(key: FieldKey) {
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  }

  function selectClient(row: ClientItem) {
    if (client?.id !== row.id) {
      setSite(null);
      setAsset(null);
      clearError("siteId");
      clearError("assetId");
    }
    setClient(row);
    clearError("clientId");
    setClientQuery("");
    setOpenSheet(null);
  }

  function selectSite(row: SiteItem) {
    if (site?.id !== row.id) {
      setAsset(null);
      clearError("assetId");
    }
    setSite(row);
    clearError("siteId");
    setOpenSheet(null);
  }

  function selectAsset(row: AssetItem) {
    setAsset(row);
    clearError("assetId");
    setAssetQuery("");
    setOpenSheet(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const errors: FieldErrors = {};
    if (!client) errors.clientId = "Select a client.";
    if (!site) errors.siteId = "Select a site.";
    if (!asset) errors.assetId = "Select an asset.";
    if (!typeId) errors.typeId = "Select a type.";
    if (!description.trim()) errors.description = "Describe the work.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !client || !site || !asset || !typeId) return;

    if (!navigator.onLine) {
      setFormError(OFFLINE_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          siteId: site.id,
          assetId: asset.id,
          typeId,
          description: description.trim(),
          assignToSelf,
        }),
      });
      if (response.status === 201) {
        const data = (await response.json()) as {
          workOrderId: string;
          workOrderNumber: string;
          assignedToSelf: boolean;
        };
        // Assigned to me: it is scheduled now, so open it (Today re-syncs
        // `/api/workitems/today` on mount and will list it). Otherwise back
        // to Today with a confirmation.
        if (data.assignedToSelf) {
          router.push(`/work-orders/${data.workOrderId}`);
        } else {
          router.push(`/today?created=${encodeURIComponent(data.workOrderNumber)}`);
        }
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        fieldErrors?: Partial<Record<FieldKey, string[]>>;
      } | null;
      if (response.status === 400 && body?.fieldErrors) {
        const mapped: FieldErrors = {};
        for (const key of Object.keys(body.fieldErrors) as FieldKey[]) {
          const message = body.fieldErrors[key]?.[0];
          if (message) mapped[key] = message;
        }
        setFieldErrors(mapped);
      }
      setFormError(body?.error ?? "Couldn't create the work order. Try again.");
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const clientRows: PickerRow[] = clients.items.map((item) => ({ id: item.id, title: item.name, sub: item.city }));
  const siteRows: PickerRow[] = sites.items.map((item) => ({ id: item.id, title: siteLabel(item) }));
  const assetRows: PickerRow[] = assets.items.map((item) => ({
    id: item.id,
    title: item.name,
    sub: [item.modelName, item.serialNumber].filter(Boolean).join(" · ") || null,
  }));

  return (
    <PwaScreen>
      <PwaPageHeader overline="Work order" title="New work order" />
      <PwaBody>
        <form id="new-work-order-form" onSubmit={(event) => void handleSubmit(event)} noValidate className="pwa-stack">
          {!online && <Callout icon={AlertTriangle}>{OFFLINE_MESSAGE}</Callout>}

            <WebCard title="Where" size="touch">
              <PwaCardPad>
                <PwaStack>
                  <PickerField
                    label="Client"
                    value={client ? (client.city ? `${client.name} · ${client.city}` : client.name) : null}
                    placeholder="Search for a client"
                    error={fieldErrors.clientId}
                    onOpen={() => setOpenSheet("client")}
                  />
                  <PickerField
                    label="Site"
                    value={site ? siteLabel(site) : null}
                    placeholder={client ? (sites.status === "loading" ? "Loading sites…" : "Select a site") : "Select a client first"}
                    error={fieldErrors.siteId}
                    disabled={!client}
                    onOpen={() => setOpenSheet("site")}
                  />
                  <PickerField
                    label="Asset"
                    value={asset ? (asset.modelName ? `${asset.name} · ${asset.modelName}` : asset.name) : null}
                    placeholder={site ? "Search for an asset" : "Select a site first"}
                    error={fieldErrors.assetId}
                    disabled={!site}
                    onOpen={() => setOpenSheet("asset")}
                  />
                </PwaStack>
              </PwaCardPad>
            </WebCard>

            <WebCard title="Type" size="touch">
              <PwaCardPad>
                {types.status === "error" ? (
                  <Callout icon={AlertTriangle}>Couldn&apos;t load the work order types. Check your connection.</Callout>
                ) : types.status !== "ready" ? (
                  <PwaNote>Loading types…</PwaNote>
                ) : (
                  <div
                    className="pwa-pick-list"
                    role="radiogroup"
                    aria-label="Type"
                    aria-required
                    aria-invalid={fieldErrors.typeId ? true : undefined}
                    aria-describedby={fieldErrors.typeId ? "new-wo-type-error" : undefined}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      // Roving radio group (APG): arrows move + select.
                      const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
                      const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
                      if ((!forward && !backward) || typeItems.length === 0) return;
                      event.preventDefault();
                      const current = typeItems.findIndex((item) => item.id === typeId);
                      const next =
                        current === -1
                          ? 0
                          : (current + (forward ? 1 : -1) + typeItems.length) % typeItems.length;
                      const nextItem = typeItems[next];
                      if (!nextItem) return;
                      setTypeId(nextItem.id);
                      clearError("typeId");
                      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                      buttons[next]?.focus();
                    }}
                  >
                    {typeItems.map((type, index) => {
                      const TypeIcon = resolveIcon(type.icon);
                      const selected = typeId === type.id;
                      const focusable = typeId ? selected : index === 0;
                      return (
                        <button
                          key={type.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={focusable ? 0 : -1}
                          className="pwa-pick-row"
                          onClick={() => {
                            setTypeId(type.id);
                            clearError("typeId");
                          }}
                        >
                          <WebTypeBadge size="touch" color={type.color}>
                            {TypeIcon && <TypeIcon aria-hidden />}
                            {type.label}
                          </WebTypeBadge>
                          {selected && <Check aria-hidden className="pwa-sheet-chevron" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                {fieldErrors.typeId && (
                  <PwaNote tone="danger" id="new-wo-type-error" role="alert">
                    {fieldErrors.typeId}
                  </PwaNote>
                )}
              </PwaCardPad>
            </WebCard>

            <WebCard title="Details" size="touch">
              <PwaCardPad>
                <PwaStack>
                  <div className="pwa-field">
                    <Label htmlFor="new-wo-description">Description *</Label>
                    <Textarea
                      id="new-wo-description"
                      rows={5}
                      value={description}
                      aria-invalid={fieldErrors.description ? true : undefined}
                      aria-required
                      aria-describedby={fieldErrors.description ? "new-wo-description-error" : undefined}
                      placeholder="What needs to be done?"
                      onChange={(event) => {
                        setDescription(event.target.value);
                        clearError("description");
                      }}
                    />
                    {fieldErrors.description && (
                      <PwaNote tone="danger" id="new-wo-description-error" role="alert">
                        {fieldErrors.description}
                      </PwaNote>
                    )}
                  </div>
                  <div className="pwa-row">
                    <Checkbox
                      id="new-wo-assign"
                      checked={assignToSelf}
                      onChange={(event) => setAssignToSelf(event.target.checked)}
                    />
                    <Label htmlFor="new-wo-assign">Assign to me</Label>
                  </div>
                  <PwaNote>
                    {assignToSelf
                      ? "Scheduled for you now and added to Today."
                      : "Sent to planning without an assignee."}
                  </PwaNote>
                </PwaStack>
              </PwaCardPad>
            </WebCard>

        </form>

        <PwaActionBar>
          <div role="alert">{formError && <Callout icon={AlertTriangle}>{formError}</Callout>}</div>
          <WebButton
            type="submit"
            form="new-work-order-form"
            variant="primary"
            size="touch"
            block
            loading={submitting}
            disabled={!online}
          >
            {submitting ? "Creating…" : "Create work order"}
          </WebButton>
        </PwaActionBar>
      </PwaBody>

      <PickerSheet
        open={openSheet === "client"}
        onOpenChange={(next) => !next && setOpenSheet(null)}
        title="Select client"
        searchPlaceholder="Search by client name"
        query={clientQuery}
        onQueryChange={setClientQuery}
        hint={clientQuery.trim().length < MIN_CLIENT_QUERY ? "Type at least 2 characters to search." : undefined}
        rows={clientRows}
        status={clientQuery.trim() !== debouncedClientQuery ? "loading" : clients.status}
        emptyText="No clients found."
        onSelect={(id) => {
          const row = clients.items.find((item) => item.id === id);
          if (row) selectClient(row);
        }}
      />
      <PickerSheet
        open={openSheet === "site"}
        onOpenChange={(next) => !next && setOpenSheet(null)}
        title="Select site"
        rows={siteRows}
        status={sites.status}
        emptyText="This client has no sites."
        onSelect={(id) => {
          const row = sites.items.find((item) => item.id === id);
          if (row) selectSite(row);
        }}
      />
      <PickerSheet
        open={openSheet === "asset"}
        onOpenChange={(next) => !next && setOpenSheet(null)}
        title="Select asset"
        searchPlaceholder="Search by name or serial number"
        query={assetQuery}
        onQueryChange={setAssetQuery}
        rows={assetRows}
        status={assetQuery.trim() !== debouncedAssetQuery ? "loading" : assets.status}
        emptyText="No assets found on this site."
        onSelect={(id) => {
          const row = assets.items.find((item) => item.id === id);
          if (row) selectAsset(row);
        }}
      />
    </PwaScreen>
  );
}
