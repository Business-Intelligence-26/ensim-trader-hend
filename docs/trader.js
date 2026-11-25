const MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/main/docs/data/market.json";
const HOLDINGS_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/main/traders/hendzormati/holdings.json";
const RESERVE = 50;
const START_CASH = 1000;
const START_UNITS = 10;
const byId = (id) => document.getElementById(id);
const number = (value) => value.toFixed(2);
const pct = (value) => value == null ? "—" : `${(value * 100).toFixed(2)}%`;
const strategies = [
  { id: "momentum", name: "Momentum", color: "#8be2c3" },
  { id: "random", name: "Random trader", color: "#8cb9ff" },
  { id: "buy", name: "Random buyer", color: "#f9be74" },
  { id: "sell", name: "Random seller", color: "#f19ac8" },
];
let market;
let results;
let mode = "live";
let holdingsRequest = 0;

async function fetchFeed(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function momentum(history, product, end) {
  if (end < 5) return { change: null, signal: 0, reason: "Need six price ticks" };
  const values = history.slice(end - 5, end + 1).map((tick) => tick[product]);
  const previous = (values[0] + values[1] + values[2]) / 3;
  const recent = (values[3] + values[4] + values[5]) / 3;
  if (previous <= 0) return { change: null, signal: 0, reason: "Invalid reference price" };
  const change = (recent - previous) / previous;
  if (Math.abs(change) < 0.02) return { change, signal: 0, reason: "Change below 2%" };
  return {
    change,
    signal: Math.max(-0.10, Math.min(0.10, change)),
    reason: change > 0 ? "Recent average rose at least 2%" : "Recent average fell at least 2%",
  };
}

function randomGenerator() {
  let state = 42;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function replay({ products, history }, strategy) {
  let cash = START_CASH;
  const holdings = Object.fromEntries(products.map((product) => [product, START_UNITS]));
  const value = (tick) => cash + products.reduce((sum, p) => sum + holdings[p] * tick[p], 0);
  const initialValue = value(history[0]);
  let peak = initialValue;
  const random = randomGenerator();
  const series = [{ value: initialValue, drawdown: 0 }];
  const log = [];

  for (let i = 1; i < history.length; i++) {
    const tick = history[i];
    const orders = products.map((product) => {
      if (strategy.id === "momentum") return { product, ...momentum(history, product, i - 1) };
      // All baselines have the same warm-up and use the same random draws.
      if (i < 6) return { product, signal: 0 };
      const direction = random();
      const size = random() * 0.1;
      const signal = direction < 1 / 3 && strategy.id !== "sell" ? size
        : direction > 2 / 3 && strategy.id !== "buy" ? -size : 0;
      return { product, signal };
    });

    // Execute sells first, then share the available cash across buys in product order.
    orders.sort((a, b) => Math.sign(a.signal) - Math.sign(b.signal));
    for (const { product, signal, reason } of orders) {
      const price = tick[product];
      const requested = Math.round(signal * 1000) / 10;
      let filled = 0;
      if (requested < 0) filled = -Math.min(-requested, holdings[product]);
      if (requested > 0) {
        const affordable = Math.floor(Math.max(0, cash - RESERVE) / price * 10) / 10;
        filled = Math.min(requested, affordable);
      }
      holdings[product] = Math.round((holdings[product] + filled) * 10) / 10;
      cash -= filled * price;
      if (strategy.id === "momentum") {
        const limit = requested === filled ? "" : requested > 0 ? " · Cash limit" : " · Inventory limit";
        log.push([tick.t ?? i, product, signal > 0 ? "Buy" : signal < 0 ? "Sell" : "Hold", requested.toFixed(1), filled.toFixed(1), reason + limit]);
      }
    }

    const portfolio = value(tick);
    peak = Math.max(peak, portfolio);
    series.push({ value: portfolio, drawdown: portfolio / peak - 1 });
  }
  return { ...strategy, cash, holdings, series, log };
}

function fillTable(id, rows) {
  const body = byId(id);
  body.replaceChildren();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
}

function showSignals() {
  const end = market.history.length - 1;
  fillTable("signals", market.products.map((product) => {
    const { change, signal } = momentum(market.history, product, end);
    const order = signal ? `${signal > 0 ? "Buy" : "Sell"} ${(Math.abs(signal) * 100).toFixed(1)} units` : "Hold";
    return [product, number(market.history[end][product]), pct(change), order];
  }));
  byId("signals-panel").hidden = false;
}

function drawChart(id, history, datasets, suffix = "") {
  const canvas = byId(id);
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.scale(ratio, ratio);
  const values = datasets.flatMap(({ points }) => points);
  const minValue = values.reduce((min, value) => Math.min(min, value), Infinity);
  const maxValue = values.reduce((max, value) => Math.max(max, value), -Infinity);
  const min = minValue === maxValue ? minValue - 1 : minValue;
  const span = minValue === maxValue ? 2 : maxValue - minValue;
  const left = 59, top = 12, right = width - 13, bottom = height - 27;
  const y = (value) => bottom - (value - min) / span * (bottom - top);
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#b4c6d4";
  for (let i = 0; i < 5; i++) {
    const value = min + i * span / 4;
    ctx.strokeStyle = "#354555";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillText(value.toFixed(1) + suffix, 2, y(value) + 4);
  }
  ctx.fillText(`Tick ${history[0].t ?? 0}`, left, height - 7);
  const lastTick = `Tick ${history.at(-1).t ?? history.length - 1}`;
  ctx.fillText(lastTick, right - ctx.measureText(lastTick).width, height - 7);
  datasets.forEach(({ points, color, emphasis }) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = emphasis ? 2.5 : 1.5;
    ctx.beginPath();
    points.forEach((value, i) => {
      const x = left + i * (right - left) / Math.max(1, points.length - 1);
      if (i === 0) ctx.moveTo(x, y(value));
      else ctx.lineTo(x, y(value));
    });
    ctx.stroke();
    if (points.length === 1) ctx.fillRect(left - 2, y(points[0]) - 2, 4, 4);
  });
}

function showTrend() {
  if (!market) return;
  const product = byId("product").value;
  const history = market.history;
  const size = Number(byId("window").value);
  const start = size ? Math.max(0, history.length - size) : 0;
  const visible = history.slice(start);
  const prices = visible.map((tick) => tick[product]);
  const average = visible.map((_, offset) => {
    const i = start + offset;
    const ticks = history.slice(Math.max(0, i - 2), i + 1);
    return ticks.reduce((sum, tick) => sum + tick[product], 0) / ticks.length;
  });
  const change = prices.at(-1) / prices[0] - 1;
  byId("trend-summary").textContent =
    `Product ${product} · Last price ${number(prices.at(-1))} · ${pct(change)} change across ${visible.length} ticks`;
  drawChart("trend", visible, [
    { points: prices, color: "#8cb9ff" },
    { points: average, color: "#8be2c3", emphasis: true },
  ]);
}

function redrawCharts() {
  showTrend();
  if (mode !== "simulation" || !results) return;
  const indexed = results.map(({ id, color, series }) => ({
    color, emphasis: id === "momentum", points: series.map((tick) => 100 * tick.value / series[0].value),
  }));
  const drawdowns = results.map(({ id, color, series }) => ({
    color, emphasis: id === "momentum", points: series.map((tick) => 100 * tick.drawdown),
  }));
  drawChart("performance", market.history, indexed);
  drawChart("risk", market.history, drawdowns, "%");
}

function setKpi(id, label, value = 0) {
  const target = byId(id);
  target.textContent = label;
  target.dataset.tone = value < 0 ? "negative" : value > 0 ? "positive" : "";
}

function useSimulation() {
  if (!market) return;
  mode = "simulation";
  results ??= strategies.map((strategy) => replay(market, strategy));
  const own = results[0];
  const totalReturn = ({ series }) => series.at(-1).value / series[0].value - 1;
  const best = results.slice(1).reduce((a, b) => totalReturn(a) >= totalReturn(b) ? a : b);
  const ownReturn = totalReturn(own);
  const maxDrawdown = Math.min(...own.series.map((tick) => tick.drawdown));
  const gap = ownReturn - totalReturn(best);
  setKpi("return-kpi", pct(ownReturn), ownReturn);
  setKpi("risk-kpi", pct(maxDrawdown), maxDrawdown);
  setKpi("comparison-kpi", `${(100 * gap).toFixed(2)} pp`, gap);
  byId("comparison-note").textContent = `vs. ${best.name} · simulation`;
  byId("holding-state").textContent = "Simulation active. These holdings and orders are fictional.";
  byId("holdings").textContent = [
    `Ending cash: ${number(own.cash)}`,
    ...market.products.map((product) => `${product}: ${own.holdings[product]} units`),
  ].join("\n");
  byId("holdings").hidden = false;
  byId("simulation").hidden = false;
  fillTable("metrics", results.map(({ name, series }) => [
    name,
    number(series.at(-1).value),
    pct(series.at(-1).value / series[0].value - 1),
    pct(Math.min(...series.map((tick) => tick.drawdown))),
  ]));
  fillTable("decisions", own.log.slice(-12).reverse());
  for (const id of ["performance-legend", "risk-legend"]) {
    byId(id).replaceChildren(...results.map(({ name, color }) => {
      const item = document.createElement("li");
      const sample = document.createElement("span");
      sample.style.backgroundColor = color;
      item.append(sample, name);
      return item;
    }));
  }
  redrawCharts();
}

async function useLiveHoldings() {
  const request = ++holdingsRequest;
  mode = "live";
  for (const id of ["return-kpi", "risk-kpi", "comparison-kpi"]) setKpi(id, "—");
  byId("comparison-note").textContent = "Percentage points · simulation";
  byId("simulation").hidden = true;
  byId("holdings").hidden = true;
  byId("holding-state").textContent = "Checking the organizer’s holdings feed…";
  try {
    const holdings = await fetchFeed(HOLDINGS_URL);
    if (mode !== "live" || request !== holdingsRequest) return;
    byId("holding-state").textContent = "Organizer holdings loaded. Historical comparisons are available in simulation mode.";
    byId("holdings").textContent = JSON.stringify(holdings, null, 2);
    byId("holdings").hidden = false;
  } catch (error) {
    if (mode !== "live" || request !== holdingsRequest) return;
    byId("holding-state").textContent = `Organizer holdings unavailable (${error.message}). You can replay the market using simulated holdings.`;
  }
}

byId("simulate").addEventListener("click", useSimulation);
byId("live-mode").addEventListener("click", useLiveHoldings);
for (const id of ["product", "window"]) byId(id).addEventListener("change", showTrend);
window.addEventListener("resize", redrawCharts);
useLiveHoldings();
fetchFeed(MARKET_URL).then((data) => {
  if (!data.products?.length || !data.history?.length || data.history.some((tick) =>
    data.products.some((product) => !Number.isFinite(tick[product]) || tick[product] <= 0))) {
    throw new Error("price history is missing or invalid");
  }
  market = data;
  byId("market-state").textContent = `${data.history.length} market ticks · Last update ${data.generated_at}`;
  byId("ticks-kpi").textContent = data.history.length;
  for (const product of data.products) byId("product").add(new Option(product));
  byId("market-panel").hidden = false;
  byId("simulate").disabled = false;
  showSignals();
  showTrend();
}).catch((error) => {
  byId("market-state").textContent = `Market feed unavailable (${error.message}). A valid price history is required to simulate.`;
});

