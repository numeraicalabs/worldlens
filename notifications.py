"""
WorldLens — Email notifications via Resend
==========================================
Free tier: 3,000 emails/month — https://resend.com

Covers:
  - Welcome email on registration
  - Alert triggered notification
  - Daily digest (optional)

Usage:
  1. Create free account at resend.com
  2. Verify a domain (or use @resend.dev for testing)
  3. Set RESEND_API_KEY and RESEND_FROM in Render env vars
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)


async def _send(to: str, subject: str, html: str) -> bool:
    """
    Low-level send via Resend API.
    Returns True on success, False on failure (never raises).
    """
    if not settings.resend_api_key:
        logger.debug("Email skipped (RESEND_API_KEY not set): %s", subject)
        return False

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from":    settings.resend_from,
                    "to":      [to],
                    "subject": subject,
                    "html":    html,
                },
            )
            if resp.status_code in (200, 201):
                logger.info("Email sent → %s: %s", to, subject)
                return True
            else:
                logger.warning("Resend error %d: %s", resp.status_code, resp.text[:200])
                return False
    except Exception as e:
        logger.warning("Email send error: %s", e)
        return False


# ── Templates ─────────────────────────────────────────────────────────────────

def _base_template(title: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body {{ margin:0; padding:0; background:#060B12; font-family:'Inter',system-ui,sans-serif; color:#F0F6FF; }}
  .wrapper {{ max-width:560px; margin:0 auto; padding:32px 24px; }}
  .logo {{ font-size:20px; font-weight:800; letter-spacing:-0.03em; color:#3B82F6; margin-bottom:32px; }}
  .logo span {{ color:#F0F6FF; }}
  h1 {{ font-size:22px; font-weight:700; margin:0 0 16px; letter-spacing:-0.02em; }}
  p {{ font-size:14px; line-height:1.7; color:#94A3B8; margin:0 0 16px; }}
  .card {{ background:#111B2E; border:1px solid rgba(255,255,255,.07); border-radius:12px; padding:20px 24px; margin:20px 0; }}
  .card-title {{ font-size:11px; color:#4B5E7A; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px; }}
  .card-value {{ font-size:18px; font-weight:700; color:#F0F6FF; }}
  .btn {{ display:inline-block; background:#3B82F6; color:#fff; text-decoration:none;
          padding:10px 24px; border-radius:8px; font-weight:600; font-size:14px; margin:16px 0; }}
  .footer {{ margin-top:40px; font-size:11px; color:#2A3A52; border-top:1px solid rgba(255,255,255,.05); padding-top:20px; }}
  .sev-high {{ color:#EF4444; font-weight:700; }}
  .sev-med  {{ color:#F59E0B; font-weight:700; }}
  .sev-low  {{ color:#10B981; font-weight:700; }}
</style>
</head>
<body>
  <div class="wrapper">
    <div class="logo">World<span>Lens</span></div>
    <h1>{title}</h1>
    {body_html}
    <div class="footer">
      WorldLens Global Intelligence Platform &nbsp;·&nbsp;
      You received this because you have notifications enabled.<br>
      <a href="#" style="color:#3B82F6">Manage notifications</a>
    </div>
  </div>
</body>
</html>"""


async def send_welcome(email: str, username: str) -> bool:
    """Welcome email sent immediately after registration."""
    body = f"""
    <p>Hi <strong>{username}</strong>, welcome to WorldLens.</p>
    <p>You now have access to:</p>
    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div class="card-title">🌍 Live Map</div><div style="font-size:13px;color:#94A3B8">Events from 69 premium feeds</div></div>
        <div><div class="card-title">🕸 Knowledge Graph</div><div style="font-size:13px;color:#94A3B8">Entity relationship network</div></div>
        <div><div class="card-title">📅 Timeline</div><div style="font-size:13px;color:#94A3B8">Narrative tracking over time</div></div>
        <div><div class="card-title">🤖 AI Analyst</div><div style="font-size:13px;color:#94A3B8">Ask anything, get analysis</div></div>
      </div>
    </div>
    <p>Start by completing the onboarding to personalise your feed.</p>
    <a href="{_app_url()}" class="btn">Open WorldLens →</a>
    <p style="font-size:12px">Tip: check the Knowledge Graph and run a Dependency Cascade simulation — these features are unique to WorldLens.</p>
    """
    return await _send(email, "Welcome to WorldLens 🌍", _base_template("You're in.", body))


async def send_alert_triggered(
    email: str,
    username: str,
    alert_title: str,
    event: dict,
) -> bool:
    """Notification when a user's alert is triggered by a matching event."""
    sev       = float(event.get("severity", 5.0))
    sev_class = "sev-high" if sev >= 7 else "sev-med" if sev >= 5 else "sev-low"
    ev_title  = event.get("title", "")[:120]
    category  = event.get("category", "")
    country   = event.get("country_name", "")
    ts        = event.get("timestamp", "")[:16].replace("T", " ")
    url       = event.get("url", _app_url())

    body = f"""
    <p>Hi <strong>{username}</strong>, your alert <strong>"{alert_title}"</strong> was triggered.</p>
    <div class="card">
      <div class="card-title">{category} &nbsp;·&nbsp; {country} &nbsp;·&nbsp; {ts}</div>
      <div class="card-value">{ev_title}</div>
      <div style="margin-top:12px;display:flex;gap:20px">
        <div><div class="card-title">Severity</div><div class="{sev_class}">{sev:.1f}/10</div></div>
        <div><div class="card-title">Impact</div><div style="color:#F0F6FF">{event.get("impact","—")}</div></div>
        <div><div class="card-title">Sentiment</div><div style="color:#94A3B8">{event.get("sentiment_tone","—")}</div></div>
      </div>
    </div>
    <a href="{url}" class="btn">Read Full Analysis →</a>
    """
    subject = f"⚠️ Alert: {alert_title} — {ev_title[:50]}"
    return await _send(email, subject, _base_template("Alert Triggered", body))


async def send_daily_digest(
    email: str,
    username: str,
    insight: str,
    top_events: list,
) -> bool:
    """Morning digest email (optional, sent when user has email digests enabled)."""
    events_html = ""
    for ev in top_events[:5]:
        sev       = float(ev.get("severity", 5.0))
        sev_class = "sev-high" if sev >= 7 else "sev-med" if sev >= 5 else "sev-low"
        events_html += f"""
        <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">
          <div style="font-size:10px;color:#4B5E7A;text-transform:uppercase;margin-bottom:4px">
            {ev.get('category','')} &nbsp;·&nbsp; {ev.get('country_name','')}
          </div>
          <div style="font-size:13px;color:#F0F6FF;line-height:1.4">{ev.get('title','')[:100]}</div>
          <div style="font-size:11px;margin-top:4px"><span class="{sev_class}">{sev:.1f}</span> severity</div>
        </div>"""

    body = f"""
    <p style="font-size:16px;color:#F0F6FF;line-height:1.6">{insight}</p>
    <div class="card">
      <div class="card-title">Top events today</div>
      {events_html}
    </div>
    <a href="{_app_url()}" class="btn">Open WorldLens →</a>
    """
    subject = f"WorldLens Daily Brief — {_today_str()}"
    return await _send(email, subject, _base_template(f"Good morning, {username}.", body))


def _app_url() -> str:
    from config import settings
    origins = settings.allowed_origins
    if origins and origins != "*":
        return origins.split(",")[0].strip()
    return "https://worldlens.onrender.com"


def _today_str() -> str:
    from datetime import date
    return date.today().strftime("%B %d, %Y")
