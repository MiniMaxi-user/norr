import { describe, expect, it } from "vitest";
import { computeCounterUsage, computeOverage, describeOverage, type CounterReading } from "./counter-settlement";

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
