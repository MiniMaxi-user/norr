import { describe, expect, it } from "vitest";
import {
  MODULE_CATALOG,
  addonModules,
  cascadeForToggle,
  coreModules,
  dependentsOf,
  requiredBy,
} from "./module-catalog";

describe("MODULE_CATALOG", () => {
  // Keep in sync with the feature_catalog seed (pgTAP organization_features.test.sql).
  it("matches the expected catalog", () => {
    expect(coreModules()).toEqual([
      "dashboard",
      "clients",
      "assets",
      "articles",
      "activities",
      "planning",
      "settings",
    ]);
    expect(addonModules()).toEqual([
      "contracts",
      "quotes",
      "invoicing",
      "checklists",
      "inventory",
      "meters",
      "preventive_maintenance",
    ]);
    expect(MODULE_CATALOG.invoicing.requires).toEqual(["quotes"]);
    expect(MODULE_CATALOG.preventive_maintenance.requires).toEqual(["contracts", "planning"]);
    const notShipped = Object.entries(MODULE_CATALOG)
      .filter(([, d]) => !d.shipped)
      .map(([k]) => k);
    expect(notShipped).toEqual(["preventive_maintenance"]);
  });

  it("core modules have no requirements", () => {
    for (const k of coreModules()) expect(MODULE_CATALOG[k].requires).toEqual([]);
  });

  it("dependentsOf / requiredBy", () => {
    expect(dependentsOf("quotes")).toEqual(["invoicing"]);
    expect(dependentsOf("contracts")).toEqual(["preventive_maintenance"]);
    expect(requiredBy("invoicing")).toEqual(["quotes"]);
    expect(requiredBy("meters")).toEqual([]);
  });
});

describe("cascadeForToggle", () => {
  const all = new Set(["quotes", "invoicing", "contracts", "meters"]);

  it("disabling quotes also disables invoicing", () => {
    const r = cascadeForToggle(all, "quotes", false);
    expect(r.error).toBeNull();
    expect(r.changes).toEqual({ quotes: false, invoicing: false });
    expect(r.affected).toEqual(["invoicing"]);
  });

  it("disabling quotes when invoicing is already off affects nothing else", () => {
    const r = cascadeForToggle(new Set(["quotes"]), "quotes", false);
    expect(r.changes).toEqual({ quotes: false });
    expect(r.affected).toEqual([]);
  });

  it("enabling invoicing also enables quotes", () => {
    const r = cascadeForToggle(new Set<string>(), "invoicing", true);
    expect(r.error).toBeNull();
    expect(r.changes).toEqual({ invoicing: true, quotes: true });
    expect(r.affected).toEqual(["quotes"]);
  });

  it("enabling invoicing with quotes on changes only invoicing", () => {
    const r = cascadeForToggle(new Set(["quotes"]), "invoicing", true);
    expect(r.changes).toEqual({ invoicing: true });
    expect(r.affected).toEqual([]);
  });

  it("refuses to disable a core module", () => {
    const core =cascadeForToggle(new Set(["clients"]), "clients", false);
    expect(core.error).toBe("Clients is a core module and can't be disabled");
    expect(core.changes).toEqual({});
  });

  it("refuses to enable a non-shipped module", () => {
    const r = cascadeForToggle(new Set(["contracts", "planning"]), "preventive_maintenance", true);
    expect(r.error).toBe("Preventive maintenance isn't available yet");
    expect(r.changes).toEqual({});
  });

  it("is a no-op when the state already matches", () => {
    const r = cascadeForToggle(all, "meters", true);
    expect(r).toEqual({ changes: {}, affected: [], error: null });
  });
});
