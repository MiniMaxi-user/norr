import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import { timeEntries, categoryHoursSummary, timeEntryStatusVariant } from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Heading, Text } from "../src/components/typography";
import { StatCard } from "../src/components/stat-card";
import { Table } from "../src/components/table";
import { Badge } from "../src/components/badge";
import { Progress } from "../src/components/progress";
import { Stack, Inline } from "../src/components/stack";
import { Avatar } from "../src/components/avatar";
import { Card } from "../src/components/card";
import { Button } from "../src/components/button";
import { ClipboardList, ShieldCheck, AlertTriangle, CalendarDays } from "../src/icons";

const totalHours = timeEntries.reduce((sum, entry) => sum + entry.hours, 0);
const pendingCount = timeEntries.filter((e) => e.status === "Pending").length;
const approvedCount = timeEntries.filter((e) => e.status === "Approved").length;
const rejectedCount = timeEntries.filter((e) => e.status === "Rejected").length;

function TimeApprovalsPage() {
  return (
    <AppChrome
      active="#technicians"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Heading level={4} style={{ margin: 0 }}>
              Time Approvals
            </Heading>
          </Toolbar.Section>
          <Toolbar.Section align="end">
            <Button variant="outline" size="sm">
              Export
            </Button>
            <Button size="sm">Approve all pending</Button>
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <Stack gap="lg">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <StatCard label="Pending" value={pendingCount} icon={ClipboardList} hint="awaiting review" />
          <StatCard label="Approved" value={approvedCount} icon={ShieldCheck} hint="this period" />
          <StatCard label="Rejected" value={rejectedCount} icon={AlertTriangle} hint="this period" />
          <StatCard label="Logged this period" value={`${totalHours}h`} icon={CalendarDays} hint={`${timeEntries.length} entries`} />
        </div>

        <Card>
          <Stack gap="md">
            <Heading level={5} style={{ margin: 0 }}>
              Hours by category
            </Heading>
            <Stack gap="md">
              {categoryHoursSummary.map((row) => (
                <Stack gap="xs" key={row.category}>
                  <Inline justify="between">
                    <Text style={{ margin: 0 }}>{row.category}</Text>
                    <Text tone="muted" style={{ margin: 0 }}>
                      {row.hours} / {row.cap}h
                    </Text>
                  </Inline>
                  <Progress value={row.hours} max={row.cap} tone={row.category === "Overtime" ? "warning" : "accent"} />
                </Stack>
              ))}
            </Stack>
          </Stack>
        </Card>

        <Card style={{ padding: 0 }}>
          <Table stickyHeader>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Technician</Table.HeaderCell>
                <Table.HeaderCell>Job</Table.HeaderCell>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell align="center">Hours</Table.HeaderCell>
                <Table.HeaderCell>Category</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell align="end">Action</Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {timeEntries.map((entry) => (
                <Table.Row key={entry.id}>
                  <Table.Cell>
                    <Inline gap="sm">
                      <Avatar name={entry.technician.name} size="sm" />
                      {entry.technician.name}
                    </Inline>
                  </Table.Cell>
                  <Table.Cell>{entry.job}</Table.Cell>
                  <Table.Cell>{entry.date}</Table.Cell>
                  <Table.Cell align="center">{entry.hours}h</Table.Cell>
                  <Table.Cell>{entry.category}</Table.Cell>
                  <Table.Cell>
                    <Badge variant={timeEntryStatusVariant(entry.status)}>{entry.status}</Badge>
                  </Table.Cell>
                  <Table.Cell align="end">
                    {entry.status === "Pending" ? (
                      <Inline gap="sm" justify="end">
                        <Button size="sm" variant="outline">
                          Reject
                        </Button>
                        <Button size="sm">Approve</Button>
                      </Inline>
                    ) : (
                      <Text tone="muted" style={{ margin: 0 }}>
                        &mdash;
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      </Stack>
    </AppChrome>
  );
}

const meta: Meta<typeof TimeApprovalsPage> = {
  title: "FSM/Time Approvals",
  component: TimeApprovalsPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof TimeApprovalsPage>;

export const Default: Story = {};
