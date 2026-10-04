export const COMPANY_SOURCE_FIELDS = ["legalName", "address", "postalCode", "city", "country", "companyNumber"] as const;
export type CompanySourceField = typeof COMPANY_SOURCE_FIELDS[number];
export type CompanySourceCandidate = {
  id: string; sourceUrl: string; source: "GLEIF"; name: string;
  entityStatus: string; registrationStatus: string; sourceUpdatedAt: string | null;
  fields: Partial<Record<CompanySourceField, string>>;
};
export type CompanySourceReview = {
  id: string; checkedAt: string; baseHash: string;
  status: "searching" | "review_required" | "no_matches" | "failed" | "applied" | "dismissed";
  candidates: CompanySourceCandidate[]; message: string;
  reviewedAt?: string; selectedCandidateId?: string; appliedFields?: CompanySourceField[];
};
