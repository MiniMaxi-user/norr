import Link from "next/link";
import type { TimelineItem } from "@yourorg/ui/web";
import type { ContractQuoteRecord } from "@/app/(app)/quotes/contract-quote-actions";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { ContractAssetRecord, ContractLineItemRecord, ContractRecord } from "../actions";

const MAX_ITEMS = 8;

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
}

/**
 * The Contract page's TIMELINE, built from data the page already loads (no new
 * fetch): the contract's own created/changed stamps plus its line items,
 * linked assets and — for a viewer who can see quotes — generated quotes.
 * Newest first, at most 8. None of these tables store a resolvable actor name
 * the page loads, so entries carry no actor.
 */
export function buildContractTimeline(input: {
  contract: ContractRecord;
  lineItems: ContractLineItemRecord[];
  contractAssets: ContractAssetRecord[];
  quotes: ContractQuoteRecord[] | null;
}): TimelineItem[] {
  const { contract, lineItems, contractAssets, quotes } = input;
  const events: Event[] = [{ id: "contract-created", at: contract.created_at, title: "Contract created" }];

  const created = new Date(contract.created_at).getTime();
  const updated = new Date(contract.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "contract-updated", at: contract.updated_at, title: "Details changed" });
  }

  for (const item of lineItems) {
    events.push({
      id: `line-${item.id}`,
      at: item.created_at,
      title: `Line item added · ${item.article_number ?? item.description ?? "article"}`,
    });
  }

  for (const link of contractAssets) {
    events.push({
      id: `asset-${link.asset_id}`,
      at: link.created_at,
      title: (
        <>
          Asset linked ·{" "}
          {link.asset ? <Link href={`/assets/${link.asset.id}`}>{link.asset.name}</Link> : "Unknown asset"}
        </>
      ),
    });
  }

  for (const quote of quotes ?? []) {
    events.push({
      id: `quote-${quote.id}`,
      at: quote.created_at,
      title: (
        <>
          Quote created · <Link href={`/quotes/${quote.id}`}>{quote.name}</Link>
        </>
      ),
    });
  }

  return events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ITEMS)
    .map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      status: index === 0 ? "latest" : "default",
    }));
}
