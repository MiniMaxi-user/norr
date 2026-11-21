import { describe, expect, it } from "vitest";
import {
  buildOverageLine,
  buildPeriodLine,
  buildPrepaidCreditLine,
  buildUnderUseCreditLine,
  counterWindowDetails,
  daysInclusive,
  describeSettlementSchedule,
  includedForWindow,
  invoicePeriodWithFactor,
  nextSettlementDate,
  planFinalBalance,
  proRataFactor,
  settlementWindows,
  uncappedPeriodByIndex,
  type BalanceContract,
  type BalanceContractLine,
  type UsageProvider,
} from "./contract-balance";

function line(partial: Partial<BalanceContractLine> = {}): BalanceContractLine {
  return {
    id: "l1",
    articleId: "art1",
    articleNumber: "A-1",
    description: "Service",
    quantity: 1,
    unitPrice: 100,
    sortOrder: 0,
    isVolume: false,
    volumeItemId: null,
    counterLabel: "Counter",
    overageUnitPrice: null,
    creditUnderUse: false,
    ...partial,
  };
}

function counterLine(partial: Partial<BalanceContractLine> = {}): BalanceContractLine {
  return line({
    id: "c1",
    description: "Prints",
    quantity: 1000,
    unitPrice: 0,
    sortOrder: 1,
    isVolume: true,
    volumeItemId: "vol1",
    counterLabel: "B/W pages",
    overageUnitPrice: 0.05,
    ...partial,
  });
}

function contract(partial: Partial<BalanceContract> = {}): BalanceContract {
  return {
    startDate: "2027-01-01",
    endDate: "2027-05-14",
    timing: "in_advance",
    intervalMonths: 3,
    multiplier: 3,
    frequency: "with_invoice",
    settlementMonth: null,
    invoicedPeriodCount: 1,
    ...partial,
  };
}

const noUsage: UsageProvider = () => ({ usage: 0, issues: [], reviewReadingsInPeriod: 0 });

describe("day counting and pro rata", () => {
  it("counts days inclusively", () => {
    expect(daysInclusive("2027-01-01", "2027-01-01")).toBe(1);
    expect(daysInclusive("2027-01-01", "2027-03-31")).toBe(90);
    expect(daysInclusive("2028-02-01", "2028-02-29")).toBe(29);
    expect(daysInclusive("2027-02-02", "2027-02-01")).toBe(0);
  });

  it("gives factor 1 for a full period and days ratio for a shortened one", () => {
    const full = { start: "2027-04-01", end: "2027-06-30" }; // 91 days
    expect(proRataFactor(full, full)).toBe(1);
    expect(proRataFactor({ start: "2027-04-01", end: "2027-05-14" }, full)).toBeCloseTo(44 / 91, 10);
  });

  it("computes the uncapped period and the capped period with factor", () => {
    expect(uncappedPeriodByIndex("2027-01-01", 1, 3)).toEqual({ start: "2027-04-01", end: "2027-06-30" });
    const r = invoicePeriodWithFactor("2027-01-01", 1, 3, "2027-05-14");
    expect(r.period).toEqual({ start: "2027-04-01", end: "2027-05-14" });
    expect(r.full).toEqual({ start: "2027-04-01", end: "2027-06-30" });
    expect(r.factor).toBeCloseTo(44 / 91, 10);
    expect(invoicePeriodWithFactor("2027-01-01", 0, 3, "2027-05-14").factor).toBe(1);
    expect(invoicePeriodWithFactor("2027-01-01", 0, null, "2027-05-14").factor).toBe(1);
  });

  it("keeps month-end anchoring (31 Jan start)", () => {
    expect(uncappedPeriodByIndex("2027-01-31", 1, 1)).toEqual({ start: "2027-02-28", end: "2027-03-30" });
    const r = invoicePeriodWithFactor("2027-01-31", 1, 1, "2027-03-14");
    expect(r.factor).toBe(15 / 31);
  });
});

describe("includedForWindow", () => {
  it("equals quantity x multiplier for a full period", () => {
    expect(includedForWindow(500, 3, "2027-01-01", 3, { start: "2027-04-01", end: "2027-06-30" })).toBe(1500);
  });

  it("is pro rata for a shortened last period", () => {
    expect(includedForWindow(500, 3, "2027-01-01", 3, { start: "2027-04-01", end: "2027-05-14" })).toBeCloseTo(
      (1500 * 44) / 91,
      3,
    );
  });

  it("sums several periods in a window", () => {
    expect(includedForWindow(500, 3, "2027-01-01", 3, { start: "2027-01-01", end: "2027-12-31" })).toBe(6000);
  });

  it("splits a period across two windows without losing quantity", () => {
    const a = includedForWindow(500, 3, "2027-01-01", 3, { start: "2027-01-01", end: "2027-02-14" });
    const b = includedForWindow(500, 3, "2027-01-01", 3, { start: "2027-02-15", end: "2027-03-31" });
    expect(a + b).toBeCloseTo(1500, 2);
  });

  it("counts only the part after the contract start", () => {
    expect(includedForWindow(500, 3, "2027-01-01", 3, { start: "2026-10-01", end: "2027-03-31" })).toBe(1500);
  });

  it("uses quantity x multiplier for non-recurring terms", () => {
    expect(includedForWindow(500, 1, "2027-01-01", null, { start: "2027-01-01", end: "2027-02-01" })).toBe(500);
  });
});

describe("nextSettlementDate", () => {
  it("is strictly after the given date", () => {
    expect(nextSettlementDate("2027-03-15", "monthly", null)).toBe("2027-04-01");
    expect(nextSettlementDate("2027-03-31", "monthly", null)).toBe("2027-04-01");
    expect(nextSettlementDate("2027-04-01", "monthly", null)).toBe("2027-05-01");
  });

  it("handles quarterly with a settlement month", () => {
    expect(nextSettlementDate("2027-01-01", "quarterly", 2)).toBe("2027-02-01");
    expect(nextSettlementDate("2027-02-01", "quarterly", 2)).toBe("2027-05-01");
    expect(nextSettlementDate("2027-11-20", "quarterly", 2)).toBe("2028-02-01");
  });

  it("handles annually incl. year wrap", () => {
    expect(nextSettlementDate("2027-01-01", "annually", 1)).toBe("2028-01-01");
    expect(nextSettlementDate("2027-12-31", "annually", 1)).toBe("2028-01-01");
    expect(nextSettlementDate("2027-03-10", "annually", 11)).toBe("2027-11-01");
  });

  it("returns null for with_invoice", () => {
    expect(nextSettlementDate("2027-01-01", "with_invoice", null)).toBeNull();
  });
});

describe("settlementWindows", () => {
  const base = { contractStart: "2027-03-10", intervalMonths: 3, contractEnd: null };

  it("with_invoice: the invoice periods", () => {
    const w = settlementWindows({
      ...base,
      contractStart: "2027-01-01",
      from: "2027-01-01",
      frequency: "with_invoice",
      month: null,
      to: "2027-09-30",
    });
    expect(w).toEqual([
      { start: "2027-01-01", end: "2027-03-31" },
      { start: "2027-04-01", end: "2027-06-30" },
      { start: "2027-07-01", end: "2027-09-30" },
    ]);
  });

  it("annually: first partial window from the contract start, then calendar years", () => {
    const w = settlementWindows({
      ...base,
      from: "2027-03-10",
      frequency: "annually",
      month: 1,
      to: "2029-06-30",
    });
    expect(w).toEqual([
      { start: "2027-03-10", end: "2027-12-31" },
      { start: "2028-01-01", end: "2028-12-31" },
      { start: "2029-01-01", end: "2029-06-30" },
    ]);
  });

  it("quarterly with settlement month wraps the year", () => {
    const w = settlementWindows({
      ...base,
      from: "2027-11-01",
      frequency: "quarterly",
      month: 2,
      to: "2028-06-30",
    });
    expect(w).toEqual([
      { start: "2027-11-01", end: "2028-01-31" },
      { start: "2028-02-01", end: "2028-04-30" },
      { start: "2028-05-01", end: "2028-06-30" },
    ]);
  });

  it("dueOnly returns only complete windows that ended before today", () => {
    const w = settlementWindows({
      ...base,
      from: "2027-03-10",
      frequency: "annually",
      month: 1,
      dueOnly: true,
      today: "2029-01-01",
    });
    expect(w).toEqual([
      { start: "2027-03-10", end: "2027-12-31" },
      { start: "2028-01-01", end: "2028-12-31" },
    ]);
    // On 31 Dec the year is not over yet.
    expect(
      settlementWindows({ ...base, from: "2028-01-01", frequency: "annually", month: 1, dueOnly: true, today: "2028-12-31" }),
    ).toEqual([]);
  });

  it("dueOnly counts a window ended by the contract end date as complete", () => {
    const w = settlementWindows({
      ...base,
      contractEnd: "2028-06-30",
      from: "2028-01-01",
      frequency: "annually",
      month: 1,
      dueOnly: true,
      today: "2028-07-01",
    });
    expect(w).toEqual([{ start: "2028-01-01", end: "2028-06-30" }]);
  });

  it("frequency change mid-contract: next window runs from last settled end + 1 to the next boundary", () => {
    // Settled annually up to 2027-12-31, now monthly.
    const w = settlementWindows({
      ...base,
      from: "2028-01-01",
      frequency: "monthly",
      month: null,
      to: "2028-03-15",
    });
    expect(w).toEqual([
      { start: "2028-01-01", end: "2028-01-31" },
      { start: "2028-02-01", end: "2028-02-29" },
      { start: "2028-03-01", end: "2028-03-15" },
    ]);
    // Settled monthly up to 2028-01-31, now annually (January): one partial year window.
    const w2 = settlementWindows({ ...base, from: "2028-02-01", frequency: "annually", month: 1, to: "2029-02-10" });
    expect(w2).toEqual([
      { start: "2028-02-01", end: "2028-12-31" },
      { start: "2029-01-01", end: "2029-02-10" },
    ]);
  });

  it("requires today for dueOnly", () => {
    expect(() =>
      settlementWindows({ ...base, from: "2027-03-10", frequency: "monthly", month: null, dueOnly: true }),
    ).toThrow();
  });
});

describe("line builders", () => {
  it("period line for a full period is unchanged; shortened scales the price", () => {
    const full = buildPeriodLine(line(), 3, 1, "1 Apr 2027 – 30 Jun 2027");
    expect(full).toMatchObject({ quantity: 3, unitPrice: 100, kind: "period" });
    expect(full.description).toBe("Service (1 Apr 2027 – 30 Jun 2027)");
    const part = buildPeriodLine(line(), 3, 44 / 91, "x");
    expect(part.quantity).toBe(1);
    expect(part.unitPrice).toBe(145.05);
  });

  it("prepaid credit line has a negative quantity", () => {
    const credit = buildPrepaidCreditLine(line(), 3, 47 / 91, "15 May 2027 – 30 Jun 2027");
    expect(credit.quantity).toBe(-1);
    expect(credit.unitPrice).toBe(154.95);
    expect(credit.description).toBe("Credit Service (15 May 2027 – 30 Jun 2027)");
  });

  it("overage line uses the overage price; none without price or overage", () => {
    const l = counterLine();
    expect(buildOverageLine(l, 1300, 1000, "w")).toMatchObject({ quantity: 300, unitPrice: 0.05, kind: "overage" });
    expect(buildOverageLine(l, 900, 1000, "w")).toBeNull();
    expect(buildOverageLine(counterLine({ overageUnitPrice: null }), 1300, 1000, "w")).toBeNull();
  });

  it("under-use credit only when enabled, at the line's unit price", () => {
    expect(buildUnderUseCreditLine(counterLine({ unitPrice: 0.02 }), 700, 1000, "w")).toBeNull();
    const credit = buildUnderUseCreditLine(counterLine({ unitPrice: 0.02, creditUnderUse: true }), 700, 1000, "w");
    expect(credit).toMatchObject({ quantity: -300, unitPrice: 0.02, kind: "under_use" });
    expect(credit?.description).toBe("B/W pages – under-use credit: usage 700, included 1000, under-use 300 (w)");
    expect(buildUnderUseCreditLine(counterLine({ creditUnderUse: true }), 1000, 1000, "w")).toBeNull();
  });
});

describe("planFinalBalance", () => {
  it("in advance: charges the open pro rata period and credits nothing when the last invoiced period ended", () => {
    // Quarterly in advance, period 0 (Jan-Mar) invoiced, E = 14 May; period 1 open (Apr 1 - May 14).
    const plan = planFinalBalance({
      contract: contract(),
      lines: [line()],
      periodQuotes: [{ id: "q0", periodStart: "2027-01-01", periodEnd: "2027-03-31", invoiced: true, amount: 300 }],
      lastSettledEnd: null,
      usageFor: noUsage,
    });
    expect(plan.periods.map((p) => p.status)).toEqual(["invoiced", "open"]);
    expect(plan.periods[1]).toMatchObject({ period: { start: "2027-04-01", end: "2027-05-14" }, proRata: true });
    expect(plan.openLines).toHaveLength(1);
    expect(plan.openLines[0]?.description).toContain("1 Apr 2027 – 14 May 2027");
    expect(plan.creditLines).toEqual([]);
    expect(plan.totals.toInvoice).toBeCloseTo(145.05, 2);
    expect(plan.totals.toCredit).toBe(0);
  });

  it("in advance: credits the prepaid part after E and replaces nothing invoiced", () => {
    // Period 1 (Apr-Jun) invoiced in advance, contract ends 14 May.
    const plan = planFinalBalance({
      contract: contract({ invoicedPeriodCount: 2 }),
      lines: [line()],
      periodQuotes: [
        { id: "q0", periodStart: "2027-01-01", periodEnd: "2027-03-31", invoiced: true },
        { id: "q1", periodStart: "2027-04-01", periodEnd: "2027-06-30", invoiced: true, invoiceNumber: "INV-1" },
      ],
      lastSettledEnd: null,
      usageFor: noUsage,
    });
    expect(plan.openLines).toEqual([]);
    expect(plan.creditLines).toHaveLength(1);
    expect(plan.creditLines[0]?.description).toContain("15 May 2027 – 30 Jun 2027");
    expect(plan.creditLines[0]?.quantity).toBeLessThan(0);
    expect(plan.totals.toCredit).toBeCloseTo(154.95, 2);
    expect(plan.totals.net).toBeCloseTo(-154.95, 2);
    expect(plan.quotesToReplace).toEqual([]);
    expect(plan.periods[1]?.invoiceNumber).toBe("INV-1");
  });

  it("in advance: a draft quote for an open period and for a period after E is replaced", () => {
    const plan = planFinalBalance({
      contract: contract({ invoicedPeriodCount: 1 }),
      lines: [line()],
      periodQuotes: [
        { id: "q0", periodStart: "2027-01-01", periodEnd: "2027-03-31", invoiced: true },
        { id: "q1", periodStart: "2027-04-01", periodEnd: "2027-05-14", invoiced: false },
        { id: "q2", periodStart: "2027-07-01", periodEnd: "2027-09-30", invoiced: false },
      ],
      lastSettledEnd: null,
      usageFor: noUsage,
    });
    expect(plan.quotesToReplace.sort()).toEqual(["q1", "q2"]);
    expect(plan.periods[1]?.status).toBe("quoted");
  });

  it("in arrears: the open period is charged and nothing is credited", () => {
    const plan = planFinalBalance({
      contract: contract({ timing: "in_arrears", invoicedPeriodCount: 1 }),
      lines: [line()],
      periodQuotes: [{ id: "q0", periodStart: "2027-01-01", periodEnd: "2027-03-31", invoiced: true }],
      lastSettledEnd: null,
      usageFor: noUsage,
    });
    expect(plan.openLines).toHaveLength(1);
    expect(plan.creditLines).toEqual([]);
    expect(plan.totals.toInvoice).toBeCloseTo(145.05, 2);
  });

  it("full periods keep today's behaviour (factor 1, multiplier unchanged)", () => {
    const plan = planFinalBalance({
      contract: contract({ endDate: "2027-06-30", invoicedPeriodCount: 1 }),
      lines: [line()],
      periodQuotes: [],
      lastSettledEnd: null,
      usageFor: noUsage,
    });
    expect(plan.periods[1]).toMatchObject({ proRata: false, factor: 1 });
    expect(plan.openLines[0]).toMatchObject({ quantity: 3, unitPrice: 100 });
  });

  it("counter: overage per window with pro rata included volume (with_invoice)", () => {
    const usageFor: UsageProvider = (window) => ({
      usage: window.start === "2027-01-01" ? 1700 : 800,
      issues: [],
      reviewReadingsInPeriod: 0,
    });
    const plan = planFinalBalance({
      contract: contract({ multiplier: 3, invoicedPeriodCount: 1 }),
      lines: [line(), counterLine({ quantity: 500 })],
      periodQuotes: [{ id: "q0", periodStart: "2027-01-01", periodEnd: "2027-03-31", invoiced: true }],
      lastSettledEnd: null,
      usageFor,
    });
    expect(plan.counterWindows.map((w) => w.window)).toEqual([
      { start: "2027-01-01", end: "2027-03-31" },
      { start: "2027-04-01", end: "2027-05-14" },
    ]);
    const first = plan.counterWindows[0]?.counters[0];
    expect(first).toMatchObject({ included: 1500, usage: 1700, overage: 200, overageAmount: 10 });
    const second = plan.counterWindows[1]?.counters[0];
    expect(second?.included).toBeCloseTo((1500 * 44) / 91, 3);
    expect(second?.overage).toBeCloseTo(74.73, 2);
    expect(plan.counterRange).toEqual({ start: "2027-01-01", end: "2027-05-14" });
  });

  it("counter: continues after the last settled end and uses the frequency", () => {
    const seen: string[] = [];
    const usageFor: UsageProvider = (window) => {
      seen.push(`${window.start}..${window.end}`);
      return { usage: 0, issues: [], reviewReadingsInPeriod: 0 };
    };
    planFinalBalance({
      contract: contract({ endDate: "2028-02-10", frequency: "annually", settlementMonth: 1, invoicedPeriodCount: 4 }),
      lines: [counterLine({ quantity: 500 })],
      periodQuotes: [],
      lastSettledEnd: "2026-12-31",
      usageFor,
    });
    expect(seen).toEqual(["2027-01-01..2027-12-31", "2028-01-01..2028-02-10"]);
  });

  it("under-use credit on and off", () => {
    const usageFor: UsageProvider = () => ({ usage: 400, issues: [], reviewReadingsInPeriod: 0 });
    const mk = (creditUnderUse: boolean) =>
      planFinalBalance({
        contract: contract({ endDate: "2027-03-31", multiplier: 1, intervalMonths: 3, invoicedPeriodCount: 1 }),
        lines: [counterLine({ quantity: 1000, unitPrice: 0.02, creditUnderUse })],
        periodQuotes: [],
        lastSettledEnd: null,
        usageFor,
      });
    const off = mk(false);
    expect(off.quoteLines).toEqual([]);
    expect(off.counterWindows[0]?.counters[0]).toMatchObject({ underUse: 600, underUseCreditAmount: 0 });
    const on = mk(true);
    expect(on.quoteLines).toHaveLength(1);
    expect(on.quoteLines[0]).toMatchObject({ kind: "under_use", quantity: -600, unitPrice: 0.02 });
    expect(on.totals).toEqual({ toInvoice: 0, toCredit: 12, net: -12 });
  });

  it("warns about usage issues and a missing overage price", () => {
    const usageFor: UsageProvider = () => ({ usage: 2000, issues: ["no reading at period end for Printer A"], reviewReadingsInPeriod: 2 });
    const plan = planFinalBalance({
      contract: contract({ endDate: "2027-03-31", multiplier: 1, invoicedPeriodCount: 1 }),
      lines: [counterLine({ quantity: 1000, overageUnitPrice: null })],
      periodQuotes: [],
      lastSettledEnd: null,
      usageFor,
    });
    expect(plan.warnings).toEqual([
      "B/W pages: no reading at period end for Printer A",
      "B/W pages: 2 reading(s) in 1 Jan 2027 – 31 Mar 2027 need review and were ignored.",
      "B/W pages: usage exceeds the included quantity but the line has no overage price; no overage line added.",
    ]);
  });

  it("nothing to bill: everything invoiced and settled", () => {
    const plan = planFinalBalance({
      contract: contract({ endDate: "2027-03-31", invoicedPeriodCount: 1 }),
      lines: [line()],
      periodQuotes: [{ id: "q0", periodStart: "2027-01-01", periodEnd: "2027-03-31", invoiced: true }],
      lastSettledEnd: null,
      usageFor: noUsage,
    });
    expect(plan.quoteLines).toEqual([]);
    expect(plan.quotesToReplace).toEqual([]);
    expect(plan.counterWindows).toEqual([]);
    expect(plan.counterRange).toBeNull();
    expect(plan.totals).toEqual({ toInvoice: 0, toCredit: 0, net: 0 });
  });
});

describe("describeSettlementSchedule", () => {
  const input = {
    startDate: "2027-01-01",
    endDate: null,
    timing: "in_advance" as const,
    intervalMonths: 3,
    frequency: "annually" as const,
    settlementMonth: 1,
    invoicedPeriodCount: 2,
    lastSettledEnd: null,
    today: "2027-05-20",
  };

  it("gives next invoice date, next settlement date and current window", () => {
    expect(describeSettlementSchedule(input)).toEqual({
      nextInvoiceDate: "2027-07-01",
      nextSettlementDate: "2028-01-01",
      currentWindow: { start: "2027-01-01", end: "2027-12-31" },
    });
  });

  it("in arrears the invoice date is the day after the period ends", () => {
    expect(describeSettlementSchedule({ ...input, timing: "in_arrears" }).nextInvoiceDate).toBe("2027-10-01");
    expect(describeSettlementSchedule({ ...input, timing: "in_arrears", invoicedPeriodCount: 1 }).nextInvoiceDate).toBe(
      "2027-07-01",
    );
  });

  it("with_invoice: settlement happens with the invoice", () => {
    const s = describeSettlementSchedule({ ...input, frequency: "with_invoice", settlementMonth: null });
    expect(s.nextInvoiceDate).toBe("2027-07-01");
    expect(s.nextSettlementDate).toBe("2027-07-01");
    expect(s.currentWindow).toEqual({ start: "2027-04-01", end: "2027-06-30" });
  });

  it("continues after the last settled window and returns nulls when the contract is over", () => {
    const s = describeSettlementSchedule({ ...input, lastSettledEnd: "2027-12-31" });
    expect(s.currentWindow).toEqual({ start: "2028-01-01", end: "2028-12-31" });
    const over = describeSettlementSchedule({ ...input, endDate: "2027-05-01", invoicedPeriodCount: 2 });
    expect(over.nextInvoiceDate).toBeNull();
  });
});

describe("under-use credit on incomplete data", () => {
  const mk = (usage: Partial<ReturnType<UsageProvider>>) =>
    planFinalBalance({
      contract: contract({ endDate: "2027-03-31", multiplier: 1, intervalMonths: 3, invoicedPeriodCount: 1 }),
      lines: [counterLine({ quantity: 1000, unitPrice: 0.02, creditUnderUse: true })],
      periodQuotes: [],
      lastSettledEnd: null,
      usageFor: () => ({ usage: 400, issues: [], reviewReadingsInPeriod: 0, ...usage }),
    });

  it("emits no under-use credit and warns when readings have issues", () => {
    const plan = mk({ issues: ["no reading at period end for Printer A"] });
    expect(plan.quoteLines).toEqual([]);
    expect(plan.warnings).toContain("B/W pages: under-use not credited because readings are incomplete");
    const counter = plan.counterWindows[0]?.counters[0];
    expect(counter?.underUseCreditAmount).toBe(0);
  });

  it("emits no under-use credit when an asset was skipped", () => {
    const plan = mk({ skippedAssets: 1 });
    expect(plan.quoteLines).toEqual([]);
    expect(plan.warnings).toContain("B/W pages: under-use not credited because readings are incomplete");
  });

  it("still bills overage with incomplete data and records creditedUnderUse 0", () => {
    const plan = mk({ usage: 1500, issues: ["counter went down for Printer B"] });
    expect(plan.quoteLines).toHaveLength(1);
    expect(plan.quoteLines[0]?.kind).toBe("overage");
    expect(counterWindowDetails(plan.counterWindows[0]!)[0]?.creditedUnderUse).toBe(0);
  });

  it("complete data still credits and records the credited quantity", () => {
    const plan = mk({});
    expect(plan.quoteLines[0]).toMatchObject({ kind: "under_use", quantity: -600 });
    expect(counterWindowDetails(plan.counterWindows[0]!)[0]?.creditedUnderUse).toBe(600);
  });
});
