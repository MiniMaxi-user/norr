"use client";

import { MapPin, Phone } from "@yourorg/ui/icons";
import { PwaActions, PwaCardText, PwaKeyValue, PwaStack, WebButton, WebCard, WebStatusBadge, type PwaKeyValueRow } from "@yourorg/ui/web";
import type { WorkOrderDetail } from "@/lib/work-orders/types";

/** `"2019"` from an ISO install date — the Asset row's "bouwjaar"
 * (IMPLEMENTATION.md §4: "plek, bouwjaar"). */
function yearOf(iso: string | null): string | null {
  if (!iso) return null;
  const year = new Date(iso).getFullYear();
  return Number.isNaN(year) ? null : String(year);
}

/**
 * The "HOME" tab (`?section=home`, renamed from the original "Work" tab —
 * product feedback, 2026-09-14) — location (Navigate/Call), asset, and the
 * contract block. Description/Solution moved out to their own "WORK" tab
 * (`work-section.tsx`) that now sits right after this one in the bottom bar.
 *
 * Presentation (issue #222, DS 08 §4): the Location card holds the address
 * and the two action buttons side by side, equal width (unavailable = disabled
 * + one explanatory line below); Asset and Contract are key/value cards.
 */
export function HomeSection({ workOrder }: { workOrder: WorkOrderDetail }) {
  const { site, asset, contract } = workOrder;
  const addressParts = [site?.addressLine1, site?.addressLine2, site?.postalCode, site?.city].filter(
    (part): part is string => Boolean(part),
  );
  const mapsHref =
    addressParts.length > 0 ? `https://maps.google.com/?q=${encodeURIComponent(addressParts.join(", "))}` : null;

  const assetRows: PwaKeyValueRow[] = asset
    ? [
        { label: "Asset ID", value: asset.name, mono: true, link: true },
        ...(asset.externalReference
          ? [{ label: "External reference", value: asset.externalReference, mono: true }]
          : []),
        ...(asset.serialNumber ? [{ label: "Serial", value: asset.serialNumber, mono: true }] : []),
        ...(asset.brand || asset.model
          ? [{ label: "Brand / model", value: [asset.brand, asset.model].filter(Boolean).join(" ") }]
          : []),
        ...(yearOf(asset.installedAt) ? [{ label: "Built", value: yearOf(asset.installedAt) }] : []),
      ]
    : [];

  const contractRows: PwaKeyValueRow[] = contract
    ? [
        { label: "Number", value: contract.contractNumber, mono: true, link: true },
        {
          label: "Type",
          value: (
            <WebStatusBadge tone="info" size="touch">
              {contract.type ?? "Contract"}
            </WebStatusBadge>
          ),
        },
        { label: "From", value: new Date(contract.startDate).toLocaleDateString("en-GB") },
        ...(contract.endDate ? [{ label: "To", value: new Date(contract.endDate).toLocaleDateString("en-GB") }] : []),
      ]
    : [];

  return (
    <PwaStack>
      <WebCard size="touch" title="Location">
        <PwaCardText empty={addressParts.length === 0}>
          {addressParts.length > 0 ? addressParts.join(", ") : "No address on file."}
        </PwaCardText>
        <PwaActions hint={!site?.phone ? "No contact with a phone number" : undefined}>
          <WebButton
            size="touch"
            disabled={!mapsHref}
            onClick={() => mapsHref && window.open(mapsHref, "_blank", "noopener,noreferrer")}
          >
            <MapPin aria-hidden />
            Navigate
          </WebButton>
          <WebButton
            size="touch"
            disabled={!site?.phone}
            onClick={() => site?.phone && (window.location.href = `tel:${site.phone}`)}
          >
            <Phone aria-hidden />
            Call contact
          </WebButton>
        </PwaActions>
      </WebCard>

      {asset && (
        <WebCard size="touch" title="Asset">
          <PwaKeyValue rows={assetRows} />
        </WebCard>
      )}

      {contract && (
        <WebCard size="touch" title="Contract">
          <PwaKeyValue rows={contractRows} />
        </WebCard>
      )}
    </PwaStack>
  );
}
