import {
  deleteLocalObject,
  getLocalObject,
  putLocalObject,
  type LocalDeleteResult,
} from "@/lib/storage/local-object-storage";

export type StorageProviderName = "local";

export interface ObjectStorageProvider {
  readonly name: StorageProviderName;
  put(storageKey: string, data: Buffer): Promise<void>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string, options?: { permanent?: boolean }): Promise<LocalDeleteResult>;
}

const localProvider: ObjectStorageProvider = {
  name: "local",
  put: putLocalObject,
  get: getLocalObject,
  delete: deleteLocalObject,
};

export function getObjectStorageProvider(name = process.env.NAUTEX_STORAGE_PROVIDER || "local"): ObjectStorageProvider {
  if (name === "local") return localProvider;
  throw new Error(`Unsupported object storage provider: ${name}`);
}

export function putObject(provider: string, storageKey: string, data: Buffer) {
  return getObjectStorageProvider(provider).put(storageKey, data);
}

export function getObject(provider: string, storageKey: string) {
  return getObjectStorageProvider(provider).get(storageKey);
}

export function deleteObject(provider: string, storageKey: string, options?: { permanent?: boolean }) {
  return getObjectStorageProvider(provider).delete(storageKey, options);
}
