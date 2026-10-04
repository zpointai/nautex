"use client";

import { useState } from "react";
import { COLORS } from "@/lib/design/tokens";

interface DonutChartProps {
  value: number;
  label: string;
  color?: string;
  size?: number;
}

export function DonutChart({ value, label, color = COLORS.success, size = 80 }: DonutChartProps) {
  const [hovered, setHovered] = useState(false);

  const strokeWidth = size < 60 ? 6 : 8;
  const padding = 4;
  const radius = (size - strokeWidth - padding * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const center = size / 2;
  const gradientId = `donut-${color.replace("#", "")}-${label.replace(/\s/g, "")}`;

  return (
    <div
      className="relative cursor-default transition-transform duration-300"
      style={{ width: size, height: size, transform: hovered ? "scale(1.08)" : "scale(1)" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle cx={center} cy={center} r={radius} fill="none" stroke={COLORS.surfaceHigh} strokeWidth={strokeWidth} strokeOpacity={0.6} />
        {/* Value arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={hovered ? strokeWidth + 1.5 : strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
          style={{ filter: `drop-shadow(0 0 ${hovered ? 8 : 4}px ${color}${hovered ? "60" : "30"})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold text-white transition-all duration-300 ${size < 60 ? "text-xs" : "text-sm"}`}>
          {value}%
        </span>
      </div>
    </div>
  );
}
