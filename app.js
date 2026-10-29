/* Gerard's Gold Mine (the Charlotte office property map). ArcGIS Maps SDK for JavaScript 4.34 (AMD build from js.arcgis.com).
   Data: hosted feature layers listed in layers.js (two slots per layer; the newest ready slot is used).
   On localhost only, layers-staging.js (with ?env=staging) and the publish script's dev proxy
   (python scripts/publish_esri.py --env staging --serve 8765) are used, so private services can be tested without signing in. */
require([
  "esri/config", "esri/kernel", "esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer", "esri/layers/GraphicsLayer", "esri/Graphic",
  "esri/widgets/Search", "esri/widgets/Search/SearchSource", "esri/widgets/BasemapToggle", "esri/widgets/Home",
  "esri/widgets/Locate", "esri/widgets/ScaleBar", "esri/widgets/Expand", "esri/widgets/Sketch/SketchViewModel", "esri/geometry/geometryEngine",
  "esri/core/urlUtils", "esri/core/reactiveUtils", "esri/request", "esri/layers/support/AggregateField", "esri/geometry/Extent",
  "esri/layers/GeoJSONLayer"
], function (esriConfig, kernel, Map, MapView, FeatureLayer, GraphicsLayer, Graphic, Search, SearchSource, BasemapToggle, Home, Locate,
             ScaleBar, Expand, SketchViewModel, geometryEngine, urlUtils, reactiveUtils, esriRequest, AggregateField, Extent, GeoJSONLayer) {
  "use strict";
  const CFG = window.OFFICE_MAP_CONFIG || {};
  const HOLD = CFG.longHoldYears || 15;
  const NAVY = [43, 34, 25];          // the theme's deep mine-shaft brown (rings, outlines, labels)
  const GOLD = [224, 168, 46];        // nugget gold: selected property, owner portfolio rings, drawn areas
  const GREY_LINE = [110, 100, 85];   // county lines
  // class colors: Okabe-Ito based, none near the gold accent; override in config.js (classColors) without touching code
  const CC = Object.assign({ "Industrial": "#4f6d9a", "Hospitality": "#c0532b", "Net Lease": "#138a82", "Strip Center": "#a3478a" }, CFG.classColors || {});
  const CC_CHIP = Object.assign({ "Net Lease": "#0f7770" }, CFG.classChipColors || {});   // darker where white chip text needs it
  const CLASSES = ["Industrial", "Hospitality", "Net Lease", "Strip Center"].map((k) => ({ key: k, color: CC[k], chip: CC_CHIP[k] }));
  const CLASS = Object.fromEntries(CLASSES.map((c) => [c.key, c]));
  // pipeline statuses: five distinct hues, none a class color or the gold accent
  const PIPE_STATUS = { "Announced": "#5f6e83", "In Review": "#2a6fb8", "Approved": "#5c940d", "Under Construction": "#e8590c", "Open": "#1c1712" };
  const PIPE_DARK_TEXT = { "Approved": true, "Under Construction": true };   // chips that need dark text for 4.5:1
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const blank = (v) => v == null || v === "" || (typeof v === "number" && isNaN(v));
  const nf = (v, d) => blank(v) || isNaN(v) ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 });
  const money = (v) => blank(v) || isNaN(v) ? "" : "$" + nf(v);
  const moneyShort = (v) => {
    if (blank(v) || isNaN(v)) return "";
    const a = Math.abs(v);
    return a >= 1e9 ? `$${nf(v / 1e9, 1)}B` : a >= 1e6 ? `$${nf(v / 1e6, a >= 1e7 ? 1 : 1)}M` : a >= 1e3 ? `$${nf(v / 1e3)}K` : `$${nf(v)}`;
  };
  const sf = (v) => blank(v) || isNaN(v) ? "" : `${nf(v)} SF`;
  const ac = (v) => blank(v) || isNaN(v) ? "" : `${nf(v, v < 10 ? 2 : 1)} ac`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateShort = (s) => { const m = /^(\d{4})-(\d{2})/.exec(s || ""); return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : (s || ""); };
  const dateLong = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : (s || ""); };
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const params = new URLSearchParams(location.search);
  const phone = () => window.matchMedia("(max-width: 760px)").matches;
  const placeholder = (s) => !s || /^\[/.test(s);
  const countyKey = (state, county) => `${state}|${String(county || "").replace(/\s+(County|City)$/i, "")}`;
  const srcName = (code) => (CFG.sourceNames || {})[code] || code || "";
  const NO_DATA = "The map data is not available right now. Try again in a few minutes, or contact Anthony Warren.";
  const EMPTY_COPY = "No gold in this seam. Try widening the filters.";
  const LOGO_SCALE = 20000;   // brand logo pins at this scale and closer
  const ICON = {
    pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.5s-4.5-4.2-4.5-7.6a4.5 4.5 0 0 1 9 0c0 3.4-4.5 7.6-4.5 7.6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="6.9" r="1.6" fill="currentColor"/></svg>',
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3L12.5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sheet: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5.5L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 8h4.5M6 10.8h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    bldg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V6.5L12 3l8 3.5V21M9 21v-4h6v4M8 9h2M14 9h2M8 13h2M14 13h2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ck: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2L9.5 3.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    nug: '<svg class="nug" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 10.5 L4.2 6.4 L8.6 5.2 L12.6 6.8 L14.2 10.6 L11.8 13.4 L6 13.8 L2.8 12.6 Z" fill="#e0a82e" stroke="#7a5200" stroke-width="1" stroke-linejoin="round"/><path d="M4.2 6.4 L7 9.4 L8.6 5.2 M7 9.4 L11.8 13.4 M7 9.4 L12.6 6.8" stroke="#fff3c4" stroke-opacity=".7" stroke-width=".8" fill="none"/></svg>'
  };
  // county files are in capitals: title-case names and addresses for display, keeping entity, unit and direction tokens upper
  const KEEP_UPPER = new Set(["LLC", "LP", "LLP", "LLLP", "PLLC", "INC", "CO", "II", "III", "IV", "VI", "VII", "US", "USA", "PO", "NC", "SC", "VA", "N", "S", "E", "W",
    "NE", "NW", "SE", "SW", "REIT", "LTD", "NA", "FSB", "QSR", "ATM", "CVS", "BP", "KFC", "IHOP", "BB&T", "YMCA", "HOA", "STE", "APT"]);
  const SMALL = new Set(["of", "and", "the", "at", "by", "for", "in", "on", "de", "la"]);
  function titleCase(t) {
    if (!t) return "";
    const str = String(t);
    if (/[a-z]/.test(str)) return str;   // already mixed case: leave it as the source wrote it
    return str.toLowerCase().replace(/[A-Za-z0-9&'.#-]+/g, (w, i) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up.replace(/[.,'-]/g, ""))) return up;
      if (/^\d+(st|nd|rd|th)$/i.test(w)) return w.toLowerCase();
      if (/^\d/.test(w)) return up;
      if (i > 0 && SMALL.has(w)) return w;
      return w.replace(/(^|[-'.])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/^Mc([a-z])/, (m, b) => "Mc" + b.toUpperCase());
    });
  }
  const pcClose = () => { const b = el("button", { type: "button", class: "pc-close", "aria-label": "Close the card", title: "Close", onclick: () => window.officeMap && window.officeMap.view.closePopup() }); b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'; return b; };
  const pcRoot = () => el("div", { class: "pc" }, [pcClose()]);
  const iconEl = (name, cls) => { const s = document.createElement("span"); s.className = cls || "ic"; s.innerHTML = ICON[name]; return s.firstChild; };

  // ------------------------------------------------------------------ brand logos (assets/logos/manifest.json, written by data/logos/process_logos.py)
  // Each entry: brand, pin (2x callout image), pinW and pinH (CSS px), card (2x image), and how property brands match it:
  // names (exact brand, any class), prefixes (hotel name starts with), contains (hotel name contains a family word) with exclude.
  let LOGOS = {}, LOGO_MATCH = { names: {}, prefixes: [], contains: [] };   // prefixes: [NAME, slug, family]; contains: [WORD, slug, excludes, family]
  async function loadLogos() {
    try {
      const r = await fetch("assets/logos/manifest.json", { cache: "no-cache" });
      if (!r.ok) return;
      const m = await r.json();
      LOGOS = m.logos || {};
      Object.entries(LOGOS).forEach(([slug, x]) => {
        (x.names || []).forEach((n) => { LOGO_MATCH.names[n.toUpperCase()] = slug; });
        (x.prefixes || []).forEach((p) => LOGO_MATCH.prefixes.push([p.toUpperCase(), slug, x.family || null]));
        (x.contains || []).forEach((c) => LOGO_MATCH.contains.push([c.toUpperCase(), slug, (x.exclude || []).map((e) => e.toUpperCase()), x.family || null]));
      });
      LOGO_MATCH.prefixes.sort((a, b) => b[0].length - a[0].length);
    } catch (e) { /* no logos yet: class points everywhere */ }
  }
  function logoSlug(a) {
    const b = String(a.brand || "").toUpperCase();
    if (!b) return null;
    if (a.asset_class === "Hospitality") {
      const fam = String(a.brand_parent || "");
      const word = (x) => b.startsWith(x) && (b.length === x.length || !/[A-Z0-9]/.test(b[x.length]));   // "HAMPTON INN" yes, "HAMPTONS" no
      const p = LOGO_MATCH.prefixes.find(([x, , f]) => word(x) && (!f || f === fam));   // Hampton Manor Motel (Independent) gets no Hilton logo
      if (p) return p[1];
      const c = LOGO_MATCH.contains.find(([x, , ex, f]) => new RegExp(`(^|[^A-Z])${x}([^A-Z]|$)`).test(b) && !ex.some((e) => b.indexOf(e) > -1) && (!f || f === fam));
      if (c) return c[1];
      return null;
    }
    return LOGO_MATCH.names[b] || null;
  }

  // a private or missing service fails quietly instead of opening an ArcGIS sign-in box
  if (!isLocal) esriConfig.request.useIdentity = false;

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "style") e.style.cssText = v; else e.setAttribute(k, v);
    });
    [].concat(kids || []).forEach((c) => { if (c != null && c !== false) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function toast(msg, ms, action) {   // action: { label, fn } adds a button such as Undo
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "toast-btn"; b.textContent = action.label;
      b.onclick = () => { t.hidden = true; action.fn(); };
      t.appendChild(b);
    }
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms || (action ? 7000 : 4000));
  }
  function loadScript(src) {
    return new Promise((res) => { const s = document.createElement("script"); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // ------------------------------------------------------------------ panel, sheet and tabs (work before any data loads)
  function setSheet(h) { document.body.dataset.sheet = h; }
  function showTab(t) {
    document.querySelectorAll(".tabs button").forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + t));
    document.body.dataset.tab = t;
    document.body.classList.remove("panel-closed");
    if (phone() && document.body.dataset.sheet === "peek") setSheet("half");
  }
  const toPeek = () => { if (phone()) setSheet("peek"); };
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  $("panelToggle").onclick = () => {
    if (phone()) setSheet(document.body.dataset.sheet === "peek" ? "half" : "peek");
    else document.body.classList.toggle("panel-closed");
  };
  $("sheetHandle").onclick = () => setSheet({ peek: "half", half: "full", full: "peek" }[document.body.dataset.sheet] || "half");
  window.matchMedia("(max-width: 760px)").addEventListener("change", (m) => { document.body.classList.remove("panel-closed"); setSheet("peek"); });
  if (!store.get("officeMap.howToDone", false)) $("howTo").hidden = false;
  $("howToClose").onclick = () => { $("howTo").hidden = true; store.set("officeMap.howToDone", true); };
  $("howToShow").onclick = () => { $("howTo").hidden = false; showTab("map"); };

  // ------------------------------------------------------------------ which services
  async function layerSet() {
    let set = window.OFFICE_MAP_LAYERS, proxy = false;
    if (isLocal) {
      try { proxy = (await fetch("/__devproxy", { cache: "no-store" })).ok; } catch (e) { proxy = false; }
      if (params.get("env") === "staging" || !set) {
        await loadScript("layers-staging.js");
        if (window.OFFICE_MAP_STAGING) set = window.OFFICE_MAP_STAGING;
      }
    }
    if (!set) return { set: null, staging: false };
    if (proxy) {
      const origins = new Set();
      Object.values(set).forEach((l) => l.slots.forEach((u) => origins.add(new URL(u).origin)));
      origins.forEach((o) => urlUtils.addProxyRule({ urlPrefix: o, proxyUrl: "/proxy" }));
    }
    return { set, staging: set === window.OFFICE_MAP_STAGING };
  }
  async function pickSlots(set) {   // newest ready slot of each layer; the cache-buster keeps a stale description from pointing at an emptied slot
    const out = {};
    await Promise.all(Object.entries(set).map(async ([key, l]) => {
      const seen = await Promise.all(l.slots.map(async (url) => {
        try {
          const j = (await esriRequest(url, { query: { f: "json", _: Date.now() }, responseType: "json" })).data;
          const d = JSON.parse(j.description || "{}");
          return d.status === "ready" ? { url, published: d.published, rows: d.rows } : null;
        } catch (e) { return null; }
      }));
      const best = seen.filter(Boolean).sort((a, b) => String(b.published).localeCompare(String(a.published)))[0];
      if (best) out[key] = best;
    }));
    return out;
  }

  // ------------------------------------------------------------------ main
  // services down: one message, counts stop shimmering, actions disabled with the reason, a Try again button
  function servicesDown(view) {
    $("loading").hidden = true;
    if (view) try {   // address search still works while the property data is down
      new Search({ view, container: "searchSlot", includeDefaultSources: false, allPlaceholder: "Street address or place", popupEnabled: false,
        sources: [{ url: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer", name: "Address", singleLineFieldName: "SingleLine", placeholder: "Street address or place",
          countryCode: "USA", maxSuggestions: 4, zoomScale: 6000, popupEnabled: false, resultGraphicEnabled: false }] });
    } catch (e) { /* no search */ }
    document.querySelectorAll(".cls").forEach((b) => { b.classList.remove("skeleton"); b.disabled = true; });
    document.querySelectorAll("[data-n]").forEach((x) => { x.textContent = "Not available"; x.style.fontSize = "13px"; });
    $("matchCount").textContent = ""; $("matchLabel").textContent = "Map data not available";
    ["showTable", "exportProps"].forEach((id) => { $(id).disabled = true; $(id).title = NO_DATA; });
    if (!document.querySelector("#tab-map .notice")) {
      const n = el("div", { class: "notice" }, [NO_DATA, " "]);
      n.appendChild(el("button", { type: "button", class: "link-btn", text: "Try again", onclick: () => location.reload() }));
      document.querySelector("#tab-map").prepend(n);
    }
  }
  async function init() {
    {   // wordmark: the last two words in gold ("Gerard's" + "Gold Mine")
      const t = CFG.title || "Gerard's Gold Mine", m = /^(.*?)(\s+\S+\s+\S+)$/.exec(t);
      $("appTitle").innerHTML = m ? `${esc(m[1])}<span class="gold">${esc(m[2])}</span>` : esc(t);
      document.title = t;
    }
    $("appSubtitle").textContent = CFG.subtitle || "";
    $("sigHoldYrs").textContent = HOLD;
    $("sdkVersion").textContent = `Map software: ArcGIS Maps SDK for JavaScript ${kernel.fullVersion || kernel.version}.`;
    renderContact();
    if (phone()) setSheet("peek");
    // the class cards draw at once (counts fill in when the data answers)
    $("classButtons").innerHTML = CLASSES.map((c) => `<button type="button" class="cls skeleton" data-cls="${c.key}" aria-pressed="true" style="--c:${c.color}">
      <span class="top"><span class="sw"></span><span class="nm">${c.key}</span><span class="ck">${ICON.ck}</span></span><span class="ct" data-n="${c.key}">&nbsp;</span></button>`).join("");
    const doneLoading = (msg) => {
      if (msg) { $("loadingText").textContent = msg; const sp = document.querySelector("#loading .spin"); if (sp) sp.remove(); return; }
      $("loading").hidden = true;
    };

    // basemap first, so a map shows within a second even when the data is slow
    const map = new Map({ basemap: "gray-vector" });
    // the card docks as a side panel on desktop and as a bottom sheet on phones
    const dock = () => ({ breakpoint: false, buttonEnabled: false, position: phone() ? "bottom-center" : "top-right" });
    const urlC = (params.get("c") || "").split(",").map(Number), urlZ = Number(params.get("z"));
    const startCenter = urlC.length === 2 && urlC.every((x) => !isNaN(x)) ? urlC : (CFG.center || [-80.84, 35.23]);
    const view = new MapView({
      container: "viewDiv", map, center: startCenter, zoom: urlZ > 0 ? urlZ : (CFG.zoom || 9),
      constraints: { minZoom: 5, snapToZoom: false },
      highlightOptions: { color: [...GOLD, 1], haloOpacity: 0.95, fillOpacity: 0 },
      // no Esri header band: every card draws its own title and close button
      popup: { dockEnabled: true, dockOptions: dock(), visibleElements: { collapseButton: false, closeButton: false, heading: false, actionBar: false, featureNavigation: true } }
    });
    view.ui.move("zoom", "top-left");   // the card docks top-right, so the map controls sit top-left
    if (phone()) view.ui.remove("zoom");   // pinch zoom on phones; the buttons covered pins
    // basemap labels draw under the data: the label (reference) layers move into the base layers
    function labelsUnder(bm) {
      if (!bm) return;
      bm.load().then(() => { const refs = bm.referenceLayers.toArray(); if (refs.length) { bm.referenceLayers.removeAll(); bm.baseLayers.addMany(refs); } }).catch(() => {});
    }
    labelsUnder(map.basemap);
    // the imagery toggle keeps the zoom
    let keepScale = null;
    view.watch("stationary", (st) => { if (st) keepScale = view.scale; });
    reactiveUtils.watch(() => view.map.basemap, (bm) => { labelsUnder(bm); if (keepScale) { const k = keepScale; setTimeout(() => { if (Math.abs(view.scale - k) / k > 0.02) view.scale = k; }, 50); } });
    reactiveUtils.when(() => view.popup, (p) => { if (p.viewModel) p.viewModel.includeDefaultActions = false; }, { once: true });
    window.matchMedia("(max-width: 760px)").addEventListener("change", () => { if (view.popup) view.popup.dockOptions = dock(); });

    const [{ set, staging }] = await Promise.all([layerSet(), loadLogos()]);
    const L = set ? await pickSlots(set) : {};
    if (staging) document.title += " (staging)";
    if (!L.properties) { servicesDown(view); return; }
    const current = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.url]));
    let areaGeom = null, radiusArmed = false;
    let imagery = false;

    // ---------------------------------------------------------------- layers
    const fl = (key, opts) => L[key] ? new FeatureLayer({ url: L[key].url, ...opts }) : null;
    const counties = fl("counties", {
      title: "Counties", outFields: ["county", "state"], popupTemplate: { title: "", outFields: ["*"], content: countyCard },
      renderer: { type: "simple", symbol: { type: "simple-fill", color: [255, 255, 255, 0], outline: { color: [...GREY_LINE, 0.45], width: 0.8 } } },
      labelingInfo: [{ labelExpressionInfo: { expression: "$feature.county" }, minScale: 2500000,
        symbol: { type: "text", color: [...GREY_LINE, 0.95], haloColor: "white", haloSize: 1.2, font: { size: 10, weight: "bold" } } }]
    });
    // class points sized a little by building SF (est.) in four steps; smaller at metro zoom so 60,000 points do not pile up.
    // At logo zoom (1:20,000 and in) the brand pins draw in their own layer above these points.
    const SIZE_STEPS = { far: [2.4, 3, 3.8, 4.8], mid: [3.6, 4.5, 5.5, 7], near: [5.5, 7, 8.5, 11] };   // points (1 pt = 1.33 px)
    const band = () => view.scale > 300000 ? "far" : view.scale > 100000 ? "mid" : "near";
    const CLASS_EXPR = 'var sf = DefaultValue($feature.bldg_sf_est, 0);\nvar k = IIf(sf >= 100000, "3", IIf(sf >= 20000, "2", IIf(sf >= 5000, "1", "0")));\n' +
      'var l = IIf($feature.listed == "Yes" || $feature.listed == "Under contract", "L", "N");\nreturn $feature.asset_class + "|" + l + "|" + k;';
    let sizeBand = band();
    function propRenderer() {
      const ring = imagery ? [255, 255, 255, 1] : [...NAVY, 1], st = SIZE_STEPS[sizeBand], far = sizeBand === "far";
      const sym = (c, k, listed) => ({ type: "simple-marker", size: st[k] + (listed ? (far ? 1.5 : 2) : 0), color: c.color,
        outline: listed ? { color: ring, width: far ? 1.4 : 2.2 } : { color: [255, 255, 255, far ? 0.75 : 0.95], width: far ? 0.5 : 1 } });
      const infos = CLASSES.flatMap((c) => [0, 1, 2, 3].flatMap((k) => [
        { value: `${c.key}|N|${k}`, label: c.key, symbol: sym(c, k, false) },
        { value: `${c.key}|L|${k}`, label: `${c.key}, listed for sale or under contract`, symbol: sym(c, k, true) }]));
      return {
        type: "unique-value", valueExpression: CLASS_EXPR, valueExpressionTitle: "Class",
        uniqueValueInfos: infos,
        defaultSymbol: { type: "simple-marker", size: far ? 3 : 7, color: [120, 112, 100, 1], outline: { color: "white", width: 0.6 } }
      };
    }
    const props = fl("properties", {
      title: "Properties", outFields: ["asset_class", "listed", "bldg_sf_est", "brand", "brand_parent", "name", "pid"], minScale: 0, renderer: propRenderer(),
      orderBy: [{ field: "bldg_sf_est", order: "ascending" }],   // larger buildings draw on top
      featureReduction: {
        type: "binning", maxScale: CFG.binsUntilScale || 1500000, fixedBinLevel: CFG.binLevel || 4,
        fields: [new AggregateField({ name: "aggregateCount", statisticType: "count" })],
        renderer: { type: "simple", symbol: { type: "simple-fill", color: [...NAVY, 0.3], outline: { color: [255, 255, 255, 0.7], width: 0.5 } },
          visualVariables: [{ type: "color", field: "aggregateCount", stops: [{ value: 1, color: [246, 232, 196, 0.4] }, { value: 50, color: [234, 196, 110, 0.5] },
            { value: 500, color: [196, 138, 23, 0.55] }, { value: 5000, color: [110, 72, 20, 0.65] }] }] },
        labelsVisible: true,
        labelingInfo: [{ deconflictionStrategy: "static", minScale: 5000000, labelPlacement: "center-center", labelExpressionInfo: { expression: "IIf($feature.aggregateCount >= 100, Text($feature.aggregateCount, '#,###'), '')" },
          symbol: { type: "text", color: [...NAVY, 0.9], font: { size: 9.5, weight: "bold" }, haloColor: [255, 255, 255, 0.95], haloSize: 1.4 } }],
        popupEnabled: true, popupTemplate: { title: "", content: (f) => el("div", { class: "pc" }, [pcClose(), el("div", { class: "hero" }, [el("div", { class: "title" }, [el("h3", { text: `${nf(f.graphic.attributes.aggregateCount)} properties here` }), el("div", { class: "brandline", text: "Zoom in to see each property." })])])]) }
      }
    });
    const listings = fl("listings", {
      title: "Crexi listings", outFields: ["title", "state"], minScale: 300000, popupTemplate: { title: "", outFields: ["*"], content: listingCard },
      renderer: { type: "simple", symbol: { type: "simple-marker", style: "diamond", size: 8, color: [255, 255, 255, 0.85], outline: { color: [...NAVY, 0.8], width: 1.2 } } }
    });
    const pipeline = fl("pipeline", {
      title: "Development pipeline", outFields: ["status", "confidence", "pin_precision"], minScale: 300000, visible: false,
      popupTemplate: { title: "", outFields: ["*"], content: pipelineCard },
      renderer: {
        type: "unique-value", valueExpression: "$feature.status + '|' + IIf(Find('address', Lower(DefaultValue($feature.pin_precision, ''))) > -1, 'p', 'c')",
        uniqueValueInfos: Object.entries(PIPE_STATUS).flatMap(([s, c]) => [
          { value: `${s}|p`, label: s, symbol: { type: "simple-marker", style: "square", size: 9, color: [255, 255, 255, 0.85], outline: { color: c, width: 1.5 } } },
          { value: `${s}|c`, label: `${s} (approximate pin)`, symbol: { type: "simple-marker", style: "circle", size: 9, color: [255, 255, 255, 0.85], outline: { color: c, width: 1.5 } } }]),
        defaultSymbol: { type: "simple-marker", style: "square", size: 11, color: [255, 255, 255, 0.2], outline: { color: [106, 61, 154, 1], width: 2 } },
        visualVariables: [{ type: "size", valueExpression: "var c = Lower(DefaultValue($feature.confidence, '')); return IIf(Left(c, 4) == 'high', 3, IIf(Left(c, 6) == 'medium', 2, 1));",
          stops: [{ value: 1, size: 8 }, { value: 3, size: 10 }] }]
      }
    });
    const traffic = fl("traffic", {
      title: "Traffic counts", outFields: ["aadt", "year", "route"], visible: false, minScale: 150000,
      popupTemplate: { title: (f) => esc(f.graphic.attributes.route || "Traffic count"), outFields: ["*"],
        content: (f) => { const a = f.graphic.attributes; return el("div", { class: "pc" }, [pcClose(), el("div", { class: "hero" }, [el("div", { class: "title" }, [el("h3", { text: titleCase(a.route) || "Traffic count" }), el("div", { class: "brandline", text: "State DOT traffic count" })])]), kv([["AADT", `${nf(a.aadt)} vehicles a day`, "State DOT count (actual)"], ["Count year", String(a.year || "")],
          ["Source", a.source || ""]]), el("div", { class: "est", text: "Annual average daily traffic as published by the state DOT (actual)." })]); } },
      renderer: { type: "simple", symbol: { type: "simple-marker", size: 6, color: [90, 100, 115, 1], outline: { color: "white", width: 0.8 } } },
      labelingInfo: [{ minScale: 20000, labelExpressionInfo: { expression: "Text($feature.aadt, '#,###')" }, labelPlacement: "above-center",
        symbol: { type: "text", color: [60, 66, 77, 1], haloColor: "white", haloSize: 1.4, font: { size: 10, weight: "bold" } } }]
    });
    const comps = fl("comps", {
      title: "Recent sales", outFields: ["price_basis"], visible: false, minScale: 1500000,
      popupTemplate: { title: "", outFields: ["*"], content: compCard },
      renderer: { type: "unique-value", field: "price_basis",
        uniqueValueInfos: [{ value: "actual", label: "Sale with a published price", symbol: { type: "simple-marker", style: "triangle", size: 10, color: [43, 43, 43, 1], outline: { color: "white", width: 0.9 } } }],
        defaultSymbol: { type: "simple-marker", style: "triangle", size: 9, color: [255, 255, 255, 1], outline: { color: [43, 43, 43, 1], width: 1.4 } }, defaultLabel: "Sale, price not published" }
    });
    // Crexi for-lease listings and the Rent Guide grid (asking rents only; achieved rents are not public)
    // leases ride in the listings layer (deal = Lease); sale listings exclude them
    const makeLeases = () => fl("listings", {
      title: "For lease", outFields: ["rent_lo", "asset_class"], visible: false, minScale: 300000, definitionExpression: "deal = 'Lease'",
      popupTemplate: { title: "", outFields: ["*"], content: leaseCard },
      renderer: { type: "unique-value", field: "asset_class",
        uniqueValueInfos: [{ value: "Industrial", label: "Industrial space for lease", symbol: { type: "simple-marker", size: 7, color: [255, 255, 255, 0.9], outline: { color: [120, 90, 30, 1], width: 1.8 } } }],
        defaultSymbol: { type: "simple-marker", size: 7, color: [255, 255, 255, 0.9], outline: { color: [20, 120, 110, 1], width: 1.8 } }, defaultLabel: "Retail space for lease" }
    });
    const RENT_STOPS = [[0, 14, [237, 248, 233]], [14, 18, [186, 228, 179]], [18, 22, [116, 196, 118]], [22, 28, [49, 163, 84]], [28, 999, [0, 109, 44]]];
    // the Rent Guide file is published after the app; set rentGuide in config.js (or a "rentguide" entry in layers.js) to turn it on
    const RENT_URL = CFG.rentGuide || (window.OFFICE_MAP_LAYERS && window.OFFICE_MAP_LAYERS.rentguide && window.OFFICE_MAP_LAYERS.rentguide.url) || null;
    const rentGuide = !RENT_URL ? null : new GeoJSONLayer({ url: RENT_URL,
      title: "Rent Guide", outFields: ["*"], visible: false, opacity: 0.7,
      popupTemplate: { title: "", outFields: ["*"], content: rentCard },
      renderer: { type: "class-breaks", field: "retail_median", legendOptions: { title: "Retail asking rent, $/SF/yr (median, Crexi)" },
        classBreakInfos: RENT_STOPS.map(([lo, hi, c]) => ({ minValue: lo, maxValue: hi, label: hi > 900 ? `$${lo}+` : `$${lo} to $${hi}`,
          symbol: { type: "simple-fill", color: [...c, 0.75], outline: { color: [255, 255, 255, 0.6], width: 0.4 } } })) },
      labelingInfo: [{ minScale: 400000, labelExpressionInfo: { expression: "'$' + Text($feature.retail_median, '#')" },
        symbol: { type: "text", color: [25, 50, 30, 1], haloColor: "white", haloSize: 1.2, font: { size: 9.5, weight: "bold" } } }]
    });
    const areaLayer = new GraphicsLayer({ title: "Area", listMode: "hide" });
    const markLayer = new GraphicsLayer({ title: "Highlights", listMode: "hide" });
    let leases = null;   // added once the listings layer shows it has a deal field
    const pinLayer = new GraphicsLayer({ title: "Brand logos", listMode: "hide" });   // decluttered logo pins at close zoom
    map.addMany([counties, rentGuide, traffic, props, comps, pipeline, listings, pinLayer, areaLayer, markLayer].filter(Boolean));
    if (rentGuide) rentGuide.load().catch(() => { map.remove(rentGuide); $("rowTglRent").hidden = true; });
    $("loadingText").textContent = "Digging up properties...";
    view.whenLayerView(props).then((lv) => reactiveUtils.whenOnce(() => !lv.updating)).then(() => doneLoading()).catch(() => doneLoading());
    setTimeout(() => doneLoading(), 45000);   // never leave the notice up

    // unfiltered twins for queries (search, portfolio, export, tables)
    const Q = (key, of) => L[key] ? new FeatureLayer({ url: L[key].url, outFields: of || ["*"] }) : null;
    const propsQ = Q("properties"), listQ = Q("listings"), countyQ = Q("counties"), trafficQ = Q("traffic"), pipeQ = Q("pipeline"), compsQ = Q("comps");
    try { await Promise.all([propsQ, listQ, countyQ, trafficQ, pipeQ, compsQ].filter(Boolean).map((l) => l.load())); }
    catch (e) { console.error(e); $("matchLabel").textContent = NO_DATA; return; }
    const has = (f) => propsQ.fields.some((x) => x.name === f);
    // sale listings and lease listings share one layer; everything that reads "listings" means for sale
    const SALE = listQ && listQ.fields.some((x) => x.name === "deal") ? "(deal IS NULL OR deal <> 'Lease')" : "1=1";
    if (listQ && SALE !== "1=1") {
      listQ.definitionExpression = SALE; if (listings) listings.definitionExpression = SALE;
      leases = makeLeases(); if (leases) map.add(leases, map.layers.indexOf(listings) + 1);
    }
    const ownerField = has("owner_key") ? "owner_key" : "owner";
    const propTemplate = { title: "", outFields: ["*"], content: propCard };   // the card draws its own header (logo, name, chips)
    props.popupTemplate = propTemplate; propsQ.popupTemplate = propTemplate;
    if (compsQ) compsQ.popupTemplate = comps.popupTemplate;
    if (has("nearest_aadt")) $("rowAadt").hidden = false;
    if (has("pipeline_2mi")) $("rowPipe").hidden = false;
    if (pipeline) $("rowTglPipeline").hidden = false;
    if (leases && SALE !== "1=1") $("rowTglLeases").hidden = false;
    if (rentGuide) $("rowTglRent").hidden = false;
    const HAS = { leases: !!leases, rentguide: !!rentGuide };   // Cole's layers, for the legend
    if (traffic) $("rowTglTraffic").hidden = false;
    if (comps) $("rowTglComps").hidden = false;

    view.ui.add(new Home({ view }), "top-left");
    view.ui.add(new Locate({ view, scale: 20000 }), "top-left");
    view.ui.add(new BasemapToggle({ view, nextBasemap: "hybrid" }), "bottom-right");
    view.ui.add(new ScaleBar({ view, unit: "dual" }), "bottom-left");
    view.ui.add(new Expand({ view, content: legendEl(), expandTooltip: "Legend", expanded: false, expandIcon: "legend" }), "bottom-left");
    // listed-for-sale ring: navy on the light basemap, white on imagery
    reactiveUtils.watch(() => view.map.basemap && view.map.basemap.title, () => {
      imagery = !/gray|light/i.test((view.map.basemap && (view.map.basemap.id || view.map.basemap.title)) || "");
      props.renderer = propRenderer();
    });
    // point sizes follow the zoom band
    reactiveUtils.watch(() => view.scale > 0 && band(), (b) => { if (b && b !== sizeBand) { sizeBand = b; props.renderer = propRenderer(); } }, { initial: true });
    // brand logo pins from 1:20,000 in, decluttered: larger buildings first, a pin that would overlap a placed one stays a class point.
    // Each pin keeps the class point under its tip and a thin class-color bar along the bottom of the tile.
    const pinTemplate = { title: "", outFields: ["*"], content: async (f) => {
      const r = await propsQ.queryFeatures({ objectIds: [f.graphic.attributes.OBJECTID], outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference });
      return r.features[0] ? propCard({ graphic: r.features[0] }) : "This property is no longer on the map.";
    } };
    let pinSeq = 0, pinTimer = null;
    const schedulePins = () => { clearTimeout(pinTimer); pinTimer = setTimeout(drawPins, 120); };
    async function drawPins() {
      const seq = ++pinSeq;
      if (!Object.keys(LOGOS).length || !(view.scale <= LOGO_SCALE) || !props.visible) { pinLayer.removeAll(); return; }
      try {
        const lv = await view.whenLayerView(props);
        const r = await lv.queryFeatures({ geometry: view.extent, returnGeometry: true, outFields: ["OBJECTID", "pid", "brand", "brand_parent", "asset_class", "bldg_sf_est"] });
        if (seq !== pinSeq) return;
        const cand = r.features.map((f) => ({ f, slug: logoSlug(f.attributes) })).filter((x) => x.slug && LOGOS[x.slug])
          .sort((a, b) => (b.f.attributes.bldg_sf_est || 0) - (a.f.attributes.bldg_sf_est || 0));
        const placed = [], gs = [];
        for (const c of cand) {
          if (placed.length >= 160) break;
          const x = LOGOS[c.slug], sp = view.toScreen(c.f.geometry);
          if (!sp || !x.tileW) continue;
          const box = { l: sp.x - x.tileW / 2 - 3, r: sp.x + x.tileW / 2 + 3, t: sp.y - x.tileTop - 3, b: sp.y + 3 };
          if (placed.some((q) => !(box.r < q.l || box.l > q.r || box.b < q.t || box.t > q.b))) continue;
          placed.push(box);
          const attrs = { OBJECTID: c.f.attributes.OBJECTID, pid: c.f.attributes.pid, _pin: 1 };
          gs.push(new Graphic({ geometry: c.f.geometry, attributes: attrs, popupTemplate: pinTemplate,
            symbol: { type: "picture-marker", url: `assets/logos/${x.pin}`, width: `${x.pinW}px`, height: `${x.pinH}px`, yoffset: `${x.yoff}px` } }));
          const cc = CLASS[c.f.attributes.asset_class];
          if (cc && x.barW) gs.push(new Graphic({ geometry: c.f.geometry, attributes: attrs,
            symbol: { type: "simple-marker", style: "path", path: `M0 0H${Math.round(x.barW * 10)}V30H0Z`, size: `${x.barW}px`, color: cc.color, outline: { color: [0, 0, 0, 0], width: 0 }, yoffset: `${x.barY}px` } }));
        }
        pinLayer.removeAll(); pinLayer.addMany(gs);
      } catch (e) { /* layer view not ready at this scale */ }
    }
    view.watch("stationary", (st) => { if (st) schedulePins(); });
    view.whenLayerView(props).then((lv) => reactiveUtils.watch(() => lv.updating, (u) => { if (!u) schedulePins(); })).catch(() => {});   // redraw when new points arrive
    let hl = null;   // gold highlight of the open property
    // phone: a card or a tap on the map drops the sheet to its peek height
    reactiveUtils.watch(() => view.popup && view.popup.visible, (v) => {
      if (v) toPeek();
      document.body.classList.toggle("card-open", !!v);
      if (!v && hl) { hl.remove(); hl = null; }   // the gold ring leaves with the card
    });
    let openPid = params.get("pid") || null;
    reactiveUtils.watch(() => view.popup && view.popup.visible && view.popup.selectedFeature, (g) => {
      const a = g && g.attributes;
      openPid = a && a.pid && (a._pin || g.layer === props || g.layer === propsQ || (g.popupTemplate && g.popupTemplate.content === propCard)) ? a.pid : null;
      if (typeof saveUrl === "function") saveUrl();
    });
    // desktop: keep the selected point out from under the docked card (and above the table drawer)
    reactiveUtils.watch(() => view.popup && view.popup.visible && view.popup.selectedFeature, (g) => {
      if (!g || phone() || !g.geometry || g.geometry.type !== "point") return;
      setTimeout(() => {
        const sp = view.toScreen(g.geometry);
        if (!sp) return;
        const freeW = view.width - 424, freeH = view.height - (typeof drawerH === "function" ? drawerH() : 0);
        if (sp.x > 40 && sp.x < freeW - 40 && sp.y > 40 && sp.y < freeH - 40) return;
        const c = view.toScreen(view.center);
        view.goTo(view.toMap({ x: c.x + sp.x - freeW / 2, y: c.y + sp.y - freeH / 2 }), { duration: 350 }).catch(() => {});
      }, 50);
    });
    // selected feature highlight on the map
    reactiveUtils.watch(() => view.popup && view.popup.visible && view.popup.selectedFeature, async (g) => {
      if (hl) { hl.remove(); hl = null; }
      if (!g || !g.attributes || !(g.attributes._pin || g.layer === props || g.layer === propsQ || (g.popupTemplate && g.popupTemplate.content === propCard))) return;
      // cards opened from a pin, the table, search or a link: highlight the drawn point by its id
      try { const lv = await view.whenLayerView(props); hl = g.layer === props ? lv.highlight(g) : lv.highlight(g.attributes.OBJECTID); } catch (e) { /* not drawn at this scale */ }
    });

    // ---------------------------------------------------------------- filters
    document.querySelectorAll(".cls").forEach((b) => b.classList.remove("skeleton"));
    const toggleBtn = (b) => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); if (b.classList.contains("cls")) fillSubs(); applyFilters(); };
    // the Sub type list follows the class cards (no "Hotel" choice with Hospitality off)
    let subRows = [];
    function fillSubs() {
      const on = pressed(".cls").map((b) => b.dataset.cls), sel = $("fSub"), keep = sel.value || pendingSelect.fSub || "";
      const subs = [...new Set(subRows.filter((r) => !on.length || on.includes(r.asset_class)).map((r) => r.sub_type))].sort();
      sel.innerHTML = `<option value="">All</option>` + subs.map((v) => `<option>${esc(v)}</option>`).join("");
      if (subs.includes(keep)) sel.value = keep;
    }
    document.querySelectorAll(".cls, .sig").forEach((b) => b.onclick = () => toggleBtn(b));
    const pressed = (sel) => [...document.querySelectorAll(sel)].filter((b) => b.getAttribute("aria-pressed") === "true");
    const val = (id) => $(id).value.trim();

    function filterWhere(opts) {
      opts = opts || {};
      const p = [];
      if (!opts.noClass) {
        const cls = pressed(".cls").map((b) => b.dataset.cls);
        if (!cls.length) return "1=0";
        if (cls.length < CLASSES.length) p.push(`asset_class IN (${cls.map(sq).join(",")})`);
      }
      if (val("fState")) p.push(`state = ${sq(val("fState"))}`);
      countyParts(p);
      if (val("fSize")) {
        const [kind, lo, hi] = val("fSize").split(":"), f = kind === "sf" ? "bldg_sf_est" : "acres";
        if (lo !== "") p.push(`${f} >= ${Number(lo)}`);
        if (hi) p.push(`${f} < ${Number(hi)}`);
      }
      pressed(".sig").forEach((b) => p.push({ long: `hold_years >= ${HOLD}`, oos: "out_of_state = 'Yes'", high: "seller_score = 'High'" }[b.dataset.sig]));
      if (val("fSub")) p.push(`sub_type = ${sq(val("fSub"))}`);
      if (val("fOwnerType")) p.push(`owner_type = ${sq(val("fOwnerType"))}`);
      if (val("fListed")) p.push(val("fListed") === "listed" ? "listed IN ('Yes','Under contract')" : `listed = ${sq(val("fListed"))}`);
      if (val("fHold") !== "" && !isNaN(val("fHold"))) p.push(`hold_years >= ${Number(val("fHold"))}`);
      if (val("fOwner")) p.push(`UPPER(owner) LIKE ${sq("%" + val("fOwner").toUpperCase() + "%")}`);
      const sc = [...document.querySelectorAll(".fScore:checked")].map((i) => i.value);
      if (sc.length) p.push(`seller_score IN (${sc.map(sq).join(",")})`);
      const num = (id, expr) => { const x = val(id); if (x !== "" && !isNaN(x)) p.push(expr.replace("?", Number(x))); };
      num("fAcMin", "acres >= ?"); num("fAcMax", "acres <= ?"); num("fSfMin", "bldg_sf_est >= ?"); num("fSfMax", "bldg_sf_est <= ?");
      if (has("nearest_aadt")) num("fAadt", "nearest_aadt >= ?");
      if (has("pipeline_2mi") && val("fPipe")) p.push(val("fPipe") === "yes" ? "pipeline_2mi > 0" : "(pipeline_2mi = 0 OR pipeline_2mi IS NULL)");
      return p.length ? p.join(" AND ") : "1=1";
    }
    function countyParts(p) {   // the County value is "ST|County name", so same-named counties in two states never merge
      const v = val("fCounty");
      if (!v) return;
      const i = v.indexOf("|");
      if (i > 0) { if (!val("fState")) p.push(`state = ${sq(v.slice(0, i))}`); p.push(`county = ${sq(v.slice(i + 1))}`); }
      else p.push(`county = ${sq(v)}`);
    }
    function listingWhere() { return val("fState") ? `state = ${sq(val("fState"))}` : "1=1"; }
    function compsWhere() {   // recent sales follow the class buttons, state and county
      const p = [], cls = pressed(".cls").map((b) => b.dataset.cls);
      if (!cls.length) return "1=0";
      if (cls.length < CLASSES.length) p.push(`asset_class IN (${cls.map(sq).join(",")})`);
      if (val("fState")) p.push(`state = ${sq(val("fState"))}`);
      countyParts(p);
      return p.length ? p.join(" AND ") : "1=1";
    }
    const MORE = ["fSub", "fOwnerType", "fOwner", "fHold", "fAcMin", "fAcMax", "fSfMin", "fSfMax", "fListed", "fAadt", "fPipe"];
    function moreCount() {
      const n = MORE.filter((id) => val(id) !== "").length + (document.querySelectorAll(".fScore:checked").length ? 1 : 0);
      $("moreCount").textContent = n ? `(${n} on)` : "";
    }

    let applyTimer = null, applySeq = 0, lastCount = null, lastZeroToast = null;
    function applyFilters() {
      moreCount();
      clearTimeout(applyTimer);
      applyTimer = setTimeout(async () => {
        const seq = ++applySeq, where = filterWhere();
        props.definitionExpression = where === "1=1" ? null : where; props.visible = where !== "1=0";
        schedulePins();
        if (listings) { listings.definitionExpression = [listingWhere(), SALE].filter((w) => w !== "1=1").join(" AND ") || null; listings.visible = $("tglListings").checked; }
        if (leases) leases.definitionExpression = ["deal = 'Lease'", listingWhere()].filter((w) => w !== "1=1").join(" AND ");
        if (pipeline) { pipeline.definitionExpression = listingWhere() === "1=1" ? null : listingWhere(); pipeline.visible = $("tglPipeline").checked; }
        if (comps) { comps.definitionExpression = compsWhere() === "1=1" ? null : compsWhere(); comps.visible = $("tglComps").checked; }
        if (traffic) traffic.visible = $("tglTraffic").checked;
        if (counties) counties.visible = $("tglCounties").checked;
        if (leases) leases.visible = $("tglLeases").checked;
        if (rentGuide) rentGuide.visible = $("tglRent").checked;
        saveUrl();
        $("matchCount").textContent = "...";
        try {
          const [n, byClass] = await Promise.all([
            propsQ.queryFeatureCount({ where }),
            propsQ.queryFeatures({ where: filterWhere({ noClass: true }), returnGeometry: false, groupByFieldsForStatistics: ["asset_class"],
              outStatistics: [{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }] })
          ]);
          if (seq !== applySeq) return;
          lastCount = n;
          $("matchCount").textContent = nf(n);

          $("exportProps").textContent = phone() ? "Export" : "Export CSV";
          $("exportProps").disabled = false;
          $("exportProps").title = `Export the properties that match the filters (up to ${nf(CFG.exportMax || 50000)} rows)`;
          $("exportHint").hidden = true;
          $("matchLabel").textContent = n === 0 ? EMPTY_COPY : n === 1 ? "property matches" : "properties match";
          if (n === 0 && lastZeroToast !== where) { lastZeroToast = where; toast(EMPTY_COPY); }
          document.querySelectorAll("[data-n]").forEach((s) => s.textContent = "0");
          byClass.features.forEach((f) => { const s = document.querySelector(`[data-n="${f.attributes.asset_class}"]`); if (s) s.textContent = nf(f.attributes.n); });
          if (areaGeom) runAreaStats();
        } catch (e) { console.error(e); checkRefresh(true); $("matchCount").textContent = ""; $("matchLabel").textContent = "count unavailable"; }
      }, 250);
    }
    document.querySelectorAll("#tab-map input, #tab-map select").forEach((x) => x.addEventListener(x.type === "text" || x.type === "number" ? "input" : "change", applyFilters));
    $("fState").addEventListener("change", fillCounties);
    // choosing a state or county moves the map to the matches
    async function zoomToFilter() {
      try {
        const r = await propsQ.queryExtent({ where: filterWhere({ noClass: true }) });
        if (!r.count || !r.extent) return;
        await view.goTo(r.count === 1 || r.extent.width === 0 ? { target: r.extent.center, zoom: 15 } : r.extent.expand(1.12));
      } catch (e) { /* stay put */ }
    }
    $("fState").addEventListener("change", () => { if (val("fState")) zoomToFilter(); });
    $("fCounty").addEventListener("change", () => { if (val("fCounty") || val("fState")) zoomToFilter(); });
    $("resetFilters").onclick = () => {
      document.querySelectorAll("#tab-map select").forEach((s) => s.value = "");
      document.querySelectorAll("#tab-map input[type=number], #tab-map input[type=text]").forEach((i) => i.value = "");
      document.querySelectorAll(".fScore").forEach((i) => i.checked = false);
      document.querySelectorAll(".cls").forEach((b) => b.setAttribute("aria-pressed", "true"));
      document.querySelectorAll(".sig").forEach((b) => b.setAttribute("aria-pressed", "false"));
      fillCounties(); fillSubs(); applyFilters();
    };

    // ---------------------------------------------------------------- shareable URL: view, classes, every filter and the layer toggles
    const LYR = { l: "tglListings", p: "tglPipeline", s: "tglComps", t: "tglTraffic", c: "tglCounties", r: "tglLeases", g: "tglRent" };
    const FKEYS = { sub: "fSub", ot: "fOwnerType", own: "fOwner", hold: "fHold", acmin: "fAcMin", acmax: "fAcMax", sfmin: "fSfMin", sfmax: "fSfMax",
      listed: "fListed", aadt: "fAadt", pipe: "fPipe" };
    function saveUrl() {
      const q = new URLSearchParams(location.search);
      ["c", "z", "cls", "st", "co", "sz", "sig", "f", "lyr", "pid"].forEach((k) => q.delete(k));
      if (openPid) q.set("pid", openPid);   // the open property travels with a shared link
      const cls = pressed(".cls").map((b) => CLASSES.findIndex((c) => c.key === b.dataset.cls)).join("");
      if (cls !== "0123") q.set("cls", cls || "x");
      if (val("fState")) q.set("st", val("fState"));
      if (val("fCounty")) q.set("co", val("fCounty"));
      if (val("fSize")) q.set("sz", val("fSize"));
      const sig = pressed(".sig").map((b) => b.dataset.sig).join(",");
      if (sig) q.set("sig", sig);
      const f = Object.entries(FKEYS).filter(([, id]) => val(id) !== "").map(([k, id]) => `${k}:${val(id).replace(/[|]/g, " ")}`);
      const sc = [...document.querySelectorAll(".fScore:checked")].map((i) => i.value);
      if (sc.length) f.push(`score:${sc.join(",")}`);
      if (f.length) q.set("f", f.join("|"));
      const lyr = Object.entries(LYR).filter(([, id]) => $(id) && $(id).checked).map(([k]) => k).join("");
      if (lyr !== "lc") q.set("lyr", lyr || "x");
      if (view.center) { q.set("c", `${view.center.longitude.toFixed(4)},${view.center.latitude.toFixed(4)}`); q.set("z", view.zoom.toFixed(1)); }
      history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q.toString() : ""));
    }
    function readUrl() {
      if (params.has("cls")) document.querySelectorAll(".cls").forEach((b, i) => b.setAttribute("aria-pressed", params.get("cls").includes(String(i)) ? "true" : "false"));
      if (params.get("st")) $("fState").value = params.get("st");
      if (params.get("sz")) $("fSize").value = params.get("sz");
      (params.get("sig") || "").split(",").filter(Boolean).forEach((s) => { const b = document.querySelector(`.sig[data-sig="${s}"]`); if (b) b.setAttribute("aria-pressed", "true"); });
      let more = false;
      (params.get("f") || "").split("|").filter(Boolean).forEach((part) => {
        const i = part.indexOf(":"), k = part.slice(0, i), v = part.slice(i + 1);
        if (k === "score") v.split(",").forEach((s) => { const c = document.querySelector(`.fScore[value="${s}"]`); if (c) { c.checked = true; more = true; } });
        else if (FKEYS[k]) { pendingSelect[FKEYS[k]] = v; $(FKEYS[k]).value = v; more = true; }
      });
      if (more) $("moreFilters").open = true;
      if (params.has("lyr")) Object.entries(LYR).forEach(([k, id]) => { if ($(id)) $(id).checked = params.get("lyr").includes(k); });
      // center and zoom are read into the MapView constructor (no goTo race)
    }
    const pendingSelect = {};   // select values from the URL that arrive before their option lists
    view.watch("stationary", (s) => { if (s) saveUrl(); });

    async function distinct(layer, fields, where) {
      const r = await layer.queryFeatures({ where: where || "1=1", outFields: fields, returnDistinctValues: true, returnGeometry: false, orderByFields: fields });
      return r.features.map((f) => f.attributes);
    }
    let countyRows = [];
    function fillCounties() {
      const st = val("fState"), sel = $("fCounty");
      let keep = sel.value || params.get("co") || "";
      const rows = countyRows.filter((r) => r.county && (!st || r.state === st));
      sel.innerHTML = `<option value="">All</option>` + rows.map((r) => `<option value="${esc(r.state + "|" + r.county)}">${esc(r.county)}${st ? "" : ", " + esc(r.state)}</option>`).join("");
      if (keep && keep.indexOf("|") < 0) { const r = rows.find((x) => x.county === keep); keep = r ? `${r.state}|${r.county}` : ""; }   // older links carry the name only
      if (rows.some((r) => `${r.state}|${r.county}` === keep)) sel.value = keep;
    }
    readUrl();
    applyFilters();
    (async () => {
      try {
        countyRows = await distinct(propsQ, ["state", "county"]);   // from the properties, so the names always match
        fillCounties();
        const [subs, ot] = await Promise.all([distinct(propsQ, ["asset_class", "sub_type"], "sub_type IS NOT NULL AND sub_type <> ''"), distinct(propsQ, ["owner_type"], "owner_type IS NOT NULL")]);
        subRows = subs; fillSubs();
        $("fOwnerType").innerHTML = `<option value="">All</option>` + ot.map((r) => `<option>${esc(r.owner_type)}</option>`).join("");
        Object.entries(pendingSelect).forEach(([id, v]) => { $(id).value = v; });
        if (params.get("co") || Object.keys(pendingSelect).length) applyFilters();
      } catch (e) { console.warn("filter lists", e); }
    })();

    // ---------------------------------------------------------------- property card (popup)
    function kv(rows) {
      const box = el("div", { class: "kv" });
      rows.filter((r) => r && !blank(r[1])).forEach(([k, v, tip]) => { box.appendChild(el("div", { text: k })); box.appendChild(el("div", { title: tip || null }, [v])); });
      return box;
    }
    const tag = (txt, label) => el("span", {}, [txt, " ", el("span", { class: "est", text: `(${label})` })]);
    const est = (txt) => tag(txt, "est.");
    const observed = (txt) => tag(txt, "observed, Overture Oct 2026");
    function classChip(cls) {
      const c = CLASS[cls];
      return el("span", { class: `chip2 cls2${c && c.darkText ? " dark-text" : ""}`, style: `background:${c ? c.chip || c.color : "#5b6677"}`, text: cls || "Unclassified" });
    }
    function linkRow(a, lat, lon, extra) {
      const row = el("div", { class: "links" });
      const gis = (CFG.countyGis || {})[countyKey(a.state, a.county)];
      if (gis) row.appendChild(el("a", { href: gis, target: "_blank", rel: "noopener", text: "County GIS" }));
      row.appendChild(el("a", { href: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`, target: "_blank", rel: "noopener", text: "Google Street View" }));
      row.appendChild(el("a", { href: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`, target: "_blank", rel: "noopener", text: "Google Maps" }));
      (extra || []).forEach((x) => row.appendChild(x));
      return row;
    }
    function reportHref(a) {
      if (placeholder(CFG.reportEmail)) return null;
      const link = `${location.origin}${location.pathname}?pid=${encodeURIComponent(a.pid || "")}`;
      const body = `Property id: ${a.pid || ""}\nAddress: ${[a.site_address, a.site_city, a.state].filter(Boolean).join(", ")}\nOwner shown: ${a.owner || ""}\nLink: ${link}\n\nWhat is wrong:\n`;
      return `mailto:${CFG.reportEmail}?subject=${encodeURIComponent(CFG.title + " data problem")}&body=${encodeURIComponent(body)}`;
    }
    function saleDate(s, precision, long) {
      if (!s) return "";
      if (precision === "year") return s.slice(0, 4);
      if (precision === "month") return dateShort(s);
      return long ? dateLong(s) : dateShort(s);
    }
    function saleText(a, long) {
      if (!a.last_sale_date) return "";
      const d = saleDate(a.last_sale_date, a.sale_date_precision, long);
      if (!has("sale_price")) return d;
      return blank(a.sale_price) || a.sale_price <= 0 ? `${d}, price not published` : `${d} for ${moneyShort(a.sale_price)}`;
    }
    const valueLabel = () => "County value";
    const basisText = (b) => String(b || "").replace(/\s*\(([^)]*)\)/g, ", $1");
    const valueText = (a) => {
      if (blank(a.assessed_value)) return "";
      const v = a.assessed_basis ? tag(moneyShort(a.assessed_value), basisText(a.assessed_basis)) : el("span", { text: moneyShort(a.assessed_value) });
      return a.value_note ? el("span", {}, [v, el("div", { class: "note", text: a.value_note })]) : v;
    };
    function siteLine(a) {   // "221 Heathway Dr, Charlotte, NC 28269": the street once, the state once, no repeated city
      let street = String(a.site_address || "").trim();
      const city = String(a.site_city || "").trim(), st = a.state || "", zip = a.site_zip ? String(a.site_zip).trim() : "";
      street = street.replace(new RegExp(`\\s+${st}(\\s+\\d{5}(-\\d{4})?)?$`, "i"), "");   // "... CHARLOTTE NC" ends
      if (city && street.toUpperCase().endsWith(" " + city.toUpperCase())) street = street.slice(0, -city.length).trim();
      if (!street || /^\d{5}$/.test(street)) street = "";
      const tail = [titleCase(city), [st, zip && street.indexOf(zip) < 0 ? zip : ""].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      return street ? [titleCase(street), tail].filter(Boolean).join(", ") : `No street address on file${tail ? ", " + tail : ""}`;
    }
    const countyLine = (a) => [a.county, a.state].filter(Boolean).join(", ");
    const acresText = (a) => blank(a.acres) ? "" : /^estimate/i.test(a.acres_basis || "") ? est(ac(a.acres)) : ac(a.acres);
    function scoreInputs(a) {   // what the seller score is built on, in words
      const p = [];
      if (!blank(a.hold_years)) p.push(`held ${nf(a.hold_years, 0)} yr`);
      if (a.owner_type && a.owner_type !== "Unknown") p.push(a.owner_type.toLowerCase().replace("llc or corp", "LLC or corporation"));
      if (a.out_of_state === "Yes") p.push("out of state"); else if (a.out_of_state === "No") p.push("in state");
      if (a.year_built) p.push(`built ${a.year_built}`);
      return p.join(", ");
    }
    function scoreChip(v) {   // High reads as a gold nugget; the others stay plain
      const c = el("span", { class: `chip2 sc-${String(v).replace(/\s/g, "")}`, title: "Sorting aid built on assumptions; see About" });
      if (v === "High") c.innerHTML = ICON.nug;
      c.appendChild(document.createTextNode(v));
      return c;
    }
    // card header: brand logo when the brand has one, otherwise a class-colored building tile
    function logoBox(a, cls) {
      const slug = logoSlug(a), x = slug && LOGOS[slug];
      if (x && x.card) return el("div", { class: "logo" }, [el("img", { src: `assets/logos/${x.card}`, alt: `${x.brand} logo` })]);
      const c = CLASS[cls || a.asset_class];
      const box = el("div", { class: "logo ph", style: `background:${c ? c.color : "#5b6677"}`, "aria-hidden": "true" });
      box.innerHTML = ICON.bldg; box.firstChild.style.cssText = "width:28px;height:28px";
      return box;
    }
    function hero(a, title, sub, cls) {
      return el("div", { class: "hero" }, [logoBox(a, cls), el("div", { class: "title" }, [el("h3", { text: title }), sub ? el("div", { class: "brandline", text: sub }) : null])]);
    }
    const addrLine = (txt, sub) => {
      const d = el("div", {}), a1 = el("div", { class: "addr" });
      a1.innerHTML = ICON.pin; a1.appendChild(el("span", { text: txt })); d.appendChild(a1);
      if (sub) d.appendChild(el("div", { class: "addr2", text: sub }));
      return d;
    };
    const holdText = (y) => blank(y) ? "" : y > 75 ? "Over 75 yr, check the deed" : `${nf(y, 1)} yr`;
    const sec = (txt, note) => el("div", { class: "sec" }, [txt, note ? el("span", { class: "src", text: note }) : null]);
    function propCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry, src = srcName(a.source);
      const root = pcRoot();
      // 1. header: logo, name, brand, chips, address, figure strip, then the two actions
      const title = titleCase(a.name || a.brand) || (siteLine(a).startsWith("No street") ? "Unnamed property" : titleCase(siteLine(a).split(",")[0]));
      const brandLine = [a.name && a.brand && a.name.indexOf(a.brand) < 0 ? a.brand : null, a.brand_parent && a.brand_parent !== a.brand && a.brand_parent !== "Independent" && a.brand_parent !== "Other Brand" ? a.brand_parent : null].filter(Boolean).join(", ");
      root.appendChild(hero(a, title, brandLine));
      const chips = el("div", { class: "chips" }, [classChip(a.asset_class), a.sub_type ? el("span", { class: "chip2", text: a.sub_type }) : null]);
      root.appendChild(chips);
      root.appendChild(addrLine(siteLine(a), countyLine(a)));
      const fig = (k, v, n) => el("div", {}, [el("div", { class: "k", text: k }), el("div", { class: v ? "v" : "v na", text: v || "Not on file" }), n ? el("div", { class: "n", text: n }) : null]);
      root.appendChild(el("div", { class: "figs" }, [fig("Land", ac(a.acres), /^estimate/i.test(a.acres_basis || "") ? "est." : "county"),
        fig("Building SF", blank(a.bldg_sf_est) ? "" : nf(a.bldg_sf_est), blank(a.bldg_sf_est) ? "" : "est."), fig("Year built", a.year_built ? String(a.year_built) : "", a.year_built ? "county" : ""),
        fig("Value", moneyShort(a.assessed_value), blank(a.assessed_value) ? "" : "county")]));
      const addBtn = el("button", { type: "button", class: "primary" });
      const paintAdd = () => { const on = cartHas(a.pid); addBtn.classList.toggle("on", on); addBtn.innerHTML = (on ? ICON.check : ICON.plus) + `<span>${on ? "On call list" : "Add to call list"}</span>`; };
      paintAdd();
      addBtn.onclick = () => { cartToggle(a, g, paintAdd); paintAdd(); };
      const sheetBtn = el("button", { type: "button", onclick: () => siteSheet(a, g) });
      sheetBtn.innerHTML = ICON.sheet + "<span>Site sheet</span>";
      root.appendChild(el("div", { class: "btns" }, [addBtn, sheetBtn]));
      // 2. owner
      root.appendChild(sec("Owner"));
      const multi = a.owner_type === "Multiple";
      const more = (a.portfolio_count || 1) - 1;
      const moreLine = el("span", {}, [multi ? "Several unit owners on this parcel" : more > 0 ? `Owns ${nf(more)} more` : "No other properties on this map"]);
      if (more > 0 && !multi && a[ownerField]) {
        moreLine.appendChild(el("button", { class: "mini", type: "button", text: "Show all", onclick: () => openPortfolio(a[ownerField]) }));
        distinct(propsQ, ["state"], `${ownerField} = ${sq(a[ownerField])}`).then((rows) => {
          const sts = rows.map((r) => r.state).filter(Boolean);
          if (sts.length) moreLine.firstChild.textContent = `Owns ${nf(more)} more in ${sts.length > 1 ? sts.slice(0, -1).join(", ") + " and " + sts[sts.length - 1] : sts[0]}`;
        }).catch(() => {});
      }
      const mail = [titleCase(a.mail_address), titleCase(a.mail_city), [a.mail_state, a.mail_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      root.appendChild(kv([
        ["Name", el("span", { class: "owner", text: titleCase(a.owner) || a.owner_note || "Not in the county file" }), src],
        ["Owner type", a.owner_type ? est(a.owner_type) : ""],
        ["Mailing", mail ? el("span", {}, [mail, a.out_of_state === "Yes" ? el("span", { class: "chip2 oos", style: "margin-left:6px", text: "Out of state" }) : null]) : "", src],
        ["Hold", blank(a.hold_years) ? "Unknown" : a.hold_years > 75 ? el("span", { class: "note", text: holdText(a.hold_years) }) : est(holdText(a.hold_years))],
        ["Portfolio", moreLine],
        ["Seller score", a.seller_score ? el("span", {}, [scoreChip(a.seller_score),
          el("div", { class: "est", text: a.seller_score === "Not scored" ? "Not scored: no recorded sale, owner unknown, or several unit owners." : scoreInputs(a) ? `Based on: ${scoreInputs(a)}` : "" })]) : ""]
      ]));
      // 3. property
      root.appendChild(sec("Property"));
      root.appendChild(kv([
        ["Land", acresText(a), a.acres_basis || src], ["Building", blank(a.bldg_sf_est) ? "" : est(sf(a.bldg_sf_est))], ["Year built", a.year_built ? String(a.year_built) : "", src],
        [valueLabel(a), valueText(a), `${src} (county record)`], ["Last sale", saleText(a), src], ["County use", a.use_desc || "", src],
        a.asset_class === "Net Lease" || a.asset_class === "Strip Center" ? ["Rent, lease term, cap rate, vacancy", "Not public"] : null
      ]));
      // 4. tenants observed (Overture places, not a rent roll)
      const nT = has("tenant_count") && !blank(a.tenant_count) ? a.tenant_count : 0;
      if ((has("tenants") && a.tenants) || nT > 0) {
        root.appendChild(sec("Tenants observed", "Overture Maps, Oct 2026"));
        if (nT > 0) root.appendChild(kv([["Storefronts", observed(`${nf(nT)}${blank(a.national_share) ? "" : ", " + nf(a.national_share * 100) + "% national"}`)]]));
        if (a.tenants) root.appendChild(el("div", { class: "tenants" }, String(a.tenants).split(/\s*;\s*/).filter(Boolean).slice(0, 8).map((t) => el("span", { text: t }))));
      }
      // 5. site
      if (has("nearest_aadt") || has("pipeline_2mi")) {
        root.appendChild(sec("Site"));
        const aadt = !has("nearest_aadt") ? null : blank(a.nearest_aadt) ? ["Nearest traffic count", "No count within 1,500 ft"] :
          ["Nearest traffic count", `${nf(a.nearest_aadt)} AADT${a.aadt_year ? " (" + a.aadt_year + ")" : ""}${a.aadt_route ? " on " + a.aadt_route : ""}${blank(a.aadt_dist_ft) ? "" : ", " + nf(a.aadt_dist_ft) + " ft away"}`, "State DOT count (actual)"];
        const plist = (txt) => el("ul", { class: "plist" }, String(txt).split(/\s*;\s*/).filter(Boolean).slice(0, 6).map((n) => el("li", { text: n })));
        const pipe = !has("pipeline_2mi") ? null : ["Pipeline within 2 mi", a.pipeline_2mi > 0 ? el("div", {}, [est(`${nf(a.pipeline_2mi)} project${a.pipeline_2mi > 1 ? "s" : ""}`), a.pipeline_names ? plist(a.pipeline_names) : null]) : "None"];
        const city = has("pipeline_city") && a.pipeline_city ? ["Nearby, pin approximate", el("div", {}, [plist(a.pipeline_city)])] : null;
        const note = a.aadt_note ? ["Traffic count note", a.aadt_note] : null;
        root.appendChild(kv([aadt, note, pipe, city]));
      }
      // 5b. trade area (Census tracts in 3 and 5 mile rings) and the demographic outlier flag
      if (has("ring3_pop") && !blank(a.ring3_pop)) {
        root.appendChild(sec("Trade area", "Census ACS 5-year, tract rings"));
        root.appendChild(kv([["Population, 3 mi", est(nf(a.ring3_pop))], ["Population, 5 mi", blank(a.ring5_pop) ? "" : est(nf(a.ring5_pop))],
          ["Households, 3 mi", blank(a.ring3_hh) ? "" : est(nf(a.ring3_hh))], ["Household income, 3 mi", blank(a.ring3_income) ? "" : est(money(a.ring3_income))],
          ["County tax rate", has("county_tax_rate") && !blank(a.county_tax_rate) ? tag(`$${nf(a.county_tax_rate, 4)} per $100`, "county rate") : ""],
          ["Next revaluation", has("county_reval_next") && a.county_reval_next ? String(a.county_reval_next) : ""],
          a.demo_flag ? [a.demo_flag, el("div", {}, [el("span", { class: "chip2 oos", text: a.demo_flag }), el("div", { class: "est", text: `${a.demo_note || ""}. Ring income sits outside the band where this brand usually trades (its stores in VA, NC and SC); a fit read, not store sales.` })])] : null]));
      }
      // 5c. space for lease on this property (Crexi) and tenants that fit the trade area
      if (has("lease_spaces") && a.lease_spaces > 0) {
        root.appendChild(sec("For lease here", "Crexi, asking"));
        root.appendChild(kv([["Spaces listed", nf(a.lease_spaces)], ["Space available", blank(a.lease_sf) ? "" : sf(a.lease_sf)],
          ["Asking rent", rentText(a.lease_rent_lo, a.lease_rent_hi) ? tag(rentText(a.lease_rent_lo, a.lease_rent_hi) + " /SF/yr", "asking") : "Not posted"]]));
      }
      if (has("tenant_prospects") && a.tenant_prospects) {
        root.appendChild(sec("Tenant prospects", "estimate"));
        root.appendChild(el("div", { class: "tenants" }, String(a.tenant_prospects).split(/\s*;\s*/).filter(Boolean).slice(0, 8).map((t) => el("span", { text: t }))));
        root.appendChild(el("div", { class: "est", text: "Brands whose stores usually sit in rings like this one and have no store within 3 miles. A leasing lead list, not a demand study." }));
      }
      // 5d. everything this owner holds in North Carolina, all property types (NC OneMap, live)
      if (a.state === "NC" && a.owner && a.owner_type !== "Multiple") {
        const box = el("div", { class: "ownerall" });
        const btn = el("button", { class: "mini", type: "button", text: "All NC holdings, every property type", onclick: () => ownerLookup(a.owner, box, btn) });
        root.appendChild(el("div", { class: "kv-note" }, [btn, box]));
      }
      // 6. links
      root.appendChild(sec("Links"));
      const lr = linkRow(a, g.latitude, g.longitude);
      root.appendChild(lr);
      if ((a.listed === "Yes" || a.listed === "Under contract") && listQ) {
        matchListing(a, g).then((m) => {
          if (!m) return;
          if (m.hit) {
            chips.appendChild(el("span", { class: "chip2 listed", text: a.listed === "Under contract" ? "Under contract" : "Listed for sale" }));
            lr.appendChild(el("a", { href: m.hit.f.attributes.url, target: "_blank", rel: "noopener", text: "Crexi listing" }));
          } else {
            const box = el("div", { class: "near" }, [`Listing next door: ${titleCase(m.near.f.attributes.address || "address not shown")}, ${nf(m.near.d)} m away. `]);
            box.appendChild(el("a", { href: m.near.f.attributes.url, target: "_blank", rel: "noopener", text: "Crexi listing" }));
            lr.after(box);
          }
        }).catch(() => {});
      }
      root.appendChild(el("details", { class: "rec" }, [el("summary", { text: "Record" }),
        kv([["Parcel number", a.parcel_id || ""], ["Property id", a.pid || ""], ["Class rule", a.class_rule || ""], ["Source", src], ["Value basis", a.assessed_basis || ""], ["Acres basis", a.acres_basis || ""]])]));
      const rh = reportHref(a);
      if (rh) root.appendChild(el("a", { class: "report", href: rh, text: "Report a data problem" }));
      return root;
    }
    function listingCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = pcRoot();
      root.appendChild(hero({ brand: a.tenant, asset_class: a.asset_class }, a.title || "Crexi listing", a.tenant && (a.title || "").indexOf(a.tenant) < 0 ? a.tenant : "", a.asset_class));
      root.appendChild(el("div", { class: "chips" }, [el("span", { class: "chip2 listed", text: "Crexi listing" }), a.asset_class && CLASS[a.asset_class] ? classChip(a.asset_class) : (a.asset_class ? el("span", { class: "chip2", text: a.asset_class }) : null)]));
      root.appendChild(addrLine([a.address || "Address not shown by the broker", a.city, a.state, a.zip].filter(Boolean).join(", ")));
      root.appendChild(kv([["Crexi type", a.crexi_type || ""], a.tenant ? ["Tenant", a.tenant] : null, ["Asking price", moneyShort(a.asking_price) || "Not posted"],
        ["Asking cap rate", blank(a.cap_rate) ? "" : nf(a.cap_rate, 2) + "%"], ["Building", sf(a.bldg_sf)], ["Land", ac(a.acres)], ["Status", a.status || ""],
        ["Listing firm", a.listing_firm || ""], ["Days on market", blank(a.days_on_market) ? "" : est(nf(a.days_on_market))], ["Data date", dateLong(a.scraped_date)]]));
      const cx = a.url && /^https:\/\/(www\.)?crexi\.com\//.test(a.url) ? [el("a", { href: a.url, target: "_blank", rel: "noopener", text: "Crexi listing" })] : [];
      root.appendChild(sec("Links"));
      root.appendChild(linkRow({ state: a.state, county: null }, g.latitude, g.longitude, cx));
      root.appendChild(el("div", { class: "footnote", text: "Facts as posted on Crexi on the data date (asking figures, not closed terms)." }));
      return root;
    }
    const rentText = (lo, hi) => blank(lo) && blank(hi) ? "" : blank(hi) || lo === hi ? `$${nf(lo || hi, 2)}` : blank(lo) ? `$${nf(hi, 2)}` : `$${nf(lo, 2)} to $${nf(hi, 2)}`;
    // every parcel the same owner name holds in NC, any use (residential, farm, retail...), straight from NC OneMap
    const NC_PARCELS = "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query";
    async function ownerLookup(owner, box, btn) {
      btn.disabled = true; box.textContent = "Looking up NC OneMap...";
      try {
        const q = new URLSearchParams({ where: `ownname IN ('${String(owner).toUpperCase().trim().replace(/'/g, "''")}', ' ${String(owner).toUpperCase().trim().replace(/'/g, "''")}')`, outFields: "siteadd,scity,cntyname,parusedesc,parval,gisacres",
          returnGeometry: "false", resultRecordCount: "500", orderByFields: "parval DESC", f: "json" });
        const r = await (await fetch(`${NC_PARCELS}?${q}`)).json();
        const rows = (r.features || []).map((x) => x.attributes);
        box.textContent = "";
        if (!rows.length) { box.textContent = "No NC parcels under this exact owner name."; return; }
        const by = {};
        rows.forEach((x) => { const k = (x.parusedesc || "Use not given").trim(); by[k] = (by[k] || 0) + 1; });
        const total = rows.reduce((s, x) => s + (x.parval || 0), 0);
        box.appendChild(el("div", { class: "est", text: `${nf(rows.length)}${rows.length >= 500 ? "+" : ""} NC parcels, ${moneyShort(total)} county value (NC OneMap, live). Exact owner name only; affiliated LLCs are not grouped.` }));
        box.appendChild(el("ul", { class: "plist" }, Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => el("li", { text: `${k}: ${nf(n)}` }))));
        const det = el("details", {}, [el("summary", { text: "Parcels, highest value first" })]);
        det.appendChild(el("ul", { class: "plist" }, rows.slice(0, 40).map((x) => el("li", { text: `${[x.siteadd, x.scity].filter(Boolean).join(", ") || "No site address"} (${x.cntyname || ""}), ${x.parusedesc || "use not given"}, ${moneyShort(x.parval) || "no value"}` }))));
        box.appendChild(det);
      } catch (e) { box.textContent = "NC OneMap did not answer; try again later."; btn.disabled = false; }
    }
    function leaseCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = pcRoot();
      root.appendChild(hero({ asset_class: a.asset_class }, a.title || "Space for lease", "For lease on Crexi", a.asset_class));
      root.appendChild(el("div", { class: "chips" }, [el("span", { class: "chip2 listed", text: "For lease" }), a.asset_class && CLASS[a.asset_class] ? classChip(a.asset_class) : (a.asset_class ? el("span", { class: "chip2", text: a.asset_class }) : null)]));
      root.appendChild(addrLine([a.address || "Address not shown by the broker", a.city, a.state, a.zip].filter(Boolean).join(", ")));
      root.appendChild(kv([["Asking rent", rentText(a.rent_lo, a.rent_hi) ? tag(rentText(a.rent_lo, a.rent_hi) + " /SF/yr", "asking") : "Not posted"], ["Rate type", a.rate_type || ""],
        ["Space available", blank(a.sf_lo) && blank(a.sf_hi) ? "" : a.sf_lo && a.sf_hi && a.sf_lo !== a.sf_hi ? `${sf(a.sf_lo)} to ${sf(a.sf_hi)}` : sf(a.sf_hi || a.sf_lo)],
        ["Suites listed", blank(a.suites) ? "" : nf(a.suites)], ["Building", sf(a.bldg_sf)], ["Crexi type", a.crexi_type || ""], ["Listing firm", a.listing_firm || ""],
        ["Listed since", a.listed_on ? dateLong(a.listed_on) : ""], ["Days listed", blank(a.days_listed) ? "" : est(nf(a.days_listed))], ["Data date", dateLong(a.scraped_date)]]));
      const cx = a.url && /^https:\/\/(www\.)?crexi\.com\//.test(a.url) ? [el("a", { href: a.url, target: "_blank", rel: "noopener", text: "Crexi listing" })] : [];
      root.appendChild(sec("Links"));
      root.appendChild(linkRow({ state: a.state, county: a.county }, g.latitude, g.longitude, cx));
      root.appendChild(el("div", { class: "footnote", text: "Asking rent as posted on Crexi on the data date, not a signed lease. NNN means taxes, insurance and CAM are extra." }));
      return root;
    }
    function rentCard(f) {
      const a = f.graphic.attributes;
      const root = pcRoot();
      root.appendChild(el("div", { class: "hero" }, [el("div", { class: "title" }, [el("h3", { text: "Rent Guide" }), el("div", { class: "brandline", text: "Asking rents in this cell, about 4 miles across" })])]));
      root.appendChild(sec("Retail", "Crexi for-lease listings"));
      root.appendChild(kv([["Median asking", blank(a.retail_median) ? "" : tag(`$${nf(a.retail_median, 2)} /SF/yr`, "asking")], ["Middle half", rentText(a.retail_p25, a.retail_p75)],
        ["Listings", nf(a.retail_n)]]));
      if (a.ind_n > 0) {
        root.appendChild(sec("Industrial"));
        root.appendChild(kv([["Median asking", blank(a.ind_median) ? "" : tag(`$${nf(a.ind_median, 2)} /SF/yr`, "asking")], ["Listings", nf(a.ind_n)]]));
      }
      root.appendChild(el("div", { class: "footnote", text: `Crexi, ${dateLong(a.as_of)}. Asking rents only; achieved rents and concessions are not public. Cells with fewer than 5 retail listings are hidden.` }));
      return root;
    }
    function pipelineCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = pcRoot();
      root.appendChild(el("div", { class: "hero" }, [el("div", { class: "title" }, [el("h3", { text: a.name || "Development project" }), el("div", { class: "brandline", text: "Development pipeline" })])]));
      root.appendChild(el("div", { class: "chips" }, [el("span", { class: "chip2 cls2", style: `background:${PIPE_STATUS[a.status] || "#5b6677"}${PIPE_DARK_TEXT[a.status] ? ";color:#10213f" : ""}`, text: a.status || "Status unknown" }),
        a.kind ? el("span", { class: "chip2", text: a.kind }) : null, a.confidence ? el("span", { class: "chip2", text: `${a.confidence.split(/[;(]/)[0].trim()} confidence` }) : null]));
      root.appendChild(addrLine([a.city, a.county, a.state].filter(Boolean).join(", ")));
      const precise = /address|intersection/i.test(a.pin_precision || "");
      root.appendChild(kv([["Anchor", a.anchor || ""], ["Developer", a.developer || ""], ["Size", a.size || ""], ["Detail", a.status_detail || ""],
        ["As of", dateLong(a.as_of_date)], ["Pin source", a.pin_source || ""], ["Pin placed at", precise ? (a.pin_precision || "") : /centroid/i.test(a.pin_precision || "") ? "City center only, not the site" : "Approximate location, not the exact site"]]));
      const src = a.source_url && /^https?:\/\//.test(a.source_url) ? [el("a", { href: a.source_url, target: "_blank", rel: "noopener", text: "Source" })] : [];
      root.appendChild(sec("Links"));
      root.appendChild(linkRow({ state: a.state, county: a.county }, g.latitude, g.longitude, src));
      return root;
    }
    function compCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = pcRoot();
      root.appendChild(hero(a, titleCase(a.name || a.brand) || titleCase(a.site_address) || "Recorded sale", a.last_sale_date ? `Sold ${saleDate(a.last_sale_date, a.sale_date_precision, true)}` : "Recorded sale", a.asset_class));
      root.appendChild(el("div", { class: "chips" }, [a.asset_class ? classChip(a.asset_class) : null,
        a.sub_type ? el("span", { class: "chip2", text: a.sub_type }) : null]));
      root.appendChild(addrLine(siteLine(a), countyLine(a)));
      const priced = a.price_basis === "actual" && !blank(a.sale_price), bulk = a.portfolio_sale === "Yes";
      root.appendChild(kv([["Sale date", saleDate(a.last_sale_date, a.sale_date_precision, true), srcName(a.source)], ["Sale price", priced ? moneyShort(a.sale_price) : "Not published by the county", srcName(a.source)],
        bulk ? ["Portfolio or bulk deed", "Price covers several parcels, so no per SF or per acre"] : null,
        ["Price per SF", priced && !bulk && !blank(a.ppsf_est) ? est(money(a.ppsf_est)) : ""], ["Price per acre", priced && !bulk && !blank(a.pp_acre) ? est(moneyShort(a.pp_acre)) : ""],
        ["Buyer", titleCase(a.buyer) || "", "Current owner of record"], ["Seller", "Not in public parcel data"],
        ["Building", blank(a.bldg_sf_est) ? "" : est(sf(a.bldg_sf_est))], ["Land", ac(a.acres)], ["Year built", a.year_built ? String(a.year_built) : ""],
        ["Parcel number", a.parcel_id || ""]]));
      root.appendChild(sec("Links"));
      root.appendChild(linkRow({ state: a.state, county: a.county }, g.latitude, g.longitude));
      root.appendChild(el("div", { class: "footnote", text: `Source: ${srcName(a.source)}. Price per SF uses the footprint estimate.` }));
      return root;
    }
    function countyCard(f) {
      const a = f.graphic.attributes;
      const root = pcRoot();
      root.appendChild(el("div", { class: "hero" }, [el("div", { class: "title" }, [el("h3", { text: `${a.county || "County"}, ${a.state || ""}` }), el("div", { class: "brandline", text: "County context" })])]));
      root.appendChild(sec("People", "Census"));
      root.appendChild(kv([a.pop_2025 != null ? ["Population 2025", tag(nf(a.pop_2025), "Census estimate")] : null, ["Population 2024", tag(nf(a.pop_2024), "Census estimate")],
        ["Growth, 5 yr", blank(a.pop_growth_5yr_pct) ? "" : tag(nf(a.pop_growth_5yr_pct, 1) + "%", "Census estimate")],
        ["Median household income", blank(a.median_hh_income) ? "" : tag(money(a.median_hh_income), "Census estimate")]]));
      root.appendChild(sec("On this map"));
      root.appendChild(kv([["Industrial", est(nf(a.n_industrial))], ["Hospitality", est(nf(a.n_hospitality))], ["Net lease", est(nf(a.n_net_lease))], ["Strip centers", est(nf(a.n_strip))],
        [`Held ${HOLD}+ years`, est(nf(a.n_long_hold))], ["Crexi listings", nf(a.n_listings)]]));
      if (!blank(a.re_rate_per_100) || a.next_reval_year || a.nri_rating) {
        root.appendChild(sec("Occupancy cost watch", "State revenue offices, FEMA"));
        root.appendChild(kv([["Real estate tax rate", blank(a.re_rate_per_100) ? "" : tag(`$${nf(a.re_rate_per_100, 4)} per $100${a.rate_year ? " (" + a.rate_year + ")" : ""}`, "county rate")],
          ["Last revaluation", a.last_reval_year ? String(a.last_reval_year) : ""], ["Next revaluation", a.next_reval_year ? String(a.next_reval_year) : ""],
          ["Hazard risk (insurance proxy)", a.nri_rating ? tag(a.nri_rating, "FEMA National Risk Index") : ""]]));
        if (a.gov_actions) root.appendChild(el("ul", { class: "plist" }, String(a.gov_actions).split(/\s*\|\s*/).filter(Boolean).slice(0, 4).map((n) => el("li", { text: n }))));
      }
      return root;
    }
    function legendEl() {
      const box = el("div", { class: "legend" });
      const dot = (c, extra) => `<span class="sw" style="background:${c};${extra || ""}"></span>`;
      box.innerHTML = `<div class="hd">Properties</div>` + CLASSES.map((c) => `<div>${dot(c.color)}${c.key}</div>`).join("") +
        `<div>${dot("#a89878", "box-shadow:0 0 0 2px #2b2219")}Listed or under contract</div>
         <div>${dot("#a89878", "width:6px;height:6px;margin-right:3px")}${dot("#a89878", "width:11px;height:11px")}Building size, small to large (est.)</div>
         ${Object.keys(LOGOS).length ? `<div><svg class="pinsw" viewBox="0 0 18 20" aria-hidden="true"><rect x="1" y="1" width="16" height="12" rx="3" fill="#fff" stroke="#a89878"/><path d="M6 12.5h6L9 17z" fill="#fff" stroke="#a89878"/><rect x="5" y="4" width="8" height="4" rx="1" fill="#2b2219"/><rect x="3.5" y="10" width="11" height="1.6" fill="#4f6d9a"/></svg>Brand logo from 1:20,000 (bar and point show the class)</div>` : ""}
         <div>${dot("transparent", "box-shadow:0 0 0 3px #e0a82e")}Owner portfolio or selected property</div>
         <div>${dot("#e8c46a", "border-radius:1px")}Zoomed out: property counts (number on cells with 100 or more)</div>
         <div class="hd">Other layers</div>
         <div>${dot("#fff", "border-radius:1px;transform:rotate(45deg);border:1.5px solid #2b2219;width:9px;height:9px")}Crexi listing</div>` +
        (L.pipeline ? Object.entries(PIPE_STATUS).map(([s, c]) => `<div>${dot("transparent", `border-radius:1px;border:2.4px solid ${c}`)}Pipeline: ${s}</div>`).join("") +
          `<div>${dot("transparent", "border:1.5px solid #5f6e83")}Pipeline, approximate pin (circle)</div>` : "") +
        (L.comps ? `<div><span class="swatch tri" style="margin-right:6px;display:inline-block"></span>Recent sale, price published</div>
          <div><span class="swatch tri" style="margin-right:6px;display:inline-block;border-bottom-color:#9aa0a8"></span>Recent sale, price not published</div>` : "") +
        (L.traffic ? `<div>${dot("#5a6473", "width:7px;height:7px")}Traffic count (AADT)</div>` : "") +
        (HAS.leases ? `<div>${dot("#fff", "border:1.8px solid #14786e;width:8px;height:8px")}Retail space for lease (Crexi)</div><div>${dot("#fff", "border:1.8px solid #785a1e;width:8px;height:8px")}Industrial space for lease (Crexi)</div>` : "") +
        (HAS.rentguide ? `<div class="hd">Rent Guide, retail asking $/SF/yr</div>` + RENT_STOPS.map(([lo, hi, c]) => `<div>${dot(`rgb(${c.join(",")})`, "border-radius:1px")}${hi > 900 ? `$${lo}+` : `$${lo} to $${hi}`}</div>`).join("") : "") +
        `<div>${dot("transparent", "border-radius:2px;border:2px solid #8a7f6e")}County line</div>`;
      return box;
    }

    // nearest Crexi listing within 250 m; "hit" only when the street numbers match (or no number and within 40 m)
    const meters = (p1, p2) => {   // great-circle distance between two points in any spatial reference
      const R = 6371008, t = Math.PI / 180, la1 = p1.latitude * t, la2 = p2.latitude * t, dl = (p2.longitude - p1.longitude) * t, dp = la2 - la1;
      return 2 * R * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dl / 2) ** 2));
    };
    async function matchListing(a, g) {
      if (!(a.listed === "Yes" || a.listed === "Under contract") || !listQ || !g) return null;
      const num = (t) => { const m = /^\s*(\d+)/.exec(t || ""); return m ? m[1] : null; };
      const r = await listQ.queryFeatures({ geometry: g, distance: 250, units: "meters", spatialRelationship: "intersects", outFields: ["url", "address"], returnGeometry: true, num: 20 });
      const fs = r.features.filter((f) => f.attributes.url && /^https:\/\/(www\.)?crexi\.com\//.test(f.attributes.url))
        .map((f) => ({ f, d: meters(g, f.geometry) })).sort((x, y) => x.d - y.d);
      if (!fs.length) return null;
      const mine = num(a.site_address);
      return { hit: fs.find((x) => mine ? num(x.f.attributes.address) === mine : x.d <= 40) || null, near: fs[0] };
    }
    // ---------------------------------------------------------------- site sheet (print view)
    async function siteSheet(a, g) {
      const w = window.open("", "_blank");
      if (!w) { toast("Allow pop-ups to open the site sheet."); return; }
      w.document.write("<p style='font-family:sans-serif'>Preparing the site sheet...</p>");
      let img = "";
      const before = view.viewpoint && view.viewpoint.clone();
      const ringG = new Graphic({ geometry: g, symbol: { type: "simple-marker", size: 18, color: [0, 0, 0, 0], outline: { color: [...GOLD, 1], width: 3.5 } } });
      const lst = await matchListing(a, g).catch(() => null);
      try {
        markLayer.add(ringG);
        view.closePopup();
        await view.goTo({ target: g, scale: 4000 }, { animate: false });
        await new Promise((r) => setTimeout(r, 1200));
        img = (await view.takeScreenshot({ format: "png", width: 1000, height: 560 })).dataUrl;
      } catch (e) { console.warn("screenshot", e); }
      markLayer.remove(ringG);
      // back to where the broker was, with the card open again
      try { if (before) await view.goTo(before, { animate: false }); } catch (e) { /* stay */ }
      view.openPopup({ features: [new Graphic({ geometry: g, attributes: a, popupTemplate: propTemplate })], location: g });
      const row = (k, v) => blank(v) ? "" : `<tr><td>${esc(k)}</td><td>${v}</td></tr>`;
      const c = CFG.contact || {};
      const cls = CLASS[a.asset_class], slug = logoSlug(a), lg = slug && LOGOS[slug];
      const logoUrl = lg && lg.card ? new URL(`assets/logos/${lg.card}`, location.href).href : "";
      const today = new Date(), todayTxt = `${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;
      const stat = (k, v, note) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v || "<span class='na'>Not recorded</span>"}</div>${note ? `<div class="n">${esc(note)}</div>` : ""}</div>`;
      const listedTxt = lst && lst.hit ? (a.listed === "Under contract" ? "Under contract" : "Listed for sale") : "";
      const saleNote = has("sale_price") && a.last_sale_date ? (blank(a.sale_price) || a.sale_price <= 0 ? "Price not published" : moneyShort(a.sale_price)) : "";
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Site sheet, ${esc(titleCase(a.name || a.brand) || siteLine(a))}</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"><style>
        *{box-sizing:border-box} body{font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#241c14;margin:0;background:#efe8da;-webkit-font-smoothing:antialiased}
        .page{width:8.5in;min-height:11in;margin:24px auto;background:#fff;padding:0.5in 0.55in 0.45in;box-shadow:0 8px 30px rgba(43,34,25,.18);display:flex;flex-direction:column}
        .top{display:flex;justify-content:space-between;align-items:center;padding-bottom:9px;font-size:10.5px;color:#5e5140;letter-spacing:.06em;text-transform:uppercase;font-weight:600;
          border-bottom:2px solid transparent;border-image:linear-gradient(90deg,#2b2219,#c48a17 40%,#f3cf6a 55%,#c48a17 70%,#2b2219) 1}
        .top b{color:#2b2219;letter-spacing:-.01em;text-transform:none;font-size:15px;font-weight:800;display:flex;align-items:center;gap:8px} .top b span{color:#9c6d12}
        .head{display:flex;gap:16px;align-items:center;margin:16px 0 12px}
        .logo{height:64px;min-width:64px;max-width:190px;border:1px solid #e4d9c3;border-radius:8px;display:grid;place-items:center;padding:8px 12px;flex:0 0 auto}
        .logo img{max-height:46px;max-width:166px;display:block} .logo.ph{width:64px;border:0}
        h1{font-size:23px;line-height:1.2;margin:0;color:#15110d;letter-spacing:-.01em}
        .addr{color:#5e5140;font-size:13px;margin-top:3px} .chips{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
        .chip{font-size:10.5px;font-weight:600;border-radius:99px;padding:2px 9px;background:#f6efe0;color:#2b2219;border:1px solid #eadfc8}
        .chip.cls{color:#fff;border-color:transparent} .chip.listed{background:#fff6d6;color:#6b4f00;border-color:#e6c255}
        .stats{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #e4d9c3;border-radius:8px;margin:4px 0 12px;overflow:hidden}
        .stat{padding:8px 10px;border-right:1px solid #e4d9c3} .stat:last-child{border-right:0}
        .stat .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:#6f6250;font-weight:700} .stat .v{font-size:15px;font-weight:700;color:#2b2219;margin-top:2px;font-variant-numeric:tabular-nums}
        .stat .n{font-size:9.5px;color:#6f6250;margin-top:1px} .na{font-size:11px;font-weight:500;color:#6f6250}
        .map{width:100%;height:3.05in;object-fit:cover;border-radius:8px;border:1px solid #e4d9c3;display:block}
        .cap{font-size:9.5px;color:#6f6250;margin:4px 0 10px}
        .cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}
        h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6f6250;margin:10px 0 4px;display:flex;gap:8px;align-items:center}
        h2::after{content:"";flex:1;height:1px;background:#e4d9c3} h2:first-child{margin-top:0}
        table{border-collapse:collapse;width:100%;font-size:11.5px} td{padding:4px 0;border-bottom:1px solid #f1e8d6;vertical-align:top}
        td:first-child{color:#5e5140;width:42%;padding-right:8px} td:last-child{font-weight:500} tr:last-child td{border-bottom:0}
        .est{color:#6f6250;font-size:10px;font-weight:400}
        .foot{margin-top:auto;padding-top:10px;border-top:1px solid #e4d9c3;font-size:9.5px;color:#5e5140;line-height:1.5;display:flex;justify-content:space-between;gap:18px}
        .foot .who{text-align:right;white-space:nowrap} .foot .who b{color:#2b2219;font-size:10.5px}
        .bar{position:sticky;top:0;background:#1f1912;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;font-size:13px;z-index:2}
        .bar button{padding:8px 16px;border:0;background:#e0a82e;color:#15110d;border-radius:8px;cursor:pointer;font:inherit;font-weight:700}
        @page{size:letter;margin:0} @media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;width:auto;min-height:10.9in}}</style></head><body>
        <div class="bar"><span>Site sheet: one page, letter size</span><button onclick="window.print()">Print or save as PDF</button></div>
        <div class="page">
        <div class="top"><b><svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="sgNug" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7dc84"/><stop offset=".55" stop-color="#e0a82e"/><stop offset="1" stop-color="#9c6d12"/></linearGradient></defs><path d="M9.5 27 L24.6 9.4" stroke="#9a7444" stroke-width="2.6" stroke-linecap="round"/><path d="M18.6 5 Q27 6.4 29.8 14.6" stroke="#6f6250" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M3.6 25.6 L7 20.5 L12.6 19.3 L16.6 22.4 L15.6 27.6 L9.8 29.4 L5 28.5 Z" fill="url(#sgNug)" stroke="#7a5200" stroke-width=".9" stroke-linejoin="round"/></svg>${esc(CFG.title || "Gerard's Gold Mine").replace(/(\S+\s+\S+)$/, "<span>$1</span>")}</b><span>Site sheet, ${esc(todayTxt)}</span></div>
        <div class="head">${logoUrl ? `<div class="logo"><img src="${esc(logoUrl)}" alt="${esc(lg.brand)} logo"></div>` : `<div class="logo ph" style="background:${cls ? cls.color : "#5b6677"}">${ICON.bldg.replace("<svg ", "<svg width='32' height='32' ")}</div>`}
          <div><h1>${esc(titleCase(a.name || a.brand) || siteLine(a).split(",")[0])}</h1>
          <div class="addr">${esc(siteLine(a))}<br>${esc(countyLine(a))}</div>
          <div class="chips">${a.asset_class ? `<span class="chip cls" style="background:${cls ? cls.chip || cls.color : "#5b6677"}">${esc(a.asset_class)}</span>` : ""}${a.sub_type ? `<span class="chip">${esc(a.sub_type)}</span>` : ""}${listedTxt ? `<span class="chip listed">${listedTxt}</span>` : ""}</div></div></div>
        <div class="stats">${stat(/^estimate/i.test(a.acres_basis || "") ? "Land (est.)" : "Land", esc(ac(a.acres)))}${stat("Building (est.)", esc(sf(a.bldg_sf_est)))}${stat("Year built", esc(a.year_built || ""))}${stat("County value", esc(moneyShort(a.assessed_value)), a.assessed_basis ? basisText(a.assessed_basis) : "")}${stat("Last sale", esc(saleDate(a.last_sale_date, a.sale_date_precision, false)), saleNote)}</div>
        ${img ? `<img class="map" src="${img}" alt="Map of the site"><div class="cap">Gold ring marks the property. Basemap by Esri and partners.</div>` : ""}
        <div class="cols"><div><h2>Owner</h2><table>${row("Owner", esc(titleCase(a.owner) || a.owner_note || ""))}${row("Owner type", a.owner_type ? esc(a.owner_type) + " <span class='est'>(est.)</span>" : "")}
          ${row("Mailing address", esc([titleCase(a.mail_address), titleCase(a.mail_city), [a.mail_state, a.mail_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")))}${row("Out-of-state owner", esc(a.out_of_state))}
          ${row("Hold", blank(a.hold_years) ? "" : esc(holdText(a.hold_years)) + " <span class='est'>(est.)</span>")}${row("Properties on this map", blank(a.portfolio_count) ? "" : nf(a.portfolio_count) + " <span class='est'>(est.)</span>")}${row("Seller score", a.seller_score ? esc(a.seller_score) + " <span class='est'>(sorting aid)</span>" : "")}</table>
          ${a.tenants ? `<h2>Tenants observed</h2><table>${row("Storefronts", esc(a.tenants) + " <span class='est'>(observed, Overture Oct 2026)</span>")}</table>` : ""}</div>
          <div><h2>Property</h2><table>${row("Last sale", esc(saleText(a, true)))}${row("County use", esc(a.use_desc))}${row("Parcel number", esc(a.parcel_id))}${a.asset_class === "Net Lease" || a.asset_class === "Strip Center" ? row("Rent, lease term, cap rate", "Not public") : ""}</table>
          ${has("nearest_aadt") || has("pipeline_2mi") ? `<h2>Site</h2><table>${has("nearest_aadt") ? row("Nearest traffic count", blank(a.nearest_aadt) ? "No count within 1,500 ft" : `${nf(a.nearest_aadt)} AADT${a.aadt_year ? " (" + a.aadt_year + ")" : ""} ${esc(a.aadt_route || "")} <span class='est'>(state DOT, actual)</span>`) : ""}${has("pipeline_2mi") ? row("Pipeline within 2 mi", a.pipeline_2mi > 0 ? `${nf(a.pipeline_2mi)}: ${esc(a.pipeline_names || "")} <span class='est'>(est.)</span>` : "None") : ""}</table>` : ""}</div></div>
        <div class="foot"><div>Source: ${esc(srcName(a.source))}. Owner, mailing address, acres, value, year built and sale date are as recorded by the county (actual); items marked (est.) are derived by the map; the seller score is a sorting aid built on assumptions. Verify with county records before relying on any figure.</div>
        <div class="who">Prepared by<br><b>${esc(c.name || "")}</b><br>${esc(c.office || "")}${placeholder(c.phone) ? "" : "<br>" + esc(c.phone)}${placeholder(c.email) ? "" : "<br>" + esc(c.email)}</div></div>
        </div></body></html>`;
      w.document.open(); w.document.write(html); w.document.close();
    }

    // ---------------------------------------------------------------- call list cart (localStorage)
    const CART_KEY = "officeMap.callList.v1";
    let cart = store.get(CART_KEY, []);
    let tableRows = [], tableMode = "results", tableKind = "props", sortCol = null, sortDir = 1, resultsState = null;
    function cartHas(pid) { return cart.some((x) => x.pid === pid); }
    function celebrate() {
      const b = $("cartBtn");
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = $("cartCount").getBoundingClientRect();
      for (let i = 0; i < 7; i++) {
        const sp = el("span", { class: "sparkle" }), ang = (Math.PI * 2 * i) / 7, d = 16 + (i % 3) * 6;
        sp.style.left = `${r.left + r.width / 2}px`; sp.style.top = `${r.top + r.height / 2}px`;
        sp.style.setProperty("--dx", `${Math.cos(ang) * d}px`); sp.style.setProperty("--dy", `${Math.sin(ang) * d}px`);
        document.body.appendChild(sp); setTimeout(() => sp.remove(), 800);
      }
    }
    function cartSave() {
      store.set(CART_KEY, cart);
      $("cartCount").textContent = cart.length; $("cartCount2").textContent = cart.length;
      if (tableMode === "cart" && !$("drawer").hidden) showCart();
    }
    function cartToggle(a, g, onChange) {
      if (cartHas(a.pid)) {
        const i = cart.findIndex((x) => x.pid === a.pid), removed = cart[i];
        cart = cart.filter((x) => x.pid !== a.pid);
        toast("Removed from the call list.", 0, { label: "Undo", fn: () => { if (!cartHas(removed.pid)) { cart.splice(Math.min(i, cart.length), 0, removed); cartSave(); if (onChange) onChange(); } } });
      } else {
        const rec = { ...a }; delete rec.OBJECTID; delete rec.src_row;
        rec._lat = g && g.latitude != null ? +g.latitude.toFixed(6) : null; rec._lon = g && g.longitude != null ? +g.longitude.toFixed(6) : null;
        rec._added = new Date().toISOString().slice(0, 10);
        cart.push(rec); toast(`Nice find. Added to the call list (${cart.length}).`);
        celebrate();
        // a card or search result can carry only some fields: fill the saved row from the full record
        if (a.pid && propsQ.fields.some((f) => f.name !== "OBJECTID" && f.name !== "src_row" && !(f.name in a))) {
          propsQ.queryFeatures({ where: `pid = ${sq(a.pid)}`, outFields: ["*"], returnGeometry: false, num: 1 }).then((r) => {
            const full = r.features[0] && r.features[0].attributes, k = cart.findIndex((x) => x.pid === a.pid);
            if (full && k > -1) { const x = { ...full, _lat: cart[k]._lat, _lon: cart[k]._lon, _added: cart[k]._added }; delete x.OBJECTID; delete x.src_row; cart[k] = x; cartSave(); }
          }).catch(() => {});
        }
      }
      cartSave();
    }

    // ---------------------------------------------------------------- results drawer under the map
    const COLS = [
      ["name", "Name", "open"], ["asset_class", "Class"], ["site_address", "Address"], ["county", "County"], ["state", "St"],
      ["owner", "Owner"], ["owner_type", "Owner type"], ["out_of_state", "Out of state"], ["hold_years", "Hold, yr (est.)", 1], ["seller_score", "Score"],
      ["bldg_sf_est", "Building SF (est.)", 0], ["acres", "Acres", 2], ["listed", "Listed"]
    ];
    const COMP_COLS = [
      ["site_address", "Address", "open"], ["last_sale_date", "Sale date"], ["asset_class", "Class"], ["sub_type", "Sub type"], ["county", "County"],
      ["state", "St"], ["sale_price", "Price", "$"], ["price_basis", "Price basis"], ["ppsf_est", "$/SF (est.)", "$"], ["buyer", "Buyer (owner of record)"],
      ["bldg_sf_est", "Building SF (est.)", 0], ["acres", "Acres", 2]
    ];
    // on desktop the drawer covers the bottom of the map: pad the view so popups, zooms and the map UI stay in the visible part
    // the drawer lifts the map controls (ui padding) but not the map itself, so the docked card keeps its full height;
    // drawerH() is used to keep a selected point above the drawer
    const drawerH = () => !phone() && !$("drawer").hidden ? $("drawer").offsetHeight : 0;
    function padForDrawer() { view.ui.padding = { top: 15, left: 15, right: 15, bottom: 15 + drawerH() }; }
    function openDrawer() { $("drawer").hidden = false; if (phone()) setSheet("peek"); padForDrawer(); }
    $("drawerClose").onclick = () => { $("drawer").hidden = true; padForDrawer(); };
    window.addEventListener("resize", padForDrawer);
    $("cartBtn").onclick = () => { showCart(); openDrawer(); };
    $("segCart").onclick = showCart;
    $("segResults").onclick = () => { tableMode = "results"; renderTable(); };
    $("cartClear").onclick = () => { if (cart.length && confirm(`Clear all ${cart.length} properties from the call list?`)) { cart = []; cartSave(); } };
    function showCart() {
      tableMode = "cart"; tableKind = "props";
      $("segCart").classList.add("on"); $("segResults").classList.remove("on"); $("cartClear").hidden = !cart.length;
      $("resultsTitle").textContent = "Call list";
      setNote(cart.length ? `${cart.length} saved on this browser` : "Empty. Add properties from a card or a table row.", "");
      $("resultsExport").disabled = !cart.length;
      $("resultsExport").textContent = `Export call list (${cart.length})`;
      drawTable(cart.map((r) => ({ attributes: r, geometry: null })));
    }
    function setNote(txt, tip) {   // one line; the longer rules sit in the tooltip of the (i) mark
      const n = $("resultsNote"); n.textContent = txt || ""; n.title = tip || "";
      let d = $("resultsInfo");
      if (!d) { d = el("span", { id: "resultsInfo", class: "info-dot", text: "i", tabindex: "0" }); n.after(d); }
      d.hidden = !tip; d.title = tip || ""; d.setAttribute("aria-label", tip || "");
    }
    function fillTable(feats, title, note, spec, tip) {
      resultsState = { feats, title, note, spec, tip };
      tableMode = "results";
      renderTable();
      openDrawer();
    }
    function renderTable() {
      $("segResults").classList.add("on"); $("segCart").classList.remove("on"); $("cartClear").hidden = true;
      if (!resultsState) { $("resultsTitle").textContent = "Results"; setNote("Use Show table, an area, or an owner's Show all.", ""); $("resultsExport").disabled = true; $("resultsExport").textContent = "Export"; drawTable([]); return; }
      tableKind = resultsState.spec.kind || "props";
      $("resultsTitle").textContent = resultsState.title; setNote(resultsState.note, resultsState.tip);
      const over = resultsState.spec.total > EXPORT_MAX;
      $("resultsExport").disabled = !resultsState.spec.total;
      $("resultsExport").textContent = "Export";
      $("resultsExport").title = over ? `Exports stop at ${nf(EXPORT_MAX)} rows; narrow the filters or draw an area.` : `Export all ${nf(resultsState.spec.total)}`;
      drawTable(resultsState.feats);
    }
    function rowName(a, key) {   // name or brand only (the address has its own column); never a raw id
      if (key === "site_address") return titleCase(a.site_address) || titleCase(a.name) || "Recorded sale";
      return titleCase(a.name || a.brand) || "";
    }
    function drawTable(feats) {
      tableRows = feats.slice();
      const cols = tableKind === "comps" ? COMP_COLS : COLS, withAdd = tableKind !== "comps";
      const head = $("resultsTable").querySelector("thead");
      head.innerHTML = "<tr>" + (withAdd ? `<th><span class="hint" style="padding:0 8px">${tableMode === "cart" ? "" : "Add"}</span></th>` : "") +
        cols.map((c, i) => `<th aria-sort="${sortCol === i ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-i="${i}">${c[1]}</button></th>`).join("") + "</tr>";
      head.querySelectorAll("th button").forEach((b) => b.onclick = async () => {
        const i = +b.dataset.i, numeric = cols[i][2] != null && cols[i][2] !== "open";
        sortDir = sortCol === i ? -sortDir : (numeric ? -1 : 1); sortCol = i;
        const k = cols[i][0];
        const spec = resultsState && resultsState.spec;
        if (tableMode === "results" && spec && spec.layer && spec.total > tableRows.length) {
          // more rows than loaded: ask the service for the first 1,000 in this order, blanks last
          setNote("Sorting...", "");
          try {
            const q = { where: `(${spec.where}) AND ${k} IS NOT NULL`, geometry: spec.geometry, spatialRelationship: "intersects" };
            const r = await spec.layer.queryFeatures({ ...q, outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference,
              orderByFields: [`${k} ${sortDir > 0 ? "ASC" : "DESC"}`, "OBJECTID"], num: 1000 });
            resultsState.feats = r.features;
            resultsState.note = `First ${nf(r.features.length)} of ${nf(spec.total)} by ${cols[i][1].replace(/ \(est\.\)/, "")}, ${sortDir > 0 ? "lowest" : "highest"} first`;
            resultsState.tip = `Blanks are left out of the sort.${exportNote(spec.total)}`;
            setNote(resultsState.note, resultsState.tip);
            drawTable(r.features);
          } catch (e) { console.warn("sort", e); setNote(resultsState.note, resultsState.tip); }
          return;
        }
        tableRows.sort((a, b2) => { const x = a.attributes[k], y = b2.attributes[k]; if (blank(x)) return 1; if (blank(y)) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
        drawTable(tableRows);
      });
      const body = $("resultsTable").querySelector("tbody");
      const cell = (c, v, f) => {
        if (c[2] === "open") { const nm = rowName(f.attributes, c[0]); return `<td class="open"><button type="button"${nm ? "" : ' class="unnamed"'}>${esc(nm || "Unnamed")}</button></td>`; }
        if (c[0] === "site_address" || c[0] === "owner" || c[0] === "buyer") return `<td>${esc(titleCase(v))}</td>`;
        if (c[0] === "county") return `<td>${esc(String(v || "").replace(/ County$/, ""))}</td>`;
        if (c[0] === "hold_years" && v > 75) return `<td class="num muted-cell" title="Likely a placeholder deed date; check the deed">over 75</td>`;
        if (c[0] === "sale_price" && blank(v)) return `<td class="num muted-cell">Not published</td>`;
        if (c[2] === "$") return `<td class="num">${blank(v) ? "" : moneyShort(v)}</td>`;
        if (c[0] === "last_sale_date") return `<td>${esc(dateShort(v))}</td>`;
        if (c[0] === "asset_class" && CLASS[v]) return `<td><span class="tcls"><i style="background:${CLASS[v].color}"></i>${esc(v)}</span></td>`;
        if (c[0] === "seller_score" && v) return `<td><span class="tscore sc-${esc(v.replace(/\s/g, ""))}" style="${{ High: "", Medium: "background:#7a6142;color:#fff", Low: "background:#efe6d3;color:#2b2219" }[v] ?? "border:1px dashed #a89878;color:#5e5140"}">${v === "High" ? ICON.nug : ""}${esc(v)}</span></td>`;
        return c[2] != null ? `<td class="num">${nf(v, c[2])}</td>` : `<td>${esc(v)}</td>`;
      };
      const ncol = cols.length + (withAdd ? 1 : 0);
      $("resultsTable").classList.toggle("rlist", phone() && tableKind === "props");
      if (!tableRows.length && (tableMode === "cart" || resultsState)) {
        head.innerHTML = phone() ? "" : head.innerHTML;
        body.innerHTML = `<tr class="empty-row"><td colspan="${ncol}">${ICON.nug.replace('class="nug"', 'class="nug-big"')}${tableMode === "cart" ? "Your call list is empty. Add properties from a card or a table row." : esc(EMPTY_COPY)}${tableMode === "cart" ? "" : '<br><button type="button" class="btn" id="emptyReset">Reset filters</button>'}</td></tr>`;
        const rb = $("emptyReset"); if (rb) rb.onclick = () => { $("resetFilters").click(); $("drawer").hidden = true; padForDrawer(); };
        return;
      }
      if (phone() && tableKind === "props") {   // two-line list: name and class, then address and owner
        head.innerHTML = "";
        body.innerHTML = tableRows.slice(0, 1000).map((f, i) => {
          const a = f.attributes, c = CLASS[a.asset_class], inCart = cartHas(a.pid), nm = rowName(a, "name");
          return `<tr data-r="${i}"><td class="add"><button type="button" class="add-btn${inCart && tableMode !== "cart" ? " in" : ""}" aria-label="${tableMode === "cart" ? "Remove from the call list" : "Add to the call list"}">${tableMode === "cart" ? "&times;" : inCart ? "&#10003;" : "+"}</button></td>
            <td class="item"><div class="l1">${c ? `<i style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${c.color}"></i>` : ""}<span class="open"><button type="button"${nm ? "" : ' class="unnamed"'}>${esc(nm || "Unnamed")}</button></span></div>
            <div class="l2">${esc(siteLine(a))}${a.owner ? " &middot; " + esc(titleCase(a.owner)) : ""}</div></td></tr>`;
        }).join("");
      } else body.innerHTML = tableRows.slice(0, 1000).map((f, i) => {
        const inCart = cartHas(f.attributes.pid);
        const add = withAdd ? `<td class="add"><button type="button" class="add-btn${inCart ? " in" : ""}" title="${tableMode === "cart" ? "Remove from the call list" : inCart ? "On the call list" : "Add to the call list"}">${tableMode === "cart" ? "&times;" : inCart ? "&#10003;" : "+"}</button></td>` : "";
        return `<tr data-r="${i}">${add}${cols.map((c) => cell(c, f.attributes[c[0]], f)).join("")}</tr>`;
      }).join("");
      body.querySelectorAll("tr").forEach((tr) => {
        const f = tableRows[+tr.dataset.r];
        const ab = tr.querySelector(".add-btn");
        if (ab) ab.onclick = () => { cartToggle(f.attributes, f.geometry, () => { if (tableMode !== "cart") drawTable(tableRows); }); if (tableMode !== "cart") drawTable(tableRows); };
        tr.querySelector(".open button").onclick = async () => {
          let g = f;
          if (!g.geometry) {   // call list rows carry lat and lon only; fetch the live feature
            const r = await propsQ.queryFeatures({ where: `pid = ${sq(f.attributes.pid)}`, outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference, num: 1 });
            if (!r.features.length) { toast("This property is no longer on the map."); return; }
            g = r.features[0];
          }
          g.popupTemplate = tableKind === "comps" ? comps.popupTemplate : propTemplate;
          if (phone()) { $("drawer").hidden = true; padForDrawer(); }
          view.goTo({ target: g.geometry, scale: Math.min(view.scale, 6000) }).then(() => view.openPopup({ features: [g], location: g.geometry })).catch(() => {});
        };
      });
    }
    const EXPORT_MAX = CFG.exportMax || 50000;
    const exportNote = (n) => n > EXPORT_MAX ? ` Export works up to ${nf(EXPORT_MAX)} rows; narrow the filters or draw an area to export.` : ` The export has all ${nf(n)}.`;
    async function tableFromQuery(layer, where, geometry, title, label, kind) {
      const total = await layer.queryFeatureCount({ where, geometry, spatialRelationship: "intersects" });
      const q = { geometry, spatialRelationship: "intersects", outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference };
      let r;
      if (kind === "comps") r = await layer.queryFeatures({ ...q, where, orderByFields: ["last_sale_date DESC"], num: 1000 });
      else {   // by class and county; rows with a street address first, so the first rows are not the odd records
        const ADDR = "(site_address IS NOT NULL AND site_address <> '')";
        r = await layer.queryFeatures({ ...q, where: `(${where}) AND ${ADDR}`, orderByFields: ["asset_class", "county", "OBJECTID"], num: 1000 });
        if (r.features.length < 1000) {
          const r2 = await layer.queryFeatures({ ...q, where: `(${where}) AND NOT ${ADDR}`, orderByFields: ["asset_class", "county", "OBJECTID"], num: 1000 - r.features.length });
          r.features = r.features.concat(r2.features);
        }
      }
      const order = kind === "comps" ? "newest first" : "by class and county";
      sortCol = null;
      fillTable(r.features, title, total > 1000 ? `1,000 of ${nf(total)} shown, ${order}` : `${nf(total)}, ${order}`,
        { layer, where, geometry, label, kind, total }, total > 1000 ? `Sort any column to fetch the top 1,000 by it.${exportNote(total)}` : exportNote(total).trim());
    }
    $("showTable").onclick = () => tableFromQuery(propsQ, filterWhere(), null, "Properties that match the filters", "filtered", "props");
    $("exportProps").onclick = async () => {
      const n = lastCount == null ? await propsQ.queryFeatureCount({ where: filterWhere() }) : lastCount;
      if (n > EXPORT_MAX) {
        const inView = await propsQ.queryFeatureCount({ where: filterWhere(), geometry: view.extent, spatialRelationship: "intersects" });
        toast(`${nf(n)} match. Exports stop at ${nf(EXPORT_MAX)} rows; pick a state or county, draw an area, or export what is in view.`, 9000,
          inView > 0 && inView <= EXPORT_MAX ? { label: `Export ${nf(inView)} in view`, fn: () => exportCsv(propsQ, filterWhere(), view.extent.clone(), "properties in view") } : null);
        return;
      }
      exportCsv(propsQ, filterWhere(), null, "filtered properties");
    };
    $("resultsExport").onclick = () => tableMode === "cart" ? exportCart() : resultsState && exportCsv(resultsState.spec.layer, resultsState.spec.where, resultsState.spec.geometry, resultsState.spec.label);
    cartSave();

    // ---------------------------------------------------------------- owner portfolio
    function extentOf(feats) {
      const xs = feats.map((f) => f.geometry.x), ys = feats.map((f) => f.geometry.y), pad = feats.length > 1 ? 0 : 300;
      return new Extent({ xmin: Math.min(...xs) - pad, ymin: Math.min(...ys) - pad, xmax: Math.max(...xs) + pad, ymax: Math.max(...ys) + pad,
        spatialReference: feats[0].geometry.spatialReference }).expand(1.4);
    }
    async function showPortfolio(owner, o) {
      o = o || {};
      const where = `${ownerField} = ${sq(owner)}`;
      const [total, r] = await Promise.all([propsQ.queryFeatureCount({ where }),
        propsQ.queryFeatures({ where, outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference, num: 2000 })]);
      if (!total) return [];   // not an owner name: leave the map and the drawer alone
      markLayer.removeAll();
      markLayer.addMany(r.features.map((f) => new Graphic({ geometry: f.geometry, symbol: { type: "simple-marker", size: 20, color: [224, 168, 46, 0.25], outline: { color: [224, 168, 46, 1], width: 3.5 } } })));
      $("portfolioBar").hidden = false; $("portfolioName").textContent = owner; $("portfolioCount").textContent = nf(total) + (total === 1 ? " property" : " properties");
      fillTable(r.features, `Portfolio: ${titleCase(owner)}`, `${nf(total)} under this owner name${total > r.features.length ? `, first ${nf(r.features.length)} shown` : ""}`,
        { layer: propsQ, where, geometry: null, label: "owner portfolio", kind: "props", total }, "Filters are ignored for a portfolio.");
      if (o.zoom !== false && r.features.length) view.goTo(fitAboveDrawer(extentOf(r.features))).catch(() => {});
      return r.features;
    }
    // stretch an extent downward so its features land above the open drawer
    function fitAboveDrawer(ext) {
      const dh = drawerH(), H = view.height;
      if (!dh || dh >= H - 80) return ext;
      const e = ext.clone(), extra = (e.ymax - e.ymin) * dh / (H - dh);
      e.ymin -= extra;
      return e;
    }
    async function openPortfolio(owner) {
      if (!owner) return;
      view.closePopup();
      const feats = await showPortfolio(owner);
      toast(`${nf(feats.length)} properties for ${titleCase(owner)}`);
    }
    $("clearPortfolio").onclick = () => {
      markLayer.removeAll(); $("portfolioBar").hidden = true;
      if (resultsState && resultsState.spec.label === "owner portfolio") { resultsState = null; if (!$("drawer").hidden && tableMode === "results") { $("drawer").hidden = true; padForDrawer(); } }
    };

    // ---------------------------------------------------------------- search
    const ownerSource = new SearchSource({
      name: "Owners (portfolio)", placeholder: "Owner name", maxSuggestions: 6, popupEnabled: false, resultGraphicEnabled: false,
      getSuggestions: async (p) => {
        const t = (p.suggestTerm || "").trim().toUpperCase();
        if (t.length < 3) return [];
        const r = await propsQ.queryFeatures({ where: `UPPER(${ownerField}) LIKE ${sq("%" + t + "%")}`, outFields: [ownerField], returnDistinctValues: true,
          returnGeometry: false, num: 6, orderByFields: [ownerField] });
        return r.features.map((f) => ({ key: f.attributes[ownerField], text: f.attributes[ownerField], sourceIndex: p.sourceIndex }));
      },
      getResults: async (p) => {
        // only a picked owner suggestion, or Enter on an exact owner name, opens a portfolio
        let name = p.suggestResult && p.suggestResult.key;
        if (!name) {
          const t = String((p.suggestResult && p.suggestResult.text) || p.searchTerm || "").trim().toUpperCase();
          if (t.length < 3) return [];
          const r = await propsQ.queryFeatures({ where: `UPPER(${ownerField}) = ${sq(t)}`, outFields: [ownerField], returnGeometry: false, num: 1 });
          if (!r.features.length) return [];
          name = r.features[0].attributes[ownerField];
        }
        const feats = await showPortfolio(name, { zoom: false });
        if (!feats.length) return [];
        const ext = fitAboveDrawer(extentOf(feats));
        return [{ extent: ext, feature: new Graphic({ geometry: ext.center, attributes: { name } }), name }];
      }
    });
    // properties: suggestions read "Dollar General, 221 Heathway Dr, Charlotte, NC" (title case, state once)
    const propSource = new SearchSource({
      name: "Properties", placeholder: "Address, center or brand", maxSuggestions: 6, popupTemplate: propTemplate, zoomScale: 4000,
      getSuggestions: async (p) => {
        const t = (p.suggestTerm || "").trim().toUpperCase().replace(/'/g, "''");
        if (t.length < 3) return [];
        const like = (f) => `UPPER(${f}) LIKE '%${t}%'`;
        const r = await propsQ.queryFeatures({ where: ["site_address", "name", "brand"].filter(has).map(like).join(" OR "), outFields: ["OBJECTID", "name", "brand", "site_address", "site_city", "site_zip", "state"],
          returnGeometry: false, num: 6, orderByFields: ["name"] });
        return r.features.map((f) => { const a = f.attributes, nm = titleCase(a.name || a.brand); return { key: a.OBJECTID, text: nm ? `${nm}, ${siteLine(a)}` : siteLine(a), sourceIndex: p.sourceIndex }; });
      },
      getResults: async (p) => {
        const key = p.suggestResult && p.suggestResult.key;
        if (key == null) return [];
        const r = await propsQ.queryFeatures({ objectIds: [key], outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference });
        return r.features.map((g) => { g.popupTemplate = propTemplate; return { extent: null, feature: g, name: p.suggestResult.text, target: g }; });
      }
    });
    new Search({
      view, container: "searchSlot", includeDefaultSources: false, allPlaceholder: "Address, owner or brand",
      popupEnabled: true, resultGraphicEnabled: false, maxSuggestions: 6, minSuggestCharacters: 3,
      sources: [
        propSource,
        ownerSource,
        listQ && { layer: listQ, name: "Crexi listings", placeholder: "Listing title or address", searchFields: ["title", "address"], displayField: "title",
          suggestionTemplate: "{title}, {city}", exactMatch: false, outFields: ["*"], popupTemplate: listings.popupTemplate, zoomScale: 4000, maxSuggestions: 4 },
        { url: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer", name: "Address", singleLineFieldName: "SingleLine",
          placeholder: "Street address or place", countryCode: "USA", maxSuggestions: 4, zoomScale: 6000, popupEnabled: false, resultGraphicEnabled: false,
          filter: { geometry: new Extent({ xmin: -84.5, ymin: 31.9, xmax: -75.2, ymax: 39.6, spatialReference: { wkid: 4326 } }) } }
      ].filter(Boolean)
    });

    // ---------------------------------------------------------------- CSV export
    function csvCell(v) {
      if (v == null) return "";
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // keep spreadsheet formulas from running
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }
    function download(lines, label) {
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${CFG.title} ${label} ${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`Exported ${nf(lines.length - 1)} rows.`);
    }
    const exportFields = (layer) => (layer || propsQ).fields.filter((f) => f.type !== "oid" && !/^Shape__/.test(f.name) && f.name !== "src_row");
    async function exportCsv(layer, where, geometry, label) {
      if (!layer) return;
      const total = await layer.queryFeatureCount({ where, geometry, spatialRelationship: "intersects" });
      const max = CFG.exportMax || 50000;
      if (!total) { toast("Nothing to export with these filters."); return; }
      if (total > max) { toast(`${nf(total)} rows is over the ${nf(max)} export limit. Narrow the filters or draw an area.`, 6000); return; }
      const fields = exportFields(layer);
      const lines = [fields.map((f) => csvCell(f.alias || f.name)).concat(["Latitude", "Longitude"]).join(",")];
      const page = Math.min((layer.capabilities && layer.capabilities.query.maxRecordCount) || 2000, 4000);
      for (let start = 0; start < total; start += page) {
        toast(`Exporting ${nf(Math.min(start + page, total))} of ${nf(total)}...`, 20000);
        const r = await layer.queryFeatures({ where, geometry, spatialRelationship: "intersects", outFields: ["*"], returnGeometry: true,
          outSpatialReference: { wkid: 4326 }, orderByFields: ["OBJECTID"], start, num: page });
        r.features.forEach((f) => lines.push(fields.map((fd) => csvCell(f.attributes[fd.name])).concat([f.geometry ? f.geometry.y.toFixed(6) : "", f.geometry ? f.geometry.x.toFixed(6) : ""]).join(",")));
      }
      download(lines, label);
    }
    function exportCart() {
      if (!cart.length) return;
      const fields = exportFields(propsQ);
      const lines = [fields.map((f) => csvCell(f.alias || f.name)).concat(["Latitude", "Longitude", "Added"]).join(",")];
      cart.forEach((r) => lines.push(fields.map((f) => csvCell(r[f.name])).concat([r._lat, r._lon, r._added]).join(",")));
      download(lines, "call list");
    }

    // ---------------------------------------------------------------- area tools
    const sketch = new SketchViewModel({ view, layer: areaLayer, updateOnGraphicClick: false,
      polygonSymbol: { type: "simple-fill", color: [224, 168, 46, 0.12], outline: { color: [...NAVY, 1], width: 2, style: "dash" } } });
    function drawing(on) { view.popupEnabled = !on; if (on) view.closePopup(); }   // popups would swallow the taps that place vertices
    function disarm() { radiusArmed = false; $("drawRadius").classList.remove("armed"); drawing(false); }
    function clearArea() { areaGeom = null; areaLayer.removeAll(); $("areaStats").innerHTML = ""; $("areaStatus").textContent = ""; $("areaActions").hidden = true; $("finishShape").hidden = true; disarm(); sketch.cancel(); }
    function setArea(geom) {
      areaGeom = geom;
      areaLayer.removeAll();
      areaLayer.add(new Graphic({ geometry: geom, symbol: sketch.polygonSymbol }));
      runAreaStats();
    }
    $("drawPolygon").onclick = () => { clearArea(); $("areaStatus").textContent = "Tap points on the map, then Finish shape (or double-tap)."; $("finishShape").hidden = false; drawing(true); sketch.create("polygon", { mode: "click" }); toPeek(); };
    $("drawCircle").onclick = () => { clearArea(); $("areaStatus").textContent = "Press and drag on the map to draw a circle."; drawing(true); sketch.create("circle"); toPeek(); };
    $("drawRadius").onclick = () => { clearArea(); radiusArmed = true; drawing(true); $("drawRadius").classList.add("armed"); $("areaStatus").textContent = "Tap the map to set the center."; toPeek(); };
    $("finishShape").onclick = () => sketch.complete();
    $("clearArea").onclick = clearArea;
    sketch.on("create", (e) => {
      if (e.state === "complete") { drawing(false); $("finishShape").hidden = true; setArea(e.graphic.geometry); showTab("area"); }
      if (e.state === "cancel") { drawing(false); $("finishShape").hidden = true; }
    });
    view.on("click", (e) => {
      if (!radiusArmed) { if (phone() && !sketch.state.startsWith("active")) toPeek(); return; }
      e.stopPropagation();
      const mi = Math.max(0.1, Number($("radiusMi").value) || 3);
      disarm();
      setArea(geometryEngine.geodesicBuffer(e.mapPoint, mi, "miles"));
      showTab("area");
    });
    async function runAreaStats() {
      if (!areaGeom) return;
      $("areaStatus").textContent = "Counting...";
      const where = filterWhere(), q = { geometry: areaGeom, spatialRelationship: "intersects" };
      try {
        const [byClass, nHold, nOos, nHigh, nList, nPipe] = await Promise.all([
          propsQ.queryFeatures({ ...q, where, returnGeometry: false, groupByFieldsForStatistics: ["asset_class"],
            outStatistics: [{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }] }),
          propsQ.queryFeatureCount({ ...q, where: `(${where}) AND hold_years >= ${HOLD}` }),
          propsQ.queryFeatureCount({ ...q, where: `(${where}) AND out_of_state = 'Yes'` }),
          propsQ.queryFeatureCount({ ...q, where: `(${where}) AND seller_score = 'High'` }),
          listQ ? listQ.queryFeatureCount({ ...q, where: listingWhere() }) : Promise.resolve(null),
          pipeQ ? pipeQ.queryFeatureCount({ ...q, where: listingWhere() }) : Promise.resolve(null)
        ]);
        let compLine = "";
        if (compsQ) {
          const cw = compsWhere();
          // median price per SF of priced, single-parcel sales; computed here because the SDK's percentile request is refused by the service
          const bulk = compsQ.fields.some((f) => f.name === "portfolio_sale") ? " AND (portfolio_sale IS NULL OR portfolio_sale <> 'Yes')" : "";
          const [nAll, priced] = await Promise.all([compsQ.queryFeatureCount({ ...q, where: cw }),
            compsQ.queryFeatures({ ...q, where: `(${cw}) AND price_basis = 'actual' AND ppsf_est > 0${bulk}`, outFields: ["ppsf_est"], returnGeometry: false, num: 4000 })]);
          const v = priced.features.map((f) => f.attributes.ppsf_est).sort((a, b) => a - b);
          const ma = v.length ? { n: v.length, m: v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2 } : {};
          compLine = `<tr><td>Recorded sales, last 24 months</td><td>${nf(nAll)}</td></tr>` +
            (ma.n ? `<tr><td>Median price per SF, ${nf(ma.n)} priced sales${ma.n < 5 ? '<div class="note">Too few sales to rely on</div>' : ""}</td><td>${money(ma.m)} <span class="est">(est.)</span></td></tr>` : `<tr><td>Median price per SF</td><td class="muted-cell">No priced sales in this area</td></tr>`);
          $("areaComps").hidden = !nAll;
        }
        const m = {}; byClass.features.forEach((f) => m[f.attributes.asset_class] = f.attributes.n);
        const total = Object.values(m).reduce((s, x) => s + x, 0);
        const areaMi = geometryEngine.geodesicArea(areaGeom, "square-miles");
        $("areaStatus").textContent = `Area about ${nf(areaMi, 1)} sq mi (est.). Counts use the current filters.`;
        $("areaStats").innerHTML = `<table class="stats"><tr class="total"><td>Properties</td><td>${nf(total)}</td></tr>${CLASSES.map((c) => `<tr><td><span class="swatch" style="background:${c.color}"></span> ${c.key}</td><td>${nf(m[c.key] || 0)}</td></tr>`).join("")}
          <tr><td>Held ${HOLD}+ years (est.)</td><td>${nf(nHold)}</td></tr><tr><td>Out-of-state owners</td><td>${nf(nOos)}</td></tr>
          <tr><td>Seller score High</td><td>${nf(nHigh)}</td></tr>${nList == null ? "" : `<tr><td>Crexi listings</td><td>${nf(nList)}</td></tr>`}
          ${nPipe == null ? "" : `<tr><td>Pipeline projects</td><td>${nf(nPipe)}</td></tr>`}${compLine}</table>`;
        $("areaActions").hidden = !total && $("areaComps").hidden;
        $("areaTable").hidden = !total;
      } catch (e) { console.error(e); $("areaStatus").textContent = "Count failed; try a smaller area."; }
    }
    $("areaTable").onclick = () => areaGeom && tableFromQuery(propsQ, filterWhere(), areaGeom, "Properties in the drawn area", "area properties", "props");
    $("areaComps").onclick = () => areaGeom && compsQ && tableFromQuery(compsQ, compsWhere(), areaGeom, "Recorded sales in the drawn area, last 24 months", "area recent sales", "comps");

    // ---------------------------------------------------------------- deep link to one property (?pid=), used by report emails
    if (params.get("pid")) {
      propsQ.queryFeatures({ where: `pid = ${sq(params.get("pid"))}`, outFields: ["*"], returnGeometry: true, outSpatialReference: view.spatialReference, num: 1 }).then((r) => {
        const g = r.features[0];
        if (!g) return;
        g.popupTemplate = propTemplate;
        const open = () => view.openPopup({ features: [g], location: g.geometry });
        // a shared link keeps its own center and zoom; a bare ?pid= link zooms to the property
        view.when().then(() => (params.get("c") ? Promise.resolve() : view.goTo({ target: g.geometry, scale: 4000 }))).then(open, open).catch(() => {});
      }).catch(() => {});
    }

    // ---------------------------------------------------------------- data refresh: reload instead of showing an emptied slot
    let reloading = false;
    async function checkRefresh(force) {
      if (reloading) return;
      try {
        const now = await pickSlots(set);
        const changed = Object.keys(current).some((k) => now[k] && now[k].url !== current[k]) || (force && !now.properties);
        if (changed || (!now.properties && current.properties)) {
          reloading = true;
          toast("The map data was just refreshed. Reloading.", 4000);
          setTimeout(() => location.reload(), 2500);
        }
      } catch (e) { /* offline; try later */ }
    }
    setInterval(() => { if (document.visibilityState === "visible") checkRefresh(); }, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkRefresh(); });
    props.on("layerview-create-error", () => checkRefresh(true));

    renderMethod({ propsQ, listQ, trafficQ, pipeQ, compsQ, L, extras: { leases: !!leases, rent: !!rentGuide, rings: has("ring3_pop"), costs: !!(countyQ && countyQ.fields.some((f) => f.name === "re_rate_per_100")) } });
    $("freshShort").onclick = () => showTab("about");
    window.officeMap = { view, sketch, props, listings, counties, pipeline, traffic, comps, propsQ, filterWhere, showPortfolio, exportCsv, cart: () => cart };   // console debugging
  }

  function renderContact() {
    const c = CFG.contact || {};
    const lines = [`<div class="nm">${esc(c.name)}</div>`, `<div>${esc(c.title)}</div>`, `<div>${esc(c.office)}</div>`];
    if (!placeholder(c.phone)) lines.push(`<div style="margin-top:6px"><a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a></div>`);
    if (!placeholder(c.email)) lines.push(`<div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>`);
    lines.push(`<p class="hint">Maintained by ${esc(c.name)}. Send data fixes, missing properties and feature requests.</p>`);
    $("contactCard").innerHTML = lines.join("");
    if (!placeholder(CFG.reportEmail)) {
      const setHref = () => { $("reportLink").href = `mailto:${CFG.reportEmail}?subject=${encodeURIComponent(CFG.title + " data problem")}&body=${encodeURIComponent("Page: " + location.href + "\n\nWhat is wrong:\n")}`; };
      setHref();
      ["pointerdown", "focus", "click"].forEach((ev) => $("reportLink").addEventListener(ev, setHref));   // the current view, not the one at load
      $("reportLink").hidden = false;
    }
  }

  function methodExtras(x) {   // the other workstream's features: described only when they are on the map
    const parts = [];
    if (x.leases || x.rent) parts.push(`Space for lease${x.rent ? " and the Rent Guide use" : " uses"} asking rents posted on Crexi (per SF per year, as posted; not signed leases or concessions).` +
      (x.rent ? " The Rent Guide shows the median asking retail rent in cells about 4 miles across, only where a cell has 5 or more listings." : ""));
    if (x.rings) parts.push("Trade area figures add up Census ACS 5-year tracts whose center falls within 3 or 5 miles (est.); ring income is the household-weighted average of tract medians. A demographic outlier flag means a tenant brand sits in a ring well outside the income band of its other stores in the three states (premium brands below their usual band, value brands above it); it reads fit, not store sales. Tenant prospects list brands whose stores usually sit in rings like this one and have no store within 3 miles.");
    if (x.costs) parts.push("County tax rates are the county levy only (city, school and district levies are extra; South Carolina shown per $100 of market value at the 6 percent commercial ratio), with revaluation years from state revenue offices; hazard risk is the FEMA National Risk Index, a proxy for insurance pressure.");
    parts.push("The NC holdings lookup on a card asks NC OneMap live for every parcel under the exact owner name.");
    return `<p><b>${x.leases || x.rent || x.rings || x.costs ? "Rents, trade areas and costs" : "NC holdings lookup"}.</b> ${parts.join(" ")}</p>`;
  }
  async function renderMethod(ctx) {
    let srcRows = "", minAadt = null;
    const fresh = [], short = [];
    const stat = (layer, field, type) => layer.queryFeatures({ where: "1=1", returnGeometry: false,
      outStatistics: [{ statisticType: type, onStatisticField: field, outStatisticFieldName: "v" }, { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }] })
      .then((r) => r.features[0] ? r.features[0].attributes : {});
    try {
      const r = await ctx.propsQ.queryFeatures({ where: "1=1", returnGeometry: false, groupByFieldsForStatistics: ["state", "source"], orderByFields: ["state", "source"],
        outStatistics: [{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }] });
      srcRows = r.features.map((f) => `<tr><td>${esc(f.attributes.state)}</td><td>${esc(srcName(f.attributes.source))}</td><td>${nf(f.attributes.n)}</td></tr>`).join("");
      const bySrc = [...new Set(r.features.map((f) => srcName(f.attributes.source)).filter(Boolean))];
      if (bySrc.length) fresh.push(`Parcels: ${bySrc.join("; ")}`);
      if (ctx.L.properties.published) short.push(`Parcels published ${dateShort(ctx.L.properties.published)}`);
      if (ctx.listQ) { const a = await stat(ctx.listQ, "scraped_date", "max"); if (a.v) { fresh.push(`Listings: Crexi, ${dateLong(a.v)}`); short.push(`listings ${dateLong(a.v).replace(/, \d{4}$/, "")}`); } }
      if (ctx.trafficQ) {
        const t = await ctx.trafficQ.queryFeatures({ where: "1=1", returnGeometry: false, groupByFieldsForStatistics: ["source"],
          outStatistics: [{ statisticType: "max", onStatisticField: "year", outStatisticFieldName: "y" }] });
        if (t.features.length) fresh.push("Traffic: " + t.features.map((f) => `${f.attributes.source}, counts to ${f.attributes.y || ""}`).join("; "));
        minAadt = (await stat(ctx.trafficQ, "aadt", "min")).v;
      }
      if (ctx.pipeQ) { const a = await stat(ctx.pipeQ, "as_of_date", "max"); if (a.v) fresh.push(`Pipeline: as of ${dateLong(a.v)}`); }
      if (ctx.compsQ) { const a = await stat(ctx.compsQ, "last_sale_date", "max"); if (a.v) fresh.push(`Recorded sales: through ${dateLong(a.v)}`); }
    } catch (e) { console.warn("method stats", e); }
    if (CFG.freshnessNote) fresh.unshift(CFG.freshnessNote);
    $("freshAbout").innerHTML = fresh.length ? `<ul class="fresh-list">${fresh.map((f) => { const i = f.indexOf(":"); return i > 0 ? `<li><b>${esc(f.slice(0, i))}</b>${esc(f.slice(i))}</li>` : `<li>${esc(f)}</li>`; }).join("")}</ul>` : "";
    $("freshShort").textContent = short.length ? short.join(", ") + ". Sources and method" : "";
    $("methodText").innerHTML = `
      <p><b>What is here.</b> Commercial properties in Virginia, North Carolina and South Carolina in four classes (industrial, hospitality, single tenant net lease and strip centers), with current Crexi listings, recent recorded sales, development projects, traffic counts and county context. Every number says where it came from: county or state record (actual), worked out by this map (est.), or a rule we chose (assumption).</p>
      <p><b>How a property gets its class.</b> A set of rules reads the county use code, the building size from footprints and the businesses on the parcel from Overture Maps, an open map of businesses. Each property shows the rule that placed it. ${esc(CFG.handCheck || "")}</p>
      <p><b>Owners and the seller score.</b> Owner names and mailing addresses come from the county. Hold years count from the last recorded transfer (est.). The seller score (High, Medium, Low, or Not scored when the inputs are missing) is a sorting aid built on assumptions: long hold (${HOLD}+ years), a person, trust or estate as owner, an out-of-state mailing address and an older building. It is not a prediction. Street lines are left off for owners who are people or trusts; city, state and ZIP stay.</p>
      <p><b>Listings, sales, projects and traffic.</b> Listings are facts as posted on Crexi with a link back; asking prices and cap rates are asking figures. Recorded sales show the price only where the county publishes it (North Carolina does not). Development projects come from public announcements and planning records; a circle means the pin is approximate. Traffic counts are state DOT annual counts${minAadt ? `; the layer shows stations with ${nf(minAadt)} or more vehicles a day, and every property carries its nearest count within 1,500 ft` : ""}. Tenants are storefronts observed in Overture Maps, not a rent roll; rents, lease terms, closed cap rates and vacancy are not public.</p>
      ${methodExtras(ctx.extras || {})}
      <p><b>Use with care.</b> Public records lag and contain errors. Verify ownership, sale and size facts with the county before relying on them, and use Report a data problem when something is wrong.</p>
      ${srcRows ? `<table><tr><th>State</th><th>Parcel source</th><th>Properties</th></tr>${srcRows}</table>` : ""}
      <p class="hint">Area counts include properties whose point falls inside the drawn shape; square mileage is an estimate. Street View and Google Maps open in a new tab from the coordinates. Basemap and address search by Esri; map data from Esri, OpenStreetMap contributors and partners as credited on the map.</p>`;
  }

  init().catch((e) => { console.error(e); $("matchLabel").textContent = NO_DATA; $("loadingText").textContent = NO_DATA; toast(NO_DATA, 10000); });
});
