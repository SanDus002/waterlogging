useEffect(() => {
  if (typeof window === "undefined") return; // prevent server crash
  import("leaflet").then(L => {
    if (!mapRef.current) {
      const map = L.map("map").setView([20.5937, 78.9629], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      mapRef.current = map;
      map.on("click", function (e) {
        const choice = window.confirm("Set this point as Origin? (OK = Origin, Cancel = Destination)");
        if (choice) {
          setOrigin({ lat: e.latlng.lat, lon: e.latlng.lng });
          setOriginAddr(`Lat ${e.latlng.lat.toFixed(5)}, Lon ${e.latlng.lng.toFixed(5)}`);
        } else {
          setDest({ lat: e.latlng.lat, lon: e.latlng.lng });
          setDestAddr(`Lat ${e.latlng.lat.toFixed(5)}, Lon ${e.latlng.lng.toFixed(5)}`);
        }
      });
      setMapReady(true);
    }
  });
}, []);

// (App.jsx code will be the full content you have in the canvas)
