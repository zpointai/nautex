/**
 * Supplier Matching Pipeline — Retrieval Layer
 *
 * Multi-source candidate retrieval with search mode awareness.
 *
 * Sources:
 *   1. Internal DB — fuzzy name + region/category search on existing suppliers
 *   2. Google Places — company identity verification via Places API
 *   3. AI-generated — active-provider suggestions requiring source verification
 *
 * Key improvements (v2):
 *   - Detects identity vs discovery search mode
 *   - Google Places as a first-class retrieval source
 *   - AI prompt no longer biases toward "maritime supply companies" for identity searches
 *   - Better deduplication using name similarity + domain matching
 */

import { PrismaClient } from "@prisma/client";
import { generateJSON } from "@/lib/ai/provider";
import type { MatchQuery, RawCandidate } from "./types";
import { detectSearchMode } from "./types";
import { retrieveFromGooglePlaces } from "./enrich";

const prisma = new PrismaClient();

/* -- Source 1: Internal Database ---------------------------------- */

async function retrieveFromInternalDB(query: MatchQuery): Promise<RawCandidate[]> {
  const conditions: Record<string, unknown> = {
    organizationId: query.organizationId,
    status: { notIn: ["Blocked", "Rejected"] },
  };

  const orClauses: Array<Record<string, unknown>> = [];

  if (query.name) {
    // For identity searches: prioritize exact and prefix matches
    orClauses.push(
      { name: { contains: query.name, mode: "insensitive" as const } },
    );

    // Also search by individual words for partial matches
    const words = query.name.split(/\s+/).filter((w) => w.length >= 2);
    for (const word of words) {
      orClauses.push(
        { name: { contains: word, mode: "insensitive" as const } },
      );
    }

    // Search website/description for company name traces
    orClauses.push(
      { website: { contains: query.name.toLowerCase().replace(/\s+/g, ""), mode: "insensitive" as const } },
      { description: { contains: query.name, mode: "insensitive" as const } },
    );
  }

  if (query.country) {
    orClauses.push({ country: { contains: query.country, mode: "insensitive" as const } });
  }

  if (query.region) {
    orClauses.push({ region: { contains: query.region, mode: "insensitive" as const } });
  }

  if (query.category) {
    orClauses.push({ categories: { has: query.category } });
  }

  if (query.port) {
    orClauses.push({ portsCovered: { has: query.port } });
  }

  if (query.keywords) {
    const words = query.keywords.split(/\s+/).filter(Boolean);
    for (const word of words) {
      orClauses.push(
        { name: { contains: word, mode: "insensitive" as const } },
        { description: { contains: word, mode: "insensitive" as const } },
      );
    }
  }

  if (orClauses.length > 0) {
    conditions.OR = orClauses;
  }

  const suppliers = await prisma.supplier.findMany({
    where: conditions,
    take: 15, // Increased from 10 to give ranking more to work with
    orderBy: { score: "desc" },
  });

  return suppliers.map((s) => ({
    name: s.name,
    region: s.region,
    country: s.country,
    city: s.city,
    address: s.address,
    phone: s.phone,
    email: s.email,
    website: s.website,
    contactPerson: s.contactPerson,
    description: s.description,
    categories: s.categories,
    portsCovered: s.portsCovered,
    lat: s.lat,
    lng: s.lng,
    sourceTag: "internal_db" as const,
    existingSupplierId: s.id,
    sourceMeta: { supplierCode: s.supplierCode, score: s.score, status: s.status },
  }));
}

/* -- Source 3: AI-Generated Candidates ---------------------------- */

interface AIGeneratedResult {
  candidates: Array<{
    name: string;
    region?: string;
    country?: string;
    city?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    contactPerson?: string;
    description?: string;
    categories?: string[];
    portsCovered?: string[];
    lat?: number | null;
    lng?: number | null;
    confidence?: number;
    reasoning?: string;
  }>;
}

async function retrieveFromAI(query: MatchQuery): Promise<RawCandidate[]> {
  const mode = detectSearchMode(query);

  const parts: string[] = [];
  if (query.name) parts.push(`Company name: "${query.name}"`);
  if (query.country) parts.push(`Country: ${query.country}`);
  if (query.region) parts.push(`Region: ${query.region}`);
  if (query.category) parts.push(`Category: ${query.category}`);
  if (query.port) parts.push(`Delivery port: ${query.port}`);
  if (query.keywords) parts.push(`Keywords: ${query.keywords}`);
  if (query.context) parts.push(`Context: ${query.context}`);

  const queryDesc = parts.join("\n");

  // Different prompts for identity vs discovery
  const prompt = mode === "identity"
    ? buildIdentityPrompt(queryDesc, query)
    : buildDiscoveryPrompt(queryDesc, query);

  const result = await generateJSON<AIGeneratedResult>(prompt, {
    tier: "default",
    temperature: 0.2,
    systemInstruction: mode === "identity"
      ? "You are a company identification system. Your job is to identify the SPECIFIC company the user is looking for. Return only factual, verifiable information. Never fabricate contact details. If you cannot identify the exact company, say so in the reasoning."
      : "You are a maritime procurement intelligence system. Return only factual, verifiable supplier information. Never fabricate contact details.",
  });

  if (!result.ok || !result.data?.candidates) {
    return [];
  }

  return result.data.candidates.map((c) => ({
    name: c.name,
    region: c.region ?? null,
    country: c.country ?? null,
    city: c.city ?? null,
    address: c.address ?? null,
    phone: c.phone ?? null,
    email: c.email ?? null,
    website: c.website ?? null,
    contactPerson: c.contactPerson ?? null,
    description: c.description ?? null,
    categories: c.categories ?? [],
    portsCovered: c.portsCovered ?? [],
    lat: c.lat ?? null,
    lng: c.lng ?? null,
    sourceTag: "ai_generated" as const,
    existingSupplierId: null,
    sourceMeta: {
      confidence: c.confidence,
      reasoning: c.reasoning,
      model: result.model,
      provider: result.provider,
    },
  }));
}

/* -- Identity Search Prompt --------------------------------------- */

function buildIdentityPrompt(queryDesc: string, query: MatchQuery): string {
  return `You are identifying a SPECIFIC company. The user is looking for this exact business entity.

SEARCH CRITERIA:
${queryDesc}

INSTRUCTIONS:
- Your PRIMARY goal is to identify the exact company named "${query.name}"
- Return the REAL company that matches this name — not similar-sounding alternatives
- If the company has multiple locations/branches, list the most relevant ones (max 3)
- Also include 1-2 alternative companies ONLY if the name is ambiguous (e.g. "GAC" could be multiple entities)
- For each candidate, clearly state whether it IS the queried company or an alternative
- Do NOT fabricate contact details — leave fields null if uncertain
- Websites must be real domains you are confident about
- If the company operates in maritime/shipping, note that, but do NOT limit results to maritime companies

MARITIME REGION TAXONOMY:
Northwest Europe, Scandinavia / Nordic, Mediterranean, Southeast Europe / Black Sea, Middle East, East Africa, West Africa, Southern Africa, Indian Subcontinent, Southeast Asia, East Asia, Gulf of Mexico, Caribbean, South America, Central America, North America Atlantic, North America Pacific, Pacific

Return JSON:
{
  "candidates": [
    {
      "name": "Full Legal Company Name",
      "region": "one of the maritime regions above or null",
      "country": "Country name",
      "city": "City name",
      "address": "Full address or null",
      "phone": "phone or null",
      "email": "email or null",
      "website": "https://... or null",
      "contactPerson": "name or null",
      "description": "1-2 sentence company description",
      "categories": ["Provisions", "Deck Supplies", ...],
      "portsCovered": ["Port1", "Port2", ...],
      "lat": 51.92,
      "lng": 4.48,
      "confidence": 0.85,
      "reasoning": "This IS the company named [X] because... / This is an ALTERNATIVE because..."
    }
  ]
}`;
}

/* -- Discovery Search Prompt -------------------------------------- */

function buildDiscoveryPrompt(queryDesc: string, _query: MatchQuery): string {
  return `You are a maritime procurement intelligence system. Find real supplier companies matching the search criteria.

SEARCH CRITERIA:
${queryDesc}

INSTRUCTIONS:
- Return 3-5 supplier candidates that genuinely match the search criteria
- Focus on REAL maritime supply companies (ship chandlers, provisions, technical stores, spare parts, etc.)
- Each candidate must be a distinct company — no duplicates
- For each candidate, provide as much accurate detail as you can
- Do NOT fabricate contact details — leave fields null if uncertain
- Websites must be real domains you are confident about
- Coordinates should be approximate city-level lat/lng

MARITIME REGION TAXONOMY:
Northwest Europe, Scandinavia / Nordic, Mediterranean, Southeast Europe / Black Sea, Middle East, East Africa, West Africa, Southern Africa, Indian Subcontinent, Southeast Asia, East Asia, Gulf of Mexico, Caribbean, South America, Central America, North America Atlantic, North America Pacific, Pacific

Return JSON:
{
  "candidates": [
    {
      "name": "Full Company Name",
      "region": "one of the maritime regions above",
      "country": "Country name",
      "city": "City name",
      "address": "Full address or null",
      "phone": "phone or null",
      "email": "email or null",
      "website": "https://... or null",
      "contactPerson": "name or null",
      "description": "1-2 sentence company description",
      "categories": ["Provisions", "Deck Supplies", ...],
      "portsCovered": ["Port1", "Port2", ...],
      "lat": 51.92,
      "lng": 4.48,
      "confidence": 0.85,
      "reasoning": "Why this company matches the search"
    }
  ]
}`;
}

/* -- Deduplication ------------------------------------------------ */

/**
 * Improved deduplication: uses normalized name similarity + domain matching
 * instead of just exact name+country key.
 */
function deduplicateCandidates(candidates: RawCandidate[]): RawCandidate[] {
  const result: RawCandidate[] = [];
  const seen = new Map<string, number>(); // normalized key -> index in result

  for (const c of candidates) {
    const normName = normalizeName(c.name);
    const domain = extractDomain(c.website);

    // Try to match by name
    let matchIndex = -1;
    for (const [key, idx] of seen) {
      if (namesAreSimilar(normName, key)) {
        matchIndex = idx;
        break;
      }
    }

    // Try to match by domain if no name match
    if (matchIndex === -1 && domain) {
      for (let i = 0; i < result.length; i++) {
        const existingDomain = extractDomain(result[i].website);
        if (existingDomain && existingDomain === domain) {
          matchIndex = i;
          break;
        }
      }
    }

    if (matchIndex >= 0) {
      // Prefer: internal_db > google_places > ai_generated
      const existing = result[matchIndex];
      const priority: Record<string, number> = {
        internal_db: 3,
        google_places: 2,
        ai_enrichment: 1,
        ai_generated: 0,
      };
      if ((priority[c.sourceTag] ?? 0) > (priority[existing.sourceTag] ?? 0)) {
        // Replace but merge missing fields from the lower-priority source
        result[matchIndex] = mergeCandidate(c, existing);
      } else {
        // Keep existing but merge missing fields from the new candidate
        result[matchIndex] = mergeCandidate(existing, c);
      }
    } else {
      seen.set(normName, result.length);
      result.push(c);
    }
  }

  return result;
}

/** Normalize company name for comparison */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Remove common legal suffixes
    .replace(/\b(b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|inc\.?|co\.?|corp\.?|gmbh|s\.?a\.?|s\.?r\.?l\.?|pte\.?|pvt\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Check if two normalized names are similar enough to be the same entity */
function namesAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Word overlap check
  const aWords = new Set(a.split(/\s+/).filter((w) => w.length > 1));
  const bWords = new Set(b.split(/\s+/).filter((w) => w.length > 1));
  if (aWords.size === 0 || bWords.size === 0) return false;

  const overlap = [...aWords].filter((w) => bWords.has(w)).length;
  const similarity = (overlap * 2) / (aWords.size + bWords.size);
  return similarity >= 0.6;
}

/** Extract domain from URL */
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Merge two candidates: primary wins, but fill in missing fields from secondary */
function mergeCandidate(primary: RawCandidate, secondary: RawCandidate): RawCandidate {
  return {
    ...primary,
    address: primary.address || secondary.address,
    phone: primary.phone || secondary.phone,
    email: primary.email || secondary.email,
    website: primary.website || secondary.website,
    description: primary.description || secondary.description,
    contactPerson: primary.contactPerson || secondary.contactPerson,
    lat: primary.lat ?? secondary.lat,
    lng: primary.lng ?? secondary.lng,
    categories: primary.categories && primary.categories.length > 0
      ? primary.categories
      : secondary.categories ?? [],
    portsCovered: primary.portsCovered && primary.portsCovered.length > 0
      ? primary.portsCovered
      : secondary.portsCovered ?? [],
    sourceMeta: {
      ...secondary.sourceMeta,
      ...primary.sourceMeta,
      mergedFrom: secondary.sourceTag,
    },
  };
}

/* -- Main Retrieval Orchestrator ---------------------------------- */

export async function retrieveCandidates(query: MatchQuery): Promise<RawCandidate[]> {
  const mode = detectSearchMode(query);

  // Attach search mode to query for downstream use
  const enrichedQuery = { ...query, searchMode: mode };

  // Run all sources in parallel
  const sources = [
    retrieveFromInternalDB(enrichedQuery).catch(() => [] as RawCandidate[]),
    retrieveFromAI(enrichedQuery).catch(() => [] as RawCandidate[]),
  ];

  // Google Places only for identity searches (needs a company name)
  if (mode === "identity" && query.name) {
    sources.push(
      retrieveFromGooglePlaces(enrichedQuery).catch(() => [] as RawCandidate[]),
    );
  }

  const results = await Promise.all(sources);
  const all = results.flat();

  // Deduplicate with improved matching
  return deduplicateCandidates(all);
}
