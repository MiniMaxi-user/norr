"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebDetailLayout, WebPage } from "@yourorg/ui/web";
import {
  EditDiscardDialog,
  PageHeader,
  scrollMainToTop,
  useEditMode,
  webTabIds,
  type EditSchema,
  type PageHeaderBadge,
  type PageHeaderTab,
} from "@yourorg/ui/web-client";
import { setLastUsedView } from "@/lib/preferences/actions";
import { updateWarehouseName, type WarehouseRecord, type WarehouseStockRecord } from "../actions";
import { WarehouseOverviewCards, draftFromWarehouse, type WarehouseDraft } from "./warehouse-overview-cards";
import {
  WAREHOUSE_DETAIL_VIEW_KEY,
  buildWarehouseTimeline,
  getWarehouseLivePanel,
  lowStockRows,
  type WarehouseDetailTab,
} from "./warehouse-parts";
import { WarehouseRail } from "./warehouse-rail";
import { WarehouseStockPanel } from "./warehouse-stock-panel";

export interface WarehouseScreenProps {
  warehouse: WarehouseRecord;
  stock: WarehouseStockRecord[];
  totalPurchaseValue: number;
  totalSaleValue: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  defaultTab?: WarehouseDetailTab;
}

const SCHEMA: EditSchema<WarehouseDraft> = {
  name: {
    label: "Name",
    required: true,
    validate: (value) => {
      const length = value.trim().length;
      if (!length) return "Enter a name";
      return length > 200 ? `Name is ${length} characters, the maximum is 200. Remove ${length - 200}` : null;
    },
  },
};

/**
 * The `/inventory/[warehouseId]` detail screen (issue #181) on the web design
 * system (issue #222), built like the Article and Contract pages:
 *
 *  - `PageHeader`: breadcrumb (`Inventory / warehouse`), title (the warehouse
 *    name), badges (articles, below minimum), ONE Edit button (Overview only,
 *    omitted without update permission) and tabs. A warehouse cannot be
 *    created or deleted from here (one is created per engineer), so there is
 *    no ··· menu and no navy primary;
 *  - centre: Overview (ONE Details card) or Stock (FilterBar + table; add,
 *    adjust and remove via dialogs / the row menu);
 *  - rail: [LivePanel when articles are below minimum] · Stock figures ·
 *    TIMELINE.
 *
 * Editing is `useEditMode` through the existing `updateWarehouseName`.
 */
export function WarehouseScreen({
  warehouse,
  stock,
  totalPurchaseValue,
  totalSaleValue,
  canCreate,
  canUpdate,
  canDelete,
  defaultTab = "overview",
}: WarehouseScreenProps) {
  const router = useRouter();
  const [tab, setTab] = useState<WarehouseDetailTab>(defaultTab);
  // Bumped when the LivePanel jumps to the filtered Stock tab, to remount the
  // table so it re-reads the `stock_seg` URL param.
  const [stockKey, setStockKey] = useState(0);
  const [, startTransition] = useTransition();

  const record = useMemo(() => draftFromWarehouse(warehouse), [warehouse]);

  const edit = useEditMode<WarehouseDraft>({
    record,
    schema: SCHEMA,
    initialMode: "read",
    canEdit: canUpdate,
    idPrefix: "warehouse",
    firstFieldKey: "name",
    navigate: (href) => router.push(href),
    onSave: async (draft) => {
      const result = await updateWarehouseName(warehouse.id, draft.name.trim());
      if (result.data) return { ok: true };
      const nameError = result.fieldErrors?.name?.[0];
      return nameError
        ? { ok: false, fieldErrors: { name: nameError } }
        : { ok: false, error: result.error ?? "Could not save the warehouse." };
    },
    onSaved: () => {
      toast({ title: "Saved", tone: "success", duration: 3000 });
      router.refresh();
    },
  });
  const editing = edit.isEditing;

  const lowRows = useMemo(() => lowStockRows(stock), [stock]);
  const timeline = useMemo(() => buildWarehouseTimeline(warehouse, stock), [warehouse, stock]);

  const selectTab = useCallback(
    (next: WarehouseDetailTab) => {
      if (editing) return;
      setTab(next);
      scrollMainToTop();
      startTransition(() => {
        void setLastUsedView(WAREHOUSE_DETAIL_VIEW_KEY, next);
      });
    },
    [editing],
  );

  const showLowStock = useCallback(() => {
    if (editing) return;
    const url = new URL(window.location.href);
    url.searchParams.set("stock_seg", "low");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setStockKey((key) => key + 1);
    selectTab("stock");
  }, [editing, selectTab]);

  const tabs = useMemo<PageHeaderTab[]>(
    () => [
      { id: "overview", label: "Overview" },
      { id: "stock", label: "Stock", count: stock.length },
    ],
    [stock.length],
  );

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab("overview");
  }, [tabs, tab]);

  const savedName = edit.record.name || warehouse.name;

  const badges: PageHeaderBadge[] = [];
  if (lowRows.length > 0) badges.push({ label: `${lowRows.length} below minimum`, variant: "danger" });

  const header = (
    <PageHeader
      breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: savedName }]}
      title={savedName}
      badges={badges}
      mode={edit.mode}
      actions={{
        canEdit: canUpdate && tab === "overview",
        onEdit: edit.startEdit,
        onSave: () => void edit.save(),
        onCancel: edit.requestCancel,
        saving: edit.saving,
        saveLabel: "Save",
      }}
      owner={
        warehouse.engineer
          ? { name: warehouse.engineer.full_name || warehouse.engineer.email, role: "Engineer" }
          : null
      }
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => selectTab(id as WarehouseDetailTab)}
      tabsLabel="Warehouse sections"
      editStatus={edit.status}
    />
  );

  const rail = (
    <WarehouseRail
      livePanel={getWarehouseLivePanel(stock, showLowStock)}
      articleCount={stock.length}
      lowStockCount={lowRows.length}
      totalPurchaseValue={totalPurchaseValue}
      totalSaleValue={totalSaleValue}
      onShowStock={() => selectTab("stock")}
    />
  );

  const ids = webTabIds(tab);

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={rail}
        timeline={{ items: timeline, emptyText: "No activity yet" }}
        locked={editing}
        mainProps={{ role: "tabpanel", id: ids.panel, "aria-labelledby": ids.tab }}
      >
        {tab === "overview" && (
          <div className="web-tab-stack">
            <WarehouseOverviewCards edit={edit} warehouse={warehouse} />
          </div>
        )}

        {tab === "stock" && (
          <WarehouseStockPanel
            key={stockKey}
            warehouseId={warehouse.id}
            stock={stock}
            canCreate={canCreate}
            canUpdate={canUpdate}
            canDelete={canDelete}
          />
        )}
      </WebDetailLayout>

      <EditDiscardDialog confirm={edit.confirm} />
    </WebPage>
  );
}
