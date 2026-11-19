"use client";
// Thumbnail grid + lightbox of the web design system (issue #224) — first
// caller: the work order detail's Photos tab. Generic on purpose: callers pass
// ready-made (signed) URLs and captions; this component owns only the
// viewing state (which photo is open, prev/next, Escape, arrow keys).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "../components/dialog";
import { useEscapeToClose } from "../use-escape-to-close";
import { ChevronLeft, ChevronRight } from "../icons";
import { WebButton, WebLinkButton } from "./primitives";

export interface WebPhotoItem {
  id: string;
  /** Full-size (signed) URL — used for the lightbox and "Open original". */
  url: string;
  alt: string;
  /** Primary caption line (e.g. date/time). */
  caption: ReactNode;
  /** Secondary caption line (e.g. uploader). */
  subCaption?: ReactNode;
}

export interface WebPhotoGalleryProps {
  photos: WebPhotoItem[];
  /** Label for the "open in a new tab" link in the lightbox. */
  openOriginalLabel?: string;
}

export function WebPhotoGallery({ photos, openOriginalLabel = "Open original" }: WebPhotoGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = openIndex !== null && photos[openIndex] !== undefined;
  const close = useCallback(() => setOpenIndex(null), []);
  useEscapeToClose(open, (next) => {
    if (!next) close();
  });

  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => (current === null ? current : (current + delta + photos.length) % photos.length));
    },
    [photos.length],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, step]);

  const current = openIndex !== null ? photos[openIndex] : undefined;

  return (
    <>
      <ul className="web-photo-grid">
        {photos.map((photo, index) => (
          <li key={photo.id} className="web-photo-cell">
            <button type="button" className="web-photo-thumb" onClick={() => setOpenIndex(index)}>
              <img src={photo.url} alt={photo.alt} loading="lazy" />
            </button>
            <div className="web-photo-caption">{photo.caption}</div>
            {photo.subCaption ? <div className="web-photo-subcaption">{photo.subCaption}</div> : null}
          </li>
        ))}
      </ul>

      <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())} size="lg">
        <Dialog.Header>
          <h2 className="web-dialog-title">
            {current?.caption}
            {openIndex !== null ? (
              <span className="web-photo-position">
                {" "}
                {openIndex + 1} / {photos.length}
              </span>
            ) : null}
          </h2>
        </Dialog.Header>
        <Dialog.Body>
          {current ? (
            <div className="web-photo-viewer">
              <img src={current.url} alt={current.alt} />
              {current.subCaption ? <div className="web-photo-subcaption">{current.subCaption}</div> : null}
            </div>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          {photos.length > 1 ? (
            <>
              <WebButton onClick={() => step(-1)} aria-label="Previous photo">
                <ChevronLeft aria-hidden="true" /> Previous
              </WebButton>
              <WebButton onClick={() => step(1)} aria-label="Next photo">
                Next <ChevronRight aria-hidden="true" />
              </WebButton>
            </>
          ) : null}
          {current ? (
            <WebLinkButton href={current.url} target="_blank" rel="noopener noreferrer">
              {openOriginalLabel}
            </WebLinkButton>
          ) : null}
          <WebButton onClick={close}>Close</WebButton>
        </Dialog.Footer>
      </Dialog>
    </>
  );
}
