import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

const MAX_STORED_BYTES = 512 * 1024;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function isExpectedImage(payload: Buffer, type: string) {
  if (type === "jpeg") return payload.length >= 3 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff;
  if (type === "png") return payload.length >= 8 && payload.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return payload.length >= 12 && payload.subarray(0, 4).toString("ascii") === "RIFF" && payload.subarray(8, 12).toString("ascii") === "WEBP";
}

export async function PATCH(request: Request) {
  const authorization = await authorizeRequest(request, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  if (authorization.context.development) {
    return fail("PROFILE_NOT_PERSISTED", "Profile photos require a signed-in employee account.", 409);
  }

  try {
    const body = await request.json() as { image?: unknown };
    if (body.image !== null && typeof body.image !== "string") {
      return fail("PROFILE_IMAGE_INVALID", "A profile image or null is required.", 400);
    }

    const image = body.image ?? null;
    if (image) {
      const match = IMAGE_DATA_URL.exec(image);
      if (!match) return fail("PROFILE_IMAGE_INVALID", "Profile photos must be JPEG, PNG, or WebP images.", 400);
      const payload = Buffer.from(match[2], "base64");
      if (!payload.length || payload.length > MAX_STORED_BYTES) {
        return fail("PROFILE_IMAGE_TOO_LARGE", "The prepared profile photo must be smaller than 512 KB.", 413);
      }
      if (!isExpectedImage(payload, match[1])) return fail("PROFILE_IMAGE_INVALID", "The profile image data is invalid.", 400);
    }

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: authorization.context.userId },
        data: { image },
        select: { image: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: authorization.context.organizationId,
          entityType: "User",
          entityId: authorization.context.userId,
          entityNumber: authorization.context.email,
          eventType: image ? "profile_photo_updated" : "profile_photo_removed",
          actorType: "User",
          actorId: authorization.context.userId,
          actorName: authorization.context.displayName,
          sourceModule: "profile",
          metadata: { imageStored: Boolean(image) },
        },
      });
      return updated;
    });
    return ok(user);
  } catch (error) {
    logApiError("PATCH /api/v1/auth/profile", error);
    return fail("PROFILE_UPDATE_FAILED", "Profile photo could not be updated.", 500);
  }
}
