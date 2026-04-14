"""
tradgentic/autopsy.py  —  Sprint C1 + C2
Trade Explainer + Post-Trade Autopsy

Pure Python, no LLM calls. Generates human-readable explanations
from signal feature snapshots already stored in tg_signal_log.

C1 — explain_signal()   : plain-language breakdown of WHY a signal fired
C2 — autopsy_trade()    : post-close analysis of what worked / failed
"""
from __future__ import annotations
import math, json, logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _sign(v: float) -> str:
    return "+" if v >= 0 else ""

def _pct(v: float) -> str:
    return f"{_sign(v)}{v:.1f}%"

def _rr(entry: float, sl: Optional[float], tp: Optional[float]) -> Optional[str]:
    """Risk/Reward string."""
    if not sl or not tp or entry <= 0:
        return None
    risk   = abs(entry - sl)
    reward = abs(tp - entry)
    if risk == 0:
        return None
    return f"1:{reward/risk:.1f}"


# ─────────────────────────────────────────────────────────────────────────────
# C1 — SIGNAL EXPLAINER
# ─────────────────────────────────────────────────────────────────────────────

def explain_signal(
    symbol:     str,
    action:     str,
    price:      float,
    strategy_id: str,
    features:   Dict,
    params:     Dict,
    stop_loss:  Optional[float] = None,
    take_profit: Optional[float] = None,
    strength:   float = 0.5,
) -> Dict:
    """
    Generate a plain-language explanation of a signal.
    Returns structured explainer dict with title, reasons, risk info.
    """
    reasons  = []   # list of {text, contribution_pct, positive, icon}
    warnings = []   # list of {text, icon}

    direction = "bullish" if action == "BUY" else "bearish" if action == "SELL" else "neutral"
    total_contrib = 0.0

    # ── Technical reasons ────────────────────────────────────────────────────

    rsi = features.get("rsi")
    if rsi is not None:
        if action == "BUY" and rsi < 35:
            c = min(35, (35 - rsi) / 35 * 100)
            reasons.append({
                "icon": "📉", "positive": True,
                "text": f"RSI = {rsi:.0f} — market is oversold (below 35). Historically this is a good buying zone.",
                "contrib": round(c, 1),
            })
            total_contrib += c
        elif action == "SELL" and rsi > 65:
            c = min(35, (rsi - 65) / 35 * 100)
            reasons.append({
                "icon": "📈", "positive": True,
                "text": f"RSI = {rsi:.0f} — market is overbought (above 65). Momentum may be exhausting.",
                "contrib": round(c, 1),
            })
            total_contrib += c
        elif 40 < rsi < 60:
            warnings.append({"icon": "⚠️", "text": f"RSI = {rsi:.0f} — neutral zone. Signal is weaker without extreme RSI."})

    ema9  = features.get("ema9")
    ema21 = features.get("ema21")
    ema50 = features.get("ema50")
    if ema9 and ema21 and price:
        spread_pct = (ema9 - ema21) / price * 100
        if action == "BUY" and ema9 > ema21:
            c = min(25, abs(spread_pct) * 5)
            reasons.append({
                "icon": "📈", "positive": True,
                "text": f"EMA(9) is above EMA(21) by {abs(spread_pct):.2f}% — short-term trend is bullish.",
                "contrib": round(c, 1),
            })
            total_contrib += c
            if ema50 and ema9 > ema21 > ema50:
                reasons.append({
                    "icon": "🚀", "positive": True,
                    "text": "All three EMAs aligned: 9 > 21 > 50. This is a strong trend confirmation.",
                    "contrib": 15.0,
                })
                total_contrib += 15
        elif action == "SELL" and ema9 < ema21:
            c = min(25, abs(spread_pct) * 5)
            reasons.append({
                "icon": "📉", "positive": True,
                "text": f"EMA(9) crossed below EMA(21) — trend is turning bearish.",
                "contrib": round(c, 1),
            })
            total_contrib += c

    bb_pct = features.get("bb_pct")
    if bb_pct is not None:
        if action == "BUY" and bb_pct < 15:
            c = min(20, (15 - bb_pct))
            reasons.append({
                "icon": "📊", "positive": True,
                "text": f"Price is at the lower Bollinger Band ({bb_pct:.0f}% position) — statistically cheap relative to recent range.",
                "contrib": round(c, 1),
            })
            total_contrib += c
        elif action == "SELL" and bb_pct > 85:
            c = min(20, (bb_pct - 85))
            reasons.append({
                "icon": "📊", "positive": True,
                "text": f"Price hit the upper Bollinger Band ({bb_pct:.0f}% position) — statistically expensive relative to recent range.",
                "contrib": round(c, 1),
            })
            total_contrib += c

    macd_hist = features.get("macd_hist")
    if macd_hist is not None and abs(macd_hist) > 0.001:
        if action == "BUY" and macd_hist > 0:
            reasons.append({
                "icon": "⚡", "positive": True,
                "text": f"MACD histogram is positive ({macd_hist:.4f}) — momentum building upward.",
                "contrib": 10.0,
            })
            total_contrib += 10
        elif action == "SELL" and macd_hist < 0:
            reasons.append({
                "icon": "⚡", "positive": True,
                "text": f"MACD histogram turned negative ({macd_hist:.4f}) — momentum shifting downward.",
                "contrib": 10.0,
            })
            total_contrib += 10

    mom5  = features.get("mom5",  0.0)
    mom20 = features.get("mom20", 0.0)
    if action == "BUY" and mom5 > 1.0 and mom20 > 0:
        reasons.append({
            "icon": "🔥", "positive": True,
            "text": f"5-bar momentum: {_pct(mom5)}. 20-bar momentum: {_pct(mom20)}. Both timeframes aligned bullish.",
            "contrib": 8.0,
        })
        total_contrib += 8
    elif action == "SELL" and mom5 < -1.0 and mom20 < 0:
        reasons.append({
            "icon": "🧊", "positive": True,
            "text": f"5-bar momentum: {_pct(mom5)}. 20-bar momentum: {_pct(mom20)}. Both timeframes aligned bearish.",
            "contrib": 8.0,
        })
        total_contrib += 8

    # ── ML-specific reasons ───────────────────────────────────────────────────

    prob_up = features.get("prob_up")
    if prob_up is not None:
        conf_pct = abs(prob_up - 0.5) / 0.5 * 100
        reasons.append({
            "icon": "🧠", "positive": action == "BUY",
            "text": f"ML model assigns P(price up) = {prob_up:.1%}. "
                    f"{'Above' if prob_up > 0.5 else 'Below'} 50% threshold with {conf_pct:.0f}% edge.",
            "contrib": round(min(30, conf_pct), 1),
        })
        total_contrib += min(30, conf_pct)

    votes = features.get("votes") or {}
    if votes and isinstance(votes, dict):
        agreements = [k for k, v in votes.items() if isinstance(v, dict) and v.get("action") == action]
        if len(agreements) >= 2:
            reasons.append({
                "icon": "🗳️", "positive": True,
                "text": f"Ensemble agreement: {', '.join(agreements)} all vote {action}. "
                        f"Multi-component confirmation reduces false signals.",
                "contrib": 12.0,
            })
            total_contrib += 12

    # ── Sentiment reasons ─────────────────────────────────────────────────────

    news_sent = features.get("news_sentiment")
    if news_sent is not None and abs(news_sent) > 0.05:
        sent_dir = "positive" if news_sent > 0 else "negative"
        favours  = (action == "BUY" and news_sent > 0) or (action == "SELL" and news_sent < 0)
        reasons.append({
            "icon": "📰", "positive": favours,
            "text": f"News sentiment: {_sign(news_sent)}{news_sent:.2f} ({sent_dir}). "
                    f"WorldLens events {'support' if favours else 'contradict'} this signal.",
            "contrib": min(15, abs(news_sent) * 20) if favours else 0,
        })
        if favours:
            total_contrib += min(15, abs(news_sent) * 20)

    vix = features.get("vix")
    if vix is not None:
        if vix > 28:
            warnings.append({"icon": "😨", "text": f"VIX = {vix:.0f} — elevated market fear. This increases the chance of a stop-loss hit."})
        elif vix < 14 and action == "BUY":
            reasons.append({"icon": "😎", "positive": True, "text": f"VIX = {vix:.0f} — low fear environment. Bull signals tend to work better here.", "contrib": 5.0})
            total_contrib += 5

    # ── Risk info ─────────────────────────────────────────────────────────────

    risk_info = {}
    if stop_loss and price:
        risk_pct = abs(price - stop_loss) / price * 100
        risk_info["stop_loss"]   = round(stop_loss, 4)
        risk_info["risk_pct"]    = round(risk_pct, 2)
        risk_info["risk_dollar"] = round(100000 * risk_pct / 100, 0)  # on $100k portfolio
    if take_profit and price:
        reward_pct = abs(take_profit - price) / price * 100
        risk_info["take_profit"]   = round(take_profit, 4)
        risk_info["reward_pct"]    = round(reward_pct, 2)
    rr = _rr(price, stop_loss, take_profit)
    if rr:
        risk_info["risk_reward"] = rr

    # ── Confidence score ──────────────────────────────────────────────────────

    n_reasons  = len(reasons)
    raw_conf   = min(100, total_contrib * 0.6 + strength * 40)
    confidence = round(raw_conf)

    conf_label = (
        "Very High" if confidence >= 80 else
        "High"      if confidence >= 65 else
        "Moderate"  if confidence >= 45 else
        "Low"
    )

    return {
        "symbol":      symbol,
        "action":      action,
        "price":       price,
        "strategy_id": strategy_id,
        "direction":   direction,
        "confidence":  confidence,
        "conf_label":  conf_label,
        "reasons":     sorted(reasons, key=lambda r: -r.get("contrib", 0)),
        "warnings":    warnings,
        "risk_info":   risk_info,
        "summary":     _build_summary(action, symbol, price, reasons, risk_info, strategy_id),
    }


def _build_summary(action, symbol, price, reasons, risk_info, strategy_id) -> str:
    """One-sentence plain summary."""
    top = reasons[0]["text"].split("—")[0].strip() if reasons else "multiple indicators aligned"
    rr  = risk_info.get("risk_reward", "")
    rr_str = f" Risk/reward: {rr}." if rr else ""
    src = strategy_id.replace("_", " ").replace("ml ", "ML ").title()
    return f"{src} issued a {action} on {symbol} at ${price:.2f} — {top}.{rr_str}"


# ─────────────────────────────────────────────────────────────────────────────
# C2 — POST-TRADE AUTOPSY
# ─────────────────────────────────────────────────────────────────────────────

def autopsy_trade(
    symbol:         str,
    side:           str,            # BUY entry side
    entry_price:    float,
    exit_price:     float,
    pnl:            float,
    pnl_pct:        float,
    entry_features: Dict,
    exit_features:  Dict,
    strategy_id:    str,
    hold_bars:      int             = 0,
) -> Dict:
    """
    Analyse a closed trade. Compare entry vs exit features to
    explain what worked, what failed, and what to learn.
    """
    won     = pnl > 0
    outcome = "WIN" if pnl > 0.5 else "LOSS" if pnl < -0.5 else "NEUTRAL"

    worked  = []   # what went right
    failed  = []   # what went wrong
    lessons = []   # actionable takeaways

    # ── VIX comparison ────────────────────────────────────────────────────────
    vix_entry = entry_features.get("vix")
    vix_exit  = exit_features.get("vix")
    if vix_entry and vix_exit:
        vix_change = vix_exit - vix_entry
        if not won and vix_change > 4:
            failed.append(f"VIX spiked from {vix_entry:.0f} to {vix_exit:.0f} (+{vix_change:.0f}) during the trade — risk-off environment hurt the position.")
            lessons.append(f"With VIX > {int(vix_exit)}, this setup has lower historical win rate. Consider skipping similar signals when VIX is above {int(vix_entry + 4)}.")
        elif won and vix_change < -3:
            worked.append(f"VIX fell from {vix_entry:.0f} to {vix_exit:.0f} during the trade — improving market sentiment supported the position.")

    # ── RSI at entry ──────────────────────────────────────────────────────────
    rsi_entry = entry_features.get("rsi")
    rsi_exit  = exit_features.get("rsi")
    if rsi_entry:
        if side == "BUY" and rsi_entry < 30:
            if won:
                worked.append(f"Entry RSI = {rsi_entry:.0f} was deeply oversold — the mean-reversion setup worked as expected.")
            else:
                failed.append(f"Entry RSI = {rsi_entry:.0f} was oversold, but the price continued lower — the oversold condition was justified by fundamentals.")
                lessons.append("Oversold does not mean bottom in downtrends. Check broader market trend before entering RSI-based reversal trades.")
        elif side == "BUY" and rsi_entry > 55:
            lessons.append(f"Entry RSI was {rsi_entry:.0f} — above neutral. RSI-based reversal setups work best when RSI is below 35.")

    # ── Momentum alignment ────────────────────────────────────────────────────
    mom5_e  = entry_features.get("mom5",  0.0)
    mom20_e = entry_features.get("mom20", 0.0)
    if side == "BUY":
        if mom20_e < -2 and not won:
            failed.append(f"20-bar momentum at entry was {_pct(mom20_e)} — the medium-term trend was against the trade.")
            lessons.append("Avoid buying into a strong medium-term downtrend. Wait for momentum to turn positive first.")
        elif mom20_e > 0 and won:
            worked.append(f"20-bar momentum at entry ({_pct(mom20_e)}) supported the direction — trend and signal were aligned.")

    # ── ML probability ────────────────────────────────────────────────────────
    prob_up = entry_features.get("prob_up")
    if prob_up is not None:
        if side == "BUY" and prob_up < 0.55 and not won:
            failed.append(f"ML model assigned P(up) = {prob_up:.1%} — below the 0.62 high-confidence threshold. This was a marginal signal.")
            lessons.append("For better results, only act on ML BUY signals when P(up) ≥ 0.62.")
        elif side == "BUY" and prob_up >= 0.62 and won:
            worked.append(f"ML model P(up) = {prob_up:.1%} — above high-confidence threshold. The model's edge was validated.")

    # ── Holding period ────────────────────────────────────────────────────────
    if hold_bars > 0:
        if not won and hold_bars < 3:
            lessons.append("Trade closed very quickly — may have been stopped out by noise. Consider slightly wider stop loss.")
        elif won and hold_bars > 20:
            worked.append(f"Patient holding for {hold_bars} bars allowed the full move to develop.")

    # ── Generic outcome text ──────────────────────────────────────────────────
    if not worked and won:
        worked.append(f"Setup played out with {_pct(pnl_pct)} return over {hold_bars} bars.")
    if not failed and not won:
        failed.append(f"Trade closed with {_pct(pnl_pct)} return. Market conditions shifted after entry.")
    if not lessons:
        if won:
            lessons.append("Log this pattern — it may be worth optimising parameters around this setup.")
        else:
            lessons.append("Review the market regime at entry. Losses in trending-against-you conditions often indicate regime mismatch.")

    # ── Setup quality score (was the signal sound regardless of outcome?) ─────
    setup_quality = _rate_setup(entry_features, side, rsi_entry, prob_up)

    return {
        "symbol":        symbol,
        "outcome":       outcome,
        "pnl":           round(pnl, 2),
        "pnl_pct":       round(pnl_pct, 3),
        "entry_price":   entry_price,
        "exit_price":    exit_price,
        "hold_bars":     hold_bars,
        "setup_quality": setup_quality,
        "worked":        worked,
        "failed":        failed,
        "lessons":       lessons,
        "summary":       _autopsy_summary(outcome, symbol, pnl_pct, lessons),
    }


def _rate_setup(features: Dict, side: str, rsi: Optional[float], prob_up: Optional[float]) -> str:
    """Rate the quality of the entry setup independent of outcome."""
    score = 0
    if rsi is not None:
        if side == "BUY"  and rsi < 35: score += 2
        if side == "SELL" and rsi > 65: score += 2
    if prob_up is not None:
        if side == "BUY"  and prob_up >= 0.62: score += 2
        if side == "SELL" and prob_up <= 0.38:  score += 2
    mom5 = features.get("mom5", 0.0)
    if (side == "BUY" and mom5 > 0) or (side == "SELL" and mom5 < 0):
        score += 1
    vix = features.get("vix", 18.0)
    if vix < 20: score += 1

    if score >= 5: return "A — Strong setup"
    if score >= 3: return "B — Decent setup"
    if score >= 1: return "C — Marginal setup"
    return "D — Weak setup"


def _autopsy_summary(outcome, symbol, pnl_pct, lessons) -> str:
    lead = f"{symbol} trade {'won' if outcome == 'WIN' else 'lost'} {_pct(pnl_pct)}."
    top_lesson = lessons[0] if lessons else "Monitor future similar setups."
    return f"{lead} Key takeaway: {top_lesson}"
