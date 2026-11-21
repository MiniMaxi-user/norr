import Link from "next/link";
import type { TimelineItem } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import { memberDisplayName } from "@/lib/members/format";
import type { ActivityEventRecord, ActivityEventType } from "../history-actions";
import type { ActivityNoteRecord } from "../notes-actions";


const EVENT_TITLES: Record<ActivityEventType, string> = {
  created: "Activity created",
  action_holder_changed: "Action holder set",
  work_order_linked: "Work order created",
  quote_created: "Quote created",
};

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
  actor?: string | null;
}

/**
 * The Activity page's TIMELINE, built from data the page already loads (no new
 * fetch): the activity's history events (created, action holder set, work
 * order / quote created — with a link to the record) and its notes. Newest
 * first, at most 10. Replaces the old "History" section.
 */
export function buildActivityTimeline(input: {
  events: ActivityEventRecord[];
  notes: ActivityNoteRecord[];
  /** Quotes module on; off => the quote is named but not linked (#247). */
  quotesEnabled?: boolean;
}): TimelineItem[] {
  const events: Event[] = [];

  for (const event of input.events) {
    let title: TimelineItem["title"] = EVENT_TITLES[event.event_type];
    if (event.event_type === "work_order_linked" && event.related_work_order) {
      title = (
        <>
          {title} · <Link href={`/work-orders/${event.related_work_order.id}`}>{event.related_work_order.work_order_number}</Link>
        </>
      );
    } else if (event.event_type === "quote_created" && event.related_quote) {
      title = (
        <>
          {title} ·{" "}
          {input.quotesEnabled === false ? (
            event.related_quote.name
          ) : (
            <Link href={`/quotes/${event.related_quote.id}`}>{event.related_quote.name}</Link>
          )}
        </>
      );
    }
    events.push({ id: `event-${event.id}`, at: event.occurred_at, title, actor: event.actor ? memberDisplayName(event.actor) : null });
  }

  for (const note of input.notes) {
    events.push({
      id: `note-${note.id}`,
      at: note.created_at,
      title: "Note added",
      actor: note.created_by_user ? memberDisplayName(note.created_by_user) : null,
    });
  }

  return events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      actor: event.actor ?? null,
      status: index === 0 ? "latest" : "default",
    }));
}
