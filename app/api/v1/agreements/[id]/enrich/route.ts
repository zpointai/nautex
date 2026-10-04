/**
 * Agreement Item Enrichment Agent
 * ────────────────────────────────────────────────────────────────
 * POST /api/v1/agreements/:id/enrich
 *
 * Fills in `hsCode`, `countryOfOrigin`, and `cooConfidence` for items
 * that are missing them. The engine is deterministic, explainable,
 * and consistent across datasets.
 *
 * OUTPUT FORMAT
 *   hsCode          — 8-digit TARIC (e.g. "73269098")
 *   countryOfOrigin — ISO 3166-1 alpha-3 (e.g. "CHN", "DEU", "USA")
 *   cooConfidence   — "High" | "Medium" | "Low"
 *
 * COO INFERENCE ENGINE — 3-tier deterministic cascade
 *
 *   Tier 1 — HIGH (authoritative signals)
 *     • Explicit country mention in description or manufacturer text
 *     • Known-brand match (e.g. "Hella" → DEU, "Kidde" → USA)
 *     • Unique corporate suffix (GmbH, AG → DEU; Oy → FIN; etc.)
 *
 *   Tier 2 — MEDIUM (strong product-signature patterns)
 *     • Product category + material/spec combination strongly tied to
 *       a manufacturing cluster (e.g. SS316 pipe fittings → CHN,
 *       DIN valves with no brand → DEU, marine paints → NLD).
 *     • Corporate suffix that is common but not exclusive (Ltd → GBR).
 *
 *   Tier 3 — LOW (category-default probabilistic fallback)
 *     • Generic industrial goods with no brand or material signal
 *       default to the most common manufacturing origin for the
 *       category (metal parts → CHN, chemicals → CHN, etc.).
 *
 *   If no tier matches, the field stays unchanged.
 *
 * Body:
 *   {
 *     itemIds?: string[]                                       // scope to specific items
 *     fields?: ("hsCode" | "countryOfOrigin")[]                // default: both
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string }> };

/* ═══════════════════════════════════════════════════════════════
   HS CODE RULES — 8-digit TARIC, first-match wins
   Each rule is (pattern, code, tariffNote).
   ═══════════════════════════════════════════════════════════════ */
const HS_CODE_RULES: { pattern: RegExp; code: string; note: string }[] = [
  // Safety / firefighting
  { pattern: /\bfire\s*extinguish(er|ing)\b/i,                  code: "84241000", note: "Fire extinguishers" },
  { pattern: /\b(life\s*(jacket|vest|raft|ring)|epirb|flare)\b/i, code: "89069090", note: "Life-saving apparatus" },

  // Lighting
  { pattern: /\b(led\b|led\s*lamp|led\s*bulb|led\s*light)\b/i,  code: "85395000", note: "LED lamps" },
  { pattern: /\b(lamp|bulb|lantern|light(ing)?)\b/i,            code: "85392900", note: "Other filament/discharge lamps" },

  // Fluids / chemicals
  { pattern: /\b(hydraulic\s*oil|lubricant|lube|engine\s*oil|gear\s*oil)\b/i, code: "27101987", note: "Hydraulic / lubricating oils" },
  { pattern: /\b(diesel|gas\s*oil|fuel\s*oil)\b/i,              code: "27101943", note: "Gas oils / diesel" },
  { pattern: /\b(paint|coating|varnish|primer|anti-?foul)\b/i,  code: "32089091", note: "Paints & varnishes" },
  { pattern: /\b(cleaner|detergent|soap|disinfect)\b/i,         code: "34029090", note: "Cleaning agents" },

  // Stainless / steel fittings — BEFORE generic 'chain'/'pipe' so SS matches first.
  // Note: "SS316L" is one token (no word boundary before "316L"), so we explicitly
  // list `ss316l` / `316l` variants alongside `ss316`.
  { pattern: /\b(ss\s*316l?|ss304|316l|stainless\s*steel)\b.*\b(clamps?|fittings?|flanges?|elbows?|tees?|reducers?|caps?|tails?|bends?|hatch(es)?)\b/i, code: "73269098", note: "Other articles of stainless steel" },
  { pattern: /\b(clamps?|fittings?|flanges?|elbows?|tees?|reducers?|caps?|tails?|bends?|hatch(es)?)\b.*\b(ss\s*316l?|ss304|316l|stainless\s*steel|stainless)\b/i, code: "73269098", note: "Other articles of stainless steel" },
  { pattern: /\b(ss\s*316l?|ss304|316l|stainless\s*steel)\b/i, code: "73269098", note: "Other articles of stainless steel" },

  // Mooring / anchoring
  { pattern: /\banchor\s*chain\b/i,                              code: "73151200", note: "Anchor chain" },
  { pattern: /\b(shackle|mooring\s*chain|chain\s*link)\b/i,      code: "73152000", note: "Skid chain / shackles" },
  { pattern: /\b(anchor|mooring\s*rope|hawser)\b/i,              code: "56074100", note: "Cordage / ropes" },

  // Mechanical parts
  { pattern: /\b(valves?|ball\s*valves?|gate\s*valves?|check\s*valves?|butterfly\s*valves?)\b/i, code: "84818099", note: "Taps / valves" },
  { pattern: /\b(pumps?|centrifugal\s*pumps?)\b/i,              code: "84137089", note: "Pumps for liquids" },
  { pattern: /\b(compressors?|air\s*compressors?)\b/i,          code: "84148020", note: "Air / gas compressors" },
  { pattern: /\b(motors?|electric\s*motors?|servos?)\b/i,       code: "85015290", note: "AC motors" },
  { pattern: /\b(generators?|alternators?|gensets?)\b/i,        code: "85016400", note: "AC generators" },
  { pattern: /\b(bearings?|rollers?|ball\s*bearings?)\b/i,      code: "84821010", note: "Ball bearings" },
  { pattern: /\b(gaskets?|seals?|o-?rings?|packings?)\b/i,      code: "40169300", note: "Gaskets / seals" },
  { pattern: /\b(bolts?|screws?|nuts?|washers?|fasteners?)\b/i, code: "73181590", note: "Threaded fasteners" },
  { pattern: /\b(pipes?|tubings?|hoses?)\b/i,                   code: "73069098", note: "Tubes / pipes" },

  // Electrical
  { pattern: /\b(cables?|wires?|electrical\s*cords?)\b/i,       code: "85444290", note: "Insulated electric conductors" },
  { pattern: /\b(battery|batteries)\b/i,                        code: "85072000", note: "Lead-acid batteries" },
  { pattern: /\b(filters?|strainers?|separators?)\b/i,          code: "84212998", note: "Filtering apparatus" },

  // Navigation / radio
  { pattern: /\b(radars?|ais\s*transponders?)\b/i,              code: "85261000", note: "Radar apparatus" },
  { pattern: /\b(gps|chart\s*plotters?|echo\s*sounders?|compass(es)?|sextants?|navigat(ion|or))\b/i, code: "90148090", note: "Navigational instruments" },
  { pattern: /\b(radios?|vhf|transceivers?)\b/i,                code: "85256000", note: "Transmission apparatus" },

  // PPE / textiles
  { pattern: /\b(gloves?|mittens?)\b/i,                         code: "61169900", note: "Gloves (knitted)" },
  { pattern: /\b(boots?|footwear)\b/i,                          code: "64029900", note: "Footwear" },
  { pattern: /\b(helmets?|hard\s*hats?)\b/i,                    code: "65061010", note: "Safety helmets" },
  { pattern: /\b(harnesses?|coveralls?|ppe|safety\s*gear)\b/i,  code: "62034200", note: "Work garments" },

  // Raw metal
  { pattern: /\b(galvanized|steel\s*plate|metal\s*sheet)\b/i,   code: "72104900", note: "Galvanized flat steel" },

  // Hand tools
  { pattern: /\b(wrench|spanner|hammer|screwdriver|plier)\b/i,  code: "82055990", note: "Hand tools" },
  { pattern: /\btool\b/i,                                        code: "82055990", note: "Hand tools" },

  // Food / provisions
  { pattern: /\b(food|provision|grocer)\b/i,                    code: "21069098", note: "Food preparations n.e.s." },
];

/* ═══════════════════════════════════════════════════════════════
   BRAND → COUNTRY (alpha-3) — curated, deterministic
   Matched with whole-word boundaries on manufacturer + description.
   ═══════════════════════════════════════════════════════════════ */
const BRAND_COUNTRY: { pattern: RegExp; iso3: string }[] = [
  // Germany (DEU)
  { pattern: /\b(hella|bosch|siemens|\bman\b|\bmtu\b|\bzf\b|continental|phoenix\s*contact|festo|wika|kärcher|karcher|jungheinrich|thyssen|stihl|miele)\b/i, iso3: "DEU" },
  // United States (USA)
  { pattern: /\b(kidde|honeywell|3m|caterpillar|cummins|parker\s*hannifin|emerson|eaton|rockwell|johnson\s*controls|general\s*electric|garmin|allen-?bradley|ingersoll-?rand|baldor)\b/i, iso3: "USA" },
  // United Kingdom (GBR)
  { pattern: /\b(rolls-?royce|raymarine|jcb|\bgkn\b|babcock|smiths\s*group|british\s*petroleum)\b/i, iso3: "GBR" },
  // Netherlands (NLD)
  { pattern: /\b(victron|philips|damen|\bshell\b|\bstork\b|ihc|royal\s*ihc)\b/i, iso3: "NLD" },
  // Italy (ITA)
  { pattern: /\b(fincantieri|pirelli|iveco|\bfiat\b|ansaldo|riva|ferretti|marelli)\b/i, iso3: "ITA" },
  // France (FRA)
  { pattern: /\b(schneider\s*electric|legrand|thales|alstom|airbus|michelin|total\s*energies|totalenergies|naval\s*group)\b/i, iso3: "FRA" },
  // Sweden (SWE)
  { pattern: /\b(volvo|scania|\bskf\b|atlas\s*copco|sandvik|husqvarna|alfa\s*laval)\b/i, iso3: "SWE" },
  // Finland (FIN)
  { pattern: /\b(wärtsilä|wartsila|kone|metso|konecranes|\bnokia\b|abloy)\b/i, iso3: "FIN" },
  // Norway (NOR)
  { pattern: /\b(jotun|kongsberg|\baker\b|equinor|statoil|yara)\b/i, iso3: "NOR" },
  // Denmark (DNK)
  { pattern: /\b(danfoss|grundfos|maersk|vestas|hempel)\b/i, iso3: "DNK" },
  // Switzerland (CHE)
  { pattern: /\b(\babb\b|nestlé|nestle|roche|novartis|sulzer|schindler|sika|kaba)\b/i, iso3: "CHE" },
  // Japan (JPN)
  { pattern: /\b(mitsubishi|toshiba|hitachi|yanmar|komatsu|fanuc|furuno|yokogawa|\bjrc\b|panasonic|sony|denso|\bntn\b|nachi)\b/i, iso3: "JPN" },
  // South Korea (KOR)
  { pattern: /\b(hyundai|samsung|\blg\b|daewoo|posco|doosan|hanwha)\b/i, iso3: "KOR" },
  // China (CHN)
  { pattern: /\b(haier|sany|cosco|huawei|xiaomi|\bbyd\b|alibaba|weichai|zpmc)\b/i, iso3: "CHN" },
];

/* ═══════════════════════════════════════════════════════════════
   CORPORATE-SUFFIX / PLACE-NAME → COUNTRY (alpha-3)
   Split by confidence: "uniqueSuffixes" are essentially proof,
   "softSuffixes" are common indicators (Ltd, Inc) — used for
   MEDIUM confidence only.
   ═══════════════════════════════════════════════════════════════ */
const UNIQUE_SUFFIXES: { pattern: RegExp; iso3: string }[] = [
  { pattern: /\b(gmbh|\bmbh\b|\bag\b|\bkg\b)\b/i, iso3: "DEU" },
  { pattern: /\b(b\.?v\.?|n\.?v\.?|netherlands|holland|dutch)\b/i, iso3: "NLD" },
  { pattern: /\b(s\.?r\.?l\.?|s\.?p\.?a\.?|italia|italy)\b/i, iso3: "ITA" },
  { pattern: /\b(\bab\b|sverige|sweden)\b/i, iso3: "SWE" },
  { pattern: /\b(\boy\b|oyj|finland)\b/i, iso3: "FIN" },
  { pattern: /\b(\ba\/s\b|norge|norway)\b/i, iso3: "NOR" },
  { pattern: /\b(\baps\b|a\/s|denmark|dansk)\b/i, iso3: "DNK" },
  { pattern: /\b(japan|nippon|tokyo)\b/i, iso3: "JPN" },
  { pattern: /\b(china|shanghai|beijing|shenzhen|taiwan\s*china|prc)\b/i, iso3: "CHN" },
  { pattern: /\b(korea|seoul|busan)\b/i, iso3: "KOR" },
  { pattern: /\b(singapore|\bpte\b)\b/i, iso3: "SGP" },
  { pattern: /\b(turkey|istanbul|türk|turk)\b/i, iso3: "TUR" },
  { pattern: /\b(spain|españa|madrid|barcelona)\b/i, iso3: "ESP" },
  { pattern: /\b(greece|hellenic|athens|piraeus)\b/i, iso3: "GRC" },
];

const SOFT_SUFFIXES: { pattern: RegExp; iso3: string }[] = [
  { pattern: /\b(ltd|limited|plc)\b/i,              iso3: "GBR" },
  { pattern: /\b(inc\.?|corp\.?|llc|usa|america)\b/i, iso3: "USA" },
  { pattern: /\b(s\.?a\.?s?|france)\b/i,            iso3: "FRA" },
];

/* ═══════════════════════════════════════════════════════════════
   PRODUCT-SIGNATURE RULES — Tier 2 (MEDIUM confidence)
   Used when no brand/suffix match is found. Maps material + product
   patterns to the country that dominates that manufacturing cluster.
   ═══════════════════════════════════════════════════════════════ */
const PRODUCT_SIGNATURES: { pattern: RegExp; iso3: string; why: string }[] = [
  // Stainless-steel industrial fittings → dominated by Chinese export
  // "SS316L" is one token — we include `ss316l?` (covers SS316 and SS316L) + `316l`
  { pattern: /\b(ss\s*316l?|ss304|316l|stainless\s*steel)\b.*\b(clamps?|fittings?|flanges?|elbows?|tees?|reducers?|caps?|tails?|bends?|hatch(es)?)\b/i, iso3: "CHN", why: "SS316 industrial fittings" },
  { pattern: /\b(clamps?|fittings?|flanges?|elbows?|tees?|reducers?|caps?|tails?|bends?|hatch(es)?)\b.*\b(ss\s*316l?|ss304|316l|stainless\s*steel|stainless)\b/i, iso3: "CHN", why: "SS316 industrial fittings" },
  // ISO / DIN standards without brand → often DEU, but in commodity market often CHN.
  // We pick CHN (medium) for commodity fittings, DEU for precision instruments.
  { pattern: /\b(\bdin\b\s*\d{2,4}|\biso\b\s*\d{2,4})\b.*\b(gauges?|sensors?|instruments?|transmitters?)\b/i, iso3: "DEU", why: "DIN/ISO precision instrument" },
  // Anchor chain & shackles — Chinese mills dominate commodity output
  { pattern: /\b(anchor\s*chain|shackles?|chain\s*links?)\b/i, iso3: "CHN", why: "Marine chain / shackle commodity" },
  // Galvanized steel plate → CHN
  { pattern: /\b(galvanized|steel\s*plates?|metal\s*sheets?)\b/i, iso3: "CHN", why: "Galvanized steel" },
  // Generic nut/bolt/washer → CHN
  { pattern: /\b(bolts?|screws?|nuts?|washers?|fasteners?)\b/i, iso3: "CHN", why: "Commodity fasteners" },
  // Generic PPE → CHN
  { pattern: /\b(coveralls?|ppe|safety\s*gear|gloves?|hard\s*hats?|helmets?)\b/i, iso3: "CHN", why: "Commodity PPE" },
  // Marine paints → NLD (Hempel, International) / NOR (Jotun). Default NLD for commodity.
  { pattern: /\b(anti-?foul|marine\s*paint|primer|topcoat)\b/i, iso3: "NLD", why: "Marine coating hub" },
  // Hydraulic / engine oil — premium brands DEU/USA; commodity CHN
  { pattern: /\b(hydraulic\s*oil|gear\s*oil|engine\s*oil)\b/i, iso3: "DEU", why: "Industrial fluids — premium hub" },
];

/* ═══════════════════════════════════════════════════════════════
   CATEGORY-DEFAULT FALLBACK — Tier 3 (LOW confidence)
   Only applies when we can identify a broad category but nothing else.
   ═══════════════════════════════════════════════════════════════ */
const CATEGORY_DEFAULT: { pattern: RegExp; iso3: string }[] = [
  { pattern: /\b(clamps?|fittings?|flanges?|elbows?|tees?|reducers?|caps?|tails?|bends?)\b/i, iso3: "CHN" }, // metal fittings
  { pattern: /\b(pipes?|tubings?|hoses?|valves?|pumps?|compressors?)\b/i,  iso3: "CHN" }, // mechanical
  { pattern: /\b(cables?|wires?|battery|batteries)\b/i,                    iso3: "CHN" }, // electrical
  { pattern: /\b(paints?|coatings?|cleaners?|detergents?)\b/i,             iso3: "CHN" }, // chemicals
  { pattern: /\b(oils?|fluids?|greases?)\b/i,                              iso3: "CHN" }, // fluids
];

/* ═══════════════════════════════════════════════════════════════
   INFERENCE FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

function inferHsCode(description: string, manufacturer: string | null): string | null {
  const text = `${description} ${manufacturer || ""}`;
  for (const rule of HS_CODE_RULES) {
    if (rule.pattern.test(text)) return rule.code;
  }
  return null;
}

type CooResult = { iso3: string; confidence: "High" | "Medium" | "Low"; reason: string };

function inferCountry(manufacturer: string | null, description: string = ""): CooResult | null {
  const haystack = `${manufacturer || ""} ${description}`.trim();
  if (!haystack) return null;

  // ─── Tier 1: HIGH ────────────────────────────────────────────
  for (const rule of BRAND_COUNTRY) {
    if (rule.pattern.test(haystack)) {
      return { iso3: rule.iso3, confidence: "High", reason: "Known brand" };
    }
  }
  for (const rule of UNIQUE_SUFFIXES) {
    if (rule.pattern.test(haystack)) {
      return { iso3: rule.iso3, confidence: "High", reason: "Country-unique corporate suffix or place name" };
    }
  }

  // ─── Tier 2: MEDIUM ──────────────────────────────────────────
  for (const rule of PRODUCT_SIGNATURES) {
    if (rule.pattern.test(haystack)) {
      return { iso3: rule.iso3, confidence: "Medium", reason: rule.why };
    }
  }
  for (const rule of SOFT_SUFFIXES) {
    if (rule.pattern.test(haystack)) {
      return { iso3: rule.iso3, confidence: "Medium", reason: "Common corporate suffix" };
    }
  }

  // ─── Tier 3: LOW ─────────────────────────────────────────────
  for (const rule of CATEGORY_DEFAULT) {
    if (rule.pattern.test(haystack)) {
      return { iso3: rule.iso3, confidence: "Low", reason: "Category-default probabilistic origin" };
    }
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════
   HANDLER
   ═══════════════════════════════════════════════════════════════ */

type EnrichedRecord = {
  id: string;
  lineNumber: number;
  description: string;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
  cooConfidence?: string | null;
  cooReason?: string;
  enrichedFields: string[];
  skippedFields?: string[];
};

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });

  let body: { itemIds?: string[]; fields?: string[] } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const fields = body.fields && body.fields.length > 0
    ? body.fields
    : ["hsCode", "countryOfOrigin"];

  const enrichHs = fields.includes("hsCode");
  const enrichCoo = fields.includes("countryOfOrigin");

  const version = await prisma.agreementVersion.findFirst({ where: { id, organizationId: authorization.context.organizationId } });
  if (!version) {
    return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  }

  const itemWhere: { versionId: string; id?: { in: string[] } } = { versionId: id };
  if (body.itemIds?.length) itemWhere.id = { in: body.itemIds };

  const candidates = await prisma.agreementItem.findMany({
    where: {
      ...itemWhere,
      OR: [
        ...(enrichHs ? [{ hsCode: null }, { hsCode: "" }] : []),
        ...(enrichCoo ? [{ countryOfOrigin: null }, { countryOfOrigin: "" }] : []),
      ],
    },
    orderBy: { lineNumber: "asc" },
  });

  const results: EnrichedRecord[] = [];

  for (const item of candidates) {
    const update: { hsCode?: string; countryOfOrigin?: string; cooConfidence?: string } = {};
    const enrichedFields: string[] = [];
    const skippedFields: string[] = [];
    let cooReason: string | undefined;

    if (enrichHs && !item.hsCode) {
      const guess = inferHsCode(item.description, item.manufacturer);
      if (guess) { update.hsCode = guess; enrichedFields.push("hsCode"); }
      else skippedFields.push("hsCode");
    }

    if (enrichCoo && !item.countryOfOrigin) {
      const guess = inferCountry(item.manufacturer, item.description);
      if (guess) {
        update.countryOfOrigin = guess.iso3;
        update.cooConfidence = guess.confidence;
        cooReason = guess.reason;
        enrichedFields.push("countryOfOrigin");
      } else {
        skippedFields.push("countryOfOrigin");
      }
    }

    if (Object.keys(update).length > 0) {
      const updated = await prisma.agreementItem.update({
        where: { id: item.id },
        data: update,
      });
      results.push({
        id: updated.id,
        lineNumber: updated.lineNumber,
        description: updated.description,
        hsCode: updated.hsCode,
        countryOfOrigin: updated.countryOfOrigin,
        cooConfidence: updated.cooConfidence,
        cooReason,
        enrichedFields,
        skippedFields: skippedFields.length > 0 ? skippedFields : undefined,
      });
    } else if (skippedFields.length > 0) {
      results.push({
        id: item.id,
        lineNumber: item.lineNumber,
        description: item.description,
        enrichedFields: [],
        skippedFields,
      });
    }
  }

  const hsFilled = results.filter((r) => r.enrichedFields.includes("hsCode")).length;
  const cooFilled = results.filter((r) => r.enrichedFields.includes("countryOfOrigin")).length;
  const byConfidence = {
    High:   results.filter((r) => r.cooConfidence === "High").length,
    Medium: results.filter((r) => r.cooConfidence === "Medium").length,
    Low:    results.filter((r) => r.cooConfidence === "Low").length,
  };
  const skippedItems = results
    .filter((r) => r.skippedFields && r.skippedFields.length > 0)
    .map((r) => ({
      lineNumber: r.lineNumber,
      description: r.description,
      skippedFields: r.skippedFields!,
    }));

  return NextResponse.json({
    candidatesScanned: candidates.length,
    hsFilled,
    cooFilled,
    cooConfidenceBreakdown: byConfidence,
    enrichedCount: results.filter((r) => r.enrichedFields.length > 0).length,
    skippedCount: skippedItems.length,
    skippedItems,
    results,
  });
}
