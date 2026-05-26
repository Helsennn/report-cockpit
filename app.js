const state = {
  data: null,
  baseData: null,
  uploadedRows: [],
  uploadedReplaceDates: true,
  week: "all",
  priceBand: "all",
  buyerType: "all",
  query: "",
  sortKey: "gmv",
  sortDir: "desc",
};

const fmtMoney = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 1,
  }).format(value || 0);

const fmtNum = (value) => new Intl.NumberFormat("en-US").format(value || 0);
const fmtPct = (value) => `${value > 0 ? "+" : ""}${(value || 0).toFixed(1)}%`;
const fmtMaybePct = (value) => (Number.isFinite(value) ? fmtPct(value) : "n/a");
const fmtShort = (value) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);

const svgNS = "http://www.w3.org/2000/svg";
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const priceBandOrder = ["No CPI", "$0-5", "$5-10", "$10-20", "$20-35", "$35-60", "$60+"];
const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const uploadStorageKey = "homeDashboardCsvUploadV1";
const broadcastDayCutoffHour = 3;
const bandColors = {
  "No CPI": "#9c9389",
  "$0-5": "#f7c47a",
  "$5-10": "#f97316",
  "$10-20": "#dc5b42",
  "$20-35": "#9a5a2e",
  "$35-60": "#5c8a4b",
  "$60+": "#477f9c",
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  });
  children.forEach((child) => node.append(child));
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripHtml(value) {
  const tmp = document.createElement("div");
  tmp.innerHTML = value;
  return tmp.textContent || tmp.innerText || "";
}

function debounce(fn, wait = 120) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function hideLoading() {
  const loading = document.querySelector("#loadingState");
  if (!loading) return;
  loading.classList.add("is-hidden");
  loading.setAttribute("aria-hidden", "true");
}

function showError(message) {
  const loading = document.querySelector("#loadingState");
  if (!loading) return;
  loading.classList.remove("is-hidden");
  loading.querySelector("strong").textContent = "Dashboard data could not load";
  loading.querySelector("span").textContent = message;
}

function showTooltip(html, x, y) {
  const tooltip = document.querySelector("#tooltip");
  if (!tooltip) return;
  tooltip.innerHTML = html;
  tooltip.classList.add("is-visible");
  tooltip.style.left = `${Math.min(x + 14, window.innerWidth - tooltip.offsetWidth - 16)}px`;
  tooltip.style.top = `${Math.max(y - tooltip.offsetHeight - 14, 12)}px`;
}

function hideTooltip() {
  const tooltip = document.querySelector("#tooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
}

function attachTooltip(node, html) {
  const text = stripHtml(html);
  node.classList.add("chart-hotspot");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", text);

  const title = svgEl("title");
  title.textContent = text;
  node.prepend(title);

  node.addEventListener("mouseenter", (event) => showTooltip(html, event.clientX, event.clientY));
  node.addEventListener("mousemove", (event) => showTooltip(html, event.clientX, event.clientY));
  node.addEventListener("mouseleave", hideTooltip);
  node.addEventListener("focus", () => {
    const box = node.getBoundingClientRect();
    showTooltip(html, box.left + box.width / 2, box.top);
  });
  node.addEventListener("blur", hideTooltip);
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function readCsvField(row, names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function parseNumber(value) {
  const clean = String(value ?? "").replace(/[$,\s]/g, "");
  const number = Number.parseFloat(clean);
  return Number.isFinite(number) ? number : 0;
}

function parseDateValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
  if (iso) {
    return new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] || 0),
      Number(iso[5] || 0),
      Number(iso[6] || 0),
    );
  }

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (slash) {
    let hour = Number(slash[4] || 0);
    const meridiem = String(slash[7] || "").toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    return new Date(year, Number(slash[1]) - 1, Number(slash[2]), hour, Number(slash[5] || 0), Number(slash[6] || 0));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function broadcastDate(date) {
  return isoDate(date.getHours() < broadcastDayCutoffHour ? addDays(date, -1) : date);
}

function weekInfoForDate(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const jsDay = date.getDay();
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay;
  const start = addDays(date, mondayOffset);
  const end = addDays(start, 6);
  const label = `${start.getMonth() + 1}.${start.getDate()}-${end.getMonth() + 1}.${end.getDate()}`;
  return { label, start: isoDate(start), end: isoDate(end) };
}

function priceBandFromTarget(targetPrice) {
  if (!targetPrice || targetPrice <= 0) return "No CPI";
  if (targetPrice < 5) return "$0-5";
  if (targetPrice < 10) return "$5-10";
  if (targetPrice < 20) return "$10-20";
  if (targetPrice < 35) return "$20-35";
  if (targetPrice < 60) return "$35-60";
  return "$60+";
}

function cleanProductName(value) {
  let name = String(value || "").replace(/\s+/g, " ").trim();
  if (name.includes("#")) name = name.replace(/\s+#\d+\s*$/, "").trim();
  return name.slice(0, 140);
}

function activeCsvStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return !["failed", "cancelled", "canceled"].includes(status);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((item) => item.some((cell) => String(cell).trim()));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells) => {
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function normalizeCsvOrder(row, sourceFile) {
  if (!activeCsvStatus(readCsvField(row, ["cancelled_or_failed", "status", "order_status"]))) return null;
  const placedAt = parseDateValue(readCsvField(row, ["placed_at", "sold_at", "created_at", "order_date", "date", "timestamp"]));
  if (!placedAt) return null;

  const price = parseNumber(readCsvField(row, ["original_item_price", "sold_price", "price", "item_price", "amount", "gmv"]));
  if (price <= 0) return null;

  const targetPrice = parseNumber(readCsvField(row, ["cost_per_item", "target_price", "cpi", "cost", "cogs"]));
  const broadcast = broadcastDate(placedAt);
  const week = weekInfoForDate(broadcast);
  const product = cleanProductName(readCsvField(row, ["product_name", "item_name", "product", "title", "item"]));
  if (!product) return null;

  return {
    order_id: readCsvField(row, ["order_id", "orderid", "id"]),
    week: week.label,
    week_start: week.start,
    week_end: week.end,
    date: isoDate(placedAt),
    broadcast_date: broadcast,
    placed_at: placedAt.toISOString(),
    buyer: readCsvField(row, ["buyer_username", "buyer", "username", "customer", "buyer_name"]),
    product,
    price,
    target_price: targetPrice,
    price_band: priceBandFromTarget(targetPrice),
    buyer_type: "new",
    source: "csv_upload",
    source_file: sourceFile,
  };
}

function estimateStreamHoursFromRows(rows) {
  const timestamps = rows
    .map((row) => parseDateValue(row.placed_at || row.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!timestamps.length) return 0;

  const sessions = [];
  let start = timestamps[0];
  let previous = timestamps[0];
  timestamps.slice(1).forEach((time) => {
    if (time - previous > 90 * 60 * 1000) {
      sessions.push([start, previous]);
      start = time;
    }
    previous = time;
  });
  sessions.push([start, previous]);

  return sessions.reduce((sum, [sessionStart, sessionEnd]) => {
    return sum + Math.max((sessionEnd - sessionStart) / 3600000, 0.5);
  }, 0);
}

function buildWeeks(baseData, records) {
  const weeks = new Map((baseData.weeks || []).map((week) => [week.label, { ...week }]));
  records.forEach((row) => {
    if (!weeks.has(row.week)) {
      const info = row.week_start && row.week_end
        ? { label: row.week, start: row.week_start, end: row.week_end }
        : weekInfoForDate(row.broadcast_date || row.date);
      weeks.set(info.label, info);
    }
  });
  return [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function applyBuyerTypes(records, weeks) {
  const weekStarts = new Map(weeks.map((week) => [week.label, week.start]));
  const basePriorBuyers = new Set(
    (state.baseData?.records || [])
      .filter((row) => row.buyer_type === "returning")
      .map((row) => row.buyer)
      .filter(Boolean),
  );
  const buyersByEarlierWeek = new Map();
  weeks.forEach((week) => {
    buyersByEarlierWeek.set(week.label, new Set(basePriorBuyers));
    records.forEach((row) => {
      const rowStart = weekStarts.get(row.week);
      if (row.buyer && rowStart && rowStart < week.start) buyersByEarlierWeek.get(week.label).add(row.buyer);
    });
  });

  records.forEach((row) => {
    if (row.source !== "csv_upload") return;
    const prior = buyersByEarlierWeek.get(row.week);
    row.buyer_type = prior?.has(row.buyer) ? "returning" : "new";
  });
}

function rebuildDataWithUploads() {
  const baseData = cloneData(state.baseData);
  const uploadedWeeks = new Set(state.uploadedRows.map((row) => row.week));
  const uploadedDates = new Set(state.uploadedRows.map((row) => row.broadcast_date || row.date));
  const baseRecords = state.uploadedReplaceDates
    ? baseData.records.filter((row) => !uploadedDates.has(row.broadcast_date || row.date))
    : baseData.records.slice();
  const records = [...baseRecords, ...state.uploadedRows.map((row) => ({ ...row }))];
  const weeks = buildWeeks(baseData, records);
  applyBuyerTypes(records, weeks);

  const oldWeekly = new Map((baseData.weekly || []).map((week) => [week.week, week]));
  const weekly = weeks.map((week) => {
    const wr = records.filter((row) => row.week === week.label);
    const metrics = aggregateRows(wr);
    const typed = aggregateRowsByType(wr);
    const newType = typed.find((item) => item.buyerType === "new");
    const returningType = typed.find((item) => item.buyerType === "returning");
    const uploadedInWeek = wr.some((row) => row.source === "csv_upload");
    const streamHours = uploadedInWeek ? estimateStreamHoursFromRows(wr) : (oldWeekly.get(week.label)?.stream_hours || 0);

    return {
      week: week.label,
      gmv: Number(metrics.gmv.toFixed(2)),
      orders: metrics.orders,
      buyers: metrics.buyers,
      aov: Number(metrics.aov.toFixed(2)),
      orders_per_buyer: Number(metrics.ordersPerBuyer.toFixed(2)),
      repeat_buyers: Math.round((metrics.repeatRate / 100) * metrics.buyers),
      repeat_rate: Number(metrics.repeatRate.toFixed(2)),
      new_buyers: newType?.buyers || 0,
      returning_buyers: returningType?.buyers || 0,
      new_buyer_pct: metrics.buyers ? Number((((newType?.buyers || 0) / metrics.buyers) * 100).toFixed(2)) : 0,
      returning_buyer_pct: metrics.buyers ? Number((((returningType?.buyers || 0) / metrics.buyers) * 100).toFixed(2)) : 0,
      new_gmv: Number((newType?.gmv || 0).toFixed(2)),
      returning_gmv: Number((returningType?.gmv || 0).toFixed(2)),
      new_gmv_pct: metrics.gmv ? Number((((newType?.gmv || 0) / metrics.gmv) * 100).toFixed(2)) : 0,
      returning_gmv_pct: metrics.gmv ? Number((((returningType?.gmv || 0) / metrics.gmv) * 100).toFixed(2)) : 0,
      stream_hours: Number(streamHours.toFixed(2)),
      gmv_per_hour: streamHours ? Number((metrics.gmv / streamHours).toFixed(2)) : 0,
    };
  });

  weekly.forEach((week, index) => {
    const previous = weekly[index - 1];
    if (previous?.gmv) week.wow_gmv_pct = Number((((week.gmv - previous.gmv) / previous.gmv) * 100).toFixed(2));
    else week.wow_gmv_pct = oldWeekly.get(week.week)?.wow_gmv_pct ?? null;
  });

  const latestWeek = weekly.at(-1)?.week || baseData.latest_week;
  const latestRows = records.filter((row) => row.week === latestWeek);
  const daily = [...new Set(latestRows.map((row) => row.broadcast_date || row.date))]
    .sort()
    .map((date) => {
      const rows = latestRows.filter((row) => (row.broadcast_date || row.date) === date);
      const metrics = aggregateRows(rows);
      return { date, gmv: Number(metrics.gmv.toFixed(2)), orders: metrics.orders, buyers: metrics.buyers };
    });

  return {
    ...baseData,
    generated_at: new Date().toLocaleString(),
    source_note: `${baseData.source_note} CSV upload override is active: ${state.uploadedRows.length.toLocaleString()} rows across ${uploadedWeeks.size} week(s) and ${uploadedDates.size} date(s); ${state.uploadedReplaceDates ? "matching dates replaced" : "rows appended"}.`,
    weeks,
    weekly,
    latest_week: latestWeek,
    latest_daily: daily,
    price_bands_latest: summarizePriceBandsFromRows(latestRows),
    price_bands_all: summarizePriceBandsFromRows(records),
    top_products_latest: aggregateProducts(latestRows).sort((a, b) => b.gmv - a.gmv).slice(0, 30),
    top_products_4w: aggregateProducts(records).sort((a, b) => b.gmv - a.gmv).slice(0, 30),
    records,
  };
}

function refreshDataAfterUpload() {
  state.data = state.uploadedRows.length ? rebuildDataWithUploads() : cloneData(state.baseData);
  document.querySelector("#sourceNote").textContent = state.data.source_note;
  document.querySelector("#generatedAt").textContent = `Updated ${state.data.generated_at}`;
  setOptions();
  if (state.week !== "all" && !state.data.weeks.some((week) => week.label === state.week)) state.week = "all";
  if (state.priceBand !== "all" && !state.data.records.some((row) => row.price_band === state.priceBand)) state.priceBand = "all";
  document.querySelector("#weekFilter").value = state.week;
  document.querySelector("#priceBandFilter").value = state.priceBand;
  render();
}

function updateUploadStatus(message) {
  const node = document.querySelector("#uploadStatus");
  if (node) node.textContent = message;
}

function saveUploads() {
  try {
    if (!state.uploadedRows.length) {
      localStorage.removeItem(uploadStorageKey);
      return;
    }
      localStorage.setItem(uploadStorageKey, JSON.stringify({
      replaceDates: state.uploadedReplaceDates,
      rows: state.uploadedRows,
    }));
  } catch {
    updateUploadStatus("CSV loaded, but browser storage is full. It will reset after refresh.");
  }
}

function loadUploads() {
  try {
    const saved = JSON.parse(localStorage.getItem(uploadStorageKey) || "null");
    if (!saved?.rows?.length) return;
    state.uploadedRows = saved.rows;
    state.uploadedReplaceDates = saved.replaceDates ?? saved.replaceWeeks ?? true;
    document.querySelector("#replaceDatesToggle").checked = state.uploadedReplaceDates;
    updateUploadStatus(`${state.uploadedRows.length.toLocaleString()} uploaded rows restored from this browser.`);
  } catch {
    localStorage.removeItem(uploadStorageKey);
  }
}

function dedupeUploadedRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.order_id
      ? `id:${row.order_id}`
      : `row:${row.date}|${row.buyer}|${row.product}|${row.price}`;
    map.set(key, row);
  });
  return [...map.values()];
}

async function handleCsvUpload(files) {
  const parsedRows = [];
  for (const file of files) {
    const text = await file.text();
    csvToObjects(text).forEach((row) => {
      const normalized = normalizeCsvOrder(row, file.name);
      if (normalized) parsedRows.push(normalized);
    });
  }

  if (!parsedRows.length) {
    updateUploadStatus("No valid paid order rows found in that CSV.");
    return;
  }

  const beforeCount = state.uploadedRows.length;
  state.uploadedRows = dedupeUploadedRows([...state.uploadedRows, ...parsedRows]);
  state.uploadedReplaceDates = document.querySelector("#replaceDatesToggle").checked;
  saveUploads();
  const weeks = new Set(state.uploadedRows.map((row) => row.week));
  const dates = new Set(state.uploadedRows.map((row) => row.broadcast_date || row.date));
  const added = state.uploadedRows.length - beforeCount;
  const replaced = parsedRows.length - added;
  updateUploadStatus(`${state.uploadedRows.length.toLocaleString()} uploaded rows active across ${weeks.size} week(s), ${dates.size} date(s).${replaced > 0 ? ` ${replaced.toLocaleString()} duplicate/corrected rows merged.` : ""}`);
  refreshDataAfterUpload();
}

function getFilteredRows(options = {}) {
  const {
    ignoreWeek = false,
    ignorePriceBand = false,
    ignoreBuyerType = false,
  } = options;
  const data = state.data;
  return data.records.filter((row) => {
    if (!ignoreWeek && state.week !== "all" && row.week !== state.week) return false;
    if (!ignorePriceBand && state.priceBand !== "all" && row.price_band !== state.priceBand) return false;
    if (state.query && !row.product.toLowerCase().includes(state.query)) return false;
    if (!ignoreBuyerType && state.buyerType !== "all" && row.buyer_type !== state.buyerType) return false;
    return true;
  });
}

function getCurrentRows() {
  return getFilteredRows();
}

function aggregateRows(rows) {
  const buyers = new Set(rows.map((row) => row.buyer).filter(Boolean));
  const buyerOrders = new Map();
  let gmv = 0;

  rows.forEach((row) => {
    gmv += row.price;
    if (row.buyer) buyerOrders.set(row.buyer, (buyerOrders.get(row.buyer) || 0) + 1);
  });

  const repeatBuyers = [...buyerOrders.values()].filter((count) => count >= 2).length;
  return {
    gmv,
    orders: rows.length,
    buyers: buyers.size,
    aov: rows.length ? gmv / rows.length : 0,
    ordersPerBuyer: buyers.size ? rows.length / buyers.size : 0,
    repeatRate: buyers.size ? (repeatBuyers / buyers.size) * 100 : 0,
  };
}

function aggregateRowsByType(rows) {
  const byType = new Map([
    ["new", { buyerType: "new", gmv: 0, orders: 0, buyers: new Set() }],
    ["returning", { buyerType: "returning", gmv: 0, orders: 0, buyers: new Set() }],
  ]);

  rows.forEach((row) => {
    const item = byType.get(row.buyer_type);
    if (!item) return;
    item.gmv += row.price;
    item.orders += 1;
    if (row.buyer) item.buyers.add(row.buyer);
  });

  return [...byType.values()].map((item) => ({
    buyerType: item.buyerType,
    gmv: item.gmv,
    orders: item.orders,
    buyers: item.buyers.size,
    aov: item.orders ? item.gmv / item.orders : 0,
    frequency: item.buyers.size ? item.orders / item.buyers.size : 0,
  }));
}

function summarizePriceBandsFromRows(rows) {
  const map = new Map(priceBandOrder.map((band) => [band, { band, gmv: 0, orders: 0, buyers: new Set() }]));
  rows.forEach((row) => {
    const item = map.get(row.price_band);
    if (!item) return;
    item.gmv += row.price;
    item.orders += 1;
    if (row.buyer) item.buyers.add(row.buyer);
  });
  return [...map.values()].map((item) => ({
    band: item.band,
    gmv: item.gmv,
    orders: item.orders,
    buyers: item.buyers.size,
    aov: item.orders ? item.gmv / item.orders : 0,
  }));
}

function groupWeeklyPriceBands(rows) {
  const weeks = state.data.weekly.map((week) => week.week);
  const map = new Map();
  weeks.forEach((week) => {
    map.set(week, new Map(priceBandOrder.map((band) => [band, { band, gmv: 0, orders: 0, buyers: new Set() }])));
  });

  rows.forEach((row) => {
    const weekMap = map.get(row.week);
    if (!weekMap) return;
    const item = weekMap.get(row.price_band);
    if (!item) return;
    item.gmv += row.price;
    item.orders += 1;
    if (row.buyer) item.buyers.add(row.buyer);
  });

  return weeks.map((week) => {
    const bands = [...map.get(week).values()].map((item) => ({
      band: item.band,
      gmv: item.gmv,
      orders: item.orders,
      buyers: item.buyers.size,
    }));
    const total = bands.reduce((sum, item) => sum + item.gmv, 0);
    return { week, total, bands };
  });
}

function groupWeeklyBuyerTypes(rows) {
  const weeks = state.data.weekly.map((week) => week.week);
  return weeks.map((week) => {
    const weeklyRows = rows.filter((row) => row.week === week);
    const typed = aggregateRowsByType(weeklyRows);
    const totalGmv = typed.reduce((sum, item) => sum + item.gmv, 0);
    const totalBuyers = typed.reduce((sum, item) => sum + item.buyers, 0);
    return {
      week,
      totalGmv,
      totalBuyers,
      types: typed.map((item) => ({
        ...item,
        gmvPct: totalGmv ? (item.gmv / totalGmv) * 100 : 0,
        buyerPct: totalBuyers ? (item.buyers / totalBuyers) * 100 : 0,
      })),
    };
  });
}

function rowsForWeek(rows, label) {
  return rows.filter((row) => row.week === label);
}

function aggregateProducts(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.product)) {
      map.set(row.product, { product: row.product, gmv: 0, orders: 0, buyers: new Set() });
    }
    const item = map.get(row.product);
    item.gmv += row.price;
    item.orders += 1;
    if (row.buyer) item.buyers.add(row.buyer);
  });

  return [...map.values()].map((item) => ({
    product: item.product,
    gmv: item.gmv,
    orders: item.orders,
    buyers: item.buyers.size,
    aov: item.orders ? item.gmv / item.orders : 0,
  }));
}

function localWeekdayIndex(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const dayIndex = new Date(year, month - 1, day).getDay();
  return dayIndex === 0 ? 6 : dayIndex - 1;
}

function describeActiveScope() {
  return [
    state.week === "all" ? "Rolling 4W" : state.week,
    state.priceBand === "all" ? "all CPI" : `CPI ${state.priceBand}`,
    state.buyerType === "all" ? "all buyers" : state.buyerType,
    state.query ? `"${state.query}"` : "",
  ].filter(Boolean).join(" · ");
}

function groupedProducts(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.product)) {
      map.set(row.product, { product: row.product, gmv: 0, orders: 0, buyers: new Set() });
    }
    const item = map.get(row.product);
    item.gmv += row.price;
    item.orders += 1;
    if (row.buyer) item.buyers.add(row.buyer);
  });

  return [...map.values()].map((item) => ({
    ...item,
    buyers: item.buyers.size,
    aov: item.orders ? item.gmv / item.orders : 0,
  }));
}

function sortedProducts(rows) {
  const direction = state.sortDir === "asc" ? 1 : -1;
  return groupedProducts(rows)
    .sort((a, b) => {
      const av = a[state.sortKey];
      const bv = b[state.sortKey];
      if (typeof av === "string") return collator.compare(av, bv) * direction;
      return ((av > bv) - (av < bv)) * direction || b.gmv - a.gmv;
    })
    .slice(0, 50);
}

function setOptions() {
  const weekSelect = document.querySelector("#weekFilter");
  weekSelect.replaceChildren(
    el("option", { value: "all" }, [document.createTextNode("All rolling 4 weeks")]),
    ...state.data.weeks.map((week) => el("option", { value: week.label }, [document.createTextNode(week.label)])),
  );

  const priceSelect = document.querySelector("#priceBandFilter");
  const presentBands = new Set(state.data.records.map((row) => row.price_band));
  const bands = ["all", ...priceBandOrder.filter((band) => presentBands.has(band))];
  priceSelect.replaceChildren(
    ...bands.map((band) =>
      el("option", { value: band }, [document.createTextNode(band === "all" ? "All CPI bands" : band)]),
    ),
  );
}

function latestWeek() {
  return state.data.weekly[state.data.weekly.length - 1];
}

function focusWeekLabel() {
  return state.week === "all" ? latestWeek().week : state.week;
}

function weekMeta(label) {
  return state.data.weekly.find((week) => week.week === label);
}

function weekIndex(label) {
  return state.data.weekly.findIndex((week) => week.week === label);
}

function isUnfilteredView() {
  return state.priceBand === "all" && state.buyerType === "all" && !state.query;
}

function weeklyStatsFromRows(rows) {
  const weekly = state.data.weekly.map((meta) => {
    const wr = rows.filter((row) => row.week === meta.week);
    const metrics = aggregateRows(wr);
    return {
      ...meta,
      gmv: metrics.gmv,
      orders: metrics.orders,
      buyers: metrics.buyers,
      aov: metrics.aov,
      orders_per_buyer: metrics.ordersPerBuyer,
      repeat_rate: metrics.repeatRate,
    };
  });

  weekly.forEach((item, index) => {
    const previous = weekly[index - 1];
    if (previous && previous.gmv) {
      item.wow_gmv_pct = ((item.gmv - previous.gmv) / previous.gmv) * 100;
    } else if (index === 0 && isUnfilteredView()) {
      item.wow_gmv_pct = weekMeta(item.week)?.wow_gmv_pct ?? null;
    } else {
      item.wow_gmv_pct = null;
    }
  });

  return weekly;
}

function focusWeekContext(comparisonRows) {
  const label = focusWeekLabel();
  const meta = weekMeta(label);
  const index = weekIndex(label);
  const focusRows = comparisonRows.filter((row) => row.week === label);
  const focusMetrics = aggregateRows(focusRows);
  const hours = meta?.stream_hours || 0;
  const gmvPerHour = hours ? focusMetrics.gmv / hours : 0;

  let prevLabel = null;
  let prevGmv = null;
  let wowPct = null;
  if (index > 0) {
    prevLabel = state.data.weekly[index - 1].week;
    prevGmv = comparisonRows
      .filter((row) => row.week === prevLabel)
      .reduce((sum, row) => sum + row.price, 0);
    wowPct = prevGmv ? ((focusMetrics.gmv - prevGmv) / prevGmv) * 100 : null;
  } else if (isUnfilteredView() && meta) {
    prevLabel = state.data.baseline_week?.label || "prior week";
    prevGmv = state.data.baseline_week?.gmv || null;
    wowPct = meta.wow_gmv_pct;
  }

  return {
    label,
    metrics: focusMetrics,
    hours,
    gmvPerHour,
    prevLabel,
    prevGmv,
    wowPct,
    delta: Number.isFinite(prevGmv) ? focusMetrics.gmv - prevGmv : null,
  };
}

function renderKpis(rows, comparisonRows) {
  const metrics = aggregateRows(rows);
  const focus = focusWeekContext(comparisonRows);
  const wowLabel = state.week === "all" ? "Latest WoW" : "Selected WoW";
  const cards = [
    ["GMV", fmtMoney(metrics.gmv), state.week === "all" ? "Filtered rolling period" : state.week],
    ["Orders", fmtNum(metrics.orders), `${metrics.ordersPerBuyer.toFixed(2)} orders / buyer`],
    ["Buyer Count", fmtNum(metrics.buyers), `${metrics.repeatRate.toFixed(1)}% repeat rate`],
    ["AOV", fmtMoney(metrics.aov), "Average sold price"],
    [wowLabel, fmtMaybePct(focus.wowPct), `${focus.label} vs ${focus.prevLabel || "prior week"}`, focus.wowPct < 0],
    ["GMV/hr", fmtMoney(focus.gmvPerHour), `${focus.label} · ${focus.hours.toFixed(1)} stream hours`],
  ];

  document.querySelector("#kpiGrid").replaceChildren(
    ...cards.map(([label, value, sub, negative]) =>
      el("article", { class: "kpi" }, [
        el("span", {}, [document.createTextNode(label)]),
        el("strong", { class: negative ? "negative" : "" }, [document.createTextNode(value)]),
        el("em", {}, [document.createTextNode(sub)]),
      ]),
    ),
  );
}

function renderActiveFilters() {
  const filters = [
    ["Week", state.week === "all" ? "All rolling 4 weeks" : state.week],
    ["CPI", state.priceBand === "all" ? "All CPI bands" : state.priceBand],
    ["Buyer", state.buyerType === "all" ? "New + returning" : state.buyerType],
  ];
  if (state.query) filters.push(["Product", state.query]);

  document.querySelector("#activeFilters").replaceChildren(
    ...filters.map(([label, value]) =>
      el("span", { class: "filter-chip" }, [
        el("small", {}, [document.createTextNode(label)]),
        document.createTextNode(value),
      ]),
    ),
  );
}

function renderInsights(rows, comparisonRows) {
  const focus = focusWeekContext(comparisonRows);
  const bandLeader = [...summarizePriceBandsFromRows(rows)].sort((a, b) => b.gmv - a.gmv)[0];
  const metrics = aggregateRows(rows);
  const tone = focus.wowPct < 0 ? "negative" : "positive";
  const insights = [
    {
      mark: "GMV",
      label: state.week === "all" ? "Latest weekly movement" : "Selected weekly movement",
      value: `${fmtMaybePct(focus.wowPct)} WoW`,
      detail: Number.isFinite(focus.delta)
        ? `${focus.label} changed ${fmtMoney(focus.delta)} from ${focus.prevLabel}.`
        : `${focus.label} has no comparable prior filtered week.`,
      tone,
    },
    {
      mark: "PB",
      label: "Active CPI-band leader",
      value: bandLeader?.band || "n/a",
      detail: bandLeader
        ? `${fmtMoney(bandLeader.gmv)} GMV and ${fmtNum(bandLeader.orders)} orders under current filters.`
        : "No CPI-band rows under current filters.",
      tone: "warm",
    },
    {
      mark: "RET",
      label: "Filtered repeat signal",
      value: `${metrics.repeatRate.toFixed(1)}% repeat`,
      detail: `${fmtNum(metrics.buyers)} buyers and ${metrics.ordersPerBuyer.toFixed(2)} orders per buyer.`,
      tone: "green",
    },
  ];

  document.querySelector("#insightGrid").replaceChildren(
    ...insights.map((item) =>
      el("article", { class: `insight ${item.tone}` }, [
        el("span", { class: "insight-mark" }, [document.createTextNode(item.mark)]),
        el("div", {}, [
          el("small", {}, [document.createTextNode(item.label)]),
          el("strong", {}, [document.createTextNode(item.value)]),
          el("p", {}, [document.createTextNode(item.detail)]),
        ]),
      ]),
    ),
  );
}

function addDefs(svg) {
  const defsNode = svgEl("defs");
  const grad = svgEl("linearGradient", { id: "barGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(svgEl("stop", { offset: "0%", "stop-color": "#ffb05c" }));
  grad.append(svgEl("stop", { offset: "100%", "stop-color": "#f97316" }));
  defsNode.append(grad);
  svg.append(defsNode);
}

function chartScaffold(target, viewBox = "0 0 760 290", label = "") {
  const host = document.querySelector(target);
  host.replaceChildren();
  const svg = svgEl("svg", { viewBox, role: "img", "aria-label": label });
  host.append(svg);
  return svg;
}

function drawGrid(svg, left, top, width, height, ticks, max, formatter) {
  for (let i = 0; i <= ticks; i++) {
    const y = top + height - (height * i) / ticks;
    svg.append(svgEl("line", { x1: left, y1: y, x2: left + width, y2: y, stroke: "#efe5dc" }));
    const label = svgEl("text", { x: left - 8, y: y + 4, "text-anchor": "end", class: "tick" });
    label.textContent = formatter((max * i) / ticks);
    svg.append(label);
  }
}

function animateRect(rect, axis = "y") {
  rect.classList.add("animated-bar");
  rect.dataset.animateAxis = axis;
}

function animatedPath(attrs) {
  return svgEl("path", {
    ...attrs,
    class: `${attrs.class || ""} animated-line`.trim(),
  });
}

function animatedDot(attrs) {
  return svgEl("circle", {
    ...attrs,
    class: `${attrs.class || ""} chart-dot`.trim(),
  });
}

function pathFromPoints(points) {
  return points.map((point, index) => `${index ? "L" : "M"} ${point[0]} ${point[1]}`).join(" ");
}

function addLineHoverPath(svg, d, html) {
  const hitPath = svgEl("path", {
    d,
    fill: "none",
    stroke: "transparent",
    "stroke-width": 24,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: "line-hit-area",
  });
  attachTooltip(hitPath, html);
  svg.append(hitPath);
}

function replayChartAnimations() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.querySelectorAll(".animated-bar").forEach((node, index) => {
    node.getAnimations().forEach((animation) => animation.cancel());
    const axis = node.dataset.animateAxis === "x" ? "X" : "Y";
    node.animate(
      [
        { opacity: 0, transform: `scale${axis}(0.04)` },
        { opacity: 1, transform: `scale${axis}(1)` },
      ],
      {
        duration: 620,
        delay: Math.min(index * 18, 260),
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        fill: "both",
      },
    );
  });

  document.querySelectorAll(".animated-line").forEach((node, index) => {
    node.getAnimations().forEach((animation) => animation.cancel());
    const dashed = node.getAttribute("stroke-dasharray");
    if (dashed && dashed !== "none") {
      node.style.strokeDasharray = dashed;
      node.style.strokeDashoffset = "24";
      const animation = node.animate(
        [
          { opacity: 0, strokeDashoffset: 24, transform: "translateY(8px)" },
          { opacity: 1, strokeDashoffset: 0, transform: "translateY(0)" },
        ],
        {
          duration: 820,
          delay: 180 + index * 80,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "both",
        },
      );
      animation.finished
        .then(() => {
          node.style.opacity = "1";
          node.style.strokeDashoffset = "0";
        })
        .catch(() => {});
      return;
    }

    let length = 0;
    try {
      length = node.getTotalLength();
    } catch (error) {
      return;
    }
    if (!length) return;
    node.style.strokeDasharray = length;
    node.style.strokeDashoffset = length;
    const animation = node.animate(
      [
        { strokeDashoffset: length },
        { strokeDashoffset: 0 },
      ],
      {
        duration: 980,
        delay: 180 + index * 80,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        fill: "forwards",
      },
    );
    animation.finished
      .then(() => {
        node.style.strokeDashoffset = "0";
      })
      .catch(() => {});
  });

  document.querySelectorAll(".chart-dot").forEach((node, index) => {
    node.getAnimations().forEach((animation) => animation.cancel());
    node.animate(
      [
        { opacity: 0, transform: "scale(0.25)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      {
        duration: 420,
        delay: 420 + Math.min(index * 22, 240),
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        fill: "both",
      },
    );
  });
}

function drawLegend(svg, items, x, y, maxWidth = 760) {
  let cursorX = x;
  let cursorY = y;
  items.forEach((item) => {
    if (cursorX + item.width > x + maxWidth) {
      cursorX = x;
      cursorY += 26;
    }
    svg.append(svgEl("rect", { x: cursorX, y: cursorY - 12, width: 14, height: 14, rx: 4, fill: item.color }));
    const label = svgEl("text", { x: cursorX + 20, y: cursorY, class: "series-label" });
    label.textContent = item.label;
    svg.append(label);
    cursorX += item.width;
  });
}

function drawWeeklyGmv(rows) {
  const svg = chartScaffold("#weeklyGmvChart", "0 0 940 390", "Weekly GMV with WoW trend line");
  addDefs(svg);
  const data = weeklyStatsFromRows(rows);
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 250;
  const max = Math.max(Math.ceil(Math.max(...data.map((d) => d.gmv), 1) / 10000) * 10000, 1);
  drawGrid(svg, left, top, width, height, 4, max, fmtMoney);
  const barW = 88;
  const points = [];
  const wowValues = data.map((d) => d.wow_gmv_pct).filter(Number.isFinite);
  const wowAbs = Math.max(100, Math.max(...wowValues.map((value) => Math.abs(value)), 0) * 1.4);

  data.forEach((d, i) => {
    const x = left + (width * (i + 0.5)) / data.length;
    const h = (d.gmv / max) * height;
    const y = top + height - h;
    const rect = svgEl("rect", { x: x - barW / 2, y, width: barW, height: h, rx: 12, fill: "url(#barGrad)" });
    animateRect(rect);
    attachTooltip(rect, `<strong>${escapeHtml(d.week)}</strong><br>GMV ${fmtMoney(d.gmv)}<br>WoW ${fmtMaybePct(d.wow_gmv_pct)}`);
    svg.append(rect);

    const label = svgEl("text", { x, y: top + height + 28, "text-anchor": "middle", class: "axis-label" });
    label.textContent = d.week;
    svg.append(label);

    const value = svgEl("text", { x, y: Math.max(y - 14, top + 16), "text-anchor": "middle", class: "axis-label" });
    value.textContent = fmtShort(d.gmv);
    svg.append(value);

    const wowValue = Number.isFinite(d.wow_gmv_pct) ? d.wow_gmv_pct : 0;
    const wy = top + height / 2 - (wowValue / wowAbs) * (height / 2);
    points.push([x, wy, d]);
  });

  const lineD = pathFromPoints(points);
  svg.append(animatedPath({
    d: lineD,
    fill: "none",
    stroke: "#dc5b42",
    "stroke-width": 5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }));
  addLineHoverPath(svg, lineD, "<strong>WoW trend</strong><br>Hover any point for exact weekly movement.");

  points.forEach(([x, y, d]) => {
    const dot = animatedDot({ cx: x, cy: y, r: 7, fill: "#dc5b42", stroke: "#fffaf4", "stroke-width": 3 });
    attachTooltip(dot, `<strong>${escapeHtml(d.week)} WoW</strong><br>${fmtMaybePct(d.wow_gmv_pct)}<br>GMV ${fmtMoney(d.gmv)}`);
    svg.append(dot);
  });

  const note = svgEl("text", { x: left + width, y: top + 14, "text-anchor": "end", class: "chart-title-note" });
  note.textContent = "Hover points for WoW %";
  svg.append(note);
}

function drawBarChart(target, rows, key, valueKey, color = "#f97316", formatter = fmtMoney, label = "") {
  const svg = chartScaffold(target, "0 0 940 390", label);
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 260;
  const max = Math.max(...rows.map((d) => d[valueKey]), 1);
  drawGrid(svg, left, top, width, height, 4, max, formatter);
  const barW = width / rows.length - 20;

  rows.forEach((d, i) => {
    const x = left + i * (width / rows.length) + 8;
    const h = (d[valueKey] / max) * height;
    const y = top + height - h;
    const rect = svgEl("rect", { x, y, width: barW, height: h, rx: 8, fill: color });
    animateRect(rect);
    attachTooltip(rect, `<strong>CPI ${escapeHtml(d[key])}</strong><br>GMV ${fmtMoney(d.gmv)}<br>Orders ${fmtNum(d.orders)}<br>Buyers ${fmtNum(d.buyers)}`);
    svg.append(rect);

    const labelNode = svgEl("text", { x: x + barW / 2, y: top + height + 34, "text-anchor": "middle", class: "axis-label" });
    labelNode.textContent = d[key];
    svg.append(labelNode);
  });

  const note = svgEl("text", { x: left + width, y: top + 14, "text-anchor": "end", class: "chart-title-note" });
  note.textContent = state.week === "all" ? "Current filters: rolling 4 weeks" : `Current filters: ${state.week}`;
  svg.append(note);
}

function drawPriceBandStacked(rows) {
  const data = groupWeeklyPriceBands(rows);
  const svg = chartScaffold("#priceBandStackChart", "0 0 940 430", "Rolling four week CPI target band GMV stacked bars");
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 270;
  const max = Math.ceil(Math.max(...data.map((d) => d.total), 1) / 10000) * 10000;
  drawGrid(svg, left, top, width, height, 4, max, fmtMoney);
  drawLegend(
    svg,
    priceBandOrder.map((band) => ({ label: band, color: bandColors[band], width: band.length > 5 ? 90 : 72 })),
    left,
    382,
    760,
  );

  const columnW = 94;
  data.forEach((week, i) => {
    const x = left + (width * (i + 0.5)) / data.length - columnW / 2;
    let yCursor = top + height;
    week.bands.forEach((band) => {
      const h = max ? (band.gmv / max) * height : 0;
      if (h <= 0) return;
      yCursor -= h;
      const rect = svgEl("rect", { x, y: yCursor, width: columnW, height: h, rx: h > 16 ? 8 : 3, fill: bandColors[band.band] });
      animateRect(rect);
      attachTooltip(
        rect,
        `<strong>${escapeHtml(week.week)} CPI ${escapeHtml(band.band)}</strong><br>GMV ${fmtMoney(band.gmv)}<br>Orders ${fmtNum(band.orders)}<br>Buyers ${fmtNum(band.buyers)}`,
      );
      svg.append(rect);
    });

    const label = svgEl("text", { x: x + columnW / 2, y: top + height + 34, "text-anchor": "middle", class: "axis-label" });
    label.textContent = week.week;
    svg.append(label);

    const total = svgEl("text", { x: x + columnW / 2, y: Math.max(top + height - (week.total / max) * height - 14, top + 16), "text-anchor": "middle", class: "axis-label" });
    total.textContent = fmtShort(week.total);
    svg.append(total);
  });
}

function drawPriceBandShare(rows) {
  const data = groupWeeklyPriceBands(rows);
  const svg = chartScaffold("#priceBandShareChart", "0 0 940 430", "Rolling four week CPI target band GMV percentage stacked bars");
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 270;
  drawGrid(svg, left, top, width, height, 4, 100, (v) => `${v.toFixed(0)}%`);
  drawLegend(
    svg,
    priceBandOrder.map((band) => ({ label: band, color: bandColors[band], width: band.length > 5 ? 90 : 72 })),
    left,
    382,
    760,
  );

  const columnW = 94;
  data.forEach((week, i) => {
    const x = left + (width * (i + 0.5)) / data.length - columnW / 2;
    let yCursor = top + height;
    week.bands.forEach((band) => {
      const pct = week.total ? (band.gmv / week.total) * 100 : 0;
      const h = (pct / 100) * height;
      if (h <= 0) return;
      yCursor -= h;
      const rect = svgEl("rect", { x, y: yCursor, width: columnW, height: h, rx: h > 16 ? 8 : 3, fill: bandColors[band.band] });
      animateRect(rect);
      attachTooltip(
        rect,
        `<strong>${escapeHtml(week.week)} CPI ${escapeHtml(band.band)}</strong><br>${pct.toFixed(1)}% of GMV<br>GMV ${fmtMoney(band.gmv)}`,
      );
      svg.append(rect);
    });

    const label = svgEl("text", { x: x + columnW / 2, y: top + height + 34, "text-anchor": "middle", class: "axis-label" });
    label.textContent = week.week;
    svg.append(label);
  });
}

function drawStackedNewReturning(rows) {
  const svg = chartScaffold("#newReturningChart", "0 0 940 390", "New and returning customer GMV split");
  const data = groupWeeklyBuyerTypes(rows).map((week) => {
    const newType = week.types.find((type) => type.buyerType === "new") || { gmvPct: 0 };
    const returningType = week.types.find((type) => type.buyerType === "returning") || { gmvPct: 0 };
    return {
      week: week.week,
      new_gmv_pct: newType.gmvPct,
      returning_gmv_pct: returningType.gmvPct,
      new_gmv: newType.gmv || 0,
      returning_gmv: returningType.gmv || 0,
    };
  });
  const left = 128;
  const top = 42;
  const width = 680;
  const rowH = 48;
  drawLegend(svg, [
    { label: "New GMV", color: "#f97316", width: 112 },
    { label: "Returning GMV", color: "#9a5a2e", width: 150 },
  ], left, 342);

  data.forEach((d, i) => {
    const y = top + i * 64;
    const newW = (d.new_gmv_pct / 100) * width;
    const weekLabel = svgEl("text", { x: left - 10, y: y + 25, "text-anchor": "end", class: "axis-label" });
    weekLabel.textContent = d.week;
    svg.append(weekLabel);
    svg.append(svgEl("rect", { x: left, y, width, height: rowH, rx: 10, fill: "#f3e7da" }));

    const newRect = svgEl("rect", { x: left, y, width: newW, height: rowH, rx: 10, fill: "#f97316" });
    animateRect(newRect, "x");
    attachTooltip(newRect, `<strong>${escapeHtml(d.week)} new GMV</strong><br>${d.new_gmv_pct.toFixed(1)}% of GMV<br>${fmtMoney(d.new_gmv)}`);
    svg.append(newRect);

    const returningRect = svgEl("rect", { x: left + newW, y, width: width - newW, height: rowH, rx: 10, fill: "#9a5a2e" });
    animateRect(returningRect, "x");
    attachTooltip(returningRect, `<strong>${escapeHtml(d.week)} returning GMV</strong><br>${d.returning_gmv_pct.toFixed(1)}% of GMV<br>${fmtMoney(d.returning_gmv)}`);
    svg.append(returningRect);

    const pctLabel = svgEl("text", { x: left + width + 16, y: y + 30, class: "axis-label" });
    pctLabel.textContent = `${d.new_gmv_pct.toFixed(0)}% / ${d.returning_gmv_pct.toFixed(0)}%`;
    svg.append(pctLabel);
  });
}

function drawBuyerRepeat(rows) {
  const svg = chartScaffold("#buyerRepeatChart", "0 0 940 390", "Buyer count with repeat-rate line");
  const data = weeklyStatsFromRows(rows);
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 260;
  const maxBuyers = Math.max(Math.ceil(Math.max(...data.map((d) => d.buyers), 1) / 500) * 500, 1);
  drawGrid(svg, left, top, width, height, 4, maxBuyers, fmtNum);
  const barW = 88;
  const points = [];

  data.forEach((d, i) => {
    const x = left + (width * (i + 0.5)) / data.length;
    const h = (d.buyers / maxBuyers) * height;
    const y = top + height - h;
    const bar = svgEl("rect", { x: x - barW / 2, y, width: barW, height: h, rx: 10, fill: "#f59e0b" });
    animateRect(bar);
    attachTooltip(bar, `<strong>${escapeHtml(d.week)}</strong><br>Buyers ${fmtNum(d.buyers)}<br>Repeat ${d.repeat_rate.toFixed(1)}%`);
    svg.append(bar);
    const weekLabel = svgEl("text", { x, y: top + height + 34, "text-anchor": "middle", class: "axis-label" });
    weekLabel.textContent = d.week;
    svg.append(weekLabel);
    points.push([x, top + height - (d.repeat_rate / 50) * height, d]);
  });

  const lineD = pathFromPoints(points);
  svg.append(animatedPath({
    d: lineD,
    fill: "none",
    stroke: "#5c8a4b",
    "stroke-width": 5,
    "stroke-linecap": "round",
  }));
  addLineHoverPath(svg, lineD, "<strong>Repeat-rate trend</strong><br>Hover any point for exact weekly repeat rate.");

  points.forEach(([x, y, d]) => {
    const dot = animatedDot({ cx: x, cy: y, r: 6, fill: "#5c8a4b", stroke: "#fffaf4", "stroke-width": 3 });
    attachTooltip(dot, `<strong>${escapeHtml(d.week)} repeat rate</strong><br>${d.repeat_rate.toFixed(1)}%`);
    svg.append(dot);
  });

  const note = svgEl("text", { x: left + width, y: top + 14, "text-anchor": "end", class: "chart-title-note" });
  note.textContent = "Hover line points for repeat rate";
  svg.append(note);
}

function drawConversion(rows) {
  const weekly = weeklyStatsFromRows(rows).map((d) => ({
    week: d.week,
    buyersPerHour: d.stream_hours ? d.buyers / d.stream_hours : 0,
    ordersPerHour: d.stream_hours ? d.orders / d.stream_hours : 0,
  }));
  const svg = chartScaffold("#conversionChart", "0 0 940 390", "Weekly orders per hour and buyers per hour");
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 260;
  const max = Math.ceil(Math.max(...weekly.map((d) => d.ordersPerHour), 1) / 20) * 20;
  drawGrid(svg, left, top, width, height, 4, max, (v) => `${v.toFixed(0)}/h`);

  const line = (field, color, label) => {
    const points = weekly.map((d, i) => {
      const x = left + (width * (i + 0.5)) / weekly.length;
      const y = top + height - (d[field] / max) * height;
      return [x, y, d];
    });
    const lineD = pathFromPoints(points);
    svg.append(animatedPath({
      d: lineD,
      fill: "none",
      stroke: color,
      "stroke-width": 5,
      "stroke-linecap": "round",
    }));
    addLineHoverPath(svg, lineD, `<strong>${escapeHtml(label)}/hr trend</strong><br>Hover any point for exact weekly rate.`);
    points.forEach(([x, y, d]) => {
      const dot = animatedDot({ cx: x, cy: y, r: 5, fill: color, stroke: "#fffaf4", "stroke-width": 2 });
      attachTooltip(dot, `<strong>${escapeHtml(d.week)}</strong><br>${escapeHtml(label)} ${d[field].toFixed(1)}/h`);
      svg.append(dot);
    });
  };

  line("ordersPerHour", "#dc5b42", "Orders");
  line("buyersPerHour", "#9a5a2e", "Buyers");
  drawLegend(svg, [
    { label: "Orders/hr", color: "#dc5b42", width: 112 },
    { label: "Buyers/hr", color: "#9a5a2e", width: 112 },
  ], left, 354);
  weekly.forEach((d, i) => {
    const x = left + (width * (i + 0.5)) / weekly.length;
    const weekLabel = svgEl("text", { x, y: top + height + 34, "text-anchor": "middle", class: "axis-label" });
    weekLabel.textContent = d.week;
    svg.append(weekLabel);
  });
}

function drawNewReturningAovFrequency(rows) {
  const weekly = groupWeeklyBuyerTypes(rows);
  const svg = chartScaffold("#newReturningAovFreqChart", "0 0 940 520", "New versus returning AOV and order frequency");
  const left = 98;
  const width = 760;
  const sectionH = 150;
  const aovTop = 48;
  const freqTop = 260;
  const maxAov = Math.ceil(Math.max(...weekly.flatMap((week) => week.types.map((type) => type.aov)), 1) / 5) * 5 || 5;
  const maxFreq = Math.ceil(Math.max(...weekly.flatMap((week) => week.types.map((type) => type.frequency)), 1) / 0.5) * 0.5 || 1;
  drawGrid(svg, left, aovTop, width, sectionH, 3, maxAov, fmtMoney);
  drawGrid(svg, left, freqTop, width, sectionH, 3, maxFreq, (v) => v.toFixed(1));
  drawLegend(svg, [
    { label: "New AOV", color: "#dc5b42", width: 118 },
    { label: "Returning AOV", color: "#477f9c", width: 158 },
    { label: "New freq", color: "#5c8a4b", width: 118 },
    { label: "Returning freq", color: "#89577b", width: 158 },
  ], left, 472, 760);

  const aovLabel = svgEl("text", { x: left, y: aovTop - 18, class: "chart-title-note" });
  aovLabel.textContent = "AOV ($ / order)";
  svg.append(aovLabel);

  const freqLabel = svgEl("text", { x: left, y: freqTop - 18, class: "chart-title-note" });
  freqLabel.textContent = "Frequency (orders / buyer)";
  svg.append(freqLabel);

  svg.append(svgEl("line", { x1: left, y1: 228, x2: left + width, y2: 228, stroke: "#ead8c6", "stroke-dasharray": "5 8" }));

  const slotW = width / weekly.length;
  const aovPoints = { new: [], returning: [] };
  const freqPoints = { new: [], returning: [] };

  weekly.forEach((week, i) => {
    const center = left + slotW * (i + 0.5);
    week.types.forEach((type) => {
      const aovY = aovTop + sectionH - (type.aov / maxAov) * sectionH;
      const freqY = freqTop + sectionH - (type.frequency / maxFreq) * sectionH;
      aovPoints[type.buyerType].push([center, aovY, type, week]);
      freqPoints[type.buyerType].push([center, freqY, type, week]);
    });

    const weekLabel = svgEl("text", { x: center, y: freqTop + sectionH + 34, "text-anchor": "middle", class: "axis-label" });
    weekLabel.textContent = week.week;
    svg.append(weekLabel);
  });

  const drawLine = (points, color, label, metric, dashed = false) => {
    if (!points.length) return;
    const lineD = pathFromPoints(points);
    svg.append(animatedPath({
      d: lineD,
      fill: "none",
      stroke: color,
      "stroke-width": 4,
      "stroke-linecap": "round",
      "stroke-dasharray": dashed ? "7 7" : "none",
    }));
    addLineHoverPath(svg, lineD, `<strong>${escapeHtml(label)} trend</strong><br>Hover any point for exact ${escapeHtml(metric)}.`);
    points.forEach(([x, y, type, week]) => {
      const dot = animatedDot({ cx: x, cy: y, r: 5.5, fill: color, stroke: "#fffaf4", "stroke-width": 2 });
      const metricLine = metric === "AOV"
        ? `AOV ${fmtMoney(type.aov)}`
        : `Frequency ${type.frequency.toFixed(2)}`;
      attachTooltip(
        dot,
        `<strong>${escapeHtml(week.week)} ${escapeHtml(type.buyerType)} ${escapeHtml(metric)}</strong><br>${metricLine}<br>Orders ${fmtNum(type.orders)}<br>Buyers ${fmtNum(type.buyers)}`,
      );
      svg.append(dot);
    });
  };

  drawLine(aovPoints.new, "#dc5b42", "New AOV", "AOV");
  drawLine(aovPoints.returning, "#477f9c", "Returning AOV", "AOV");
  drawLine(freqPoints.new, "#5c8a4b", "New frequency", "frequency", true);
  drawLine(freqPoints.returning, "#89577b", "Returning frequency", "frequency", true);

  const rightLabel = svgEl("text", { x: left + width, y: aovTop - 18, "text-anchor": "end", class: "chart-title-note" });
  rightLabel.textContent = `AOV max ${fmtMoney(maxAov)} · frequency max ${maxFreq.toFixed(1)}`;
  svg.append(rightLabel);
}

function drawEmptyChart(svg, message, x = 470, y = 190) {
  const text = svgEl("text", { x, y, "text-anchor": "middle", class: "empty-chart-label" });
  text.textContent = message;
  svg.append(text);
}

function drawWaterfallChart(comparisonRows) {
  const svg = chartScaffold("#waterfallChart", "0 0 940 390", "GMV waterfall from prior week to selected week");
  const focus = focusWeekContext(comparisonRows);
  const currentMetrics = aggregateRows(rowsForWeek(comparisonRows, focus.label));
  const previousMetrics = focus.prevLabel ? aggregateRows(rowsForWeek(comparisonRows, focus.prevLabel)) : null;

  if (!previousMetrics || !previousMetrics.orders) {
    drawEmptyChart(svg, "No prior-week comparison under current filters.");
    return;
  }

  const orderEffect = (currentMetrics.orders - previousMetrics.orders) * previousMetrics.aov;
  const aovEffect = currentMetrics.gmv - previousMetrics.gmv - orderEffect;
  const items = [
    { label: focus.prevLabel, type: "total", start: 0, end: previousMetrics.gmv, value: previousMetrics.gmv },
    { label: "Orders", type: "delta", value: orderEffect },
    { label: "AOV / mix", type: "delta", value: aovEffect },
    { label: focus.label, type: "total", start: 0, end: currentMetrics.gmv, value: currentMetrics.gmv },
  ];

  let running = previousMetrics.gmv;
  items.forEach((item, index) => {
    if (item.type === "delta") {
      item.start = running;
      item.end = running + item.value;
      running = item.end;
    }
    item.index = index;
  });

  const allValues = items.flatMap((item) => [item.start, item.end]);
  const minValue = Math.min(0, ...allValues) * 1.08;
  const maxValue = Math.max(...allValues, 1) * 1.08;
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 260;
  const slot = width / items.length;
  const barW = 112;
  const yScale = (value) => top + ((maxValue - value) / (maxValue - minValue)) * height;

  drawGrid(svg, left, top, width, height, 4, maxValue, fmtMoney);
  const zeroY = yScale(0);
  svg.append(svgEl("line", { x1: left, y1: zeroY, x2: left + width, y2: zeroY, stroke: "#d9c6b5", "stroke-width": 2 }));

  items.forEach((item, index) => {
    const x = left + slot * (index + 0.5) - barW / 2;
    const y = yScale(Math.max(item.start, item.end));
    const h = Math.max(Math.abs(yScale(item.start) - yScale(item.end)), 2);
    const fill = item.type === "total" ? "#f97316" : item.value >= 0 ? "#5c8a4b" : "#dc5b42";
    const rect = svgEl("rect", { x, y, width: barW, height: h, rx: 10, fill });
    animateRect(rect);
    attachTooltip(
      rect,
      `<strong>${escapeHtml(item.label)}</strong><br>${item.type === "total" ? "GMV" : "Impact"} ${fmtMoney(item.value)}<br>From ${fmtMoney(item.start)} to ${fmtMoney(item.end)}`,
    );
    svg.append(rect);

    if (index < items.length - 1) {
      const nextX = left + slot * (index + 1.5) - barW / 2;
      const connectorY = yScale(item.end);
      svg.append(svgEl("line", {
        x1: x + barW + 8,
        y1: connectorY,
        x2: nextX - 8,
        y2: connectorY,
        stroke: "#cdb8a6",
        "stroke-dasharray": "6 7",
        "stroke-width": 2,
      }));
    }

    const label = svgEl("text", { x: x + barW / 2, y: top + height + 34, "text-anchor": "middle", class: "axis-label" });
    label.textContent = item.label;
    svg.append(label);

    const value = svgEl("text", { x: x + barW / 2, y: Math.max(y - 12, top + 16), "text-anchor": "middle", class: "axis-label" });
    value.textContent = item.type === "delta" ? fmtMoney(item.value) : fmtShort(item.value);
    svg.append(value);
  });

  const note = svgEl("text", { x: left + width, y: top + 14, "text-anchor": "end", class: "chart-title-note" });
  note.textContent = `${focus.label} vs ${focus.prevLabel}`;
  svg.append(note);
}

function arcPath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const outerStart = [cx + outerR * Math.cos(startAngle), cy + outerR * Math.sin(startAngle)];
  const outerEnd = [cx + outerR * Math.cos(endAngle), cy + outerR * Math.sin(endAngle)];
  const innerStart = [cx + innerR * Math.cos(endAngle), cy + innerR * Math.sin(endAngle)];
  const innerEnd = [cx + innerR * Math.cos(startAngle), cy + innerR * Math.sin(startAngle)];
  return [
    `M ${outerStart[0]} ${outerStart[1]}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd[0]} ${outerEnd[1]}`,
    `L ${innerStart[0]} ${innerStart[1]}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd[0]} ${innerEnd[1]}`,
    "Z",
  ].join(" ");
}

function drawCpiShareDonut(rows) {
  const svg = chartScaffold("#cpiShareDonutChart", "0 0 940 390", "CPI band GMV share donut");
  const bands = summarizePriceBandsFromRows(rows).filter((band) => band.gmv > 0);
  const total = bands.reduce((sum, band) => sum + band.gmv, 0);
  if (!total) {
    drawEmptyChart(svg, "No GMV under current filters.");
    return;
  }

  const cx = 300;
  const cy = 190;
  const outerR = 126;
  const innerR = 72;
  let cursor = -Math.PI / 2;

  bands.forEach((band) => {
    const slice = (band.gmv / total) * Math.PI * 2;
    const path = svgEl("path", {
      d: arcPath(cx, cy, outerR, innerR, cursor, cursor + slice - 0.006),
      fill: bandColors[band.band],
      class: "animated-slice",
    });
    attachTooltip(
      path,
      `<strong>CPI ${escapeHtml(band.band)}</strong><br>${((band.gmv / total) * 100).toFixed(1)}% of GMV<br>GMV ${fmtMoney(band.gmv)}<br>Orders ${fmtNum(band.orders)}<br>Buyers ${fmtNum(band.buyers)}`,
    );
    svg.append(path);
    cursor += slice;
  });

  const center = svgEl("text", { x: cx, y: cy - 6, "text-anchor": "middle", class: "donut-total" });
  center.textContent = fmtMoney(total);
  svg.append(center);
  const sub = svgEl("text", { x: cx, y: cy + 22, "text-anchor": "middle", class: "chart-title-note" });
  sub.textContent = "filtered GMV";
  svg.append(sub);

  drawLegend(
    svg,
    bands.map((band) => ({ label: `${band.band} ${(band.gmv / total * 100).toFixed(0)}%`, color: bandColors[band.band], width: 126 })),
    500,
    96,
    360,
  );

  const note = svgEl("text", { x: 842, y: 54, "text-anchor": "end", class: "chart-title-note" });
  note.textContent = describeActiveScope();
  svg.append(note);
}

function drawProductMomentum(comparisonRows) {
  const svg = chartScaffold("#productMomentumChart", "0 0 940 430", "Product GMV momentum bubble chart");
  const focus = focusWeekContext(comparisonRows);
  if (!focus.prevLabel) {
    drawEmptyChart(svg, "No prior week available for momentum comparison.", 470, 210);
    return;
  }

  const current = new Map(aggregateProducts(rowsForWeek(comparisonRows, focus.label)).map((item) => [item.product, item]));
  const previous = new Map(aggregateProducts(rowsForWeek(comparisonRows, focus.prevLabel)).map((item) => [item.product, item]));
  const names = new Set([...current.keys(), ...previous.keys()]);
  const products = [...names].map((product) => {
    const cur = current.get(product) || { gmv: 0, orders: 0, buyers: 0, aov: 0 };
    const prev = previous.get(product) || { gmv: 0, orders: 0, buyers: 0, aov: 0 };
    return {
      product,
      currentGmv: cur.gmv,
      previousGmv: prev.gmv,
      delta: cur.gmv - prev.gmv,
      wow: prev.gmv ? ((cur.gmv - prev.gmv) / prev.gmv) * 100 : null,
      orders: cur.orders,
      buyers: cur.buyers,
      aov: cur.aov,
    };
  })
    .filter((item) => item.currentGmv > 0 || item.previousGmv > 0)
    .sort((a, b) => b.currentGmv - a.currentGmv)
    .slice(0, 28);

  if (!products.length) {
    drawEmptyChart(svg, "No product rows under current filters.", 470, 210);
    return;
  }

  const left = 92;
  const top = 44;
  const width = 760;
  const height = 270;
  const maxGmv = Math.max(...products.map((item) => item.currentGmv), 1);
  const maxDelta = Math.max(...products.map((item) => Math.abs(item.delta)), 1);
  const maxOrders = Math.max(...products.map((item) => item.orders), 1);
  const xScale = (value) => left + (value / maxGmv) * width;
  const yScale = (value) => top + height / 2 - (value / maxDelta) * (height / 2);

  for (let i = 0; i <= 4; i++) {
    const value = -maxDelta + (maxDelta * 2 * i) / 4;
    const y = yScale(value);
    svg.append(svgEl("line", { x1: left, y1: y, x2: left + width, y2: y, stroke: "#efe5dc" }));
    const label = svgEl("text", { x: left - 8, y: y + 4, "text-anchor": "end", class: "tick" });
    label.textContent = fmtMoney(value);
    svg.append(label);
  }
  for (let i = 0; i <= 4; i++) {
    const value = (maxGmv * i) / 4;
    const x = xScale(value);
    svg.append(svgEl("line", { x1: x, y1: top, x2: x, y2: top + height, stroke: "#f5ece2" }));
    const label = svgEl("text", { x, y: top + height + 24, "text-anchor": "middle", class: "tick" });
    label.textContent = fmtMoney(value);
    svg.append(label);
  }
  const zeroY = yScale(0);
  svg.append(svgEl("line", { x1: left, y1: zeroY, x2: left + width, y2: zeroY, stroke: "#d9c6b5", "stroke-width": 2 }));
  const xLabel = svgEl("text", { x: left + width, y: top + height + 38, "text-anchor": "end", class: "chart-title-note" });
  xLabel.textContent = `${focus.label} GMV`;
  svg.append(xLabel);
  const yLabel = svgEl("text", { x: left, y: top - 18, class: "chart-title-note" });
  yLabel.textContent = `Vertical axis: GMV change vs ${focus.prevLabel}`;
  svg.append(yLabel);

  products.forEach((item, index) => {
    const cx = xScale(item.currentGmv);
    const cy = yScale(item.delta);
    const r = 7 + Math.sqrt(item.orders / maxOrders) * 18;
    const fill = item.delta >= 0 ? "#5c8a4b" : "#dc5b42";
    const bubble = animatedDot({ cx, cy, r, fill, opacity: 0.78, stroke: "#fffaf4", "stroke-width": 2 });
    attachTooltip(
      bubble,
      `<strong>${escapeHtml(item.product)}</strong><br>${escapeHtml(focus.label)} GMV ${fmtMoney(item.currentGmv)}<br>${escapeHtml(focus.prevLabel)} GMV ${fmtMoney(item.previousGmv)}<br>Change ${fmtMoney(item.delta)}${Number.isFinite(item.wow) ? ` (${fmtMaybePct(item.wow)})` : ""}<br>Orders ${fmtNum(item.orders)} · Buyers ${fmtNum(item.buyers)}<br>AOV ${fmtMoney(item.aov)}`,
    );
    svg.append(bubble);

    if (index < 10 && r >= 13) {
      const rank = svgEl("text", { x: cx, y: cy + 4, "text-anchor": "middle", class: "bubble-rank" });
      rank.textContent = String(index + 1);
      svg.append(rank);
    }
  });

  drawLegend(svg, [
    { label: "Positive change", color: "#5c8a4b", width: 148 },
    { label: "Negative change", color: "#dc5b42", width: 150 },
  ], left, 392, 760);
}

function drawWeekdayHeatmap(rows) {
  const svg = chartScaffold("#weekdayHeatmapChart", "0 0 940 430", "Weekday GMV heatmap");
  const weeks = state.week === "all" ? state.data.weekly.map((week) => week.week) : [state.week];
  const map = new Map();
  weeks.forEach((week) => {
    map.set(week, weekdayLabels.map((day) => ({ week, day, gmv: 0, orders: 0, buyers: new Set() })));
  });

  rows.forEach((row) => {
    const weekly = map.get(row.week);
    if (!weekly) return;
    const dayIndex = localWeekdayIndex(row.broadcast_date || row.date);
    const item = weekly[dayIndex];
    item.gmv += row.price;
    item.orders += 1;
    if (row.buyer) item.buyers.add(row.buyer);
  });

  const cells = [...map.values()].flat().map((item) => ({ ...item, buyers: item.buyers.size }));
  const max = Math.max(...cells.map((item) => item.gmv), 1);
  const left = 112;
  const top = 58;
  const cellW = 92;
  const cellH = weeks.length > 1 ? 52 : 74;
  const gap = 8;

  weekdayLabels.forEach((day, index) => {
    const label = svgEl("text", { x: left + index * (cellW + gap) + cellW / 2, y: top - 20, "text-anchor": "middle", class: "axis-label" });
    label.textContent = day;
    svg.append(label);
  });

  weeks.forEach((week, rowIndex) => {
    const y = top + rowIndex * (cellH + gap);
    const weekLabel = svgEl("text", { x: left - 14, y: y + cellH / 2 + 5, "text-anchor": "end", class: "axis-label" });
    weekLabel.textContent = week;
    svg.append(weekLabel);
    map.get(week).forEach((cell, dayIndex) => {
      const intensity = cell.gmv / max;
      const fill = `rgba(249, 115, 22, ${0.12 + intensity * 0.78})`;
      const rect = svgEl("rect", {
        x: left + dayIndex * (cellW + gap),
        y,
        width: cellW,
        height: cellH,
        rx: 10,
        fill,
        stroke: "#ead8c6",
      });
      animateRect(rect);
      attachTooltip(
        rect,
        `<strong>${escapeHtml(week)} ${escapeHtml(cell.day)}</strong><br>GMV ${fmtMoney(cell.gmv)}<br>Orders ${fmtNum(cell.orders)}<br>Buyers ${fmtNum(cell.buyers)}`,
      );
      svg.append(rect);

      if (cell.gmv > 0) {
        const value = svgEl("text", {
          x: left + dayIndex * (cellW + gap) + cellW / 2,
          y: y + cellH / 2 + 5,
          "text-anchor": "middle",
          class: intensity > 0.62 ? "heatmap-label light" : "heatmap-label",
        });
        value.textContent = fmtShort(cell.gmv);
        svg.append(value);
      }
    });
  });

  const note = svgEl("text", { x: 852, y: 392, "text-anchor": "end", class: "chart-title-note" });
  note.textContent = describeActiveScope();
  svg.append(note);
}

function renderNewReturningTable(rows) {
  const weekly = groupWeeklyBuyerTypes(rows);
  const rowsOut = weekly.flatMap((week) => week.types.map((type) => ({ week: week.week, ...type })));
  document.querySelector("#newReturningTable").replaceChildren(
    ...rowsOut.map((item) =>
      el("tr", {}, [
        el("td", {}, [document.createTextNode(item.week)]),
        el("td", {}, [document.createTextNode(item.buyerType === "new" ? "New" : "Returning")]),
        el("td", {}, [document.createTextNode(fmtMoney(item.gmv))]),
        el("td", {}, [document.createTextNode(`${item.gmvPct.toFixed(1)}%`)]),
        el("td", {}, [document.createTextNode(fmtNum(item.orders))]),
        el("td", {}, [document.createTextNode(fmtNum(item.buyers))]),
        el("td", {}, [document.createTextNode(fmtMoney(item.aov))]),
        el("td", {}, [document.createTextNode(item.frequency.toFixed(2))]),
      ]),
    ),
  );
  document.querySelector("#newReturningCaption").textContent = `${rowsOut.length} rows across rolling 4 weeks.`;
}

function updateSortButtons() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    const isActive = button.dataset.sort === state.sortKey;
    button.setAttribute("aria-sort", isActive ? state.sortDir : "none");
    button.dataset.active = isActive ? "true" : "false";
    button.dataset.dir = isActive ? state.sortDir : "";
  });
}

function renderTable(rows) {
  const products = sortedProducts(rows);
  const tbody = document.querySelector("#productTable");

  if (!products.length) {
    tbody.replaceChildren(
      el("tr", {}, [
        el("td", { colspan: "5", class: "empty-state" }, [
          document.createTextNode("No products match the current filters."),
        ]),
      ]),
    );
  } else {
    tbody.replaceChildren(
      ...products.slice(0, 30).map((item) =>
        el("tr", {}, [
          el("td", {}, [el("span", { class: "product-name" }, [document.createTextNode(item.product)])]),
          el("td", {}, [document.createTextNode(fmtMoney(item.gmv))]),
          el("td", {}, [document.createTextNode(fmtNum(item.orders))]),
          el("td", {}, [document.createTextNode(fmtNum(item.buyers))]),
          el("td", {}, [document.createTextNode(fmtMoney(item.aov))]),
        ]),
      ),
    );
  }

  updateSortButtons();
  document.querySelector("#tableCaption").textContent = `${products.length} products matched current filters.`;
}

function render() {
  const rows = getCurrentRows();
  const comparisonRows = getFilteredRows({ ignoreWeek: true });
  const rollingRows = comparisonRows;
  const buyerComparisonRows = getFilteredRows({ ignoreWeek: true, ignoreBuyerType: true });
  renderActiveFilters();
  renderKpis(rows, comparisonRows);
  renderInsights(rows, comparisonRows);
  drawWeeklyGmv(comparisonRows);
  drawBarChart("#priceBandChart", summarizePriceBandsFromRows(rows), "band", "gmv", "#f97316", fmtMoney, "GMV by CPI target band under current filters");
  drawPriceBandStacked(rollingRows);
  drawPriceBandShare(rollingRows);
  drawStackedNewReturning(buyerComparisonRows);
  drawNewReturningAovFrequency(buyerComparisonRows);
  drawBuyerRepeat(comparisonRows);
  drawConversion(comparisonRows);
  drawWaterfallChart(comparisonRows);
  drawCpiShareDonut(rows);
  drawProductMomentum(comparisonRows);
  drawWeekdayHeatmap(rows);
  renderNewReturningTable(buyerComparisonRows);
  renderTable(rows);
  requestAnimationFrame(replayChartAnimations);
}

async function init() {
  try {
    if (window.DASHBOARD_DATA) {
      state.baseData = cloneData(window.DASHBOARD_DATA);
    } else {
      const response = await fetch("./home_dashboard_data.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.baseData = await response.json();
    }
    state.data = cloneData(state.baseData);
    loadUploads();
    if (state.uploadedRows.length) state.data = rebuildDataWithUploads();

    document.querySelector("#sourceNote").textContent = state.data.source_note;
    document.querySelector("#generatedAt").textContent = `Updated ${state.data.generated_at}`;
    setOptions();

    document.querySelector("#weekFilter").addEventListener("change", (event) => {
      state.week = event.target.value;
      render();
    });
    document.querySelector("#priceBandFilter").addEventListener("change", (event) => {
      state.priceBand = event.target.value;
      render();
    });
    document.querySelector("#buyerTypeFilter").addEventListener("change", (event) => {
      state.buyerType = event.target.value;
      render();
    });
    document.querySelector("#productSearch").addEventListener("input", debounce((event) => {
      state.query = event.target.value.trim().toLowerCase();
      render();
    }));
    document.querySelector("#csvUpload").addEventListener("change", (event) => {
      handleCsvUpload([...event.target.files]).catch((error) => updateUploadStatus(error.message));
      event.target.value = "";
    });
    document.querySelector("#replaceDatesToggle").addEventListener("change", (event) => {
      state.uploadedReplaceDates = event.target.checked;
      if (state.uploadedRows.length) {
        saveUploads();
        refreshDataAfterUpload();
        updateUploadStatus(`${state.uploadedRows.length.toLocaleString()} uploaded rows re-applied.`);
      }
    });
    document.querySelector("#clearUploads").addEventListener("click", () => {
      state.uploadedRows = [];
      saveUploads();
      updateUploadStatus("CSV override cleared. Showing generated SQL/Drive data.");
      refreshDataAfterUpload();
    });
    document.querySelector("#resetFilters").addEventListener("click", () => {
      state.week = "all";
      state.priceBand = "all";
      state.buyerType = "all";
      state.query = "";
      document.querySelector("#weekFilter").value = "all";
      document.querySelector("#priceBandFilter").value = "all";
      document.querySelector("#buyerTypeFilter").value = "all";
      document.querySelector("#productSearch").value = "";
      render();
    });
    document.querySelectorAll(".sort-button").forEach((button) => {
      button.addEventListener("click", () => {
        const nextKey = button.dataset.sort;
        if (state.sortKey === nextKey) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = nextKey;
          state.sortDir = nextKey === "product" ? "asc" : "desc";
        }
        renderTable(getCurrentRows());
      });
    });

    render();
    hideLoading();
  } catch (error) {
    showError(error.message);
  }
}

init();
