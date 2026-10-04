import { COLORS } from "@/lib/design/tokens";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SERIES_COLORS = {
  primary: { solid: COLORS.success, dim: "rgba(78, 222, 163, 0.2)" },
  secondary: { solid: COLORS.accentCyan, dim: "rgba(103, 232, 249, 0.15)" },
};

interface BarChartProps {
  /** Monthly primary values. If omitted, shows empty placeholder bars. */
  values?: number[];
  /** Optional secondary monthly values rendered beside the primary bars. */
  secondaryValues?: number[];
  /** Labels matching the supplied monthly values. Defaults to calendar months. */
  labels?: string[];
}

export function BarChart({ values, secondaryValues, labels }: BarChartProps) {
  const primaryData = values ?? [];
  const secondaryData = secondaryValues ?? [];
  const hasSecondary = secondaryData.length > 0;
  const chartLabels = labels?.length ? labels : MONTHS;
  const hasData = [...primaryData, ...secondaryData].some((v) => v > 0);
  const max = hasData ? Math.max(...primaryData, ...secondaryData, 1) : 1;

  return (
    <div>
      <div className="h-52 flex items-end gap-2 px-1">
        {chartLabels.map((month, i) => {
          const primaryValue = primaryData[i] ?? 0;
          const secondaryValue = secondaryData[i] ?? 0;
          const primaryHeight = hasData && primaryValue > 0 ? Math.max((primaryValue / max) * 100, 2) : 0;
          const secondaryHeight = hasData && secondaryValue > 0 ? Math.max((secondaryValue / max) * 100, 2) : 0;
          return (
            <div key={`${month}-${i}`} className="w-full h-full flex items-end gap-1">
              <div
                className="flex-1 rounded-t-md transition-all cursor-pointer hover:brightness-125"
                style={{
                  height: hasData ? `${primaryHeight}%` : "8%",
                  background: hasData
                    ? `linear-gradient(180deg, ${SERIES_COLORS.primary.solid} 0%, ${SERIES_COLORS.primary.solid}99 100%)`
                    : "rgba(255,255,255,0.03)",
                  boxShadow: hasData && primaryValue > max * 0.6 ? `0 0 8px ${SERIES_COLORS.primary.solid}30` : "none",
                }}
                title={hasData ? `${month}: ${primaryValue} purchase orders` : `${month}: No data`}
              />
              {hasSecondary && (
                <div
                  className="flex-1 rounded-t-md transition-all cursor-pointer hover:brightness-125"
                  style={{
                    height: hasData ? `${secondaryHeight}%` : "8%",
                    background: hasData ? SERIES_COLORS.secondary.dim : "rgba(255,255,255,0.03)",
                    boxShadow: hasData && secondaryValue > max * 0.6 ? `0 0 8px ${SERIES_COLORS.secondary.solid}30` : "none",
                  }}
                  title={hasData ? `${month}: ${secondaryValue} RFQs` : `${month}: No data`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-3 text-[0.6rem] uppercase tracking-normal text-outline px-1">
        {chartLabels.map((m, i) => <span key={`${m}-${i}`}>{m}</span>)}
      </div>
      {!hasData && (
        <p className="text-center text-[0.65rem] text-outline mt-4">No procurement data available yet</p>
      )}
    </div>
  );
}
