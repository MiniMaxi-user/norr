import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { MultiSelect } from "../src/multi-select";

const meta: Meta<typeof MultiSelect> = {
  title: "Components/MultiSelect",
  component: MultiSelect,
};
export default meta;

type Story = StoryObj<typeof MultiSelect>;

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "invoiced", label: "Invoiced" },
];

function Demo({ initial, disabled }: { initial: string[]; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <MultiSelect label="Status" options={statusOptions} value={value} onChange={setValue} disabled={disabled} />;
}

export const Default: Story = { render: () => <Demo initial={["draft"]} /> };
export const AllSelected: Story = { render: () => <Demo initial={statusOptions.map((o) => o.value)} /> };
export const Disabled: Story = { render: () => <Demo initial={["draft"]} disabled /> };
