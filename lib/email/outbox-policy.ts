/**
 * Pure policy for the e-mail outbox processor (issue #268): retry/backoff,
 * error classification and throttle arithmetic. No I/O, no server-only
 * import, so it is unit-tested directly (outbox-policy.test.ts).
 */

/** Total number of send attempts (the claim increments `attempts` before sending). */
export const MAX_ATTEMPTS = 5;

const MINUTE_MS = 60_000;
/** Wait after failed attempt 1, 2, 3, 4 (a 5th failure is final). */
export const BACKOFF_MS: readonly number[] = [1 * MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS, 60 * MINUTE_MS];

export interface SendFailure {
  /** HTTP status of the provider response; null for network errors / no response. */
  status: number | null;
  message: string;
  /** Never retry (e.g. the provider is not configured). */
  permanent?: boolean;
}

/** 429, 5xx and network errors are transient; every other 4xx is final. */
export function isRetryable(failure: Pick<SendFailure, "status" | "permanent">): boolean {
  if (failure.permanent) return false;
  if (failure.status === null) return true;
  return failure.status === 429 || failure.status >= 500;
}

/** Delay before the next try after failed attempt `attempts` (1-based); null when no retry is left. */
export function backoffDelayMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const index = Math.max(attempts, 1) - 1;
  return BACKOFF_MS[index] ?? null;
}

export function readableFailureReason(failure: SendFailure): string {
  const message = failure.message.trim();
  if (failure.status === null || failure.permanent) return message || "E-mail could not be sent";
  if (failure.status === 429) return `The e-mail provider rate limit was reached: ${message}`;
  if (failure.status >= 500) return `The e-mail provider had a temporary error (HTTP ${failure.status}): ${message}`;
  return `The e-mail provider rejected the message (HTTP ${failure.status}): ${message}`;
}

export type FailureDecision =
  | { action: "retry"; retryAt: Date; error: string }
  | { action: "fail"; error: string };

/** What to do after a failed attempt; `attempts` is the claimed attempt number (>= 1). */
export function decideAfterFailure(failure: SendFailure, attempts: number, now: Date): FailureDecision {
  const error = readableFailureReason(failure);
  if (!isRetryable(failure)) return { action: "fail", error };
  const delay = backoffDelayMs(attempts);
  if (delay === null) return { action: "fail", error: `${error} (gave up after ${MAX_ATTEMPTS} attempts)` };
  return { action: "retry", retryAt: new Date(now.getTime() + delay), error };
}

/**
 * A reclaimed stale 'sending' row (processor died mid-send) has had its
 * attempts incremented by the claim; once that exceeds MAX_ATTEMPTS it fails
 * instead of being sent again.
 */
export function exceedsAttemptLimit(claimedAttempts: number): boolean {
  return claimedAttempts > MAX_ATTEMPTS;
}

/** Parses a positive integer env value; undefined/empty/invalid -> fallback. */
export function parseLimit(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export interface ThrottleConfig {
  maxPerSecond: number;
  /** null = unlimited. */
  maxPerHour: number | null;
  maxPerDay: number | null;
}

/** Minimum pause between two sends so that at most `maxPerSecond` go out per second. */
export function minIntervalMs(maxPerSecond: number): number {
  return Math.ceil(1000 / Math.max(maxPerSecond, 0.001));
}

/** Milliseconds to wait before the next send (0 = go now). */
export function waitBeforeNextSendMs(lastSendAtMs: number | null, nowMs: number, maxPerSecond: number): number {
  if (lastSendAtMs === null) return 0;
  return Math.max(0, lastSendAtMs + minIntervalMs(maxPerSecond) - nowMs);
}

export type LimitCheck = { allowed: true } | { allowed: false; reason: "hour" | "day" };

/** Whether another mail may be sent given what was already sent in the last hour / day. */
export function checkWindowLimits(config: ThrottleConfig, sentLastHour: number, sentLastDay: number): LimitCheck {
  if (config.maxPerDay !== null && sentLastDay >= config.maxPerDay) return { allowed: false, reason: "day" };
  if (config.maxPerHour !== null && sentLastHour >= config.maxPerHour) return { allowed: false, reason: "hour" };
  return { allowed: true };
}
