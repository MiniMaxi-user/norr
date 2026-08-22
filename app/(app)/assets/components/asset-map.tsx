"use client";

import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Badge, Stack, Text } from "@yourorg/ui";
import type { ResolvedReferenceItem } from "../actions";

export interface MapPinAsset {
  id: string;
  name: string;
  clientName: string;
  /** Resolved `asset_status` embed (see `AssetRecord.asset_status`),
   * `null` if it somehow doesn't resolve. */
  status: ResolvedReferenceItem | null;
}

export interface MapPin {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  assets: MapPinAsset[];
}

// Leaflet's default marker icon references image paths that don't survive
// Next.js bundling (relative to leaflet's own dist folder). Pointing at the
// same files via the unpkg CDN sidesteps needing an asset-pipeline change
// for three small PNGs, without forking any component.
const DEFAULT_ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function FitBounds({ pins }: { pins: MapPin[] }) {
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
 * Real, interactive Leaflet map (OpenStreetMap tiles — no API key needed).
 * Must only ever render on the client (Leaflet touches `window`/`document`
 * at import time) — see `asset-map-loader.tsx`, which `next/dynamic`s this
 * with `ssr: false`. Don't import this module directly from a Server
 * Component.
 */
export function AssetMap({ pins }: { pins: MapPin[] }) {
  if (pins.length === 0) {
    return (
      <Stack gap="sm" aria-hidden={false}>
        <Text tone="muted">No sites with coordinates to plot yet.</Text>
      </Stack>
    );
  }

  return (
    <MapContainer
      center={[pins[0]!.latitude, pins[0]!.longitude]}
      zoom={12}
      style={{ height: "480px", width: "100%" }}
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
                <strong>{pin.siteName}</strong>
              </Text>
              {pin.assets.map((asset) => (
                <Stack key={asset.id} gap="xs">
                  <Text>
                    {asset.name} — {asset.clientName}
                  </Text>
                  <Badge color={asset.status?.color} variant="muted">
                    {asset.status?.label ?? "—"}
                  </Badge>
                </Stack>
              ))}
            </Stack>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
