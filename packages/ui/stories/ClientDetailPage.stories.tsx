import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import { accounts, accountStatusVariant } from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Breadcrumbs } from "../src/components/breadcrumbs";
import { Badge } from "../src/components/badge";
import { Card } from "../src/components/card";
import { Stack, Inline } from "../src/components/stack";
import { Text, Heading } from "../src/components/typography";
import { Button } from "../src/components/button";
import { Separator } from "../src/components/separator";
import { DetailHero } from "../src/components/detail-hero";
import { DetailLayout, DefinitionList } from "../src/components/detail-layout";
import { MapSurface } from "../src/components/map-surface";
import { Tabs } from "../src/tabs";
import { Boxes, ClipboardList, MapPin, Receipt, Users } from "../src/icons";

const account = accounts[0]!;

const relationshipStats = [
  { key: "sites", label: "Sites", value: 1 },
  { key: "assets", label: "Assets", value: 0 },
  { key: "workOrders", label: "Orders", value: 3 },
  { key: "quotes", label: "Quotes", value: 1 },
];

/**
 * The canonical reference for Client detail's "fixed rail" pattern —
 * `DetailLayout` wrapping a `DetailHero` + `Tabs` page, with a sticky 340px
 * rail (Company/Relationship/Platform/Locations/Notes `Card`s) that sits
 * OUTSIDE the `Tabs` so it stays visible across every tab. See
 * `app/(app)/clients/[id]/client-detail.tsx` for the real implementation
 * and docs/ARCHITECTURE.md's "Relational detail pages" section.
 *
 * Two variants: `Default` (platform admin — the rail's accent-tinted
 * "Platform" card is visible) and `WithoutPlatformAccess` (same rail, same
 * data, without it) — mirrors the two approved design-handoff screenshots
 * (`client-detail-2a.png` / `client-detail-2b-rail-zonder-admin.png`).
 */
function ClientDetailPage({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  return (
    <AppChrome
      active="#clients"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Breadcrumbs items={[{ label: "Clients", href: "#clients" }, { label: account.name }]} />
          </Toolbar.Section>
          {isPlatformAdmin && (
            <Toolbar.Section>
              <Badge variant="accent">Platform Admin</Badge>
            </Toolbar.Section>
          )}
        </Toolbar>
      }
    >
      <Stack gap="lg">
        <DetailHero
          avatarLabel={account.name}
          title={account.name}
          meta={["Klein Elsbroek 1, 2182TE Hillegom"]}
          badges={
            <>
              <Badge variant="accent">Primary</Badge>
              <Badge variant="muted">Client since Aug 2026</Badge>
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm">
                Edit
              </Button>
              <Button variant="danger" size="sm">
                Delete
              </Button>
            </>
          }
        />

        <DetailLayout
          rail={
            <>
              <Card>
                <Stack gap="sm">
                  <Inline justify="between" align="center">
                    <Heading level={6}>Company</Heading>
                    <Button variant="link" size="sm">
                      Edit
                    </Button>
                  </Inline>
                  <DefinitionList
                    items={[
                      { label: "KvK", value: "68123456" },
                      { label: "VAT", value: "NL001234567B01" },
                      { label: "IBAN", value: "NL91 ABNA 0417 1643 00" },
                      { label: "Phone", value: "+31 252 512 340" },
                    ]}
                  />
                </Stack>
              </Card>

              <Card>
                <Stack gap="sm">
                  <Heading level={6}>Relationship</Heading>
                  <DefinitionList items={[{ label: "Client since", value: "Aug 2026" }]} />
                  <Separator />
                  <div className="ui-detail-rail-stats">
                    {relationshipStats.map((stat) => (
                      <div className="ui-detail-rail-stat" key={stat.key}>
                        <div className="ui-detail-rail-stat-value">{stat.value}</div>
                        <Text tone="muted" className="ui-detail-rail-stat-label">
                          {stat.label}
                        </Text>
                      </div>
                    ))}
                  </div>
                </Stack>
              </Card>

              {isPlatformAdmin && (
                <Card tone="accent">
                  <Stack gap="sm">
                    <Inline justify="between" align="center">
                      <Heading level={6}>Platform</Heading>
                      <Badge variant="accent">Admin only</Badge>
                    </Inline>
                    <DefinitionList
                      items={[
                        { label: "Tenant", value: <Badge variant="success">Active</Badge> },
                        { label: "Modules", value: "Assets, Work orders" },
                      ]}
                    />
                  </Stack>
                </Card>
              )}

              <Card className="ui-card-flush">
                <div className="ui-sites-map-head">Locations</div>
                <div className="ui-sites-map-frame">
                  <MapSurface style={{ height: 190 }}>
                    <MapSurface.Pin x={45} y={40} active aria-label="Klein Elsbroek 1, Hillegom" />
                  </MapSurface>
                </div>
                <div className="ui-sites-map-legend">
                  <div className="ui-sites-map-legend-item">
                    <span className="ui-sites-map-legend-dot ui-sites-map-legend-dot-accent" aria-hidden="true" />
                    <Text>Klein Elsbroek 1, Hillegom</Text>
                  </div>
                </div>
              </Card>

              <Card>
                <Stack gap="sm">
                  <Heading level={6}>Notes</Heading>
                  <Text tone="muted">Onderhoud altijd melden bij de beheerder, ingang via de achterzijde.</Text>
                </Stack>
              </Card>
            </>
          }
        >
          <Tabs defaultValue="sites">
            <Tabs.List aria-label="Client detail">
              <Tabs.Tab value="sites" icon={<MapPin />}>
                Sites (1)
              </Tabs.Tab>
              <Tabs.Tab value="assets" icon={<Boxes />}>
                Assets
              </Tabs.Tab>
              <Tabs.Tab value="contacts" icon={<Users />}>
                Contacts (2)
              </Tabs.Tab>
              <Tabs.Tab value="workOrders" icon={<ClipboardList />}>
                Work Orders (3)
              </Tabs.Tab>
              <Tabs.Tab value="quotes" icon={<Receipt />}>
                Quotes (1)
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="sites">
              <Card>
                <Stack gap="sm">
                  <Inline justify="between">
                    <Text>Klein Elsbroek 1</Text>
                    <Badge variant={accountStatusVariant(account.status)}>{account.status}</Badge>
                  </Inline>
                  <Text tone="muted">
                    The Sites tab&apos;s table is full width now that the map lives in the rail instead of a
                    side-by-side grid.
                  </Text>
                </Stack>
              </Card>
            </Tabs.Panel>

            <Tabs.Panel value="assets">
              <Card>
                <Text tone="muted">Assets tab content.</Text>
              </Card>
            </Tabs.Panel>

            <Tabs.Panel value="contacts">
              <Card>
                <Text tone="muted">Contacts tab content.</Text>
              </Card>
            </Tabs.Panel>

            <Tabs.Panel value="workOrders">
              <Card>
                <Text tone="muted">Work Orders tab content.</Text>
              </Card>
            </Tabs.Panel>

            <Tabs.Panel value="quotes">
              <Card>
                <Text tone="muted">Quotes tab content.</Text>
              </Card>
            </Tabs.Panel>
          </Tabs>
        </DetailLayout>
      </Stack>
    </AppChrome>
  );
}

const meta: Meta<typeof ClientDetailPage> = {
  title: "FSM/Client Detail Page",
  component: ClientDetailPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ClientDetailPage>;

export const Default: Story = {
  args: { isPlatformAdmin: true },
};

export const WithoutPlatformAccess: Story = {
  args: { isPlatformAdmin: false },
};
