"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FeatureKey } from "@/lib/rbac/features";

/**
 * The tenant's enabled modules (#247), resolved ONCE per request by
 * `app/(app)/layout.tsx` (`getEnabledFeatures`) and handed to client
 * components through context, so deep client leaves (pickers, dialogs,
 * hooks) can hide cross-module touchpoints without the flags being drilled
 * through every prop list. Purely a UI hint: server pages/actions still
 * enforce with `hasFeature()` / `requireModuleContext()`.
 */
const ModuleFeaturesContext = createContext<ReadonlySet<FeatureKey>>(new Set());

export function ModuleFeaturesProvider({ features, children }: { features: readonly FeatureKey[]; children: ReactNode }) {
  return <ModuleFeaturesContext.Provider value={new Set(features)}>{children}</ModuleFeaturesContext.Provider>;
}

/** True when the tenant has the module enabled. */
export function useModuleEnabled(key: FeatureKey): boolean {
  return useContext(ModuleFeaturesContext).has(key);
}
