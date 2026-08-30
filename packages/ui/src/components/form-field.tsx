import type { ReactNode } from "react";
import { Input, Label, Select } from "./form";
import { Stack } from "./stack";
import { Text } from "./typography";

/**
 * Shared "label + input + inline field errors" layout (promoted to
 * packages/ui in issue #81 — previously local to the Clients module, which
 * left every other module's full-page forms hand-rolling this same
 * structure). `errors` is a slice of a Server Action's `fieldErrors` (see
 * `lib/actions/result.ts`), keyed by this field's `name`.
 */
export function FormField({
  label,
  name,
  type = "text",
  step,
  min,
  maxLength,
  defaultValue,
  required,
  errors,
  prefix,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  min?: string | number;
  maxLength?: number;
  defaultValue?: string | number | null;
  required?: boolean;
  errors?: string[];
  /** See `Input`'s own `prefix` prop — e.g. `"€"` for a money field. */
  prefix?: string;
}) {
  return (
    <Stack gap="xs">
      <Label htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        min={min}
        maxLength={maxLength}
        defaultValue={defaultValue ?? ""}
        required={required}
        prefix={prefix}
      />
      {errors?.map((message) => (
        <Text key={message} tone="danger">
          {message}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Select-backed sibling of `FormField` (issue #76) — same "label + control +
 * inline field errors" layout, for a `<Select>` instead of an `<Input>`.
 * `children` stays the caller's own `<option>` list since those genuinely
 * differ per field/caller (e.g. a blank "No account manager" option only
 * some callers need).
 */
export function FormSelectField({
  label,
  name,
  defaultValue,
  required,
  errors,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <Stack gap="xs">
      <Label htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </Label>
      <Select id={name} name={name} defaultValue={defaultValue} required={required}>
        {children}
      </Select>
      {errors?.map((message) => (
        <Text key={message} tone="danger">
          {message}
        </Text>
      ))}
    </Stack>
  );
}
