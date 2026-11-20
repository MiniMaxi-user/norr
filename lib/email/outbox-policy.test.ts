import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  backoffDelayMs,
  checkWindowLimits,
  decideAfterFailure,
  exceedsAttemptLimit,
  isRetryable,
  minIntervalMs,
  parseLimit,
  readableFailureReason,
  waitBeforeNextSendMs,
} from "./outbox-policy";

const MIN = 60_000;
const now = new Date("2026-11-22T10:00:00.000Z");

describe("isRetryable", () => {
  it("retries 429, 5xx and network errors", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: null })).toBe(true);
  });
  it("fails other 4xx and permanent errors immediately", () => {
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 422 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: null, permanent: true })).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("is 1 min, 5 min, 15 min, 1 h and then gives up", () => {
    expect(backoffDelayMs(1)).toBe(1 * MIN);
    expect(backoffDelayMs(2)).toBe(5 * MIN);
    expect(backoffDelayMs(3)).toBe(15 * MIN);
    expect(backoffDelayMs(4)).toBe(60 * MIN);
    expect(backoffDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(backoffDelayMs(9)).toBeNull();
  });
});

describe("decideAfterFailure", () => {
  it("schedules a retry with the backoff for a 429", () => {
    const decision = decideAfterFailure({ status: 429, message: "Too many requests" }, 1, now);
    expect(decision.action).toBe("retry");
    if (decision.action === "retry") expect(decision.retryAt.getTime()).toBe(now.getTime() + MIN);
  });
  it("uses the longer delay on later attempts", () => {
    const decision = decideAfterFailure({ status: 502, message: "bad gateway" }, 4, now);
    expect(decision.action === "retry" && decision.retryAt.getTime()).toBe(now.getTime() + 60 * MIN);
  });
  it("fails after the 5th attempt", () => {
    const decision = decideAfterFailure({ status: 500, message: "boom" }, 5, now);
    expect(decision.action).toBe("fail");
    expect(decision.action === "fail" && decision.error).toContain("gave up after 5 attempts");
  });
  it("fails a 4xx immediately with a readable reason", () => {
    const decision = decideAfterFailure({ status: 422, message: "Invalid to field" }, 1, now);
    expect(decision).toEqual({
      action: "fail",
      error: "The e-mail provider rejected the message (HTTP 422): Invalid to field",
    });
  });
  it("retries network errors", () => {
    expect(decideAfterFailure({ status: null, message: "fetch failed" }, 2, now).action).toBe("retry");
  });
});

describe("readableFailureReason", () => {
  it("passes configuration/network messages through", () => {
    expect(readableFailureReason({ status: null, message: "fetch failed" })).toBe("fetch failed");
  });
});

describe("exceedsAttemptLimit", () => {
  it("only fails reclaimed rows past the limit", () => {
    expect(exceedsAttemptLimit(5)).toBe(false);
    expect(exceedsAttemptLimit(6)).toBe(true);
  });
});

describe("parseLimit", () => {
  it("parses positive integers and falls back otherwise", () => {
    expect(parseLimit("100", null)).toBe(100);
    expect(parseLimit(undefined, 1)).toBe(1);
    expect(parseLimit("", null)).toBeNull();
    expect(parseLimit("abc", 1)).toBe(1);
    expect(parseLimit("0", 1)).toBe(1);
    expect(parseLimit("-5", null)).toBeNull();
  });
});

describe("throttle", () => {
  it("derives the minimum interval", () => {
    expect(minIntervalMs(1)).toBe(1000);
    expect(minIntervalMs(2)).toBe(500);
    expect(minIntervalMs(3)).toBe(334);
  });
  it("waits the remainder of the interval", () => {
    expect(waitBeforeNextSendMs(null, 5000, 1)).toBe(0);
    expect(waitBeforeNextSendMs(5000, 5300, 1)).toBe(700);
    expect(waitBeforeNextSendMs(5000, 7000, 1)).toBe(0);
    expect(waitBeforeNextSendMs(5000, 5100, 2)).toBe(400);
  });
  it("stops at the hour and day limits", () => {
    const config = { maxPerSecond: 1, maxPerHour: 10, maxPerDay: 50 };
    expect(checkWindowLimits(config, 9, 49)).toEqual({ allowed: true });
    expect(checkWindowLimits(config, 10, 20)).toEqual({ allowed: false, reason: "hour" });
    expect(checkWindowLimits(config, 3, 50)).toEqual({ allowed: false, reason: "day" });
    expect(checkWindowLimits({ maxPerSecond: 1, maxPerHour: null, maxPerDay: null }, 9999, 9999)).toEqual({ allowed: true });
  });
});
