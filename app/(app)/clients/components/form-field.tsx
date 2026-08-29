import { Input, Label, Stack, Text } from "@yourorg/ui";

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
