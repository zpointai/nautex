import { createHash } from "node:crypto";
import { ApiIdempotencyStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/api/response";

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

async function requestHash(request: Request) {
  const hash = createHash("sha256")
    .update(request.method)
    .update("\0")
    .update(new URL(request.url).pathname)
    .update("\0");
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.clone().formData();
    const entries = await Promise.all(Array.from(form.entries()).map(async ([name, value]) => {
      if (value instanceof File) {
        const contentHash = createHash("sha256").update(Buffer.from(await value.arrayBuffer())).digest("hex");
        return `${name}\0file\0${value.name}\0${value.type}\0${value.size}\0${contentHash}`;
      }
      return `${name}\0field\0${value}`;
    }));
    for (const entry of entries.sort()) hash.update(entry).update("\0");
  } else {
    hash.update(Buffer.from(await request.clone().arrayBuffer()));
  }
  return hash.digest("hex");
}

function replay(body: Prisma.JsonValue, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("x-idempotent-replay", "true");
  return response;
}

export async function executeIdempotentRequest(options: {
  request: Request;
  organizationId: string;
  route: string;
  handler: () => Promise<Response>;
}) {
  const key = options.request.headers.get("idempotency-key")?.trim();
  if (!key) return options.handler();
  if (!KEY_PATTERN.test(key)) {
    return fail("IDEMPOTENCY_KEY_INVALID", "Idempotency-Key must contain 8-128 letters, numbers, dots, colons, underscores, or hyphens.", 400);
  }

  const hash = await requestHash(options.request);
  const unique = {
    organizationId_route_key: {
      organizationId: options.organizationId,
      route: options.route,
      key,
    },
  };
  let existing = await prisma.apiIdempotencyRecord.findUnique({ where: unique });
  if (existing?.expiresAt && existing.expiresAt <= new Date()) {
    await prisma.apiIdempotencyRecord.deleteMany({ where: { id: existing.id, expiresAt: { lte: new Date() } } });
    existing = null;
  }
  if (existing) {
    if (existing.requestHash !== hash) return fail("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request.", 409);
    if (existing.status === ApiIdempotencyStatus.Completed && existing.responseBody != null && existing.responseStatus != null) {
      return replay(existing.responseBody, existing.responseStatus);
    }
    const response = fail("IDEMPOTENCY_REQUEST_IN_PROGRESS", "A request with this Idempotency-Key is still processing.", 409);
    response.headers.set("retry-after", "5");
    return response;
  }

  try {
    await prisma.apiIdempotencyRecord.create({
      data: {
        organizationId: options.organizationId,
        route: options.route,
        key,
        requestHash: hash,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return executeIdempotentRequest(options);
    }
    throw error;
  }

  try {
    const response = await options.handler();
    if (response.status >= 500) {
      await prisma.apiIdempotencyRecord.deleteMany({ where: { ...unique.organizationId_route_key, key } });
      return response;
    }
    const body = await response.clone().json().catch(() => null) as Prisma.InputJsonValue | null;
    if (body == null) {
      await prisma.apiIdempotencyRecord.deleteMany({ where: { ...unique.organizationId_route_key, key } });
      return response;
    }
    await prisma.apiIdempotencyRecord.update({
      where: unique,
      data: {
        status: ApiIdempotencyStatus.Completed,
        responseStatus: response.status,
        responseBody: body,
      },
    });
    return response;
  } catch (error) {
    await prisma.apiIdempotencyRecord.deleteMany({ where: { ...unique.organizationId_route_key, key } }).catch(() => undefined);
    throw error;
  }
}
