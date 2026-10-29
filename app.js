/* Charlotte Office Map. ArcGIS Maps SDK for JavaScript 4.34 (AMD build from js.arcgis.com).
   Data: hosted feature layers listed in layers.js (two slots per layer; the newest ready slot is used).
   On localhost only, layers-staging.js (with ?env=staging) and the publish script's dev proxy
   (python scripts/publish_esri.py --env staging --serve 8765) are used, so private services can be tested without signing in. */
require([
  "esri/config", "esri/kernel", "esri/Map", "esri/views/MapView", "esri/layers/FeatureLayer", "esri/layers/GraphicsLayer", "esri/Graphic",
  "esri/widgets/Search", "esri/widgets/Search/SearchSource", "esri/widgets/BasemapToggle", "esri/widgets/Home",
  "esri/widgets/Locate", "esri/widgets/ScaleBar", "esri/widgets/Expand", "esri/widgets/Sketch/SketchViewModel", "esri/geometry/geometryEngine",
  "esri/core/urlUtils", "esri/core/reactiveUtils", "esri/request", "esri/layers/support/AggregateField", "esri/geometry/Extent"
], function (esriConfig, kernel, Map, MapView, FeatureLayer, GraphicsLayer, Graphic, Search, SearchSource, BasemapToggle, Home, Locate,
             ScaleBar, Expand, SketchViewModel, geometryEngine, urlUtils, reactiveUtils, esriRequest, AggregateField, Extent) {
  "use strict";
  const CFG = window.OFFICE_MAP_CONFIG || {};
  const HOLD = CFG.longHoldYears || 15;
  const NAVY = [20, 40, 75];
  const CLASSES = [
    { key: "Industrial", color: "#1f3a66" }, { key: "Hospitality", color: "#b5532a" },
    { key: "Net Lease", color: "#1b8a8f" }, { key: "Strip Center", color: "#d4a017", darkText: true }
  ];
  const CLASS = Object.fromEntries(CLASSES.map((c) => [c.key, c]));
  // pipeline statuses use purples and magenta, never a class color
  const PIPE_STATUS = { "Announced": "#a48fcf", "In Review": "#7e57c2", "Approved": "#5b2c8f", "Under Construction": "#c2185b", "Open": "#3b0a57" };
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
  function toast(msg, ms) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms || 4000);
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
  async function init() {
    $("appTitle").textContent = CFG.title || "Charlotte Office Map";
    $("appSubtitle").textContent = CFG.subtitle || "";
    $("sigHoldYrs").textContent = HOLD;
    $("sdkVersion").textContent = `Map software: ArcGIS Maps SDK for JavaScript ${kernel.fullVersion || kernel.version}.`;
    renderContact();
    if (phone()) setSheet("peek");

    // basemap first, so a map shows within a second even when the data is slow
    const map = new Map({ basemap: "gray-vector" });
    const view = new MapView({
      container: "viewDiv", map, center: CFG.center || [-80.84, 35.23], zoom: CFG.zoom || 9,
      constraints: { minZoom: 5, snapToZoom: false },
      highlightOptions: { color: [240, 196, 25, 1], haloOpacity: 0.95, fillOpacity: 0 },
      popup: { dockEnabled: phone(), dockOptions: { breakpoint: { width: 760, height: 560 }, buttonEnabled: false, position: "auto" },
        visibleElements: { collapseButton: false, featureNavigation: true } }
    });
    view.ui.move("zoom", "top-right");
    reactiveUtils.when(() => view.popup, (p) => { if (p.viewModel) p.viewModel.includeDefaultActions = false; }, { once: true });

    const { set, staging } = await layerSet();
    const L = set ? await pickSlots(set) : {};
    if (staging) document.title += " (staging)";
    if (!L.properties) {
      $("matchCount").textContent = ""; $("matchLabel").textContent = NO_DATA;
      document.querySelector("#tab-map").prepend(el("div", { class: "notice", text: NO_DATA }));
      return;
    }
    const current = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.url]));
    let areaGeom = null, radiusArmed = false;
    let imagery = false;

    // ---------------------------------------------------------------- layers
    const fl = (key, opts) => L[key] ? new FeatureLayer({ url: L[key].url, ...opts }) : null;
    const counties = fl("counties", {
      title: "Counties", outFields: ["county", "state"], popupTemplate: { title: "{county}, {state}", outFields: ["*"], content: countyCard },
      renderer: { type: "simple", symbol: { type: "simple-fill", color: [255, 255, 255, 0], outline: { color: [...NAVY, 0.55], width: 1 } } },
      labelingInfo: [{ labelExpressionInfo: { expression: "$feature.county" }, minScale: 2500000,
        symbol: { type: "text", color: [...NAVY, 0.85], haloColor: "white", haloSize: 1.2, font: { size: 10, weight: "bold" } } }]
    });
    const scoreSize = { type: "size", valueExpression: "Decode($feature.seller_score, 'High', 3, 'Medium', 2, 1)", valueExpressionTitle: "Seller score",
      stops: [{ value: 1, size: 6.5 }, { value: 2, size: 8.5 }, { value: 3, size: 11 }] };
    function propRenderer() {
      const ring = imagery ? [255, 255, 255, 1] : [...NAVY, 1];
      const base = (c) => ({ type: "simple-marker", size: 8, color: c.color, outline: c.darkText ? { color: [...NAVY, 0.7], width: 1 } : { color: [255, 255, 255, 0.9], width: 0.7 } });
      return {
        type: "unique-value", field: "asset_class", field2: "listed", fieldDelimiter: "|",
        uniqueValueInfos: CLASSES.flatMap((c) => [
          { value: `${c.key}|No`, label: c.key, symbol: base(c) },
          { value: `${c.key}|Yes`, label: `${c.key}, listed for sale`, symbol: { ...base(c), outline: { color: ring, width: 2.6 } } },
          { value: `${c.key}|Under contract`, label: `${c.key}, under contract`, symbol: { ...base(c), outline: { color: ring, width: 2.6 } } }]),
        defaultSymbol: { type: "simple-marker", size: 7, color: [120, 120, 120, 1], outline: { color: "white", width: 0.5 } },
        visualVariables: [scoreSize]
      };
    }
    const props = fl("properties", {
      title: "Properties", outFields: ["asset_class", "listed", "seller_score"], minScale: 0, renderer: propRenderer(),
      featureReduction: {
        type: "binning", maxScale: CFG.binsUntilScale || 1500000, fixedBinLevel: CFG.binLevel || 4,
        fields: [new AggregateField({ name: "aggregateCount", statisticType: "count" })],
        renderer: { type: "simple", symbol: { type: "simple-fill", color: [...NAVY, 0.35], outline: { color: [255, 255, 255, 0.8], width: 0.6 } },
          visualVariables: [{ type: "color", field: "aggregateCount", stops: [{ value: 1, color: [214, 224, 240, 0.75] }, { value: 50, color: [160, 182, 218, 0.8] },
            { value: 500, color: [70, 100, 150, 0.85] }, { value: 5000, color: [20, 40, 75, 0.9] }] }] },
        labelsVisible: true,
        labelingInfo: [{ deconflictionStrategy: "none", labelPlacement: "center-center", labelExpressionInfo: { expression: "Text($feature.aggregateCount, '#,###')" },
          symbol: { type: "text", color: [...NAVY, 1], font: { size: 10.5, weight: "bold" }, haloColor: [255, 255, 255, 0.95], haloSize: 1.4 } }],
        popupEnabled: true, popupTemplate: { title: "{aggregateCount} properties", content: "Zoom in to see each property." }
      }
    });
    const listings = fl("listings", {
      title: "Crexi listings", outFields: ["title", "state"], minScale: 600000, popupTemplate: { title: "{title}", outFields: ["*"], content: listingCard },
      renderer: { type: "simple", symbol: { type: "simple-marker", style: "diamond", size: 11, color: [255, 255, 255, 1], outline: { color: [...NAVY, 1], width: 1.6 } } }
    });
    const pipeline = fl("pipeline", {
      title: "Development pipeline", outFields: ["status", "confidence", "pin_precision"], minScale: 1500000,
      popupTemplate: { title: "{name}", outFields: ["*"], content: pipelineCard },
      renderer: {
        type: "unique-value", valueExpression: "$feature.status + '|' + IIf(Find('address', Lower(DefaultValue($feature.pin_precision, ''))) > -1, 'p', 'c')",
        uniqueValueInfos: Object.entries(PIPE_STATUS).flatMap(([s, c]) => [
          { value: `${s}|p`, label: s, symbol: { type: "simple-marker", style: "square", size: 12, color: [255, 255, 255, 0.2], outline: { color: c, width: 2.4 } } },
          { value: `${s}|c`, label: `${s} (approximate pin)`, symbol: { type: "simple-marker", style: "circle", size: 12, color: [255, 255, 255, 0.2], outline: { color: c, width: 1.6 } } }]),
        defaultSymbol: { type: "simple-marker", style: "square", size: 11, color: [255, 255, 255, 0.2], outline: { color: [106, 61, 154, 1], width: 2 } },
        visualVariables: [{ type: "size", valueExpression: "var c = Lower(DefaultValue($feature.confidence, '')); return IIf(Left(c, 4) == 'high', 3, IIf(Left(c, 6) == 'medium', 2, 1));",
          stops: [{ value: 1, size: 9 }, { value: 3, size: 15 }] }]
      }
    });
    const traffic = fl("traffic", {
      title: "Traffic counts", outFields: ["aadt", "year", "route"], visible: false, minScale: 150000,
      popupTemplate: { title: (f) => esc(f.graphic.attributes.route || "Traffic count"), outFields: ["*"],
        content: (f) => { const a = f.graphic.attributes; return el("div", { class: "pc" }, [kv([["AADT", `${nf(a.aadt)} vehicles a day`, "State DOT count (actual)"], ["Count year", String(a.year || "")],
          ["Source", a.source || ""]]), el("div", { class: "est", text: "Annual average daily traffic as published by the state DOT (actual)." })]); } },
      renderer: { type: "simple", symbol: { type: "simple-marker", size: 6, color: [90, 100, 115, 1], outline: { color: "white", width: 0.8 } } },
      labelingInfo: [{ minScale: 60000, labelExpressionInfo: { expression: "Text($feature.aadt, '#,###')" }, labelPlacement: "above-center",
        symbol: { type: "text", color: [60, 66, 77, 1], haloColor: "white", haloSize: 1.4, font: { size: 10, weight: "bold" } } }]
    });
    const comps = fl("comps", {
      title: "Recent sales", outFields: ["price_basis"], visible: false, minScale: 1500000,
      popupTemplate: { title: (f) => esc(f.graphic.attributes.name || f.graphic.attributes.site_address || "Recorded sale"), outFields: ["*"], content: compCard },
      renderer: { type: "unique-value", field: "price_basis",
        uniqueValueInfos: [{ value: "actual", label: "Sale with a published price", symbol: { type: "simple-marker", style: "triangle", size: 10, color: [43, 43, 43, 1], outline: { color: "white", width: 0.9 } } }],
        defaultSymbol: { type: "simple-marker", style: "triangle", size: 9, color: [255, 255, 255, 1], outline: { color: [43, 43, 43, 1], width: 1.4 } }, defaultLabel: "Sale, price not published" }
    });
    const areaLayer = new GraphicsLayer({ title: "Area", listMode: "hide" });
    const markLayer = new GraphicsLayer({ title: "Highlights", listMode: "hide" });
    map.addMany([counties, traffic, props, comps, pipeline, listings, areaLayer, markLayer].filter(Boolean));

    // unfiltered twins for queries (search, portfolio, export, tables)
    const Q = (key, of) => L[key] ? new FeatureLayer({ url: L[key].url, outFields: of || ["*"] }) : null;
    const propsQ = Q("properties"), listQ = Q("listings"), countyQ = Q("counties"), trafficQ = Q("traffic"), pipeQ = Q("pipeline"), compsQ = Q("comps");
    try { await Promise.all([propsQ, listQ, countyQ, trafficQ, pipeQ, compsQ].filter(Boolean).map((l) => l.load())); }
    catch (e) { console.error(e); $("matchLabel").textContent = NO_DATA; return; }
    const has = (f) => propsQ.fields.some((x) => x.name === f);
    const ownerField = has("owner_key") ? "owner_key" : "owner";
    const propTemplate = { title: (f) => esc(f.graphic.attributes.name || f.graphic.attributes.brand || f.graphic.attributes.site_address || "Property"), outFields: ["*"], content: propCard };
    props.popupTemplate = propTemplate; propsQ.popupTemplate = propTemplate;
    if (compsQ) compsQ.popupTemplate = comps.popupTemplate;
    if (has("nearest_aadt")) $("rowAadt").hidden = false;
    if (has("pipeline_2mi")) $("rowPipe").hidden = false;
    if (pipeline) $("rowTglPipeline").hidden = false;
    if (traffic) $("rowTglTraffic").hidden = false;
    if (comps) $("rowTglComps").hidden = false;

    view.ui.add(new Home({ view }), "top-right");
    view.ui.add(new Locate({ view, scale: 20000 }), "top-right");
    view.ui.add(new BasemapToggle({ view, nextBasemap: "hybrid" }), "bottom-right");
    view.ui.add(new ScaleBar({ view, unit: "dual" }), "bottom-left");
    view.ui.add(new Expand({ view, content: legendEl(), expandTooltip: "Legend", expanded: false, expandIcon: "legend" }), "bottom-left");
    // listed-for-sale ring: navy on the light basemap, white on imagery
    reactiveUtils.watch(() => view.map.basemap && view.map.basemap.title, () => {
      imagery = !/gray|light/i.test((view.map.basemap && (view.map.basemap.id || view.map.basemap.title)) || "");
      props.renderer = propRenderer();
    });
    // phone: a card or a tap on the map drops the sheet to its peek height
    reactiveUtils.watch(() => view.popup && view.popup.visible, (v) => { if (v) toPeek(); });
    reactiveUtils.watch(() => view.popup && view.popup.visible, (v) => { if (!v && params.get("pid")) { params.delete("pid"); saveUrl(); } });
    // selected feature highlight on the map
    let hl = null;
    reactiveUtils.watch(() => view.popup && view.popup.selectedFeature, async (g) => {
      if (hl) { hl.remove(); hl = null; }
      if (!g || !g.layer || g.layer !== props) return;
      try { const lv = await view.whenLayerView(props); hl = lv.highlight(g); } catch (e) { /* not drawn at this scale */ }
    });

    // ---------------------------------------------------------------- filters
    $("classButtons").innerHTML = CLASSES.map((c) => `<button type="button" class="cls" data-cls="${c.key}" aria-pressed="true">
      <span class="sw" style="background:${c.color}"></span><span class="nm">${c.key}</span><span class="ct" data-n="${c.key}">&nbsp;</span></button>`).join("");
    const toggleBtn = (b) => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); applyFilters(); };
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
      if (val("fCounty")) p.push(`county = ${sq(val("fCounty"))}`);
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
    function listingWhere() { return val("fState") ? `state = ${sq(val("fState"))}` : "1=1"; }
    function compsWhere() {   // recent sales follow the class buttons, state and county
      const p = [], cls = pressed(".cls").map((b) => b.dataset.cls);
      if (!cls.length) return "1=0";
      if (cls.length < CLASSES.length) p.push(`asset_class IN (${cls.map(sq).join(",")})`);
      if (val("fState")) p.push(`state = ${sq(val("fState"))}`);
      if (val("fCounty")) p.push(`county = ${sq(val("fCounty"))}`);
      return p.length ? p.join(" AND ") : "1=1";
    }
    const MORE = ["fSub", "fOwnerType", "fOwner", "fHold", "fAcMin", "fAcMax", "fSfMin", "fSfMax", "fListed", "fAadt", "fPipe"];
    function moreCount() {
      const n = MORE.filter((id) => val(id) !== "").length + (document.querySelectorAll(".fScore:checked").length ? 1 : 0);
      $("moreCount").textContent = n ? `(${n} on)` : "";
    }

    let applyTimer = null, applySeq = 0, lastCount = null;
    function applyFilters() {
      moreCount();
      clearTimeout(applyTimer);
      applyTimer = setTimeout(async () => {
        const seq = ++applySeq, where = filterWhere();
        props.definitionExpression = where === "1=1" ? null : where; props.visible = where !== "1=0";
        if (listings) { listings.definitionExpression = listingWhere() === "1=1" ? null : listingWhere(); listings.visible = $("tglListings").checked; }
        if (pipeline) { pipeline.definitionExpression = listingWhere() === "1=1" ? null : listingWhere(); pipeline.visible = $("tglPipeline").checked; }
        if (comps) { comps.definitionExpression = compsWhere() === "1=1" ? null : compsWhere(); comps.visible = $("tglComps").checked; }
        if (traffic) traffic.visible = $("tglTraffic").checked;
        if (counties) counties.visible = $("tglCounties").checked;
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
          $("matchLabel").textContent = n === 1 ? "property matches" : "properties match";
          $("exportProps").textContent = phone() ? "Export" : "Export CSV";
          $("exportProps").title = `Export the ${nf(n)} properties that match the filters`;
          document.querySelectorAll("[data-n]").forEach((s) => s.textContent = "0");
          byClass.features.forEach((f) => { const s = document.querySelector(`[data-n="${f.attributes.asset_class}"]`); if (s) s.textContent = nf(f.attributes.n); });
          if (areaGeom) runAreaStats();
        } catch (e) { console.error(e); checkRefresh(true); $("matchCount").textContent = ""; $("matchLabel").textContent = "count unavailable"; }
      }, 250);
    }
    document.querySelectorAll("#tab-map input, #tab-map select").forEach((x) => x.addEventListener(x.type === "text" || x.type === "number" ? "input" : "change", applyFilters));
    $("fState").addEventListener("change", fillCounties);
    $("resetFilters").onclick = () => {
      document.querySelectorAll("#tab-map select").forEach((s) => s.value = "");
      document.querySelectorAll("#tab-map input[type=number], #tab-map input[type=text]").forEach((i) => i.value = "");
      document.querySelectorAll(".fScore").forEach((i) => i.checked = false);
      document.querySelectorAll(".cls").forEach((b) => b.setAttribute("aria-pressed", "true"));
      document.querySelectorAll(".sig").forEach((b) => b.setAttribute("aria-pressed", "false"));
      fillCounties(); applyFilters();
    };

    // ---------------------------------------------------------------- shareable URL: view, classes, every filter and the layer toggles
    const LYR = { l: "tglListings", p: "tglPipeline", s: "tglComps", t: "tglTraffic", c: "tglCounties" };
    const FKEYS = { sub: "fSub", ot: "fOwnerType", own: "fOwner", hold: "fHold", acmin: "fAcMin", acmax: "fAcMax", sfmin: "fSfMin", sfmax: "fSfMax",
      listed: "fListed", aadt: "fAadt", pipe: "fPipe" };
    function saveUrl() {
      const q = new URLSearchParams(location.search);
      ["c", "z", "cls", "st", "co", "sz", "sig", "f", "lyr"].forEach((k) => q.delete(k));
      if (!params.get("pid")) q.delete("pid");
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
      if (lyr !== "lpc") q.set("lyr", lyr || "x");
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
      if (params.get("c")) { const [x, y] = params.get("c").split(",").map(Number); if (!isNaN(x) && !isNaN(y)) view.goTo({ center: [x, y], zoom: Number(params.get("z")) || view.zoom }, { animate: false }).catch(() => {}); }
    }
    const pendingSelect = {};   // select values from the URL that arrive before their option lists
    view.watch("stationary", (s) => { if (s) saveUrl(); });

    async function distinct(layer, fields, where) {
      const r = await layer.queryFeatures({ where: where || "1=1", outFields: fields, returnDistinctValues: true, returnGeometry: false, orderByFields: fields });
      return r.features.map((f) => f.attributes);
    }
    let countyRows = [];
    function fillCounties() {
      const st = val("fState"), sel = $("fCounty"), keep = sel.value || params.get("co") || "";
      const rows = countyRows.filter((r) => r.county && (!st || r.state === st));
      sel.innerHTML = `<option value="">All</option>` + rows.map((r) => `<option value="${esc(r.county)}">${esc(r.county)}${st ? "" : ", " + esc(r.state)}</option>`).join("");
      if (rows.some((r) => r.county === keep)) sel.value = keep;
    }
    readUrl();
    applyFilters();
    (async () => {
      try {
        countyRows = await distinct(propsQ, ["state", "county"]);   // from the properties, so the names always match
        fillCounties();
        const [subs, ot] = await Promise.all([distinct(propsQ, ["sub_type"], "sub_type IS NOT NULL AND sub_type <> ''"), distinct(propsQ, ["owner_type"], "owner_type IS NOT NULL")]);
        $("fSub").innerHTML = `<option value="">All</option>` + subs.map((r) => `<option>${esc(r.sub_type)}</option>`).join("");
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
      return el("span", { class: `chip2 cls2${c && c.darkText ? " dark-text" : ""}`, style: `background:${c ? c.color : "#5b6677"}`, text: cls || "Unclassified" });
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
      return `mailto:${CFG.reportEmail}?subject=${encodeURIComponent("Charlotte Office Map data problem")}&body=${encodeURIComponent(body)}`;
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
    const valueText = (a) => blank(a.assessed_value) ? "" : a.assessed_basis ? tag(moneyShort(a.assessed_value), basisText(a.assessed_basis)) : moneyShort(a.assessed_value);
    function siteLine(a) {   // some counties put the city in the street line; do not repeat it
      const street = (a.site_address || "").trim(), city = (a.site_city || "").trim();
      const parts = [street];
      if (city && street.toUpperCase().indexOf(city.toUpperCase()) < 0) parts.push(city);
      if (a.site_zip && street.indexOf(String(a.site_zip).trim()) < 0) parts.push(String(a.site_zip).trim());
      return parts.filter(Boolean).join(", ");
    }
    const acresText = (a) => blank(a.acres) ? "" : /^estimate/i.test(a.acres_basis || "") ? est(ac(a.acres)) : ac(a.acres);
    function scoreInputs(a) {   // what the seller score is built on, in words
      const p = [];
      if (!blank(a.hold_years)) p.push(`held ${nf(a.hold_years, 0)} yr`);
      if (a.owner_type && a.owner_type !== "Unknown") p.push(a.owner_type.toLowerCase().replace("llc or corp", "LLC or corporation"));
      if (a.out_of_state === "Yes") p.push("out of state"); else if (a.out_of_state === "No") p.push("in state");
      if (a.year_built) p.push(`built ${a.year_built}`);
      return p.join(", ");
    }
    function propCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry, src = srcName(a.source);
      const root = el("div", { class: "pc" });
      // 1. header: chips, brand, address, then the two actions
      root.appendChild(el("div", { class: "chips" }, [classChip(a.asset_class), a.sub_type ? el("span", { class: "chip2", text: a.sub_type }) : null,
        a.listed === "Yes" ? el("span", { class: "chip2 listed", text: "Listed for sale" }) : null,
        a.listed === "Under contract" ? el("span", { class: "chip2 listed", text: "Under contract" }) : null]));
      const brandLine = [a.name && a.brand && a.name.indexOf(a.brand) < 0 ? a.brand : null, a.brand_parent && a.brand_parent !== a.brand ? a.brand_parent : null].filter(Boolean).join(", ");
      if (brandLine) root.appendChild(el("div", { class: "addr", text: brandLine }));
      root.appendChild(el("div", { class: "addr", text: siteLine(a) + ` (${a.county || ""}, ${a.state || ""})` }));
      const addBtn = el("button", { type: "button", class: "primary", text: cartHas(a.pid) ? "On call list" : "Add to call list" });
      addBtn.onclick = () => { cartToggle(a, g); addBtn.textContent = cartHas(a.pid) ? "On call list" : "Add to call list"; };
      root.appendChild(el("div", { class: "btns" }, [addBtn, el("button", { type: "button", text: "Site sheet", onclick: () => siteSheet(a, g) })]));
      // 2. owner
      root.appendChild(el("div", { class: "sec", text: "Owner" }));
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
      const mail = [a.mail_address, a.mail_city, a.mail_state, a.mail_zip].filter(Boolean).join(", ");
      root.appendChild(kv([
        ["Name", el("span", { class: "owner", text: a.owner || a.owner_note || "Not in the county file" }), src],
        ["Owner type", a.owner_type ? est(a.owner_type) : ""],
        ["Mailing", mail ? el("span", {}, [mail, a.out_of_state === "Yes" ? el("span", { class: "chip2 oos", style: "margin-left:6px", text: "Out of state" }) : null]) : "", src],
        ["Hold", blank(a.hold_years) ? "Unknown" : est(`${nf(a.hold_years, 1)} yr`)],
        ["Portfolio", moreLine],
        ["Seller score", a.seller_score ? el("span", {}, [el("span", { class: `chip2 sc-${String(a.seller_score).replace(/\s/g, "")}`, text: a.seller_score, title: "Sorting aid built on assumptions; see About" }),
          el("div", { class: "est", text: a.seller_score === "Not scored" ? "Not scored: no recorded sale, owner unknown, or several unit owners." : scoreInputs(a) ? `Based on: ${scoreInputs(a)}` : "" })]) : ""]
      ]));
      // 3. property
      root.appendChild(el("div", { class: "sec", text: "Property" }));
      root.appendChild(kv([
        ["Land", acresText(a), a.acres_basis || src], ["Building", blank(a.bldg_sf_est) ? "" : est(sf(a.bldg_sf_est))], ["Year built", a.year_built ? String(a.year_built) : "", src],
        [valueLabel(a), valueText(a), `${src} (county record)`], ["Last sale", saleText(a), src], ["County use", a.use_desc || "", src],
        has("tenant_count") && !blank(a.tenant_count) && a.tenant_count > 0 ? ["Storefronts", observed(`${nf(a.tenant_count)}${blank(a.national_share) ? "" : ", " + nf(a.national_share * 100) + "% national"}`)] : null,
        has("tenants") && a.tenants ? ["Tenants", observed(a.tenants)] : null,
        a.asset_class === "Net Lease" || a.asset_class === "Strip Center" ? ["Rent, lease expiration, cap rate, vacancy", "Not public"] : null
      ]));
      // 4. site
      if (has("nearest_aadt") || has("pipeline_2mi")) {
        root.appendChild(el("div", { class: "sec", text: "Site" }));
        const aadt = !has("nearest_aadt") ? null : blank(a.nearest_aadt) ? ["Nearest traffic count", "No count within 1,500 ft"] :
          ["Nearest traffic count", `${nf(a.nearest_aadt)} AADT${a.aadt_year ? " (" + a.aadt_year + ")" : ""}${a.aadt_route ? " on " + a.aadt_route : ""}${blank(a.aadt_dist_ft) ? "" : ", " + nf(a.aadt_dist_ft) + " ft away"}`, "State DOT count (actual)"];
        const pipe = !has("pipeline_2mi") ? null : ["Pipeline within 2 mi", a.pipeline_2mi > 0 ? est(`${nf(a.pipeline_2mi)} project${a.pipeline_2mi > 1 ? "s" : ""}${a.pipeline_names ? ": " + a.pipeline_names : ""}`) : "None"];
        const city = has("pipeline_city") && a.pipeline_city ? ["Projects placed at the city center", a.pipeline_city] : null;
        const note = a.aadt_note ? ["Traffic count note", a.aadt_note] : null;
        root.appendChild(kv([aadt, note, pipe, city]));
      }
      // 5. links
      const lr = linkRow(a, g.latitude, g.longitude);
      root.appendChild(lr);
      if ((a.listed === "Yes" || a.listed === "Under contract") && listQ) {   // the matching Crexi listing near the point
        listQ.queryFeatures({ geometry: g, distance: 250, units: "meters", spatialRelationship: "intersects", outFields: ["url"], returnGeometry: false, num: 1 })
          .then((r) => { const u = r.features[0] && r.features[0].attributes.url; if (u && /^https:\/\/(www\.)?crexi\.com\//.test(u)) lr.appendChild(el("a", { href: u, target: "_blank", rel: "noopener", text: "Crexi listing" })); }).catch(() => {});
      }
      root.appendChild(el("details", { class: "rec" }, [el("summary", { text: "Record" }),
        kv([["Parcel number", a.parcel_id || ""], ["Property id", a.pid || ""], ["Class rule", a.class_rule || ""], ["Source", src], ["Value basis", a.assessed_basis || ""], ["Acres basis", a.acres_basis || ""]])]));
      const rh = reportHref(a);
      if (rh) root.appendChild(el("a", { class: "report", href: rh, text: "Report a data problem" }));
      return root;
    }
    function listingCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = el("div", { class: "pc" });
      root.appendChild(el("div", { class: "chips" }, [el("span", { class: "chip2 listed", text: "Crexi listing" }), a.asset_class && CLASS[a.asset_class] ? classChip(a.asset_class) : (a.asset_class ? el("span", { class: "chip2", text: a.asset_class }) : null)]));
      root.appendChild(el("div", { class: "addr", text: [a.address || "Address not shown by the broker", a.city, a.state, a.zip].filter(Boolean).join(", ") }));
      root.appendChild(kv([["Crexi type", a.crexi_type || ""], a.tenant ? ["Tenant", a.tenant] : null, ["Asking price", moneyShort(a.asking_price) || "Not posted"],
        ["Asking cap rate", blank(a.cap_rate) ? "" : nf(a.cap_rate, 2) + "%"], ["Building", sf(a.bldg_sf)], ["Land", ac(a.acres)], ["Status", a.status || ""],
        ["Listing firm", a.listing_firm || ""], ["Days on market", blank(a.days_on_market) ? "" : est(nf(a.days_on_market))], ["Data date", dateLong(a.scraped_date)]]));
      const cx = a.url && /^https:\/\/(www\.)?crexi\.com\//.test(a.url) ? [el("a", { href: a.url, target: "_blank", rel: "noopener", text: "Crexi listing" })] : [];
      root.appendChild(linkRow({ state: a.state, county: null }, g.latitude, g.longitude, cx));
      root.appendChild(el("div", { class: "est", text: "Facts as posted on Crexi on the data date (asking figures, not closed terms)." }));
      return root;
    }
    function pipelineCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = el("div", { class: "pc" });
      root.appendChild(el("div", { class: "chips" }, [el("span", { class: "chip2 cls2", style: `background:${PIPE_STATUS[a.status] || "#5b6677"}`, text: a.status || "Status unknown" }),
        a.kind ? el("span", { class: "chip2", text: a.kind }) : null, a.confidence ? el("span", { class: "chip2", text: `${a.confidence.split(/[;(]/)[0].trim()} confidence` }) : null]));
      root.appendChild(el("div", { class: "addr", text: [a.city, a.county, a.state].filter(Boolean).join(", ") }));
      const precise = /address|intersection/i.test(a.pin_precision || "");
      root.appendChild(kv([["Anchor", a.anchor || ""], ["Developer", a.developer || ""], ["Size", a.size || ""], ["Detail", a.status_detail || ""],
        ["As of", dateLong(a.as_of_date)], ["Pin source", a.pin_source || ""], ["Pin placed at", precise ? (a.pin_precision || "") : /centroid/i.test(a.pin_precision || "") ? "City center only, not the site" : "Approximate location, not the exact site"]]));
      const src = a.source_url && /^https?:\/\//.test(a.source_url) ? [el("a", { href: a.source_url, target: "_blank", rel: "noopener", text: "Source" })] : [];
      root.appendChild(linkRow({ state: a.state, county: a.county }, g.latitude, g.longitude, src));
      return root;
    }
    function compCard(f) {
      const a = f.graphic.attributes, g = f.graphic.geometry;
      const root = el("div", { class: "pc" });
      root.appendChild(el("div", { class: "chips" }, [el("span", { class: "chip2", text: "Recorded sale" }), a.asset_class ? classChip(a.asset_class) : null,
        a.sub_type ? el("span", { class: "chip2", text: a.sub_type }) : null]));
      root.appendChild(el("div", { class: "addr", text: [a.site_address, a.county, a.state].filter(Boolean).join(", ") }));
      const priced = a.price_basis === "actual" && !blank(a.sale_price), bulk = a.portfolio_sale === "Yes";
      root.appendChild(kv([["Sale date", saleDate(a.last_sale_date, a.sale_date_precision, true), srcName(a.source)], ["Sale price", priced ? moneyShort(a.sale_price) : "Not published by the county", srcName(a.source)],
        bulk ? ["Portfolio or bulk deed", "Price covers several parcels, so no per SF or per acre"] : null,
        ["Price per SF", priced && !bulk && !blank(a.ppsf_est) ? est(money(a.ppsf_est)) : ""], ["Price per acre", priced && !bulk && !blank(a.pp_acre) ? est(moneyShort(a.pp_acre)) : ""],
        ["Buyer", a.buyer || "", "Current owner of record"], ["Seller", "Not in public parcel data"],
        ["Building", blank(a.bldg_sf_est) ? "" : est(sf(a.bldg_sf_est))], ["Land", ac(a.acres)], ["Year built", a.year_built ? String(a.year_built) : ""],
        ["Parcel number", a.parcel_id || ""]]));
      root.appendChild(linkRow({ state: a.state, county: a.county }, g.latitude, g.longitude));
      root.appendChild(el("div", { class: "est", text: `Source: ${srcName(a.source)}. Price per SF uses the footprint estimate.` }));
      return root;
    }
    function countyCard(f) {
      const a = f.graphic.attributes;
      const root = el("div", { class: "pc" });
      root.appendChild(kv([a.pop_2025 != null ? ["Population 2025", tag(nf(a.pop_2025), "Census estimate")] : null, ["Population 2024", tag(nf(a.pop_2024), "Census estimate")],
        ["Growth, 5 yr", blank(a.pop_growth_5yr_pct) ? "" : tag(nf(a.pop_growth_5yr_pct, 1) + "%", "Census estimate")],
        ["Median household income", blank(a.median_hh_income) ? "" : tag(money(a.median_hh_income), "Census estimate")],
        ["Industrial", est(nf(a.n_industrial))], ["Hospitality", est(nf(a.n_hospitality))], ["Net lease", est(nf(a.n_net_lease))], ["Strip centers", est(nf(a.n_strip))],
        [`Held ${HOLD}+ years`, est(nf(a.n_long_hold))], ["Crexi listings", nf(a.n_listings)]]));
      return root;
    }
    function legendEl() {
      const box = el("div", { class: "legend" });
      const dot = (c, extra) => `<span class="sw" style="background:${c};${extra || ""}"></span>`;
      box.innerHTML = `<div class="hd">Properties</div>` + CLASSES.map((c) => `<div>${dot(c.color, c.darkText ? "border:1px solid #14284b" : "")}${c.key}</div>`).join("") +
        `<div>${dot("#8193b2", "box-shadow:0 0 0 2px #14284b")}Listed for sale or under contract (dark ring; white on imagery)</div>
         <div>${dot("#8193b2", "width:7px;height:7px")}${dot("#8193b2", "width:12px;height:12px")}Seller score Low to High</div>
         <div>${dot("transparent", "box-shadow:0 0 0 3px #f0c419")}Owner portfolio or selected property</div>
         <div>${dot("#a0b6da", "border-radius:1px")}Zoomed out: property counts</div>
         <div class="hd">Other layers</div>
         <div>${dot("#fff", "border-radius:1px;transform:rotate(45deg);border:1.5px solid #14284b;width:9px;height:9px")}Crexi listing</div>` +
        (L.pipeline ? Object.entries(PIPE_STATUS).map(([s, c]) => `<div>${dot("transparent", `border-radius:1px;border:2.4px solid ${c}`)}Pipeline: ${s}</div>`).join("") +
          `<div>${dot("transparent", "border:1.6px solid #7e57c2")}Pipeline, approximate pin (circle)</div>` : "") +
        (L.comps ? `<div><span class="swatch tri" style="margin-right:6px;display:inline-block"></span>Recent sale, price published</div>
          <div><span class="swatch tri" style="margin-right:6px;display:inline-block;border-bottom-color:#9aa0a8"></span>Recent sale, price not published</div>` : "") +
        (L.traffic ? `<div>${dot("#5a6473", "width:7px;height:7px")}Traffic count (AADT)</div>` : "") +
        `<div>${dot("transparent", "border-radius:2px;border:2px solid #14284b")}County line</div>`;
      return box;
    }

    // ---------------------------------------------------------------- site sheet (print view)
    async function siteSheet(a, g) {
      const w = window.open("", "_blank");
      if (!w) { toast("Allow pop-ups to open the site sheet."); return; }
      w.document.write("<p style='font-family:sans-serif'>Preparing the site sheet...</p>");
      let img = "";
      try {
        markLayer.removeAll();
        markLayer.add(new Graphic({ geometry: g, symbol: { type: "simple-marker", size: 18, color: [0, 0, 0, 0], outline: { color: [240, 196, 25, 1], width: 3.5 } } }));
        view.closePopup();
        await view.goTo({ target: g, scale: 4000 }, { animate: false });
        await new Promise((r) => setTimeout(r, 1200));
        img = (await view.takeScreenshot({ format: "png", width: 1000, height: 560 })).dataUrl;
      } catch (e) { console.warn("screenshot", e); }
      const row = (k, v) => blank(v) ? "" : `<tr><td>${esc(k)}</td><td>${v}</td></tr>`;
      const c = CFG.contact || {};
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Site sheet ${esc(a.site_address || a.pid)}</title><style>
        body{font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b2430;margin:28px;max-width:960px}
        h1{font-size:22px;margin:0 0 4px;color:#14284b} .sub{color:#4f5b6d;margin-bottom:12px} img{width:100%;border:1px solid #d9dee6;border-radius:4px}
        .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px} h2{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#14284b;border-bottom:2px solid #14284b;padding-bottom:3px}
        table{border-collapse:collapse;width:100%;font-size:13px} td{padding:4px;border-bottom:1px solid #e6e9ee;vertical-align:top} td:first-child{color:#4f5b6d;width:42%}
        .foot{margin-top:18px;font-size:11px;color:#4f5b6d;line-height:1.5} .bar{margin-bottom:14px} button{padding:7px 14px;border:1px solid #14284b;background:#14284b;color:#fff;border-radius:5px;font-weight:600;cursor:pointer}
        @media print{.bar{display:none} body{margin:12mm}}</style></head><body>
        <div class="bar"><button onclick="window.print()">Print or save as PDF</button></div>
        <h1>${esc(a.name || a.brand || a.site_address || "Property")}</h1>
        <div class="sub">${esc(siteLine(a))} (${esc(a.county)}, ${esc(a.state)})<br>${esc(a.asset_class || "")}${a.sub_type ? ", " + esc(a.sub_type) : ""}${a.listed === "Yes" ? ", listed for sale" : a.listed === "Under contract" ? ", under contract" : ""}</div>
        ${img ? `<img src="${img}" alt="Map of the site">` : ""}
        <div class="cols"><div><h2>Property</h2><table>
          ${row(/^estimate/i.test(a.acres_basis || "") ? "Land (est.)" : "Land", ac(a.acres))}${row("Building (est.)", sf(a.bldg_sf_est))}${row("Year built", a.year_built || "")}${row("County value" + (a.assessed_basis ? " (" + basisText(a.assessed_basis) + ")" : ""), moneyShort(a.assessed_value))}
          ${row("Last sale", esc(saleText(a, true)))}${row("County use", esc(a.use_desc))}${row("Tenants (observed, Overture Oct 2026)", esc(a.tenants))}${row("Parcel number", esc(a.parcel_id))}</table>
          ${has("nearest_aadt") || has("pipeline_2mi") ? `<h2>Site</h2><table>${has("nearest_aadt") ? row("Nearest traffic count", blank(a.nearest_aadt) ? "No count within 1,500 ft" : `${nf(a.nearest_aadt)} AADT${a.aadt_year ? " (" + a.aadt_year + ")" : ""} ${esc(a.aadt_route || "")}`) : ""}
          ${has("pipeline_2mi") ? row("Pipeline within 2 mi (est.)", a.pipeline_2mi > 0 ? `${nf(a.pipeline_2mi)}: ${esc(a.pipeline_names || "")}` : "None") : ""}</table>` : ""}</div>
        <div><h2>Owner</h2><table>${row("Owner", esc(a.owner || a.owner_note || ""))}${row("Owner type (est.)", esc(a.owner_type))}
          ${row("Mailing address", esc([a.mail_address, a.mail_city, a.mail_state, a.mail_zip].filter(Boolean).join(", ")))}${row("Out-of-state owner", esc(a.out_of_state))}
          ${row("Hold years (est.)", nf(a.hold_years, 1))}${row("Properties held on this map (est.)", nf(a.portfolio_count))}${row("Seller score (sorting aid)", esc(a.seller_score))}</table></div></div>
        <div class="foot">Source: ${esc(srcName(a.source))}. Owner, mailing address, acres, value, year built and sale date are as recorded by the county (actual); items marked (est.) are derived by the map; the seller score is a sorting aid built on assumptions. Verify with county records before relying on any figure.<br>
        Prepared ${new Date().toLocaleDateString("en-US")} by ${esc(c.name || "")}, ${esc(c.title || "")}, ${esc(c.office || "")}${placeholder(c.phone) ? "" : ", " + esc(c.phone)}${placeholder(c.email) ? "" : ", " + esc(c.email)}.</div></body></html>`;
      w.document.open(); w.document.write(html); w.document.close();
    }

    // ---------------------------------------------------------------- call list cart (localStorage)
    const CART_KEY = "officeMap.callList.v1";
    let cart = store.get(CART_KEY, []);
    let tableRows = [], tableMode = "results", tableKind = "props", sortCol = null, sortDir = 1, resultsState = null;
    function cartHas(pid) { return cart.some((x) => x.pid === pid); }
    function cartSave() {
      store.set(CART_KEY, cart);
      $("cartCount").textContent = cart.length; $("cartCount2").textContent = cart.length;
      if (tableMode === "cart" && !$("drawer").hidden) showCart();
    }
    function cartToggle(a, g) {
      if (cartHas(a.pid)) { cart = cart.filter((x) => x.pid !== a.pid); toast("Removed from the call list."); }
      else {
        const rec = { ...a }; delete rec.OBJECTID; delete rec.src_row;
        rec._lat = g && g.latitude != null ? +g.latitude.toFixed(6) : null; rec._lon = g && g.longitude != null ? +g.longitude.toFixed(6) : null;
        rec._added = new Date().toISOString().slice(0, 10);
        cart.push(rec); toast(`Added to the call list (${cart.length}).`);
      }
      cartSave();
    }

    // ---------------------------------------------------------------- results drawer under the map
    const COLS = [
      ["name", "Name", "open"], ["asset_class", "Class"], ["site_address", "Address"], ["site_city", "City"], ["county", "County"], ["state", "St"],
      ["owner", "Owner"], ["owner_type", "Owner type"], ["out_of_state", "Out of state"], ["hold_years", "Hold, yr (est.)", 1], ["seller_score", "Score"],
      ["bldg_sf_est", "Building SF (est.)", 0], ["acres", "Acres", 2], ["listed", "Listed"]
    ];
    const COMP_COLS = [
      ["site_address", "Address", "open"], ["last_sale_date", "Sale date"], ["asset_class", "Class"], ["sub_type", "Sub type"], ["county", "County"],
      ["state", "St"], ["sale_price", "Price", "$"], ["price_basis", "Price basis"], ["ppsf_est", "$/SF (est.)", "$"], ["buyer", "Buyer (owner of record)"],
      ["bldg_sf_est", "Building SF (est.)", 0], ["acres", "Acres", 2]
    ];
    // on desktop the drawer covers the bottom of the map: pad the view so popups, zooms and the map UI stay in the visible part
    function padForDrawer() { view.padding = { ...view.padding, bottom: !phone() && !$("drawer").hidden ? $("drawer").offsetHeight : 0 }; }
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
      $("resultsNote").textContent = cart.length ? `${cart.length} saved on this browser.` : "Empty. Add properties from a property card or a table row.";
      $("resultsExport").disabled = !cart.length;
      $("resultsExport").textContent = `Export call list (${cart.length})`;
      drawTable(cart.map((r) => ({ attributes: r, geometry: null })));
    }
    function fillTable(feats, title, note, spec) {
      resultsState = { feats, title, note, spec };
      tableMode = "results";
      renderTable();
      openDrawer();
    }
    function renderTable() {
      $("segResults").classList.add("on"); $("segCart").classList.remove("on"); $("cartClear").hidden = true;
      if (!resultsState) { $("resultsTitle").textContent = "Results"; $("resultsNote").textContent = "Use Show table, an area, or an owner's Show all."; $("resultsExport").disabled = true; $("resultsExport").textContent = "Export"; drawTable([]); return; }
      tableKind = resultsState.spec.kind || "props";
      $("resultsTitle").textContent = resultsState.title; $("resultsNote").textContent = resultsState.note;
      $("resultsExport").disabled = false;
      $("resultsExport").textContent = `Export these ${nf(resultsState.spec.total)}`;
      drawTable(resultsState.feats);
    }
    function drawTable(feats) {
      tableRows = feats.slice();
      const cols = tableKind === "comps" ? COMP_COLS : COLS, withAdd = tableKind !== "comps";
      const head = $("resultsTable").querySelector("thead");
      head.innerHTML = "<tr>" + (withAdd ? `<th><span class="hint" style="padding:0 8px">${tableMode === "cart" ? "" : "Add"}</span></th>` : "") +
        cols.map((c, i) => `<th aria-sort="${sortCol === i ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-i="${i}">${c[1]}</button></th>`).join("") + "</tr>";
      head.querySelectorAll("th button").forEach((b) => b.onclick = () => {
        const i = +b.dataset.i, numeric = cols[i][2] != null && cols[i][2] !== "open";
        sortDir = sortCol === i ? -sortDir : (numeric ? -1 : 1); sortCol = i;
        const k = cols[i][0];
        tableRows.sort((a, b2) => { const x = a.attributes[k], y = b2.attributes[k]; if (blank(x)) return 1; if (blank(y)) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
        drawTable(tableRows);
      });
      const body = $("resultsTable").querySelector("tbody");
      const cell = (c, v, f) => {
        if (c[2] === "open") return `<td class="open"><button type="button">${esc(v || f.attributes.site_address || f.attributes.pid || "Open")}</button></td>`;
        if (c[2] === "$") return `<td class="num">${blank(v) ? "" : moneyShort(v)}</td>`;
        if (c[0] === "last_sale_date") return `<td>${esc(dateShort(v))}</td>`;
        return c[2] != null ? `<td class="num">${nf(v, c[2])}</td>` : `<td>${esc(v)}</td>`;
      };
      body.innerHTML = tableRows.slice(0, 1000).map((f, i) => {
        const inCart = cartHas(f.attributes.pid);
        const add = withAdd ? `<td class="add"><button type="button" class="add-btn${inCart ? " in" : ""}" title="${tableMode === "cart" ? "Remove from the call list" : inCart ? "On the call list" : "Add to the call list"}">${tableMode === "cart" ? "&times;" : inCart ? "&#10003;" : "+"}</button></td>` : "";
        return `<tr data-r="${i}">${add}${cols.map((c) => cell(c, f.attributes[c[0]], f)).join("")}</tr>`;
      }).join("");
      body.querySelectorAll("tr").forEach((tr) => {
        const f = tableRows[+tr.dataset.r];
        const ab = tr.querySelector(".add-btn");
        if (ab) ab.onclick = () => { cartToggle(f.attributes, f.geometry); if (tableMode !== "cart") drawTable(tableRows); };
        tr.querySelector("td.open button").onclick = async () => {
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
    async function tableFromQuery(layer, where, geometry, title, label, kind) {
      const total = await layer.queryFeatureCount({ where, geometry, spatialRelationship: "intersects" });
      const r = await layer.queryFeatures({ where, geometry, spatialRelationship: "intersects", outFields: ["*"], returnGeometry: true,
        outSpatialReference: view.spatialReference, orderByFields: [kind === "comps" ? "last_sale_date DESC" : "hold_years DESC"], num: 1000 });
      const order = kind === "comps" ? "newest first" : "longest holds first";
      fillTable(r.features, title, total > 1000 ? `Showing 1,000 of ${nf(total)}, ${order}. The export has all ${nf(total)}.` : `${nf(total)}, ${order}.`,
        { layer, where, geometry, label, kind, total });
    }
    $("showTable").onclick = () => tableFromQuery(propsQ, filterWhere(), null, "Properties that match the filters", "filtered", "props");
    $("exportProps").onclick = () => exportCsv(propsQ, filterWhere(), null, "filtered properties");
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
      markLayer.removeAll();
      markLayer.addMany(r.features.map((f) => new Graphic({ geometry: f.geometry, symbol: { type: "simple-marker", size: 17, color: [0, 0, 0, 0], outline: { color: [240, 196, 25, 1], width: 3 } } })));
      $("portfolioBar").hidden = false; $("portfolioName").textContent = owner; $("portfolioCount").textContent = nf(total) + (total === 1 ? " property" : " properties");
      fillTable(r.features, `Portfolio: ${owner}`, `${nf(total)} held under this owner name${total > r.features.length ? `, first ${nf(r.features.length)} shown` : ""}; filters ignored.`,
        { layer: propsQ, where, geometry: null, label: "owner portfolio", kind: "props", total });
      if (o.zoom !== false && r.features.length) view.goTo(extentOf(r.features)).catch(() => {});
      return r.features;
    }
    async function openPortfolio(owner) {
      if (!owner) return;
      view.closePopup();
      const feats = await showPortfolio(owner);
      toast(`${nf(feats.length)} properties for ${owner}`);
    }
    $("clearPortfolio").onclick = () => { markLayer.removeAll(); $("portfolioBar").hidden = true; };

    // ---------------------------------------------------------------- search
    const ownerSource = new SearchSource({
      name: "Owners (portfolio)", placeholder: "Owner name", maxSuggestions: 6,
      getSuggestions: async (p) => {
        const t = (p.suggestTerm || "").trim().toUpperCase();
        if (t.length < 3) return [];
        const r = await propsQ.queryFeatures({ where: `UPPER(${ownerField}) LIKE ${sq("%" + t + "%")}`, outFields: [ownerField], returnDistinctValues: true,
          returnGeometry: false, num: 6, orderByFields: [ownerField] });
        return r.features.map((f) => ({ key: f.attributes[ownerField], text: f.attributes[ownerField], sourceIndex: p.sourceIndex }));
      },
      getResults: async (p) => {
        const name = (p.suggestResult && (p.suggestResult.key || p.suggestResult.text)) || "";
        if (!name) return [];
        const feats = await showPortfolio(name, { zoom: false });
        if (!feats.length) return [];
        const ext = extentOf(feats);
        return [{ extent: ext, feature: new Graphic({ geometry: ext.center, attributes: { name } }), name }];
      }
    });
    new Search({
      view, container: "searchSlot", includeDefaultSources: false, allPlaceholder: phone() ? "Search address or owner" : "Address, owner, center or brand",
      popupEnabled: true, resultGraphicEnabled: false, maxSuggestions: 6, minSuggestCharacters: 3,
      sources: [
        { layer: propsQ, name: "Properties", placeholder: "Address, center or brand", searchFields: ["site_address", "name", "brand"],
          displayField: "site_address", suggestionTemplate: "{site_address}, {site_city} ({asset_class})", exactMatch: false, outFields: ["*"],
          popupTemplate: propTemplate, zoomScale: 4000, maxSuggestions: 6, withinViewEnabled: false },
        ownerSource,
        listQ && { layer: listQ, name: "Crexi listings", placeholder: "Listing title or address", searchFields: ["title", "address"], displayField: "title",
          suggestionTemplate: "{title}, {city}", exactMatch: false, outFields: ["*"], popupTemplate: listings.popupTemplate, zoomScale: 4000, maxSuggestions: 4 },
        { url: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer", name: "Address", singleLineFieldName: "SingleLine",
          placeholder: "Street address or place", countryCode: "USA", maxSuggestions: 4, zoomScale: 6000,
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
      a.download = `Charlotte Office Map ${label} ${new Date().toISOString().slice(0, 10)}.csv`;
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
      polygonSymbol: { type: "simple-fill", color: [240, 196, 25, 0.12], outline: { color: [...NAVY, 1], width: 2, style: "dash" } } });
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
            (ma.n ? `<tr><td>Median price per SF, ${nf(ma.n)} priced sales</td><td>${money(ma.m)} <span class="est">(est.)</span></td></tr>` : `<tr><td>Sales with a published price</td><td>0</td></tr>`);
          $("areaComps").hidden = !nAll;
        }
        const m = {}; byClass.features.forEach((f) => m[f.attributes.asset_class] = f.attributes.n);
        const total = Object.values(m).reduce((s, x) => s + x, 0);
        const areaMi = geometryEngine.geodesicArea(areaGeom, "square-miles");
        $("areaStatus").textContent = `Area about ${nf(areaMi, 1)} sq mi (est.). Counts use the current filters.`;
        $("areaStats").innerHTML = `<table class="stats">${CLASSES.map((c) => `<tr><td><span class="swatch" style="background:${c.color}"></span> ${c.key}</td><td>${nf(m[c.key] || 0)}</td></tr>`).join("")}
          <tr class="total"><td>Properties</td><td>${nf(total)}</td></tr>
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
        view.goTo({ target: g.geometry, scale: 4000 }).then(() => view.openPopup({ features: [g], location: g.geometry }));
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

    renderMethod({ propsQ, listQ, trafficQ, pipeQ, compsQ, L });
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
      $("reportLink").href = `mailto:${CFG.reportEmail}?subject=${encodeURIComponent("Charlotte Office Map data problem")}&body=${encodeURIComponent("Page: " + location.href + "\n\nWhat is wrong:\n")}`;
      $("reportLink").hidden = false;
    }
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
    $("freshAbout").textContent = fresh.join(". ") + (fresh.length ? "." : "");
    $("freshShort").textContent = short.length ? short.join(", ") + ". Sources and method" : "";
    $("methodText").innerHTML = `
      <p><b>What is here.</b> Commercial properties in Virginia, North Carolina and South Carolina in four classes (industrial, hospitality, single tenant net lease and strip centers), with current Crexi listings, recent recorded sales, development projects, traffic counts and county context. Every number says where it came from: county or state record (actual), worked out by this map (est.), or a rule we chose (assumption).</p>
      <p><b>How a property gets its class.</b> A set of rules reads the county use code, the building size from footprints and the businesses on the parcel from Overture Maps, an open map of businesses. Each property shows the rule that placed it. ${esc(CFG.handCheck || "")}</p>
      <p><b>Owners and the seller score.</b> Owner names and mailing addresses come from the county. Hold years count from the last recorded transfer (est.). The seller score (High, Medium, Low, or Not scored when the inputs are missing) is a sorting aid built on assumptions: long hold (${HOLD}+ years), a person, trust or estate as owner, an out-of-state mailing address and an older building. It is not a prediction. Street lines are left off for owners who are people or trusts; city, state and ZIP stay.</p>
      <p><b>Listings, sales, projects and traffic.</b> Listings are facts as posted on Crexi with a link back; asking prices and cap rates are asking figures. Recorded sales show the price only where the county publishes it (North Carolina does not). Development projects come from public announcements and planning records; a circle means the pin is approximate. Traffic counts are state DOT annual counts${minAadt ? `; the layer shows stations with ${nf(minAadt)} or more vehicles a day, and every property carries its nearest count within 1,500 ft` : ""}. Tenants are storefronts observed in Overture Maps, not a rent roll; rents, lease terms, closed cap rates and vacancy are not public.</p>
      <p><b>Use with care.</b> Public records lag and contain errors. Verify ownership, sale and size facts with the county before relying on them, and use Report a data problem when something is wrong.</p>
      ${srcRows ? `<table><tr><th>State</th><th>Parcel source</th><th>Properties</th></tr>${srcRows}</table>` : ""}
      <p class="hint">Area counts include properties whose point falls inside the drawn shape; square mileage is an estimate. Street View and Google Maps open in a new tab from the coordinates. Basemap and address search by Esri; map data from Esri, OpenStreetMap contributors and partners as credited on the map.</p>`;
  }

  init().catch((e) => { console.error(e); $("matchLabel").textContent = NO_DATA; toast(NO_DATA, 10000); });
});
