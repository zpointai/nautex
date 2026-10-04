import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { prisma } from "@/lib/prisma";
import { PURCHASE_ORDER_AUDIT_EVENTS, recordPurchaseOrderAuditEvent } from "@/lib/purchase-orders/erp-audit";

/**
 * GET /api/v1/purchase-orders/:id/notes
 * Returns all notes for a PO, newest first.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!access.ok) return access.response;
    if (!access.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    const notes = await prisma.purchaseOrderNote.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, data: notes, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_NOTES_LIST_FAILED", message: "Failed to fetch notes." } },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/purchase-orders/:id/notes
 * Create a new note and record an event.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
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

    // Verify order exists
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, poNumber: true } });
    if (!order) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 },
      );
    }

    const note = await prisma.purchaseOrderNote.create({
      data: {
        orderId: id,
        text: body.text.trim(),
        author: authorization.context.displayName,
      },
    });

    // Record event
    const preview = note.text.substring(0, 80) + (note.text.length > 80 ? "..." : "");
    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: id,
        type: "note_added",
        summary: `Note added: ${preview}`,
        detail: note.text,
        actor: note.author,
      },
    });

    await recordPurchaseOrderAuditEvent({
      order,
      eventType: PURCHASE_ORDER_AUDIT_EVENTS.NOTE_ADDED,
      actorName: note.author,
      after: { noteId: note.id, text: note.text },
      metadata: { noteId: note.id, preview },
    });

    return NextResponse.json({ ok: true, data: note, meta: { source: "postgres" } }, { status: 201 });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_NOTE_CREATE_FAILED", message: "Failed to create note." } },
      { status: 500 },
    );
  }
}
