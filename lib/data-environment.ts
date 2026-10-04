import { OrganizationDataMode } from "@prisma/client";

export const DATA_ENVIRONMENTS = ["operational", "demo", "screenshot", "test", "all"] as const;
export type DataEnvironment = (typeof DATA_ENVIRONMENTS)[number];

export function getDataEnvironment(): DataEnvironment {
  const configured = process.env.NAUTEX_DATA_MODE?.trim().toLowerCase();
  if (DATA_ENVIRONMENTS.includes(configured as DataEnvironment)) return configured as DataEnvironment;

  // Transitional compatibility for existing local installations.
  if (process.env.NAUTEX_DEMO_MODE?.trim().toLowerCase() === "true") return "demo";
  return "operational";
}

export function organizationDataModeToEnvironment(mode: OrganizationDataMode): Exclude<DataEnvironment, "all"> {
  switch (mode) {
    case OrganizationDataMode.Demo:
      return "demo";
    case OrganizationDataMode.Screenshot:
      return "screenshot";
    case OrganizationDataMode.Test:
      return "test";
    default:
      return "operational";
  }
}

export function isOrganizationDataModeAllowed(mode: OrganizationDataMode) {
  const environment = getDataEnvironment();
  return environment === "all" || organizationDataModeToEnvironment(mode) === environment;
}

export function allowedOrganizationDataModes(): OrganizationDataMode[] | undefined {
  const environment = getDataEnvironment();
  if (environment === "all") return undefined;
  return Object.values(OrganizationDataMode).filter((mode) => organizationDataModeToEnvironment(mode) === environment);
}

export function resolveOrganizationDataViewMode(
  requested: string | null | undefined,
  organizationMode: OrganizationDataMode,
): DataEnvironment {
  const environment = getDataEnvironment();
  const organizationEnvironment = organizationDataModeToEnvironment(organizationMode);
  if (environment !== "all") return organizationEnvironment;

  const normalized = requested?.trim().toLowerCase();
  return DATA_ENVIRONMENTS.includes(normalized as DataEnvironment)
    ? normalized as DataEnvironment
    : organizationEnvironment;
}
