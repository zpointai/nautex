import type { ValidationReviewStatus } from "./validator";

export interface ValidationHumanReview {
  status?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  note?: string | null;
}

/** A legacy automatic 'Approved' value is not evidence of a human decision. */
export function validationReviewStatus(summary: { humanReview?: ValidationHumanReview; reviewStatus?: string }): ValidationReviewStatus {
  const human = summary.humanReview;
  const status = human?.status ?? summary.reviewStatus;
  if (status === "Approved") {
    return human?.reviewedBy?.trim() && human.reviewedAt && Number.isFinite(Date.parse(human.reviewedAt))
      ? "Approved" : "Pending Review";
  }
  return status === "Rejected" || status === "Blocked" ? status : "Pending Review";
}
