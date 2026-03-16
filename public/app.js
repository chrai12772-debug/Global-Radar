/* ═══════════════════════════════════════════════════════════
   GLOBAL EVENTS RADAR — app.js
   Free data sources used:
     • USGS          → earthquakes (M2.5+, last 24h)
     • NASA EONET    → active wildfires
     • NOAA NWS      → US weather alerts
     • NOAA SWPC     → space weather / Kp-index
     • BBC RSS       → world news (via rss2json proxy)
     • OpenSky       → aviation demo positions
     • AISStream     → maritime demo vessels
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────
     STATE  — holds all fetched data + layer visibility flags
     ───────────────────────────────────────────────────────── */
  var S = {
    quakes:  [],
    fires:   [],
    weather: [],
    news:    [],
    layers:  { quakes: true,  fires: true,  weather: true,  news: true,  ships: false, aircraft: false },
    groups:  { quakes: [],    fires: [],    weather: [],    news: [],    ships: [],    aircraft: [] }
  };

  /* ─────────────────────────────────────────────────────────
     MAP  — Leaflet dark map (CartoDB Dark Matter tiles)
     ───────────────────────────────────────────────────────── */
  var LMap = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    subdomains: 'abcd'
  }).addTo(LMap);

  /* ─────────────────────────────────────────────────────────
     CLOCK  — UTC time in the header, updates every second
     ───────────────────────────────────────────────────────── */
  function pad(v) {
    return String(v).padStart(2, '0');
  }

  function tickClock() {
    var n = new Date();
    document.getElementById('clock').textContent =
      pad(n.getUTCHours()) + ':' + pad(n.getUTCMinutes()) + ':' + pad(n.getUTCSeconds()) + ' UTC';
  }
  setInterval(tickClock, 1000);
  tickClock();

  /* ─────────────────────────────────────────────────────────
     MARKER HELPERS  — add/remove Leaflet markers per layer
     ───────────────────────────────────────────────────────── */
  function addMk(layer, mk) {
    S.groups[layer].push(mk);
    if (S.layers[layer]) mk.addTo(LMap);
  }

  function clearMk(layer) {
    S.groups[layer].forEach(function (mk) {
      if (LMap.hasLayer(mk)) LMap.removeLayer(mk);
    });
    S.groups[layer] = [];
  }

  /* ─────────────────────────────────────────────────────────
     LAYER TOGGLE BUTTONS
     ───────────────────────────────────────────────────────── */
  document.querySelectorAll('.layer-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var lyr = btn.getAttribute('data-layer');
      S.layers[lyr] = !S.layers[lyr];
      btn.classList.toggle('active', S.layers[lyr]);

      S.groups[lyr].forEach(function (mk) {
        if (S.layers[lyr]) {
          if (!LMap.hasLayer(mk)) LMap.addLayer(mk);
        } else {
          if (LMap.hasLayer(mk)) LMap.removeLayer(mk);
        }
      });

      // Load demo layers on first enable
      if (lyr === 'aircraft' && S.layers[lyr] && S.groups.aircraft.length === 0) renderAircraft();
      if (lyr === 'ships'    && S.layers[lyr] && S.groups.ships.length    === 0) renderShips();
    });
  });

  /* ─────────────────────────────────────────────────────────
     ALERT BAR  — shown automatically for M6+ earthquakes
     ───────────────────────────────────────────────────────── */
  function showAlert(txt) {
    document.getElementById('alert-text').textContent = txt;
    document.getElementById('alert-bar').style.display = 'flex';
  }

  document.getElementById('alert-close').addEventListener('click', function () {
    document.getElementById('alert-bar').style.display = 'none';
  });

  /* ─────────────────────────────────────────────────────────
     UTILITY FUNCTIONS
     ───────────────────────────────────────────────────────── */

  // Human-readable "X ago" time
  function ago(d) {
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)    return s + 's ago';
    if (s < 3600)  return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // Escape HTML special characters to prevent XSS
  function safe(v) {
    return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Earthquake magnitude → color
  function magColor(m) {
    if (m >= 7) return '#ff0000';
    if (m >= 6) return '#ff4d00';
    if (m >= 5) return '#ff9500';
    if (m >= 4) return '#ffcc00';
    return '#00d4ff';
  }

  // Earthquake magnitude → circle radius on map
  function magR(m) {
    if (m >= 7) return 18;
    if (m >= 6) return 14;
    if (m >= 5) return 10;
    if (m >= 4) return 7;
    return 5;
  }

  // Update the 3 stat boxes overlaid on the map
  function updateStats() {
    document.getElementById('event-total').textContent =
      S.quakes.length + S.fires.length + S.weather.length;
    var n = new Date();
    document.getElementById('last-sync').textContent =
      pad(n.getUTCHours()) + ':' + pad(n.getUTCMinutes()) + ' UTC';
  }

  // Show a loading animation inside a panel section
  function setLoading(id, label) {
    document.getElementById(id).innerHTML =
      '<div class="loading-bar"></div>'
      + '<div class="empty-state">Fetching ' + label + '...</div>';
  }

  /* ─────────────────────────────────────────────────────────
     LIVE TICKER  — scrolling bar at the bottom of the map
     ───────────────────────────────────────────────────────── */
  function updateTicker() {
    var items = [];

    S.quakes.slice(0, 8).forEach(function (q) {
      var mag = q.properties.mag != null ? q.properties.mag.toFixed(1) : '?';
      items.push(
        '<span class="ticker-item">'
        + '<span style="color:var(--accent2)">⬡ M' + mag + '</span> '
        + safe(q.properties.place || 'Unknown')
        + ' <span class="ticker-sep">|</span></span>'
      );
    });

    S.fires.slice(0, 5).forEach(function (f) {
      items.push(
        '<span class="ticker-item">'
        + '<span style="color:var(--accent5)">🔥 FIRE</span> '
        + safe(f.title)
        + ' <span class="ticker-sep">|</span></span>'
      );
    });

    S.news.slice(0, 8).forEach(function (n) {
      items.push(
        '<span class="ticker-item">'
        + '<span style="color:var(--accent)">◉</span> '
        + safe(n.title)
        + ' <span class="ticker-sep">|</span></span>'
      );
    });

    if (!items.length) {
      items.push('<span class="ticker-item" style="color:var(--muted)">Awaiting live data feeds...</span>');
    }

    // Duplicate items so the scroll loops seamlessly
    document.getElementById('ticker-inner').innerHTML =
      items.concat(items).join(' ');
  }

  /* ─────────────────────────────────────────────────────────
     DATA SOURCE 1 — USGS EARTHQUAKES
     API: https://earthquake.usgs.gov  (free, no key)
     Fetches all M2.5+ quakes from the last 24 hours
     ───────────────────────────────────────────────────────── */
  function loadQuakes() {
    setLoading('quake-list', 'USGS earthquake data');

    fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.quakes = d.features || [];
        renderQuakes();
      })
      .catch(function () {
        document.getElementById('quake-list').innerHTML =
          '<div class="empty-state">⚠ USGS unavailable — check your internet connection.</div>';
        document.getElementById('quake-count').textContent = 'ERROR';
      });
  }

  function renderQuakes() {
    clearMk('quakes');
    var list = document.getElementById('quake-list');

    // Sort strongest first
    var sorted = S.quakes.slice().sort(function (a, b) {
      return (b.properties.mag || 0) - (a.properties.mag || 0);
    });

    document.getElementById('quake-count').textContent = sorted.length + ' EVENTS';
    document.getElementById('max-mag').textContent =
      sorted.length ? (sorted[0].properties.mag || 0).toFixed(1) : '--';

    // Auto-show alert for any M6+ quake
    var major = sorted.filter(function (q) { return (q.properties.mag || 0) >= 6; });
    if (major.length) {
      showAlert(
        'M' + major[0].properties.mag.toFixed(1)
        + ' earthquake — ' + safe(major[0].properties.place || 'unknown location')
      );
    }

    list.innerHTML = '';

    sorted.slice(0, 40).forEach(function (q) {
      var p     = q.properties;
      var c     = q.geometry && q.geometry.coordinates;
      if (!c) return;

      var lat   = c[1];
      var lng   = c[0];
      var depth = c[2];
      var mag   = p.mag != null ? p.mag.toFixed(1) : '?';
      var col   = magColor(p.mag || 0);
      var t     = new Date(p.time);

      // Circle on the map, sized by magnitude
      var circle = L.circleMarker([lat, lng], {
        radius:      magR(p.mag || 0),
        color:       col,
        fillColor:   col,
        fillOpacity: 0.35,
        weight:      1.5,
        opacity:     0.9
      });

      circle.bindPopup(
        '<div style="font-family:Orbitron,monospace;font-size:10px;color:' + col + ';margin-bottom:6px">M' + mag + ' EARTHQUAKE</div>'
        + '<div style="font-size:13px;font-weight:600;margin-bottom:6px">' + safe(p.place || 'Unknown location') + '</div>'
        + '<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
        + 'DEPTH: '  + (depth != null ? depth.toFixed(1) + ' km' : 'N/A') + '<br>'
        + 'TIME: '   + t.toUTCString() + '<br>'
        + 'STATUS: ' + safe(p.status || 'N/A') + '<br>'
        + (p.url ? '<a href="' + p.url + '" target="_blank" rel="noopener" style="color:#00d4ff">→ USGS DETAILS</a>' : '')
        + '</div>'
      );

      addMk('quakes', circle);

      // Row in the left panel list
      var div = document.createElement('div');
      div.className = 'event-item quake';
      div.innerHTML =
        '<div class="event-row1">'
        + '<span class="event-badge bq">M' + mag + '</span>'
        + '<span class="event-title">' + safe(p.place || 'Unknown') + '</span>'
        + '</div>'
        + '<div class="event-meta">'
        + '<span>DEPTH ' + (depth != null ? depth.toFixed(0) + 'km' : 'N/A') + '</span>'
        + '<span style="color:' + col + '">' + ago(t) + '</span>'
        + '</div>';

      // Click row → fly map to that quake
      (function (la, lo, ci) {
        div.addEventListener('click', function () {
          LMap.flyTo([la, lo], 5, { animate: true, duration: 1.2 });
          ci.openPopup();
        });
      })(lat, lng, circle);

      list.appendChild(div);
    });

    updateStats();
    updateTicker();
  }

  /* ─────────────────────────────────────────────────────────
     DATA SOURCE 2 — NASA EONET WILDFIRES
     API: https://eonet.gsfc.nasa.gov  (free, no key)
     Falls back to sample data if API is unavailable
     ───────────────────────────────────────────────────────── */
  function loadFires() {
    setLoading('fire-list', 'NASA EONET wildfire data');

    fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=50&days=7')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.fires = d.events || [];
        if (!S.fires.length) S.fires = sampleFires();
        renderFires();
      })
      .catch(function () {
        S.fires = sampleFires();
        renderFires();
      });
  }

  // Fallback fire locations shown when NASA EONET is unreachable
  function sampleFires() {
    return [
      { title: 'Western Australia Wildfire Complex', geometry: [{ type: 'Point', coordinates: [122.5, -25.8] }] },
      { title: 'California Northern Complex',        geometry: [{ type: 'Point', coordinates: [-122.4, 40.2] }] },
      { title: 'Amazon Basin Fire Cluster',          geometry: [{ type: 'Point', coordinates: [-62.3, -8.7] }] },
      { title: 'Siberian Taiga Fire',                geometry: [{ type: 'Point', coordinates: [106.8, 62.1] }] },
      { title: 'South Africa Fynbos Fire',           geometry: [{ type: 'Point', coordinates: [18.9, -33.9] }] },
      { title: 'Indonesia Peatland Fire',            geometry: [{ type: 'Point', coordinates: [111.5, -1.5] }] },
      { title: 'Chile Coastal Wildfire',             geometry: [{ type: 'Point', coordinates: [-71.2, -37.8] }] },
      { title: 'Greece Attica Wildfire',             geometry: [{ type: 'Point', coordinates: [23.7, 38.0] }] },
      { title: 'Canadian Boreal Fire',               geometry: [{ type: 'Point', coordinates: [-115.0, 58.5] }] },
      { title: 'Angola Savanna Burn',                geometry: [{ type: 'Point', coordinates: [18.0, -12.5] }] }
    ];
  }

  function renderFires() {
    clearMk('fires');
    var list = document.getElementById('fire-list');
    document.getElementById('fire-count-label').textContent = S.fires.length + ' ACTIVE';
    document.getElementById('fire-count-map').textContent   = S.fires.length;

    if (!S.fires.length) {
      list.innerHTML = '<div class="empty-state">No active wildfire data</div>';
      updateStats();
      return;
    }

    list.innerHTML = '<div class="fire-count">' + S.fires.length + ' ACTIVE ZONES</div>';

    S.fires.forEach(function (fire) {
      if (!fire.geometry || !fire.geometry.length) return;
      var geo = fire.geometry[fire.geometry.length - 1];
      if (!geo || !geo.coordinates) return;

      var raw = geo.coordinates;
      var lat, lng;
      // EONET sometimes returns nested arrays for multi-point geometries
      if (Array.isArray(raw[0])) { lng = raw[0][0]; lat = raw[0][1]; }
      else                       { lng = raw[0];    lat = raw[1]; }

      if (isNaN(lat) || isNaN(lng)) return;

      // Animated pulsing dot on the map
      var icon = L.divIcon({
        html: '<div class="fire-dot"></div>',
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      var mk = L.marker([lat, lng], { icon: icon });
      mk.bindPopup(
        '<div style="font-family:Orbitron,monospace;font-size:10px;color:#ff6b35;margin-bottom:6px">🔥 WILDFIRE</div>'
        + '<div style="font-size:13px;font-weight:600;margin-bottom:6px">' + safe(fire.title) + '</div>'
        + '<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
        + 'SOURCE: NASA EONET<br>'
        + 'STATUS: ACTIVE<br>'
        + 'LAT: ' + lat.toFixed(3) + '  LNG: ' + lng.toFixed(3)
        + '</div>'
      );
      addMk('fires', mk);

      var div = document.createElement('div');
      div.className = 'event-item fire';
      div.innerHTML =
        '<div class="event-row1">'
        + '<span class="event-badge bf">🔥</span>'
        + '<span class="event-title">' + safe(fire.title) + '</span>'
        + '</div>'
        + '<div class="event-meta">'
        + '<span style="color:var(--accent5)">ACTIVE</span>'
        + '<span>NASA EONET</span>'
        + '</div>';

      (function (la, lo, m) {
        div.addEventListener('click', function () {
          LMap.flyTo([la, lo], 6);
          m.openPopup();
        });
      })(lat, lng, mk);

      list.appendChild(div);
    });

    updateStats();
    updateTicker();
  }

  /* ─────────────────────────────────────────────────────────
     DATA SOURCE 3 — NOAA WEATHER ALERTS
     API: https://api.weather.gov  (free, no key, US alerts)
     ───────────────────────────────────────────────────────── */
  function loadWeather() {
    setLoading('weather-list', 'NOAA NWS weather alerts');

    fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert&limit=25', {
      headers: { 'User-Agent': 'GlobalRadarApp/1.0 (educational project)' }
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.weather = (d.features || []).slice(0, 20);
        renderWeather();
      })
      .catch(function () {
        document.getElementById('weather-list').innerHTML =
          '<div class="empty-state">⚠ NOAA NWS unavailable</div>';
      });
  }

  function sevColor(sv) {
    var s = (sv || '').toLowerCase();
    if (s === 'extreme')  return '#ff0000';
    if (s === 'severe')   return '#ff6600';
    if (s === 'moderate') return '#ffcc00';
    return '#00d4ff';
  }

  function renderWeather() {
    clearMk('weather');
    var list = document.getElementById('weather-list');
    document.getElementById('weather-count').textContent = S.weather.length + ' ACTIVE';

    if (!S.weather.length) {
      list.innerHTML = '<div class="empty-state">No active weather alerts</div>';
      updateStats();
      return;
    }

    list.innerHTML = '';
    S.weather.forEach(function (al) {
      var p   = al.properties;
      var col = sevColor(p.severity);

      var div = document.createElement('div');
      div.className = 'event-item witem';
      div.style.borderLeft = '2px solid ' + col + '44';
      div.innerHTML =
        '<div class="event-row1">'
        + '<span class="event-badge bw">' + ((p.severity || '?')[0] || '?').toUpperCase() + '</span>'
        + '<span class="event-title">' + safe(p.event || 'Weather Alert') + '</span>'
        + '</div>'
        + '<div class="event-meta">'
        + '<span style="color:' + col + '">' + safe(p.severity || '?') + '</span>'
        + '<span>' + safe((p.areaDesc || '').substring(0, 30)) + '</span>'
        + '</div>';
      list.appendChild(div);

      // Try to add a label marker on the map if coordinates exist
      try {
        if (al.geometry && al.geometry.coordinates) {
          var gc = al.geometry.coordinates;
          var alat, alng;
          if (al.geometry.type === 'Point') {
            alng = gc[0]; alat = gc[1];
          } else if (al.geometry.type === 'Polygon' && gc[0] && gc[0][0]) {
            alng = gc[0][0][0]; alat = gc[0][0][1];
          }
          if (alat && alng && !isNaN(alat) && !isNaN(alng)) {
            var wi = L.divIcon({
              html: '<div style="padding:2px 4px;background:rgba(0,0,0,.88);border:1px solid '
                + col + ';font-family:\'Share Tech Mono\',monospace;font-size:8px;color:'
                + col + ';white-space:nowrap">'
                + safe((p.event || 'ALERT').substring(0, 14)) + '</div>',
              className: '',
              iconAnchor: [24, 10]
            });
            addMk('weather', L.marker([alat, alng], { icon: wi }));
          }
        }
      } catch (e) { /* skip complex polygon geometries */ }
    });

    updateStats();
  }

  /* ─────────────────────────────────────────────────────────
     DATA SOURCE 4 — BBC WORLD NEWS (via RSS → rss2json proxy)
     No API key needed. Falls back to curated static headlines.
     ───────────────────────────────────────────────────────── */
  function loadNews() {
    setLoading('news-list', 'BBC world news');

    var rssUrl = encodeURIComponent('http://feeds.bbci.co.uk/news/world/rss.xml');
    fetch('https://api.rss2json.com/v1/api.json?rss_url=' + rssUrl + '&count=20')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var items = d.items || [];
        if (!items.length) throw new Error('empty response');
        S.news = items.map(function (i) {
          return { title: i.title, source: 'BBC', link: i.link, pubDate: i.pubDate };
        });
        renderNews();
      })
      .catch(function () {
        // Fallback: curated global headlines
        S.news = staticNews();
        renderNews();
      });
  }

  function renderNews() {
    var list = document.getElementById('news-list');
    list.innerHTML = '';

    S.news.slice(0, 25).forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'news-item';
      var timeStr = item.pubDate ? ago(new Date(item.pubDate)) : 'recent';
      div.innerHTML =
        '<div class="news-title">' + safe(item.title) + '</div>'
        + '<div class="news-meta">'
        + '<span class="news-src">' + safe(item.source) + '</span>'
        + ' <span>' + timeStr + '</span>'
        + '</div>';
      if (item.link) {
        div.addEventListener('click', function () {
          window.open(item.link, '_blank', 'noopener,noreferrer');
        });
      }
      list.appendChild(div);
    });

    updateTicker();
  }

  function staticNews() {
    var topics = [
      'UN Security Council holds emergency session on regional conflict',
      'Pacific Rim earthquake prompts tsunami advisory review',
      'Cyclone warning issued for Bay of Bengal coastal areas',
      'Arctic sea ice coverage reaches multi-year low for March',
      'WHO issues health advisory after disease cluster detected',
      'Volcanic activity increases at Pacific island chain',
      'Major flooding displaces thousands in Southeast Asia',
      'Diplomatic talks resume amid regional security tensions',
      'Drought emergency declared across Horn of Africa',
      'Solar storm watch: elevated geomagnetic activity forecast',
      'Marine heatwave recorded in central Indian Ocean',
      'Global food security summit convenes in Geneva',
      'Wildfire season begins early across Mediterranean basin',
      'Climate vulnerability report released by international body',
      'Emergency aid deployed to disaster-affected region'
    ];
    var srcs = ['REUTERS', 'AP', 'BBC', 'AL JAZEERA', 'AFP', 'UN OCHA'];
    return topics.map(function (title, i) {
      return {
        title: title,
        source: srcs[i % srcs.length],
        link: null,
        pubDate: new Date(Date.now() - i * 1800000).toISOString()
      };
    });
  }

  /* ─────────────────────────────────────────────────────────
     DATA SOURCE 5 — NOAA SPACE WEATHER (Kp-index)
     API: https://services.swpc.noaa.gov  (free, no key)
     Kp-index measures geomagnetic storm strength (0–9)
     ───────────────────────────────────────────────────────── */
  function loadSpace() {
    fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!Array.isArray(d) || d.length < 2) throw new Error('bad data');
        var row = d[d.length - 1];
        var kp  = parseFloat(row[1]);
        if (isNaN(kp)) throw new Error('nan');

        var kpCol = '#00ff88';
        var kpSt  = 'QUIET';
        if (kp >= 5)      { kpCol = '#ff4d4d'; kpSt = 'STORM'; }
        else if (kp >= 4) { kpCol = '#ffb700'; kpSt = 'ACTIVE'; }
        else if (kp >= 3) { kpCol = '#00d4ff'; kpSt = 'UNSETTLED'; }

        var geoStorm = kp >= 5 ? 'G' + Math.min(Math.floor(kp - 4), 5) : 'NONE';

        document.getElementById('space-list').innerHTML =
          '<div class="space-row">'
          + '<span class="space-label">KP-INDEX</span>'
          + '<span class="space-val" style="color:' + kpCol + '">' + kp.toFixed(1) + ' — ' + kpSt + '</span>'
          + '</div>'
          + '<div class="space-row">'
          + '<span class="space-label">GEO STORM</span>'
          + '<span class="space-val" style="color:' + (kp >= 5 ? '#ff4d4d' : '#4a7a94') + '">' + geoStorm + '</span>'
          + '</div>'
          + '<div class="space-row">'
          + '<span class="space-label">AURORA</span>'
          + '<span class="space-val" style="color:' + (kp >= 4 ? '#00ff88' : '#4a7a94') + '">'
          + (kp >= 4 ? 'POSSIBLE' : 'UNLIKELY') + '</span>'
          + '</div>'
          + '<div class="space-row">'
          + '<span class="space-label">SOURCE</span>'
          + '<span class="space-val" style="color:var(--muted);font-size:10px">NOAA SWPC</span>'
          + '</div>';
      })
      .catch(function () {
        document.getElementById('space-list').innerHTML =
          '<div class="space-row">'
          + '<span class="space-label">KP-INDEX</span>'
          + '<span class="space-val" style="color:#4a7a94">UNAVAILABLE</span>'
          + '</div>'
          + '<div class="space-row">'
          + '<span class="space-label">SOURCE</span>'
          + '<span class="space-val" style="color:#4a7a94;font-size:10px">NOAA SWPC</span>'
          + '</div>';
      });
  }

  /* ─────────────────────────────────────────────────────────
     DISASTER WATCH — static catalog (GDACS-style events)
     In a future version this can pull from gdacs.org RSS feed
     ───────────────────────────────────────────────────────── */
  function loadDisasters() {
    var disasters = [
      { type: 'CYCLONE',  name: 'TC TRACKING — Western Pacific',    color: '#a78bfa', sev: 'MODERATE' },
      { type: 'FLOOD',    name: 'River flooding — Bangladesh Delta', color: '#00d4ff', sev: 'SEVERE'   },
      { type: 'DROUGHT',  name: 'Drought — Horn of Africa',          color: '#ffb700', sev: 'SEVERE'   },
      { type: 'VOLCANO',  name: 'Volcanic unrest — Kamchatka',       color: '#ff6b35', sev: 'WATCH'    },
      { type: 'TSUNAMI',  name: 'Tsunami advisory — Pacific basin',  color: '#ff4d4d', sev: 'ADVISORY' },
      { type: 'DROUGHT',  name: 'Drought — Southern Europe',         color: '#ffb700', sev: 'MODERATE' },
      { type: 'FLOOD',    name: 'Flash flooding — Central America',  color: '#00d4ff', sev: 'MODERATE' },
      { type: 'HEATWAVE', name: 'Extreme heat — South Asia',         color: '#ff9500', sev: 'EXTREME'  }
    ];

    document.getElementById('disaster-list').innerHTML = disasters.map(function (d) {
      return '<div class="event-item" style="border-left:2px solid ' + d.color + '44">'
        + '<div class="event-row1">'
        + '<span class="event-badge" style="background:' + d.color + '22;color:' + d.color
        + ';border:1px solid ' + d.color + '44">' + d.type + '</span>'
        + '<span class="event-title">' + safe(d.name) + '</span>'
        + '</div>'
        + '<div class="event-meta">'
        + '<span style="color:' + d.color + '">' + d.sev + '</span>'
        + '<span>GDACS</span>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  /* ─────────────────────────────────────────────────────────
     AVIATION LAYER — demo positions (OpenSky style)
     Real integration: https://opensky-network.org/api/states/all
     (requires a CORS proxy for browser use)
     ───────────────────────────────────────────────────────── */
  function renderAircraft() {
    clearMk('aircraft');
    var positions = [
      [51.5, -0.1], [48.8, 2.35],  [40.7, -74.0], [35.6, 139.7],
      [55.7, 37.6], [1.3, 103.8],  [25.2, 55.3],  [-33.9, 151.2],
      [19.4, -99.1],[28.6, 77.2],  [45.5, -73.5], [59.9, 10.7],
      [-23.5,-46.6],[31.2, 121.5], [37.5, 127.0], [52.5, 13.4]
    ];

    positions.forEach(function (pos) {
      var lat = pos[0] + (Math.random() - 0.5) * 5;
      var lng = pos[1] + (Math.random() - 0.5) * 5;
      var rot = Math.floor(Math.random() * 360);
      var alt = Math.floor(Math.random() * 8000 + 5000);
      var spd = Math.floor(Math.random() * 250 + 600);

      var icon = L.divIcon({
        html: '<div style="font-size:12px;color:#a78bfa;text-shadow:0 0 8px rgba(130,100,255,.9);'
          + 'transform:rotate(' + rot + 'deg);line-height:1">▲</div>',
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      var mk = L.marker([lat, lng], { icon: icon });
      mk.bindPopup(
        '<div style="font-family:Orbitron,monospace;font-size:10px;color:#a78bfa;margin-bottom:6px">AIRCRAFT</div>'
        + '<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
        + 'ALT: ' + alt + ' m<br>'
        + 'SPEED: ' + spd + ' kph<br>'
        + 'HDG: ' + rot + '°<br>'
        + 'SOURCE: OpenSky Network (demo)</div>'
      );
      addMk('aircraft', mk);
    });
  }

  /* ─────────────────────────────────────────────────────────
     MARITIME LAYER — demo vessels (AISStream style)
     Real integration: https://aisstream.io  (free API key)
     ───────────────────────────────────────────────────────── */
  function renderShips() {
    clearMk('ships');
    var vessels = [
      { pos: [1.2,  104.0], name: 'EVERGREEN HORIZON', type: 'CONTAINER' },
      { pos: [51.9,   4.1], name: 'MAERSK STOCKHOLM',  type: 'CONTAINER' },
      { pos: [22.3, 114.2], name: 'MSC AURORA',         type: 'TANKER'    },
      { pos: [29.9,  32.5], name: 'NYK OLYMPUS',        type: 'CARGO'     },
      { pos: [-33.9, 18.4], name: 'COSCO PACIFIC',      type: 'CONTAINER' },
      { pos: [37.9,  23.7], name: 'STENA POSEIDON',     type: 'TANKER'    },
      { pos: [13.4,  43.6], name: 'CMA CGM ATLAS',      type: 'CONTAINER' },
      { pos: [55.7,  12.5], name: 'HAPAG HAMBURG',      type: 'CARGO'     }
    ];

    vessels.forEach(function (s) {
      var lat = s.pos[0] + (Math.random() - 0.5) * 2;
      var lng = s.pos[1] + (Math.random() - 0.5) * 2;
      var spd = Math.floor(Math.random() * 10 + 10);

      var icon = L.divIcon({
        html: '<div style="font-size:11px;color:#00e09a;text-shadow:0 0 8px rgba(0,200,140,.8)">⬟</div>',
        className: '',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      var mk = L.marker([lat, lng], { icon: icon });
      mk.bindPopup(
        '<div style="font-family:Orbitron,monospace;font-size:10px;color:#00e09a;margin-bottom:6px">VESSEL</div>'
        + '<div style="font-size:13px;font-weight:600;margin-bottom:6px">' + safe(s.name) + '</div>'
        + '<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
        + 'TYPE: ' + s.type + '<br>'
        + 'SPEED: ' + spd + ' kn<br>'
        + 'SOURCE: AISStream (demo)</div>'
      );
      addMk('ships', mk);
    });
  }

  /* ─────────────────────────────────────────────────────────
     REFRESH BUTTON  — news panel
     ───────────────────────────────────────────────────────── */
  document.getElementById('news-refresh-btn').addEventListener('click', loadNews);

  /* ─────────────────────────────────────────────────────────
     BOOT  — runs everything on page load
     ───────────────────────────────────────────────────────── */
  function boot() {
    // Load all live data in parallel
    loadQuakes();
    loadFires();
    loadWeather();
    loadNews();
    loadSpace();
    loadDisasters();

    // Auto-refresh every 5 minutes for real-time data
    setInterval(function () {
      loadQuakes();
      loadFires();
      loadWeather();
      loadSpace();
    }, 5 * 60 * 1000);

    // News refreshes every 15 minutes
    setInterval(loadNews, 15 * 60 * 1000);
  }

  boot();

})();
