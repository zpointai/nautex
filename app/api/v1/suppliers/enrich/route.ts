import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { generateJSON } from "@/lib/ai/provider";
import { buildGeoContext } from "@/lib/geo";

interface EnrichmentResult {
  name?: string;
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
  sourceNotes?: string;
}

/* ── Country → maritime region map ───────────────────────────── */

const COUNTRY_REGION_MAP: Record<string, string> = {
  "Netherlands": "Northwest Europe", "The Netherlands": "Northwest Europe",
  "Belgium": "Northwest Europe", "Germany": "Northwest Europe",
  "United Kingdom": "Northwest Europe", "UK": "Northwest Europe",
  "France": "Mediterranean", "Spain": "Mediterranean", "Portugal": "Mediterranean",
  "Italy": "Mediterranean", "Malta": "Mediterranean", "Cyprus": "Mediterranean",
  "Egypt": "Mediterranean", "Morocco": "Mediterranean", "Algeria": "Mediterranean",
  "Tunisia": "Mediterranean", "Libya": "Mediterranean",
  "Greece": "Southeast Europe / Black Sea", "Turkey": "Southeast Europe / Black Sea",
  "Romania": "Southeast Europe / Black Sea", "Bulgaria": "Southeast Europe / Black Sea",
  "Croatia": "Southeast Europe / Black Sea", "Ukraine": "Southeast Europe / Black Sea",
  "Albania": "Southeast Europe / Black Sea", "Montenegro": "Southeast Europe / Black Sea",
  "Denmark": "Scandinavia / Nordic", "Norway": "Scandinavia / Nordic",
  "Sweden": "Scandinavia / Nordic", "Finland": "Scandinavia / Nordic",
  "Iceland": "Scandinavia / Nordic",
  "United Arab Emirates": "Middle East", "UAE": "Middle East",
  "Oman": "Middle East", "Bahrain": "Middle East", "Saudi Arabia": "Middle East",
  "Kuwait": "Middle East", "Qatar": "Middle East", "Iran": "Middle East",
  "Iraq": "Middle East", "Jordan": "Middle East", "Israel": "Middle East",
  "Yemen": "Middle East",
  "Singapore": "Southeast Asia", "Malaysia": "Southeast Asia",
  "Indonesia": "Southeast Asia", "Thailand": "Southeast Asia",
  "Vietnam": "Southeast Asia", "Philippines": "Southeast Asia",
  "Myanmar": "Southeast Asia", "Cambodia": "Southeast Asia",
  "China": "East Asia", "Japan": "East Asia", "South Korea": "East Asia",
  "Taiwan": "East Asia", "Hong Kong": "East Asia",
  "India": "Indian Subcontinent", "Sri Lanka": "Indian Subcontinent",
  "Pakistan": "Indian Subcontinent", "Bangladesh": "Indian Subcontinent",
  "Nigeria": "West Africa", "Ghana": "West Africa", "Ivory Coast": "West Africa",
  "Senegal": "West Africa", "Cameroon": "West Africa", "Liberia": "West Africa",
  "South Africa": "Southern Africa", "Mozambique": "Southern Africa",
  "Namibia": "Southern Africa", "Angola": "Southern Africa",
  "Tanzania": "East Africa", "Kenya": "East Africa",
  "Djibouti": "East Africa", "Ethiopia": "East Africa",
  "United States": "Gulf of Mexico", "USA": "Gulf of Mexico",
  "Mexico": "Gulf of Mexico",
  "Panama": "Central America", "Costa Rica": "Central America",
  "Colombia": "Caribbean", "Venezuela": "Caribbean", "Jamaica": "Caribbean",
  "Trinidad and Tobago": "Caribbean", "Cuba": "Caribbean",
  "Brazil": "South America", "Argentina": "South America",
  "Chile": "South America", "Peru": "South America",
  "Ecuador": "South America", "Uruguay": "South America",
  "Australia": "Pacific", "New Zealand": "Pacific",
};

function deriveRegionFromCountry(country: string): string | null {
  return COUNTRY_REGION_MAP[country] ?? null;
}

/**
 * Post-AI normalization: reconcile geo fields, derive missing region.
 */
function normalizeGeoFields(
  result: EnrichmentResult,
  existing: { region: string; country: string | null }
): EnrichmentResult {
  const out = { ...result };

  // Derive region from country if missing or still "Unknown"
  const region = out.region ?? existing.region;
  if (!region || region === "Unknown" || region === "N/A") {
    const country = out.country ?? existing.country;
    if (country) {
      const derived = deriveRegionFromCountry(country);
      if (derived) out.region = derived;
    }
  }

  return out;
}

/**
 * POST /api/v1/suppliers/enrich
 *
 * AI-powered supplier enrichment.
 *
 * mode: "preview" (default) — returns proposed changes without committing
 * mode: "commit"  — applies the provided enrichment data to the supplier
 */
export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = await req.json();
    const { supplierId, mode = "preview", enrichmentData } = body;

    if (!supplierId) {
      return NextResponse.json({ error: "supplierId is required." }, { status: 400 });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, organizationId: authorization.context.organizationId },
    });
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found." }, { status: 404 });
    }

    // ── COMMIT MODE: apply reviewed enrichment data ──────────
    if (mode === "commit" && enrichmentData) {
      const allowed = [
        "name", "region", "country", "city", "address", "phone", "email", "website",
        "contactPerson", "description", "categories", "portsCovered",
        "lat", "lng",
      ];

      const update: Record<string, unknown> = {
        enrichmentStatus: "Enriched",
        confidence: enrichmentData.confidence ?? supplier.confidence ?? 0.5,
      };

      for (const key of allowed) {
        if (enrichmentData[key] !== undefined && enrichmentData[key] !== null) {
          update[key] = enrichmentData[key];
        }
      }

      // Recalculate score based on profile completeness
      const merged = { ...supplier, ...update };
      update.score = computeProfileScore(merged);

      const updated = await prisma.supplier.update({
        where: { id: supplierId },
        data: update,
      });

      return NextResponse.json({
        data: updated,
        enrichment: {
          mode: "committed",
          fieldsUpdated: Object.keys(update).filter((k) => !["enrichmentStatus", "confidence", "score"].includes(k)),
        },
      });
    }

    // ── PREVIEW MODE: AI enrichment + return proposal ────────
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { enrichmentStatus: "Enriching" },
    });

    // Build context from existing data
    const knownFields = [
      supplier.name && `Name: ${supplier.name}`,
      supplier.region && `Region: ${supplier.region}`,
      supplier.country && `Country: ${supplier.country}`,
      supplier.city && `City: ${supplier.city}`,
      supplier.address && `Address: ${supplier.address}`,
      supplier.email && `Email: ${supplier.email}`,
      supplier.phone && `Phone: ${supplier.phone}`,
      supplier.website && `Website: ${supplier.website}`,
      supplier.contactPerson && `Contact: ${supplier.contactPerson}`,
      supplier.description && `Description: ${supplier.description}`,
      supplier.categories.length > 0 && `Categories: ${supplier.categories.join(", ")}`,
      supplier.portsCovered.length > 0 && `Ports: ${supplier.portsCovered.join(", ")}`,
    ].filter(Boolean).join("\n");

    // Build geospatial context for the AI
    const geoContext = buildGeoContext({
      lat: supplier.lat,
      lng: supplier.lng,
      city: supplier.city,
      country: supplier.country,
      region: supplier.region,
      portsCovered: supplier.portsCovered,
    });

    const prompt = `You are a maritime procurement data enrichment assistant.
Given a supplier company in the maritime/ship supply industry, provide comprehensive enrichment.

KNOWN INFORMATION:
${knownFields}

GEOSPATIAL CONTEXT:
${geoContext}

TASK: Fill in ALL fields as completely as possible. For fields that already have data, you may improve or correct them if you have better information.
Use the geospatial context to inform your assessment — nearby maritime hubs suggest which ports the supplier likely serves, and the region helps narrow down realistic categories and contact details.

Return a JSON object:
{
  "name": "full legal/trade company name (improve if informal)",
  "region": "primary maritime region — use one of: Northwest Europe, Scandinavia / Nordic, Mediterranean, Southeast Europe / Black Sea, Middle East, East Africa, West Africa, Southern Africa, Indian Subcontinent, Southeast Asia, East Asia, Gulf of Mexico, Caribbean, South America, Central America, North America Atlantic, North America Pacific, Pacific",
  "country": "full country name",
  "city": "exact city or municipality name as shown in the business address — not the nearest major city. If address says Nørresundby, use Nørresundby not Aalborg",
  "address": "full street address if determinable",
  "phone": "phone number with international prefix",
  "email": "primary business/sales email (must be a real domain, not a placeholder)",
  "website": "company website URL starting with https:// — only if you are confident this is a real, working URL for this company",
  "contactPerson": "primary contact name if known, otherwise null",
  "description": "2-3 sentence description: what they supply, their specialty, fleet/port focus, any distinguishing factors in maritime supply",
  "categories": ["comprehensive array of supply categories: Provisions, Deck Supplies, Engine Parts, Safety Equipment, Technical Stores, Spare Parts, Cabin Supplies, Bonded Stores, Navigation Equipment, Paints & Chemicals, Ropes & Mooring, etc."],
  "portsCovered": ["all ports/cities they demonstrably serve — do not include speculative ports"],
  "lat": 0.0,
  "lng": 0.0,
  "confidence": 0.0,
  "sourceNotes": "brief note on data source quality and what you're most/least confident about"
}

RULES:
- Set lat/lng to the supplier's primary office/warehouse location coordinates (be precise, not city center defaults)
- Region MUST match the maritime region taxonomy above — do not use custom region names
- City must match the locality in the address, not the nearest major city if different
- Website: only include if you are highly confident it is real — prefer null over a guessed URL
- Email: must have a real company domain, not generic placeholders
- Confidence (0.0–1.0): 0.9+ only if you're very sure (well-known company), 0.5-0.7 for educated guesses, below 0.5 if mostly speculative
- Be honest — use null for fields you cannot reasonably determine
- Categories should reflect maritime supply industry standard categories
- Ports should only include ports where the supplier demonstrably operates`;

    const result = await generateJSON<EnrichmentResult>(prompt, {
      tier: "fast",
      temperature: 0.2,
      systemInstruction: "You are a maritime industry data analyst. Return only valid JSON. Be factual and conservative with confidence scores.",
    });

    if (!result.ok || !result.data) {
      await prisma.supplier.update({
        where: { id: supplierId },
        data: { enrichmentStatus: "Failed" },
      });
      return NextResponse.json({
        error: "AI enrichment failed",
        detail: result.error,
      }, { status: 503 });
    }

    // Reset status back (not committed yet)
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { enrichmentStatus: supplier.enrichmentStatus === "Enriched" ? "Enriched" : "None" },
    });

    // Apply geo normalization: derive region from country if missing
    const enriched = normalizeGeoFields(result.data, {
      region: supplier.region,
      country: supplier.country,
    });

    // Build diff: show what would change
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const compareFields: { key: string; isArray?: boolean }[] = [
      { key: "name" }, { key: "region" }, { key: "country" }, { key: "city" }, { key: "address" },
      { key: "phone" }, { key: "email" }, { key: "website" },
      { key: "contactPerson" }, { key: "description" },
      { key: "categories", isArray: true }, { key: "portsCovered", isArray: true },
      { key: "lat" }, { key: "lng" },
    ];

    for (const { key, isArray } of compareFields) {
      const current = (supplier as Record<string, unknown>)[key];
      const proposed = (enriched as Record<string, unknown>)[key];
      if (proposed === null || proposed === undefined) continue;

      if (isArray) {
        const cur = (current as string[]) ?? [];
        const prop = (proposed as string[]) ?? [];
        if (JSON.stringify(cur.sort()) !== JSON.stringify(prop.sort())) {
          changes[key] = { from: cur, to: prop };
        }
      } else {
        if (current !== proposed && !(current === null && proposed === null)) {
          changes[key] = { from: current, to: proposed };
        }
      }
    }

    return NextResponse.json({
      preview: {
        proposed: enriched,
        changes,
        changeCount: Object.keys(changes).length,
        confidence: enriched.confidence ?? 0.5,
        sourceNotes: enriched.sourceNotes ?? null,
        model: result.model,
        provider: result.provider,
      },
    });
  } catch (err) {
    console.error("Enrichment error:", err);
    return NextResponse.json({
      error: "Enrichment failed.",
      detail: err instanceof Error ? err.message : "Unknown error",
    }, { status: 500 });
  }
}

/* ── Profile score computation ──────────────────────────────── */

function computeProfileScore(s: Record<string, unknown>): number {
  let score = 0;
  const checks = [
    { field: "name", weight: 10 },
    { field: "region", weight: 8 },
    { field: "country", weight: 8 },
    { field: "city", weight: 5 },
    { field: "address", weight: 5 },
    { field: "email", weight: 10 },
    { field: "phone", weight: 8 },
    { field: "website", weight: 8 },
    { field: "contactPerson", weight: 8 },
    { field: "description", weight: 10 },
    { field: "categories", weight: 10, isArray: true },
    { field: "portsCovered", weight: 5, isArray: true },
    { field: "lat", weight: 3 },
    { field: "lng", weight: 2 },
  ];

  for (const check of checks) {
    const val = s[check.field];
    if (check.isArray) {
      if (Array.isArray(val) && val.length > 0) score += check.weight;
    } else if (val !== null && val !== undefined && val !== "" && val !== "Unknown") {
      score += check.weight;
    }
  }

  return score;
}
