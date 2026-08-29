import type { ReactNode } from "react";
import { Input, Label, Select, Stack, Text } from "@yourorg/ui";

/**
 * Shared "label + input + inline field errors" layout used by both the
 * client and site create/edit forms (`client-form-dialog.tsx`,
 * `site-form-dialog.tsx`) so the two forms don't duplicate this structure.
 * `errors` is a slice of a Server Action's `fieldErrors` (see
 * `lib/actions/result.ts`), keyed by this field's `name`.
 */
export function FormField({
  label,
  name,
  type = "text",
  step,
  min,
  defaultValue,
  required,
  errors,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  min?: string | number;
  defaultValue?: string | number | null;
  required?: boolean;
  errors?: string[];
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
        defaultValue={defaultValue ?? ""}
        required={required}
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
 * `new-client-panel.tsx` and `edit-client-panel.tsx` each hand-rolled this
 * exact `Stack`/`Label`/`Select`/error-list structure for their Status and
 * Account manager fields before this existed; `children` stays the caller's
 * own `<option>` list since those genuinely differ per field/panel (e.g. a
 * blank "No account manager" option only some callers need).
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
