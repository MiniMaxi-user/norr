import { WebCardSkeleton, WebCardStack, WebPage } from "@yourorg/ui/web";

// Route-level Suspense fallback for `/contracts/[id]/end`: the four step cards.
export default function EndContractLoading() {
  return (
    <WebPage>
      <div className="web-tab-stack">
        <WebCardStack>
          <WebCardSkeleton rows={2} />
          <WebCardSkeleton rows={4} />
          <WebCardSkeleton rows={6} />
          <WebCardSkeleton rows={2} />
        </WebCardStack>
      </div>
    </WebPage>
  );
}
