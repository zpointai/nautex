import type { Prisma } from "@prisma/client";
import { ApiRequestError } from "@/lib/api/request";
import { readRfqReview } from "./review";

export function assertRfqReviewConfirmed(review:unknown) {
  if(review && readRfqReview(review)?.status !== "confirmed") throw new ApiRequestError("RFQ_REVIEW_REQUIRED","Confirm the RFQ extraction review before downstream use.",409);
}
/** Serialize downstream creation with extraction editing and reject stale snapshots. */
export async function lockReviewedRfq(tx:Prisma.TransactionClient,id:string,organizationId:string,expectedUpdatedAt?:Date) {
  await tx.$queryRaw`SELECT id FROM rfqs WHERE id = ${id} AND organization_id = ${organizationId} FOR UPDATE`;
  const rfq=await tx.rfq.findFirst({where:{id,organizationId},select:{review:true,updatedAt:true}});
  if(!rfq)throw new ApiRequestError("RFQ_NOT_FOUND","RFQ not found in the active organization.",404);
  assertRfqReviewConfirmed(rfq.review);
  if(expectedUpdatedAt && rfq.updatedAt.getTime() !== expectedUpdatedAt.getTime())throw new ApiRequestError("RFQ_CHANGED","The source RFQ changed. Reopen it before creating downstream work.",409);
}
