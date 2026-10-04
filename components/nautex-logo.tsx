interface NautexLogoProps {
  size?: number;
  className?: string;
  variant?: "primary" | "reversed";
}

export function NautexLogo({ size = 40, className = "", variant = "reversed" }: NautexLogoProps) {
  const source = variant === "reversed" ? "/brand/nautex-mark-reversed.svg" : "/brand/nautex-mark.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Brand SVG preserves the approved outlined master geometry.
    <img src={source} alt="Nautex AI" width={size} height={size} className={className} />
  );
}

interface NautexLogoFullProps {
  height?: number;
  className?: string;
  variant?: "primary" | "reversed";
}

export function NautexLogoFull({ height = 40, className = "", variant = "reversed" }: NautexLogoFullProps) {
  const source = variant === "reversed"
    ? "/brand/nautex-logo-horizontal-reversed.svg"
    : "/brand/nautex-logo-horizontal.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Brand SVG preserves the approved outlined master geometry.
    <img src={source} alt="Nautex AI" width={Math.round(height * 3.88)} height={height} className={className} />
  );
}
