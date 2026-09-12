"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, EmptyState, Heading, Inline, Skeleton, Stack, Text } from "@yourorg/ui";
import { AlertTriangle } from "@yourorg/ui/icons";
import {
  getClockPeriodsForOrder,
  getLocalArticles,
  getLocalPhotos,
  getLocalSignOff,
  saveLocalSignOff,
  type ClockPeriod,
  type LocalArticle,
  type LocalPhoto,
  type LocalSignOff,
} from "@/lib/offline/db";
import { computeClockSummary, finishWorkOrderClock, toggleClock, type ClockKind } from "@/lib/time/clocks";
import type { WorkOrderDetailResponse } from "@/lib/work-orders/types";
import { TimerCard } from "./timer-card";
import { WorkSection } from "./sections/work-section";
import { HoursSection } from "./sections/hours-section";
import { ArticlesSection } from "./sections/articles-section";
import { PhotosSection } from "./sections/photos-section";
import { SignOffSection } from "./sections/sign-off-section";

export type WorkOrderSection = "details" | "hours" | "articles" | "photos" | "sign";

function isSection(value: string | null): value is WorkOrderSection {
  return value === "details" || value === "hours" || value === "articles" || value === "photos" || value === "sign";
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
 * Deliberately does NOT fall back to an offline-cached copy of the detail
 * itself the way `today-screen.tsx` does for the day's list — issue #170's
 * scope is explicit that the real/server-backed half of this story is
 * read-only and simple (see `/api/work-orders/[id]`'s own doc comment); a
 * full offline-detail cache is a bigger, separate feature this story never
 * asked for. What DOES have to work with zero network — starting/stopping
 * the timer, adding articles/photos, signing off — is all local-only
 * (`lib/offline/db.ts`), and none of that depends on this fetch succeeding.
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
  const section: WorkOrderSection = isSection(searchParams.get("section")) ? (searchParams.get("section") as WorkOrderSection) : "details";

  const [detail, setDetail] = useState<WorkOrderDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [periods, setPeriods] = useState<ClockPeriod[]>([]);
  const [localArticles, setLocalArticles] = useState<LocalArticle[]>([]);
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [signOff, setSignOff] = useState<LocalSignOff | null>(null);

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
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/work-orders/${workOrderId}`);
        if (!response.ok) {
          throw new Error(response.status === 404 ? "Work order not found." : "Failed to load work order.");
        }
        const data = (await response.json()) as WorkOrderDetailResponse;
        if (!cancelled) {
          setDetail(data);
          setDetailError(null);
        }
      } catch (error) {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : "Failed to load work order.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    void refreshPeriods();
    void refreshArticles();
    void refreshPhotos();
    void getLocalSignOff(workOrderId, currentUserId).then((row) => {
      if (!cancelled) setSignOff(row);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, currentUserId, refreshPeriods, refreshArticles, refreshPhotos]);

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

  const handleFinish = useCallback(
    async (signatureDataUrl: string | null) => {
      const timestamp = Date.now();
      await finishWorkOrderClock(workOrderId, currentUserId, timestamp);
      if (signatureDataUrl) {
        await saveLocalSignOff({ workOrderId, userId: currentUserId, signedAt: timestamp, signatureDataUrl });
      }
      router.push("/today");
    },
    [workOrderId, currentUserId, router],
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

      <TimerCard summary={summary} onToggleTravel={() => void handleToggle("travel")} onToggleWork={() => void handleToggle("work")} />

      {section === "details" && <WorkSection workOrder={workOrder} />}
      {section === "hours" && <HoursSection periods={periods} serverTimeEntries={detail.timeEntries} />}
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
          onFinish={handleFinish}
        />
      )}
    </Stack>
  );
}
