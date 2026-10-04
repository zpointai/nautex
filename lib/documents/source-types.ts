/** Metadata is kept with the owning RFQ/review. Original bytes live in object storage. */
export interface StoredSourceDocument {
  version: 1;
  storageProvider: "local";
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  kind: "upload" | "text" | "record_snapshot";
}
