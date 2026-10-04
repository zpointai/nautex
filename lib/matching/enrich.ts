/**
 * Supplier Matching Pipeline — Enrichment Layer
 *
 * Ported from Firebase Function 4 (enrichSupplierData).
 * Uses Google Places Text Search API and the active AI provider for candidate enrichment.
 *
 * v3 improvements:
 *   - Multi-result Google Places: fetches up to 5 results, scores by name similarity
 *   - Best-match selection: picks the Places result closest to the query name
 *   - For Find Supplier: returns up to 3 Places candidates (not just the top one)
 *   - For AI Suggest: only uses Places data if name match is strong enough
 *   - AI suggestions still require review when no good Places match exists
 */

import { generateJSON } from "@/lib/ai/provider";
import type { RawCandidate, NormalizedCandidate, MatchQuery } from "./types";

/* -- Config ------------------------------------------------------- */

function getMapsKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

/* -- Google Places Text Search ------------------------------------ */

export interface PlacesResult {
  found: boolean;
  displayName?: string;
  address?: string;
  phone?: string;
  website?: string;
  lat?: number | null;
  lng?: number | null;
  /** How well the Places displayName matches the query (0-1) */
  nameMatchScore?: number;
}

/** Raw place from the Google Places API response */
interface GooglePlaceRaw {
  displayName?: { text?: string } | string;
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
}

/**
 * Search Google Places and return ALL matching results (up to maxResults).
 * Each result is scored by name similarity to the query.
 */
export async function searchGooglePlacesMulti(
  companyName: string,
  opts?: {
    country?: string;
    city?: string;
    searchMode?: "identity" | "discovery";
    maxResults?: number;
  },
): Promise<PlacesResult[]> {
  const mapsKey = getMapsKey();
  if (!mapsKey) return [];

  let textQuery = companyName.trim();

  if (opts?.searchMode === "discovery") {
    textQuery += " marine supplier";
  }

  if (opts?.city) {
    textQuery += ` ${opts.city}`;
  } else if (opts?.country) {
    textQuery += ` ${opts.country}`;
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": mapsKey,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.location",
      },
      body: JSON.stringify({ textQuery }),
    });

    if (!res.ok) {
      console.error(`[enrich] Google Places API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const places: GooglePlaceRaw[] = data.places ?? [];

    if (places.length === 0) return [];

    const maxResults = opts?.maxResults ?? 5;
    const queryNameNorm = normalizePlacesName(companyName);

    return places.slice(0, maxResults).map((p) => {
      const displayName =
        (typeof p.displayName === "object" ? p.displayName?.text : p.displayName) || "";
      const nameScore = computeNameSimilarity(queryNameNorm, normalizePlacesName(displayName));

      return {
        found: true,
        displayName: displayName || undefined,
        address: p.formattedAddress || undefined,
        phone: p.internationalPhoneNumber || undefined,
        website: p.websiteUri || undefined,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        nameMatchScore: nameScore,
      };
    });
  } catch (err) {
    console.error("[enrich] Google Places search failed:", err);
    return [];
  }
}

/**
 * Search Google Places for a company — returns the BEST matching result.
 *
 * Improvement over v2: examines all results and picks the one with the
 * highest name similarity, not just places[0].
 */
export async function searchGooglePlaces(
  companyName: string,
  opts?: { country?: string; city?: string; searchMode?: "identity" | "discovery" },
): Promise<PlacesResult> {
  const results = await searchGooglePlacesMulti(companyName, { ...opts, maxResults: 5 });

  if (results.length === 0) return { found: false };

  // Sort by name match score descending, pick the best
  results.sort((a, b) => (b.nameMatchScore ?? 0) - (a.nameMatchScore ?? 0));
  return results[0];
}

/**
 * Search Google Places and return the best match ONLY if the name similarity
 * is above a threshold. Used by AI Suggest to avoid filling forms with
 * wrong company data when the query is ambiguous.
 *
 * @param minScore — minimum name similarity to accept (default 0.4)
 */
export async function searchGooglePlacesBestMatch(
  companyName: string,
  opts?: {
    country?: string;
    city?: string;
    searchMode?: "identity" | "discovery";
    minScore?: number;
  },
): Promise<PlacesResult & { allResults?: PlacesResult[] }> {
  const results = await searchGooglePlacesMulti(companyName, { ...opts, maxResults: 5 });

  if (results.length === 0) return { found: false };

  // Sort by name match score descending
  results.sort((a, b) => (b.nameMatchScore ?? 0) - (a.nameMatchScore ?? 0));

  const best = results[0];
  const minScore = opts?.minScore ?? 0.4;

  if ((best.nameMatchScore ?? 0) < minScore) {
    // No result matches the query name well enough
    return { found: false, allResults: results };
  }

  return { ...best, allResults: results };
}

/* -- Name Similarity Scoring -------------------------------------- */

/**
 * Normalize a company name for comparison.
 * Strips legal suffixes, punctuation, and extra whitespace.
 */
function normalizePlacesName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Remove common legal suffixes
    .replace(
      /\b(b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|inc\.?|co\.?|corp\.?|gmbh|s\.?a\.?|s\.?r\.?l\.?|pte\.?|pvt\.?|pty\.?|a\.?s\.?|a\/s|plc\.?|ag|oy|ab)\b/gi,
      "",
    )
    // Remove punctuation
    .replace(/['".,()&\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compute similarity between the query name and a Places result name.
 * Returns 0-1 score.
 *
 * Factors:
 *   - Exact match after normalization (1.0)
 *   - One contains the other (0.85)
 *   - High word overlap (proportional)
 *   - Initials/acronym match (0.6)
 */
function computeNameSimilarity(queryNorm: string, candidateNorm: string): number {
  if (!queryNorm || !candidateNorm) return 0;

  // Exact match
  if (queryNorm === candidateNorm) return 1.0;

  // One contains the other — score depends on word-level coverage.
  // "De Waal" in "De Waal B.V." → query covers 2/2 candidate words → high score
  // "De Waal" in "Amsterdamsche Eetsalon de Waal" → query covers 2/4 words → lower score
  // "Kroonint" in "Kroonint Cleaning Coating Products" → query covers 1/4 words, but 1/1 query words matched → decent
  const qWords = queryNorm.split(/\s+/).filter((w) => w.length > 1);
  const cWords = candidateNorm.split(/\s+/).filter((w) => w.length > 1);

  if (candidateNorm.includes(queryNorm)) {
    // What fraction of candidate words does the query cover?
    const coveredCandidateWords = cWords.filter((cw) =>
      qWords.some((qw) => cw.includes(qw) || qw.includes(cw)),
    ).length;
    const wordCoverage = cWords.length > 0 ? coveredCandidateWords / cWords.length : 1;

    // Query is a leading/starting substring → stronger signal
    const isPrefix = candidateNorm.startsWith(queryNorm);

    if (isPrefix) {
      // High coverage (≥0.8): candidate is essentially the query + legal suffix
      // "Wrist Ship Supply" → "Wrist Ship Supply AS" → wordCoverage ≈ 0.75-1.0
      if (wordCoverage >= 0.8) {
        return 0.70 + wordCoverage * 0.22;
      }
      // Lower coverage: the candidate adds meaningful extra words beyond the query.
      // This often means a DIFFERENT entity that shares the name prefix.
      // "De Waal" → "De Waal Culemborg" (car dealer): coverage=0.667 → 0.64
      // "Kroonint" → "Kroonint Protective Coating": coverage=0.333 → 0.54
      // Both stay below 0.65 (AI Suggest threshold) but above 0.35 (Find Supplier).
      // When the user types the FULL name, exact/high-coverage match kicks in.
      return 0.45 + wordCoverage * 0.28;
    }
    return 0.45 + wordCoverage * 0.35;
  }
  if (queryNorm.includes(candidateNorm)) {
    const coveredQueryWords = qWords.filter((qw) =>
      cWords.some((cw) => cw.includes(qw) || qw.includes(cw)),
    ).length;
    const wordCoverage = qWords.length > 0 ? coveredQueryWords / qWords.length : 1;
    return 0.40 + wordCoverage * 0.40;
  }

  // Word-level analysis (qWords and cWords already defined above)
  if (qWords.length === 0 || cWords.length === 0) return 0.05;

  // Count how many query words appear in the candidate
  const matchedQueryWords = qWords.filter((qw) =>
    cWords.some((cw) => cw.includes(qw) || qw.includes(cw)),
  ).length;

  // Count how many candidate words appear in the query
  const matchedCandidateWords = cWords.filter((cw) =>
    qWords.some((qw) => qw.includes(cw) || cw.includes(qw)),
  ).length;

  // Bi-directional overlap: average of both directions
  const queryRecall = matchedQueryWords / qWords.length;
  const candidatePrecision = matchedCandidateWords / cWords.length;
  const wordScore = (queryRecall + candidatePrecision) / 2;

  if (wordScore >= 0.7) return 0.65 + wordScore * 0.15;

  // Initials/acronym check (e.g. "GAC" vs "Gulf Agency Company")
  if (queryNorm.replace(/\s+/g, "").length <= 5 && cWords.length >= 2) {
    const initials = cWords.map((w) => w[0]).join("");
    const queryCompact = queryNorm.replace(/\s+/g, "");
    if (initials.includes(queryCompact) || queryCompact.includes(initials)) {
      return 0.6;
    }
  }

  // Some word overlap
  if (matchedQueryWords > 0) return 0.15 + queryRecall * 0.35;

  return 0.05;
}

/* -- Google Maps Geocoding (fallback for address -> coords) ------- */

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const mapsKey = getMapsKey();
  if (!mapsKey || !address) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const coords = data.results?.[0]?.geometry?.location;
    return coords ? { lat: coords.lat, lng: coords.lng } : null;
  } catch {
    return null;
  }
}

/* -- Active-provider Description Generation ---------------------- */

interface AICompanyProfile {
  description?: string;
  categories?: string[];
  portsCovered?: string[];
  provider?: string;
  model?: string;
}

async function generateCompanyProfile(
  companyName: string,
  context: { address?: string; website?: string; existingDescription?: string },
): Promise<AICompanyProfile> {
  const contextParts: string[] = [];
  if (context.address) contextParts.push(`Address: ${context.address}`);
  if (context.website) contextParts.push(`Website: ${context.website}`);
  if (context.existingDescription) contextParts.push(`Known info: ${context.existingDescription}`);

  const prompt = `Generate a brief supplier profile for "${companyName}".
${contextParts.length > 0 ? `Context: ${contextParts.join(". ")}.` : ""}

Return JSON:
{
  "description": "1-2 sentence factual description of what this company does",
  "categories": ["category1", "category2"],
  "portsCovered": ["port1", "port2"]
}

Rules:
- Description must be factual — do not invent capabilities
- Categories should be from: Provisions, Deck Supplies, Engine Stores, Safety Equipment, Cabin Stores, Technical Stores, Spare Parts, Navigation Equipment, Bonded Stores, Chemicals, Paints & Coatings, Mooring, Welding, Tools, Electrical, HVAC, Lubricants, Water Treatment, Valves & Fittings, General Chandlery
- If you cannot determine categories or ports confidently, return empty arrays
- Ports should be real port names the company is known to serve`;

  const result = await generateJSON<AICompanyProfile>(prompt, {
    tier: "fast",
    temperature: 0.2,
    systemInstruction: "Return only factual, verifiable company information. Never fabricate.",
  });

  return result.ok && result.data ? { ...result.data, provider: result.provider, model: result.model } : {};
}

/* -- Candidate Enrichment (batch) --------------------------------- */

/**
 * Enrich match candidates with Google Places data.
 *
 * v3 improvement: uses searchGooglePlacesBestMatch so we only merge Places
 * data when the name actually matches the candidate — prevents enriching
 * "Company X" with data from a different "Company Y" that happens to be
 * the top Places result.
 */
export async function enrichCandidates(
  candidates: NormalizedCandidate[],
  query: MatchQuery,
): Promise<NormalizedCandidate[]> {
  const mapsKey = getMapsKey();
  if (!mapsKey) return candidates;

  const enriched = await Promise.all(
    candidates.map(async (c) => {
      const hasAddress = !!c.address?.trim();
      const hasPhone = !!c.phone?.trim();
      const hasWebsite = !!c.website?.trim();
      const hasCoords = c.lat != null && c.lng != null;

      if (c.sourceTag === "internal_db" && hasAddress && hasPhone && hasCoords) {
        return c;
      }

      if (c.sourceTag === "google_places") {
        return c;
      }

      try {
        // Use best-match search — only enriches if Places name matches this candidate
        const places = await searchGooglePlacesBestMatch(c.name, {
          country: c.country || query.country || undefined,
          city: c.city || undefined,
          searchMode: query.searchMode || "identity",
          minScore: 0.35,
        });

        if (!places.found) return c;

        const merged = { ...c };

        if (!hasAddress && places.address) {
          merged.address = places.address;
          merged.missingFields = merged.missingFields.filter((f) => f !== "address");
        }
        if (!hasPhone && places.phone) {
          merged.phone = places.phone;
          merged.missingFields = merged.missingFields.filter((f) => f !== "phone");
        }
        if (!hasWebsite && places.website) {
          merged.website = places.website;
          merged.missingFields = merged.missingFields.filter((f) => f !== "website");
        }
        if (!hasCoords && places.lat != null && places.lng != null) {
          merged.lat = places.lat;
          merged.lng = places.lng;
        }

        merged.sourceMeta = {
          ...merged.sourceMeta,
          placesVerified: true,
          placesDisplayName: places.displayName,
          placesNameMatchScore: places.nameMatchScore,
        };

        return merged;
      } catch {
        return c;
      }
    }),
  );

  return enriched;
}

/* -- Google Places as a Retrieval Source (multi-candidate) --------- */

/**
 * Search Google Places as a candidate retrieval source.
 *
 * v3: Returns up to 3 candidates from Google Places (not just 1).
 * Each result becomes an independent candidate that gets ranked by
 * the pipeline's identity/name matching system.
 */
export async function retrieveFromGooglePlaces(
  query: MatchQuery,
): Promise<RawCandidate[]> {
  if (!query.name) return [];

  const mapsKey = getMapsKey();
  if (!mapsKey) return [];

  const results = await searchGooglePlacesMulti(query.name, {
    country: query.country || undefined,
    city: undefined,
    searchMode: query.searchMode || "identity",
    maxResults: 5,
  });

  if (results.length === 0) return [];

  // Sort by name match score and take top 3
  const sorted = [...results].sort(
    (a, b) => (b.nameMatchScore ?? 0) - (a.nameMatchScore ?? 0),
  );
  const topResults = sorted.slice(0, 3);

  // Generate profiles using the active provider.
  const candidates = await Promise.all(
    topResults.map(async (place) => {
      if (!place.displayName) return null;

      let profile: AICompanyProfile = {};
      try {
        profile = await generateCompanyProfile(place.displayName, {
          address: place.address,
          website: place.website,
        });
      } catch {
        // Non-fatal
      }

      const addressParts = place.address?.split(",").map((p) => p.trim()) ?? [];
      const country =
        addressParts.length > 0 ? addressParts[addressParts.length - 1] : null;
      const city =
        addressParts.length > 2 ? addressParts[addressParts.length - 2] : null;

      return {
        name: place.displayName,
        country,
        city,
        address: place.address || null,
        phone: place.phone || null,
        website: place.website || null,
        description: profile.description || null,
        categories: profile.categories || [],
        portsCovered: profile.portsCovered || [],
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        sourceTag: "google_places" as const,
        existingSupplierId: null,
        sourceMeta: {
          placesVerified: true,
          placesDisplayName: place.displayName,
          placesNameMatchScore: place.nameMatchScore,
          source: profile.provider ? `Google Places + ${profile.provider} (AI suggestions require review)` : "Google Places",
          provider: profile.provider,
          model: profile.model,
        },
      };
    }),
  );

  return candidates.filter((c) => c !== null) as RawCandidate[];
}
