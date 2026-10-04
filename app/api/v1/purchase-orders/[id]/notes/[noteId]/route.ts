import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/v1/purchase-orders/:id/notes/:noteId
 * Edit a note's text.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id, noteId } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    const body = await req.json();

    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_NOTE_TEXT_REQUIRED", message: "Note text is required." } },
        { status: 400 },
      );
    }

    const existing = await prisma.purchaseOrderNote.findFirst({
      where: { id: noteId, orderId: id },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_NOTE_NOT_FOUND", message: "Note not found." } },
        { status: 404 },
      );
    }

    const note = await prisma.purchaseOrderNote.update({
      where: { id: noteId },
      data: { text: body.text.trim() },
    });

    // Record event
    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: id,
        type: "note_edited",
        summary: `Note edited`,
        detail: `Updated to: ${note.text.substring(0, 120)}`,
        actor: authorization.context.displayName,
      },
    });

    return NextResponse.json({ ok: true, data: note, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_NOTE_UPDATE_FAILED", message: "Failed to update note." } },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v1/purchase-orders/:id/notes/:noteId
 * Delete a note.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id, noteId } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });

    const existing = await prisma.purchaseOrderNote.findFirst({
      where: { id: noteId, orderId: id },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_NOTE_NOT_FOUND", message: "Note not found." } },
        { status: 404 },
      );
    }

    await prisma.purchaseOrderNote.delete({ where: { id: noteId } });

    // Record event
    const preview = existing.text.substring(0, 80) + (existing.text.length > 80 ? "..." : "");
    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: id,
        type: "note_deleted",
        summary: `Note deleted: ${preview}`,
        detail: existing.text,
        actor: authorization.context.displayName,
      },
    });

    return NextResponse.json({ ok: true, data: { deleted: true, id: noteId }, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_NOTE_DELETE_FAILED", message: "Failed to delete note." } },
      { status: 500 },
    );
  }
}
