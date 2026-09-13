"use client";

import { Button, Card, Heading, Inline, KeyValueList, Stack, Text, Textarea } from "@yourorg/ui";
import { MapPin, Phone } from "@yourorg/ui/icons";
import type { WorkOrderDetail } from "@/lib/work-orders/types";

/** `"2019"` from an ISO install date — the Asset row's "bouwjaar"
 * (IMPLEMENTATION.md §4: "plek, bouwjaar"). */
function yearOf(iso: string | null): string | null {
  if (!iso) return null;
  const year = new Date(iso).getFullYear();
  return Number.isNaN(year) ? null : String(year);
}

/**
 * The default "Work" tab (`?section=details`, issue #170, IMPLEMENTATION.md
 * §4) — location (Navigate/Call), asset, description, and a contract block.
 * Server Component-shaped data in, but marked `"use client"` purely because
 * every sibling section in this folder is (consistency, and because a
 * couple of these actions — `tel:`/maps — are plain anchors that don't
 * actually need client JS; kept as a Client Component anyway so this file
 * can be swapped for one with real interactivity later without moving
 * files around).
 *
 * "Solution" (product feedback, 2026-09-13) lives here now, directly under
 * Description — moved from the Sign-off tab so the two read together:
 * Description is the fixed problem statement from the office (read-only,
 * always), Solution is the free-text resolution the engineer writes
 * (editable, synced to `work_orders.solution` on Finish — the work-order-
 * level equivalent of `activities.solution` on the desktop webapp). State
 * is owned by `work-order-detail.tsx` so it survives switching tabs.
 */
export function WorkSection({
  workOrder,
  solution,
  onSolutionChange,
}: {
  workOrder: WorkOrderDetail;
  solution: string;
  onSolutionChange: (value: string) => void;
}) {
  const { site, asset, contract, description } = workOrder;
  const addressParts = [site?.addressLine1, site?.addressLine2, site?.postalCode, site?.city].filter(
    (part): part is string => Boolean(part),
  );
  const mapsHref =
    addressParts.length > 0 ? `https://maps.google.com/?q=${encodeURIComponent(addressParts.join(", "))}` : null;

  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <Heading level={3}>Location</Heading>
          <Text tone="muted">{addressParts.length > 0 ? addressParts.join(", ") : "No address on file."}</Text>
          <Inline gap="sm" wrap>
            <Button
              variant="outline"
              disabled={!mapsHref}
              onClick={() => mapsHref && window.open(mapsHref, "_blank", "noopener,noreferrer")}
              style={{ minHeight: 44 }}
            >
              <Inline gap="xs" align="center">
                <MapPin aria-hidden width={16} height={16} />
                Navigate
              </Inline>
            </Button>
            <Button
              variant="outline"
              disabled={!site?.phone}
              onClick={() => site?.phone && (window.location.href = `tel:${site.phone}`)}
              style={{ minHeight: 44 }}
            >
              <Inline gap="xs" align="center">
                <Phone aria-hidden width={16} height={16} />
                Call contact
              </Inline>
            </Button>
          </Inline>
        </Stack>
      </Card>

      {asset && (
        <Card>
          <Stack gap="sm">
            <Heading level={3}>Asset</Heading>
            <KeyValueList
              items={[
                { label: "Name", value: <Text>{asset.name}</Text> },
                ...(asset.serialNumber ? [{ key: "serial", label: "Serial", value: <Text>{asset.serialNumber}</Text> }] : []),
                ...(asset.brand || asset.model
                  ? [
                      {
                        key: "make",
                        label: "Brand / model",
                        value: <Text>{[asset.brand, asset.model].filter(Boolean).join(" ")}</Text>,
                      },
                    ]
                  : []),
                ...(yearOf(asset.installedAt)
                  ? [{ key: "year", label: "Built", value: <Text>{yearOf(asset.installedAt)}</Text> }]
                  : []),
              ]}
            />
          </Stack>
        </Card>
      )}

      <Card>
        <Stack gap="sm">
          <Heading level={3}>Description</Heading>
          <Text>{description || "No description added."}</Text>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={3}>Solution</Heading>
          <Textarea
            aria-label="Solution"
            placeholder="What did you do to resolve this?"
            value={solution}
            onChange={(event) => onSolutionChange(event.target.value)}
            rows={4}
          />
        </Stack>
      </Card>

      {contract && (
        <Card tone="accent">
          <Stack gap="xs">
            <Text style={{ fontSize: "11px", letterSpacing: "0.13em", textTransform: "uppercase" }}>Contract</Text>
            <Heading level={3}>{contract.name}</Heading>
            <Text>
              {contract.type ?? "Contract"} · from {new Date(contract.startDate).toLocaleDateString("en-GB")}
              {contract.endDate ? ` to ${new Date(contract.endDate).toLocaleDateString("en-GB")}` : ""}
            </Text>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
