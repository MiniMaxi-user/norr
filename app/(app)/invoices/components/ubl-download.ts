"use client";

import { toast } from "@yourorg/ui";
import { invoiceUblUrl } from "./invoices-query";


interface MissingField {
  field: string;
  message: string;
}

function filenameFrom(response: Response, fallback: string): string {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header) ?? /filename="?([^";]+)"?/i.exec(header);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * Downloads the UBL e-invoice (XML) of an invoice or credit note. On a 422 the
 * server lists the missing fields; each message already says where to fill it
 * in, so they are shown verbatim in one toast.
 */
export async function downloadInvoiceUbl(invoiceId: string, invoiceNumber?: string): Promise<void> {
  try {
    const response = await fetch(invoiceUblUrl(invoiceId), { credentials: "same-origin" });
    if (response.ok) {
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filenameFrom(response, `${invoiceNumber ?? "invoice"}.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      return;
    }
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as { missing?: MissingField[] } | null;
      const messages = (body?.missing ?? []).map((item) => item.message);
      toast({
        tone: "danger",
        title: "UBL e-invoice can't be created yet",
        description: messages.length > 0 ? messages.join(" · ") : "Required invoice details are missing.",
        duration: 0,
      });
      return;
    }
    toast({ tone: "danger", title: "Could not download UBL", description: "Something went wrong. Try again.", duration: 0 });
  } catch {
    toast({ tone: "danger", title: "Could not download UBL", description: "Check your connection and try again.", duration: 0 });
  }
}
