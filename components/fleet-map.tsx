"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, ZoomControl, useMap } from "@/components/leaflet-bindings";
import { MapBasemap } from "@/components/map-basemap";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { VesselResult, VesselTrackPoint } from "@/types/vessel";
import { COLORS } from "@/lib/design/tokens";

interface FleetMapProps {
  vessel: VesselResult | null;
  track: VesselTrackPoint[];
}

const HUBS = [
  { name: "Singapore", lat: 1.2644, lng: 103.8222 },
  { name: "Rotterdam", lat: 51.9244, lng: 4.4777 },
  { name: "Fujairah", lat: 25.1288, lng: 56.3264 },
  { name: "Houston", lat: 29.7604, lng: -95.3698 },
  { name: "Busan", lat: 35.1028, lng: 129.0403 },
  { name: "Panama", lat: 8.95, lng: -79.5667 },
];

function makeIcon(color: string = COLORS.success, size = 16, glow = true) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:999px;
      background:${color};
      border:2px solid rgba(255,255,255,0.34);
      box-shadow:${glow ? `0 0 18px ${color}88, 0 0 4px ${color}` : "none"};
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function FitVessel({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const serialized = useMemo(() => JSON.stringify(positions), [positions]);

  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 5, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 6, animate: false });
  }, [map, serialized, positions]);

  return null;
}

let popupStylesInjected = false;
function ensurePopupStyles() {
  if (typeof document === "undefined" || popupStylesInjected) return;
  const el = document.createElement("style");
  el.textContent = `
    .ntx-fleet-map {
      position: relative;
      isolation: isolate;
      background: ${COLORS.surfaceBase};
    }
    .ntx-fleet-map::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 500;
      height: 1px;
      pointer-events: none;
      background: ${COLORS.surfaceBase};
    }
    .ntx-fleet-map .leaflet-container {
      background: ${COLORS.surfaceBase};
      outline: 0;
    }
    .ntx-fleet-map .leaflet-tile {
      border: 0;
      box-shadow: none;
    }
    .ntx-fleet-map .leaflet-control-zoom a {
      background: ${COLORS.surfaceLow};
      border-color: rgba(255,255,255,0.1);
      color: ${COLORS.onSurface};
    }
    .ntx-vessel-popup .leaflet-popup-content-wrapper {
      background: ${COLORS.surfaceLow};
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
      padding: 0;
      overflow: hidden;
    }
    .ntx-vessel-popup .leaflet-popup-content { margin: 0; padding: 0; min-width: 210px; }
    .ntx-vessel-popup .leaflet-popup-tip { background: ${COLORS.surfaceLow}; box-shadow: none; }
    .ntx-vessel-popup .leaflet-popup-close-button { color: rgba(255,255,255,0.35) !important; }
  `;
  document.head.appendChild(el);
  popupStylesInjected = true;
}

export function FleetMap({ vessel, track }: FleetMapProps) {
  useEffect(() => ensurePopupStyles(), []);

  const positions = useMemo(() => {
    const points = track
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .map((p) => [p.lat, p.lng] as [number, number]);
    if (vessel && Number.isFinite(vessel.lat) && Number.isFinite(vessel.lng)) points.push([vessel.lat, vessel.lng]);
    return points;
  }, [track, vessel]);

  const center = positions[positions.length - 1] ?? ([30, 20] as [number, number]);
  const route = positions.length > 1 ? positions : [];

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between border-b border-outline-variant/20 p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface">
          <span className="material-symbols-outlined text-lg text-info" style={{ fontVariationSettings: "'FILL' 0" }}>map</span>
          Current Position
        </h3>
        <p className="text-[0.65rem] text-on-surface-variant">
          {vessel ? `${vessel.lat.toFixed(5)}, ${vessel.lng.toFixed(5)}` : "No vessel selected"}
        </p>
      </div>
      <div className="ntx-fleet-map h-[360px] overflow-hidden bg-surface-base">
        <MapContainer center={center} zoom={vessel ? 5 : 3} style={{ width: "100%", height: "100%" }} zoomAnimation={false} zoomControl={false} attributionControl={true}>
          <MapBasemap />
          <ZoomControl position="bottomright" />
          <FitVessel positions={positions} />

          {HUBS.map((hub) => (
            <Marker title={hub.name} key={hub.name} position={[hub.lat, hub.lng]} icon={makeIcon(COLORS.onSurfaceVariant, 7, false)}>
              <Popup className="ntx-vessel-popup">
                <div className="px-3 py-2 text-xs text-on-surface-variant">{hub.name} maritime hub</div>
              </Popup>
            </Marker>
          ))}

          {route.length > 1 && <Polyline positions={route} pathOptions={{ color: COLORS.success, weight: 3, opacity: 0.72 }} />}

          {vessel && (
            <Marker title={vessel.name} position={[vessel.lat, vessel.lng]} icon={makeIcon(COLORS.success, 17, true)}>
              <Popup className="ntx-vessel-popup">
                <div className="border-b border-white/10 px-3 py-2">
                  <div className="text-sm font-bold text-on-surface">{vessel.name}</div>
                  <div className="mt-1 text-[0.62rem] text-on-surface-variant">IMO {vessel.imo || "-"} | MMSI {vessel.mmsi || "-"}</div>
                </div>
                <div className="px-3 py-2 text-[0.7rem] text-secondary">
                  <div>{vessel.status || "Status unknown"}</div>
                  <div className="mt-1 text-on-surface-variant">{vessel.destination || "Destination not available"}</div>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
      <div className="p-4 text-[0.75rem] text-secondary">
        {vessel
          ? `Tracking ${vessel.name} (${vessel.imo || vessel.mmsi || "unidentified"}) from live maritime source with local history retained.`
          : "Search VesselFinder by vessel name, MMSI, or IMO to activate tracking."}
      </div>
    </div>
  );
}
