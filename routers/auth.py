"""World Lens — Auth router (Supabase-compatible, fully hardened)"""
import random
import secrets
import string
import logging
import traceback
from datetime import datetime, timedelta
from typing import Optional

import aiosqlite
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel

from db import get_db, db_fetchone, db_execute
from models import UserRegister, UserLogin, Token, UserOut
from auth import hash_password, verify_password, create_token, get_current_user
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_COLORS = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#EC4899"]


# ── Pydantic inputs ────────────────────────────────────────────────

class UserRegisterWithInvite(BaseModel):
    email:       str
    username:    str
    password:    str
    invite_code: Optional[str] = None


class InviteCreate(BaseModel):
    label:           str = ""
    email_hint:      str = ""
    max_uses:        int = 1
    expires_in_days: Optional[int] = None


# ── Helpers ────────────────────────────────────────────────────────

def _generate_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "WL-" + ''.join(secrets.choice(chars) for _ in range(5)) + \
           "-" + ''.join(secrets.choice(chars) for _ in range(5))


def _safe_str(val) -> str:
    """Convert any value (including datetime) to string safely."""
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val)


def _row_to_userout(row: dict) -> UserOut:
    """Build UserOut from a DB row dict, handling datetime fields from PG."""
    return UserOut(
        id=int(row["id"]),
        email=str(row["email"]),
        username=str(row["username"]),
        avatar_color=str(row.get("avatar_color") or "#3B82F6"),
        created_at=_safe_str(row.get("created_at") or ""),
        is_admin=int(row.get("is_admin") or 0),
        is_active=int(row.get("is_active") or 1),
        role=row.get("role"),
    )


async def _validate_invite(db, code: str) -> dict:
    """Validate an invite code. Returns invite dict or raises HTTPException."""
    async with db.execute(
        "SELECT id, code, max_uses, use_count, expires_at FROM invites WHERE code = ?",
        (code.upper().strip(),)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(400, "Invalid invite code")
    # row is already a dict from get_db()
    inv = dict(row)
    if int(inv.get("use_count", 0)) >= int(inv.get("max_uses", 1)):
        raise HTTPException(400, "Invite code already fully used")
    exp = inv.get("expires_at")
    if exp:
        exp_str = _safe_str(exp)
        if exp_str and datetime.utcnow().isoformat() > exp_str:
            raise HTTPException(400, "Invite code expired")
    return inv


# ── Register ───────────────────────────────────────────────────────

@router.post("/register", response_model=Token)
async def register(data: UserRegisterWithInvite):
    email    = data.email.lower().strip()
    username = data.username.strip()
    password = data.password

    # Validation
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Invalid email address")
    if len(username) < 2 or len(username) > 32:
        raise HTTPException(400, "Username must be 2–32 characters")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    try:
        async with get_db() as db:
            # Check registration mode
            reg_open = settings.registration_open
            async with db.execute(
                "SELECT value FROM app_settings WHERE key='registration_open'"
            ) as cur:
                setting_row = await cur.fetchone()
            if setting_row:
                reg_open = str(dict(setting_row).get("value", "")).lower() == "true"

            invite_row = None
            if not reg_open:
                if not data.invite_code:
                    raise HTTPException(400, "Registration is invite-only. Enter your invite code.")
                invite_row = await _validate_invite(db, data.invite_code)

            # Check duplicate email
            async with db.execute(
                "SELECT id FROM users WHERE email = ?", (email,)
            ) as cur:
                existing = await cur.fetchone()
            if existing:
                raise HTTPException(400, "Email already registered")

            # Insert user
            color = random.choice(AVATAR_COLORS)
            insert_cur = await db.execute(
                "INSERT INTO users (email, username, password_hash, avatar_color) VALUES (?,?,?,?)",
                (email, username, hash_password(password), color)
            )
            new_id = insert_cur.lastrowid
            await db.commit()

            if not new_id:
                raise HTTPException(500, "User insert failed — no ID returned")

            # Update invite usage
            if invite_row:
                await db.execute(
                    "UPDATE invites SET use_count=use_count+1, used_by=?, used_at=datetime('now') WHERE id=?",
                    (new_id, invite_row["id"])
                )
                await db.commit()

            # Fetch freshly inserted user
            async with db.execute(
                "SELECT id, email, username, avatar_color, created_at, is_admin, is_active, role "
                "FROM users WHERE id=?", (new_id,)
            ) as cur:
                user_row = await cur.fetchone()

            if not user_row:
                raise HTTPException(500, "Registration failed — user not found after insert")

            user = dict(user_row)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("register error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"Registration error: {exc}")

    token = create_token({"sub": str(user["id"])})

    # Fire-and-forget welcome email
    try:
        import asyncio
        from notifications import send_welcome
        asyncio.create_task(send_welcome(email, username))
    except Exception:
        pass

    return Token(access_token=token, user=_row_to_userout(user))


# ── Login ──────────────────────────────────────────────────────────

@router.post("/login", response_model=Token)
async def login(data: UserLogin):
    try:
        async with get_db() as db:
            async with db.execute(
                "SELECT id, email, username, password_hash, avatar_color, "
                "created_at, is_admin, is_active, role FROM users WHERE email=?",
                (data.email.lower().strip(),)
            ) as cur:
                row = await cur.fetchone()

        if not row:
            raise HTTPException(401, "Invalid credentials")

        user = dict(row)

        if not int(user.get("is_active") or 1):
            raise HTTPException(403, "Account deactivated. Contact support.")

        if not verify_password(data.password, user["password_hash"]):
            raise HTTPException(401, "Invalid credentials")

        # Best-effort last_login update
        try:
            async with get_db() as db:
                await db.execute(
                    "UPDATE users SET last_login=datetime('now') WHERE id=?",
                    (user["id"],)
                )
                await db.commit()
        except Exception as exc:
            logger.warning("last_login update failed: %s", exc)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("login error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"Login error: {exc}")

    token = create_token({"sub": str(user["id"])})
    return Token(access_token=token, user=_row_to_userout(user))


# ── Me ─────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserOut)
async def me(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Not authenticated")
    return _row_to_userout(current_user)


# ── Registration status ────────────────────────────────────────────

@router.get("/registration-status")
async def registration_status():
    open_flag = settings.registration_open
    try:
        async with get_db() as db:
            async with db.execute(
                "SELECT value FROM app_settings WHERE key='registration_open'"
            ) as cur:
                row = await cur.fetchone()
        if row:
            open_flag = str(dict(row).get("value", "")).lower() == "true"
    except Exception:
        pass
    return {"registration_open": open_flag}


# ── Invite management (admin only) ─────────────────────────────────

@router.post("/invites")
async def create_invite(data: InviteCreate, current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    expires_at = None
    if data.expires_in_days:
        expires_at = (datetime.utcnow() + timedelta(days=data.expires_in_days)).isoformat()
    code = _generate_code()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO invites (code, label, email_hint, created_by, max_uses, expires_at) "
            "VALUES (?,?,?,?,?,?)",
            (code, data.label, data.email_hint.lower(),
             current_user["id"], data.max_uses, expires_at)
        )
        await db.commit()
    return {"code": code, "label": data.label, "email_hint": data.email_hint,
            "max_uses": data.max_uses, "expires_at": expires_at}


@router.get("/invites")
async def list_invites(current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    async with get_db() as db:
        async with db.execute("""
            SELECT i.id, i.code, i.label, i.email_hint, i.max_uses, i.use_count,
                   i.expires_at, i.created_at, u.email AS used_by_email
            FROM invites i LEFT JOIN users u ON u.id = i.used_by
            ORDER BY i.created_at DESC
        """) as cur:
            rows = await cur.fetchall()
    return {"invites": [dict(r) for r in rows]}


@router.delete("/invites/{invite_id}")
async def delete_invite(invite_id: int, current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    async with get_db() as db:
        await db.execute("DELETE FROM invites WHERE id=?", (invite_id,))
        await db.commit()
    return {"deleted": invite_id}


@router.post("/invites/validate")
async def validate_code(body: dict = Body(...)):
    code = body.get("code", "")
    if not code:
        raise HTTPException(400, "code required")
    try:
        async with get_db() as db:
            await _validate_invite(db, code)
        return {"valid": True}
    except HTTPException as e:
        return {"valid": False, "reason": e.detail}


@router.post("/registration-toggle")
async def toggle_registration(body: dict = Body(...), current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    open_flag = bool(body.get("open", True))
    async with get_db() as db:
        await db.execute(
            "INSERT INTO app_settings (key, value) VALUES ('registration_open',?) "
            "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=datetime('now')",
            ("true" if open_flag else "false",)
        )
        await db.commit()
    return {"registration_open": open_flag}


# ── Admin bootstrap (create admin if missing) ──────────────────────

@router.post("/bootstrap-admin")
async def bootstrap_admin(body: dict = Body(...)):
    """
    Creates the admin user in the current DB (Supabase or SQLite).
    Protected by ADMIN_BOOTSTRAP_SECRET env var.
    Call once after first deploy: POST /api/auth/bootstrap-admin
    Body: {"secret": "...", "email": "...", "username": "...", "password": "..."}
    """
    secret = body.get("secret", "")
    expected = getattr(settings, "admin_bootstrap_secret", "") or ""
    if not expected or secret != expected:
        raise HTTPException(403, "Invalid bootstrap secret")

    email    = body.get("email", "").lower().strip()
    username = body.get("username", "admin").strip()
    password = body.get("password", "")

    if not email or not password:
        raise HTTPException(400, "email and password required")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    try:
        async with get_db() as db:
            # Check if already exists
            async with db.execute(
                "SELECT id FROM users WHERE email=?", (email,)
            ) as cur:
                existing = await cur.fetchone()

            if existing:
                # Update to admin if exists
                uid = dict(existing)["id"]
                await db.execute(
                    "UPDATE users SET is_admin=1, role='admin' WHERE id=?", (uid,)
                )
                await db.commit()
                return {"status": "updated", "id": uid, "email": email}

            # Create new admin user
            color = AVATAR_COLORS[0]
            cur2 = await db.execute(
                "INSERT INTO users (email, username, password_hash, avatar_color, is_admin, role) "
                "VALUES (?,?,?,?,1,'admin')",
                (email, username, hash_password(password), color)
            )
            new_id = cur2.lastrowid
            await db.commit()

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("bootstrap_admin error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"Bootstrap error: {exc}")

    return {"status": "created", "id": new_id, "email": email}
