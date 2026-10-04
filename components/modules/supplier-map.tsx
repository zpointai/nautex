"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { MapContainer, Marker, Popup, useMap, ZoomControl, Circle } from "@/components/leaflet-bindings";
import { MapBasemap } from "@/components/map-basemap";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Supplier } from "@/types/erp";
import { COLORS, SUPPLIER_STATUS_COLORS } from "@/lib/design/tokens";

/* ═══════════════════════════════════════════════════════════════
   Supplier map layout. Basemap tiles, attribution and outage
   feedback are shared with Fleet Tracking through MapBasemap.
   ═══════════════════════════════════════════════════════════════ */

const MAP_CONFIG = {
  /** Default center when no suppliers have coordinates */
  defaultCenter: [30, 20] as [number, number],

  /** Default zoom levels for different contexts */
  zoom: {
    world: 3,
    region: 6,
    profile: 8,
    miniMap: 4,
    hubContext: 10,
  },

  /** Status → marker color mapping (shared design tokens) */
  statusColor: SUPPLIER_STATUS_COLORS,

  /** Default marker color */
  defaultColor: COLORS.success,

  /** Hub marker color */
  hubColor: COLORS.onSurfaceVariant,

  /** Accent color for selected markers */
  selectedColor: COLORS.success,

  /** Radius circle for proximity context (km) */
  proximityRadiusKm: 200,
} as const;

/* ── Maritime Hub Data (client-side subset for map markers) ──── */

interface HubMarkerData {
  name: string;
  lat: number;
  lng: number;
  tier: "mega" | "major" | "regional";
}

const MARITIME_HUBS_CLIENT: HubMarkerData[] = [
  { name: "Singapore",        lat:  1.2644, lng: 103.8222, tier: "mega" },
  { name: "Shanghai",         lat: 31.2304, lng: 121.4737, tier: "mega" },
  { name: "Fujairah",         lat: 25.1288, lng: 56.3264,  tier: "mega" },
  { name: "Jebel Ali",        lat: 25.0177, lng: 55.0809,  tier: "mega" },
  { name: "Rotterdam",        lat: 51.9244, lng:  4.4777,  tier: "mega" },
  { name: "Houston",          lat: 29.7604, lng:-95.3698,  tier: "mega" },
  { name: "Busan",            lat: 35.1028, lng: 129.0403, tier: "major" },
  { name: "Hong Kong",        lat: 22.2783, lng: 114.1747, tier: "major" },
  { name: "Hamburg",           lat: 53.5511, lng:  9.9937,  tier: "major" },
  { name: "Piraeus",          lat: 37.9475, lng: 23.6371,  tier: "major" },
  { name: "Istanbul",         lat: 41.0082, lng: 28.9784,  tier: "major" },
  { name: "Durban",           lat:-29.8587, lng: 31.0218,  tier: "major" },
  { name: "Lagos",            lat:  6.4474, lng:  3.3903,  tier: "major" },
  { name: "Santos",           lat:-23.9608, lng:-46.3336,  tier: "major" },
  { name: "Mumbai",           lat: 18.9500, lng: 72.9500,  tier: "major" },
  { name: "Jeddah",           lat: 21.5433, lng: 39.1728,  tier: "major" },
  { name: "Las Palmas",       lat: 28.1235, lng:-15.4363,  tier: "major" },
  { name: "Panama",           lat:  8.9500, lng:-79.5667,  tier: "major" },
];

/* ── Custom marker icons ──────────────────────────────────────── */

function makeIcon(color: string = MAP_CONFIG.defaultColor, size = 10, selected = false) {
  const border = selected ? "3px solid rgba(255,255,255,0.6)" : "2px solid rgba(255,255,255,0.25)";
  const shadow = selected
    ? `0 0 12px ${color}80, 0 0 4px ${color}b0`
    : `0 0 8px ${color}60, 0 0 2px ${color}90`;
  const scale = selected ? "scale(1.3)" : "scale(1)";

  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};
      border:${border};
      box-shadow:${shadow};
      transform:${scale};
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
  });
}

function makeHubIcon(tier: "mega" | "major" | "regional") {
  const size = tier === "mega" ? 8 : tier === "major" ? 6 : 5;
  const opacity = tier === "mega" ? 0.5 : tier === "major" ? 0.35 : 0.2;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${MAP_CONFIG.hubColor};
      opacity:${opacity};
      border:1px solid rgba(148,163,184,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 2)],
  });
}

/* ── Fit bounds helper ─────────────────────────────────────────── */

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const serialized = useMemo(() => JSON.stringify(positions), [positions]);

  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], MAP_CONFIG.zoom.region, { animate: false });
    } else {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: MAP_CONFIG.zoom.hubContext, animate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, serialized]);

  return null;
}

/* ── Popup dark theme injection ────────────────────────────────── */

let _popupStylesInjected = false;
function ensurePopupStyles() {
  if (typeof document === "undefined" || !document.head || _popupStylesInjected) return;
  const el = document.createElement("style");
  el.textContent = `
    .ntx-popup .leaflet-popup-content-wrapper {
      background: ${COLORS.surfaceLow};
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.5);
      padding: 0;
      overflow: hidden;
    }
    .ntx-popup .leaflet-popup-content {
      margin: 0;
      padding: 0;
      min-width: 200px;
    }
    .ntx-popup .leaflet-popup-tip {
      background: ${COLORS.surfaceLow};
      box-shadow: none;
    }
    .ntx-popup .leaflet-popup-tip-container {
      margin-top: -1px;
    }
    .ntx-popup .leaflet-popup-close-button {
      color: rgba(255,255,255,0.25) !important;
      top: 8px !important;
      right: 8px !important;
      font-size: 14px !important;
      width: 18px !important;
      height: 18px !important;
    }
    .ntx-popup .leaflet-popup-close-button:hover {
      color: rgba(255,255,255,0.6) !important;
    }
    .ntx-hub-popup .leaflet-popup-content-wrapper {
      background: ${COLORS.surfaceLow};
      border: 1px solid rgba(148,163,184,0.12);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      padding: 0;
      overflow: hidden;
    }
    .ntx-hub-popup .leaflet-popup-content { margin: 0; padding: 0; }
    .ntx-hub-popup .leaflet-popup-tip { background: ${COLORS.surfaceLow}; box-shadow: none; }
    .ntx-hub-popup .leaflet-popup-close-button {
      color: rgba(255,255,255,0.2) !important;
      top: 6px !important; right: 6px !important;
    }
  `;
  document.head.appendChild(el);
  _popupStylesInjected = true;
}

/* ── Popup content components ──────────────────────────────────── */

const P = {
  wrap: { fontFamily: "'DM Sans', system-ui, sans-serif", lineHeight: 1.5 } as React.CSSProperties,
  header: {
    padding: "10px 12px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  } as React.CSSProperties,
  name: { fontWeight: 700, color: COLORS.onSurface, fontSize: 16, marginBottom: 2 } as React.CSSProperties,
  code: { fontFamily: "monospace", fontSize: 14, color: COLORS.onSurfaceVariant, letterSpacing: "0.05em" } as React.CSSProperties,
  location: { color: COLORS.onSurfaceVariant, fontSize: 14, marginTop: 1 } as React.CSSProperties,
  body: { padding: "8px 12px 10px" } as React.CSSProperties,
  categories: { color: COLORS.outline, fontSize: 14, marginBottom: 6, lineHeight: 1.5 } as React.CSSProperties,
  statsRow: { display: "flex", gap: 12, marginBottom: 6 } as React.CSSProperties,
  stat: { fontSize: 14, color: COLORS.outline } as React.CSSProperties,
  statVal: { color: COLORS.onSurfaceVariant, fontWeight: 600 } as React.CSSProperties,
  cta: {
    display: "block", marginTop: 6, color: COLORS.success, fontSize: 14,
    fontWeight: 600, letterSpacing: "0.03em",
    cursor: "pointer",
  } as React.CSSProperties,
  hubWrap: { padding: "8px 10px" } as React.CSSProperties,
  hubName: { color: COLORS.onSurfaceVariant, fontSize: 15, fontWeight: 600, marginBottom: 2 } as React.CSSProperties,
  hubNote: { color: COLORS.onSurfaceVariant, fontSize: 14 } as React.CSSProperties,
};

/* ═══════════════════════════════════════════════════════════════
   1. SupplierMapView — full sourcing workspace map
   ═══════════════════════════════════════════════════════════════ */

interface MapViewProps {
  suppliers: Supplier[];
  onSelect: (id: string) => void;
  /** Currently selected supplier ID for highlight */
  selectedId?: string | null;
  /** Show maritime hub markers as context layer */
  showHubs?: boolean;
}

export function SupplierMapView({ suppliers, onSelect, selectedId, showHubs = true }: MapViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  useEffect(() => { ensurePopupStyles(); }, []);

  const mappable = useMemo(
    () => suppliers.filter((s) => s.lat !== null && s.lng !== null),
    [suppliers]
  );
  const positions = useMemo(
    () => mappable.map((s) => [s.lat!, s.lng!] as [number, number]),
    [mappable]
  );

  const center: [number, number] = positions.length > 0
    ? [
        positions.reduce((a, p) => a + p[0], 0) / positions.length,
        positions.reduce((a, p) => a + p[1], 0) / positions.length,
      ]
    : MAP_CONFIG.defaultCenter;


  return (
    <MapContainer
      zoomAnimation={false}
      center={center}
      zoom={MAP_CONFIG.zoom.world}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
      attributionControl={true}
    >
      <MapBasemap />
      <ZoomControl position="bottomright" />
      <FitBounds positions={positions} />

      {/* Hub context layer — subtle background markers for maritime awareness */}
      {showHubs && MARITIME_HUBS_CLIENT.map((hub) => (
        <Marker
          key={`hub-${hub.name}`}
          title={hub.name}
          position={[hub.lat, hub.lng]}
          icon={makeHubIcon(hub.tier)}
          interactive={true}
        >
          <Popup className="ntx-hub-popup">
            <div style={{ ...P.wrap, ...P.hubWrap }}>
              <div style={P.hubName}>{hub.tier === "mega" ? "⬟" : "◆"} {hub.name}</div>
              <div style={P.hubNote}>Maritime hub &middot; {hub.tier}</div>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Supplier markers */}
      {mappable.map((s) => {
        const isSelected = s.id === selectedId;
        const isHovered = s.id === hoveredId;
        const color = MAP_CONFIG.statusColor[s.status] ?? MAP_CONFIG.defaultColor;

        return (
          <Marker
            key={s.id}
            title={s.name}
            position={[s.lat!, s.lng!]}
            icon={makeIcon(color, isSelected ? 16 : 13, isSelected || isHovered)}
            zIndexOffset={isSelected ? 1000 : isHovered ? 500 : 0}
            eventHandlers={{
              click: () => onSelect(s.id),
              mouseover: () => setHoveredId(s.id),
              mouseout: () => setHoveredId(null),
            }}
          >
            <Popup className="ntx-popup">
              <div style={P.wrap}>
                <div style={P.header}>
                  <div style={P.name}>{s.name}</div>
                  <div style={P.code}>{s.supplierCode}</div>
                  <div style={P.location}>
                    {[s.city, s.country].filter(Boolean).join(", ") || s.region}
                  </div>
                </div>
                <div style={P.body}>
                  {s.categories.length > 0 && (
                    <div style={P.categories}>
                      {s.categories.slice(0, 3).join(", ")}
                      {s.categories.length > 3 && ` +${s.categories.length - 3}`}
                    </div>
                  )}
                  <div style={P.statsRow}>
                    <div style={P.stat}>Score <span style={P.statVal}>{s.score}</span></div>
                    <div style={P.stat}>Lead <span style={P.statVal}>{s.leadTimeDays}d</span></div>
                    {s.confidence !== null && (
                      <div style={P.stat}>AI <span style={P.statVal}>{Math.round(s.confidence * 100)}%</span></div>
                    )}
                  </div>
                  <span style={P.cta}>View supplier →</span>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   2. SupplierMiniMap — small map for list row cards
   ═══════════════════════════════════════════════════════════════ */

interface MiniMapProps {
  lat: number;
  lng: number;
}

export function SupplierMiniMap({ lat, lng }: MiniMapProps) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Leaflet requires a client-only mount after hydration.
  useEffect(() => { setMounted(true); }, []);


  if (!mounted) {
    return <div style={{ width: "100%", height: "100%", background: COLORS.surfaceLow }} />;
  }

  return (
    <MapContainer
      zoomAnimation={false}
      center={[lat, lng]}
      zoom={MAP_CONFIG.zoom.miniMap}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
      attributionControl={true}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      keyboard={false}
    >
      <MapBasemap />
      <Marker interactive={false} keyboard={false} position={[lat, lng]} icon={makeIcon(MAP_CONFIG.defaultColor, 8)} />
    </MapContainer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   3. SupplierProfileMap — embedded in supplier workspace

   Enhanced for v5:
   - Wider regional context (zoom 7 for surrounding geography)
   - Proximity radius circle showing service area
   - Nearby hub markers for maritime context
   - Recenter animation on supplier change
   ═══════════════════════════════════════════════════════════════ */

interface ProfileMapProps {
  lat: number;
  lng: number;
  name: string;
  address: string;
  /** Ports this supplier covers — shown as context on map */
  portsCovered?: string[];
  /** Supplier status for marker color */
  status?: string;
}

function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevRef = useRef({ lat, lng });

  useEffect(() => {
    if (prevRef.current.lat !== lat || prevRef.current.lng !== lng) {
      map.flyTo([lat, lng], MAP_CONFIG.zoom.profile, { animate: false });
      prevRef.current = { lat, lng };
    }
  }, [map, lat, lng]);

  return null;
}

export function SupplierProfileMap({ lat, lng, name, address, portsCovered = [], status }: ProfileMapProps) {
  useEffect(() => { ensurePopupStyles(); }, []);
  const markerColor = status ? (MAP_CONFIG.statusColor[status] ?? MAP_CONFIG.defaultColor) : MAP_CONFIG.selectedColor;

  // Find nearby hubs for context (within ~800km to show regional maritime landscape)
  const nearbyHubs = useMemo(() => {
    return MARITIME_HUBS_CLIENT.filter((hub) => {
      const dLat = hub.lat - lat;
      const dLng = hub.lng - lng;
      // Quick rough distance check (≈ 8 degrees ~ 800km)
      return Math.abs(dLat) < 8 && Math.abs(dLng) < 8;
    });
  }, [lat, lng]);

  return (
    <MapContainer
      zoomAnimation={false}
      center={[lat, lng]}
      zoom={MAP_CONFIG.zoom.profile}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
      attributionControl={true}
    >
      <MapBasemap />
      <ZoomControl position="bottomright" />
      <RecenterMap lat={lat} lng={lng} />

      {/* Proximity radius — subtle service area indicator */}
      <Circle
        center={[lat, lng]}
        radius={MAP_CONFIG.proximityRadiusKm * 1000}
        pathOptions={{
          color: markerColor,
          fillColor: markerColor,
          fillOpacity: 0.04,
          weight: 1,
          opacity: 0.15,
          dashArray: "4 6",
        }}
      />

      {/* Nearby hub markers for regional context */}
      {nearbyHubs.map((hub) => (
        <Marker
          key={`profile-hub-${hub.name}`}
          title={hub.name}
          position={[hub.lat, hub.lng]}
          icon={makeHubIcon(hub.tier)}
        >
          <Popup className="ntx-hub-popup">
            <div style={{ ...P.wrap, ...P.hubWrap }}>
              <div style={P.hubName}>{hub.name}</div>
              <div style={P.hubNote}>{hub.tier} maritime hub</div>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Supplier marker */}
      <Marker title={name} position={[lat, lng]} icon={makeIcon(markerColor, 14, true)}>
        <Popup className="ntx-popup">
          <div style={P.wrap}>
            <div style={P.header}>
              <div style={P.name}>{name}</div>
              <div style={P.location}>{address}</div>
            </div>
            <div style={P.body}>
              {portsCovered.length > 0 && (
                <div style={P.categories}>
                  Ports: {portsCovered.slice(0, 4).join(", ")}
                  {portsCovered.length > 4 && ` +${portsCovered.length - 4}`}
                </div>
              )}
              <div style={{ ...P.stat, fontFamily: "monospace", fontSize: 14, color: COLORS.onSurfaceVariant }}>
                {lat.toFixed(4)}°, {lng.toFixed(4)}°
              </div>
            </div>
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Exports: MAP_CONFIG for external consumers
   ═══════════════════════════════════════════════════════════════ */

export { MAP_CONFIG, MARITIME_HUBS_CLIENT };
