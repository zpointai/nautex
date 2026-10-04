import { prisma } from "@/lib/prisma";
import type { VesselResult, VesselRisk, VesselTrackPoint } from "@/types/vessel";

const VESSELFINDER_BASE = "https://www.vesselfinder.com";
const REQUEST_TIMEOUT_MS = 9000;

type SearchMeta = {
  source: "vesselfinder" | "postgres-cache";
  warnings: string[];
};

type SearchResponse = {
  data: VesselResult[];
  meta: SearchMeta;
};

function normalizeSpaces(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function digitsOnly(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function stripHtml(value: string) {
  return normalizeSpaces(value.replace(/<[^>]+>/g, " "));
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function matchFirst(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(stripHtml(match[1]));
  }
  return "";
}

function cleanValue(value: string, fallback = "", maxLength = 90) {
  const clean = normalizeSpaces(value);
  if (!clean) return fallback;
  if (clean.length > maxLength) return fallback;
  if (/[{};]/.test(clean) || /\b(?:background|display|path|svg|inline|viewbox)\b/i.test(clean)) return fallback;
  return clean;
}

function matchAnyGroup(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  if (!match) return "";
  const group = match.slice(1).find(Boolean);
  return group ? decodeHtml(stripHtml(group)) : "";
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const parsed = Number.parseFloat((value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function parseEta(value: string) {
  const clean = cleanValue(value.replace(/^(?:ETA|ATA):\s*/i, ""), "", 50);
  if (!clean) return "";

  const short = clean.match(/([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})/);
  if (short) {
    const [, month, day, hour, minute] = short;
    const year = new Date().getFullYear();
    const parsed = new Date(`${month} ${day}, ${year} ${hour}:${minute}:00 UTC`);
    if (Number.isNaN(parsed.getTime())) return clean;
    const now = Date.now();
    if (parsed.getTime() < now - 180 * 24 * 60 * 60 * 1000) parsed.setUTCFullYear(year + 1);
    return parsed.toISOString();
  }

  const explicit = new Date(clean);
  if (!Number.isNaN(explicit.getTime())) return explicit.toISOString();
  return clean;
}

function makeId(record: Partial<VesselResult>) {
  if (record.imo) return `imo-${record.imo}`;
  if (record.mmsi) return `mmsi-${record.mmsi}`;
  return `vessel-${normalizeSpaces(record.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function hasApproximateCoordinates(coordinates: { lat: number; lng: number }) {
  return Number.isInteger(coordinates.lat) && Number.isInteger(coordinates.lng);
}

async function fetchHtml(url: string, options: { noStore?: boolean } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 NautexAI/1.0 maritime-operations",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      ...(options.noStore ? { cache: "no-store" as const } : { next: { revalidate: 300 } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function detailUrlsFromHtml(html: string) {
  const urls = new Set<string>();
  const detailPattern = /href=["']([^"']*\/vessels\/details\/\d+[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = detailPattern.exec(html)) !== null) {
    const href = decodeHtml(match[1]);
    urls.add(href.startsWith("http") ? href : `${VESSELFINDER_BASE}${href.startsWith("/") ? href : `/${href}`}`);
  }
  return [...urls];
}

function extractDjson(html: string) {
  const raw = html.match(/id=["']djson["'][^>]*data-json='([^']+)'/i)?.[1];
  if (!raw) return null;
  try {
    const payload = JSON.parse(decodeHtml(raw)) as Record<string, unknown>;
    const lat = toNumber(payload.ship_lat as string | number | undefined);
    const lng = toNumber(payload.ship_lon as string | number | undefined);
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    return {
      lat,
      lng,
      speed: toNumber(payload.ship_sog as string | number | undefined),
      course: toNumber(payload.ship_cog as string | number | undefined),
    };
  } catch {
    return null;
  }
}

function extractCoordinates(html: string) {
  const djson = extractDjson(html);
  if (djson) return { lat: djson.lat, lng: djson.lng };

  const candidates: Array<[RegExp, RegExp]> = [
    [ /["']LATITUDE["']\s*:\s*(-?\d+(?:\.\d+)?)/i, /["']LONGITUDE["']\s*:\s*(-?\d+(?:\.\d+)?)/i ],
    [/Latitude\s*[:<][^-\d]*(-?\d+(?:\.\d+)?)/i, /Longitude\s*[:<][^-\d]*(-?\d+(?:\.\d+)?)/i],
    [/"latitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i, /"longitude"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i],
    [/"lat"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i, /"lon(?:g)?"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/i],
    [/data-lat=["'](-?\d+(?:\.\d+)?)["']/i, /data-lon=["'](-?\d+(?:\.\d+)?)["']/i],
  ];

  for (const [latPattern, lngPattern] of candidates) {
    const lat = toNumber(html.match(latPattern)?.[1]);
    const lng = toNumber(html.match(lngPattern)?.[1]);
    if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
  }
  return null;
}

function extractImageUrl(html: string, mmsi?: string) {
  const fromMainPhoto = matchFirst(html, [
    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*main-photo[^"']*["']/i,
    /<img[^>]+class=["'][^"']*main-photo[^"']*["'][^>]+src=["']([^"']+)["']/i,
  ]);
  const fromMeta = fromMainPhoto || matchFirst(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<img[^>]+class=["'][^"']*(?:ship-photo|vessel-photo|main-photo)[^"']*["'][^>]+src=["']([^"']+)["']/i,
  ]);
  if (fromMeta && !/logo|placeholder|default|cool-ship/i.test(fromMeta)) {
    return fromMeta.startsWith("http") ? fromMeta : `${VESSELFINDER_BASE}${fromMeta.startsWith("/") ? fromMeta : `/${fromMeta}`}`;
  }
  return mmsi ? `https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=${mmsi}&size=large` : undefined;
}

function extractVoyageDestination(html: string) {
  return cleanValue(matchAnyGroup(
    html,
    /<div[^>]+class=["'][^"']*vilabel[^"']*["'][^>]*>\s*Destination\s*<\/div>[\s\S]{0,700}?(?:<a[^>]+class=["'][^"']*_npNa[^"']*["'][^>]*>([\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*_3-Yih[^"']*["'][^>]*>([\s\S]*?)<\/div>)/i
  ), "", 70);
}

function extractVoyageEta(html: string) {
  return cleanValue(matchFirst(html, [
    /<span[^>]+class=["'][^"']*_mcol12(?:ext)?[^"']*["'][^>]*>\s*((?:ETA|ATA):\s*[^<]+)<\/span>/i,
  ]), "", 60);
}

function extractTableValue(html: string, label: string, maxLength = 70) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cleanValue(matchAnyGroup(
    html,
    new RegExp(`<td[^>]*>\\s*${escaped}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i")
  ), "", maxLength);
}

function parseDetailPage(html: string, sourceUrl: string): VesselResult | null {
  const text = stripHtml(html);
  const name =
    matchFirst(html, [
      /<h1[^>]*>([^<]+)<\/h1>/i,
      /<title>\s*([^|<]+?)\s*(?:-|AIS|VesselFinder)/i,
      /"name"\s*:\s*"([^"]+)"/i,
    ]) ||
    matchFirst(text, [/^([A-Z0-9][A-Z0-9 .'\-]+)\s+(?:[A-Z][a-z]+ Ship|.+?, IMO)/]) ||
    "Unknown vessel";

  const imo = digitsOnly(matchFirst(text, [
    /IMO\s*(?:number)?\s*\/?\s*MMSI\s+(\d{7})\s*\/\s*\d{9}/i,
    /IMO number\s+(\d{7})/i,
    /IMO\s+(\d{7})/i,
  ]));
  const mmsi = digitsOnly(matchFirst(text, [/IMO\s*\/\s*MMSI\s+\d{7}\s*\/\s*(\d{9})/i, /MMSI\s+(\d{9})/i]));
  const coordinates = extractCoordinates(html);
  if (!coordinates) return null;

  const djson = extractDjson(html);
  const speedSentence = text.match(/sailing at a speed of\s*([\d.]+)\s*knots/i)?.[1];
  const courseSpeed = matchFirst(text, [/Course\s*\/\s*Speed\s*([^\n]+)/i]);
  const speed = djson?.speed ?? toNumber(speedSentence || courseSpeed.match(/([\d.]+)\s*kn/i)?.[1]) ?? 0;
  const course = djson?.course ?? toNumber(courseSpeed.match(/(\d+(?:\.\d+)?)\s*(?:°|&deg;|deg)/i)?.[1]) ?? 0;
  const heading = toNumber(matchFirst(text, [/Heading\s+(\d+(?:\.\d+)?)/i])) ?? course;
  const destination = extractVoyageDestination(html) || cleanValue(matchFirst(text, [
    /Destination\s+(.+?)\s+(?:ETA:|ATA:|Predicted ETA|Distance \/ Time|Course \/ Speed|Current draught)/i,
    /en route to the port of\s+(.+?)(?:, sailing| and expected|\. The vessel)/i,
    /arrived at the port of\s+(.+?)\s+on\s+/i,
  ]), "", 70);
  const etaText = extractVoyageEta(html) || cleanValue(matchFirst(text, [
    /ETA:\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{1,2}:\d{2})/i,
    /ATA:\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{1,2}:\d{2}(?:\s*UTC)?)/i,
    /(ETA:\s*.+?)(?:\s+Predicted ETA|\s+Distance \/ Time|\s+Course \/ Speed|\s+Current draught)/i,
    /(ATA:\s*.+?)(?:\s+ARRIVED|\s+Predicted ETA|\s+Distance \/ Time|\s+Course \/ Speed)/i,
    /expected to arrive there on\s+(.+?)\./i,
  ]), "", 60);
  const headingLine = matchFirst(html, [/<h2[^>]*>([^<]+)<\/h2>/i]);
  const type = extractTableValue(html, "Ship Type") || cleanValue(matchFirst(text, [
    /Ship Type\s+(.+?)(?:\s+Flag|\s+Year of Build)/i,
    /Vessel Type\s+(.+?)(?:\s+Flag|\s+Year of Build)/i,
  ]), "", 60);
  const flag = extractTableValue(html, "AIS Flag") || cleanValue(matchFirst(text, [/AIS Flag\s+(.+?)(?:\s+Length \/ Beam|\s+Last Port)/i, /Flag\s+(.+?)(?:\s+Year of Build|\s+Length Overall)/i]), "", 60);
  const status = extractTableValue(html, "Navigation Status") || cleanValue(matchFirst(text, [/Navigation Status\s+(.+?)(?:\s+Position received|\s+IMO \/ MMSI)/i]), "Position received", 40);
  const draught = toNumber(extractTableValue(html, "Current draught") || matchFirst(text, [/Current draught\s+([\d.]+)/i]));
  const dimensions = extractTableValue(html, "Length / Beam") || matchFirst(text, [/Length \/ Beam\s+(.+?)(?:\s+Last Port|\s+Ship position)/i]);
  const [length, beam] = dimensions.split("/").map((part) => toNumber(part));
  const warnings = hasApproximateCoordinates(coordinates)
    ? ["The public vessel source returned approximate coordinates for this position."]
    : [];

  const result: VesselResult = {
    id: makeId({ imo, mmsi, name }),
    mmsi,
    imo: imo || undefined,
    name: normalizeSpaces(name.replace(/\s+position\s+and\s+details.*$/i, "")),
    flag: flag || undefined,
    type: type || headingLine.replace(/,\s*IMO\s*\d{7}.*/i, "") || undefined,
    lat: coordinates.lat,
    lng: coordinates.lng,
    speed,
    heading,
    course,
    destination: cleanValue(destination, "Destination not available", 70),
    eta: etaText ? parseEta(etaText) : "",
    status,
    timestamp: new Date().toISOString(),
    src: "vesselfinder-public",
    sourceLabel: "Live maritime source",
    sourceUrl,
    imageUrl: extractImageUrl(html, mmsi),
    confidence: mmsi || imo ? "High" : "Medium",
    warnings,
    draught,
    length,
    beam,
  };
  return result;
}

async function searchVesselFinder(query: string, options: { noStore?: boolean } = {}) {
  const clean = query.trim();
  const warnings: string[] = [];
  const detailUrls = new Set<string>();

  if (/^\d{7}$/.test(clean)) detailUrls.add(`${VESSELFINDER_BASE}/vessels/details/${clean}`);

  const terms = /^\d{9}$/.test(clean)
    ? [`mmsi=${encodeURIComponent(clean)}`]
    : [`name=${encodeURIComponent(clean)}`];

  for (const term of terms) {
    try {
      const html = await fetchHtml(`${VESSELFINDER_BASE}/vessels?${term}`, options);
      detailUrlsFromHtml(html).forEach((url) => detailUrls.add(url));
    } catch (err) {
      warnings.push(`Live vessel search unavailable: ${err instanceof Error ? err.message : "request failed"}.`);
    }
  }

  const results: VesselResult[] = [];
  for (const url of [...detailUrls].slice(0, 8)) {
    try {
      const html = await fetchHtml(url, options);
      const parsed = parseDetailPage(html, url);
      if (parsed) results.push(parsed);
    } catch {
      warnings.push("One vessel detail page could not be read.");
    }
  }

  const normalized = clean.toLowerCase();
  const deduped = new Map<string, VesselResult>();
  for (const vessel of results) {
    const key = vessel.imo || vessel.mmsi || vessel.id;
    const nameMatch = vessel.name.toLowerCase().includes(normalized);
    const idMatch = vessel.imo === clean || vessel.mmsi === clean;
    if (nameMatch || idMatch || /^\d+$/.test(clean)) deduped.set(key, vessel);
  }
  const ranked = [...deduped.values()].sort((a, b) => vesselRank(b, normalized) - vesselRank(a, normalized));
  return { data: ranked, warnings };
}

function vesselRank(vessel: VesselResult, normalizedQuery: string) {
  let score = 0;
  if (vessel.name.toLowerCase() === normalizedQuery) score += 20;
  if (vessel.imo) score += 18;
  if (vessel.imageUrl && !/marinetraffic|cool-ship|placeholder/i.test(vessel.imageUrl)) score += 12;
  if (vessel.destination && !/not available/i.test(vessel.destination)) score += 8;
  if (vessel.type && !/mmsi/i.test(vessel.type)) score += 5;
  if (vessel.flag) score += 2;
  return score;
}

function fromDb(vessel: NonNullable<Awaited<ReturnType<typeof prisma.vessel.findFirst>>>): VesselResult {
  return {
    id: vessel.id,
    mmsi: vessel.mmsi,
    imo: vessel.imo ?? undefined,
    name: vessel.name,
    callsign: vessel.callsign ?? undefined,
    flag: vessel.flag ?? undefined,
    type: vessel.type ?? undefined,
    lat: vessel.lat,
    lng: vessel.lng,
    speed: vessel.speed,
    heading: vessel.heading,
    course: vessel.course,
    destination: vessel.destination,
    eta: toIso(vessel.eta),
    status: vessel.status,
    timestamp: toIso(vessel.timestamp),
    zone: vessel.zone ?? undefined,
    src: vessel.src ?? "postgres-cache",
    sourceLabel: "Local tracking cache",
    confidence: "Medium",
    warnings: [],
    draught: vessel.draught ?? undefined,
    length: vessel.length ?? undefined,
    beam: vessel.beam ?? undefined,
  };
}

async function searchCache(query: string) {
  const clean = query.trim();
  const dbMatches = await prisma.vessel.findMany({
    where: {
      OR: [
        { name: { contains: clean, mode: "insensitive" } },
        { mmsi: { contains: clean } },
        { imo: { contains: clean } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  return dbMatches.map(fromDb);
}

export async function cacheVessel(vessel: VesselResult) {
  if (!vessel.mmsi || !Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lng)) return null;
  return prisma.vessel.upsert({
    where: { mmsi: vessel.mmsi },
    create: {
      mmsi: vessel.mmsi,
      imo: vessel.imo ?? null,
      name: vessel.name,
      callsign: vessel.callsign ?? null,
      flag: vessel.flag ?? null,
      type: vessel.type ?? null,
      lat: vessel.lat,
      lng: vessel.lng,
      speed: vessel.speed,
      heading: Math.round(vessel.heading),
      course: Math.round(vessel.course),
      destination: vessel.destination,
      eta: vessel.eta || "",
      status: vessel.status,
      timestamp: new Date(vessel.timestamp),
      zone: vessel.zone ?? null,
      src: vessel.src ?? "vesselfinder-public",
      draught: vessel.draught ?? null,
      length: typeof vessel.length === "number" ? Math.round(vessel.length) : null,
      beam: typeof vessel.beam === "number" ? Math.round(vessel.beam) : null,
    },
    update: {
      imo: vessel.imo ?? null,
      name: vessel.name,
      callsign: vessel.callsign ?? null,
      flag: vessel.flag ?? null,
      type: vessel.type ?? null,
      lat: vessel.lat,
      lng: vessel.lng,
      speed: vessel.speed,
      heading: Math.round(vessel.heading),
      course: Math.round(vessel.course),
      destination: vessel.destination,
      eta: vessel.eta || "",
      status: vessel.status,
      timestamp: new Date(vessel.timestamp),
      zone: vessel.zone ?? null,
      src: vessel.src ?? "vesselfinder-public",
      draught: vessel.draught ?? null,
      length: typeof vessel.length === "number" ? Math.round(vessel.length) : null,
      beam: typeof vessel.beam === "number" ? Math.round(vessel.beam) : null,
    },
  });
}

export async function searchVessels(query: string, options: { noStore?: boolean } = {}): Promise<SearchResponse> {
  const live = await searchVesselFinder(query, options);
  if (live.data.length > 0) {
    await Promise.all(live.data.map((vessel) => cacheVessel(vessel).catch(() => null)));
    return { data: live.data, meta: { source: "vesselfinder", warnings: live.warnings } };
  }

  const cached = await searchCache(query);
  return {
    data: cached,
    meta: {
      source: "postgres-cache",
      warnings: live.warnings.length > 0 ? live.warnings : ["No live VesselFinder match was found."],
    },
  };
}

export async function recordVesselSnapshot(vessel: {
  id: string;
  mmsi?: string | null;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  src?: string | null;
  timestamp: Date | string;
}) {
  if (!vessel.mmsi) return null;
  return prisma.vesselTrackHistory.create({
    data: {
      vesselId: vessel.id,
      mmsi: vessel.mmsi,
      lat: vessel.lat,
      lng: vessel.lng,
      speed: vessel.speed,
      heading: vessel.heading,
      source: vessel.src ?? "vesselfinder-public",
      timestamp: vessel.timestamp instanceof Date ? vessel.timestamp : new Date(vessel.timestamp),
    },
  });
}

export async function getVesselTrack(vessel: { mmsi?: string | null; lat: number; lng: number; speed: number }, limit = 12) {
  if (!vessel.mmsi) return [];

  const history = await prisma.vesselTrackHistory.findMany({
    where: { mmsi: vessel.mmsi },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  if (history.length > 0) {
    return history.reverse().map((point): VesselTrackPoint => ({
      timestamp: point.timestamp.toISOString(),
      lat: point.lat,
      lng: point.lng,
      speed: point.speed,
      source: point.source ?? undefined,
    }));
  }

  return [];
}

export async function getRecentTrackedVessels(limit = 8) {
  const history = await prisma.vesselTrackHistory.findMany({
    orderBy: { timestamp: "desc" },
    take: Math.max(limit * 6, limit),
  });

  const mmsis: string[] = [];
  const seen = new Set<string>();
  for (const point of history) {
    if (seen.has(point.mmsi)) continue;
    seen.add(point.mmsi);
    mmsis.push(point.mmsi);
    if (mmsis.length >= limit) break;
  }

  if (mmsis.length === 0) return [];

  const vessels = await prisma.vessel.findMany({
    where: { mmsi: { in: mmsis } },
  });
  const byMmsi = new Map(vessels.map((vessel) => [vessel.mmsi, vessel]));

  const ordered: typeof vessels = [];
  for (const mmsi of mmsis) {
    const vessel = byMmsi.get(mmsi);
    if (vessel) ordered.push(vessel);
  }
  return ordered.map(fromDb);
}

export async function deleteRecentTrackedVessel(mmsi: string) {
  const clean = digitsOnly(mmsi);
  if (!clean) return { deletedCount: 0 };
  const result = await prisma.vesselTrackHistory.deleteMany({
    where: { mmsi: clean },
  });
  return { deletedCount: result.count };
}

export async function getVesselById(id: string) {
  const clean = id.replace(/^imo-/, "").replace(/^mmsi-/, "");
  const db = await prisma.vessel.findFirst({
    where: {
      OR: [{ id }, { mmsi: id }, { imo: id }, { mmsi: clean }, { imo: clean }],
    },
  });
  return db ? fromDb(db) : null;
}

export async function refreshVesselFromSource(id: string) {
  const existing = await getVesselById(id);
  const query = existing?.imo || existing?.mmsi || existing?.name || id.replace(/^imo-|^mmsi-/, "");
  const result = await searchVessels(query, { noStore: true });
  const live =
    result.data.find((vessel) => vessel.id === id || vessel.mmsi === id || vessel.imo === id) ??
    result.data[0] ??
    existing;
  if (live) await cacheVessel(live).catch(() => null);
  return live ? { vessel: live, meta: result.meta } : { vessel: null, meta: result.meta };
}

export function generateTrack(vessel: { lat: number; lng: number; speed: number }): VesselTrackPoint[] {
  const points: VesselTrackPoint[] = [];
  const now = Date.now();
  const steps = 12;

  for (let i = steps - 1; i >= 0; i -= 1) {
    const minutesBack = i * 10;
    const wobble = Math.sin(i / 2) * 0.02;
    points.push({
      timestamp: new Date(now - minutesBack * 60 * 1000).toISOString(),
      lat: vessel.lat - i * 0.015 + wobble,
      lng: vessel.lng - i * 0.02 - wobble,
      speed: Math.max(0, vessel.speed + Math.cos(i / 2) * 0.8),
    });
  }

  return points;
}

export function getEtaRisk(vessel: { id: string; speed: number; status: string }): VesselRisk {
  const status = vessel.status.toLowerCase();
  const isSlow = vessel.speed < 1;
  const isAnchor = status.includes("anchor") || status.includes("moor");
  const isCritical = isSlow || isAnchor;

  if (isCritical) {
    return {
      vesselId: vessel.id,
      confidence: "Medium",
      etaRisk: "Critical",
      summary: "Vessel speed and status indicate likely schedule disruption for connected deliveries.",
      anomalies: ["Speed drop below operational threshold.", "Stationary or anchored state detected."],
    };
  }

  if (vessel.speed < 7) {
    return {
      vesselId: vessel.id,
      confidence: "Low",
      etaRisk: "Monitor",
      summary: "Vessel remains underway but reduced speed increases ETA uncertainty.",
      anomalies: ["Speed trending below operational approach profile."],
    };
  }

  return {
    vesselId: vessel.id,
    confidence: "High",
    etaRisk: "Stable",
    summary: "Vessel trajectory and speed are consistent with planned ETA.",
    anomalies: [],
  };
}
