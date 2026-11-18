/** URL param names of the Assets list's dropdowns (kept as `clientId` /
 * `siteId` so existing deep links keep working). */
export const ASSETS_DROPDOWN_IDS = {
  client: "clientId",
  site: "siteId",
  type: "type",
  status: "status",
} as const;

/** The 3-value toggle (All last): warranty state by `warranty_until`. */
export const ASSETS_WARRANTY_SEGMENT = {
  label: "Warranty",
  defaultValue: "all",
  options: [
    { value: "active", label: "In warranty" },
    { value: "expired", label: "Expired" },
    { value: "all", label: "All" },
  ] as const,
};
