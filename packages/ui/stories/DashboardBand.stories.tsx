import type { Meta, StoryObj } from "@storybook/react";
import { ChartPanel } from "../src/components/chart-panel";
import { Grid } from "../src/components/grid";
import { OverviewHeroBand } from "../src/components/overview-hero-band";
import { StatStrip } from "../src/components/stat-strip";
import { ViewSwitcher } from "../src/components/view-switcher";

const meta: Meta = { title: "Components/Dashboard band" };
export default meta;

const spark = [4, 6, 5, 9, 8, 12, 11];

export const BandWithKpiStrip: StoryObj = {
  render: () => (
    <OverviewHeroBand
      compact
      title="Dashboard"
      subtitle="Last 6 months - click any chart to filter"
      actions={
        <ViewSwitcher
          aria-label="Period"
          value="6m"
          onChange={() => {}}
          options={[
            { value: "30d", label: "30 days" },
            { value: "6m", label: "6 months" },
          ]}
        />
      }
    >
      <StatStrip
        compact
        items={[
          { group: "Finance", label: "Revenue", value: "EUR 291k", spark, trend: { value: "+12%", direction: "up" }, hint: "vs previous" },
          { group: "Finance", label: "Gross margin", value: "38%", hint: "On costed lines" },
          { group: "Operations", label: "Open work orders", value: "42", hint: "5 unscheduled, 3 review" },
          {
            group: "Operations",
            label: "Open malfunctions",
            value: "7",
            spark,
            trend: { value: "+2%", direction: "up", positiveWhen: "down" },
            hint: "vs previous",
          },
        ]}
      />
    </OverviewHeroBand>
  ),
};

export const PanelGrid: StoryObj = {
  render: () => (
    <Grid columns="2-1-1">
      <ChartPanel title="Wide panel" subtitle="With subtitle" link={{ label: "All", href: "#" }}>
        Content
      </ChartPanel>
      <ChartPanel title="Narrow" footerLink={{ label: "Open", href: "#" }}>
        Content
      </ChartPanel>
      <ChartPanel title="Narrow">Content</ChartPanel>
    </Grid>
  ),
};
