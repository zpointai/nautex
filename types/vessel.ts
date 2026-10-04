export interface VesselResult {
  id: string;
  mmsi: string;
  imo?: string;
  name: string;
  callsign?: string;
  flag?: string;
  type?: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  course: number;
  destination: string;
  eta: string;
  status: string;
  timestamp: string;
  refreshedAt?: string;
  zone?: string;
  src?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  imageUrl?: string;
  confidence?: "High" | "Medium" | "Low";
  warnings?: string[];
  draught?: number;
  length?: number;
  beam?: number;
}

export interface VesselTrackPoint {
  timestamp: string;
  lat: number;
  lng: number;
  speed: number;
  source?: string;
}

export interface VesselRisk {
  vesselId: string;
  confidence: "High" | "Medium" | "Low";
  etaRisk: "Stable" | "Monitor" | "Critical";
  summary: string;
  anomalies: string[];
}

export interface VesselOrderLink {
  id: string;
  vesselId: string;
  orderId: string;
  stage: "RFQ" | "PO" | "Delivery";
  port: string;
  impact: "Low" | "Medium" | "High";
}

