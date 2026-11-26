import json, math, time
import requests

# Fill these in with the URLs the organizer gave you when they registered you:
MARKET_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/docs/data/market.json"
HOLDINGS_URL = "https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/traders/hendzormati/holdings.json"
#https://raw.githubusercontent.com/exofri/ensim-trade-center/refs/heads/main/traders/hendzormati/holdings.json

MIN_MONEY_RESERVE = 50 # never let a buy signal spend below this much money

def fetch_json(url):
    resp = requests.get(url, proxies={"http": None, "https": None}, timeout=(10, 20))
    resp.raise_for_status()
    return resp.json()

def compute_signal(prices):
    # Compare two consecutive three-tick averages to smooth single-tick noise.
    if len(prices) < 6:
        return 0.0

    previous = sum(prices[-6:-3]) / 3
    recent = sum(prices[-3:]) / 3
    if previous <= 0:
        return 0.0

    change = (recent - previous) / previous
    # Ignore small changes and cap the requested trade at 10 units.
    if abs(change) < 0.02:
        return 0.0
    return max(-0.10, min(0.10, change))


def main():
    market = fetch_json(MARKET_URL)
    holdings = fetch_json(HOLDINGS_URL)
    products = market["products"]
    history = market["history"]

    if not history:
        raise ValueError("Market feed has no prices")
    cash = holdings["money"]
    inventory = holdings["products"]
    if not math.isfinite(cash) or cash < 0 or any(
        not math.isfinite(inventory[p]) or inventory[p] < 0 for p in products
    ):
        raise ValueError("Invalid holdings")
    signals = {p: compute_signal([row[p] for row in history]) for p in products}
    decision = dict.fromkeys(products, 0.0)
    budget = max(0, cash - MIN_MONEY_RESERVE)
    for p in sorted(products, key=signals.get, reverse=True):
        price = history[-1][p]
        if not math.isfinite(price) or price <= 0:
            raise ValueError(f"Invalid price for {p}")
        requested = math.floor(abs(signals[p]) * 1000)
        if signals[p] > 0:
            tenths = min(requested, math.floor(budget * 10 / price))
            budget = max(0, budget - tenths * price / 10)
            decision[p] = tenths / 1000
        elif signals[p] < 0:
            decision[p] = -min(requested, math.floor(inventory[p] * 10)) / 1000

    decision["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open("decision.json", "w") as f:
        json.dump(decision, f, indent=2)
    print(f"Wrote decision.json: {decision}")

if __name__ == "__main__":
    main()
