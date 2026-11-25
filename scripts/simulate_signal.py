"""Demonstrate requested trades with synthetic prices and cash balances."""

from algorithm import apply_budget_guard, compute_signal


def main():
    cases = [
        ("Short history", [100, 101], 5000),
        ("Small fluctuations", [100, 101, 99, 100, 101, 100], 5000),
        ("Rising prices", [100, 101, 102, 104, 105, 106], 5000),
        ("Falling prices", [106, 105, 104, 102, 101, 100], 5000),
        ("Strong upward trend", [95, 100, 105, 120, 125, 130], 5000),
        ("Limited budget", [100, 101, 102, 104, 105, 106], 200),
        ("Cash at reserve", [100, 101, 102, 104, 105, 106], 50),
    ]
    print(f"{'Synthetic scenario':<24} {'Cash':>7} {'Raw':>8} {'After guard':>12}  Requested trade")
    for name, prices, money in cases:
        raw = compute_signal(prices)
        final = round(apply_budget_guard(raw, money, prices[-1]), 3)
        action = f"Buy {100 * final:.1f}" if final > 0 else f"Sell {-100 * final:.1f}" if final < 0 else "Hold"
        print(f"{name:<24} {money:>7} {raw:>+8.3f} {final:>+12.3f}  {action}")


if __name__ == "__main__":
    main()
