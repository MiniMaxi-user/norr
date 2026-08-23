import { Card, Skeleton, Stack } from "@yourorg/ui";

/** Shaped Suspense fallback for `ChecklistTemplatesBoard` (docs/ARCHITECTURE.md
 * "skeleton loading, not spinners") — mirrors `ReferenceListsSkeleton`'s
 * shape: a button-height bar plus a couple of card-shaped template
 * placeholders. */
export function ChecklistTemplatesSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
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
