import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import { accounts, accountStatusVariant, technicians } from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Breadcrumbs } from "../src/components/breadcrumbs";
import { Badge } from "../src/components/badge";
import { Card } from "../src/components/card";
import { Stack, Inline } from "../src/components/stack";
import { Text } from "../src/components/typography";
import { Button } from "../src/components/button";
import { DetailHero } from "../src/components/detail-hero";
import { Tabs } from "../src/tabs";
import { EmptyState } from "../src/components/empty-state";
import { ClipboardList, FileText, LayoutDashboard } from "../src/icons";

const account = accounts[0]!;

/**
 * The canonical reference for the "editorial hero" detail-page pattern
 * (`DetailHero` + `Tabs`) every top-level entity's detail page should build
 * on — Clients today (`app/(app)/clients/[id]/client-detail.tsx`), Assets/
 * Work Orders/Contracts/Quotes once those get their own detail pages. See
 * docs/ARCHITECTURE.md's "Relational detail pages" section.
 *
 * Deliberately generic: `DetailHero` + `Tabs` only — no map, no
 * address-specific "sites-grid" side card (that's a Client-only addition for
 * address-bearing entities; see `client-detail.tsx`/`sites-panel.tsx` for
 * that variant) — so this reads as the plain shell any module can copy.
 */
function EditorialDetailPage() {
  return (
    <AppChrome
      active="#clients"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Breadcrumbs items={[{ label: "Clients", href: "#clients" }, { label: account.name }]} />
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <Stack gap="lg">
        <DetailHero
          avatarLabel={account.name}
          title={account.name}
          meta={[`${account.sites} sites`, `${account.openJobs} open jobs`, `Owner ${account.owner}`]}
          badges={
            <>
              <Badge variant="accent">{account.tier}</Badge>
              <Badge variant={accountStatusVariant(account.status)}>{account.status}</Badge>
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

        <Tabs defaultValue="overview">
          <Tabs.List aria-label="Account detail">
            <Tabs.Tab value="overview" icon={<LayoutDashboard />}>
              Overview
            </Tabs.Tab>
            <Tabs.Tab value="workOrders" icon={<ClipboardList />}>
              Work orders (4)
            </Tabs.Tab>
            <Tabs.Tab value="contracts" icon={<FileText />}>
              Contracts (1)
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview">
            <Card>
              <Stack gap="sm">
                <Inline justify="between">
                  <Text tone="muted">Contract ends</Text>
                  <Text>{account.contractEnds}</Text>
                </Inline>
                <Inline justify="between">
                  <Text tone="muted">Account owner</Text>
                  <Text>{account.owner}</Text>
                </Inline>
                <Inline justify="between">
                  <Text tone="muted">Open jobs</Text>
                  <Text>{account.openJobs}</Text>
                </Inline>
              </Stack>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="workOrders">
            <Card>
              <Stack gap="sm">
                {technicians.slice(0, 4).map((tech) => (
                  <Inline key={tech.id} justify="between">
                    <Text>{tech.currentJob ?? "Unscheduled"}</Text>
                    <Badge variant="muted">{tech.status}</Badge>
                  </Inline>
                ))}
              </Stack>
            </Card>
          </Tabs.Panel>

          <Tabs.Panel value="contracts">
            <EmptyState
              icon={<FileText />}
              heading="No contracts yet"
              text="Contracts for this account will show up here."
            />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </AppChrome>
  );
}

const meta: Meta<typeof EditorialDetailPage> = {
  title: "FSM/Editorial Detail Page",
  component: EditorialDetailPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof EditorialDetailPage>;

export const Default: Story = {};
