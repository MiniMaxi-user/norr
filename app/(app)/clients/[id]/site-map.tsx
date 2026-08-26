"use client";

import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Badge, Stack, Text } from "@yourorg/ui";

export interface SiteMapPin {
  siteId: string;
  addressLabel: string;
  latitude: number;
  longitude: number;
  addressLine1: string | null;
  city: string | null;
  isPrimary: boolean;
}

// Same CDN workaround as `app/(app)/assets/components/asset-map.tsx` — Leaflet's
// default marker icon paths don't survive Next.js bundling.
const DEFAULT_ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function FitBounds({ pins }: { pins: SiteMapPin[] }) {
  const map = useMap();

  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      map.setView([pins[0]!.latitude, pins[0]!.longitude], 14);
      return;
    }
    const bounds = L.latLngBounds(pins.map((pin) => [pin.latitude, pin.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [32, 32] });
  }, [map, pins]);

  return null;
}

/**
 * Client-addresses map for the Sites tab (issue #41 redo, "Tevens ergens een
 * kaart tonen met een pin op de juiste adres") — a smaller, site-scoped
 * sibling of `app/(app)/assets/components/asset-map.tsx`, reusing the exact
 * same Leaflet + OSM-tiles pattern rather than inventing a new map approach
 * (see that file's doc comment) or reaching for `MapSurface` (decorative
 * only, no real tiles/geocoding — see `packages/ui/src/components/
 * map-surface.tsx`'s own doc comment ruling itself out for this).
 *
 * Deliberately much shorter (190px) than `AssetMap`'s 480px — this is an
 * at-a-glance pin reference housed in `client-detail.tsx`'s sticky rail
 * "Locations" card (outside the Tabs, so it stays visible on every tab, not
 * just Sites), not a dominant element competing with the tab content for
 * width.
 *
 * Must only ever render on the client (Leaflet touches `window`/`document`
 * at import time) — see `site-map-loader.tsx`, which `next/dynamic`s this
 * with `ssr: false`. Don't import this module directly from a Server
 * Component.
 *
 * A site with no successful geocode (`latitude`/`longitude` still null) is
 * simply not in `pins` — the caller (`sites-panel.tsx`) filters those out
 * before passing pins down, so this component never has to special-case a
 * single ungeocoded site among otherwise-plottable ones.
 */
export function SiteMap({ pins }: { pins: SiteMapPin[] }) {
  if (pins.length === 0) {
    return (
      <Stack gap="sm">
        <Text tone="muted">No addresses with map coordinates yet.</Text>
      </Stack>
    );
  }

  return (
    <MapContainer
      center={[pins[0]!.latitude, pins[0]!.longitude]}
      zoom={13}
      style={{ height: "190px", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds pins={pins} />
      {pins.map((pin) => (
        <Marker key={pin.siteId} position={[pin.latitude, pin.longitude]} icon={DEFAULT_ICON}>
          <Popup>
            <Stack gap="xs">
              <Text>
                <strong>{pin.addressLabel}</strong>
              </Text>
              {pin.isPrimary && <Badge variant="accent">Primary</Badge>}
              <Text tone="muted">{[pin.addressLine1, pin.city].filter(Boolean).join(", ") || "—"}</Text>
            </Stack>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
