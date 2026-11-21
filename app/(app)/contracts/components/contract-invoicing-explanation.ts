import type { ContractInvoicingTiming, CounterSettlementFrequency } from "../schema";

/**
 * Plain-language "How invoicing works for this contract" text (issue #271),
 * built only from the contract's own values. Pure, so it is unit-tested and
 * can be rendered live while the form is being edited.
 */
export interface InvoicingExplanationInput {
  /** Billing terms interval in months; null = non-recurring (invoiced once). */
  intervalMonths: number | null;
  timing: ContractInvoicingTiming;
  frequency: CounterSettlementFrequency;
  /** 1-12; only used for quarterly / annually. */
  settlementMonth: number | null;
  /** At least one counter line credits under-use. */
  creditsUnderUse: boolean;
  /** Does the contract have counter (volume) lines? `null` = unknown (new contract): counter text is shown. */
  hasCounterLines?: boolean | null;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthName(month: number): string {
  return MONTH_NAMES[((month - 1) % 12 + 12) % 12] ?? "";
}

function cadenceText(intervalMonths: number | null): string {
  if (!intervalMonths) return "once";
  switch (intervalMonths) {
    case 1:
      return "monthly";
    case 3:
      return "quarterly";
    case 6:
      return "every half year";
    case 12:
      return "annually";
    default:
      return `every ${intervalMonths} months`;
  }
}

/** "1 January, 1 April, 1 July and 1 October" for a quarterly settlement month. */
function quarterlyDates(month: number): string {
  const first = ((month - 1) % 3) + 1;
  const names = [0, 3, 6, 9].map((offset) => `1 ${monthName(first + offset)}`);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function buildInvoicingExplanation(input: InvoicingExplanationInput): string {
  const { intervalMonths, timing, frequency, settlementMonth, creditsUnderUse } = input;
  const hasCounters = input.hasCounterLines !== false;
  const sentences: string[] = [];

  sentences.push(`Invoiced ${cadenceText(intervalMonths)} ${timing === "in_advance" ? "in advance" : "in arrears"}.`);

  if (hasCounters) {
    switch (frequency) {
      case "with_invoice":
        sentences.push(
          timing === "in_advance"
            ? "Counter usage is settled with every invoice: the usage of the previous period is billed on the next invoice."
            : "Counter usage is settled with every invoice: the usage of the period is billed on the same invoice.",
        );
        break;
      case "monthly":
        sentences.push("Counter usage is settled once a month, on the 1st, on a separate counter settlement quote.");
        break;
      case "quarterly":
        sentences.push(
          settlementMonth
            ? `Counter usage is settled once a quarter, on ${quarterlyDates(settlementMonth)}, on a separate counter settlement quote.`
            : "Counter usage is settled once a quarter on a separate counter settlement quote.",
        );
        break;
      case "annually":
        sentences.push(
          settlementMonth
            ? `Counter usage is settled once a year on 1 ${monthName(settlementMonth)}, on a separate counter settlement quote.`
            : "Counter usage is settled once a year on a separate counter settlement quote.",
        );
        break;
    }
    sentences.push(
      creditsUnderUse
        ? "Usage below the included volume is credited on lines with Credit under-use; other lines are a minimum contract."
        : "The included volume is always paid (minimum contract): only usage above it is billed.",
    );
  }

  const ending: string[] = ["open periods are invoiced pro rata"];
  if (timing === "in_advance") ending.push("prepaid time after the end date is credited");
  if (hasCounters) ending.push("remaining counter usage is settled");
  const last = ending.pop();
  sentences.push(
    `When the contract ends, ${ending.length > 0 ? `${ending.join(", ")} and ${last}` : last} in one final quote.`,
  );

  return sentences.join(" ");
}
