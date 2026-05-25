const state = {
  data: null,
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
const fmtShort = (value) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);

const svgNS = "http://www.w3.org/2000/svg";
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const priceBandOrder = ["No CPI", "$0-5", "$5-10", "$10-20", "$20-35", "$35-60", "$60+"];
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

function renderKpis(rows) {
  const metrics = aggregateRows(rows);
  const latest = latestWeek();
  const cards = [
    ["GMV", fmtMoney(metrics.gmv), state.week === "all" ? "Filtered rolling period" : state.week],
    ["Orders", fmtNum(metrics.orders), `${metrics.ordersPerBuyer.toFixed(2)} orders / buyer`],
    ["Buyer Count", fmtNum(metrics.buyers), `${metrics.repeatRate.toFixed(1)}% repeat rate`],
    ["AOV", fmtMoney(metrics.aov), "Average sold price"],
    ["Latest WoW", fmtPct(latest.wow_gmv_pct), `${latest.week} vs prior week`, latest.wow_gmv_pct < 0],
    ["GMV/hr", fmtMoney(latest.gmv_per_hour), `${latest.stream_hours.toFixed(1)} stream hours`],
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

function renderInsights(rows) {
  const latest = latestWeek();
  const latestBand = [...state.data.price_bands_latest].sort((a, b) => b.gmv - a.gmv)[0];
  const metrics = aggregateRows(rows);
  const prior = state.data.weekly[state.data.weekly.length - 2];
  const delta = latest.gmv - prior.gmv;
  const tone = latest.wow_gmv_pct < 0 ? "negative" : "positive";
  const insights = [
    {
      mark: "GMV",
      label: "Latest weekly movement",
      value: `${fmtPct(latest.wow_gmv_pct)} WoW`,
      detail: `${latest.week} changed ${fmtMoney(delta)} from ${prior.week}.`,
      tone,
    },
    {
      mark: "PB",
      label: "Current CPI-band leader",
      value: latestBand.band,
      detail: `${fmtMoney(latestBand.gmv)} GMV from target-price band, ${fmtNum(latestBand.orders)} orders in the latest week.`,
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

function drawWeeklyGmv() {
  const svg = chartScaffold("#weeklyGmvChart", "0 0 940 390", "Weekly GMV with WoW trend line");
  addDefs(svg);
  const data = state.data.weekly;
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 250;
  const max = Math.ceil(Math.max(...data.map((d) => d.gmv)) / 10000) * 10000;
  drawGrid(svg, left, top, width, height, 4, max, fmtMoney);
  const barW = 88;
  const points = [];
  const wowAbs = Math.max(100, Math.max(...data.map((d) => Math.abs(d.wow_gmv_pct))) * 1.4);

  data.forEach((d, i) => {
    const x = left + (width * (i + 0.5)) / data.length;
    const h = (d.gmv / max) * height;
    const y = top + height - h;
    const rect = svgEl("rect", { x: x - barW / 2, y, width: barW, height: h, rx: 12, fill: "url(#barGrad)" });
    animateRect(rect);
    attachTooltip(rect, `<strong>${escapeHtml(d.week)}</strong><br>GMV ${fmtMoney(d.gmv)}<br>WoW ${fmtPct(d.wow_gmv_pct)}`);
    svg.append(rect);

    const label = svgEl("text", { x, y: top + height + 28, "text-anchor": "middle", class: "axis-label" });
    label.textContent = d.week;
    svg.append(label);

    const value = svgEl("text", { x, y: Math.max(y - 14, top + 16), "text-anchor": "middle", class: "axis-label" });
    value.textContent = fmtShort(d.gmv);
    svg.append(value);

    const wy = top + height / 2 - (d.wow_gmv_pct / wowAbs) * (height / 2);
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
    attachTooltip(dot, `<strong>${escapeHtml(d.week)} WoW</strong><br>${fmtPct(d.wow_gmv_pct)}<br>GMV ${fmtMoney(d.gmv)}`);
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

function drawStackedNewReturning() {
  const svg = chartScaffold("#newReturningChart", "0 0 940 390", "New and returning customer GMV split");
  const left = 128;
  const top = 42;
  const width = 680;
  const rowH = 48;
  drawLegend(svg, [
    { label: "New GMV", color: "#f97316", width: 112 },
    { label: "Returning GMV", color: "#9a5a2e", width: 150 },
  ], left, 342);

  state.data.weekly.forEach((d, i) => {
    const y = top + i * 64;
    const newW = (d.new_gmv_pct / 100) * width;
    const weekLabel = svgEl("text", { x: left - 10, y: y + 25, "text-anchor": "end", class: "axis-label" });
    weekLabel.textContent = d.week;
    svg.append(weekLabel);
    svg.append(svgEl("rect", { x: left, y, width, height: rowH, rx: 10, fill: "#f3e7da" }));

    const newRect = svgEl("rect", { x: left, y, width: newW, height: rowH, rx: 10, fill: "#f97316" });
    animateRect(newRect, "x");
    attachTooltip(newRect, `<strong>${escapeHtml(d.week)} new GMV</strong><br>${d.new_gmv_pct.toFixed(1)}% of GMV`);
    svg.append(newRect);

    const returningRect = svgEl("rect", { x: left + newW, y, width: width - newW, height: rowH, rx: 10, fill: "#9a5a2e" });
    animateRect(returningRect, "x");
    attachTooltip(returningRect, `<strong>${escapeHtml(d.week)} returning GMV</strong><br>${d.returning_gmv_pct.toFixed(1)}% of GMV`);
    svg.append(returningRect);

    const pctLabel = svgEl("text", { x: left + width + 16, y: y + 30, class: "axis-label" });
    pctLabel.textContent = `${d.new_gmv_pct.toFixed(0)}% / ${d.returning_gmv_pct.toFixed(0)}%`;
    svg.append(pctLabel);
  });
}

function drawBuyerRepeat() {
  const svg = chartScaffold("#buyerRepeatChart", "0 0 940 390", "Buyer count with repeat-rate line");
  const data = state.data.weekly;
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 260;
  const maxBuyers = Math.ceil(Math.max(...data.map((d) => d.buyers)) / 500) * 500;
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

function drawConversion() {
  const rows = state.data.weekly.map((d) => ({
    week: d.week,
    buyersPerHour: d.stream_hours ? d.buyers / d.stream_hours : 0,
    ordersPerHour: d.stream_hours ? d.orders / d.stream_hours : 0,
  }));
  const svg = chartScaffold("#conversionChart", "0 0 940 390", "Weekly orders per hour and buyers per hour");
  const left = 92;
  const top = 38;
  const width = 760;
  const height = 260;
  const max = Math.ceil(Math.max(...rows.map((d) => d.ordersPerHour)) / 20) * 20;
  drawGrid(svg, left, top, width, height, 4, max, (v) => `${v.toFixed(0)}/h`);

  const line = (field, color, label) => {
    const points = rows.map((d, i) => {
      const x = left + (width * (i + 0.5)) / rows.length;
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
  rows.forEach((d, i) => {
    const x = left + (width * (i + 0.5)) / rows.length;
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
  const rollingRows = getFilteredRows({ ignoreWeek: true });
  const buyerComparisonRows = getFilteredRows({ ignoreWeek: true, ignoreBuyerType: true });
  renderActiveFilters();
  renderKpis(rows);
  renderInsights(rows);
  drawWeeklyGmv();
  drawBarChart("#priceBandChart", state.data.price_bands_latest, "band", "gmv", "#f97316", fmtMoney, "Latest-week GMV by CPI target band");
  drawPriceBandStacked(rollingRows);
  drawPriceBandShare(rollingRows);
  drawStackedNewReturning();
  drawNewReturningAovFrequency(buyerComparisonRows);
  drawBuyerRepeat();
  drawConversion();
  renderNewReturningTable(buyerComparisonRows);
  renderTable(rows);
  requestAnimationFrame(replayChartAnimations);
}

async function init() {
  try {
    if (window.DASHBOARD_DATA) {
      state.data = window.DASHBOARD_DATA;
    } else {
      const response = await fetch("./home_dashboard_data.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
    }

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
