import { describe, expect, it } from "vitest";
import {
  computeCounterUsage,
  computeWindowedCounterUsage,
  computeOverage,
  contractPeriodByIndex,
  describeOverage,
  isPeriodQuoteDue,
  planSettlementPeriod,
  type CounterReading,
} from "./counter-settlement";

const A = { id: "a", name: "Printer A" };
const B = { id: "b", name: "Printer B" };

function reading(assetId: string, readAt: string, value: number, needsReview = false): CounterReading {
  return { assetId, readAt, value, needsReview };
}

describe("computeCounterUsage", () => {
  it("uses the latest reading at/before the period start and end", () => {
    const result = computeCounterUsage(
      [A],
      [
        reading("a", "2026-12-15T10:00:00Z", 50), // before start, older
        reading("a", "2026-12-31T10:00:00Z", 100), // latest before start
        reading("a", "2027-01-10T10:00:00Z", 150), // in period, older than end
        reading("a", "2027-03-31T18:00:00Z", 400), // last day of the period counts
        reading("a", "2027-04-02T10:00:00Z", 900), // after the period, ignored
      ],
      "2027-01-01",
      "2027-03-31",
    );
    expect(result.usage).toBe(300);
    expect(result.issues).toEqual([]);
  });

  it("reports missing start and end readings and skips that asset", () => {
    const result = computeCounterUsage(
      [A, B],
      [reading("a", "2027-02-01T10:00:00Z", 10), reading("b", "2026-12-01T10:00:00Z", 5)],
      "2027-01-01",
      "2027-01-31",
    );
    expect(result.usage).toBe(0);
    expect(result.issues).toContain("no reading at period start for Printer A");
    expect(result.issues).toContain("no reading at period end for Printer A");
    expect(result.issues).not.toContain("no reading at period end for Printer B");
    // B: start and end resolve to the same (old) reading -> usage 0, no issue.
    expect(result.issues.filter((m) => m.includes("Printer B"))).toEqual([]);
  });

  it("sums multiple assets", () => {
    const result = computeCounterUsage(
      [A, B],
      [
        reading("a", "2026-12-31T00:00:00Z", 10),
        reading("a", "2027-01-31T00:00:00Z", 40),
        reading("b", "2026-12-31T00:00:00Z", 100),
        reading("b", "2027-01-31T00:00:00Z", 125.5),
      ],
      "2027-01-01",
      "2027-01-31",
    );
    expect(result.usage).toBe(55.5);
  });

  it("ignores needs_review readings and counts those inside the period", () => {
    const result = computeCounterUsage(
      [A],
      [
        reading("a", "2026-12-31T00:00:00Z", 10),
        reading("a", "2027-01-15T00:00:00Z", 9999, true),
        reading("a", "2027-01-31T00:00:00Z", 30),
      ],
      "2027-01-01",
      "2027-01-31",
    );
    expect(result.usage).toBe(20);
    expect(result.reviewReadingsInPeriod).toBe(1);
  });

  it("does not count review readings outside the period", () => {
    const result = computeCounterUsage(
      [A],
      [reading("a", "2026-11-01T00:00:00Z", 1, true), reading("a", "2026-12-31T00:00:00Z", 10), reading("a", "2027-01-31T00:00:00Z", 12)],
      "2027-01-01",
      "2027-01-31",
    );
    expect(result.reviewReadingsInPeriod).toBe(0);
  });

  it("counts a reading on the baseline date as baseline (first period)", () => {
    const result = computeCounterUsage(
      [A],
      [
        reading("a", "2027-01-01T15:00:00Z", 100), // on the contract start date
        reading("a", "2027-03-31T10:00:00Z", 160),
      ],
      "2027-01-01",
      "2027-03-31",
      new Map([["a", "2027-01-01"]]),
    );
    expect(result.usage).toBe(60);
    expect(result.issues).toEqual([]);
  });

  it("uses the added date as baseline for an asset added mid-period", () => {
    const result = computeCounterUsage(
      [A],
      [
        reading("a", "2026-12-01T00:00:00Z", 10),
        reading("a", "2027-02-10T09:00:00Z", 50), // on the added date
        reading("a", "2027-03-31T10:00:00Z", 80),
      ],
      "2027-01-01",
      "2027-03-31",
      new Map([["a", "2027-02-10"]]),
    );
    expect(result.usage).toBe(30);
  });

  it("keeps the period start for later periods (baseline before the period)", () => {
    const result = computeCounterUsage(
      [A],
      [reading("a", "2027-03-31T20:00:00Z", 100), reading("a", "2027-06-30T10:00:00Z", 130)],
      "2027-04-01",
      "2027-06-30",
      new Map([["a", "2027-01-01"]]),
    );
    expect(result.usage).toBe(30);
  });

  it("reports a missing baseline reading and ignores an asset added after the period", () => {
    const result = computeCounterUsage(
      [A, B],
      [reading("a", "2027-03-31T10:00:00Z", 80), reading("b", "2027-06-01T00:00:00Z", 5)],
      "2027-01-01",
      "2027-03-31",
      new Map([
        ["a", "2027-01-01"],
        ["b", "2027-05-01"],
      ]),
    );
    expect(result.issues).toEqual(["no reading at period start for Printer A"]);
    expect(result.usage).toBe(0);
  });

  it("rejects negative usage (counter reset) with a message and does not count the asset", () => {
    const result = computeCounterUsage(
      [A, B],
      [
        reading("a", "2026-12-31T00:00:00Z", 900),
        reading("a", "2027-01-31T00:00:00Z", 20),
        reading("b", "2026-12-31T00:00:00Z", 0),
        reading("b", "2027-01-31T00:00:00Z", 7),
      ],
      "2027-01-01",
      "2027-01-31",
    );
    expect(result.usage).toBe(7);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain("Printer A");
    expect(result.issues[0]).toContain("reset");
  });
});

describe("overage", () => {
  it("is zero when usage is within the included quantity", () => {
    expect(computeOverage(80, 100)).toBe(0);
    expect(computeOverage(100, 100)).toBe(0);
  });

  it("is the excess above the included quantity", () => {
    expect(computeOverage(130.5, 100)).toBe(30.5);
  });

  it("describes the overage line", () => {
    expect(describeOverage("B/W prints", 130, 100, 30, "1 Jan 2027 – 31 Mar 2027")).toBe(
      "B/W prints – usage 130, included 100, overage 30 (1 Jan 2027 – 31 Mar 2027)",
    );
  });
});

describe("settlement period planning", () => {
  const base = {
    contractStart: "2027-01-01",
    contractEnd: "2027-12-31" as string | null,
    intervalMonths: 3 as number | null,
  };

  it("in arrears settles the invoiced period itself", () => {
    const invoicedPeriod = { start: "2027-04-01", end: "2027-06-30" };
    expect(planSettlementPeriod({ ...base, timing: "in_arrears", invoicedPeriod, invoicedPeriodCount: 1 })).toEqual(
      invoicedPeriod,
    );
  });

  it("in advance has no settlement for the first quote", () => {
    expect(
      planSettlementPeriod({
        ...base,
        timing: "in_advance",
        invoicedPeriod: { start: "2027-01-01", end: "2027-03-31" },
        invoicedPeriodCount: 0,
      }),
    ).toBeNull();
  });

  it("in advance settles the previous period", () => {
    expect(
      planSettlementPeriod({
        ...base,
        timing: "in_advance",
        invoicedPeriod: { start: "2027-07-01", end: "2027-09-30" },
        invoicedPeriodCount: 2,
      }),
    ).toEqual({ start: "2027-04-01", end: "2027-06-30" });
  });

  it("caps the last period at the contract end date", () => {
    expect(contractPeriodByIndex("2027-01-01", 1, 3, "2027-12-31")).toEqual({ start: "2027-04-01", end: "2027-06-30" });
    expect(contractPeriodByIndex("2027-01-01", 3, 3, "2027-11-15")).toEqual({ start: "2027-10-01", end: "2027-11-15" });
  });

  it("decides when a period quote is due", () => {
    const period = { start: "2027-01-01", end: "2027-03-31" };
    expect(isPeriodQuoteDue("in_advance", period, "2027-01-01")).toBe(true);
    expect(isPeriodQuoteDue("in_arrears", period, "2027-03-31")).toBe(false);
    expect(isPeriodQuoteDue("in_arrears", period, "2027-04-01")).toBe(true);
  });
});

describe("computeWindowedCounterUsage (issue #274)", () => {
  const period = ["2027-01-01", "2027-03-31"] as const;

  it("counts a removed asset up to its removal date and nothing after", () => {
    const result = computeWindowedCounterUsage(
      [A],
      [{ assetId: "a", start: "2026-06-01", end: "2027-02-15" }],
      [
        reading("a", "2026-12-31T10:00:00Z", 100), // start of period
        reading("a", "2027-02-15T12:00:00Z", 160), // closing reading on the removal date
        reading("a", "2027-03-20T10:00:00Z", 900), // after removal: must not count
      ],
      ...period,
    );
    expect(result.usage).toBe(60);
    expect(result.issues).toEqual([]);
  });

  it("reports a missing closing reading as a removal-date issue", () => {
    const result = computeWindowedCounterUsage(
      [A],
      [{ assetId: "a", start: "2026-06-01", end: "2027-02-15" }],
      [reading("a", "2026-12-31T10:00:00Z", 100)],
      ...period,
    );
    // the latest reading at/before the removal date is the start reading itself: usage 0, no issue
    expect(result.usage).toBe(0);
    expect(result.issues).toEqual([]);
    const none = computeWindowedCounterUsage([A], [{ assetId: "a", start: "2027-01-10", end: "2027-02-15" }], [], ...period);
    expect(none.issues).toContain("no reading at removal date for Printer A");
  });

  it("skips a window that ended before the period started", () => {
    const result = computeWindowedCounterUsage(
      [A],
      [{ assetId: "a", start: "2026-06-01", end: "2026-12-31" }],
      [reading("a", "2026-12-31T12:00:00Z", 100), reading("a", "2027-03-31T12:00:00Z", 500)],
      ...period,
    );
    expect(result.usage).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("counts a re-added asset per window (gap in between does not count)", () => {
    const result = computeWindowedCounterUsage(
      [A],
      [
        { assetId: "a", start: "2026-06-01", end: "2027-01-31" },
        { assetId: "a", start: "2027-03-01", end: null },
      ],
      [
        reading("a", "2026-12-31T10:00:00Z", 100),
        reading("a", "2027-01-31T12:00:00Z", 130), // closing of window 1: +30
        reading("a", "2027-02-20T10:00:00Z", 400), // gap: not covered
        reading("a", "2027-03-01T08:00:00Z", 410), // baseline of window 2 (end of day boundary below)
        reading("a", "2027-03-31T12:00:00Z", 450),
      ],
      ...period,
    );
    // window 1: 130 - 100 = 30; window 2: start boundary = end of 2027-03-01 -> 410, end 450 -> 40
    expect(result.usage).toBe(70);
  });

  it("behaves like computeCounterUsage for open windows", () => {
    const readings = [reading("a", "2026-12-31T10:00:00Z", 100), reading("a", "2027-03-31T10:00:00Z", 250)];
    const legacy = computeCounterUsage([A], readings, ...period);
    const windowed = computeWindowedCounterUsage([A], [{ assetId: "a", start: null, end: null }], readings, ...period);
    expect(windowed).toEqual(legacy);
  });
});
