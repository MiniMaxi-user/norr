import type { Meta, StoryObj } from "@storybook/react";
import { AppChrome } from "./lib/AppChrome";
import {
  technicians,
  scheduleBlocks,
  unscheduledJobs,
  weekDays,
  jobs,
  jobStatusVariant,
  techStatusVariant,
} from "./lib/fixtures";
import { Toolbar } from "../src/components/toolbar";
import { Heading, Text } from "../src/components/typography";
import { Badge } from "../src/components/badge";
import { Card } from "../src/components/card";
import { Stack, Inline } from "../src/components/stack";
import { Avatar } from "../src/components/avatar";
import { EmptyState } from "../src/components/empty-state";
import { Disclosure } from "../src/components/disclosure";
import { Select } from "../src/components/form";
import { Button, IconButton } from "../src/components/button";
import { Timeline } from "../src/components/timeline";
import { MapSurface, MapPinPopup } from "../src/components/map-surface";
import { Tabs } from "../src/tabs";
import { ChevronLeft, ChevronRight, Plus, CalendarDays } from "../src/icons";

const teams = Array.from(new Set(technicians.map((t) => t.team)));
const selectedJob = jobs[8]!;

function PlanningPage() {
  return (
    <AppChrome
      active="#planning"
      toolbar={
        <Toolbar>
          <Toolbar.Section>
            <Inline gap="sm" align="center">
              <IconButton aria-label="Previous week">
                <ChevronLeft />
              </IconButton>
              <Heading level={4} style={{ margin: 0 }}>
                Week of Aug 24 &ndash; 28
              </Heading>
              <IconButton aria-label="Next week">
                <ChevronRight />
              </IconButton>
            </Inline>
          </Toolbar.Section>
          <Toolbar.Section align="end">
            <Select defaultValue="all" style={{ width: 150 }} aria-label="Filter by team">
              <option value="all">All teams</option>
              {teams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </Select>
            <Select defaultValue="all" style={{ width: 150 }} aria-label="Filter by status">
              <option value="all">All statuses</option>
              <option>Scheduled</option>
              <option>In progress</option>
              <option>Overdue</option>
            </Select>
            <Button size="sm">
              <Plus /> Add job
            </Button>
          </Toolbar.Section>
        </Toolbar>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px minmax(560px, 1.5fr) 300px minmax(320px, 1fr)",
          gap: "1.25rem",
          alignItems: "start",
        }}
      >
        {/* Resource rail — grouped by team, collapsible */}
        <Card style={{ padding: "0.875rem" }}>
          <Stack gap="sm">
            <Heading level={6} style={{ margin: 0 }}>
              Team
            </Heading>
            <div style={{ maxHeight: 600, overflowY: "auto" }}>
              <Stack gap="sm">
                {teams.map((team) => {
                  const teamTechs = technicians.filter((t) => t.team === team);
                  return (
                    <Disclosure defaultOpen key={team}>
                      <Disclosure.Summary meta={<Badge variant="muted">{teamTechs.length}</Badge>}>{team}</Disclosure.Summary>
                      <Disclosure.Content>
                        <Stack gap="md">
                          {teamTechs.map((tech) => (
                            <Inline key={tech.id} gap="sm" align="start">
                              <Avatar name={tech.name} size="sm" />
                              <Stack gap="xs">
                                <Text style={{ margin: 0, fontWeight: 550 }}>{tech.name}</Text>
                                <Inline gap="xs">
                                  <Badge variant={techStatusVariant(tech.status)}>{tech.status}</Badge>
                                  {tech.status === "Off shift" ? <Badge variant="muted">Absent</Badge> : null}
                                </Inline>
                              </Stack>
                            </Inline>
                          ))}
                        </Stack>
                      </Disclosure.Content>
                    </Disclosure>
                  );
                })}
              </Stack>
            </div>
          </Stack>
        </Card>

        {/* Timeline — day-by-technician scheduling grid */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: 660, overflowY: "auto" }}>
            <Timeline days={weekDays}>
              {technicians.map((tech) => (
                <Timeline.Row
                  key={tech.id}
                  label={
                    <Inline gap="sm">
                      <Avatar name={tech.name} size="sm" />
                      <Text style={{ margin: 0, fontWeight: 550 }}>{tech.name}</Text>
                    </Inline>
                  }
                  cells={weekDays.map((_, dayIndex) => {
                    const block = scheduleBlocks.find((b) => b.techId === tech.id && b.day === dayIndex);
                    if (!block) return null;
                    return (
                      <Timeline.Block
                        key={block.jobId}
                        title={block.title}
                        variant={jobStatusVariant(block.status)}
                        meta={<Badge variant={jobStatusVariant(block.status)}>{block.status}</Badge>}
                      />
                    );
                  })}
                />
              ))}
            </Timeline>
          </div>
        </Card>

        {/* Jobs panel */}
        <Card style={{ padding: 0 }}>
          <Tabs defaultValue="jobs">
            <div style={{ padding: "0.875rem 0.875rem 0" }}>
              <Tabs.List aria-label="Jobs panel">
                <Tabs.Tab value="jobs">Jobs</Tabs.Tab>
                <Tabs.Tab value="unscheduled">Unscheduled</Tabs.Tab>
              </Tabs.List>
            </div>
            <Tabs.Panel value="jobs">
              <div style={{ maxHeight: 580, overflowY: "auto", padding: "0.875rem" }}>
                <Stack gap="sm">
                  {jobs.slice(0, 8).map((job) => (
                    <Card key={job.id} interactive style={{ padding: "0.75rem 0.875rem" }}>
                      <Stack gap="xs">
                        <Inline justify="between">
                          <Text style={{ margin: 0, fontWeight: 600 }}>{job.title}</Text>
                          <Badge variant={jobStatusVariant(job.status)}>{job.status}</Badge>
                        </Inline>
                        <Text tone="muted" style={{ margin: 0 }}>
                          {job.client}
                        </Text>
                      </Stack>
                    </Card>
                  ))}
                </Stack>
              </div>
            </Tabs.Panel>
            <Tabs.Panel value="unscheduled">
              <div style={{ padding: "0.875rem" }}>
                {unscheduledJobs.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} heading="Nothing unscheduled" text="Every job this week has a technician assigned." />
                ) : (
                  <Stack gap="sm">
                    {unscheduledJobs.map((job) => (
                      <Inline justify="between" key={job.id}>
                        <Stack gap="xs">
                          <Text style={{ margin: 0 }}>{job.title}</Text>
                          <Text tone="muted" style={{ margin: 0 }}>
                            {job.client}
                          </Text>
                        </Stack>
                        <Badge variant="muted">{job.priority}</Badge>
                      </Inline>
                    ))}
                  </Stack>
                )}
              </div>
            </Tabs.Panel>
          </Tabs>
        </Card>

        {/* Map panel */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <MapSurface style={{ height: 660 }}>
            <MapSurface.Pin x={22} y={30} />
            <MapSurface.Pin x={68} y={22} />
            <MapSurface.Pin x={78} y={62} />
            <MapSurface.Pin x={38} y={70} active aria-label={`${selectedJob.title} — selected`} />
            <MapPinPopup
              x={38}
              y={70}
              title={selectedJob.title}
              status={<Badge variant={jobStatusVariant(selectedJob.status)}>{selectedJob.status}</Badge>}
              rows={[
                { label: "Address", value: selectedJob.address },
                { label: "Client", value: selectedJob.client },
                { label: "Assigned to", value: selectedJob.technician.name },
                { label: "Scheduled", value: selectedJob.scheduled.replace("T", " ") },
              ]}
            />
          </MapSurface>
        </Card>
      </div>
    </AppChrome>
  );
}

const meta: Meta<typeof PlanningPage> = {
  title: "FSM/Planning",
  component: PlanningPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof PlanningPage>;

export const Default: Story = {};
