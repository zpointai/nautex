import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { haversineKm, nearestHub } from "@/lib/geo";

/**
 * GET /api/v1/suppliers
 *
 * List suppliers with full-text search, status/region filters, and pagination.
 * Query params: q, status, region, category, nearRegion, nearLat, nearLng, page, limit, sort, order
 *
 * Geospatial sorting:
 *   - nearLat + nearLng: sort by Haversine distance from coordinates
 *   - nearRegion: fallback text-based regional relevance sort
 */
export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const status = url.searchParams.get("status");
    const region = url.searchParams.get("region");
    const category = url.searchParams.get("category");
    const nearRegion = url.searchParams.get("nearRegion"); // text-based location sorting
    const nearLat = parseFloat(url.searchParams.get("nearLat") ?? "");
    const nearLng = parseFloat(url.searchParams.get("nearLng") ?? "");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));
    const requestedSortField = url.searchParams.get("sort") ?? "name";
    const sortOrder = url.searchParams.get("order") === "desc" ? "desc" : "asc";
    const allowedSortFields = new Set([
      "name",
      "supplierCode",
      "region",
      "country",
      "city",
      "status",
      "score",
      "leadTimeDays",
      "createdAt",
      "updatedAt",
    ]);
    const sortField = allowedSortFields.has(requestedSortField) ? requestedSortField : "name";

    // Build where clause
    const conditions: any[] = [{ organizationId: authorization.context.organizationId }];

    if (q) {
      conditions.push({
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { supplierCode: { contains: q, mode: "insensitive" } },
          { region: { contains: q, mode: "insensitive" } },
          { country: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          { address: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
          { website: { contains: q, mode: "insensitive" } },
          { contactPerson: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { categories: { has: q } },
          { portsCovered: { has: q } },
          // Also search case-insensitively in arrays by checking common capitalizations
          { categories: { hasSome: [q, q.charAt(0).toUpperCase() + q.slice(1).toLowerCase()] } },
          { portsCovered: { hasSome: [q, q.charAt(0).toUpperCase() + q.slice(1).toLowerCase()] } },
        ],
      });
    }

    // Exclude archived/blocked from default views unless explicitly requested
    if (status) {
      conditions.push({ status });
    } else {
      // By default, don't show Blocked or Rejected suppliers
      conditions.push({ status: { notIn: ["Blocked", "Rejected"] } });
    }

    if (region) {
      conditions.push({ region: { contains: region, mode: "insensitive" } });
    }

    if (category) {
      conditions.push({ categories: { has: category } });
    }

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [data, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: { [sortField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: {
            select: {
              contracts: true,
              agreementVersions: true,
              supplierQuotes: true,
              purchaseOrders: true,
              supplierInvoices: true,
            },
          },
        },
      }),
      prisma.supplier.count({ where }),
    ]);

    // ── Geospatial sorting ──────────────────────────────────────
    let sorted = data;

    if (!isNaN(nearLat) && !isNaN(nearLng)) {
      // Coordinate-based proximity sort (Haversine)
      sorted = [...data].sort((a, b) => {
        const aDist = a.lat !== null && a.lng !== null
          ? haversineKm(nearLat, nearLng, a.lat, a.lng) : Infinity;
        const bDist = b.lat !== null && b.lng !== null
          ? haversineKm(nearLat, nearLng, b.lat, b.lng) : Infinity;
        if (aDist !== bDist) return aDist - bDist;
        return b.score - a.score;
      });
    } else if (nearRegion) {
      // Text-based regional relevance sort (fallback)
      const nr = nearRegion.toLowerCase();
      sorted = [...data].sort((a, b) => {
        const aMatch = a.region.toLowerCase().includes(nr) || (a.country?.toLowerCase().includes(nr) ?? false) ? 0 : 1;
        const bMatch = b.region.toLowerCase().includes(nr) || (b.country?.toLowerCase().includes(nr) ?? false) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return b.score - a.score;
      });
    }

    // Attach nearest hub info when proximity sorting is active
    const enrichedData = (!isNaN(nearLat) && !isNaN(nearLng))
      ? sorted.map((s) => ({
          ...s,
          _distanceKm: s.lat !== null && s.lng !== null
            ? Math.round(haversineKm(nearLat, nearLng, s.lat, s.lng)) : null,
          _nearestHub: s.lat !== null && s.lng !== null
            ? nearestHub(s.lat, s.lng).hub.name : null,
        }))
      : sorted;

    return NextResponse.json({
      ok: true,
      data: enrichedData,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch suppliers.";
    return NextResponse.json({ ok: false, error: { message } }, { status: 500 });
  }
}

/**
 * POST /api/v1/suppliers
 *
 * Create a new supplier. Auto-generates supplierCode.
 */
export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = await req.json();

    if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ ok: false, error: { message: "Supplier name is required." } }, { status: 400 });
    }

    // Generate supplier code: SUP-XXXX (sequential)
    const supplierCode = await generateSupplierCode(authorization.context.organizationId);

    // Compute initial score based on profile completeness
    const initialScore = computeProfileScore(body);

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: authorization.context.organizationId,
        supplierCode,
        name: body.name.trim(),
        region: body.region ?? "Unknown",
        country: body.country ?? null,
        city: body.city ?? null,
        address: body.address ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        website: body.website ?? null,
        contactPerson: body.contactPerson ?? null,
        description: body.description ?? null,
        categories: body.categories ?? [],
        portsCovered: body.portsCovered ?? [],
        score: body.score ?? initialScore,
        leadTimeDays: body.leadTimeDays ?? 0,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        status: body.status ?? "Active",
        enrichmentStatus: body.enrichmentStatus ?? "None",
        confidence: body.confidence ?? null,
        sourceReferences: body.sourceReferences ?? [],
      },
    });

    return NextResponse.json({ ok: true, data: supplier }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create supplier.";
    return NextResponse.json({ ok: false, error: { message } }, { status: 500 });
  }
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function generateSupplierCode(organizationId: string): Promise<string> {
  const last = await prisma.supplier.findFirst({
    where: { organizationId },
    orderBy: { supplierCode: "desc" },
    select: { supplierCode: true },
  });

  let next = 1;
  if (last?.supplierCode) {
    const match = last.supplierCode.match(/^SUP-(\d+)$/);
    if (match) next = parseInt(match[1]) + 1;
  }

  return `SUP-${String(next).padStart(4, "0")}`;
}

/**
 * Compute a profile completeness score (0-100).
 * Used as initial score for new suppliers, and can be recalculated.
 */
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

export { computeProfileScore };
