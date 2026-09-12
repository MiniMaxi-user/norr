"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type PointerEvent as ReactPointerEvent } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** `canvas.toDataURL()` PNG, or `null` while the canvas is empty. */
  toDataUrl: () => string | null;
}

export interface SignaturePadProps {
  /** Draws an existing signature (e.g. re-opening an order already signed
   * off on this device) onto the canvas on mount, so revisiting Sign off
   * shows what was actually signed rather than a blank canvas. */
  initialDataUrl?: string | null;
  /** Fires once per empty<->non-empty transition (not on every stroke) — the
   * Sign off section only needs to know whether a signature EXISTS yet, to
   * flip its button's label/style (IMPLEMENTATION.md §4). */
  onHasSignatureChange?: (hasSignature: boolean) => void;
}

/**
 * Plain canvas signature pad (issue #170, IMPLEMENTATION.md §4's Sign off
 * canvas) — pointer events (covers touch/mouse/pen in one code path)
 * drawing straight lines between consecutive points, no external drawing
 * library. Kept local to this route rather than promoted to `@yourorg/ui`:
 * it needs real hook state (refs, an imperative `clear`/`toDataUrl` API),
 * which in that package means its own dedicated "use client" build entry
 * (see `packages/ui/tsup.config.ts`'s top-of-file comment on
 * `client.tsx`/`tabs.tsx`/`combobox.tsx` etc.) — not worth the extra build
 * surface for a component only this one screen, in this one app, uses.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(function SignaturePad(
  { initialDataUrl, onHasSignatureChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (initialDataUrl) {
      const image = new Image();
      image.onload = () => {
        ctx.drawImage(image, 0, 0, rect.width, rect.height);
        hasStrokeRef.current = true;
        onHasSignatureChange?.(true);
      };
      image.src = initialDataUrl;
    }
    // Deliberately mount-only: re-running this on every prop change would
    // reset/rescale a canvas the engineer may already be mid-signature on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
    // Resolved fresh per stroke (not once at mount, fixed 2026-09-13):
    // this used to be hardcoded to `#dfe4e0` (Snö), which is illegible
    // against this pad's light-mode background (`--ui-bg-inset` resolves
    // to a near-white gray there) now that the app can switch themes
    // (`app/layout.tsx`'s `ThemeProvider`) — `--ui-fg` already resolves to
    // the correct readable ink color in both themes, same token every
    // surrounding text element uses.
    const ctx = event.currentTarget.getContext("2d");
    if (ctx) {
      const fg = getComputedStyle(event.currentTarget).getPropertyValue("--ui-fg").trim();
      ctx.strokeStyle = fg || "#dfe4e0";
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !lastPointRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const point = pointFromEvent(event);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    if (!hasStrokeRef.current) {
      hasStrokeRef.current = true;
      onHasSignatureChange?.(true);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastPointRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  useImperativeHandle(ref, () => ({
    clear() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasStrokeRef.current = false;
      onHasSignatureChange?.(false);
    },
    isEmpty() {
      return !hasStrokeRef.current;
    },
    toDataUrl() {
      return hasStrokeRef.current ? canvasRef.current?.toDataURL("image/png") ?? null : null;
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      className="ui-signature-pad"
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="img"
      aria-label="Signature"
    />
  );
});
