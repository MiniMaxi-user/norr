import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import { dashboardJobs, activityFeed, teamCapacity, jobStatusVariant } from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Heading, Text } from "../src/components/typography";
import { StatCard } from "../src/components/stat-card";
import { Table } from "../src/components/table";
import { Badge } from "../src/components/badge";
import { Progress } from "../src/components/progress";
import { Stack, Inline } from "../src/components/stack";
import { Avatar } from "../src/components/avatar";
import { Card } from "../src/components/card";
import { ClipboardList, Users, CalendarDays, AlertTriangle } from "../src/icons";

function DashboardPage() {
  return (
    <AppChrome
      active="#dashboard"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Heading level={4} style={{ margin: 0 }}>
              Dashboard
            </Heading>
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <Stack gap="lg">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <StatCard label="Open jobs" value="42" icon={ClipboardList} trend={{ value: "+6%", direction: "up" }} hint="vs. last week" />
          <StatCard label="Overdue" value="4" icon={AlertTriangle} trend={{ value: "+2", direction: "up", positiveWhen: "down" }} hint="vs. last week" />
          <StatCard label="Technicians on shift" value="6 / 8" icon={Users} />
          <StatCard label="Scheduled today" value="17" icon={CalendarDays} trend={{ value: "-3%", direction: "down" }} hint="vs. last week" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem", alignItems: "start" }}>
          <Card>
            <Stack gap="md">
              <Heading level={5} style={{ margin: 0 }}>
                Today's jobs
              </Heading>
              <Table>
                <Table.Head>
                  <Table.Row>
                    <Table.HeaderCell>Job</Table.HeaderCell>
                    <Table.HeaderCell>Client</Table.HeaderCell>
                    <Table.HeaderCell>Technician</Table.HeaderCell>
                    <Table.HeaderCell>Status</Table.HeaderCell>
                  </Table.Row>
                </Table.Head>
                <Table.Body>
                  {dashboardJobs.map((job) => (
                    <Table.Row key={job.id}>
                      <Table.Cell>{job.title}</Table.Cell>
                      <Table.Cell>{job.client}</Table.Cell>
                      <Table.Cell>{job.technician.name}</Table.Cell>
                      <Table.Cell>
                        <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </Stack>
          </Card>

          <Stack gap="lg">
            <Card>
              <Stack gap="md">
                <Heading level={5} style={{ margin: 0 }}>
                  Team capacity
                </Heading>
                <Stack gap="sm">
                  {teamCapacity.map((row) => (
                    <Stack gap="xs" key={row.team}>
                      <Inline justify="between">
                        <Text style={{ margin: 0 }}>{row.team}</Text>
                        <Text tone="muted" style={{ margin: 0 }}>
                          {row.scheduled} / {row.capacity}h
                        </Text>
                      </Inline>
                      <Progress value={row.scheduled} max={row.capacity} tone={row.scheduled / row.capacity > 0.9 ? "danger" : "accent"} />
                    </Stack>
                  ))}
                </Stack>
              </Stack>
            </Card>

            <Card>
              <Stack gap="md">
                <Heading level={5} style={{ margin: 0 }}>
                  Recent activity
                </Heading>
                <Stack gap="md">
                  {activityFeed.map((event) => (
                    <Inline gap="sm" key={event.id} align="start">
                      <Avatar name={event.actor} size="sm" />
                      <Stack gap="xs">
                        <Text style={{ margin: 0 }}>
                          <strong>{event.actor}</strong> {event.action} {event.target}
                        </Text>
                        <Text tone="muted" style={{ margin: 0 }}>
                          {event.time}
                        </Text>
                      </Stack>
                    </Inline>
                  ))}
                </Stack>
              </Stack>
            </Card>
          </Stack>
        </div>
      </Stack>
    </AppChrome>
  );
}

const meta: Meta<typeof DashboardPage> = {
  title: "FSM/Dashboard",
  component: DashboardPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof DashboardPage>;

export const Default: Story = {};
