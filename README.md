# 🌍 Global Events Radar

> Real-time planet monitoring dashboard — tracking earthquakes, wildfires, weather alerts, global news, aviation, and maritime traffic using **100% free open APIs** with no API key required.

![Global Radar](https://img.shields.io/badge/status-live-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![APIs](https://img.shields.io/badge/APIs-free%20%26%20open-orange)

---

## 🚀 Live Demo

Deploy your own → [vercel.com](https://vercel.com)

---

## 📡 Live Data Sources

| Layer | Source | API Endpoint | Key Required |
|-------|--------|-------------|--------------|
| ⬡ Earthquakes | USGS | `earthquake.usgs.gov` | ❌ None |
| 🔥 Wildfires | NASA EONET | `eonet.gsfc.nasa.gov` | ❌ None |
| ⛈ Weather Alerts | NOAA / NWS | `api.weather.gov` | ❌ None |
| ☀️ Space Weather | NOAA SWPC | `services.swpc.noaa.gov` | ❌ None |
| 📰 Global News | BBC RSS | `api.rss2json.com` | ❌ None |
| ✈️ Aviation | OpenSky Network | `opensky-network.org` | ❌ None |
| 🚢 Maritime | AISStream | `aisstream.io` | ❌ None |
| 🗺️ Map Tiles | CartoDB Dark | via Leaflet.js | ❌ None |

---

## ✨ Features

- 🗺️ **Interactive dark world map** powered by Leaflet.js
- ⬡ **Live earthquake markers** — sized and colored by magnitude, click to zoom
- 🔥 **Active wildfire locations** from NASA EONET with animated pulsing dots
- ⛈ **NOAA weather alerts** with severity color coding (Extreme / Severe / Moderate)
- ☀️ **Geomagnetic Kp-index** from NOAA SWPC with aurora forecast
- 📰 **BBC World News live feed** with fallback to curated global headlines
- ✈️ **Aviation layer** — toggle aircraft positions on the map
- 🚢 **Maritime layer** — toggle vessel positions on the map
- 📡 **Auto-refresh** every 5 minutes for all data sources
- 🔔 **Major quake alert bar** — auto-appears for any M6.0+ earthquake
- 📺 **Live scrolling ticker** at the bottom of the map
- 📱 **Responsive design** — panels hide on smaller screens

---

## 📁 Project Structure

```
global-radar/
├── public/
│   ├── index.html       ← Main HTML shell
│   ├── style.css        ← All styles and animations
│   └── app.js           ← All data fetching and map logic
├── vercel.json          ← Vercel deployment configuration
├── package.json         ← Project metadata
├── .gitignore           ← Files to ignore in git
└── README.md            ← This file
```

---

## 🛠️ Run Locally

You don't need Node.js installed. Just open `public/index.html` directly in your browser — it works as a plain static site.

**Or run with a local server:**
```bash
npx serve public
# Then open http://localhost:3000
```

---

## 🌐 Deploy to Vercel (Free)

### Option 1 — Via GitHub (Recommended)

**1. Push to GitHub**
```bash
cd global-radar
git init
git add .
git commit -m "Initial commit: Global Events Radar"
git remote add origin https://github.com/YOUR_USERNAME/global-radar.git
git push -u origin main
```

**2. Deploy on Vercel**
1. Go to [vercel.com](https://vercel.com) and sign up free
2. Click **Add New Project**
3. Click **Import** next to your `global-radar` repo
4. Click **Deploy**
5. ✅ Your app is live at `global-radar.vercel.app` in ~30 seconds

### Option 2 — Vercel CLI

```bash
npm install -g vercel
cd global-radar
vercel
# Follow the prompts — done!
```

---

## ⚙️ Configuration Files

### `vercel.json`
```json
{
  "version": 2,
  "outputDirectory": "public",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### `package.json`
```json
{
  "name": "global-events-radar",
  "version": "1.0.0",
  "scripts": {
    "start": "npx serve public",
    "dev": "npx serve public"
  }
}
```

### `.gitignore`
```
node_modules/
.DS_Store
.vercel
*.log
```

---

## 🗂️ How It Works

```
Browser loads index.html
    ↓
Leaflet.js loads (map library)
    ↓
style.css loads (all visual styles)
    ↓
app.js runs boot() function
    ↓
6 API calls fire in parallel:
    ├── USGS     → earthquake markers on map + left panel list
    ├── NASA     → wildfire markers on map + left panel list
    ├── NOAA NWS → weather alerts in right panel
    ├── NOAA SWPC→ Kp-index in space weather box
    ├── BBC RSS  → news headlines in right panel
    └── Static   → disaster watch catalog
    ↓
Auto-refresh every 5 minutes
```

---

## 🔧 Customisation Tips

| What to change | Where |
|---------------|-------|
| Map starting position | `app.js` → `L.map('map', { center: [20, 0], zoom: 2 })` |
| Earthquake minimum magnitude | Change `2.5_day` in the USGS URL to `4.5_day` |
| Refresh interval | `app.js` → bottom `setInterval` (currently `5 * 60 * 1000` ms) |
| Colour theme | `style.css` → `:root` CSS variables at the top |
| Add more news sources | `app.js` → `loadNews()` → swap the BBC RSS URL |

---

## 📊 Free API Rate Limits

| API | Rate Limit |
|-----|-----------|
| USGS Earthquakes | Unlimited |
| NASA EONET | Unlimited |
| NOAA NWS | Unlimited |
| NOAA SWPC | Unlimited |
| rss2json (BBC proxy) | 10,000 requests/month free |

---

## 🐛 Troubleshooting

**Map not loading?**
- Check your internet connection — map tiles require network access
- Make sure `leaflet.js` loads in `<head>` before `app.js`

**No earthquake data?**
- USGS API may be temporarily down — try refreshing in a few minutes

**News not loading?**
- rss2json free tier has a monthly limit — app falls back to static headlines automatically

**Deployed on Vercel but blank page?**
- Make sure `outputDirectory` in `vercel.json` is set to `"public"`

---

## 📜 License

MIT — free to use, modify, and deploy for any purpose.

---

## 🙏 Credits

- [USGS Earthquake Hazards Program](https://earthquake.usgs.gov)
- [NASA Earth Observatory Natural Events](https://eonet.gsfc.nasa.gov)
- [NOAA National Weather Service](https://www.weather.gov)
- [NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov)
- [Leaflet.js](https://leafletjs.com) — open-source map library
- [CartoDB](https://carto.com) — dark map tiles
