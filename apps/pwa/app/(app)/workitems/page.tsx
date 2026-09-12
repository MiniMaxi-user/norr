import { Heading, Stack, Text } from "@yourorg/ui";

/**
 * Placeholder landing page for a signed-in engineer (issue #168). The real
 * today's-work-orders list is a separate story (issue #169) — intentionally
 * a stub here.
 */
export default function WorkItemsPage() {
  return (
    <Stack gap="xs">
      <Heading level={1}>Werkorders van vandaag</Heading>
      <Text tone="muted">Binnenkort beschikbaar.</Text>
    </Stack>
  );
}
