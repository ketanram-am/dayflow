import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** OpenStreetMap view of the office geofence and the employee's last real GPS fix. */
export default function GeoMap({ office, radius, you, status }: { office: [number, number]; radius: number; you: [number, number] | null; status?: string | undefined }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(office, 17);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const fence = L.circle(office, { radius, color: "hsl(217 91% 55%)", weight: 2, fillOpacity: 0.12 }).addTo(g);
    L.marker(office, { icon: L.divIcon({ className: "", html: '<div class="geo-office-pin">⌂</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(g).bindTooltip("Office");
    if (you) {
      const color = status === "inside" ? "geo-you-in" : status === "outside" ? "geo-you-out" : "geo-you-unsure";
      L.marker(you, { icon: L.divIcon({ className: "", html: `<div class="geo-you ${color}"><span></span></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(g).bindTooltip("You (last GPS fix)");
      L.polyline([office, you], { color: "hsl(217 91% 55%)", dashArray: "4 4", weight: 1.5 }).addTo(g);
      m.fitBounds(L.latLngBounds([office, you]).extend(fence.getBounds()), { padding: [24, 24], maxZoom: 18 });
    } else m.fitBounds(fence.getBounds(), { padding: [24, 24] });
  }, [office[0], office[1], radius, you?.[0], you?.[1], status]);

  return <div ref={el} className="h-56 w-full overflow-hidden rounded-xl" />;
}
