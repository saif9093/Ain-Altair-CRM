"use client";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import "leaflet.markercluster";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

type Lead = { id: string; name: string; lat: number; lng: number; tier: string | null; lead_score: number | null; website_status: string; whatsapp_e164: string | null; category_label: string | null };
type Cov = { bbox: number[] | null; location_label: string; category_key: string; searched_at: string; result_count: number };
const COLOR: Record<string, string> = { HOT: "#e8461f", HIGH: "#0b0b0b", GOOD: "#14213d", MEDIUM: "#8c8c86", LOW: "#c9c9c4" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function LeadMap({ leads, coverage, drawMode, canSearch }: { leads: Lead[]; coverage: Cov[]; drawMode: boolean; canSearch: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [drawing, setDrawing] = useState(drawMode);
  const [pts, setPts] = useState<L.LatLng[]>([]);
  const poly = useRef<L.Polygon | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView([25.2, 55.27], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(m);
    const cluster = (L as unknown as { markerClusterGroup: () => L.LayerGroup }).markerClusterGroup();
    for (const l of leads) {
      const mk = L.circleMarker([l.lat, l.lng], { radius: 7, color: "#fff", weight: 1.5, fillColor: COLOR[l.tier ?? "LOW"] ?? "#999", fillOpacity: 0.95 });
      mk.bindPopup(`<b>${esc(l.name)}</b><br/>${esc(l.category_label ?? "")}<br/>Score: ${l.lead_score ?? "—"} (${l.tier ?? "—"})<br/>Website: ${esc(l.website_status.replace(/_/g, " ").toLowerCase())}<br/>WhatsApp: ${l.whatsapp_e164 ? "yes" : "no"}<br/><a href="/leads/${l.id}">Open lead →</a>`);
      cluster.addLayer(mk);
    }
    m.addLayer(cluster);
    const cov = L.layerGroup();
    for (const c of coverage) if (c.bbox?.length === 4) L.rectangle([[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]], { color: "#14213d", weight: 1, fillOpacity: 0.05 }).bindTooltip(`${c.location_label} · ${c.category_key} · ${c.result_count} results`).addTo(cov);
    L.control.layers({}, { "Research coverage": cov }).addTo(m);
    if (leads.length) m.fitBounds(L.latLngBounds(leads.map((l) => [l.lat, l.lng] as [number, number])), { padding: [30, 30], maxZoom: 13 });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, [leads, coverage]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const onClick = (e: L.LeafletMouseEvent) => drawing && setPts((p) => [...p, e.latlng]);
    m.on("click", onClick);
    return () => { m.off("click", onClick); };
  }, [drawing]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    poly.current?.remove();
    if (pts.length >= 2) poly.current = L.polygon(pts, { color: "#e8461f" }).addTo(m);
  }, [pts]);

  return (
    <div className="space-y-3">
      {canSearch && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant={drawing ? "primary" : "outline"} onClick={() => { setDrawing(!drawing); setPts([]); }}>{drawing ? "Drawing… click map to add points" : "Draw search area"}</Button>
          {pts.length >= 3 && <Button size="sm" variant="dark" onClick={() => router.push(`/search?polygon=${encodeURIComponent(JSON.stringify(pts.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }))))}`)}>Search inside this area →</Button>}
          {pts.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPts([])}>Clear</Button>}
          <span className="text-xs text-mute">{leads.length} leads with coordinates · colour = tier</span>
        </div>
      )}
      <div ref={el} className="h-[70vh] overflow-hidden rounded-2xl border border-line" />
    </div>
  );
}
