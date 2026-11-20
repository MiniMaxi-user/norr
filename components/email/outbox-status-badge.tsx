"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebBadge, WebButton, type WebBadgeVariant } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import { retryEmail } from "@/app/(app)/settings/email-outbox/actions";

/** Structural subset of `OutboxMailStatus` / `OutboxItem` the badge needs (kept type-only so no server code is bundled). */
export interface OutboxBadgeMail {
  outboxId: string;
  status: "queued" | "sending" | "sent" | "failed";
  to: string[];
  sentAt: string | null;
  lastError: string | null;
  canRetry: boolean;
}

const VARIANT: Record<OutboxBadgeMail["status"], WebBadgeVariant> = {
  queued: "info",
  sending: "info",
  sent: "success",
  failed: "danger",
};

export function outboxStatusLabel(mail: Pick<OutboxBadgeMail, "status" | "sentAt" | "lastError">): string {
  switch (mail.status) {
    case "queued":
      return "Queued";
    case "sending":
      return "Sending";
    case "sent":
      return mail.sentAt ? `Sent ${formatDateTimeWeb(mail.sentAt)}` : "Sent";
    case "failed":
      return mail.lastError ? `Failed: ${mail.lastError}` : "Failed";
  }
}

export interface OutboxStatusBadgeProps {
  mail: OutboxBadgeMail;
  /** Called after a successful retry; defaults to `router.refresh()`. */
  onRetried?: () => void;
}

/**
 * E-mail outbox status (issue #268): "Queued", "Sending", "Sent <time>" or
 * "Failed: <reason>", with a "Retry" button on a failed mail the viewer may
 * retry. One component for the quote's Documents tab, the work receipt tab,
 * the invoices overview and the Settings -> Outbox page.
 */
export function OutboxStatusBadge({ mail, onRetried }: OutboxStatusBadgeProps) {
  const router = useRouter();
  const [pending, startRetry] = useTransition();

  function retry() {
    startRetry(async () => {
      const result = await retryEmail(mail.outboxId);
      if (!result.data) {
        toast({ tone: "danger", title: "Could not retry", description: result.error ?? "Retrying the email failed." });
        return;
      }
      toast({ tone: "success", title: "Email queued again", description: "It will be sent shortly." });
      if (onRetried) onRetried();
      else router.refresh();
    });
  }

  const title = [mail.to.length > 0 ? `To ${mail.to.join(", ")}` : null, mail.status === "failed" ? mail.lastError : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <span title={title || undefined}>
      <WebBadge variant={VARIANT[mail.status]}>{outboxStatusLabel(mail)}</WebBadge>
      {mail.status === "failed" && mail.canRetry ? (
        <>
          {" "}
          <WebButton size="sm" loading={pending} onClick={retry}>
            Retry
          </WebButton>
        </>
      ) : null}
    </span>
  );
}
