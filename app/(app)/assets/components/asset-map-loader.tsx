"use client";

import dynamic from "next/dynamic";
import { Card, Skeleton } from "@yourorg/ui";
import type { MapPin } from "./asset-map";

// `ssr: false` is only valid inside a Client Component (Next.js rejects it
// in a Server Component) — this small wrapper is that boundary, per the
// standard Next.js pattern for browser-only libraries like Leaflet.
const AssetMap = dynamic(() => import("./asset-map").then((mod) => mod.AssetMap), {
  ssr: false,
  loading: () => <Skeleton height="480px" />,
});

export function AssetMapLoader({ pins }: { pins: MapPin[] }) {
  return (
    <Card>
      <AssetMap pins={pins} />
    </Card>
  );
}

export type { MapPin, MapPinAsset } from "./asset-map";
