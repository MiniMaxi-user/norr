import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import { accounts, accountStatusVariant } from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Heading } from "../src/components/typography";
import { Input } from "../src/components/form";
import { Table } from "../src/components/table";
import { Badge } from "../src/components/badge";
import { Avatar } from "../src/components/avatar";
import { Inline } from "../src/components/stack";
import { Button } from "../src/components/button";

function OverviewPage() {
  return (
    <AppChrome
      active="#clients"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Heading level={4} style={{ margin: 0 }}>
              Clients
            </Heading>
          </Toolbar.Section>
          <Toolbar.Section align="end">
            <Input placeholder="Search clients..." style={{ width: 220 }} />
            <Button size="sm">New client</Button>
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <Table stickyHeader>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Client</Table.HeaderCell>
            <Table.HeaderCell>Tier</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell align="center">Sites</Table.HeaderCell>
            <Table.HeaderCell align="center">Open jobs</Table.HeaderCell>
            <Table.HeaderCell>Owner</Table.HeaderCell>
            <Table.HeaderCell>Contract ends</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {accounts.map((account) => (
            <Table.Row key={account.id} onClick={() => {}}>
              <Table.Cell>
                <Inline gap="sm">
                  <Avatar name={account.name} size="sm" />
                  {account.name}
                </Inline>
              </Table.Cell>
              <Table.Cell>{account.tier}</Table.Cell>
              <Table.Cell>
                <Badge variant={accountStatusVariant(account.status)}>{account.status}</Badge>
              </Table.Cell>
              <Table.Cell align="center">{account.sites}</Table.Cell>
              <Table.Cell align="center">{account.openJobs}</Table.Cell>
              <Table.Cell>{account.owner}</Table.Cell>
              <Table.Cell>{account.contractEnds}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </AppChrome>
  );
}

const meta: Meta<typeof OverviewPage> = {
  title: "FSM/Clients Overview",
  component: OverviewPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof OverviewPage>;

export const Default: Story = {};
