import "server-only";

/**
 * Minimal Resend REST client (https://resend.com/docs/api-reference/emails/send-email).
 * No SDK dependency: a single fetch. Server-only; needs `RESEND_API_KEY`.
 * Never throws — returns `{ ok: false, error }` so callers (best-effort
 * invoice e-mailing) can record the failure and carry on.
 */
export interface SendEmailInput {
  /** RFC 5322 mailbox, e.g. `Acme <invoices@acme.com>` or a bare address. */
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  /** Sent as Resend's `Idempotency-Key` header (kept 24 h by Resend): a retry
   * with the same key is not delivered twice. The outbox uses its row id. */
  idempotencyKey?: string;
}

/**
 * `status` is the HTTP status of the provider response (null when there was no
 * response, i.e. a network error). `permanent` marks failures that must never
 * be retried (provider not configured). The outbox processor classifies on these.
 */
export type SendEmailResult =
  | { ok: true; id: string | null; status: number }
  | { ok: false; error: string; status: number | null; permanent?: boolean };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "E-mail provider is not configured (RESEND_API_KEY)", status: null, permanent: true };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        ...(input.cc && input.cc.length > 0 ? { cc: input.cc } : {}),
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.attachments && input.attachments.length > 0
          ? {
              attachments: input.attachments.map((a) => ({
                filename: a.filename,
                content: a.content.toString("base64"),
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
          : {}),
      }),
    });

    const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) {
      return { ok: false, error: payload?.message ?? `E-mail provider returned HTTP ${response.status}`, status: response.status };
    }
    return { ok: true, id: payload?.id ?? null, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach the e-mail provider", status: null };
  }
}
