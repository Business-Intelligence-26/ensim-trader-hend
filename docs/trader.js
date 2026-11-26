const MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/main/docs/data/market.json";
const HOLDINGS_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/main/traders/hendzormati/holdings.json";
const RESERVE = 50;
const byId = (id) => document.getElementById(id);
const number = (value) => value.toFixed(2);
const pct = (value) => value == null ? "—" : `${(value * 100).toFixed(2)}%`;
let market;
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

function fillTable(id, rows) {
  const body = byId(id);
  body.replaceChildren();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().textContent = value;
  }
}

function showSignals(holdings) {
  const { products, history } = market;
  const latest = history.at(-1);
  const signals = products.map(product => ({product, ...momentum(history, product, history.length - 1)}));
  signals.sort((a, b) => b.signal - a.signal);
  let budget = Math.max(0, holdings.money - RESERVE);
  let value = holdings.money;
  const rows = signals.map(({product, change, signal}) => {
    const price = latest[product];
    const stock = holdings.products[product];
    value += price * stock;
    const requested = Math.floor(Math.abs(signal) * 1000);
    const limit = signal > 0 ? Math.floor(budget * 10 / price) : Math.floor(stock * 10);
    const amount = Math.min(requested, limit);
    if (signal > 0) budget = Math.max(0, budget - amount * price / 10);
    const order = amount ? `${signal > 0 ? "Acheter" : "Vendre"} ${(amount / 10).toFixed(1)}` : "Conserver";
    const reason = change == null ? "Historique insuffisant"
      : !signal ? "Variation inférieure à 2 %"
      : `${signal > 0 ? "Hausse" : "Baisse"} de la moyenne sur 3 ticks`;
    const constraint = amount < requested ? (signal > 0 ? " · Budget disponible" : " · Stock disponible") : "";
    return {product, amount, cells: [product, number(price), number(stock), pct(change), order, reason + constraint]};
  });
  fillTable("signals", rows.map(row => row.cells));
  const actions = rows.filter(row => row.amount).map(row => `${row.product} · ${row.cells[4]}`);
  byId("action").textContent = actions.join(" / ") || "Conserver les positions";
  byId("cash-kpi").textContent = number(holdings.money);
  byId("value-kpi").textContent = number(value);
  byId("holding-state").textContent = "Positions réelles chargées. Valeur calculée au dernier prix observé.";
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
    `Produit ${product} · Dernier prix ${number(prices.at(-1))} · Variation de ${pct(change)} sur ${visible.length} ticks`;
  drawChart("trend", visible, [
    { points: prices, color: "#8cb9ff" },
    { points: average, color: "#8be2c3", emphasis: true },
  ]);
}

async function refresh() {
  const button = byId("refresh");
  if (button.disabled) return;
  button.disabled = true;
  byId("action").textContent = "Décision en attente des flux";
  byId("holding-state").textContent = "Chargement des positions…";
  byId("cash-kpi").textContent = "—";
  byId("value-kpi").textContent = "—";
  fillTable("signals", []);
  try {
    const [prices, holdings] = await Promise.allSettled([fetchFeed(MARKET_URL), fetchFeed(HOLDINGS_URL)]);
    if (prices.status === "rejected") throw new Error("Marché : " + prices.reason.message);
    const data = prices.value;
    if (!data.products?.length || !data.history?.length || data.history.some(tick =>
      data.products.some(p => !Number.isFinite(tick[p]) || tick[p] <= 0))) throw new Error("Prix invalides");
    const selected = byId("product").value;
    market = data;
    byId("product").replaceChildren(...data.products.map(p => new Option(p, p)));
    if (data.products.includes(selected)) byId("product").value = selected;
    byId("market-panel").hidden = false;
    byId("market-state").textContent = `${data.history.length} ticks · Flux marché ${data.generated_at}`;
    showTrend();
    if (holdings.status === "rejected") throw new Error("Positions : " + holdings.reason.message);
    const account = holdings.value;
    if (!Number.isFinite(account.money) || account.money < 0 || data.products.some(p =>
      !Number.isFinite(account.products?.[p]) || account.products[p] < 0)) throw new Error("Positions invalides");
    showSignals(account);
  } catch (error) {
    byId("holding-state").textContent = error.message;
    byId("action").textContent = "Aucune recommandation disponible";
  } finally {
    button.disabled = false;
  }
}

async function refreshHistory() {
  try {
    const records = await fetchFeed("decision_history.json");
    const rows = records.slice(-40).reverse().flatMap(record =>
      Object.entries(record.signals).map(([p, signal]) => [
        record.published_at, record.market_tick ?? "—", p,
        signal > 0 ? "Acheter" : signal < 0 ? "Vendre" : "Conserver",
        number(Math.abs(signal) * 100), "Non confirmé"
      ]));
    fillTable("decision-history", rows);
    byId("history-state").textContent = rows.length
      ? "Décisions envoyées au marché. Résultat réalisé indisponible sans confirmation d’exécution."
      : "Le journal sera alimenté par le prochain passage d’Auto decide.";
  } catch (error) {
    byId("history-state").textContent = "Historique indisponible : " + error.message;
  }
}

byId("refresh").addEventListener("click", refresh);
for (const id of ["product", "window"]) byId(id).addEventListener("change", showTrend);
window.addEventListener("resize", showTrend);
refresh();

refreshHistory();
setInterval(() => { refresh(); refreshHistory(); }, 5 * 60 * 1000);
