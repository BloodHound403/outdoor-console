/* Outdoor Console (static, no build step) */

const STORAGE = {
  lastZip: "outdoorConsole:lastZip",
  lastLocationLabel: "outdoorConsole:lastLocationLabel",
  lastCoords: "outdoorConsole:lastCoords",
  mapPins: "outdoorConsole:mapPins",
  todos: "outdoorConsole:todos",
  notes: "outdoorConsole:notes",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setText(el, text) {
  el.textContent = text;
}

function showError(message) {
  const el = $("#globalError");
  el.classList.toggle("hidden", !message);
  setText(el, message || "");
}

function normalizeZip(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  // Accept "12345" or "12345-6789"
  const m = trimmed.match(/^(\d{5})(?:-(\d{4}))?$/);
  if (!m) return "";
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

function formatCoords(lat, lon) {
  const f = (n) => (typeof n === "number" ? n.toFixed(4) : "—");
  return `${f(lat)}, ${f(lon)}`;
}

function formatMGRS(lat, lon) {
  try {
    // mgrs library attaches a global `mgrs`
    // Accuracy 5 => 1 m, 4 => 10 m – 5 is fine for display
    if (typeof window !== "undefined" && window.mgrs && Number.isFinite(lat) && Number.isFinite(lon)) {
      return window.mgrs.forward([lon, lat], 4);
    }
  } catch {
    // fall back to lat/lon
  }
  return formatCoords(lat, lon);
}

function dayName(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function monthDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

function weatherLabelFromCode(code) {
  // Open-Meteo weathercode mapping (simplified)
  const c = Number(code);
  if (Number.isNaN(c)) return "—";
  if (c === 0) return "Clear";
  if (c === 1) return "Mainly clear";
  if (c === 2) return "Partly cloudy";
  if (c === 3) return "Overcast";
  if (c === 45 || c === 48) return "Fog";
  if ([51, 53, 55].includes(c)) return "Drizzle";
  if ([56, 57].includes(c)) return "Freezing drizzle";
  if ([61, 63, 65].includes(c)) return "Rain";
  if ([66, 67].includes(c)) return "Freezing rain";
  if ([71, 73, 75].includes(c)) return "Snow";
  if (c === 77) return "Snow grains";
  if ([80, 81, 82].includes(c)) return "Rain showers";
  if ([85, 86].includes(c)) return "Snow showers";
  if (c === 95) return "Thunderstorm";
  if (c === 96 || c === 99) return "Thunder + hail";
  return `Code ${c}`;
}

function moonPhaseLabel(value01) {
  // Open-Meteo moon_phase is typically 0..1
  const v = Number(value01);
  if (!Number.isFinite(v)) return "—";
  const p = (v % 1 + 1) % 1;
  if (p < 0.03 || p > 0.97) return "New";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

// Approximate moon phase fraction (0-1) from a Date without API support
function moonPhaseFractionFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  // Based on simple synodic cycle approximation
  const synodicMonth = 29.53058867; // days
  const knownNewMoon = new Date("2000-01-06T18:14:00Z").getTime(); // reference new moon
  const daysSince = (d.getTime() - knownNewMoon) / (1000 * 60 * 60 * 24);
  const phase = (daysSince / synodicMonth) % 1;
  return (phase + 1) % 1;
}

function moonIlluminationPercentFromPhaseFraction(phase01) {
  const p = Number(phase01);
  if (!Number.isFinite(p)) return null;
  // Fraction illuminated ~ (1 - cos(2πp)) / 2
  const illum01 = (1 - Math.cos(2 * Math.PI * ((p % 1 + 1) % 1))) / 2;
  const percent = Math.round(illum01 * 1000) / 10; // 0.1% precision
  return percent;
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}). ${text ? text.slice(0, 120) : ""}`.trim());
  }
  return await res.json();
}

async function zipToLatLon(zip) {
  // Zippopotam.us: stable, no auth
  const url = `https://api.zippopotam.us/us/${encodeURIComponent(zip.slice(0, 5))}`;
  const data = await fetchJSON(url);
  const place = data?.places?.[0];
  const lat = place?.latitude ? Number(place.latitude) : NaN;
  const lon = place?.longitude ? Number(place.longitude) : NaN;
  const city = place?.["place name"] || "";
  const state = place?.state || "";
  const label = [city, state].filter(Boolean).join(", ") || data?.["place name"] || "—";

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Could not resolve ZIP to coordinates.");
  return { lat, lon, label };
}

async function placeNameToLatLon(name) {
  const qRaw = String(name || "").trim();
  const q = qRaw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) throw new Error("Enter at least 2 characters for a place search.");

  const US_STATES = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    DC: "District of Columbia",
  };

  const parsed = (() => {
    // Handles: "City, ST" or "City ST" (two-letter state at end)
    const m = q.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
    if (!m) return { city: q, stateAbbr: "" };
    const abbr = m[2].toUpperCase();
    if (!US_STATES[abbr]) return { city: q, stateAbbr: "" };
    return { city: m[1].trim(), stateAbbr: abbr };
  })();

  async function geocode(searchName) {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchName)}` +
      `&count=10&language=en&format=json&countryCode=US`;
    const data = await fetchJSON(url);
    return Array.isArray(data?.results) ? data.results : [];
  }

  let results = await geocode(q);
  if (!results.length && parsed.city && parsed.city !== q) {
    // e.g. "Springfield IL" often matches better as "Springfield"
    results = await geocode(parsed.city);
  }

  const stateName = parsed.stateAbbr ? US_STATES[parsed.stateAbbr] : "";
  const r =
    (stateName ? results.find((x) => (x?.admin1 || "").toLowerCase() === stateName.toLowerCase()) : null) ||
    results[0];

  const lat = Number(r?.latitude);
  const lon = Number(r?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("No matching location found.");
  const parts = [r?.name, r?.admin1, r?.country].filter(Boolean);
  const label = parts.join(", ");
  return { lat, lon, label };
}

async function loadWeather(lat, lon) {
  const daily =
    "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,sunrise,sunset";
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=${daily}&forecast_days=10&timezone=auto&temperature_unit=fahrenheit&windspeed_unit=mph`;
  return await fetchJSON(url);
}

async function loadMarine(lat, lon) {
  const daily = "wave_height_max,wave_period_max";
  const url =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&daily=${daily}&forecast_days=10&timezone=auto`;
  return await fetchJSON(url);
}

function renderForecast(weather) {
  const el = $("#forecastList");
  const d = weather?.daily;
  const times = d?.time || [];

  if (!Array.isArray(times) || times.length === 0) {
    el.innerHTML = `<div class="skeleton">No forecast data available.</div>`;
    return;
  }

  const max = d.temperature_2m_max || [];
  const min = d.temperature_2m_min || [];
  const code = d.weather_code || [];
  const wind = d.wind_speed_10m_max || [];

  el.innerHTML = times
    .slice(0, 10)
    .map((t, idx) => {
      const label = weatherLabelFromCode(code[idx]);
      const hi = Number.isFinite(Number(max[idx])) ? `${Math.round(max[idx])}°F` : "—";
      const lo = Number.isFinite(Number(min[idx])) ? `${Math.round(min[idx])}°F` : "—";
      const w = Number.isFinite(Number(wind[idx])) ? `${Math.round(wind[idx])} mph` : "—";
      const phase = moonPhaseFractionFromDate(new Date(`${t}T12:00:00`));
      const illum = moonIlluminationPercentFromPhaseFraction(phase);
      const illumText = illum == null ? "—" : `${illum.toFixed(1)}%`;
      return `
        <div class="day">
          <div class="dayTop">
            <div class="dayName">${dayName(t)}</div>
            <div class="dayDate">${monthDay(t)}</div>
          </div>
          <div class="dayMain">
            <div class="pill"><span class="icon"></span>${label}</div>
            <div class="pill"><span class="muted">Hi/Lo</span> ${hi} / ${lo}</div>
            <div class="pill"><span class="muted">Wind</span> ${w}</div>
            <div class="pill"><span class="muted">Illum</span> ${illumText}</div>
          </div>
        </div>`;
    })
    .join("");
}

function setOverviewKv(summary, hiLo, windMax, sun, moonPhase) {
  const root = $("#weatherOverview");
  const rows = root.querySelectorAll(".kvRow");
  const setRow = (rowIdx, value) => {
    const row = rows[rowIdx];
    if (!row) return;
    const dd = row.querySelector("dd");
    if (dd) dd.textContent = value;
  };
  setRow(0, summary);
  setRow(1, hiLo);
  setRow(2, windMax);
  setRow(3, sun);
  setRow(4, moonPhase);
}

function setSeaKv(heightMax, periodMax, note) {
  const root = $("#seaOverview");
  const rows = root.querySelectorAll(".kvRow");
  const setRow = (rowIdx, value) => {
    const row = rows[rowIdx];
    if (!row) return;
    const dd = row.querySelector("dd");
    if (dd) dd.textContent = value;
  };
  setRow(0, heightMax);
  setRow(1, periodMax);
  setRow(2, note);
}

function updateStats({ label, lat, lon, days }) {
  setText($("#statLocation"), label || "—");
  setText($("#statCoords"), Number.isFinite(lat) && Number.isFinite(lon) ? formatMGRS(lat, lon) : "—");
  setText($("#statDays"), typeof days === "number" ? String(days) : "—");
}

function setLoadingState(on) {
  $("#zipGo").disabled = on;
  $("#useLast").disabled = on;
  $("#mapUseZip").disabled = on;
}

async function lookupZipAndRender(zip) {
  showError("");
  const raw = String(zip || "").trim();
  const normalizedZip = normalizeZip(raw);

  setLoadingState(true);
  setText($("#weatherUpdated"), "Updated: loading…");
  setText($("#weatherChip"), normalizedZip ? `ZIP: ${normalizedZip}` : `Query: ${raw || "—"}`);
  $("#forecastList").innerHTML = `<div class="skeleton">Loading forecast…</div>`;

  try {
    const resolved = normalizedZip ? await zipToLatLon(normalizedZip) : await placeNameToLatLon(raw);
    const { lat, lon, label } = resolved;
    const [weather, marine] = await Promise.allSettled([loadWeather(lat, lon), loadMarine(lat, lon)]);

    if (weather.status !== "fulfilled") throw weather.reason;
    const w = weather.value;
    const d = w?.daily || {};
    const t0 = d.time?.[0];
    const summary = t0 ? weatherLabelFromCode(d.weather_code?.[0]) : "—";
    const hi = Number.isFinite(Number(d.temperature_2m_max?.[0])) ? `${Math.round(d.temperature_2m_max[0])}°` : "—";
    const lo = Number.isFinite(Number(d.temperature_2m_min?.[0])) ? `${Math.round(d.temperature_2m_min[0])}°` : "—";
    const windMax = Number.isFinite(Number(d.wind_speed_10m_max?.[0]))
      ? `${Math.round(d.wind_speed_10m_max[0])} mph`
      : "—";
    const sunrise = d.sunrise?.[0]
      ? new Date(d.sunrise[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—";
    const sunset = d.sunset?.[0]
      ? new Date(d.sunset[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—";
    const phase = moonPhaseFractionFromDate(new Date(t0 || Date.now()));
    const moon = moonPhaseLabel(phase);
    const illum = moonIlluminationPercentFromPhaseFraction(phase);
    const moonWithIllum = illum == null ? moon : `${moon} (${illum.toFixed(1)}%)`;

    setOverviewKv(
      summary,
      `${hi} / ${lo}`,
      windMax,
      sunrise !== "—" && sunset !== "—" ? `${sunrise} / ${sunset}` : "—",
      moonWithIllum
    );

    renderForecast(w);

    if (marine.status === "fulfilled") {
      const m = marine.value;
      const md = m?.daily || {};
      const hFt = md.wave_height_max?.[0] != null && Number.isFinite(Number(md.wave_height_max[0]))
        ? (Number(md.wave_height_max[0]) * 3.28084).toFixed(1)
        : null;
      const h = hFt != null ? `${hFt} ft` : "—";
      const p =
        md.wave_period_max?.[0] != null && Number.isFinite(Number(md.wave_period_max[0]))
          ? `${Number(md.wave_period_max[0]).toFixed(1)} s`
          : "—";
      const note =
        h === "—" || p === "—"
          ? "Marine forecast not available for this location."
          : "Marine values vary offshore; use as a quick reference.";
      setSeaKv(h, p, note);
    } else {
      setSeaKv("—", "—", "Marine forecast failed to load.");
    }

    if (normalizedZip) writeJSON(STORAGE.lastZip, normalizedZip);
    writeJSON(STORAGE.lastLocationLabel, label);
    writeJSON(STORAGE.lastCoords, { lat, lon });

    updateStats({ label, lat, lon, days: Array.isArray(d.time) ? d.time.length : undefined });
    setText($("#weatherUpdated"), `Updated: ${new Date().toLocaleString()}`);
  } catch (e) {
    const msg = e?.message ? String(e.message) : "Something went wrong loading this ZIP.";
    showError(msg);
    setText($("#weatherUpdated"), "Updated: —");
    updateStats({ label: "—", lat: NaN, lon: NaN, days: undefined });
    setOverviewKv("—", "—", "—", "—", "—");
    setSeaKv("—", "—", "—");
    $("#forecastList").innerHTML = `<div class="skeleton">Enter a ZIP code to load the forecast.</div>`;
  } finally {
    setLoadingState(false);
  }
}

// Mapping
function mapUrl(provider, query) {
  const q = encodeURIComponent(query || "");
  if (!q) return "";
  switch (provider) {
    case "google":
      return `https://www.google.com/maps/search/?api=1&query=${q}`;
    case "osm":
      return `https://www.openstreetmap.org/search?query=${q}`;
    case "bing":
      return `https://www.bing.com/maps?q=${q}`;
    case "caltopo":
      return `https://caltopo.com/map.html#search=${q}`;
    default:
      return "";
  }
}

function getZipLocationLabel() {
  const label = readJSON(STORAGE.lastLocationLabel, "");
  const zip = readJSON(STORAGE.lastZip, "");
  if (label && zip) return `${label} ${zip}`;
  if (zip) return zip;
  return "";
}

function renderPins() {
  const pins = readJSON(STORAGE.mapPins, []);
  const root = $("#pinList");
  if (!pins.length) {
    root.innerHTML = `<div class="muted small">No pinned spots yet.</div>`;
    return;
  }
  root.innerHTML = pins
    .map((p, idx) => {
      const safe = String(p).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return `
        <div class="pin">
          <span>${safe}</span>
          <button type="button" data-pin-open="${idx}">Open</button>
          <button type="button" data-pin-del="${idx}">Remove</button>
        </div>`;
    })
    .join("");

  $$("[data-pin-open]").forEach((b) =>
    b.addEventListener("click", () => {
      const idx = Number(b.getAttribute("data-pin-open"));
      const pins2 = readJSON(STORAGE.mapPins, []);
      const q = pins2[idx];
      if (!q) return;
      window.open(mapUrl("google", q), "_blank", "noopener,noreferrer");
    })
  );
  $$("[data-pin-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const idx = Number(b.getAttribute("data-pin-del"));
      const pins2 = readJSON(STORAGE.mapPins, []);
      pins2.splice(idx, 1);
      writeJSON(STORAGE.mapPins, pins2);
      renderPins();
    })
  );
}

// Checklist
function newTodo(text) {
  return { id: crypto.randomUUID?.() || String(Date.now() + Math.random()), text: String(text).trim(), done: false };
}

function loadTodos() {
  const todos = readJSON(STORAGE.todos, null);
  if (Array.isArray(todos) && todos.length) return todos;
  // sensible defaults
  const defaults = [
    "Water bottle / hydration",
    "Headlamp + batteries",
    "Layers (base + mid + shell)",
    "Snacks",
    "First aid basics",
    "Sunscreen / lip balm",
    "Backup charger / cable",
  ].map(newTodo);
  writeJSON(STORAGE.todos, defaults);
  return defaults;
}

function renderTodos() {
  const root = $("#todoList");
  const todos = readJSON(STORAGE.todos, []);
  if (!todos.length) {
    root.innerHTML = `<div class="muted small">No items yet. Add your go-to packing template.</div>`;
    return;
  }
  root.innerHTML = todos
    .map((t) => {
      const safe = String(t.text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      return `
        <div class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
          <label>
            <input type="checkbox" ${t.done ? "checked" : ""} />
            <span class="todoText">${safe}</span>
          </label>
          <div class="todoActions">
            <button type="button" data-action="delete">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  $$(".todo").forEach((row) => {
    const id = row.getAttribute("data-id");
    const cb = row.querySelector('input[type="checkbox"]');
    const del = row.querySelector('[data-action="delete"]');

    cb?.addEventListener("change", () => {
      const todos2 = readJSON(STORAGE.todos, []);
      const idx = todos2.findIndex((x) => x.id === id);
      if (idx === -1) return;
      todos2[idx] = { ...todos2[idx], done: cb.checked };
      writeJSON(STORAGE.todos, todos2);
      renderTodos();
    });
    del?.addEventListener("click", () => {
      const todos2 = readJSON(STORAGE.todos, []);
      writeJSON(
        STORAGE.todos,
        todos2.filter((x) => x.id !== id)
      );
      renderTodos();
    });
  });
}

function initNotes() {
  const notes = readJSON(STORAGE.notes, "");
  $("#notes").value = typeof notes === "string" ? notes : "";
  $("#notes").addEventListener("input", () => writeJSON(STORAGE.notes, $("#notes").value));
}

function init() {
  // Buttons
  $("#zipGo").addEventListener("click", () => lookupZipAndRender($("#zipInput").value));
  $("#zipInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookupZipAndRender($("#zipInput").value);
  });

  $("#useLast").addEventListener("click", () => {
    const z = readJSON(STORAGE.lastZip, "");
    if (!z) {
      showError("No saved ZIP yet. Enter one above and click Lookup.");
      return;
    }
    $("#zipInput").value = z;
    lookupZipAndRender(z);
  });

  $("#clearAll").addEventListener("click", () => {
    const keys = Object.values(STORAGE);
    keys.forEach((k) => localStorage.removeItem(k));
    showError("");
    $("#zipInput").value = "";
    updateStats({ label: "—", lat: NaN, lon: NaN, days: undefined });
    setText($("#weatherChip"), "ZIP: —");
    setText($("#weatherUpdated"), "Updated: —");
    setOverviewKv("—", "—", "—", "—", "—");
    setSeaKv("—", "—", "—");
    $("#forecastList").innerHTML = `<div class="skeleton">Enter a ZIP code to load the forecast.</div>`;
    renderPins();
    loadTodos();
    renderTodos();
    initNotes();
  });

  // Mapping
  $$("[data-map]").forEach((b) =>
    b.addEventListener("click", () => {
      const provider = b.getAttribute("data-map");
      const q = $("#mapQuery").value.trim();
      if (!q) {
        showError("Enter a map query first (or use ZIP location).");
        return;
      }
      showError("");
      const url = mapUrl(provider, q);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    })
  );

  $("#mapUseZip").addEventListener("click", () => {
    const label = getZipLocationLabel();
    if (!label) {
      showError("No saved ZIP location yet. Lookup a ZIP first.");
      return;
    }
    showError("");
    $("#mapQuery").value = label;
    $("#mapQuery").focus();
  });

  $("#pinCurrent").addEventListener("click", () => {
    const q = $("#mapQuery").value.trim();
    if (!q) return;
    const pins = readJSON(STORAGE.mapPins, []);
    if (!pins.includes(q)) pins.unshift(q);
    writeJSON(STORAGE.mapPins, pins.slice(0, 20));
    renderPins();
  });
  $("#pinClear").addEventListener("click", () => {
    writeJSON(STORAGE.mapPins, []);
    renderPins();
  });

  // Todos
  loadTodos();
  renderTodos();

  $("#todoAddBtn").addEventListener("click", () => {
    const raw = $("#todoInput").value.trim();
    if (!raw) return;
    const todos = readJSON(STORAGE.todos, []);
    todos.unshift(newTodo(raw));
    writeJSON(STORAGE.todos, todos);
    $("#todoInput").value = "";
    renderTodos();
  });
  $("#todoInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#todoAddBtn").click();
  });

  initNotes();
  renderPins();

  // Movement calculator
  const moveMode = $("#moveMode");
  const moveDistance = $("#moveDistance");
  const moveDistUnit = $("#moveDistUnit");
  const movePace = $("#movePace");
  const moveSpeed = $("#moveSpeed");
  const paceField = $("#paceField");
  const speedField = $("#speedField");

  function parseDistanceMiles() {
    const v = Number(String(moveDistance.value || "").trim());
    if (!Number.isFinite(v) || v <= 0) return null;
    const unit = (moveDistUnit?.value || "mi").toLowerCase();
    if (unit === "km") return v * 0.621371; // km -> miles
    return v;
  }

  function parsePaceMinPerMile() {
    const raw = String(movePace.value || "").trim();
    if (!raw) return null;
    // accepts "18" or "18.5" or "18:30"
    const m = raw.match(/^(\d+)(?::([0-5]\d))?$/);
    if (m) {
      const mm = Number(m[1]);
      const ss = m[2] ? Number(m[2]) : 0;
      const total = mm + ss / 60;
      return Number.isFinite(total) && total > 0 ? total : null;
    }
    const f = Number(raw);
    return Number.isFinite(f) && f > 0 ? f : null;
  }

  function parseSpeedMph() {
    const v = Number(String(moveSpeed.value || "").trim());
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function fmtTime(totalMinutes) {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "—";
    const rounded = Math.round(totalMinutes); // quick planning
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    if (h <= 0) return `${m} min`;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  function fmtPace(minPerMile) {
    if (!Number.isFinite(minPerMile) || minPerMile <= 0) return "—";
    const mm = Math.floor(minPerMile);
    const ss = Math.round((minPerMile - mm) * 60);
    const ss2 = ss === 60 ? 59 : ss;
    return `${mm}:${String(ss2).padStart(2, "0")} min/mi`;
  }

  function fmtSpeed(mph) {
    if (!Number.isFinite(mph) || mph <= 0) return "—";
    return `${Math.round(mph * 10) / 10} mph`;
  }

  function renderMovement() {
    const mode = String(moveMode.value || "pace");
    const dist = parseDistanceMiles();
    let pace = null;
    let speed = null;

    if (mode === "pace") {
      pace = parsePaceMinPerMile();
      speed = pace != null ? 60 / pace : null;
    } else {
      speed = parseSpeedMph();
      pace = speed != null ? 60 / speed : null;
    }

    const timeMin = dist != null && pace != null ? dist * pace : null;

    setText($("#moveTime"), timeMin != null ? fmtTime(timeMin) : "—");
    setText($("#moveEqPace"), pace != null ? fmtPace(pace) : "—");
    setText($("#moveEqSpeed"), speed != null ? fmtSpeed(speed) : "—");
  }

  function setMoveMode(mode) {
    moveMode.value = mode;
    const isPace = mode === "pace";
    paceField.classList.toggle("hidden", !isPace);
    speedField.classList.toggle("hidden", isPace);
    renderMovement();
  }

  moveMode?.addEventListener("change", () => setMoveMode(moveMode.value));
  [moveDistance, movePace, moveSpeed].forEach((el) =>
    el?.addEventListener("input", () => renderMovement())
  );
  moveDistUnit?.addEventListener("change", () => renderMovement());

  $("#moveSwap")?.addEventListener("click", () => {
    const mode = String(moveMode.value || "pace");
    const dist = parseDistanceMiles();
    if (mode === "pace") {
      const pace = parsePaceMinPerMile();
      const sp = pace != null ? 60 / pace : null;
      if (sp != null) moveSpeed.value = String(Math.round(sp * 10) / 10);
      setMoveMode("speed");
    } else {
      const sp = parseSpeedMph();
      const pace = sp != null ? 60 / sp : null;
      if (pace != null) {
        const mm = Math.floor(pace);
        const ss = Math.round((pace - mm) * 60);
        movePace.value = `${mm}:${String(Math.min(59, ss)).padStart(2, "0")}`;
      }
      setMoveMode("pace");
    }
    if (dist != null) moveDistance.value = String(dist);
  });

  $("#moveClear")?.addEventListener("click", () => {
    moveDistance.value = "";
    movePace.value = "";
    moveSpeed.value = "";
    renderMovement();
  });

  setMoveMode("pace");

  // Hydrate last saved zip
  const lastZip = readJSON(STORAGE.lastZip, "");
  if (lastZip) {
    $("#zipInput").value = lastZip;
    // don't auto-fetch; keep it snappy and user-controlled
    setText($("#weatherChip"), `ZIP: ${lastZip}`);
    const label = readJSON(STORAGE.lastLocationLabel, "—");
    const coords = readJSON(STORAGE.lastCoords, {});
    updateStats({ label, lat: Number(coords?.lat), lon: Number(coords?.lon), days: undefined });
  }
}

document.addEventListener("DOMContentLoaded", init);

