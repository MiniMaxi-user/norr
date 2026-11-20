import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processEmailOutbox } from "@/lib/email/outbox";

/**
 * Safety-net run of the e-mail outbox processor (issue #268): picks up whatever
 * the direct `after()` kick left behind (time-outs, retry backoffs that came
 * due, an hour/day limit that has reset).
 *
 * Schedule (vercel.json): DAILY, because the project may be on Vercel Hobby,
 * which only allows daily crons. On Vercel Pro set a more frequent schedule,
 * e.g. every 5 minutes: "*\/5 * * * *". Until then the `after()` processing
 * right after queueing does most of the work.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the
 * CRON_SECRET env var is set. Without the secret configured the route refuses
 * every request. Not behind a user session (the middleware only refreshes
 * cookies, it never redirects).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await processEmailOutbox();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[cron/email-outbox] failed", error);
    return NextResponse.json({ error: "Processor failed" }, { status: 500 });
  }
}
