/**
 * Design token values for JavaScript consumers.
 *
 * These mirror the CSS custom properties in app/globals.css. Tailwind classes
 * (`text-success`, `bg-warning/15`, …) remain the preferred way to apply color.
 * This module exists only for contexts that cannot use classes — SVG chart
 * strokes, Leaflet marker icons, and injected <style> blocks — so those stay in
 * sync with the rest of the design system instead of drifting to stock palettes.
 *
 * Keep in sync with the @theme block in app/globals.css.
 */

export const COLORS = {
  surfaceLowest: "#070e1c",
  surfaceBase: "#080f1e",
  surfaceLow: "#0e1525",
  surfaceContainer: "#19202e",
  surfaceHigh: "#232a39",
  surfaceHighest: "#2e3544",

  onSurface: "#dce2f6",
  onSurfaceVariant: "#aeb7c9",
  outline: "#9da8bb",
  outlineVariant: "#424754",

  primary: "#00cdb7",
  success: "#4edea3",
  successDim: "#10b981",
  error: "#ffb4ab",
  warning: "#ffb786",
  info: "#adc6ff",
  ai: "#c4b5fd",

  accentCyan: "#67e8f9",
  accentAmber: "#ffde6a",
  accentLime: "#a3e635",
} as const;

/** Supplier lifecycle status -> token color. Shared by the map and directory
 *  legend so both render the same color for the same status. */
export const SUPPLIER_STATUS_COLORS: Record<string, string> = {
  Active: COLORS.success,
  Verified: COLORS.info,
  Suggested: COLORS.ai,
  Watch: COLORS.accentAmber,
  Needs_Review: COLORS.warning,
  Inactive: COLORS.outline,
  Blocked: COLORS.error,
  Rejected: COLORS.error,
};
