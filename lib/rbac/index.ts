// Barrel for the two RBAC concerns (issue #4): "can this role do this"
// (permissions.ts) and "is this org entitled to this module at all"
// (features.ts). Import from "@/lib/rbac" for either; the split into two
// files exists because they're genuinely different questions (see the
// comment on `Module` in permissions.ts), not because one is more
// authoritative than the other.
export * from "./permissions";
export * from "./features";
