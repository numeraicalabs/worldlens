"""
tradgentic/aggregator.py
Signal Aggregation Engine — merges signals from N bots,
weights them by performance, outputs a meta-signal.
"""
from __future__ import annotations
import math, logging
from typing import List, Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AggregatedSignal:
    symbol:     str
    action:     str          # BUY | SELL | HOLD
    confidence: float        # 0-1 weighted confidence
    vote_buy:   float        # weighted buy votes
    vote_sell:  float        # weighted sell votes
    contributors: List[Dict] # [{bot_id, action, strength, weight}]
    reasons:    List[str]


def _sharpe_weight(win_rate: float, total_trades: int, total_return: float) -> float:
    """
    Compute bot weight from performance metrics.
    More trades + higher win rate + better return = more weight.
    """
    if total_trades < 3:
        return 0.3   # small weight for untested bots
    wr_score = win_rate / 100.0
    ret_score = max(0.0, min(total_return / 20.0, 1.0))  # cap at 20% return
    trade_factor = min(math.log1p(total_trades) / 4.0, 1.0)
    raw = (wr_score * 0.5 + ret_score * 0.3 + trade_factor * 0.2)
    return max(0.1, min(raw, 1.0))


def aggregate_signals(
    signals_per_bot: Dict[str, Dict[str, Dict]],
    stats_per_bot:   Dict[str, Dict],
) -> Dict[str, AggregatedSignal]:
    """
    signals_per_bot: {bot_id: {symbol: {action, strength, reason, price}}}
    stats_per_bot:   {bot_id: {win_rate, total_trades, total_return}}
    Returns: {symbol: AggregatedSignal}
    """
    # Collect all symbols
    all_symbols: set = set()
    for bot_signals in signals_per_bot.values():
        all_symbols.update(bot_signals.keys())

    result: Dict[str, AggregatedSignal] = {}

    for sym in all_symbols:
        total_weight  = 0.0
        buy_weight    = 0.0
        sell_weight   = 0.0
        contributors  = []
        reasons       = []

        for bot_id, bot_signals in signals_per_bot.items():
            sig = bot_signals.get(sym)
            if not sig:
                continue
            stats  = stats_per_bot.get(bot_id, {})
            weight = _sharpe_weight(
                float(stats.get("win_rate", 50)),
                int(stats.get("total_trades", 0)),
                float(stats.get("total_return", 0)),
            )
            action   = sig.get("action", "HOLD")
            strength = float(sig.get("strength", 0.5))
            weighted = weight * strength

            if action == "BUY":
                buy_weight  += weighted
            elif action == "SELL":
                sell_weight += weighted

            total_weight += weight
            contributors.append({
                "bot_id":  bot_id,
                "action":  action,
                "strength": round(strength, 3),
                "weight":  round(weight, 3),
                "reason":  sig.get("reason", ""),
            })
            if sig.get("reason"):
                reasons.append(f"[{bot_id}] {sig['reason']}")

        if total_weight == 0:
            total_weight = 1.0

        buy_norm  = buy_weight  / total_weight
        sell_norm = sell_weight / total_weight
        net       = buy_norm - sell_norm

        if net > 0.15:
            action     = "BUY"
            confidence = buy_norm
        elif net < -0.15:
            action     = "SELL"
            confidence = sell_norm
        else:
            action     = "HOLD"
            confidence = 1.0 - abs(net) * 2

        result[sym] = AggregatedSignal(
            symbol       = sym,
            action       = action,
            confidence   = round(confidence, 3),
            vote_buy     = round(buy_norm,  3),
            vote_sell    = round(sell_norm, 3),
            contributors = contributors,
            reasons      = reasons[:5],
        )

    return result


def signal_stream_item(sym: str, agg: AggregatedSignal, price: float) -> Dict:
    """Format for live signal stream ticker."""
    icon = "🟢" if agg.action == "BUY" else "🔴" if agg.action == "SELL" else "🟡"
    bar_buy  = int(agg.vote_buy  * 20)
    bar_sell = int(agg.vote_sell * 20)
    return {
        "symbol":     sym,
        "action":     agg.action,
        "confidence": agg.confidence,
        "vote_buy":   agg.vote_buy,
        "vote_sell":  agg.vote_sell,
        "price":      price,
        "icon":       icon,
        "bar_buy":    bar_buy,
        "bar_sell":   bar_sell,
        "contributors": len(agg.contributors),
        "top_reason": agg.reasons[0] if agg.reasons else "",
    }
