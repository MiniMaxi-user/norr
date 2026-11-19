import { WebCard, WebDataTableEmpty } from "@yourorg/ui/web";
import { WebPhotoGallery } from "@yourorg/ui/web-client";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { WorkOrderPhotoRecord } from "../photo-actions";

export interface WorkOrderPhotosPanelProps {
  photos: WorkOrderPhotoRecord[];
}

/**
 * Photos tab (issue #224): the pictures engineers took in the field PWA, as one
 * card with a thumbnail grid. Read-only; the lightbox (prev/next, "Open
 * original") is the only client piece, inside `WebPhotoGallery`.
 */
export function WorkOrderPhotosPanel({ photos }: WorkOrderPhotosPanelProps) {
  return (
    <WebCard title="Photos" meta={String(photos.length)}>
      {photos.length === 0 ? (
        <WebDataTableEmpty>No photos yet.</WebDataTableEmpty>
      ) : (
        <WebPhotoGallery
          photos={photos.map((photo) => ({
            id: photo.id,
            url: photo.url,
            alt: `Photo taken ${formatDateTimeWeb(photo.taken_at)}`,
            caption: formatDateTimeWeb(photo.taken_at),
            subCaption: photo.uploader_name ?? undefined,
          }))}
        />
      )}
    </WebCard>
  );
}
