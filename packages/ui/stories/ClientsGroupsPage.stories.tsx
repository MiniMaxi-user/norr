import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import {
  accounts,
  clientGroups,
  attentionItems,
  accountStatusVariant,
  paymentStatusVariant,
  paymentStatusForIndex,
} from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Heading, Text } from "../src/components/typography";
import { Input } from "../src/components/form";
import { Table } from "../src/components/table";
import { Badge } from "../src/components/badge";
import { Avatar } from "../src/components/avatar";
import { Inline, Stack } from "../src/components/stack";
import { Button, IconButton } from "../src/components/button";
import { Card } from "../src/components/card";
import { DropdownMenu } from "../src/components/dropdown-menu";
import { Tabs } from "../src/tabs";
import { ChevronRight, MoreVertical, Pencil, FileText, Trash2, Phone, Mail, Building2, CalendarDays } from "../src/icons";

/** Small row of muted activity glyphs — purely decorative, echoes the
 * reference's per-record "recent activity" icon strip. */
function ActivityIcons() {
  return (
    <Inline gap="xs" style={{ color: "var(--ui-muted-subtle)" }}>
      <Phone width={14} height={14} />
      <Mail width={14} height={14} />
      <FileText width={14} height={14} />
      <CalendarDays width={14} height={14} />
    </Inline>
  );
}

/** Kebab row-action menu — owns its own open state (one instance per row,
 * so opening one row's menu never affects another's). */
function ClientRowActions() {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <IconButton variant="ghost" aria-label="Row actions" onClick={() => setOpen((v) => !v)}>
          <MoreVertical />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content open={open} onClose={() => setOpen(false)}>
        <DropdownMenu.Item icon={<Pencil />}>Edit client</DropdownMenu.Item>
        <DropdownMenu.Item icon={<FileText />}>View contract</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item danger icon={<Trash2 />}>
          Archive
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

function ClientsGroupsPage() {
  return (
    <AppChrome
      active="#clients"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Heading level={4} style={{ margin: 0 }}>
              My Clients
            </Heading>
          </Toolbar.Section>
          <Toolbar.Section align="end">
            <Input placeholder="Search clients..." style={{ width: 220 }} />
            <Button size="sm">New client</Button>
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <Stack gap="lg">
        <Tabs defaultValue="groups">
          <Tabs.List aria-label="Clients view">
            <Tabs.Tab value="groups">
              Groups <Badge variant="muted">{clientGroups.length}</Badge>
            </Tabs.Tab>
            <Tabs.Tab value="clients">
              Clients <Badge variant="muted">{accounts.length}</Badge>
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="groups">
            <Stack gap="lg">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
                {attentionItems.map((item) => (
                  <Card key={item.id} interactive>
                    <Stack gap="sm">
                      <Inline justify="between" align="start">
                        <Text tone="muted" style={{ margin: 0 }}>
                          {item.heading}
                        </Text>
                        <ChevronRight width={16} height={16} style={{ color: "var(--ui-accent-strong)" }} />
                      </Inline>
                      <Heading level={3} style={{ margin: 0 }}>
                        {item.count}
                      </Heading>
                      <Text tone="muted" style={{ margin: 0 }}>
                        {item.description}
                      </Text>
                    </Stack>
                  </Card>
                ))}
              </div>

              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.HeaderCell>Group</Table.HeaderCell>
                    <Table.HeaderCell>Region</Table.HeaderCell>
                    <Table.HeaderCell align="center">Clients</Table.HeaderCell>
                    <Table.HeaderCell align="center">Open jobs</Table.HeaderCell>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {clientGroups.map((group) => (
                    <Table.Row key={group.id} onClick={() => {}}>
                      <Table.Cell>
                        <Inline gap="sm">
                          <Building2 style={{ color: "var(--ui-muted)" }} />
                          {group.name}
                        </Inline>
                      </Table.Cell>
                      <Table.Cell>{group.region}</Table.Cell>
                      <Table.Cell align="center">{group.clientCount}</Table.Cell>
                      <Table.Cell align="center">{group.openJobs}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="clients">
            <Table stickyHeader>
              <Table.Head>
                <Table.Row>
                  <Table.HeaderCell>Client</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Payment</Table.HeaderCell>
                  <Table.HeaderCell>Activity</Table.HeaderCell>
                  <Table.HeaderCell>Owner</Table.HeaderCell>
                  <Table.HeaderCell align="end">Actions</Table.HeaderCell>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {accounts.map((account, index) => (
                  <Table.Row key={account.id}>
                    <Table.Cell>
                      <Inline gap="sm">
                        <Avatar name={account.name} size="sm" />
                        {account.name}
                      </Inline>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant={accountStatusVariant(account.status)}>{account.status}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge variant={paymentStatusVariant(paymentStatusForIndex(index))}>{paymentStatusForIndex(index)}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <ActivityIcons />
                    </Table.Cell>
                    <Table.Cell>{account.owner}</Table.Cell>
                    <Table.Cell align="end">
                      <ClientRowActions />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </AppChrome>
  );
}

const meta: Meta<typeof ClientsGroupsPage> = {
  title: "FSM/Clients Groups",
  component: ClientsGroupsPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ClientsGroupsPage>;

export const Default: Story = {};
