import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";

/** Shaped Suspense fallback for `ChecklistTemplatesBoard` (docs/ARCHITECTURE.md
 * "skeleton loading, plus the branded Spinner") — mirrors
 * `ReferenceListsSkeleton`'s shape: a button-height bar plus a couple of
 * card-shaped template placeholders. The `Spinner` above it (issue #140
 * follow-up, see `MainSkeleton`'s own doc comment) keeps every shaped
 * skeleton branded, not just the plain-fallback routes. */
export function ChecklistTemplatesSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Spinner size={20} />
      <Skeleton height="2rem" width="10rem" />
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={index}>
          <Stack gap="sm">
            <Skeleton height="1.5rem" width="40%" />
            {Array.from({ length: 3 }).map((_, itemIndex) => (
              <Skeleton key={itemIndex} height="2.5rem" />
            ))}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
