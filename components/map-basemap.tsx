"use client";

import { useState } from "react";
import { TileLayer } from "@/components/leaflet-bindings";

// Shared by fleet, supplier directory, profile and miniature maps. Browser caching
// is left intact; only visible tiles are requested, without retina/prefetch loads.
export function MapBasemap() {
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <>
    <TileLayer key={attempt}
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}
      maxZoom={19} keepBuffer={0} updateWhenIdle={true} detectRetina={false}
      eventHandlers={{ loading: () => setUnavailable(false), tileerror: () => setUnavailable(true) }}
    />
    {unavailable && <div role="status" className="absolute left-2 right-2 top-2 z-[1000] rounded border border-warning/40 bg-surface-container p-2 text-sm text-on-surface" onClick={event => event.stopPropagation()}>
      Map background unavailable. Check your internet connection; recorded locations remain available.
      <button type="button" className="ml-2 underline" onClick={() => { setUnavailable(false); setAttempt(value => value + 1); }}>Retry map</button>
    </div>}
  </>;
}
