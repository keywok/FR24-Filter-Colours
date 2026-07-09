(function () {
  'use strict';

  console.log('[FR24FC] injected.js loaded');

  // --- Config (written by content.js via dataset) ---
  // Returns filterId → hex colour map for all currently assigned filters

  function getFilterColorMap() {
    try {
      const groups      = JSON.parse(document.documentElement.dataset.fr24groups      || '[]');
      const assignments = JSON.parse(document.documentElement.dataset.fr24assignments || '{}');
      const groupMeta   = Object.fromEntries(groups.map(g => [g.id, { color: g.color, name: g.name }]));
      const result = {};
      for (const [filterId, groupId] of Object.entries(assignments)) {
        if (groupMeta[groupId]) result[filterId] = groupMeta[groupId];
      }
      return result;
    } catch (e) { return {}; }
  }

  // --- Filter loading (read once from page's server-rendered state) ---

  let allFilters = null; // [{id, conditions}]

  function loadFilters() {
    if (allFilters) return;
    try {
      const data = JSON.parse(document.querySelector('#app').dataset.page);
      allFilters = data.props.dispatcher.filters.filters.map(f => ({
        id:         f.id,
        enabled:    f.enabled,
        conditions: f.conditions,
      }));
      console.log('[FR24FC] filters loaded:', allFilters.length);
    } catch (e) {
      console.warn('[FR24FC] filter load failed:', e);
    }
  }

  // --- Filter matching ---

  function matchesCond(ac, c) {
    switch (c.type) {
      case 'Registration': return ac.reg  === c.value;
      case 'Aircraft':     return ac.type === c.value; // ponytail: null icao → always false for this condition
      case 'Altitude':     return ac.alt  >= c.value[0] && ac.alt <= c.value[1];
      case 'Airport':      return (c.direction === 'in' ? ac.dest : ac.origin) === c.value;
      case 'Airline':
        // ponytail: matched by callsign prefix — misses codeshares with non-standard callsigns
        return !!(ac.callsign?.startsWith(c.value));
      default: return false;
    }
  }

  // Altitude conditions AND'd with everything else; all non-Altitude conditions OR'd
  // ponytail: inferred from FR24 behaviour — altitude is a modifier, everything else selects aircraft
  function matchesFilter(ac, conditions) {
    const altConds   = conditions.filter(c => c.type === 'Altitude');
    const otherConds = conditions.filter(c => c.type !== 'Altitude');
    const altPass   = altConds.length   === 0 || altConds.some(c  => matchesCond(ac, c));
    const otherPass = otherConds.length === 0 || otherConds.some(c => matchesCond(ac, c));
    return altPass && otherPass;
  }

  // --- Aircraft data: id → { lat, lng, filterId } ---
  // Colour is resolved at render time from the current config so colour changes
  // don't require re-running the full match loop

  const acData = new Map();

  function isEnabled() {
    return document.documentElement.dataset.fr24enabled === '1';
  }

  function clearAll() {
    for (const el of markers.values()) el.remove();
    markers.clear();
    acData.clear();
    container?.querySelectorAll('[data-ap]').forEach(el => el.remove());
  }

  function processAircraftMap(aircraftMap) {
    if (!isEnabled()) return;
    loadFilters();
    if (!allFilters) return;

    const filterColorMap   = getFilterColorMap();
    const assignedFilters  = allFilters
      .filter(f => f.enabled && filterColorMap[f.id])
      .sort((a, b) => {
        const aReg = a.conditions.some(c => c.type === 'Registration');
        const bReg = b.conditions.some(c => c.type === 'Registration');
        return (aReg ? 1 : 0) - (bReg ? 1 : 0);
      });

    acData.clear();
    for (const [id, a] of Object.entries(aircraftMap)) {
      const ac = {
        lat:      a.latitude,
        lng:      a.longitude,
        alt:      a.altitude,
        type:     a.icao,
        reg:      a.registration,
        origin:   a.from,
        dest:     a.to,
        callsign: a.callsign,
      };
      for (const f of assignedFilters) {
        if (matchesFilter(ac, f.conditions)) {
          acData.set(id, { lat: ac.lat, lng: ac.lng, filterId: f.id, alt: ac.alt });
          break; // first matched filter wins
        }
      }
    }

    console.log(`[FR24FC] ${acData.size}/${Object.keys(aircraftMap).length} matched`);
    scheduleRedraw();
  }

  // --- Pinia store watch ---

  let aircraftStore    = null;
  let dispatcherStore  = null;

  function updateAirportCodesFromAllFilters() {
    if (!allFilters) return;
    const codes = [...new Set(
      allFilters.filter(f => f.enabled)
                .flatMap(f => f.conditions.filter(c => c.type === 'Airport').map(c => c.value))
    )];
    document.documentElement.dataset.fr24airports = JSON.stringify(codes);
  }

  function updateFiltersFromStore(dispatcher) {
    const raw = dispatcher?.filters?.filters;
    if (!raw) return;
    allFilters = raw.map(f => ({ id: String(f.id), enabled: f.enabled, conditions: f.conditions }));
    updateAirportCodesFromAllFilters();
    if (aircraftStore) processAircraftMap(aircraftStore.$state.aircraftMap);
  }

  const dispatcherTimer = setInterval(() => {
    const app   = document.querySelector('#app')?.__vue_app__;
    const pinia = app?.config?.globalProperties?.$pinia;
    const dispatcher  = pinia?._s?.get('dispatcher');
    if (!dispatcher) return;
    clearInterval(dispatcherTimer);
    dispatcherStore = dispatcher;
    console.log('[FR24FC] dispatcher store found');
    updateFiltersFromStore(dispatcher.$state.dispatcher);

    // Intercept fetch to catch filter save/delete API calls
    const _origFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await _origFetch.apply(this, args);
      const url    = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
      const method = (args[1]?.method || 'GET').toUpperCase();
      if (method === 'GET' || !url.includes('filter')) return response;

      console.log('[FR24FC] filter API call:', method, url);

      if (method === 'DELETE') {
        const id = url.match(/\/(\d+)\/?$/)?.[1];
        if (id && allFilters) {
          allFilters = allFilters.filter(f => f.id !== id);
          updateAirportCodesFromAllFilters();
          if (aircraftStore) processAircraftMap(aircraftStore.$state.aircraftMap);
          console.log('[FR24FC] filter deleted:', id);
        }
      } else {
        response.clone().json().then(({ data }) => {
          const raw = data?.filters;
          if (!raw) return;
          allFilters = raw.map(f => ({ id: String(f.id), enabled: f.enabled, conditions: f.conditions }));
          updateAirportCodesFromAllFilters();
          if (aircraftStore) processAircraftMap(aircraftStore.$state.aircraftMap);
          console.log('[FR24FC] filters updated from API:', allFilters.length);
        }).catch(e => console.warn('[FR24FC] response parse error:', e));
      }
      return response;
    };
  }, 200);

  let processTimer = null;
  function scheduleProcess(aircraftMap) {
    clearTimeout(processTimer);
    processTimer = setTimeout(() => processAircraftMap(aircraftMap), 300);
  }

  const storeTimer = setInterval(() => {
    const app   = document.querySelector('#app')?.__vue_app__;
    const pinia = app?.config?.globalProperties?.$pinia;
    const store = pinia?._s?.get('aircraft');
    if (!store) return;
    clearInterval(storeTimer);
    aircraftStore = store;
    console.log('[FR24FC] aircraft store found, subscribing');
    processAircraftMap(store.$state.aircraftMap);
    store.$subscribe((_, state) => scheduleProcess(state.aircraftMap));
  }, 200);

  // --- Map overlay ---

  let mapObj    = null;
  let container = null;
  const markers = new Map(); // id → div element

  function initOverlay(map) {
    if (mapObj) return;
    mapObj    = map;
    container = document.createElement('div');
    container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    map.getDiv().appendChild(container);
    map.addListener('bounds_changed',     scheduleRedraw);
    map.addListener('projection_changed', scheduleRedraw);
    console.log('[FR24FC] overlay attached to map');
  }

  let rafId = null;
  function scheduleRedraw() {
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = null; redraw(); });
  }

  // proj.fromLatLngToPoint returns world coords in [0,256) tile space.
  // When the viewport straddles the date line sw.x > ne.x, so a point
  // east of 180° gets a negative pixel offset. Shift by one world-width to fix.
  function toPixel(proj, sw, ne, scale, lat, lng) {
    const wp        = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
    const worldW    = 256 * scale;
    let x = (wp.x - sw.x) * scale;
    const y = (wp.y - ne.y) * scale;
    if (x < -worldW / 2) x += worldW;
    else if (x > worldW * 1.5) x -= worldW;
    return { x, y };
  }

  function redraw() {
    if (!mapObj || !container) return;
    const proj   = mapObj.getProjection();
    const bounds = mapObj.getBounds();
    if (!proj || !bounds) return;

    const filterColorMap = getFilterColorMap();
    const ne    = proj.fromLatLngToPoint(bounds.getNorthEast());
    const sw    = proj.fromLatLngToPoint(bounds.getSouthWest());
    const scale = Math.pow(2, mapObj.getZoom());

    const seen = new Set();
    for (const [id, { lat, lng, filterId, alt }] of acData) {
      const meta = filterColorMap[filterId];
      if (!meta) continue; // filter unassigned — skip
      const { color, name } = meta;

      seen.add(id);
      const { x, y } = toPixel(proj, sw, ne, scale, lat, lng);

      if (!markers.has(id)) {
        const el = document.createElement('div');
        el.style.cssText = 'position:absolute;width:20px;height:20px;border-radius:50%;transform:translate(-50%,-50%);';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'position:absolute;right:calc(100% + 4px);top:50%;transform:translateY(-50%);white-space:pre;text-align:center;font:bold 11px/1.4 sans-serif;color:#fff;background:rgba(25,30,40,0.85);padding:2px 5px;border-radius:3px;';
        el.appendChild(lbl);
        container.appendChild(el);
        markers.set(id, el);
      }
      const el    = markers.get(id);
      el.style.background = color;
      el.style.opacity    = '0.8';
      el.style.left       = x + 'px';
      el.style.top        = y + 'px';
      el.firstChild.textContent = (name || '') + '\n' + (alt ? alt.toLocaleString() + 'ft' : '');
    }

    for (const [id, el] of markers) {
      if (!seen.has(id)) { el.remove(); markers.delete(id); }
    }

    drawAirportDots();
    drawClaimedAirports();
  }

  // --- Google Maps hook ---

  function hookMaps() {
    const Orig = google.maps.Map;
    function PatchedMap(el, opts) {
      const m = new Orig(el, opts);
      initOverlay(m);
      google.maps.Map = Orig;
      return m;
    }
    PatchedMap.prototype = Orig.prototype;
    google.maps.Map = PatchedMap;

    const origSetMap = google.maps.OverlayView.prototype.setMap;
    google.maps.OverlayView.prototype.setMap = function (map) {
      if (map) initOverlay(map);
      return origSetMap.apply(this, arguments);
    };
  }

  const hookTimer = setInterval(() => {
    if (!window.google?.maps?.Map) return;
    clearInterval(hookTimer);
    hookMaps();
  }, 50);

  // --- Airport hunt dots ---

  function getFilterAirportCodes() {
    try { return new Set(JSON.parse(document.documentElement.dataset.fr24airports || '[]')); }
    catch (e) { return new Set(); }
  }

  function getCountryColorMap() {
    try {
      const groups = JSON.parse(document.documentElement.dataset.fr24groups || '[]');
      return Object.fromEntries(groups.map(g => [g.name, g.color]));
    } catch (e) { return {}; }
  }

  const airportDots  = new Map(); // iata → {lat, lng, country}
  const claimedDots  = new Map(); // iata → {lat, lng}
  let   apStoreRef   = null;

  function getClaimedCodes() {
    try { return new Set(JSON.parse(document.documentElement.dataset.fr24claimed || '[]')); }
    catch (e) { return new Set(); }
  }

  function processAirports(data) {
    const filterCodes  = getFilterAirportCodes();
    const claimedCodes = getClaimedCodes();
    const entries = Array.isArray(data) ? data : Object.values(data);
    for (const ap of entries) {
      const code = ap.iata || ap.icao || ap.code || ap.id;
      const lat  = ap.lat ?? ap.latitude;
      const lng  = ap.lon ?? ap.lng ?? ap.longitude;
      if (!code || lat == null || lng == null) continue;
      if (filterCodes.has(code))  airportDots.set(code, { lat, lng, country: ap.country });
      else                        airportDots.delete(code);
      if (claimedCodes.has(code)) claimedDots.set(code, { lat, lng });
    }
    scheduleRedraw();
  }

  function updateClaimedLocations() {
    claimedDots.clear();
    if (!apStoreRef) return;
    const codes = getClaimedCodes();
    if (!codes.size) { scheduleRedraw(); return; }
    const state = apStoreRef.$state;
    const data  = state.airportMap ?? state.airports ?? state.airportsMap;
    if (!data) return;
    const entries = Array.isArray(data) ? data : Object.values(data);
    for (const ap of entries) {
      const code = ap.iata || ap.icao || ap.code || ap.id;
      if (!codes.has(code)) continue;
      const lat = ap.lat ?? ap.latitude;
      const lng = ap.lon ?? ap.lng ?? ap.longitude;
      if (lat != null && lng != null) claimedDots.set(code, { lat, lng });
    }
    scheduleRedraw();
  }

  const apStoreTimer = setInterval(() => {
    const app   = document.querySelector('#app')?.__vue_app__;
    const pinia = app?.config?.globalProperties?.$pinia;
    if (!pinia) return;
    for (const [name, store] of pinia._s) {
      const s = store.$state;
      if (!s) continue;
      const candidate = s.airportMap ?? s.airports ?? s.airportsMap;
      if (!candidate) continue;
      clearInterval(apStoreTimer);
      apStoreRef = store;
      console.log('[FR24FC] airport store found:', name);
      processAirports(candidate);
      updateClaimedLocations();
      store.$subscribe((_, state) => {
        const d = state.airportMap ?? state.airports ?? state.airportsMap;
        if (d) processAirports(d);
      });
      return;
    }
  }, 500);

  function drawAirportDots() {
    if (!mapObj) return;
    const proj   = mapObj.getProjection();
    const bounds = mapObj.getBounds();
    if (!proj || !bounds) return;
    const ne    = proj.fromLatLngToPoint(bounds.getNorthEast());
    const sw    = proj.fromLatLngToPoint(bounds.getSouthWest());
    const scale = Math.pow(2, mapObj.getZoom());

    const codes          = getFilterAirportCodes();
    const countryColors  = getCountryColorMap();
    for (const [code, { lat, lng, country }] of airportDots) {
      if (!codes.has(code)) continue;
      const { x, y } = toPixel(proj, sw, ne, scale, lat, lng);
      if (!container.querySelector(`[data-ap="${code}"]`)) {
        const el = document.createElement('div');
        el.dataset.ap = code;
        el.style.cssText = 'position:absolute;width:10px;height:10px;border-radius:50%;border:2px solid #fff;transform:translate(-50%,-50%);pointer-events:none;';
        container.appendChild(el);
      }
      const el = container.querySelector(`[data-ap="${code}"]`);
      const color = countryColors[country];
      if (!color && !document.documentElement.dataset.fr24showallair) {
        container.querySelector(`[data-ap="${code}"]`)?.remove();
        continue;
      }
      el.style.background = color || document.documentElement.dataset.fr24defaultairportcolor || '#ff3b3b';
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    }
  }

  function drawClaimedAirports() {
    if (!mapObj) return;
    const proj   = mapObj.getProjection();
    const bounds = mapObj.getBounds();
    if (!proj || !bounds) return;
    const ne    = proj.fromLatLngToPoint(bounds.getNorthEast());
    const sw    = proj.fromLatLngToPoint(bounds.getSouthWest());
    const scale = Math.pow(2, mapObj.getZoom());

    const active = getClaimedCodes();
    // Remove stars for codes no longer claimed
    for (const el of container.querySelectorAll('[data-claimed]')) {
      if (!active.has(el.dataset.claimed)) el.remove();
    }
    for (const [code, { lat, lng }] of claimedDots) {
      const { x, y } = toPixel(proj, sw, ne, scale, lat, lng);
      let el = container.querySelector(`[data-claimed="${code}"]`);
      if (!el) {
        el = document.createElement('div');
        el.dataset.claimed = code;
        el.style.cssText = 'position:absolute;width:14px;height:14px;border-radius:50%;border:3px solid #ffd700;background:transparent;box-shadow:0 0 0 1px rgba(0,0,0,0.6);transform:translate(-50%,-50%);pointer-events:none;';
        container.appendChild(el);
      }
      el.style.left = x + 'px';
      el.style.top  = y + 'px';
    }
  }

  // Reprocess on assignment/colour changes so new assignments show immediately
  new MutationObserver(() => {
    if (!isEnabled()) { clearAll(); return; }
    if (aircraftStore) processAircraftMap(aircraftStore.$state.aircraftMap);
    else scheduleRedraw();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-fr24groups', 'data-fr24assignments', 'data-fr24airports', 'data-fr24showallair', 'data-fr24defaultairportcolor', 'data-fr24enabled', 'data-fr24claimed'] });

  new MutationObserver(() => {
    updateClaimedLocations();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-fr24claimed'] });

  new MutationObserver(() => {
    if (dispatcherStore) {
      allFilters = null;
      updateFiltersFromStore(dispatcherStore.$state.dispatcher);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-fr24refreshsig'] });
})();
