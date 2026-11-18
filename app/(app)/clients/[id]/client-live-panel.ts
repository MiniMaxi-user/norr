import type { LivePanelData } from "@yourorg/ui/web-client";
import { formatDateWeb } from "@/lib/format/web";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";

/** The signed-in viewer. The client page has no per-user trigger today (no
 * timers, approvals or acceptances live on a client record), so nothing reads
 * it yet — it is part of the signature so a future "approval waiting for you"
 * trigger needs no call-site change. */
export interface LivePanelViewer {
  userId: string;
}

export interface ClientLivePanelRecord {
  quotes: QuoteRecord[] | null;
  /** Today in Europe/Amsterdam as `YYYY-MM-DD` (injected for testability). */
  today: string;
}

/** Days after expiry in which a still-open quote counts as "just expired". */
const RECENTLY_EXPIRED_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);
}

/**
 * LivePanel of the Client page (design system 01 §4 / LivePanel README) — a
 * panel only when something is happening NOW that the user can act on from
 * here. The one hard deadline a client page knows about: a quote that was SENT
 * and whose validity ends today (attention) or ended within the last 7 days
 * without an answer (urgent). The action opens the quote. Everything else —
 * "no contract", open work orders, tenant status — is a badge or a rail
 * section, not a LivePanel. Returns `null` when in doubt (and most of the
 * time).
 */
export function getLivePanel(record: ClientLivePanelRecord, _viewer: LivePanelViewer | null): LivePanelData | null {
  void _viewer;
  if (!record.quotes) return null;

  const open = record.quotes.filter(
    (quote) => quote.quote_status?.value === "sent" && !quote.is_auto_draft && quote.valid_until,
  );
  const expiring = open.filter((quote) => quote.valid_until === record.today);
  const expired = open.filter((quote) => {
    const age = daysBetween(quote.valid_until as string, record.today);
    return age > 0 && age <= RECENTLY_EXPIRED_DAYS;
  });

  const toPanel = (quote: QuoteRecord, variant: "attention" | "urgent"): LivePanelData => ({
    variant,
    title: variant === "urgent" ? "QUOTE EXPIRED" : "QUOTE EXPIRES TODAY",
    value: variant === "urgent" ? "Expired" : "Today",
    context: `${quote.name} · valid until ${formatDateWeb(quote.valid_until)}`,
    actions: [{ label: "Open quote", href: `/quotes/${quote.id}` }],
  });

  // Priority: deadline passed, then deadline today. Others hang under it.
  const panels = [...expired.map((quote) => toPanel(quote, "urgent")), ...expiring.map((quote) => toPanel(quote, "attention"))];
  const [first, ...rest] = panels;
  if (!first) return null;
  return { ...first, others: rest };
}
