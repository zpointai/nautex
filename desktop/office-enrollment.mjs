import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeTrustedOrigin } from "./security.mjs";

export const OFFICE_ENROLLMENT_TYPE = "nautex-office-enrollment";
export const OFFICE_ENROLLMENT_VERSION = 1;

export function normalizeCertificateSha256(value) {
  const normalized = typeof value === "string"
    ? value.replace(/[^a-fA-F0-9]/g, "").toUpperCase()
    : "";
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error("The office host certificate SHA-256 fingerprint is invalid.");
  }
  return normalized;
}

export function validateOfficeEnrollment(value) {
  if (!value || typeof value !== "object") throw new Error("The Nautex office enrollment profile is invalid.");
  if (value.type !== OFFICE_ENROLLMENT_TYPE || value.formatVersion !== OFFICE_ENROLLMENT_VERSION) {
    throw new Error("The Nautex office enrollment profile format is unsupported.");
  }
  const officeName = typeof value.officeName === "string" ? value.officeName.trim() : "";
  if (!officeName || officeName.length > 120) throw new Error("The office name in the enrollment profile is invalid.");
  return Object.freeze({
    type: OFFICE_ENROLLMENT_TYPE,
    formatVersion: OFFICE_ENROLLMENT_VERSION,
    officeName,
    backendOrigin: normalizeTrustedOrigin(value.backendOrigin),
    certificateSha256: normalizeCertificateSha256(value.certificateSha256),
  });
}

export async function readOfficeEnrollment(filePath) {
  return validateOfficeEnrollment(JSON.parse(await readFile(filePath, "utf8")));
}

export async function writeOfficeEnrollment(filePath, profile) {
  const validated = validateOfficeEnrollment(profile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return validated;
}

export function certificateMatchesEnrollment(profile, certificate) {
  if (!profile || !certificate) return false;
  try {
    return normalizeCertificateSha256(certificate.fingerprint256) === profile.certificateSha256;
  } catch {
    return false;
  }
}
