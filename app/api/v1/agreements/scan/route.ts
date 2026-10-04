/**
 * Agreement Scan API
 *
 * POST /api/v1/agreements/scan — trigger expiry/stale draft scan (manual or scheduled)
 */

import { NextResponse } from "next/server";
import { scanExpiryAndStaleDrafts } from "@/lib/agreements/insights";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request);
  if (!authorization.ok) return authorization.response;
  const result = await scanExpiryAndStaleDrafts(authorization.context.organizationId);
  return NextResponse.json({ success: true, ...result });
}
