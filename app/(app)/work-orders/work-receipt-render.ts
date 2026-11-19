import "server-only";

import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { computeRoundedMinutes } from "@yourorg/time-rounding";
import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeWeb, formatDateWeb } from "@/lib/format/web";
import { getOrganizationCompanySettings } from "../settings/company-actions";
import { getOrganizationTimeRoundingSettings } from "../settings/organization-time-rounding-actions";
import { getAssetCompositionTree, type AssetComponentTreeNode } from "../assets/components-actions";
import {
  WorkReceiptDocument,
  type WorkReceiptPdfAddress,
  type WorkReceiptPdfAssetNode,
  type WorkReceiptPdfTimelineStep,
} from "./work-receipt-pdf";
import { elapsedMinutes, formatHoursMinutes } from "./components/format-work-order-time";
import type { WorkReceiptEmailPlaceholderKey } from "./work-receipt-email-schema";

/**
 * Work receipt ("werkbon", issue #226) PDF rendering. NOT a "use server" file:
 * used by `generateWorkReceipt` in `./work-receipt-actions.ts`. Every query
 * runs under the caller's own session (RLS is the real backstop). The
 * receipt is a point-in-time document: it is rendered once per generated
 * version and then stored; later versions re-read live data.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface RefItem {
  value: string;
  label: string;
}

interface WorkOrderRow {
  id: string;
  client_id: string;
  site_id: string | null;
  asset_id: string | null;
  assigned_to: string | null;
  work_order_number: string;
  external_reference: string | null;
  description: string | null;
  solution: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  work_order_status: RefItem | null;
  work_order_priority: RefItem | null;
  work_order_type: RefItem | null;
}

const WORK_ORDER_COLUMNS =
  "id, client_id, site_id, asset_id, assigned_to, work_order_number, external_reference, description, solution, scheduled_at, completed_at, approved_at, created_by, created_at," +
  " work_order_status:reference_list_items!work_orders_status_id_fkey(value,label)," +
  " work_order_priority:reference_list_items!work_orders_priority_id_fkey(value,label)," +
  " work_order_type:reference_list_items!work_orders_type_id_fkey(value,label)";

interface SiteRow {
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  visit_contact_id: string | null;
}

interface AssetRow {
  id: string;
  name: string;
  serial_number: string | null;
  external_reference: string | null;
  installed_at: string | null;
  warranty_until: string | null;
  asset_type: RefItem | null;
  asset_subtype: RefItem | null;
  asset_brand: RefItem | null;
  asset_model: { name: string } | null;
}

const ASSET_COLUMNS =
  "id, name, serial_number, external_reference, installed_at, warranty_until," +
  " asset_type:reference_list_items!assets_type_id_fkey(value,label)," +
  " asset_subtype:reference_list_items!assets_subtype_id_fkey(value,label)," +
  " asset_brand:reference_list_items!assets_brand_item_id_fkey(value,label)," +
  " asset_model:asset_models!assets_model_id_fkey(name)";

interface TimeEntryRow {
  user_id: string;
  started_at: string;
  ended_at: string | null;
  time_entry_type: RefItem | null;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
}

function formatSiteAddress(site: Pick<SiteRow, "address_line1" | "address_line2" | "postal_code" | "city"> | null): string {
  if (!site) return "";
  const street = [site.address_line1, site.address_line2].filter(Boolean).join(", ");
  const city = [site.postal_code, site.city].filter(Boolean).join(" ");
  return [street, city].filter(Boolean).join(", ");
}

async function resolveClientAddress(
  supabase: SupabaseServerClient,
  clientId: string,
): Promise<WorkReceiptPdfAddress | null> {
  const { data, error } = await supabase
    .from("sites")
    .select("address_line1,address_line2,postal_code,city,country,is_invoice_address,is_primary")
    .eq("client_id", clientId)
    .order("address_line1", { ascending: true });
  if (error || !data || data.length === 0) return null;
  const rows = data as {
    address_line1: string | null;
    address_line2: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    is_invoice_address: boolean;
    is_primary: boolean;
  }[];
  const first = rows[0];
  if (!first) return null;
  const chosen = rows.find((s) => s.is_invoice_address) ?? rows.find((s) => s.is_primary) ?? first;
  return {
    line1: chosen.address_line1,
    line2: chosen.address_line2,
    postalCode: chosen.postal_code,
    city: chosen.city,
    country: chosen.country,
  };
}

function flattenTree(node: AssetComponentTreeNode, depth: number, out: WorkReceiptPdfAssetNode[]): void {
  out.push({
    name: node.asset.name,
    serialNumber: node.asset.serial_number,
    quantity: node.quantity,
    depth,
    isCurrent: node.isCurrent,
  });
  for (const child of node.children) flattenTree(child, depth + 1, out);
}

function formatNumber(value: number | string): string {
  return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

export interface RenderedWorkReceipt {
  pdf: Buffer;
}

export type WorkReceiptRenderResult =
  | { rendered: RenderedWorkReceipt; error?: undefined }
  | { rendered?: undefined; error: string };

/**
 * Loads everything the receipt needs for `workOrderId` and renders the PDF.
 * `receipt` is the freshly inserted `work_receipts` row (number + timestamp).
 * Returns `{ error }` instead of throwing.
 */
export async function renderWorkReceiptPdf(
  supabase: SupabaseServerClient,
  workOrderId: string,
  receipt: { receiptNumber: string; generatedAt: string },
): Promise<WorkReceiptRenderResult> {
  try {
    const { data: wo, error: woError } = await supabase
      .from("work_orders")
      .select(WORK_ORDER_COLUMNS)
      .eq("id", workOrderId)
      .maybeSingle<WorkOrderRow>();
    if (woError) return { error: woError.message };
    if (!wo) return { error: "Work order not found, or you do not have permission to view it." };

    const companySettings = await getOrganizationCompanySettings();
    if (!companySettings.data) return { error: companySettings.error ?? "Could not load organization settings." };
    const ownClient = companySettings.data.ownClient;
    if (!ownClient) {
      return { error: "Configure your own company details in Settings > Company before generating a work receipt." };
    }

    const [
      clientResult,
      siteResult,
      assetResult,
      timeEntriesResult,
      materialsResult,
      readingsResult,
      photosResult,
      signatureResult,
      roundingResult,
      senderAddress,
    ] = await Promise.all([
      supabase.from("clients").select("name").eq("id", wo.client_id).maybeSingle<{ name: string }>(),
      wo.site_id
        ? supabase
            .from("sites")
            .select("name, address_line1, address_line2, postal_code, city, country, visit_contact_id")
            .eq("id", wo.site_id)
            .maybeSingle<SiteRow>()
        : Promise.resolve({ data: null, error: null }),
      wo.asset_id
        ? supabase.from("assets").select(ASSET_COLUMNS).eq("id", wo.asset_id).maybeSingle<AssetRow>()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from("time_entries")
        .select(
          "user_id, started_at, ended_at, time_entry_type:reference_list_items!time_entries_entry_type_id_fkey(value,label)",
        )
        .eq("work_order_id", wo.id)
        .order("started_at", { ascending: true })
        .returns<TimeEntryRow[]>(),
      supabase
        .from("work_order_articles")
        .select("quantity, created_at, article:articles!work_order_articles_article_id_fkey(article_number, description)")
        .eq("work_order_id", wo.id)
        .order("created_at", { ascending: true })
        .returns<{ quantity: number | string; article: { article_number: string; description: string } | null }[]>(),
      supabase
        .from("asset_volume_readings")
        .select("volume_item_id, value, read_at")
        .eq("work_order_id", wo.id)
        .order("read_at", { ascending: true })
        .returns<{ volume_item_id: string; value: number | string; read_at: string }[]>(),
      supabase.from("work_order_photos").select("id", { count: "exact", head: true }).eq("work_order_id", wo.id),
      supabase
        .from("work_order_signatures")
        .select("storage_path, signed_at")
        .eq("work_order_id", wo.id)
        .maybeSingle<{ storage_path: string; signed_at: string }>(),
      getOrganizationTimeRoundingSettings(),
      resolveClientAddress(supabase, ownClient.id),
    ]);

    for (const result of [clientResult, siteResult, assetResult, timeEntriesResult, materialsResult, readingsResult, signatureResult]) {
      if (result.error) return { error: result.error.message };
    }
    const client = clientResult.data;
    if (!client) return { error: "The work order's client could not be found." };
    const site = siteResult.data as SiteRow | null;
    const asset = assetResult.data as AssetRow | null;
    const timeEntries = timeEntriesResult.data ?? [];
    const rounding = roundingResult.data?.settings ?? null;

    // People: creator, assignee, engineers on time entries -> one lookup.
    const userIds = Array.from(
      new Set(
        [wo.created_by, wo.assigned_to, ...timeEntries.map((entry) => entry.user_id)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users } = await supabase.from("users").select("id, email, full_name").in("id", userIds);
      for (const user of (users ?? []) as UserRow[]) nameById.set(user.id, user.full_name?.trim() || user.email);
    }
    const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? null) : null);

    // Visit contact of the site.
    let visitContact: string | null = null;
    if (site?.visit_contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("name")
        .eq("id", site.visit_contact_id)
        .maybeSingle<{ name: string }>();
      visitContact = contact?.name ?? null;
    }

    // Counter labels for the volume readings.
    const counterLabelById = new Map<string, string>();
    const readings = readingsResult.data ?? [];
    if (readings.length > 0) {
      const { data: items } = await supabase
        .from("reference_list_items")
        .select("id, label, parent_item_id")
        .in("id", Array.from(new Set(readings.map((r) => r.volume_item_id))));
      const rows = (items ?? []) as { id: string; label: string; parent_item_id: string | null }[];
      const parentIds = Array.from(new Set(rows.map((r) => r.parent_item_id).filter((p): p is string => Boolean(p))));
      const unitById = new Map<string, string>();
      if (parentIds.length > 0) {
        const { data: units } = await supabase.from("reference_list_items").select("id, label").in("id", parentIds);
        for (const unit of (units ?? []) as { id: string; label: string }[]) unitById.set(unit.id, unit.label);
      }
      for (const row of rows) {
        const unit = row.parent_item_id ? unitById.get(row.parent_item_id) : null;
        counterLabelById.set(row.id, unit ? `${row.label} (${unit})` : row.label);
      }
    }

    // Component tree of a composite asset (best effort: needs the assets module).
    const components: WorkReceiptPdfAssetNode[] = [];
    if (asset) {
      const tree = await getAssetCompositionTree(asset.id);
      if (tree.data && tree.data.tree.children.length > 0) flattenTree(tree.data.tree, 0, components);
    }

    // Signature image.
    let signature: { data: Buffer; signedAtLabel: string } | null = null;
    if (signatureResult.data) {
      const { data: blob, error: blobError } = await supabase.storage
        .from("work-order-signatures")
        .download(signatureResult.data.storage_path);
      // A signature was recorded: never render a signed document as
      // "no signature captured" just because the file couldn't be read.
      if (!blob) {
        return { error: `The signature could not be loaded${blobError ? `: ${blobError.message}` : ""}. Try again.` };
      }
      signature = {
        data: Buffer.from(await blob.arrayBuffer()),
        signedAtLabel: formatDateTimeWeb(signatureResult.data.signed_at),
      };
    }

    // Hours.
    const kindOf = (entry: TimeEntryRow): "travel" | "work" =>
      entry.time_entry_type?.value === "travel" ? "travel" : "work";
    const netMinutes = (entry: TimeEntryRow): number | null => {
      const raw = elapsedMinutes(entry.started_at, entry.ended_at);
      if (raw === null) return null;
      return rounding ? computeRoundedMinutes(raw, rounding[kindOf(entry)]) : raw;
    };
    const totals = { work: 0, travel: 0 };
    for (const entry of timeEntries) totals[kindOf(entry)] += netMinutes(entry) ?? 0;

    // Timeline.
    const timeline: WorkReceiptPdfTimelineStep[] = [];
    const creator = nameOf(wo.created_by);
    timeline.push({
      title: "Created",
      when: formatDateTimeWeb(wo.created_at),
      details: creator ? [`By ${creator}`] : [],
    });
    if (wo.scheduled_at) {
      const engineer = nameOf(wo.assigned_to);
      timeline.push({
        title: "Scheduled",
        when: formatDateTimeWeb(wo.scheduled_at),
        details: engineer ? [`Engineer: ${engineer}`] : [],
      });
    }
    const engineerNames = Array.from(
      new Set(timeEntries.map((entry) => nameOf(entry.user_id)).filter((n): n is string => Boolean(n))),
    );
    const checkedOutEngineer = nameOf(wo.assigned_to) ?? engineerNames[0] ?? null;
    if (timeEntries.length > 0 || wo.completed_at) {
      // The moment of checkout is not stored (only the status transition), so no date.
      timeline.push({
        title: "Checked out",
        when: null,
        details: [checkedOutEngineer ? `Opened in the field app by ${checkedOutEngineer}` : "Opened in the field app"],
      });
    }
    if (timeEntries.length > 0) {
      const first = timeEntries[0];
      const lastEnd = timeEntries.reduce<string | null>((latest, entry) => {
        const end = entry.ended_at ?? entry.started_at;
        return latest === null || new Date(end).getTime() > new Date(latest).getTime() ? end : latest;
      }, null);
      const details: string[] = [];
      if (engineerNames.length > 0) details.push(`Engineer: ${engineerNames.join(", ")}`);
      details.push(`Work ${formatHoursMinutes(totals.work)} / travel ${formatHoursMinutes(totals.travel)}`);
      timeline.push({
        title: "Field visit",
        when: first
          ? lastEnd && lastEnd !== first.started_at
            ? `${formatDateTimeWeb(first.started_at)} - ${formatDateTimeWeb(lastEnd)}`
            : formatDateTimeWeb(first.started_at)
          : null,
        details,
      });
    }
    if (wo.completed_at) {
      timeline.push({ title: "Finished and sent for review", when: formatDateTimeWeb(wo.completed_at), details: [] });
    }
    timeline.push({
      title: "Approved",
      when: wo.approved_at ? formatDateTimeWeb(wo.approved_at) : null,
      // No approved_by column exists, so the approver is not shown.
      details: [],
    });

    const props = {
      receiptNumber: receipt.receiptNumber,
      generatedAtLabel: formatDateTimeWeb(receipt.generatedAt),
      sender: {
        name: ownClient.name,
        kvkNumber: ownClient.kvkNumber,
        vatNumber: ownClient.vatNumber,
        address: senderAddress,
        logoUrl: ownClient.logoUrl,
      },
      client: { name: client.name },
      site: {
        name: site?.name ?? null,
        address: site
          ? {
              line1: site.address_line1,
              line2: site.address_line2,
              postalCode: site.postal_code,
              city: site.city,
              country: site.country,
            }
          : null,
        visitContact,
      },
      workOrder: {
        number: wo.work_order_number,
        type: wo.work_order_type?.label ?? null,
        priority: wo.work_order_priority?.label ?? null,
        externalReference: wo.external_reference,
        description: wo.description,
      },
      asset: asset
        ? {
            name: asset.name,
            serialNumber: asset.serial_number,
            brand: asset.asset_brand?.label ?? null,
            model: asset.asset_model?.name ?? null,
            type: asset.asset_type?.label ?? null,
            subtype: asset.asset_subtype?.label ?? null,
            installedOn: asset.installed_at ? formatDateWeb(asset.installed_at) : null,
            warrantyUntil: asset.warranty_until ? formatDateWeb(asset.warranty_until) : null,
            externalReference: asset.external_reference,
            components,
          }
        : null,
      timeline,
      solution: wo.solution?.trim() ? wo.solution : null,
      hours: timeEntries.map((entry) => ({
        type: kindOf(entry) === "travel" ? "Travel" : "Work",
        date: formatDateTimeWeb(entry.started_at),
        duration: entry.ended_at ? formatHoursMinutes(netMinutes(entry)) : "-",
        engineer: nameOf(entry.user_id) ?? "-",
      })),
      hoursTotals:
        timeEntries.length > 0
          ? { work: formatHoursMinutes(totals.work), travel: formatHoursMinutes(totals.travel) }
          : null,
      materials: (materialsResult.data ?? []).map((row) => ({
        article: row.article ? `${row.article.article_number} - ${row.article.description}` : "Unknown article",
        quantity: formatNumber(row.quantity),
      })),
      volumes: readings.map((reading) => ({
        counter: counterLabelById.get(reading.volume_item_id) ?? "Counter",
        value: formatNumber(reading.value),
        readAt: formatDateTimeWeb(reading.read_at),
      })),
      photoCount: photosResult.count ?? 0,
      signature,
    };

    const pdfElement = createElement(WorkReceiptDocument, props) as unknown as ReactElement<DocumentProps>;
    const pdf = await renderToBuffer(pdfElement);
    return { rendered: { pdf } };
  } catch (error) {
    return { error: error instanceof Error ? `Could not render the work receipt PDF: ${error.message}` : "Could not render the work receipt PDF." };
  }
}

/**
 * Values for the e-mail subject/body placeholders of one work order
 * (`organization_name` is added by the caller). Empty strings for missing data.
 */
export async function getWorkReceiptEmailValues(
  supabase: SupabaseServerClient,
  workOrderId: string,
  receiptNumber: string,
): Promise<Omit<Record<WorkReceiptEmailPlaceholderKey, string>, "organization_name"> | null> {
  const { data: wo } = await supabase
    .from("work_orders")
    .select("work_order_number, client_id, site_id, asset_id, completed_at, approved_at")
    .eq("id", workOrderId)
    .maybeSingle<{
      work_order_number: string;
      client_id: string;
      site_id: string | null;
      asset_id: string | null;
      completed_at: string | null;
      approved_at: string | null;
    }>();
  if (!wo) return null;

  const [client, site, asset] = await Promise.all([
    supabase.from("clients").select("name").eq("id", wo.client_id).maybeSingle<{ name: string }>(),
    wo.site_id
      ? supabase
          .from("sites")
          .select("address_line1, address_line2, postal_code, city")
          .eq("id", wo.site_id)
          .maybeSingle<Pick<SiteRow, "address_line1" | "address_line2" | "postal_code" | "city">>()
      : Promise.resolve({ data: null }),
    wo.asset_id
      ? supabase.from("assets").select("name").eq("id", wo.asset_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
  ]);

  const completed = wo.approved_at ?? wo.completed_at;
  return {
    receipt_number: receiptNumber,
    work_order_number: wo.work_order_number,
    client_name: client.data?.name ?? "",
    site_address: formatSiteAddress(site.data),
    asset_name: asset.data?.name ?? "",
    completed_date: completed ? formatDateTimeWeb(completed).split(",")[0] ?? "" : "",
  };
}
