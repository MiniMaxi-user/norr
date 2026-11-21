import type { LivePanelAction, LivePanelData } from "@yourorg/ui/web-client";
import { formatDateWeb } from "@/lib/format/web";
import type { ContractRecord } from "../actions";
import { getContractStatus, pluralDays } from "./contract-status";
import { todayIso } from "./contract-draft";

/** The signed-in viewer (see the client page's twin of this function). */
export interface LivePanelViewer {
  userId: string;
}

export interface ContractLivePanelRecord {
  contract: ContractRecord;
  /** May the viewer change the contract (the "Extend" action starts Edit)? */
  canUpdate: boolean;
  /** The Quotes tab is visible to the viewer. */
  canSeeQuotes: boolean;
  /** Covered asset/counter pairs without a baseline reading (draft only). */
  missingBaselineCount?: number;
  /** Activates a draft contract (Draft -> Active). */
  onActivate: () => void;
  /** Cancels a scheduled ending (end_scheduled_at set, end date not passed). */
  onCancelEnding?: () => void;
  onExtend: () => void;
  onShowQuotes: () => void;
  now?: number;
}

/** A contract that ends within this many days gets the panel. */
export const ENDING_SOON_DAYS = 30;
/** ...and stays urgent for this many days after it ended. */
export const RECENTLY_ENDED_DAYS = 14;

/**
 * LivePanel of the Contract page — a panel only when the user has to act now:
 *
 *  - the contract is a draft: "Activate" is the one action that makes it
 *    count (invoicing + coverage), so it lives here, not in the header;
 *  - the contract ends within 30 days and does not auto-renew ("attention");
 *  - it ended within the last 14 days and did not auto-renew ("urgent").
 *
 * Actions: "Extend contract" (starts Edit, to move the end date or switch on
 * auto-renew) for someone who may update it, and "View quotes" when the Quotes
 * tab exists. There is no renewal-quote flow in the product, so none is
 * invented. Everything else — upcoming, open-ended, auto-renewing contracts,
 * a billing date that is due — is a badge or a rail row, not a LivePanel.
 * Returns `null` when in doubt (and most of the time).
 */
export function getLivePanel(record: ContractLivePanelRecord, _viewer: LivePanelViewer | null): LivePanelData | null {
  void _viewer;
  const { contract } = record;
  if (contract.status === "draft") {
    if (!record.canUpdate) return null;
    const missing = record.missingBaselineCount ?? 0;
    return {
      variant: "attention",
      title: "DRAFT CONTRACT",
      value: "Not active yet",
      context:
        missing > 0
          ? `${missing} ${missing === 1 ? "counter still needs" : "counters still need"} a baseline reading before activation`
          : "Activate it to start invoicing and coverage on work orders",
      actions: [{ label: "Activate", onClick: record.onActivate }],
    };
  }
  const endHref = `/contracts/${contract.id}/end`;
  const today = todayIso();

  // Issue #271: ended without a final balance (legacy) -> complete it.
  if (contract.status === "ended") {
    if (!record.canUpdate || contract.has_final_settlement !== false) return null;
    return {
      variant: "urgent",
      title: "FINAL BALANCE MISSING",
      value: "Not settled yet",
      context: "This contract ended without a final balance. Invoice the open period, credit prepaid time and settle counters.",
      actions: [{ label: "Complete final balance", href: endHref }],
    };
  }
  if (contract.status !== "active") return null;

  if (contract.end_date) {
    const scheduled = Boolean(contract.end_scheduled_at);
    if (contract.end_date >= today && scheduled) {
      const actions: LivePanelAction[] = [];
      if (record.canUpdate && record.onCancelEnding) actions.push({ label: "Cancel ending", onClick: record.onCancelEnding });
      return {
        variant: "info",
        title: "ENDING SCHEDULED",
        value: `Ends on ${formatDateWeb(contract.end_date)}`,
        context: "The contract stays active until then. After that date, complete the final balance.",
        actions,
      };
    }
    // Fixed term without auto-renew, or a scheduled ending that has passed.
    if (contract.end_date < today && (scheduled || !contract.auto_renew)) {
      if (record.canUpdate) {
        return {
          variant: "urgent",
          title: "FINAL BALANCE DUE",
          value: "Complete final balance",
          context: `Ended on ${formatDateWeb(contract.end_date)}. Invoice the open period, credit prepaid time and settle counters.`,
          actions: [{ label: "Complete final balance", href: endHref }],
        };
      }
    }
  }
  if (contract.auto_renew || !contract.end_date) return null;
  const status = getContractStatus(contract, record.now);
  if (status.daysToEnd === null || status.phase === "upcoming") return null;

  const actions: LivePanelAction[] = [];
  if (record.canUpdate) actions.push({ label: "Extend contract", onClick: record.onExtend });
  if (record.canSeeQuotes) actions.push({ label: "View quotes", onClick: record.onShowQuotes });
  if (actions.length === 0) return null;

  if (status.daysToEnd < 0) {
    const ago = -status.daysToEnd;
    if (ago > RECENTLY_ENDED_DAYS) return null;
    return {
      variant: "urgent",
      title: "CONTRACT ENDED",
      value: ago === 1 ? "Yesterday" : `${pluralDays(ago)} ago`,
      context: `Ended on ${formatDateWeb(contract.end_date)} and does not auto-renew`,
      actions,
    };
  }

  if (status.daysToEnd > ENDING_SOON_DAYS) return null;
  return {
    variant: "attention",
    title: "CONTRACT ENDS SOON",
    value: status.daysToEnd === 0 ? "Today" : `${pluralDays(status.daysToEnd)} left`,
    context: `Ends on ${formatDateWeb(contract.end_date)} and does not auto-renew`,
    actions,
  };
}
