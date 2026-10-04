/**
 * Geospatial Service Layer
 *
 * Centralizes all location-aware logic for the Suppliers module:
 *   - Haversine distance between coordinates
 *   - Maritime hub awareness (major ports with known coordinates)
 *   - Proximity sorting & nearest-hub resolution
 *   - Geo-context for AI enrichment prompts
 *
 * Designed to be provider-agnostic: works with Leaflet today,
 * can feed Google Maps / Deck.gl / Cesium tomorrow.
 */

/* ── Haversine distance (km) ──────────────────────────────────── */

const R_EARTH_KM = 6371;

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

/* ── Maritime Hub Registry ────────────────────────────────────── */

export interface MaritimeHub {
  name: string;
  lat: number;
  lng: number;
  region: string;
  /** Classification: mega-hub, major, regional */
  tier: "mega" | "major" | "regional";
}

/**
 * Known maritime hubs — major ship supply & logistics ports.
 * Used for:
 *   - Nearest-hub resolution for suppliers
 *   - Enrichment context (what hub is nearby)
 *   - Proximity relevance scoring
 *   - Future: cluster anchors on map
 */
export const MARITIME_HUBS: MaritimeHub[] = [
  // ── Asia-Pacific ──
  { name: "Singapore",       lat:  1.2644, lng: 103.8222, region: "Southeast Asia", tier: "mega" },
  { name: "Shanghai",        lat: 31.2304, lng: 121.4737, region: "East Asia",      tier: "mega" },
  { name: "Busan",           lat: 35.1028, lng: 129.0403, region: "East Asia",      tier: "major" },
  { name: "Hong Kong",       lat: 22.2783, lng: 114.1747, region: "East Asia",      tier: "major" },
  { name: "Tokyo / Yokohama",lat: 35.4437, lng: 139.6380, region: "East Asia",      tier: "major" },
  { name: "Kaohsiung",       lat: 22.6163, lng: 120.3085, region: "East Asia",      tier: "regional" },

  // ── Middle East ──
  { name: "Fujairah",        lat: 25.1288, lng: 56.3264,  region: "Middle East",    tier: "mega" },
  { name: "Jebel Ali / Dubai",lat:25.0177, lng: 55.0809,  region: "Middle East",    tier: "mega" },
  { name: "Jeddah",          lat: 21.5433, lng: 39.1728,  region: "Middle East",    tier: "major" },
  { name: "Dammam",          lat: 26.4367, lng: 50.1039,  region: "Middle East",    tier: "regional" },

  // ── Europe ──
  { name: "Rotterdam",       lat: 51.9244, lng:  4.4777,  region: "Northwest Europe",tier: "mega" },
  { name: "Hamburg",          lat: 53.5511, lng:  9.9937,  region: "Northwest Europe",tier: "major" },
  { name: "Antwerp",         lat: 51.2194, lng:  4.4025,  region: "Northwest Europe",tier: "major" },
  { name: "Piraeus",         lat: 37.9475, lng: 23.6371,  region: "Mediterranean",  tier: "major" },
  { name: "Istanbul",        lat: 41.0082, lng: 28.9784,  region: "Mediterranean",  tier: "major" },
  { name: "Las Palmas",      lat: 28.1235, lng:-15.4363,  region: "Atlantic",       tier: "major" },
  { name: "Gibraltar",       lat: 36.1408, lng: -5.3536,  region: "Mediterranean",  tier: "regional" },
  { name: "Algeciras",       lat: 36.1275, lng: -5.4535,  region: "Mediterranean",  tier: "regional" },

  // ── Africa ──
  { name: "Durban",          lat:-29.8587, lng: 31.0218,  region: "Southern Africa", tier: "major" },
  { name: "Lagos / Apapa",   lat:  6.4474, lng:  3.3903,  region: "West Africa",    tier: "major" },
  { name: "Mombasa",         lat: -4.0435, lng: 39.6682,  region: "East Africa",    tier: "regional" },

  // ── Americas ──
  { name: "Houston",         lat: 29.7604, lng:-95.3698,  region: "Gulf of Mexico",  tier: "mega" },
  { name: "New Orleans",     lat: 29.9511, lng:-90.0715,  region: "Gulf of Mexico",  tier: "major" },
  { name: "Santos",          lat:-23.9608, lng:-46.3336,  region: "South America",   tier: "major" },
  { name: "Panama (Balboa)", lat:  8.9500, lng:-79.5667,  region: "Central America", tier: "major" },
  { name: "Cartagena",       lat: 10.3910, lng:-75.5144,  region: "Caribbean",       tier: "regional" },

  // ── Indian Subcontinent ──
  { name: "Mumbai / JNPT",   lat: 18.9500, lng: 72.9500,  region: "Indian Subcontinent", tier: "major" },
  { name: "Colombo",         lat:  6.9497, lng: 79.8428,  region: "Indian Subcontinent", tier: "regional" },
];

/* ── Hub Lookups ──────────────────────────────────────────────── */

/**
 * Find the nearest maritime hub to given coordinates.
 * Returns the hub and distance in km.
 */
export function nearestHub(
  lat: number,
  lng: number
): { hub: MaritimeHub; distanceKm: number } {
  let best: MaritimeHub = MARITIME_HUBS[0];
  let bestDist = Infinity;

  for (const hub of MARITIME_HUBS) {
    const d = haversineKm(lat, lng, hub.lat, hub.lng);
    if (d < bestDist) {
      bestDist = d;
      best = hub;
    }
  }

  return { hub: best, distanceKm: Math.round(bestDist) };
}

/**
 * Find all hubs within a given radius (km) of coordinates.
 * Sorted by distance ascending.
 */
export function hubsWithinRadius(
  lat: number,
  lng: number,
  radiusKm: number
): Array<{ hub: MaritimeHub; distanceKm: number }> {
  return MARITIME_HUBS
    .map((hub) => ({ hub, distanceKm: Math.round(haversineKm(lat, lng, hub.lat, hub.lng)) }))
    .filter((h) => h.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Resolve a hub by name (case-insensitive partial match).
 * Useful for mapping port names from supplier data to known hubs.
 */
export function resolveHub(name: string): MaritimeHub | null {
  const lower = name.toLowerCase().trim();
  return (
    MARITIME_HUBS.find((h) => h.name.toLowerCase() === lower) ??
    MARITIME_HUBS.find((h) => h.name.toLowerCase().includes(lower)) ??
    null
  );
}

/* ── Proximity Sorting ────────────────────────────────────────── */

export interface WithCoords {
  lat: number | null;
  lng: number | null;
}

/**
 * Sort items by distance from a reference point.
 * Items without coordinates are pushed to the end.
 * Returns a new sorted array (does not mutate).
 */
export function sortByProximity<T extends WithCoords>(
  items: T[],
  refLat: number,
  refLng: number
): T[] {
  return [...items].sort((a, b) => {
    const aDist = a.lat !== null && a.lng !== null
      ? haversineKm(refLat, refLng, a.lat, a.lng) : Infinity;
    const bDist = b.lat !== null && b.lng !== null
      ? haversineKm(refLat, refLng, b.lat, b.lng) : Infinity;
    return aDist - bDist;
  });
}

/* ── Geo Context for AI Enrichment ────────────────────────────── */

/**
 * Build a location context string for AI enrichment prompts.
 * Gives the model awareness of the maritime geography near the supplier.
 */
export function buildGeoContext(opts: {
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  country?: string | null;
  region?: string | null;
  portsCovered?: string[];
}): string {
  const lines: string[] = [];

  if (opts.lat != null && opts.lng != null) {
    const { hub, distanceKm } = nearestHub(opts.lat, opts.lng);
    lines.push(`Coordinates: ${opts.lat.toFixed(4)}, ${opts.lng.toFixed(4)}`);
    lines.push(`Nearest maritime hub: ${hub.name} (${hub.region}, ${hub.tier} port, ${distanceKm} km away)`);

    const nearby = hubsWithinRadius(opts.lat, opts.lng, 500)
      .filter((h) => h.hub.name !== hub.name)
      .slice(0, 3);
    if (nearby.length > 0) {
      lines.push(`Other hubs within 500 km: ${nearby.map((h) => `${h.hub.name} (${h.distanceKm} km)`).join(", ")}`);
    }
  }

  if (opts.city || opts.country) {
    lines.push(`Location: ${[opts.city, opts.country].filter(Boolean).join(", ")}`);
  }
  if (opts.region) {
    lines.push(`Region: ${opts.region}`);
  }
  if (opts.portsCovered && opts.portsCovered.length > 0) {
    lines.push(`Known ports served: ${opts.portsCovered.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No location data available.";
}

/* ── Bounding Box Helpers ─────────────────────────────────────── */

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Compute a bounding box from a set of coordinates with optional padding (km).
 * Useful for map viewport fitting.
 */
export function computeBounds(
  points: Array<{ lat: number; lng: number }>,
  paddingKm = 50
): BoundingBox | null {
  if (points.length === 0) return null;

  let north = -90, south = 90, east = -180, west = 180;
  for (const p of points) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng > east) east = p.lng;
    if (p.lng < west) west = p.lng;
  }

  // Add padding in degrees (rough: 1 degree ≈ 111 km)
  const padDeg = paddingKm / 111;
  return {
    north: Math.min(90, north + padDeg),
    south: Math.max(-90, south - padDeg),
    east: Math.min(180, east + padDeg),
    west: Math.max(-180, west - padDeg),
  };
}
