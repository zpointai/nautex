import { normalizeTrustedOrigin } from "./security.mjs";

export const DESKTOP_DEPLOYMENT_MODES = Object.freeze({
  STANDALONE: "standalone",
  OFFICE_HOST: "office-host",
  OFFICE_CLIENT: "office-client",
  DEVELOPMENT: "development",
});

const MODE_VALUES = new Set(Object.values(DESKTOP_DEPLOYMENT_MODES));

export function normalizeDeploymentMode(value, fallback = DESKTOP_DEPLOYMENT_MODES.OFFICE_CLIENT) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return fallback;
  if (!MODE_VALUES.has(normalized)) throw new Error(`Unsupported Nautex deployment mode: ${value}.`);
  return normalized;
}

export function topologyForMode(value) {
  const mode = normalizeDeploymentMode(value);
  if (mode === DESKTOP_DEPLOYMENT_MODES.STANDALONE) {
    return Object.freeze({ mode, managesBackend: true, managesDatabase: true, acceptsOfficeClients: false, sharedDataset: false });
  }
  if (mode === DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST) {
    return Object.freeze({ mode, managesBackend: true, managesDatabase: true, acceptsOfficeClients: true, sharedDataset: true });
  }
  if (mode === DESKTOP_DEPLOYMENT_MODES.OFFICE_CLIENT) {
    return Object.freeze({ mode, managesBackend: false, managesDatabase: false, acceptsOfficeClients: false, sharedDataset: true });
  }
  return Object.freeze({ mode, managesBackend: false, managesDatabase: false, acceptsOfficeClients: false, sharedDataset: false });
}

export function validateTopologyConfiguration(input = {}, { allowDevelopment = false } = {}) {
  const mode = normalizeDeploymentMode(input.mode);
  const topology = topologyForMode(mode);
  const configuredOrigin = typeof input.backendOrigin === "string" ? input.backendOrigin.trim() : "";

  if (mode === DESKTOP_DEPLOYMENT_MODES.DEVELOPMENT) {
    if (!allowDevelopment) throw new Error("Development deployment mode is not allowed in a packaged release.");
    return {
      ...topology,
      backendOrigin: normalizeTrustedOrigin(configuredOrigin || "http://127.0.0.1:3000", { allowLocalhostHttp: true }),
    };
  }

  if (mode === DESKTOP_DEPLOYMENT_MODES.STANDALONE) {
    if (configuredOrigin) throw new Error(`${mode} mode resolves its backend origin from the managed local runtime.`);
    return { ...topology, backendOrigin: "" };
  }

  if (mode === DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST && !configuredOrigin) {
    return { ...topology, backendOrigin: "" };
  }

  return {
    ...topology,
    backendOrigin: normalizeTrustedOrigin(configuredOrigin),
  };
}
