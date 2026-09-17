"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Callout, EmptyState, Heading, Inline, Skeleton, Stack, Text } from "@yourorg/ui";
import { AlertTriangle } from "@yourorg/ui/icons";
import {
  clearSyncedWorkOrderData,
  getCachedTimeRoundingSettings,
  getCachedWorkOrderDetail,
  getClockPeriodsForOrder,
  getLocalArticles,
  getLocalDraft,
  getLocalPhotos,
  getLocalSignOff,
  markSignOffSynced,
  saveCachedTimeRoundingSettings,
  saveLocalDraft,
  saveLocalSignOff,
  saveWorkOrderDetail,
  type ClockPeriod,
  type LocalArticle,
  type LocalPhoto,
  type LocalSignOff,
} from "@/lib/offline/db";
import { computeClockSummary, finishWorkOrderClock, toggleClock, type ClockKind } from "@/lib/time/clocks";
import type { TimeRoundingSettings, WorkOrderDetailResponse } from "@/lib/work-orders/types";
import { TimerCard } from "./timer-card";
import { HomeSection } from "./sections/home-section";
import { WorkSection } from "./sections/work-section";
import { HoursSection } from "./sections/hours-section";
import { ArticlesSection } from "./sections/articles-section";
import { PhotosSection } from "./sections/photos-section";
import { SignOffSection } from "./sections/sign-off-section";

export type WorkOrderSection = "home" | "work" | "hours" | "articles" | "photos" | "sign";

function isSection(value: string | null): value is WorkOrderSection {
  return (
    value === "home" || value === "work" || value === "hours" || value === "articles" || value === "photos" || value === "sign"
  );
}

/** `"14:32"`, reused from `today-screen.tsx`'s own one-liner — see that
 * file's doc comment on why this is a deliberate small reimplementation
 * rather than a shared import. */
function formatTimeLabel(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The work-order detail screen (issue #170, IMPLEMENTATION.md §4) — owns
 * the real, server-backed read (`/api/work-orders/[id]`), this device's
 * local timer/articles/photos/sign-off state, and the active bottom-bar
 * section (`?section=`, read directly via `useSearchParams()` — see
 * `page.tsx`'s own doc comment on why that's a client-side read rather than
 * a prop from the server page).
 *
 * Product feedback (2026-09-12) added an offline-read fallback for the
 * detail fetch itself, same shape as `today-screen.tsx`'s own fallback
 * for the day's list: a successful fetch caches the response
 * (`lib/offline/db.ts`'s `workOrderDetails`); a failed one falls back to
 * that cache (with a "couldn't refresh" notice) instead of the bare
 * error state this screen originally showed for every offline open —
 * opening a work order you've already looked at today has to work
 * without a network the same way the Today list already does. A work
 * order that's never been opened on this device still can't be opened
 * offline — there's nothing to fall back to. What already worked with
 * zero network regardless — starting/stopping the timer, adding
 * articles/photos, signing off — is all local-only (`lib/offline/db.ts`),
 * and none of that depends on this fetch succeeding.
 */
export function WorkOrderDetailScreen({
  workOrderId,
  currentUserId,
  engineerName,
}: {
  workOrderId: string;
  currentUserId: string;
  engineerName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const section: WorkOrderSection = isSection(searchParams.get("section")) ? (searchParams.get("section") as WorkOrderSection) : "home";

  const [detail, setDetail] = useState<WorkOrderDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailOffline, setDetailOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  // Issue #198 — the org-level cache (`lib/offline/db.ts`'s `meta` key, NOT
  // tied to this specific work order), read alongside `detail` below so
  // `HoursSection` can show NET durations. `null` until the first
  // successful read (either this load's own live/cached path, or an
  // earlier Today-screen sync already populated it) — `HoursSection` falls
  // back to a safe no-op rounding rule on `null`, never blocks on it.
  const [roundingSettings, setRoundingSettings] = useState<TimeRoundingSettings | null>(null);

  const [periods, setPeriods] = useState<ClockPeriod[]>([]);
  const [localArticles, setLocalArticles] = useState<LocalArticle[]>([]);
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [signOff, setSignOff] = useState<LocalSignOff | null>(null);
  // Lifted out of `SignOffSection` (product feedback, 2026-09-13 — "Solution"
  // now lives on the Work tab, under Description) so it survives switching
  // between sections instead of being local state a Sign-tab-only component
  // would lose the moment the engineer taps away.
  const [solution, setSolution] = useState("");
  // Same lift, for the same reason (product feedback, 2026-09-13: the
  // signature drawn on the canvas was lost every time the engineer switched
  // away from the Sign tab and back, since `SignaturePad`'s canvas unmounts
  // with it). `SignOffSection` pushes a fresh `toDataUrl()` snapshot up here
  // every 500ms while mounted; `SignaturePad` reads it back as its
  // `initialDataUrl` on remount, so a tab switch mid-signature loses at most
  // the last half-second of drawing instead of the whole thing.
  const [signatureDraft, setSignatureDraft] = useState<string | null>(null);
  // Bug report, 2026-09-13: lifting `solution`/`signatureDraft` into THIS
  // component's state (above) only survives switching TABS — it's all still
  // plain React state, gone the moment this whole screen unmounts (tapping
  // Today in the bottom bar, then reopening the same work order later).
  // Guards the autosave effect below from firing on the initial state
  // set from `getLocalDraft`/`getLocalSignOff` — without it, that first
  // set would immediately re-save the exact values it just read.
  const draftLoadedRef = useRef(false);

  // `now` only ticks while a period on THIS order is actually running
  // (IMPLEMENTATION.md §5: "de interval hoeft alleen te tikken als er
  // daadwerkelijk iets loopt") — everywhere else, elapsed time is computed
  // once from `periods` + this same `now`, never accumulated.
  const [now, setNow] = useState(() => Date.now());

  const refreshPeriods = useCallback(async () => {
    const rows = await getClockPeriodsForOrder(workOrderId, currentUserId);
    setPeriods(rows);
    setNow(Date.now());
  }, [workOrderId, currentUserId]);

  const refreshArticles = useCallback(async () => {
    setLocalArticles(await getLocalArticles(workOrderId, currentUserId));
  }, [workOrderId, currentUserId]);

  const refreshPhotos = useCallback(async () => {
    setLocalPhotos(await getLocalPhotos(workOrderId, currentUserId));
  }, [workOrderId, currentUserId]);

  useEffect(() => {
    let cancelled = false;
    draftLoadedRef.current = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/work-orders/${workOrderId}`);
        if (!response.ok) {
          throw new Error(response.status === 404 ? "Work order not found." : "Failed to load work order.");
        }
        const data = (await response.json()) as WorkOrderDetailResponse;
        await saveWorkOrderDetail(workOrderId, data, currentUserId);
        await saveCachedTimeRoundingSettings(data.timeRoundingSettings, currentUserId);
        if (!cancelled) {
          setDetail(data);
          setDetailError(null);
          setDetailOffline(false);
          setRoundingSettings(data.timeRoundingSettings);
        }
      } catch (error) {
        // Any failure (offline, or a real server error) falls back to
        // whatever this device cached the last time this order loaded
        // successfully — never a bare error screen when there's a cache to
        // show instead, same "never a bare error screen" reasoning as the
        // Today list's own sync (`today-screen.tsx`).
        const [cached, cachedRounding] = await Promise.all([
          getCachedWorkOrderDetail(workOrderId, currentUserId),
          getCachedTimeRoundingSettings(currentUserId),
        ]);
        if (!cancelled) {
          if (cached) {
            setDetail(cached.detail);
            setDetailError(null);
            setDetailOffline(true);
          } else {
            setDetailError(error instanceof Error ? error.message : "Failed to load work order.");
          }
          setRoundingSettings(cachedRounding);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    void refreshPeriods();
    void refreshArticles();
    void refreshPhotos();
    void Promise.all([
      getLocalSignOff(workOrderId, currentUserId),
      getLocalDraft(workOrderId, currentUserId),
    ]).then(([signOffRow, draftRow]) => {
      if (cancelled) return;
      setSignOff(signOffRow);
      // The draft (autosaved continuously) wins over a leftover sign-off
      // row when both exist — that only happens after a Finish attempt
      // that saved the sign-off but then failed the server POST (see
      // `handleFinish`), and the draft is always at least as recent.
      setSolution(draftRow?.solution ?? signOffRow?.solution ?? "");
      setSignatureDraft(draftRow?.signatureDataUrl ?? signOffRow?.signatureDataUrl ?? null);
      draftLoadedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, currentUserId, refreshPeriods, refreshArticles, refreshPhotos]);

  // Autosaves `solution`/`signatureDraft` to IndexedDB on a short debounce
  // (bug report, 2026-09-13) — see `draftLoadedRef`'s own comment above for
  // why it's guarded until the initial load has run.
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const timeout = setTimeout(() => {
      void saveLocalDraft({
        workOrderId,
        userId: currentUserId,
        solution: solution || null,
        signatureDataUrl: signatureDraft,
      });
    }, 600);
    return () => clearTimeout(timeout);
  }, [workOrderId, currentUserId, solution, signatureDraft]);

  const summary = useMemo(() => computeClockSummary(periods, now), [periods, now]);

  useEffect(() => {
    if (!summary.runningKind) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [summary.runningKind]);

  const handleToggle = useCallback(
    async (kind: ClockKind) => {
      await toggleClock(workOrderId, kind, currentUserId, Date.now());
      await refreshPeriods();
    },
    [workOrderId, currentUserId, refreshPeriods],
  );

  /**
   * Finish workitem (product feedback, 2026-09-12 — supersedes the
   * original "Finish work order"/"Send work receipt" two-label design):
   * closes this order's running clock, records the local sign-off
   * locally, and — unlike every other #170 mutation, which stays local-
   * only per that issue's scope boundary — flushes this order's logged
   * periods and locally-added articles to the server as real
   * `time_entries`/`work_order_articles` rows and marks the work order
   * `completed` (`POST /api/work-orders/[id]/finish`). Finishing is the
   * one action that has to be visible elsewhere in the app (e.g. the
   * desktop planner's board showing the hours/articles this job actually
   * took), so it's also the one moment this story does a real sync
   * instead of staying purely local. Only navigates back to Today once
   * that server call actually succeeds — on failure (most likely
   * offline), the error propagates to `SignOffSection`, which shows it
   * and leaves the engineer on this screen (periods/articles stay in
   * their local tables, nothing is lost) so nothing silently vanishes.
   *
   * Bug report, 2026-09-13: failure here used to be a dead end — the local
   * sign-off row was already written, so the Today list showed "Signed"
   * forever with no way for the server (desktop webapp, invoicing, other
   * engineers) to ever actually receive the hours/articles/completion, and
   * nothing retried. The sign-off row now carries `pendingSync: true` from
   * the moment it's written until this POST actually succeeds (`
   * lib/offline/retry-finish.ts` retries every such row on `online`/
   * Today-mount); `today-screen.tsx` badges the card in the meantime so the
   * engineer can see a job hasn't actually synced yet.
   */
  const handleFinish = useCallback(
    async (signatureDataUrl: string | null) => {
      const timestamp = Date.now();
      const trimmedSolution = solution.trim() ? solution.trim() : null;
      await finishWorkOrderClock(workOrderId, currentUserId, timestamp);
      if (signatureDataUrl || trimmedSolution) {
        await saveLocalSignOff({
          workOrderId,
          userId: currentUserId,
          signedAt: timestamp,
          signatureDataUrl: signatureDataUrl ?? "",
          solution: trimmedSolution,
          pendingSync: true,
        });
      }
      // Re-read after finishWorkOrderClock above so the just-closed
      // running period is included (`endedAt` is no longer null) — the
      // server route only accepts closed periods.
      const [finalPeriods, finalArticles] = await Promise.all([
        getClockPeriodsForOrder(workOrderId, currentUserId),
        getLocalArticles(workOrderId, currentUserId),
      ]);
      const response = await fetch(`/api/work-orders/${workOrderId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periods: finalPeriods
            .filter((period) => period.endedAt !== null)
            .map((period) => ({ kind: period.kind, startedAt: period.startedAt, endedAt: period.endedAt })),
          articles: finalArticles.map((article) => ({ articleId: article.articleId, quantity: article.quantity })),
          solution: trimmedSolution,
        }),
      });
      if (!response.ok) {
        throw new Error("Couldn't mark this work order as completed. Check your connection and try again.");
      }
      // The server now has these periods/articles for good — clear the
      // local copies so a later re-tap/reopen can't resend (and
      // double-insert) them (QA finding, 2026-09-13).
      await clearSyncedWorkOrderData(workOrderId, currentUserId);
      // Flips the sign-off's `pendingSync` off now that the POST above
      // actually landed — a no-op if this order had neither a signature
      // nor a solution (no `signoffs` row was ever written), see
      // `markSignOffSynced`'s own doc comment.
      await markSignOffSynced(workOrderId);
      router.push("/today");
    },
    [workOrderId, currentUserId, router, solution],
  );

  if (loading) {
    return (
      <Stack gap="md">
        <Skeleton height={24} />
        <Skeleton height={48} />
        <Skeleton height={120} />
        <Skeleton height={200} />
      </Stack>
    );
  }

  if (detailError || !detail) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        heading="Couldn't load this work order."
        text={detailError ?? "Try again once you're back online."}
      />
    );
  }

  const { workOrder } = detail;
  const addressParts = [workOrder.site?.addressLine1, workOrder.site?.city].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <Stack gap="md">
      {detailOffline && (
        <Callout icon={AlertTriangle}>{"Showing the last synced copy of this work order — couldn't refresh."}</Callout>
      )}

      <Inline gap="sm" align="center" wrap>
        {workOrder.status && <Badge color={workOrder.status.color}>{workOrder.status.label}</Badge>}
        <Text tone="muted">{workOrder.scheduledAt ? formatTimeLabel(workOrder.scheduledAt) : "No time scheduled"}</Text>
      </Inline>

      <Stack gap="xs">
        <Heading level={1} style={{ fontFamily: "var(--ui-font-serif)" }}>
          {workOrder.title}
        </Heading>
        <Text tone="muted">
          {workOrder.client?.name ?? "Unknown client"}
          {addressParts.length > 0 ? ` · ${addressParts.join(", ")}` : ""}
        </Text>
      </Stack>

      {section === "home" && <HomeSection workOrder={workOrder} />}
      {section === "work" && <WorkSection workOrder={workOrder} solution={solution} onSolutionChange={setSolution} />}
      {section === "hours" && (
        <>
          {/* Start/stop only shows on the Hours tab (product feedback,
              2026-09-13) — see `timer-card.tsx`'s own doc comment. */}
          <TimerCard
            summary={summary}
            onToggleTravel={() => void handleToggle("travel")}
            onToggleWork={() => void handleToggle("work")}
          />
          <HoursSection
            periods={periods}
            serverTimeEntries={detail.timeEntries}
            onPeriodsChange={refreshPeriods}
            roundingSettings={roundingSettings}
          />
        </>
      )}
      {section === "articles" && (
        <ArticlesSection
          workOrderId={workOrderId}
          currentUserId={currentUserId}
          serverArticles={detail.articles}
          localArticles={localArticles}
          onLocalArticlesChange={refreshArticles}
        />
      )}
      {section === "photos" && (
        <PhotosSection
          workOrderId={workOrderId}
          currentUserId={currentUserId}
          photos={localPhotos}
          onPhotosChange={refreshPhotos}
        />
      )}
      {section === "sign" && (
        <SignOffSection
          summary={summary}
          articleCount={detail.articles.length + localArticles.length}
          engineerName={engineerName}
          existingSignOff={signOff}
          signatureDraft={signatureDraft}
          onSignatureDraftChange={setSignatureDraft}
          onFinish={handleFinish}
        />
      )}
    </Stack>
  );
}
