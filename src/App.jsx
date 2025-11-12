import React, { useState, useEffect } from "react";

// Waterlogging Route Checker (Vercel-safe version)
// Uses dynamic Leaflet import (no window.L at build time)
// Includes live rainfall check (Open-Meteo) + OSM water detection (Overpass)

export default function App() {
  const [originAddr, setOriginAddr] = useState("");
  const [destAddr, setDestAddr] = useState("");
  const [origin, setOrigin] = useState(null);
  const [dest, setDest] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState("");
  const [routeGeo, setRouteGeo] = useState(null);
  const [checking, setChecking] = useState(false);
  const mapRef = React.useRef(null);
  const routeLayerRef = React.useRef(null);
  const samplesMarkersRef = React.useRef([]);

  // ✅ Dynamic Leaflet import (fixes Vercel build issue)
  useEffect(() => {
    if (typeof window === "undefined") return;
    import("leaflet").then((L) => {
      if (!mapRef.current) {
        const map = L.map("map").setView([20.5937, 78.9629], 5);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "© OpenStreetMap contributors",
        }).addTo(map);
        mapRef.current = map;

        map.on("click", function (e) {
          const choice = window.confirm(
            "Set this point as Origin? (OK = Origin, Cancel = Destination)"
          );
          if (choice) {
            setOrigin({ lat: e.latlng.lat, lon: e.latlng.lng });
            setOriginAddr(
              `Lat ${e.latlng.lat.toFixed(5)}, Lon ${e.latlng.lng.toFixed(5)}`
            );
          } else {
            setDest({ lat: e.latlng.lat, lon: e.latlng.lng });
            setDestAddr(
              `Lat ${e.latlng.lat.toFixed(5)}, Lon ${e.latlng.lng.toFixed(5)}`
            );
          }
        });

        setMapReady(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!mapReady || !routeGeo) return;
    import("leaflet").then((L) => {
      const map = mapRef.current;
      if (routeLayerRef.current) {
        routeLayerRef.current.remove();
      }
      samplesMarkersRef.current.forEach((m) => m.remove());
      samplesMarkersRef.current = [];
      const coords = routeGeo.coordinates.map((c) => [c[1], c[0]]);
      const poly = L.polyline(coords, { color: "#1976d2", weight: 5 }).addTo(map);
      routeLayerRef.current = poly;
      map.fitBounds(poly.getBounds(), { padding: [50, 50] });
    });
  }, [routeGeo, mapReady]);

  async function geocode(address) {
    const q = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}`;
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    const data = await res.json();
    if (!data || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  }

  async function getRoute(from, to) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok") throw new Error("No route found");
    return data.routes[0].geometry;
  }

  function haversine(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const aC =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(aC), Math.sqrt(1 - aC));
  }

  function sampleLineString(geojson, spacingMeters = 300) {
    const coords = geojson.coordinates;
    const samples = [];
    for (let i = 0; i < coords.length; i += 10)
      samples.push({ lon: coords[i][0], lat: coords[i][1] });
    return samples;
  }

  async function checkWaterAroundPoint(lat, lon, radiusMeters = 60) {
    const query = `[out:json][timeout:25];(
      way(around:${radiusMeters},${lat},${lon})[natural=water];
      way(around:${radiusMeters},${lat},${lon})[waterway=riverbank];
      relation(around:${radiusMeters},${lat},${lon})[natural=water];
      node(around:${radiusMeters},${lat},${lon})[natural=water];
      way(around:${radiusMeters},${lat},${lon})[landuse=reservoir];
    );out center 1;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.elements && data.elements.length > 0;
  }

  async function fetchPrecipitationLastHours(lat, lon) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation&timezone=auto`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.hourly) return 0;
      const prec = data.hourly.precipitation.slice(-3);
      return prec.reduce((a, b) => a + b, 0);
    } catch {
      return 0;
    }
  }

  function riskLevel(water, rain) {
    if (water && rain > 10) return "High";
    if (water || rain > 5) return "Medium";
    return "Low";
  }

  async function handleCheckRoute() {
    try {
      setStatus("");
      setChecking(true);

      let from = origin || (await geocode(originAddr));
      let to = dest || (await geocode(destAddr));
      if (!from || !to) throw new Error("Invalid locations");

      setStatus("Getting route...");
      const geometry = await getRoute(from, to);
      setRouteGeo(geometry);

      setStatus("Checking water and rainfall...");
      const samples = sampleLineString(geometry);
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      samplesMarkersRef.current.forEach((m) => m.remove());
      samplesMarkersRef.current = [];

      let waterDetected = false;
      let maxRain = 0;

      for (const p of samples) {
        const marker = L.circleMarker([p.lat, p.lon], { radius: 5 }).addTo(map);
        samplesMarkersRef.current.push(marker);
        const hasWater = await checkWaterAroundPoint(p.lat, p.lon);
        if (hasWater) {
          marker.setStyle({ color: "#1e88e5" });
          waterDetected = true;
        }
        const rain = await fetchPrecipitationLastHours(p.lat, p.lon);
        maxRain = Math.max(maxRain, rain);
        if (rain > 10) marker.setStyle({ color: "#d32f2f" });
        else if (rain > 5) marker.setStyle({ color: "#f57c00" });
      }

      const risk = riskLevel(waterDetected, maxRain);
      setStatus(
        `Risk Level: ${risk}. Mapped water: ${waterDetected ? "Yes" : "No"}, Rain (last 3h): ${maxRain.toFixed(1)} mm`
      );
    } catch (e) {
      setStatus("Error: " + e.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: 14 }}>
      <h1>Waterlogging Route Checker 🌧️</h1>
      <p>Check if your route is near water or heavy rainfall.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={originAddr}
          onChange={(e) => setOriginAddr(e.target.value)}
          placeholder="Origin address"
          style={{ flex: 1, padding: 8 }}
        />
        <input
          value={destAddr}
          onChange={(e) => setDestAddr(e.target.value)}
          placeholder="Destination address"
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={handleCheckRoute} disabled={checking}>
          {checking ? "Checking..." : "Check Route"}
        </button>
      </div>
      <div id="map" style={{ height: 480, borderRadius: 8, marginBottom: 8 }}></div>
      <div
        style={{
          background: "#f8f9fb",
          padding: 12,
          borderRadius: 8,
          fontSize: 14,
        }}
      >
        <strong>Status:</strong> {status || "Idle"}
        <br />
        <small>Developed by Akshit Goswami</small>
      </div>
    </div>
  );
}
