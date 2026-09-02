import Link from "next/link";
import { KeyValueList, SectionHeader, Stack, Text, type KeyValueListItem } from "@yourorg/ui";
import { Clock } from "@yourorg/ui/icons";
import type { ActivityEventRecord, ActivityEventType } from "../history-actions";
import { formatDateTime } from "@/lib/format/date";
import { memberDisplayName } from "@/lib/members/format";

export interface ActivityHistorySectionProps {
  events: ActivityEventRecord[];
}

/** Dutch display strings for `activity_events.event_type`, exactly the copy
 * the design handoff specifies ("Melding aangemaakt" / "Action holder gezet" /
 * "Werkorder aangemaakt") — `listActivityEvents` deliberately returns the raw
 * `event_type` rather than pre-translating it (see that action's own doc
 * comment), so the mapping lives here instead. */
const EVENT_TYPE_LABELS: Record<ActivityEventType, string> = {
  created: "Melding aangemaakt",
  action_holder_changed: "Action holder gezet",
  work_order_linked: "Werkorder aangemaakt",
};

/**
 * "Historie" section (`.design-handoff/melding_detail/README.md`) — `mode:
 * "edit"` only, a `KeyValueList` fed by `listActivityEvents` (ascending,
 * oldest first — that action's own order). Label = "{date+time} · {Dutch
 * description}"; value = the resolved actor's name for
 * `created`/`action_holder_changed`, or a link to the related work order for
 * `work_order_linked`.
 */
export function ActivityHistorySection({ events }: ActivityHistorySectionProps) {
  const items: KeyValueListItem[] = events.map((event) => ({
    key: event.id,
    label: `${formatDateTime(event.occurred_at)} · ${EVENT_TYPE_LABELS[event.event_type]}`,
    value:
      event.event_type === "work_order_linked" && event.related_work_order ? (
        <Link href={`/work-orders/${event.related_work_order.id}`}>{event.related_work_order.title}</Link>
      ) : (
        <Text>{memberDisplayName(event.actor)}</Text>
      ),
  }));

  return (
    <Stack gap="md">
      <SectionHeader icon={Clock} title="Historie" />
      {items.length > 0 ? <KeyValueList items={items} /> : <Text tone="muted">No history yet.</Text>}
    </Stack>
  );
}
