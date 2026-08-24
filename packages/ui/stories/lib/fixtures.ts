/**
 * Fixture data for the FSM example page stories. Demo content only — lives
 * under `stories/`, not `src/`, so it's never part of the published
 * `@yourorg/ui` package (the component package itself must stay
 * domain-agnostic; only these *stories* are allowed to know about jobs,
 * technicians, and accounts). Adapted from norrdesign's
 * `examples/lib/fsm-data.ts` reference fixtures to this package's own icon
 * set and Badge variant vocabulary (muted/accent/success/danger — no
 * "warning" tone exists here yet, see styles.css).
 */
import type { BadgeVariant } from "../../src/components/badge";

export type JobStatus = "Scheduled" | "In progress" | "Completed" | "Overdue" | "On hold";
export type JobPriority = "Low" | "Normal" | "High" | "Urgent";
export type TechStatus = "On route" | "On site" | "Available" | "Off shift";

export function jobStatusVariant(status: JobStatus): BadgeVariant {
  switch (status) {
    case "Completed":
      return "success";
    case "In progress":
      return "accent";
    case "Overdue":
      return "danger";
    default:
      return "muted";
  }
}

export function techStatusVariant(status: TechStatus): BadgeVariant {
  switch (status) {
    case "On site":
      return "success";
    case "On route":
      return "accent";
    default:
      return "muted";
  }
}

export interface Technician {
  id: string;
  name: string;
  team: string;
  status: TechStatus;
  load: number;
  currentJob?: string;
}

export const technicians: Technician[] = [
  { id: "t1", name: "Albert Flores", team: "North", status: "On route", load: 82, currentJob: "Elevator inspection — Site 4" },
  { id: "t2", name: "Courtney Henry", team: "North", status: "On site", load: 91, currentJob: "HVAC repair — Norrland Logistics" },
  { id: "t3", name: "Klaus Heisler", team: "North", status: "Available", load: 46 },
  { id: "t4", name: "Hans-Ulrich Radel", team: "East", status: "On route", load: 67, currentJob: "Boiler service — Fjellheim AS" },
  { id: "t5", name: "Dieter Bohlen", team: "East", status: "On site", load: 88, currentJob: "Generator swap — Unit 1123" },
  { id: "t6", name: "Franka Beckenbauer", team: "East", status: "Off shift", load: 0 },
  { id: "t7", name: "Robert Lewan", team: "South", status: "Available", load: 34 },
  { id: "t8", name: "Jakub Blaszczyk", team: "South", status: "On route", load: 74, currentJob: "Fire alarm test — Solvik Center" },
];

export interface Job {
  id: string;
  title: string;
  client: string;
  address: string;
  technician: Technician;
  status: JobStatus;
  priority: JobPriority;
  scheduled: string;
  duration: string;
}

const jobTitles = [
  "HVAC repair",
  "Elevator inspection",
  "Boiler service",
  "Generator swap",
  "Fire alarm test",
  "Panel upgrade",
  "Leak diagnosis",
  "Preventive maintenance",
  "Emergency callout",
  "Filter replacement",
];

const clients = [
  "Norrland Logistics",
  "Fjellheim AS",
  "Solvik Center",
  "Backa Industri",
  "Kust Fastigheter",
  "Alvsund Retail",
  "Malmberg Group",
  "Storsjo Hospital",
];

const addresses = [
  "6391 Elgin St, Celina, DE",
  "Werner-Heisenberg-Allee 26, Munich",
  "Bahnhofstrasse 1, Zug, CH",
  "123 Main St, Berlin, DE",
  "909 Ash St, Warsaw, PL",
  "1717 Cedar St, Prague, CZ",
  "505 Walnut St, Brussels, BE",
  "404 Ceder St, Rome, IT",
];

const statuses: JobStatus[] = ["Scheduled", "In progress", "Completed", "Overdue", "On hold"];
const priorities: JobPriority[] = ["Normal", "High", "Urgent", "Low"];

function makeJobs(count: number): Job[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `J-${4820 + i}`,
    title: jobTitles[i % jobTitles.length]!,
    client: clients[i % clients.length]!,
    address: addresses[i % addresses.length]!,
    technician: technicians[i % technicians.length]!,
    status: statuses[i % statuses.length]!,
    priority: priorities[i % priorities.length]!,
    scheduled: `2026-08-${String(((i * 3) % 27) + 1).padStart(2, "0")}T${String(8 + (i % 9)).padStart(2, "0")}:00`,
    duration: `${1 + (i % 3)}h`,
  }));
}

export const jobs = makeJobs(18);
export const dashboardJobs = jobs.slice(0, 6);

export type AccountTier = "Enterprise" | "Standard" | "Basic";
export type AccountStatus = "Active" | "At risk" | "Prospect";

export function accountStatusVariant(status: AccountStatus): BadgeVariant {
  switch (status) {
    case "Active":
      return "success";
    case "At risk":
      return "danger";
    default:
      return "accent";
  }
}

export interface Account {
  id: string;
  name: string;
  sites: number;
  openJobs: number;
  tier: AccountTier;
  status: AccountStatus;
  contractEnds: string;
  owner: string;
}

const tiers: AccountTier[] = ["Enterprise", "Standard", "Standard", "Basic"];
const accountStatuses: AccountStatus[] = ["Active", "Active", "At risk", "Prospect"];

export const accounts: Account[] = clients.map((name, i) => ({
  id: `acc-${i + 1}`,
  name,
  sites: 2 + ((i * 3) % 9),
  openJobs: (i * 5) % 14,
  tier: tiers[i % tiers.length]!,
  status: accountStatuses[i % accountStatuses.length]!,
  contractEnds: `2026-${String(9 + (i % 3)).padStart(2, "0")}-${String(((i * 4) % 27) + 1).padStart(2, "0")}`,
  owner: technicians[i % technicians.length]!.name,
}));

export interface ScheduleBlock {
  jobId: string;
  techId: string;
  day: number;
  status: JobStatus;
  title: string;
}

export const weekDays = ["Mon 24", "Tue 25", "Wed 26", "Thu 27", "Fri 28"];

export const scheduleBlocks: ScheduleBlock[] = [
  { jobId: "J-4820", techId: "t1", day: 0, status: "Scheduled", title: "HVAC repair" },
  { jobId: "J-4821", techId: "t1", day: 2, status: "In progress", title: "Elevator inspection" },
  { jobId: "J-4822", techId: "t2", day: 0, status: "In progress", title: "HVAC repair" },
  { jobId: "J-4823", techId: "t2", day: 3, status: "Scheduled", title: "Filter replacement" },
  { jobId: "J-4824", techId: "t3", day: 1, status: "Completed", title: "Safety audit" },
  { jobId: "J-4826", techId: "t4", day: 1, status: "Overdue", title: "Boiler service" },
  { jobId: "J-4827", techId: "t4", day: 2, status: "Scheduled", title: "Panel upgrade" },
  { jobId: "J-4828", techId: "t5", day: 0, status: "In progress", title: "Generator swap" },
  { jobId: "J-4832", techId: "t8", day: 0, status: "In progress", title: "Fire alarm test" },
  { jobId: "J-4833", techId: "t8", day: 2, status: "Overdue", title: "Emergency callout" },
];

export const unscheduledJobs = jobs.slice(12, 16);

export interface ActivityEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
}

export const activityFeed: ActivityEvent[] = [
  { id: "a1", actor: "Courtney Henry", action: "completed", target: "HVAC repair at Norrland Logistics", time: "8 min ago" },
  { id: "a2", actor: "Albert Flores", action: "started", target: "Elevator inspection — Site 4", time: "24 min ago" },
  { id: "a3", actor: "Dispatch", action: "reassigned", target: "J-4826 to Hans-Ulrich Radel", time: "1 hr ago" },
  { id: "a4", actor: "Jakub Blaszczyk", action: "flagged", target: "Fire alarm test as overdue", time: "2 hr ago" },
];

export interface CapacityRow {
  team: string;
  scheduled: number;
  capacity: number;
}

export const teamCapacity: CapacityRow[] = [
  { team: "North", scheduled: 41, capacity: 48 },
  { team: "East", scheduled: 36, capacity: 40 },
  { team: "South", scheduled: 22, capacity: 32 },
];

export const currentUser = { name: "Fenna Visser", role: "Operations Lead" };

/* ------------------------------------------------------------------------ *
 * Time approvals (FSM/Time Approvals story) — logged time entries against a
 * job, pending review. Modeled on Norr's real time-tracking-on-work-orders
 * module, not a generic HR time-off request.
 * ------------------------------------------------------------------------ */
export type TimeEntryCategory = "Regular" | "Overtime" | "Travel" | "Break";
export type TimeEntryStatus = "Approved" | "Rejected" | "Pending";

export function timeEntryStatusVariant(status: TimeEntryStatus): BadgeVariant {
  switch (status) {
    case "Approved":
      return "success";
    case "Rejected":
      return "danger";
    default:
      return "warning";
  }
}

export interface TimeEntry {
  id: string;
  technician: Technician;
  job: string;
  date: string;
  hours: number;
  category: TimeEntryCategory;
  status: TimeEntryStatus;
}

const entryCategories: TimeEntryCategory[] = ["Regular", "Overtime", "Travel", "Break"];
const entryStatuses: TimeEntryStatus[] = ["Pending", "Approved", "Approved", "Rejected", "Pending"];
const entryHours = [8, 4, 2, 6, 1.5, 7.5, 8, 3, 5, 8, 2.5, 6];

export const timeEntries: TimeEntry[] = Array.from({ length: 12 }, (_, i) => ({
  id: `TE-${3010 + i}`,
  technician: technicians[i % technicians.length]!,
  job: `${jobs[i % jobs.length]!.title} — ${jobs[i % jobs.length]!.client}`,
  date: `2026-08-${String(18 + (i % 7)).padStart(2, "0")}`,
  hours: entryHours[i % entryHours.length]!,
  category: entryCategories[i % entryCategories.length]!,
  status: entryStatuses[i % entryStatuses.length]!,
}));

export interface CategoryHours {
  category: TimeEntryCategory;
  hours: number;
  cap: number;
}

export const categoryHoursSummary: CategoryHours[] = [
  { category: "Regular", hours: 312, cap: 360 },
  { category: "Overtime", hours: 48, cap: 80 },
  { category: "Travel", hours: 26, cap: 60 },
  { category: "Break", hours: 14, cap: 40 },
];

/* ------------------------------------------------------------------------ *
 * Clients groups (FSM/Clients Groups story) — a "Groups" clustering of the
 * same `accounts` fixture, plus a payment-status pill and "needs attention"
 * summary in Altezza's pattern, adapted to Norr's client/contract domain.
 * ------------------------------------------------------------------------ */
export interface ClientGroup {
  id: string;
  name: string;
  region: string;
  clientCount: number;
  openJobs: number;
}

export const clientGroups: ClientGroup[] = [
  { id: "g1", name: "Logistics & Warehousing", region: "North", clientCount: 6, openJobs: 14 },
  { id: "g2", name: "Healthcare Facilities", region: "East", clientCount: 4, openJobs: 9 },
  { id: "g3", name: "Retail Chains", region: "South", clientCount: 9, openJobs: 21 },
  { id: "g4", name: "Industrial Manufacturing", region: "East", clientCount: 5, openJobs: 17 },
];

export type PaymentStatus = "Partially paid" | "Fully paid" | "Cancelled";

export function paymentStatusVariant(status: PaymentStatus): BadgeVariant {
  switch (status) {
    case "Fully paid":
      return "success";
    case "Cancelled":
      return "danger";
    default:
      return "warning";
  }
}

const paymentStatuses: PaymentStatus[] = ["Partially paid", "Fully paid", "Cancelled", "Partially paid"];

/** Derived, not stored on `accounts` itself (keeps that fixture shared
 * as-is with `OverviewPage.stories.tsx`) — a pure function of row index. */
export function paymentStatusForIndex(index: number): PaymentStatus {
  return paymentStatuses[index % paymentStatuses.length]!;
}

export interface AttentionItem {
  id: string;
  heading: string;
  count: number;
  description: string;
}

export const attentionItems: AttentionItem[] = [
  { id: "att1", heading: "Missing site details", count: 7, description: "Clients with no site address on file" },
  { id: "att2", heading: "Contracts expiring", count: 3, description: "Renewal due in the next 30 days" },
  { id: "att3", heading: "Unassigned owner", count: 5, description: "Accounts without an assigned rep" },
];
