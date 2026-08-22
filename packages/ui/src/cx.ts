/** Joins class names, dropping falsy values. Shared by every component in
 * this package instead of each one re-implementing it. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
