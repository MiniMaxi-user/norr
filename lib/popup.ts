"use client";

import { toast } from "@yourorg/ui";

const POPUP_WIDTH = 900;
const POPUP_HEIGHT = 1000;

/** Centers a popup on whichever screen the current browser window is on. */
function computePopupFeatures(width: number, height: number): string {
  const availWidth = window.screen.availWidth || width;
  const availHeight = window.screen.availHeight || height;
  const w = Math.min(width, availWidth);
  const h = Math.min(height, availHeight);
  const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
  const outerWidth = window.outerWidth || availWidth;
  const outerHeight = window.outerHeight || availHeight;
  const left = Math.max(0, Math.round(dualScreenLeft + (outerWidth - w) / 2));
  const top = Math.max(0, Math.round(dualScreenTop + (outerHeight - h) / 2));
  return `width=${w},height=${h},left=${left},top=${top}`;
}

/** Opens a document (PDF) in a separate, centered window — the shared way
 * invoices and work receipts are viewed. Shows a toast when the browser
 * blocks the popup. `what` names the document in that message. */
export function openDocumentPopup(url: string, what: string): void {
  const popup = window.open(url, "_blank", computePopupFeatures(POPUP_WIDTH, POPUP_HEIGHT));
  if (!popup) {
    toast({
      tone: "danger",
      title: "Popup blocked",
      description: `Allow popups for this site to view the ${what}, then try again.`,
    });
  }
}
