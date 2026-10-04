import { NextResponse } from "next/server";
import { generateJSON } from "@/lib/ai/provider";
import { searchGooglePlacesBestMatch, geocodeAddress } from "@/lib/matching/enrich";
import { buildGeoContext } from "@/lib/geo";

/**
 * POST /api/v1/suppliers/enrich-form
 *
 * Pre-save enrichment — suggest supplier data before the record is created.
 * Used in the Create Supplier form's "AI Suggest" flow.
 *
 * v3: Uses best-match Google Places search with name similarity gating.
 * Only uses Places data when the result name closely matches the query.
 * Falls back to the active AI provider when Google Places returns unrelated businesses.
 *
 * Body: { name, region?, country?, city?, description? }
 * Returns: { suggestion: FormSuggestion }
 */

interface FormSuggestion {
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
  /** Name of the Google Places result used (for transparency) */
  placesMatch?: string;
  /** Name match score (0-1) between query and Places result */
  placesNameScore?: number;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, region, country, city, description } = body as Record<string, string>;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Company name is required." }, { status: 400 });
    }

    const companyName = name.trim();

    // Step 1: Google Places lookup with name similarity gating
    // Only accepts Places data if the result name is a strong match.
    // High threshold (0.65) because auto-filling the form with wrong company data
    // is much worse than showing a wrong candidate in a review list.
    // "Kroonint" → "Kroonint B.V." (1.0) passes. "De Waal" → "De Waal Culemborg" (0.60) doesn't.
    const places = await searchGooglePlacesBestMatch(companyName, {
      country: country || undefined,
      city: city || undefined,
      searchMode: "identity",
      minScore: 0.65,
    });

    const placesUsed = places.found && (places.nameMatchScore ?? 0) >= 0.4;

    // Step 2: Active-provider enrichment for description, categories, ports
    const knownFields = [
      `Name: ${companyName}`,
      placesUsed && places.address && `Address (from Google Places): ${places.address}`,
      placesUsed && places.website && `Website (from Google Places): ${places.website}`,
      placesUsed && places.displayName && places.displayName !== companyName
        && `Google Places matched: "${places.displayName}"`,
      region && region !== "Unknown" && `Region: ${region}`,
      country && `Country: ${country}`,
      city && `City: ${city}`,
      description && `Description: ${description}`,
    ].filter(Boolean).join("\n");

    const geoContext = buildGeoContext({
      lat: placesUsed ? places.lat : undefined,
      lng: placesUsed ? places.lng : undefined,
      city: city || undefined,
      country: country || undefined,
      region: region || undefined,
    });

    const prompt = `You are a maritime procurement data enrichment assistant.
Given a supplier company name${placesUsed ? " and verified data from Google Places" : ""}, provide comprehensive data enrichment.

KNOWN INFORMATION:
${knownFields}

GEOSPATIAL CONTEXT:
${geoContext}

TASK: Based on the company name${placesUsed ? ", Google Places data," : ""} and any provided details, suggest accurate supplier data for a maritime ERP system.
Be specific to this actual company — do not invent generic placeholder data.

Return a JSON object:
{
  "region": "primary maritime region — use one of: Northwest Europe, Scandinavia / Nordic, Mediterranean, Southeast Europe / Black Sea, Middle East, East Africa, West Africa, Southern Africa, Indian Subcontinent, Southeast Asia, East Asia, Gulf of Mexico, Caribbean, South America, Central America, North America Atlantic, North America Pacific, Pacific",
  "country": "full country name",
  "city": "exact city/municipality of main office",
  "email": "primary business/sales email with a real domain, or null",
  "contactPerson": null,
  "description": "2-3 sentences: what they supply, their specialty, maritime relevance",
  "categories": ["relevant maritime supply categories from: Provisions, Deck Supplies, Engine Parts, Safety Equipment, Technical Stores, Spare Parts, Cabin Supplies, Bonded Stores, Navigation Equipment, Paints & Chemicals, Ropes & Mooring, Medical Supplies, General Chandlery, Lubricants, Water Treatment, Valves & Fittings, Welding, Tools, Electrical, HVAC"],
  "portsCovered": ["ports/cities they demonstrably serve — be conservative"],
  "confidence": 0.0,
  "sourceNotes": "brief note on confidence level"
}

RULES:
- confidence: 0.9+ for well-known companies, 0.5-0.7 for moderate certainty, <0.5 for speculation
- Use null for fields you cannot confidently determine
- Do NOT include address, phone, website, lat, or lng — those come from Google Places
- City must be the actual business address locality`;

    const aiResult = await generateJSON<FormSuggestion>(prompt, {
      tier: "fast",
      temperature: 0.2,
      systemInstruction: "You are a maritime industry data analyst. Return only valid JSON. Be factual and conservative.",
    });

    // Step 3: Geocoding fallback
    let lat = placesUsed ? (places.lat ?? null) : null;
    let lng = placesUsed ? (places.lng ?? null) : null;
    if (lat == null && lng == null && placesUsed && places.address) {
      const coords = await geocodeAddress(places.address);
      if (coords) {
        lat = coords.lat;
        lng = coords.lng;
      }
    }

    // Step 4: Merge — only include Places data if it matched well
    const aiData = aiResult.ok && aiResult.data ? aiResult.data : {};

    const suggestion: FormSuggestion = {
      // Google Places data — only if name matched
      address: placesUsed ? (places.address || undefined) : undefined,
      phone: placesUsed ? (places.phone || undefined) : undefined,
      website: placesUsed ? (places.website || undefined) : undefined,
      lat,
      lng,
      // AI suggestions require review, regardless of the configured provider.
      region: aiData.region || region || undefined,
      country: aiData.country || country || (placesUsed ? extractCountryFromAddress(places.address) : undefined) || undefined,
      city: aiData.city || city || (placesUsed ? extractCityFromAddress(places.address) : undefined) || undefined,
      email: aiData.email || undefined,
      contactPerson: aiData.contactPerson || undefined,
      description: aiData.description || undefined,
      categories: aiData.categories || [],
      portsCovered: aiData.portsCovered || [],
      confidence: placesUsed
        ? Math.max(aiData.confidence ?? 0.5, 0.7)
        : (aiData.confidence ?? 0.5),
      sourceNotes: placesUsed
        ? `Google Places name match: "${places.displayName}" (${Math.round((places.nameMatchScore ?? 0) * 100)}%). ${aiResult.ok ? `AI suggestions: ${aiResult.provider} / ${aiResult.model}; review required.` : 'AI enrichment unavailable.'} ${aiData.sourceNotes || ""}`
        : `${aiResult.ok ? `AI suggestions: ${aiResult.provider} / ${aiResult.model}; review required.` : 'AI enrichment unavailable.'} No close Google Places match for "${companyName}". ${aiData.sourceNotes || ""}`,
      placesMatch: placesUsed ? places.displayName : undefined,
      placesNameScore: places.nameMatchScore,
    };

    return NextResponse.json({ suggestion });
  } catch (err) {
    console.error("Form enrichment error:", err);
    return NextResponse.json(
      { error: "Enrichment failed.", detail: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

function extractCountryFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const parts = address.split(",").map((p) => p.trim());
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

function extractCityFromAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 3) {
    const candidate = parts[parts.length - 2];
    const match = candidate.match(/^\d+\s+\w+\s+(.+)/);
    if (match) return match[1];
    if (/^\d/.test(candidate) && parts.length >= 4) return parts[parts.length - 3];
    return candidate;
  }
  return parts.length >= 2 ? parts[0] : undefined;
}
