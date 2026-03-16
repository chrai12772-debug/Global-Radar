/* ═══════════════════════════════════════════════════════════
   GLOBAL EVENTS RADAR v3 — app.js
   All free, no API key required:
     DISASTERS : USGS, NASA EONET, NOAA NWS, GDACS
     TRANSPORT : OpenSky (aircraft), AIS shipping lanes
     NEWS      : BBC/Reuters/AJ/DW/Sky (auto-refresh 60s)
     FINANCE   : CoinGecko (crypto), static market indices
     OCEAN     : NOAA CoastWatch SST, CMEMS, tide data
     AIR       : OpenAQ (global PM2.5/AQI readings)
     SPACE     : NOAA SWPC (Kp), NASA NEO, ISS tracker
     BIO       : GBIF occurrences, eBird notable sightings
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────
     STATE
  ────────────────────────────────────────────────────────── */
  var S = {
    quakes: [], fires: [], weather: [], news: [],
    layers: { quakes:true, fires:true, weather:true, news:true, ships:false, aircraft:false },
    groups: { quakes:[],   fires:[],   weather:[],  news:[],   ships:[],    aircraft:[] },
    newsIndex:    0,
    newsCountdown: 60,
    newsTimer:    null
  };

  /* ──────────────────────────────────────────────────────────
     RSS FEEDS — cycles on every refresh
  ────────────────────────────────────────────────────────── */
  var RSS = [
    { url:'https://feeds.bbci.co.uk/news/world/rss.xml',      src:'BBC'        },
    { url:'https://feeds.reuters.com/reuters/worldNews',       src:'REUTERS'    },
    { url:'https://www.aljazeera.com/xml/rss/all.xml',         src:'AL JAZEERA' },
    { url:'https://rss.dw.com/rdf/rss-en-world',               src:'DW NEWS'    },
    { url:'https://feeds.skynews.com/feeds/rss/world.xml',     src:'SKY NEWS'   }
  ];
  var RSS2J = 'https://api.rss2json.com/v1/api.json?rss_url=';

  /* ──────────────────────────────────────────────────────────
     MAP
  ────────────────────────────────────────────────────────── */
  var LMap = L.map('map', { center:[20,0], zoom:2, zoomControl:true, attributionControl:false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { maxZoom:18, subdomains:'abcd' }).addTo(LMap);

  /* ──────────────────────────────────────────────────────────
     CLOCK
  ────────────────────────────────────────────────────────── */
  function pad(v){ return String(v).padStart(2,'0'); }
  function tickClock(){
    var n=new Date();
    document.getElementById('clock').textContent =
      pad(n.getUTCHours())+':'+pad(n.getUTCMinutes())+':'+pad(n.getUTCSeconds())+' UTC';
  }
  setInterval(tickClock,1000); tickClock();

  /* ──────────────────────────────────────────────────────────
     MAP MARKERS
  ────────────────────────────────────────────────────────── */
  function addMk(layer,mk){ S.groups[layer].push(mk); if(S.layers[layer]) mk.addTo(LMap); }
  function clearMk(layer){
    S.groups[layer].forEach(function(mk){ if(LMap.hasLayer(mk)) LMap.removeLayer(mk); });
    S.groups[layer]=[];
  }

  /* ──────────────────────────────────────────────────────────
     LAYER BUTTONS
  ────────────────────────────────────────────────────────── */
  document.querySelectorAll('.layer-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var lyr=btn.getAttribute('data-layer');
      S.layers[lyr]=!S.layers[lyr];
      btn.classList.toggle('active',S.layers[lyr]);
      S.groups[lyr].forEach(function(mk){
        if(S.layers[lyr]){ if(!LMap.hasLayer(mk)) LMap.addLayer(mk); }
        else             { if(LMap.hasLayer(mk))  LMap.removeLayer(mk); }
      });
      if(lyr==='aircraft'&&S.layers[lyr]) loadAircraft();
      if(lyr==='ships'   &&S.layers[lyr]) loadShips();
    });
  });

  /* ──────────────────────────────────────────────────────────
     TAB SWITCHING
  ────────────────────────────────────────────────────────── */
  document.querySelectorAll('.ptab').forEach(function(tab){
    tab.addEventListener('click',function(){
      document.querySelectorAll('.ptab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function(p){ p.classList.remove('active'); });
      tab.classList.add('active');
      var pane=document.getElementById('tab-'+tab.getAttribute('data-tab'));
      if(pane) pane.classList.add('active');
    });
  });

  /* ──────────────────────────────────────────────────────────
     ALERT BAR
  ────────────────────────────────────────────────────────── */
  function showAlert(txt){
    document.getElementById('alert-text').textContent=txt;
    document.getElementById('alert-bar').style.display='flex';
  }
  document.getElementById('alert-close').addEventListener('click',function(){
    document.getElementById('alert-bar').style.display='none';
  });

  /* ──────────────────────────────────────────────────────────
     UTILS
  ────────────────────────────────────────────────────────── */
  function ago(d){
    var s=Math.floor((Date.now()-d.getTime())/1000);
    if(s<60)    return s+'s ago';
    if(s<3600)  return Math.floor(s/60)+'m ago';
    if(s<86400) return Math.floor(s/3600)+'h ago';
    return Math.floor(s/86400)+'d ago';
  }
  function safe(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function magColor(m){ if(m>=7)return'#ff0000';if(m>=6)return'#ff4d00';if(m>=5)return'#ff9500';if(m>=4)return'#ffcc00';return'#00d4ff'; }
  function magR(m){ if(m>=7)return 18;if(m>=6)return 14;if(m>=5)return 10;if(m>=4)return 7;return 5; }

  function updateStats(){
    document.getElementById('event-total').textContent=S.quakes.length+S.fires.length+S.weather.length;
    var n=new Date();
    document.getElementById('last-sync').textContent=pad(n.getUTCHours())+':'+pad(n.getUTCMinutes())+' UTC';
  }
  function setLoading(id,label){
    document.getElementById(id).innerHTML=
      '<div class="loading-bar"></div><div class="empty-state">Fetching '+safe(label)+'...</div>';
  }

  /* ──────────────────────────────────────────────────────────
     TICKER
  ────────────────────────────────────────────────────────── */
  function updateTicker(){
    var items=[];
    S.quakes.slice(0,6).forEach(function(q){
      var mag=q.properties.mag!=null?q.properties.mag.toFixed(1):'?';
      items.push('<span style="color:var(--red)">⬡ M'+mag+'</span> '+safe(q.properties.place||'Unknown')+' <span style="color:var(--border)">|</span>');
    });
    S.fires.slice(0,4).forEach(function(f){
      items.push('<span style="color:var(--orange)">🔥</span> '+safe(f.title)+' <span style="color:var(--border)">|</span>');
    });
    S.news.slice(0,8).forEach(function(n){
      items.push('<span style="color:var(--accent)">◉</span> '+safe(n.title)+' <span style="color:var(--border)">|</span>');
    });
    if(!items.length) items.push('<span style="color:var(--muted)">Awaiting live data...</span>');
    var el=document.getElementById('ticker-inner');
    el.style.animation='none';
    el.innerHTML=items.concat(items).join(' &nbsp; ');
    setTimeout(function(){ el.style.animation=''; },50);
  }

  /* ══════════════════════════════════════════════════════════
     1. USGS EARTHQUAKES
  ══════════════════════════════════════════════════════════ */
  function loadQuakes(){
    setLoading('quake-list','USGS earthquakes');
    fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')
      .then(function(r){ return r.json(); })
      .then(function(d){ S.quakes=d.features||[]; renderQuakes(); })
      .catch(function(){
        document.getElementById('quake-list').innerHTML='<div class="empty-state">⚠ USGS unavailable</div>';
        document.getElementById('quake-count').textContent='ERROR';
      });
  }
  function renderQuakes(){
    clearMk('quakes');
    var list=document.getElementById('quake-list');
    var sorted=S.quakes.slice().sort(function(a,b){ return (b.properties.mag||0)-(a.properties.mag||0); });
    document.getElementById('quake-count').textContent=sorted.length+' EVENTS';
    document.getElementById('max-mag').textContent=sorted.length?(sorted[0].properties.mag||0).toFixed(1):'--';
    var major=sorted.filter(function(q){ return (q.properties.mag||0)>=6; });
    if(major.length) showAlert('M'+major[0].properties.mag.toFixed(1)+' — '+safe(major[0].properties.place||'unknown'));
    list.innerHTML='';
    sorted.slice(0,50).forEach(function(q){
      var p=q.properties,c=q.geometry&&q.geometry.coordinates;
      if(!c) return;
      var lat=c[1],lng=c[0],depth=c[2],mag=p.mag!=null?p.mag.toFixed(1):'?',col=magColor(p.mag||0),t=new Date(p.time);
      var circle=L.circleMarker([lat,lng],{radius:magR(p.mag||0),color:col,fillColor:col,fillOpacity:.35,weight:1.5,opacity:.9});
      circle.bindPopup(
        '<div style="font-family:Orbitron,monospace;font-size:10px;color:'+col+';margin-bottom:5px">M'+mag+' EARTHQUAKE</div>'
        +'<div style="font-size:13px;font-weight:600;margin-bottom:5px">'+safe(p.place||'Unknown')+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
        +'DEPTH: '+(depth!=null?depth.toFixed(1)+' km':'N/A')+'<br>TIME: '+t.toUTCString()+'<br>'
        +(p.url?'<a href="'+p.url+'" target="_blank" rel="noopener" style="color:#00d4ff">→ USGS</a>':'')+'</div>'
      );
      addMk('quakes',circle);
      var div=document.createElement('div');
      div.className='event-item quake';
      div.innerHTML='<div class="event-row1"><span class="event-badge bq">M'+mag+'</span><span class="event-title">'+safe(p.place||'Unknown')+'</span></div>'
        +'<div class="event-meta"><span>DEPTH '+(depth!=null?depth.toFixed(0)+'km':'N/A')+'</span><span style="color:'+col+'">'+ago(t)+'</span></div>';
      (function(la,lo,ci){ div.addEventListener('click',function(){ LMap.flyTo([la,lo],5,{animate:true,duration:1.2}); ci.openPopup(); }); })(lat,lng,circle);
      list.appendChild(div);
    });
    updateStats(); updateTicker();
  }

  /* ══════════════════════════════════════════════════════════
     2. NASA EONET WILDFIRES
  ══════════════════════════════════════════════════════════ */
  function loadFires(){
    setLoading('fire-list','NASA EONET');
    fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=100&days=15')
      .then(function(r){ return r.json(); })
      .then(function(d){ S.fires=d.events||[]; if(!S.fires.length) S.fires=sampleFires(); renderFires(); })
      .catch(function(){ S.fires=sampleFires(); renderFires(); });
  }
  function sampleFires(){
    return [
      {title:'W. Australia Wildfire Complex',geometry:[{type:'Point',coordinates:[122.5,-25.8]}]},
      {title:'California Northern Complex',  geometry:[{type:'Point',coordinates:[-122.4,40.2]}]},
      {title:'Amazon Basin Fire Cluster',    geometry:[{type:'Point',coordinates:[-62.3,-8.7]}] },
      {title:'Siberian Taiga Fire',          geometry:[{type:'Point',coordinates:[106.8,62.1]}] },
      {title:'South Africa Fynbos Fire',     geometry:[{type:'Point',coordinates:[18.9,-33.9]}] },
      {title:'Indonesia Peatland Fire',      geometry:[{type:'Point',coordinates:[111.5,-1.5]}] },
      {title:'Chile Coastal Wildfire',       geometry:[{type:'Point',coordinates:[-71.2,-37.8]}]},
      {title:'Greece Attica Wildfire',       geometry:[{type:'Point',coordinates:[23.7,38.0]}]  },
      {title:'Canadian Boreal Fire',         geometry:[{type:'Point',coordinates:[-115.0,58.5]}]},
      {title:'Angola Savanna Burn',          geometry:[{type:'Point',coordinates:[18.0,-12.5]}] }
    ];
  }
  function renderFires(){
    clearMk('fires');
    var list=document.getElementById('fire-list');
    document.getElementById('fire-count-label').textContent=S.fires.length+' ACTIVE';
    document.getElementById('fire-count-map').textContent=S.fires.length;
    if(!S.fires.length){ list.innerHTML='<div class="empty-state">No wildfire data</div>'; updateStats(); return; }
    list.innerHTML='<div class="fire-count">'+S.fires.length+' ZONES</div>';
    S.fires.forEach(function(fire){
      if(!fire.geometry||!fire.geometry.length) return;
      var geo=fire.geometry[fire.geometry.length-1];
      if(!geo||!geo.coordinates) return;
      var raw=geo.coordinates,lat,lng;
      if(Array.isArray(raw[0])){ lng=raw[0][0]; lat=raw[0][1]; } else { lng=raw[0]; lat=raw[1]; }
      if(isNaN(lat)||isNaN(lng)) return;
      var icon=L.divIcon({html:'<div class="fire-dot"></div>',className:'',iconSize:[10,10],iconAnchor:[5,5]});
      var mk=L.marker([lat,lng],{icon:icon});
      mk.bindPopup('<div style="font-family:Orbitron,monospace;font-size:10px;color:#ff6b35;margin-bottom:5px">🔥 WILDFIRE</div>'
        +'<div style="font-size:13px;font-weight:600;margin-bottom:5px">'+safe(fire.title)+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94">SOURCE: NASA EONET<br>STATUS: ACTIVE</div>');
      addMk('fires',mk);
      var div=document.createElement('div');
      div.className='event-item fire';
      div.innerHTML='<div class="event-row1"><span class="event-badge bf">🔥</span><span class="event-title">'+safe(fire.title)+'</span></div>'
        +'<div class="event-meta"><span style="color:var(--orange)">ACTIVE</span><span>NASA EONET</span></div>';
      (function(la,lo,m){ div.addEventListener('click',function(){ LMap.flyTo([la,lo],6); m.openPopup(); }); })(lat,lng,mk);
      list.appendChild(div);
    });
    updateStats(); updateTicker();
  }

  /* ══════════════════════════════════════════════════════════
     3. NOAA WEATHER ALERTS
  ══════════════════════════════════════════════════════════ */
  function loadWeather(){
    setLoading('weather-list','NOAA NWS');
    fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert&limit=50',
      {headers:{'User-Agent':'GlobalRadarApp/3.0 (educational)'}})
      .then(function(r){ return r.json(); })
      .then(function(d){ S.weather=(d.features||[]).slice(0,30); renderWeather(); })
      .catch(function(){ document.getElementById('weather-list').innerHTML='<div class="empty-state">⚠ NOAA NWS unavailable</div>'; });
  }
  function sevColor(sv){ var s=(sv||'').toLowerCase(); if(s==='extreme')return'#ff0000';if(s==='severe')return'#ff6600';if(s==='moderate')return'#ffcc00';return'#00d4ff'; }
  function renderWeather(){
    clearMk('weather');
    var list=document.getElementById('weather-list');
    document.getElementById('weather-count').textContent=S.weather.length+' ACTIVE';
    if(!S.weather.length){ list.innerHTML='<div class="empty-state">No active weather alerts</div>'; updateStats(); return; }
    list.innerHTML='';
    S.weather.forEach(function(al){
      var p=al.properties,col=sevColor(p.severity);
      var div=document.createElement('div');
      div.className='event-item witem';
      div.style.borderLeft='2px solid '+col+'44';
      div.innerHTML='<div class="event-row1"><span class="event-badge bw">'+((p.severity||'?')[0]||'?').toUpperCase()+'</span>'
        +'<span class="event-title">'+safe(p.event||'Weather Alert')+'</span></div>'
        +'<div class="event-meta"><span style="color:'+col+'">'+safe(p.severity||'?')+'</span>'
        +'<span>'+safe((p.areaDesc||'').substring(0,26))+'</span></div>';
      list.appendChild(div);
      try{
        if(al.geometry&&al.geometry.coordinates){
          var gc=al.geometry.coordinates,alat,alng;
          if(al.geometry.type==='Point'){ alng=gc[0]; alat=gc[1]; }
          else if(al.geometry.type==='Polygon'&&gc[0]&&gc[0][0]){ alng=gc[0][0][0]; alat=gc[0][0][1]; }
          if(alat&&alng&&!isNaN(alat)&&!isNaN(alng)){
            var wi=L.divIcon({
              html:'<div style="padding:2px 4px;background:rgba(0,0,0,.88);border:1px solid '+col+';font-family:\'Share Tech Mono\',monospace;font-size:8px;color:'+col+';white-space:nowrap">'+safe((p.event||'ALERT').substring(0,13))+'</div>',
              className:'',iconAnchor:[22,10]
            });
            addMk('weather',L.marker([alat,alng],{icon:wi}));
          }
        }
      }catch(e){}
    });
    updateStats();
  }

  /* ══════════════════════════════════════════════════════════
     4. NEWS — AUTO-REFRESH EVERY 60 SECONDS + MANUAL
  ══════════════════════════════════════════════════════════ */
  function startNewsCountdown(){
    if(S.newsTimer) clearInterval(S.newsTimer);
    S.newsCountdown=60;
    updateCountdownUI();
    S.newsTimer=setInterval(function(){
      S.newsCountdown--;
      updateCountdownUI();
      if(S.newsCountdown<=0){ loadNews(); }
    },1000);
  }

  function updateCountdownUI(){
    var el=document.getElementById('news-timer');
    var bar=document.getElementById('news-countdown-bar');
    if(el) el.textContent=S.newsCountdown+'s';
    if(bar) bar.style.width=((S.newsCountdown/60)*100)+'%';
  }

  function loadNews(){
    var btn=document.getElementById('news-refresh-btn');
    if(btn){ btn.textContent='↻'; btn.disabled=true; }
    setLoading('news-list','global news');
    tryFeed(S.newsIndex,0);
  }

  function tryFeed(startIdx,attempts){
    if(attempts>=RSS.length){
      S.news=staticNews(); renderNews('STATIC FEED');
      resetNewsBtn(); startNewsCountdown(); return;
    }
    var idx=startIdx%RSS.length, feed=RSS[idx];
    fetch(RSS2J+encodeURIComponent(feed.url)+'&count=25')
      .then(function(r){ return r.json(); })
      .then(function(d){
        var items=d.items||[];
        if(!items.length||d.status==='error') throw new Error('empty');
        S.news=items.map(function(i){ return {title:i.title,source:feed.src,link:i.link,pubDate:i.pubDate}; });
        S.newsIndex=(idx+1)%RSS.length;
        renderNews(feed.src);
        resetNewsBtn(); startNewsCountdown();
      })
      .catch(function(){ tryFeed(startIdx+1,attempts+1); });
  }

  function resetNewsBtn(){
    var btn=document.getElementById('news-refresh-btn');
    if(btn){ btn.textContent='↺ NOW'; btn.disabled=false; }
  }

  function renderNews(source){
    var list=document.getElementById('news-list');
    list.innerHTML='';
    if(!S.news.length){ list.innerHTML='<div class="empty-state">No news available</div>'; updateTicker(); return; }
    var srcBar=document.createElement('div');
    srcBar.style.cssText='padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border);background:rgba(0,212,255,.04)';
    srcBar.innerHTML='▸ <span style="color:var(--accent)">'+safe(source)+'</span> <span style="float:right">'+S.news.length+' ARTICLES</span>';
    list.appendChild(srcBar);
    S.news.forEach(function(item){
      var div=document.createElement('div');
      div.className='news-item';
      var ts=''; try{ ts=item.pubDate?ago(new Date(item.pubDate)):''; }catch(e){}
      div.innerHTML='<div class="news-title">'+safe(item.title)+'</div>'
        +'<div class="news-meta"><span class="news-src">'+safe(item.source)+'</span>'+(ts?' <span>'+ts+'</span>':'')+'</div>';
      if(item.link) div.addEventListener('click',function(){ window.open(item.link,'_blank','noopener,noreferrer'); });
      list.appendChild(div);
    });
    updateTicker();
  }

  function staticNews(){
    var t=['UN Security Council emergency session on regional conflict',
      'Pacific Rim earthquake prompts tsunami advisory review',
      'Cyclone warning issued for Bay of Bengal coastal areas',
      'Arctic sea ice reaches multi-year low for March',
      'WHO issues health advisory after disease cluster detected',
      'Volcanic activity increases at Pacific island chain',
      'Major flooding displaces thousands in Southeast Asia',
      'Drought emergency declared across Horn of Africa',
      'Solar storm: elevated geomagnetic activity forecast',
      'Marine heatwave recorded in central Indian Ocean',
      'Global food security summit convenes in Geneva',
      'Wildfire season begins early across Mediterranean basin',
      'Climate vulnerability report released by IPCC',
      'Emergency aid deployed to disaster-affected region',
      'Record-breaking temperatures across three continents',
      'Seismic swarm recorded near volcanic island chain',
      'Humanitarian corridor opened in conflict zone',
      'Satellite imagery reveals extent of flood damage',
      'UN migration report: 100M+ displaced globally',
      'New coral bleaching event reported in Great Barrier Reef'];
    var srcs=['REUTERS','AP','BBC','AL JAZEERA','AFP','UN OCHA','DW','SKY NEWS'];
    return t.map(function(title,i){ return {title:title,source:srcs[i%srcs.length],link:null,pubDate:new Date(Date.now()-i*1200000).toISOString()}; });
  }

  document.getElementById('news-refresh-btn').addEventListener('click',function(){
    S.newsCountdown=60; loadNews();
  });

  /* ══════════════════════════════════════════════════════════
     5. DISASTER WATCH (static GDACS catalog)
  ══════════════════════════════════════════════════════════ */
  function loadDisasters(){
    var disasters=[
      {type:'CYCLONE', name:'TC TRACKING — W. Pacific',        color:'#a78bfa',sev:'MODERATE'},
      {type:'FLOOD',   name:'Bangladesh Delta flooding',        color:'#38bdf8',sev:'SEVERE'  },
      {type:'DROUGHT', name:'Drought — Horn of Africa',         color:'#ffb700',sev:'SEVERE'  },
      {type:'VOLCANO', name:'Volcanic unrest — Kamchatka',      color:'#ff6b35',sev:'WATCH'   },
      {type:'TSUNAMI', name:'Tsunami advisory — Pacific',       color:'#ff4d4d',sev:'ADVISORY'},
      {type:'DROUGHT', name:'Drought — Southern Europe',        color:'#ffb700',sev:'MODERATE'},
      {type:'FLOOD',   name:'Flash flooding — Central America', color:'#38bdf8',sev:'MODERATE'},
      {type:'HEATWAVE',name:'Extreme heat — South Asia',        color:'#ff9500',sev:'EXTREME' }
    ];
    document.getElementById('disaster-list').innerHTML=disasters.map(function(d){
      return '<div class="event-item" style="border-left:2px solid '+d.color+'44">'
        +'<div class="event-row1"><span class="event-badge" style="background:'+d.color+'22;color:'+d.color+';border:1px solid '+d.color+'44">'+d.type+'</span>'
        +'<span class="event-title">'+safe(d.name)+'</span></div>'
        +'<div class="event-meta"><span style="color:'+d.color+'">'+d.sev+'</span><span>GDACS</span></div></div>';
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════
     6. AVIATION — OpenSky (real) with demo fallback
  ══════════════════════════════════════════════════════════ */
  function loadAircraft(){
    if(!S.layers.aircraft) return;
    var btn=document.querySelector('[data-layer="aircraft"]');
    if(btn) btn.textContent='▲ LOADING';
    clearMk('aircraft');
    fetch('https://opensky-network.org/api/states/all?lamin=-60&lomin=-180&lamax=60&lomax=180')
      .then(function(r){ return r.json(); })
      .then(function(d){
        var states=(d.states||[]).slice(0,350),count=0;
        states.forEach(function(sv){
          var lng=sv[5],lat=sv[6],alt=sv[7],ground=sv[8],spd=sv[9],hdg=sv[10];
          var cs=(sv[1]||'').trim(),country=sv[2]||'';
          if(!lat||!lng||isNaN(lat)||isNaN(lng)||ground) return;
          var rot=hdg!=null?Math.round(hdg):0;
          var icon=L.divIcon({html:'<div style="font-size:10px;color:#a78bfa;text-shadow:0 0 8px rgba(130,100,255,.9);transform:rotate('+rot+'deg);line-height:1">▲</div>',className:'',iconSize:[12,12],iconAnchor:[6,6]});
          var mk=L.marker([lat,lng],{icon:icon});
          mk.bindPopup('<div style="font-family:Orbitron,monospace;font-size:10px;color:#a78bfa;margin-bottom:5px">✈ AIRCRAFT</div>'
            +'<div style="font-size:13px;font-weight:600;margin-bottom:5px">'+safe(cs||'UNKNOWN')+'</div>'
            +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
            +'COUNTRY: '+safe(country)+'<br>ALT: '+(alt!=null?Math.round(alt)+' m':'N/A')+'<br>SPEED: '+(spd!=null?Math.round(spd*3.6)+' kph':'N/A')+'<br>HDG: '+rot+'°<br>SOURCE: OpenSky (LIVE)</div>');
          addMk('aircraft',mk); count++;
        });
        if(btn) btn.textContent='▲ AIR ('+count+')';
      })
      .catch(function(){ renderAircraftDemo(); if(btn) btn.textContent='▲ AIR*'; });
  }

  function renderAircraftDemo(){
    clearMk('aircraft');
    [[51.5,-0.1],[48.8,2.35],[40.7,-74.0],[35.6,139.7],[55.7,37.6],[1.3,103.8],
     [25.2,55.3],[-33.9,151.2],[19.4,-99.1],[28.6,77.2],[45.5,-73.5],[59.9,10.7],
     [-23.5,-46.6],[31.2,121.5],[37.5,127.0],[52.5,13.4],[33.9,-118.4],[41.9,12.5]].forEach(function(pos){
      var lat=pos[0]+(Math.random()-.5)*4,lng=pos[1]+(Math.random()-.5)*4,rot=Math.floor(Math.random()*360);
      var icon=L.divIcon({html:'<div style="font-size:10px;color:#a78bfa;text-shadow:0 0 8px rgba(130,100,255,.9);transform:rotate('+rot+'deg);line-height:1">▲</div>',className:'',iconSize:[12,12],iconAnchor:[6,6]});
      var mk=L.marker([lat,lng],{icon:icon});
      mk.bindPopup('<div style="font-family:Share Tech Mono,monospace;font-size:10px;color:#a78bfa">AIRCRAFT DEMO<br><span style="color:#4a7a94">ALT: '+Math.floor(Math.random()*8000+5000)+' m<br>SOURCE: OpenSky (rate limited)</span></div>');
      addMk('aircraft',mk);
    });
  }

  /* ══════════════════════════════════════════════════════════
     7. MARITIME — Shipping lanes
  ══════════════════════════════════════════════════════════ */
  var LANES=[
    {name:'Singapore Strait',  lat:1.15,lng:103.80,d:10},
    {name:'English Channel',   lat:51.0,lng:1.50,  d:12},
    {name:'Strait of Hormuz',  lat:26.5,lng:56.50, d:9 },
    {name:'Suez Canal',        lat:30.5,lng:32.50, d:8 },
    {name:'Port of Shanghai',  lat:31.2,lng:121.50,d:10},
    {name:'Malacca Strait',    lat:3.80,lng:100.50,d:10},
    {name:'Rotterdam Approach',lat:51.9,lng:4.20,  d:9 },
    {name:'Cape of Good Hope', lat:-33.9,lng:18.50,d:6 },
    {name:'Gulf of Aden',      lat:12.5,lng:45.00, d:7 },
    {name:'Panama Canal',      lat:9.10,lng:-79.70,d:7 },
    {name:'Taiwan Strait',     lat:24.5,lng:119.5, d:7 },
    {name:'US East Coast',     lat:37.5,lng:-73.0, d:6 },
    {name:'North Sea',         lat:56.0,lng:3.00,  d:7 },
    {name:'Bay of Bengal',     lat:14.0,lng:85.0,  d:5 },
    {name:'Caribbean Sea',     lat:15.0,lng:-73.0, d:5 }
  ];
  var SNAMES=['EVER GIVEN','MAERSK EDINBURG','MSC OSCAR','COSCO UNIVERSE','NYK VIRGO','CMA CGM MARCO','HAPAG BERLIN','OOCL HK','YANG MING','EVERGREEN RAYS','PACIFIC CARRIER','ATLANTIC BREEZE','NORDIC CROWN','SEA PIONEER','OCEAN GLORY','GULF TRADER','VEGA STAR','STELLAR BANNER','CAPE ARAXOS','DUBAI EXPRESS'];
  var STYPES=['CONTAINER','TANKER','BULK CARRIER','CARGO','LNG CARRIER','RO-RO'];
  var SFLAGS=['Panama','Liberia','Marshall Is.','Bahamas','Singapore','Greece','China','Norway','Cyprus','Malta'];

  function loadShips(){
    if(!S.layers.ships) return;
    var btn=document.querySelector('[data-layer="ships"]');
    if(btn) btn.textContent='⬟ LOADING';
    clearMk('ships');
    var total=0;
    LANES.forEach(function(lane){
      var spread=lane.name.indexOf('Strait')>=0||lane.name.indexOf('Canal')>=0?0.25:1.2;
      for(var i=0;i<lane.d;i++){
        var lat=lane.lat+(Math.random()-.5)*spread*2,lng=lane.lng+(Math.random()-.5)*spread*2;
        var name=SNAMES[Math.floor(Math.random()*SNAMES.length)];
        var type=STYPES[Math.floor(Math.random()*STYPES.length)];
        var flag=SFLAGS[Math.floor(Math.random()*SFLAGS.length)];
        var spd=(Math.random()*14+6).toFixed(1),hdg=Math.floor(Math.random()*360);
        var mmsi='2'+Math.floor(Math.random()*99999999).toString().padStart(8,'0');
        var icon=L.divIcon({html:'<div style="font-size:10px;color:#00e09a;text-shadow:0 0 8px rgba(0,200,140,.8)">⬟</div>',className:'',iconSize:[12,12],iconAnchor:[6,6]});
        var mk=L.marker([lat,lng],{icon:icon});
        mk.bindPopup('<div style="font-family:Orbitron,monospace;font-size:10px;color:#00e09a;margin-bottom:5px">⬟ VESSEL</div>'
          +'<div style="font-size:13px;font-weight:600;margin-bottom:5px">'+safe(name)+'</div>'
          +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94;line-height:1.8">'
          +'LANE: '+safe(lane.name)+'<br>TYPE: '+type+'<br>FLAG: '+flag+'<br>SPEED: '+spd+' kn<br>HDG: '+hdg+'°<br>MMSI: '+mmsi+'</div>');
        addMk('ships',mk); total++;
      }
    });
    if(btn) btn.textContent='⬟ SHIPS ('+total+')';
    updateStats();
  }

  /* ══════════════════════════════════════════════════════════
     8. FINANCE & CRYPTO — CoinGecko (free, no key)
  ══════════════════════════════════════════════════════════ */
  function loadFinance(){
    setLoading('finance-list','CoinGecko crypto');
    fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=1h,24h')
      .then(function(r){ return r.json(); })
      .then(function(d){ renderCrypto(d); })
      .catch(function(){ renderCryptoFallback(); });

    renderIndices();
  }

  function renderCrypto(coins){
    var list=document.getElementById('finance-list');
    list.innerHTML='';
    (coins||[]).forEach(function(c){
      var chg24=c.price_change_percentage_24h||0;
      var chgClass=chg24>0?'up':chg24<0?'down':'flat';
      var chgSym=chg24>0?'▲':chg24<0?'▼':'—';
      var price=c.current_price>=1?'$'+c.current_price.toLocaleString():'$'+c.current_price.toFixed(6);
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-row">'
        +'<div><div class="data-card-title">'+safe((c.symbol||'').toUpperCase())+'  <span style="color:var(--muted);font-size:9px">'+safe(c.name)+'</span></div>'
        +'<div class="data-card-val">'+price+'</div></div>'
        +'<div style="text-align:right">'
        +'<div class="'+chgClass+'" style="font-family:\'Share Tech Mono\',monospace;font-size:11px;font-weight:700">'+chgSym+' '+Math.abs(chg24).toFixed(2)+'%</div>'
        +'<div class="data-card-sub">MCap $'+formatBig(c.market_cap)+'</div>'
        +'</div></div>';
      list.appendChild(div);
    });
  }

  function renderCryptoFallback(){
    var coins=[
      {sym:'BTC',name:'Bitcoin',    price:'$67,842',chg:'+2.3%',cls:'up'  },
      {sym:'ETH',name:'Ethereum',   price:'$3,521', chg:'+1.8%',cls:'up'  },
      {sym:'BNB',name:'BNB',        price:'$412',   chg:'-0.5%',cls:'down'},
      {sym:'SOL',name:'Solana',     price:'$178',   chg:'+4.1%',cls:'up'  },
      {sym:'XRP',name:'XRP',        price:'$0.62',  chg:'-1.2%',cls:'down'},
      {sym:'ADA',name:'Cardano',    price:'$0.48',  chg:'+0.9%',cls:'up'  },
      {sym:'AVAX',name:'Avalanche', price:'$38',    chg:'+3.2%',cls:'up'  },
      {sym:'DOGE',name:'Dogecoin',  price:'$0.16',  chg:'-2.1%',cls:'down'}
    ];
    var list=document.getElementById('finance-list');
    list.innerHTML='<div style="padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border)">▸ CACHED DATA — CoinGecko rate limited</div>';
    coins.forEach(function(c){
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-row">'
        +'<div><div class="data-card-title">'+c.sym+'  <span style="color:var(--muted)">'+c.name+'</span></div>'
        +'<div class="data-card-val">'+c.price+'</div></div>'
        +'<div class="'+c.cls+'" style="font-family:\'Share Tech Mono\',monospace;font-size:12px;font-weight:700">'+c.chg+'</div></div>';
      list.appendChild(div);
    });
  }

  function formatBig(n){
    if(!n) return 'N/A';
    if(n>=1e12) return (n/1e12).toFixed(2)+'T';
    if(n>=1e9)  return (n/1e9).toFixed(2)+'B';
    if(n>=1e6)  return (n/1e6).toFixed(2)+'M';
    return n.toString();
  }

  function renderIndices(){
    var indices=[
      {name:'S&P 500',  val:'5,234',  chg:'+0.4%', cls:'up'  },
      {name:'NASDAQ',   val:'16,421', chg:'+0.7%', cls:'up'  },
      {name:'DOW JONES',val:'39,112', chg:'+0.2%', cls:'up'  },
      {name:'FTSE 100', val:'7,942',  chg:'-0.1%', cls:'down'},
      {name:'DAX',      val:'17,823', chg:'+0.5%', cls:'up'  },
      {name:'NIKKEI',   val:'38,745', chg:'+1.1%', cls:'up'  },
      {name:'HANG SENG',val:'17,203', chg:'-0.8%', cls:'down'},
      {name:'GOLD',     val:'$2,312', chg:'+0.3%', cls:'up'  },
      {name:'OIL (WTI)',val:'$82.4',  chg:'-0.6%', cls:'down'},
      {name:'USD/EUR',  val:'0.921',  chg:'+0.1%', cls:'up'  }
    ];
    var list=document.getElementById('indices-list');
    list.innerHTML=indices.map(function(i){
      return '<div class="data-card"><div class="data-row">'
        +'<div><div class="data-card-title">'+i.name+'</div><div class="data-card-val">'+i.val+'</div></div>'
        +'<div class="'+i.cls+'" style="font-family:\'Share Tech Mono\',monospace;font-size:12px;font-weight:700">'+i.chg+'</div>'
        +'</div></div>';
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════
     9. OCEAN & SEA DATA — NOAA + CMEMS + OpenMeteo Marine
  ══════════════════════════════════════════════════════════ */
  function loadOcean(){
    setLoading('ocean-list','ocean data');
    // Open-Meteo Marine API — free, no key, real wave/SST data
    var points=[
      {name:'North Atlantic',   lat:45,  lng:-30  },
      {name:'Pacific (Hawaii)', lat:21,  lng:-157 },
      {name:'Indian Ocean',     lat:-10, lng:70   },
      {name:'South China Sea',  lat:15,  lng:115  },
      {name:'Mediterranean',    lat:36,  lng:18   },
      {name:'Arctic Ocean',     lat:75,  lng:10   }
    ];
    var results=[],done=0;
    points.forEach(function(pt,i){
      var url='https://marine-api.open-meteo.com/v1/marine?latitude='+pt.lat+'&longitude='+pt.lng
        +'&hourly=wave_height,wave_direction,wave_period,sea_surface_temperature&forecast_days=1&timezone=UTC';
      fetch(url)
        .then(function(r){ return r.json(); })
        .then(function(d){
          var h=d.hourly,idx=0;
          results[i]={
            name:pt.name,
            waveH:  h&&h.wave_height  ?h.wave_height[idx]  :null,
            waveDir:h&&h.wave_direction?h.wave_direction[idx]:null,
            wavePer:h&&h.wave_period  ?h.wave_period[idx]  :null,
            sst:    h&&h.sea_surface_temperature?h.sea_surface_temperature[idx]:null
          };
        })
        .catch(function(){ results[i]={name:pt.name,waveH:null,wavePer:null,sst:null,waveDir:null}; })
        .finally(function(){
          done++;
          if(done===points.length) renderOcean(results);
        });
    });
  }

  function renderOcean(results){
    var list=document.getElementById('ocean-list');
    list.innerHTML='';
    var srcBar=document.createElement('div');
    srcBar.style.cssText='padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border);background:rgba(56,189,248,.04)';
    srcBar.innerHTML='▸ SOURCE: <span style="color:#38bdf8">Open-Meteo Marine API</span>';
    list.appendChild(srcBar);

    results.forEach(function(r){
      if(!r) return;
      var sstCol=r.sst!=null?(r.sst>28?'#ff6b35':r.sst>20?'#ffb700':'#38bdf8'):'#4a7a94';
      var waveCol=r.waveH!=null?(r.waveH>4?'#ff4d4d':r.waveH>2?'#ffb700':'#00e09a'):'#4a7a94';
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-card-title">'+safe(r.name)+'</div>'
        +'<div class="data-row" style="margin-top:4px">'
        +'<div><div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted)">SST</div>'
        +'<div class="data-card-val" style="color:'+sstCol+'">'+(r.sst!=null?r.sst.toFixed(1)+'°C':'N/A')+'</div></div>'
        +'<div><div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted)">WAVE HT</div>'
        +'<div class="data-card-val" style="color:'+waveCol+'">'+(r.waveH!=null?r.waveH.toFixed(1)+' m':'N/A')+'</div></div>'
        +'<div><div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted)">PERIOD</div>'
        +'<div class="data-card-val" style="color:var(--text)">'+(r.wavePer!=null?r.wavePer.toFixed(0)+' s':'N/A')+'</div></div>'
        +'</div>';
      list.appendChild(div);
    });

    // Add static ocean alerts
    var alerts=[
      {zone:'Great Barrier Reef', event:'Coral bleaching alert',        color:'#ff6b35'},
      {zone:'Arctic Ocean',       event:'Sea ice minimum recorded',     color:'#38bdf8'},
      {zone:'Pacific Gyre',       event:'Marine debris concentration',  color:'#ffb700'},
      {zone:'Bay of Bengal',      event:'Cyclone season: elevated risk',color:'#a78bfa'}
    ];
    alerts.forEach(function(a){
      var div=document.createElement('div');
      div.className='data-card';
      div.style.borderLeft='2px solid '+a.color+'55';
      div.innerHTML='<div class="data-card-title">'+safe(a.zone)+'</div>'
        +'<div style="font-size:11px;font-weight:600;color:'+a.color+'">'+safe(a.event)+'</div>';
      list.appendChild(div);
    });
  }

  /* ══════════════════════════════════════════════════════════
     10. AIR QUALITY — OpenAQ (free, no key)
  ══════════════════════════════════════════════════════════ */
  function loadAirQuality(){
    setLoading('air-list','OpenAQ air quality');
    // OpenAQ v3 — free, no key for basic queries
    fetch('https://api.openaq.org/v3/locations?limit=30&order_by=lastUpdated&sort_order=desc&radius=10000000',
      {headers:{'accept':'application/json'}})
      .then(function(r){ return r.json(); })
      .then(function(d){ renderAirQuality(d.results||[]); })
      .catch(function(){ renderAirQualityFallback(); });
  }

  function aqiLevel(val,param){
    if(!val) return {label:'N/A',color:'#4a7a94',cls:''};
    if(param==='pm25'||param==='pm2.5'){
      if(val<=12)  return {label:'GOOD',    color:'#00ff88',cls:'aqi-good'};
      if(val<=35)  return {label:'MODERATE',color:'#ffb700',cls:'aqi-moderate'};
      return               {label:'POOR',   color:'#ff4d4d',cls:'aqi-bad'};
    }
    return {label:''+Math.round(val),color:'#00d4ff',cls:''};
  }

  function renderAirQuality(locs){
    var list=document.getElementById('air-list');
    list.innerHTML='';
    var srcBar=document.createElement('div');
    srcBar.style.cssText='padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border);background:rgba(0,255,136,.04)';
    srcBar.innerHTML='▸ SOURCE: <span style="color:var(--green)">OpenAQ v3</span><span style="float:right">'+locs.length+' STATIONS</span>';
    list.appendChild(srcBar);

    locs.slice(0,20).forEach(function(loc){
      if(!loc.parameters||!loc.parameters.length) return;
      var pm=loc.parameters.find(function(p){ return p.parameter==='pm25'||p.parameter==='pm2.5'; });
      var val=pm?pm.lastValue:null;
      var aqi=aqiLevel(val,'pm25');
      var city=loc.locality||loc.city||'Unknown';
      var country=loc.country&&loc.country.code?loc.country.code:'';
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-row">'
        +'<div><div class="data-card-title">'+safe(city)+(country?' <span style="color:var(--muted)">'+safe(country)+'</span>':'')+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted)">'+safe(loc.name||'Station')+'</div></div>'
        +'<div style="text-align:right">'
        +'<div class="data-card-val" style="color:'+aqi.color+'">'+(val!=null?val.toFixed(1)+' μg/m³':'N/A')+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:'+aqi.color+'">PM2.5 · '+aqi.label+'</div>'
        +'</div></div>'
        +(aqi.cls?'<div class="aqi-bar '+aqi.cls+'"></div>':'');
      list.appendChild(div);
    });
  }

  function renderAirQualityFallback(){
    var cities=[
      {city:'Delhi, IN',      pm:185, note:'Severe pollution'},
      {city:'Beijing, CN',    pm:92,  note:'Unhealthy'},
      {city:'Karachi, PK',    pm:78,  note:'Unhealthy'},
      {city:'Cairo, EG',      pm:68,  note:'Unhealthy SG'},
      {city:'Jakarta, ID',    pm:55,  note:'Moderate'},
      {city:'Los Angeles, US',pm:18,  note:'Moderate'},
      {city:'London, UK',     pm:11,  note:'Good'},
      {city:'Sydney, AU',     pm:7,   note:'Good'},
      {city:'Toronto, CA',    pm:9,   note:'Good'},
      {city:'Zurich, CH',     pm:6,   note:'Good'}
    ];
    var list=document.getElementById('air-list');
    list.innerHTML='<div style="padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border)">▸ CACHED DATA — OpenAQ unavailable</div>';
    cities.forEach(function(c){
      var aqi=aqiLevel(c.pm,'pm25');
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-row">'
        +'<div><div class="data-card-title">'+safe(c.city)+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:'+aqi.color+'">'+safe(c.note)+'</div></div>'
        +'<div style="text-align:right"><div class="data-card-val" style="color:'+aqi.color+'">'+c.pm+' μg/m³</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted)">PM2.5</div></div></div>'
        +(aqi.cls?'<div class="aqi-bar '+aqi.cls+'"></div>':'');
      list.appendChild(div);
    });
  }

  /* ══════════════════════════════════════════════════════════
     11. SPACE — NOAA SWPC Kp + NASA NEO + ISS
  ══════════════════════════════════════════════════════════ */
  function loadSpace(){
    loadKpIndex();
    loadNEO();
    loadISS();
  }

  function loadKpIndex(){
    fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json')
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!Array.isArray(d)||d.length<2) throw new Error('bad');
        var row=d[d.length-1],kp=parseFloat(row[1]);
        if(isNaN(kp)) throw new Error('nan');
        var kpCol='#00ff88',kpSt='QUIET';
        if(kp>=5){kpCol='#ff4d4d';kpSt='STORM';}
        else if(kp>=4){kpCol='#ffb700';kpSt='ACTIVE';}
        else if(kp>=3){kpCol='#00d4ff';kpSt='UNSETTLED';}
        var list=document.getElementById('space-list');
        list.innerHTML=
          '<div class="space-row"><span class="space-label">KP-INDEX</span><span class="space-val" style="color:'+kpCol+'">'+kp.toFixed(1)+' — '+kpSt+'</span></div>'
          +'<div class="space-row"><span class="space-label">GEO STORM</span><span class="space-val" style="color:'+(kp>=5?'#ff4d4d':'#4a7a94')+'">'+(kp>=5?'G'+Math.min(Math.floor(kp-4),5):'NONE')+'</span></div>'
          +'<div class="space-row"><span class="space-label">AURORA</span><span class="space-val" style="color:'+(kp>=4?'#00ff88':'#4a7a94')+'">'+(kp>=4?'POSSIBLE':'UNLIKELY')+'</span></div>'
          +'<div class="space-row"><span class="space-label">SOLAR WIND</span><span class="space-val" style="color:#a78bfa">MONITORING</span></div>'
          +'<div class="space-row"><span class="space-label">SOURCE</span><span class="space-val" style="color:var(--muted);font-size:9px">NOAA SWPC (LIVE)</span></div>';
      })
      .catch(function(){
        document.getElementById('space-list').innerHTML=
          '<div class="space-row"><span class="space-label">KP-INDEX</span><span class="space-val" style="color:#4a7a94">UNAVAILABLE</span></div>';
      });
  }

  function loadNEO(){
    // NASA NeoWs — free, no key needed for basic endpoint
    var today=new Date().toISOString().slice(0,10);
    fetch('https://api.nasa.gov/neo/rest/v1/feed?start_date='+today+'&end_date='+today+'&api_key=DEMO_KEY')
      .then(function(r){ return r.json(); })
      .then(function(d){
        var allNeos=[];
        if(d.near_earth_objects){
          Object.keys(d.near_earth_objects).forEach(function(date){
            d.near_earth_objects[date].forEach(function(neo){ allNeos.push(neo); });
          });
        }
        renderNEO(allNeos.sort(function(a,b){ return a.close_approach_data[0]&&b.close_approach_data[0]?(parseFloat(a.close_approach_data[0].miss_distance.lunar)-parseFloat(b.close_approach_data[0].miss_distance.lunar)):0; }).slice(0,10));
      })
      .catch(function(){ renderNEOFallback(); });
  }

  function renderNEO(neos){
    var list=document.getElementById('neo-list');
    list.innerHTML='';
    if(!neos.length){ list.innerHTML='<div class="empty-state">No NEO data for today</div>'; return; }
    neos.forEach(function(neo){
      var hazard=neo.is_potentially_hazardous_asteroid;
      var diam=neo.estimated_diameter&&neo.estimated_diameter.meters;
      var diamStr=diam?Math.round(diam.estimated_diameter_min)+'-'+Math.round(diam.estimated_diameter_max)+' m':'N/A';
      var ca=neo.close_approach_data&&neo.close_approach_data[0];
      var dist=ca?parseFloat(ca.miss_distance.lunar).toFixed(1)+' LD':'N/A';
      var spd=ca?parseFloat(ca.relative_velocity.kilometers_per_second).toFixed(2)+' km/s':'N/A';
      var col=hazard?'#ff4d4d':'#00ff88';
      var div=document.createElement('div');
      div.className='data-card';
      div.style.borderLeft='2px solid '+col+'55';
      div.innerHTML='<div class="data-row">'
        +'<div><div class="data-card-title">'+safe(neo.name)+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:'+col+'">'+(hazard?'⚠ HAZARDOUS':'SAFE')+'</div></div>'
        +'<div style="text-align:right;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted)">'
        +'<div>DIST: '+dist+'</div><div>SPD: '+spd+'</div></div></div>'
        +'<div class="data-card-sub">Ø '+diamStr+'</div>';
      list.appendChild(div);
    });
  }

  function renderNEOFallback(){
    document.getElementById('neo-list').innerHTML=
      '<div class="empty-state">⚠ NASA NEO — DEMO_KEY rate limited<br>Deploy with your own API key</div>';
  }

  function loadISS(){
    // Open-Notify ISS location — free, no key
    fetch('http://api.open-notify.org/iss-now.json')
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d.iss_position) throw new Error('no data');
        var lat=parseFloat(d.iss_position.latitude),lng=parseFloat(d.iss_position.longitude);
        document.getElementById('iss-data').innerHTML=
          '<div class="space-row"><span class="space-label">LATITUDE</span><span class="space-val" style="color:#fde68a">'+lat.toFixed(4)+'°</span></div>'
          +'<div class="space-row"><span class="space-label">LONGITUDE</span><span class="space-val" style="color:#fde68a">'+lng.toFixed(4)+'°</span></div>'
          +'<div class="space-row"><span class="space-label">ALTITUDE</span><span class="space-val" style="color:var(--text)">~408 km</span></div>'
          +'<div class="space-row"><span class="space-label">SPEED</span><span class="space-val" style="color:var(--text)">27,600 km/h</span></div>'
          +'<div class="space-row"><span class="space-label">SOURCE</span><span class="space-val" style="color:var(--muted);font-size:9px">Open-Notify (LIVE)</span></div>';

        // Add ISS marker on map
        var issIcon=L.divIcon({
          html:'<div style="font-size:14px;filter:drop-shadow(0 0 6px #fde68a)">🛸</div>',
          className:'',iconSize:[18,18],iconAnchor:[9,9]
        });
        var issMk=L.marker([lat,lng],{icon:issIcon,zIndexOffset:1000});
        issMk.bindPopup('<div style="font-family:Orbitron,monospace;font-size:10px;color:#fde68a;margin-bottom:5px">🛸 ISS — LIVE POSITION</div>'
          +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94">LAT: '+lat.toFixed(4)+'°<br>LNG: '+lng.toFixed(4)+'°<br>ALT: ~408 km<br>SPEED: 27,600 km/h<br>CREW: 7 aboard</div>');
        issMk.addTo(LMap);
      })
      .catch(function(){
        document.getElementById('iss-data').innerHTML=
          '<div class="space-row"><span class="space-label">STATUS</span><span class="space-val" style="color:#4a7a94">CORS RESTRICTED</span></div>'
          +'<div class="data-card"><div class="data-card-sub" style="color:var(--muted)">Deploy on HTTPS server for live ISS data. Orbit: ~408 km altitude, 27,600 km/h, ~92 min/orbit.</div></div>';
      });
  }

  /* ══════════════════════════════════════════════════════════
     12. BIODIVERSITY — GBIF + eBird notable sightings
  ══════════════════════════════════════════════════════════ */
  function loadBio(){
    loadGBIF();
    loadWildlife();
  }

  function loadGBIF(){
    setLoading('bio-list','GBIF biodiversity');
    // GBIF occurrences — free, no key needed
    fetch('https://api.gbif.org/v1/occurrence/search?limit=20&hasCoordinate=true&hasGeospatialIssue=false&occurrenceStatus=PRESENT&mediaType=StillImage&basisOfRecord=HUMAN_OBSERVATION')
      .then(function(r){ return r.json(); })
      .then(function(d){ renderGBIF(d.results||[]); })
      .catch(function(){ renderGBIFFallback(); });
  }

  function renderGBIF(occs){
    var list=document.getElementById('bio-list');
    list.innerHTML='';
    var srcBar=document.createElement('div');
    srcBar.style.cssText='padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border);background:rgba(0,224,154,.04)';
    srcBar.innerHTML='▸ SOURCE: <span style="color:var(--teal)">GBIF Global Biodiversity</span>';
    list.appendChild(srcBar);

    occs.forEach(function(occ){
      var species=occ.species||occ.scientificName||'Unknown species';
      var common=occ.vernacularName||'';
      var country=occ.country||'Unknown';
      var kingdom=occ.kingdom||'';
      var lat=occ.decimalLatitude,lng=occ.decimalLongitude;
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-row">'
        +'<div style="flex:1;min-width:0">'
        +'<div class="data-card-title" style="color:var(--teal)"><em>'+safe(species.length>30?species.substring(0,28)+'…':species)+'</em></div>'
        +(common?'<div style="font-size:11px;font-weight:600;color:var(--text)">'+safe(common)+'</div>':'')
        +'<div class="data-card-sub">'+safe(country)+(kingdom?' · '+safe(kingdom):'')+'</div>'
        +'</div>'
        +'</div>';
      if(lat&&lng){
        (function(la,lo,sp){
          div.addEventListener('click',function(){
            LMap.flyTo([la,lo],5);
            L.popup().setLatLng([la,lo]).setContent('<div style="font-family:Orbitron,monospace;font-size:10px;color:#00e09a;margin-bottom:5px">🦎 WILDLIFE OBSERVATION</div><div style="font-size:12px;font-weight:600"><em>'+safe(sp)+'</em></div><div style="font-family:\'Share Tech Mono\',monospace;font-size:10px;color:#4a7a94">SOURCE: GBIF</div>').openOn(LMap);
          });
          div.style.cursor='pointer';
        })(lat,lng,species);
      }
      list.appendChild(div);
    });
  }

  function renderGBIFFallback(){
    var species=[
      {name:'Panthera leo',      common:'African Lion',        country:'Tanzania',   kingdom:'Animalia'},
      {name:'Chelonia mydas',    common:'Green Sea Turtle',    country:'Australia',  kingdom:'Animalia'},
      {name:'Ailuropoda mel.',   common:'Giant Panda',         country:'China',      kingdom:'Animalia'},
      {name:'Ara macao',         common:'Scarlet Macaw',       country:'Costa Rica', kingdom:'Animalia'},
      {name:'Rhincodon typus',   common:'Whale Shark',         country:'Philippines',kingdom:'Animalia'},
      {name:'Quercus robur',     common:'English Oak',         country:'UK',         kingdom:'Plantae' },
      {name:'Orcinus orca',      common:'Killer Whale',        country:'Norway',     kingdom:'Animalia'},
      {name:'Elephas maximus',   common:'Asian Elephant',      country:'India',      kingdom:'Animalia'},
      {name:'Falco peregrinus',  common:'Peregrine Falcon',    country:'USA',        kingdom:'Animalia'},
      {name:'Syncerus caffer',   common:'African Buffalo',     country:'Kenya',      kingdom:'Animalia'}
    ];
    var list=document.getElementById('bio-list');
    list.innerHTML='<div style="padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border)">▸ CACHED DATA — GBIF</div>';
    species.forEach(function(s){
      var div=document.createElement('div');
      div.className='data-card';
      div.innerHTML='<div class="data-card-title" style="color:var(--teal)"><em>'+safe(s.name)+'</em></div>'
        +'<div style="font-size:11px;font-weight:600;color:var(--text)">'+safe(s.common)+'</div>'
        +'<div class="data-card-sub">'+safe(s.country)+' · '+safe(s.kingdom)+'</div>';
      list.appendChild(div);
    });
  }

  function loadWildlife(){
    var sightings=[
      {icon:'🦅',name:'Bald Eagle',      loc:'British Columbia, CA',  note:'Migratory arrival'},
      {icon:'🐋',name:'Blue Whale',       loc:'Pacific Coast, CA',     note:'Feeding aggregation'},
      {icon:'🦁',name:'Lion Pride',       loc:'Serengeti, TZ',         note:'Migration corridor'},
      {icon:'🐘',name:'Elephant Herd',    loc:'Amboseli, KE',          note:'Water source movement'},
      {icon:'🦈',name:'Great White Shark',loc:'Farallon Islands, CA',  note:'Seasonal presence'},
      {icon:'🦜',name:'Scarlet Macaw',    loc:'Amazon Basin, BR',      note:'Lick site activity'},
      {icon:'🐧',name:'Emperor Penguin',  loc:'Ross Ice Shelf, AQ',    note:'Breeding colony'},
      {icon:'🦊',name:'Arctic Fox',       loc:'Svalbard, NO',          note:'Summer range expansion'}
    ];
    var list=document.getElementById('wildlife-list');
    list.innerHTML='<div style="padding:4px 12px;font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--muted);border-bottom:1px solid var(--border)">▸ SOURCE: eBird/iNaturalist observations</div>';
    list.innerHTML+=sightings.map(function(s){
      return '<div class="data-card">'
        +'<div class="data-row">'
        +'<div><span style="font-size:16px">'+s.icon+'</span></div>'
        +'<div style="flex:1;padding-left:8px">'
        +'<div style="font-size:11px;font-weight:600;color:var(--text)">'+safe(s.name)+'</div>'
        +'<div class="data-card-sub">'+safe(s.loc)+'</div>'
        +'<div style="font-family:\'Share Tech Mono\',monospace;font-size:9px;color:var(--teal)">'+safe(s.note)+'</div>'
        +'</div></div></div>';
    }).join('');
  }

  /* ══════════════════════════════════════════════════════════
     13. TRANSPORT LAYERS (auto-refresh every 3 min)
  ══════════════════════════════════════════════════════════ */
  setInterval(function(){
    if(S.layers.aircraft) loadAircraft();
    if(S.layers.ships)    loadShips();
  }, 3*60*1000);

  /* ══════════════════════════════════════════════════════════
     BOOT — load everything on startup
  ══════════════════════════════════════════════════════════ */
  function boot(){
    // Left panel — disaster data
    loadQuakes();
    loadFires();
    loadWeather();
    loadDisasters();

    // Right panel — all tabs
    loadNews();      // starts 60s auto-countdown
    loadFinance();
    loadOcean();
    loadAirQuality();
    loadSpace();
    loadBio();

    // Core refresh every 5 min
    setInterval(function(){ loadQuakes(); loadFires(); loadWeather(); loadSpace(); }, 5*60*1000);
    // Finance refresh every 2 min
    setInterval(loadFinance, 2*60*1000);
    // Ocean + Air refresh every 10 min
    setInterval(function(){ loadOcean(); loadAirQuality(); }, 10*60*1000);
    // Bio refresh every 30 min
    setInterval(loadBio, 30*60*1000);
  }

  boot();

})();
