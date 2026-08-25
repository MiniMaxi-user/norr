"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@yourorg/ui";
import type { SiteMapPin } from "./site-map";

// `ssr: false` is only valid inside a Client Component (Next.js rejects it
// in a Server Component) — this small wrapper is that boundary, same as
// `app/(app)/assets/components/asset-map-loader.tsx`.
const SiteMap = dynamic(() => import("./site-map").then((mod) => mod.SiteMap), {
  ssr: false,
  loading: () => <Skeleton height="190px" />,
});

/**
 * No `Card` chrome of its own (unlike most other map loaders) — the caller
 * (`sites-panel.tsx`) houses this inside its own flush `Card` alongside a
 * "Locations" head label and a site-name legend (the mockup's `.map-side`),
 * so wrapping it in a second bordered card here would double up the border.
 */
export function SiteMapLoader({ pins }: { pins: SiteMapPin[] }) {
  return <SiteMap pins={pins} />;
}

export type { SiteMapPin } from "./site-map";
