import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import { jobs, activityFeed, jobStatusVariant, techStatusVariant } from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Breadcrumbs } from "../src/components/breadcrumbs";
import { Heading, Text } from "../src/components/typography";
import { Badge } from "../src/components/badge";
import { Card } from "../src/components/card";
import { Stack, Inline } from "../src/components/stack";
import { Avatar } from "../src/components/avatar";
import { Separator } from "../src/components/separator";
import { Button } from "../src/components/button";
import { StatCard } from "../src/components/stat-card";
import { EmptyState } from "../src/components/empty-state";
import { MapSurface, MapPinPopup } from "../src/components/map-surface";
import { Tabs } from "../src/tabs";
import { MapPin, Phone, Receipt, ClipboardList, CalendarDays, FileText } from "../src/icons";

const job = jobs[3]!;

function DetailPage() {
  return (
    <AppChrome
      active="#jobs"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Breadcrumbs items={[{ label: "Jobs", href: "#jobs" }, { label: job.id }]} />
          </Toolbar.Section>
          <Toolbar.Section align="end">
            <Button variant="outline" size="sm">
              Edit
            </Button>
            <Button size="sm">Mark complete</Button>
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <Stack gap="lg">
        <Inline justify="between" align="start">
          <Stack gap="xs">
            <Heading level={3} style={{ margin: 0 }}>
              {job.title}
            </Heading>
            <Text tone="muted" style={{ margin: 0 }}>
              {job.id} &middot; {job.client}
            </Text>
          </Stack>
          <Inline gap="sm">
            <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
            <Badge variant="muted">{job.priority} priority</Badge>
          </Inline>
        </Inline>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
          <StatCard label="Open balance" value="$4,280" icon={Receipt} hint="3 invoices outstanding" />
          <StatCard label="Completed jobs" value="18" icon={ClipboardList} trend={{ value: "+3", direction: "up" }} hint="last 90 days" />
          <StatCard label="Avg response" value="2.4h" icon={CalendarDays} trend={{ value: "-12%", direction: "down" }} hint="vs. target" />
          <StatCard
            tone="highlight"
            label="Overdue"
            value="$1,120"
            hint="1 invoice past due"
            action={
              <Button size="sm" variant="primary">
                Send reminder
              </Button>
            }
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem", alignItems: "start" }}>
          <Stack gap="lg">
            <Card style={{ padding: 0 }}>
              <Tabs defaultValue="overview">
                <div style={{ padding: "1.25rem 1.5rem 0" }}>
                  <Tabs.List aria-label="Job detail">
                    <Tabs.Tab value="overview">Overview</Tabs.Tab>
                    <Tabs.Tab value="activity">Activity</Tabs.Tab>
                    <Tabs.Tab value="attachments">Attachments</Tabs.Tab>
                  </Tabs.List>
                </div>
                <Tabs.Panel value="overview">
                  <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>
                    <Stack gap="sm">
                      <Inline gap="sm">
                        <MapPin />
                        <Text style={{ margin: 0 }}>{job.address}</Text>
                      </Inline>
                      <Inline justify="between">
                        <Text tone="muted" style={{ margin: 0 }}>
                          Scheduled
                        </Text>
                        <Text style={{ margin: 0 }}>
                          {job.scheduled.replace("T", " ")} &middot; {job.duration}
                        </Text>
                      </Inline>
                    </Stack>
                  </div>
                </Tabs.Panel>
                <Tabs.Panel value="activity">
                  <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>
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
                  </div>
                </Tabs.Panel>
                <Tabs.Panel value="attachments">
                  <div style={{ padding: "1.25rem 1.5rem 1.5rem" }}>
                    <EmptyState
                      icon={<FileText />}
                      heading="No attachments yet"
                      text="Photos and documents added to this job will show up here."
                    />
                  </div>
                </Tabs.Panel>
              </Tabs>
            </Card>

            <Card>
              <Stack gap="md">
                <Heading level={5} style={{ margin: 0 }}>
                  Location
                </Heading>
                <MapSurface style={{ height: 220 }}>
                  <MapSurface.Pin x={50} y={55} active aria-label={`${job.title} location`} />
                  <MapPinPopup
                    x={50}
                    y={55}
                    title={job.title}
                    status={<Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>}
                    rows={[
                      { label: "Address", value: job.address },
                      { label: "Assigned to", value: job.technician.name },
                    ]}
                  />
                </MapSurface>
              </Stack>
            </Card>
          </Stack>

          <Card>
            <Stack gap="md">
              <Heading level={5} style={{ margin: 0 }}>
                Assigned technician
              </Heading>
              <Inline gap="sm">
                <Avatar name={job.technician.name} />
                <Stack gap="xs">
                  <Text style={{ margin: 0 }}>{job.technician.name}</Text>
                  <Badge variant={techStatusVariant(job.technician.status)}>{job.technician.status}</Badge>
                </Stack>
              </Inline>
              <Separator />
              <Inline gap="sm">
                <Phone />
                <Text tone="muted" style={{ margin: 0 }}>
                  +49 176 555 0142
                </Text>
              </Inline>
            </Stack>
          </Card>
        </div>
      </Stack>
    </AppChrome>
  );
}

const meta: Meta<typeof DetailPage> = {
  title: "FSM/Job Detail",
  component: DetailPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof DetailPage>;

export const Default: Story = {};
