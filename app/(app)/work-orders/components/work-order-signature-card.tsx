import { WebCard } from "@yourorg/ui/web";
import { WebPhotoGallery } from "@yourorg/ui/web-client";
import { formatDateTimeWeb } from "@/lib/format/web";

export interface WorkOrderSignatureCardProps {
  signature: { url: string; signedAt: string };
}

/** Read-only "Signature" card (issue #226): the client's signature captured in
 * the field app at sign-off, with the date it was signed. */
export function WorkOrderSignatureCard({ signature }: WorkOrderSignatureCardProps) {
  return (
    <WebCard title="Signature" meta={formatDateTimeWeb(signature.signedAt)}>
      <WebPhotoGallery
        photos={[
          {
            id: "signature",
            url: signature.url,
            alt: `Client signature, signed ${formatDateTimeWeb(signature.signedAt)}`,
            caption: `Signed ${formatDateTimeWeb(signature.signedAt)}`,
          },
        ]}
      />
    </WebCard>
  );
}
