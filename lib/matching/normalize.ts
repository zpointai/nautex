/**
 * Supplier Matching Pipeline — Normalization & Validation Layer
 *
 * Validates and normalizes raw candidates before ranking.
 * Identifies missing fields, conflicts, and inconsistencies.
 */

import type { RawCandidate, NormalizedCandidate, FieldConflict } from "./types";

/* ── Maritime Region Taxonomy ────────────────────────────────── */

const MARITIME_REGIONS = new Set([
  "Northwest Europe", "Scandinavia / Nordic", "Mediterranean",
  "Southeast Europe / Black Sea", "Middle East", "East Africa",
  "West Africa", "Southern Africa", "Indian Subcontinent",
  "Southeast Asia", "East Asia", "Gulf of Mexico", "Caribbean",
  "South America", "Central America", "North America Atlantic",
  "North America Pacific", "Pacific",
]);

/* ── Country → Region Map (common maritime countries) ────────── */

const COUNTRY_REGION: Record<string, string> = {
  "denmark": "Scandinavia / Nordic", "norway": "Scandinavia / Nordic",
  "sweden": "Scandinavia / Nordic", "finland": "Scandinavia / Nordic",
  "netherlands": "Northwest Europe", "belgium": "Northwest Europe",
  "germany": "Northwest Europe", "uk": "Northwest Europe",
  "united kingdom": "Northwest Europe", "france": "Northwest Europe",
  "ireland": "Northwest Europe",
  "greece": "Mediterranean", "italy": "Mediterranean", "spain": "Mediterranean",
  "turkey": "Southeast Europe / Black Sea", "romania": "Southeast Europe / Black Sea",
  "bulgaria": "Southeast Europe / Black Sea", "ukraine": "Southeast Europe / Black Sea",
  "croatia": "Mediterranean",
  "uae": "Middle East", "united arab emirates": "Middle East",
  "saudi arabia": "Middle East", "oman": "Middle East", "qatar": "Middle East",
  "bahrain": "Middle East", "kuwait": "Middle East",
  "kenya": "East Africa", "tanzania": "East Africa", "mozambique": "East Africa",
  "nigeria": "West Africa", "ghana": "West Africa",
  "south africa": "Southern Africa",
  "india": "Indian Subcontinent", "sri lanka": "Indian Subcontinent",
  "bangladesh": "Indian Subcontinent", "pakistan": "Indian Subcontinent",
  "singapore": "Southeast Asia", "malaysia": "Southeast Asia",
  "indonesia": "Southeast Asia", "philippines": "Southeast Asia",
  "thailand": "Southeast Asia", "vietnam": "Southeast Asia",
  "china": "East Asia", "japan": "East Asia", "south korea": "East Asia",
  "taiwan": "East Asia", "hong kong": "East Asia",
  "usa": "Gulf of Mexico", "united states": "Gulf of Mexico",
  "mexico": "Gulf of Mexico",
  "brazil": "South America", "argentina": "South America", "chile": "South America",
  "colombia": "South America",
  "panama": "Central America", "costa rica": "Central America",
  "canada": "North America Atlantic",
  "australia": "Pacific", "new zealand": "Pacific",
  "poland": "Northwest Europe", "portugal": "Mediterranean",
  "egypt": "Mediterranean",
};

/* ── Email/Domain Validation ─────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+\..+/;

function checkEmailDomainConsistency(email: string | null | undefined, website: string | null | undefined): FieldConflict | null {
  if (!email || !website) return null;
  try {
    const emailDomain = email.split("@")[1]?.toLowerCase();
    const siteDomain = new URL(website).hostname.replace(/^www\./, "").toLowerCase();
    if (emailDomain && siteDomain && !emailDomain.includes(siteDomain) && !siteDomain.includes(emailDomain)) {
      return {
        field: "email",
        issue: `Email domain (${emailDomain}) does not match website domain (${siteDomain})`,
        severity: "warning",
      };
    }
  } catch { /* ignore parse errors */ }
  return null;
}

/* ── Region Normalization ────────────────────────────────────── */

function normalizeRegion(region: string | null | undefined, country: string | null | undefined): string | null {
  // If region is already canonical, keep it
  if (region && MARITIME_REGIONS.has(region)) return region;

  // Try deriving from country
  if (country) {
    const derived = COUNTRY_REGION[country.toLowerCase().trim()];
    if (derived) return derived;
  }

  // Return original if non-null (might be a legacy region name)
  return region ?? null;
}

/* ── Main Normalization Function ─────────────────────────────── */

export function normalizeCandidates(candidates: RawCandidate[]): NormalizedCandidate[] {
  return candidates.map((c) => {
    const conflicts: FieldConflict[] = [];
    const missingFields: string[] = [];

    // Required field checks
    if (!c.name || c.name.trim().length < 2) {
      conflicts.push({ field: "name", issue: "Name is missing or too short", severity: "error" });
    }

    // Key field presence
    if (!c.country) missingFields.push("country");
    if (!c.region) missingFields.push("region");
    if (!c.city) missingFields.push("city");
    if (!c.email) missingFields.push("email");
    if (!c.phone) missingFields.push("phone");
    if (!c.website) missingFields.push("website");
    if (!c.description) missingFields.push("description");
    if (!c.categories || c.categories.length === 0) missingFields.push("categories");

    // Format validation
    if (c.email && !EMAIL_RE.test(c.email)) {
      conflicts.push({ field: "email", issue: `Invalid email format: ${c.email}`, severity: "warning" });
    }
    if (c.website && !URL_RE.test(c.website)) {
      conflicts.push({ field: "website", issue: `Invalid URL format: ${c.website}`, severity: "warning" });
    }

    // Domain consistency
    const domainConflict = checkEmailDomainConsistency(c.email, c.website);
    if (domainConflict) conflicts.push(domainConflict);

    // Region normalization
    const normalizedRegion = normalizeRegion(c.region, c.country);

    // Region-country consistency
    if (c.country && normalizedRegion) {
      const expectedRegion = COUNTRY_REGION[c.country.toLowerCase().trim()];
      if (expectedRegion && expectedRegion !== normalizedRegion && c.region !== null) {
        conflicts.push({
          field: "region",
          issue: `Region "${c.region}" may not match country "${c.country}" (expected: ${expectedRegion})`,
          severity: "warning",
        });
      }
    }

    // Coordinate sanity
    if (c.lat !== null && c.lat !== undefined && (c.lat < -90 || c.lat > 90)) {
      conflicts.push({ field: "lat", issue: `Latitude ${c.lat} out of range`, severity: "error" });
    }
    if (c.lng !== null && c.lng !== undefined && (c.lng < -180 || c.lng > 180)) {
      conflicts.push({ field: "lng", issue: `Longitude ${c.lng} out of range`, severity: "error" });
    }

    const hasErrors = conflicts.some((c) => c.severity === "error");

    return {
      ...c,
      region: normalizedRegion,
      // Trim whitespace from string fields
      name: c.name?.trim() ?? "",
      city: c.city?.trim() ?? null,
      country: c.country?.trim() ?? null,
      address: c.address?.trim() ?? null,
      conflicts,
      missingFields,
      isValid: !hasErrors,
    };
  });
}
