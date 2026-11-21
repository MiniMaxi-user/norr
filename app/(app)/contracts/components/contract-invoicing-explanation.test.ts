import { describe, expect, it } from "vitest";
import { buildInvoicingExplanation } from "./contract-invoicing-explanation";

const base = {
  intervalMonths: 3,
  timing: "in_advance" as const,
  frequency: "annually" as const,
  settlementMonth: 1,
  creditsUnderUse: false,
};

describe("buildInvoicingExplanation", () => {
  it("explains quarterly in advance with an annual settlement and the ending", () => {
    const text = buildInvoicingExplanation(base);
    expect(text).toContain("Invoiced quarterly in advance.");
    expect(text).toContain("settled once a year on 1 January");
    expect(text).toContain("minimum contract");
    expect(text).toContain(
      "When the contract ends, open periods are invoiced pro rata, prepaid time after the end date is credited and remaining counter usage is settled in one final quote.",
    );
  });

  it("explains settlement with every invoice per timing", () => {
    const advance = buildInvoicingExplanation({ ...base, frequency: "with_invoice", settlementMonth: null });
    expect(advance).toContain("previous period is billed on the next invoice");
    const arrears = buildInvoicingExplanation({ ...base, timing: "in_arrears", frequency: "with_invoice", settlementMonth: null });
    expect(arrears).toContain("Invoiced quarterly in arrears.");
    expect(arrears).toContain("billed on the same invoice");
    expect(arrears).not.toContain("prepaid");
  });

  it("lists the quarterly settlement dates from the settlement month", () => {
    const text = buildInvoicingExplanation({ ...base, frequency: "quarterly", settlementMonth: 2 });
    expect(text).toContain("1 February, 1 May, 1 August and 1 November");
  });

  it("mentions under-use crediting when a line has it", () => {
    expect(buildInvoicingExplanation({ ...base, creditsUnderUse: true })).toContain("Usage below the included volume is credited");
  });

  it("leaves counter text out when there are no counter lines", () => {
    const text = buildInvoicingExplanation({ ...base, hasCounterLines: false });
    expect(text).not.toContain("Counter usage");
    expect(text).not.toContain("counter usage");
    expect(text).toContain("open periods are invoiced pro rata and prepaid time after the end date is credited in one final quote");
  });

  it("handles non-recurring and unusual intervals", () => {
    expect(buildInvoicingExplanation({ ...base, intervalMonths: null })).toContain("Invoiced once in advance.");
    expect(buildInvoicingExplanation({ ...base, intervalMonths: 4 })).toContain("Invoiced every 4 months in advance.");
  });
});
