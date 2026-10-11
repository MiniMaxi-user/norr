import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { BarList, ColumnChart, DonutChart, StackedBar, TrendChart } from "../src/charts";

const meta: Meta = { title: "Components/Charts" };
export default meta;

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const points = months.map((label, index) => ({
  key: label,
  label,
  longLabel: `${label} 2026`,
  values: { invoiced: 4000 + ((index * 1731) % 5200), pipeline: 800 + ((index * 977) % 2400) },
}));
const series = [
  { key: "invoiced", label: "Invoiced" },
  { key: "pipeline", label: "Draft pipeline" },
];
const money = (value: number) => `EUR ${value.toLocaleString()}`;

function ColumnsDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ColumnChart
      points={points}
      series={series}
      ariaLabel="Revenue per month"
      formatValue={money}
      selectedKey={selected}
      onSelect={setSelected}
    />
  );
}

function DonutDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <DonutChart
      ariaLabel="Work orders by status"
      centerLabel="Work orders"
      selectedKey={selected}
      onSelect={setSelected}
      slices={[
        { key: "new", label: "New", value: 12 },
        { key: "scheduled", label: "Scheduled", value: 18 },
        { key: "in_progress", label: "In progress", value: 7 },
        { key: "completed", label: "Completed", value: 31 },
      ]}
    />
  );
}

export const Columns: StoryObj = { render: () => <ColumnsDemo /> };

export const Area: StoryObj = {
  render: () => <TrendChart area points={points} series={series} ariaLabel="Revenue trend" formatValue={money} />,
};

export const Donut: StoryObj = { render: () => <DonutDemo /> };

export const Ranked: StoryObj = {
  render: () => (
    <BarList
      ariaLabel="Top clients"
      formatValue={money}
      items={[
        { key: "a", label: "Fjordline AS", secondary: "12 invoices", value: 48200, href: "#" },
        { key: "b", label: "Nordic Cooling", secondary: "7 invoices", value: 31000, href: "#" },
        { key: "c", label: "Havn Logistics", secondary: "4 invoices", value: 12400, href: "#" },
      ]}
    />
  ),
};

function StackedBarDemo() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <StackedBar
      ariaLabel="Work orders by type"
      title="Work orders"
      selectedKey={selected}
      onSelect={setSelected}
      slices={[
        { key: "repair", label: "Repair", value: 24 },
        { key: "install", label: "Installation", value: 11 },
        { key: "maintenance", label: "Maintenance", value: 17 },
        { key: "inspection", label: "Inspection", value: 6 },
      ]}
    />
  );
}

export const Mix: StoryObj = { render: () => <StackedBarDemo /> };

export const CompactDonut: StoryObj = {
  render: () => (
    <DonutChart
      compact
      size={132}
      ariaLabel="Work orders by status"
      centerLabel="Work orders"
      slices={[
        { key: "new", label: "New", value: 12 },
        { key: "scheduled", label: "Scheduled", value: 18 },
        { key: "completed", label: "Completed", value: 31 },
      ]}
    />
  ),
};
