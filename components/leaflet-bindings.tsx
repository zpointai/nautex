"use client";
// Original, narrowly scoped React bindings for the Leaflet APIs used by Nautex.
// Copyright 2026 Zlatin Gorov. SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";

const MapContext = createContext<L.Map | null>(null);
const MarkerContext = createContext<L.Marker | null>(null);
export function useMap() { const map = useContext(MapContext); if (!map) throw new Error("Map context is required"); return map; }

export function MapContainer({ children, style, ...options }: L.MapOptions & { children?: ReactNode; style?: CSSProperties }) {
  const container = useRef<HTMLDivElement>(null);
  const initial = useRef(options);
  const [map, setMap] = useState<L.Map | null>(null);
  useEffect(() => {
    const instance = L.map(container.current!, initial.current);
    setMap(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current!);
    return () => { observer.disconnect(); instance.remove(); };
  }, []);
  return <div ref={container} style={style}>{map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}</div>;
}

export function Marker({ position, children, eventHandlers, ...options }: L.MarkerOptions & { position: L.LatLngExpression; children?: ReactNode; eventHandlers?: L.LeafletEventHandlerFnMap }) {
  const map = useMap();
  const initial = useRef({ position, options });
  const [marker, setMarker] = useState<L.Marker | null>(null);
  useEffect(() => {
    const instance = L.marker(initial.current.position, initial.current.options).addTo(map);
    setMarker(instance);
    return () => { instance.remove(); };
  }, [map]);
  useEffect(() => { marker?.setLatLng(position); }, [marker, position]);
  useEffect(() => { if (options.icon) marker?.setIcon(options.icon); }, [marker, options.icon]);
  useEffect(() => { marker?.setZIndexOffset(options.zIndexOffset ?? 0); }, [marker, options.zIndexOffset]);
  useEffect(() => { if (!marker || !eventHandlers) return; marker.on(eventHandlers); return () => { marker.off(eventHandlers); }; }, [marker, eventHandlers]);
  return marker ? <MarkerContext.Provider value={marker}>{children}</MarkerContext.Provider> : null;
}

export function Popup({ children, ...options }: L.PopupOptions & { children?: ReactNode }) {
  const marker = useContext(MarkerContext);
  const content = useMemo(() => document.createElement("div"), []);
  const initial = useRef(options);
  useEffect(() => { if (!marker) return; marker.bindPopup(content, initial.current); return () => { marker.unbindPopup(); }; }, [marker, content]);
  return createPortal(children, content);
}

export function TileLayer({ url, eventHandlers, ...options }: L.TileLayerOptions & { url: string; eventHandlers?: L.LeafletEventHandlerFnMap }) {
  const map = useMap();
  const initial = useRef(options);
  const [layer, setLayer] = useState<L.TileLayer | null>(null);
  useEffect(() => { const instance = L.tileLayer(url, initial.current); setLayer(instance); return () => { instance.remove(); }; }, [map, url]);
  useEffect(() => { if (!layer) return; if (eventHandlers) layer.on(eventHandlers); layer.addTo(map); return () => { if (eventHandlers) layer.off(eventHandlers); }; }, [map, layer, eventHandlers]);
  return null;
}

export function ZoomControl({ position }: { position: L.ControlPosition }) {
  const map = useMap();
  useEffect(() => { const control = L.control.zoom({ position }).addTo(map); return () => { control.remove(); }; }, [map, position]);
  return null;
}

export function Polyline({ positions, pathOptions }: { positions: L.LatLngExpression[]; pathOptions?: L.PolylineOptions }) {
  const map = useMap();
  const coordinates = JSON.stringify(positions), style = JSON.stringify(pathOptions ?? {});
  useEffect(() => { const line = L.polyline(JSON.parse(coordinates), JSON.parse(style)).addTo(map); return () => { line.remove(); }; }, [map, coordinates, style]);
  return null;
}

export function Circle({ center, radius, pathOptions }: { center: L.LatLngExpression; radius: number; pathOptions?: L.PathOptions }) {
  const map = useMap();
  const coordinates = JSON.stringify(center), style = JSON.stringify(pathOptions ?? {});
  useEffect(() => { const circle = L.circle(JSON.parse(coordinates), { ...JSON.parse(style), radius }).addTo(map); return () => { circle.remove(); }; }, [map, coordinates, radius, style]);
  return null;
}
