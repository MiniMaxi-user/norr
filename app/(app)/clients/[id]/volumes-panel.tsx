import Link from "next/link";
import { Card, EmptyState, Heading, Stack, Table, Text } from "@yourorg/ui";
import type { ClientVolumeTotalsData } from "@/lib/asset-volumes/actions";
import { formatDateTime } from "@/lib/format/date";
import { formatNumber } from "@/lib/format/number";

export interface VolumesPanelProps {
  data: ClientVolumeTotalsData;
}

/**
 * Client "Volumes" tab (issue #221): per counter, the sum of each asset's
 * latest reading, then a per-asset breakdown linking to the asset's own
 * Volumes tab.
 */
export function VolumesPanel({ data }: VolumesPanelProps) {
  if (data.totals.length === 0) {
    return (
      <EmptyState
        heading="No volume readings yet"
        text="Readings recorded on this client's assets will be summarized here."
      />
    );
  }

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Heading level={5}>Totals per counter</Heading>
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Counter</Table.HeaderCell>
              <Table.HeaderCell align="end">Total</Table.HeaderCell>
              <Table.HeaderCell align="end">Assets</Table.HeaderCell>
              <Table.HeaderCell>Last read</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {data.totals.map((total) => (
              <Table.Row key={total.volumeItemId}>
                <Table.Cell>
                  <Text>{total.label}</Text>
                </Table.Cell>
                <Table.Cell align="end">
                  <Text>
                    {formatNumber(total.total)}
                    {total.unitLabel ? ` ${total.unitLabel}` : ""}
                  </Text>
                </Table.Cell>
                <Table.Cell align="end">
                  <Text tone="muted">{total.assetCount}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text tone="muted">{formatDateTime(total.lastReadAt)}</Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Stack>

      <Card>
        <Stack gap="sm">
          <Heading level={5}>Latest reading per asset</Heading>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Asset</Table.HeaderCell>
                <Table.HeaderCell>Site</Table.HeaderCell>
                <Table.HeaderCell>Counter</Table.HeaderCell>
                <Table.HeaderCell align="end">Latest value</Table.HeaderCell>
                <Table.HeaderCell>Read at</Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {data.rows.map((row) => (
                <Table.Row key={`${row.assetId}-${row.volumeItemId}`}>
                  <Table.Cell>
                    <Link href={`/assets/${row.assetId}?tab=volumes`}>{row.assetName}</Link>
                  </Table.Cell>
                  <Table.Cell>
                    <Text tone="muted">{row.siteName ?? "—"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>{row.counterLabel}</Text>
                  </Table.Cell>
                  <Table.Cell align="end">
                    <Text>{formatNumber(row.value)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text tone="muted">{formatDateTime(row.readAt)}</Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Stack>
      </Card>
    </Stack>
  );
}
