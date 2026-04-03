"""World Lens — Auth router with invite system"""
import random
import secrets
import string
import aiosqlite
from fastapi import APIRouter, HTTPException, Depends, Body
from pydantic import BaseModel
from typing import Optional
from models import UserRegister, UserLogin, Token, UserOut
from auth import hash_password, verify_password, create_token, get_current_user
from config import settings
from notifications import send_welcome

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_COLORS = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#EC4899"]


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


def _generate_code() -> str:
    chars = string.ascii_uppercase + string.digits
    p1 = ''.join(secrets.choice(chars) for _ in range(5))
    p2 = ''.join(secrets.choice(chars) for _ in range(5))
    return f"WL-{p1}-{p2}"


async def _validate_invite(db, code: str) -> dict:
    async with db.execute(
        "SELECT id, code, max_uses, use_count, expires_at FROM invites WHERE code = ?",
        (code.upper().strip(),)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(400, "Invalid invite code")
    inv = dict(zip(["id","code","max_uses","use_count","expires_at"], row))
    if inv["use_count"] >= inv["max_uses"]:
        raise HTTPException(400, "Invite code already fully used")
    if inv["expires_at"]:
        from datetime import datetime
        if datetime.utcnow().isoformat() > inv["expires_at"]:
            raise HTTPException(400, "Invite code expired")
    return inv


@router.post("/register", response_model=Token)
async def register(data: UserRegisterWithInvite):
    email    = data.email.lower().strip()
    username = data.username.strip()
    password = data.password

    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Invalid email address")
    if len(username) < 2 or len(username) > 32:
        raise HTTPException(400, "Username must be 2-32 characters")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if not any(c.isdigit() or not c.isalpha() for c in password):
        raise HTTPException(400, "Password must contain a number or symbol")

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row

        # Check registration mode (DB override > config)
        reg_open = settings.registration_open
        async with db.execute(
            "SELECT value FROM app_settings WHERE key='registration_open'"
        ) as cur:
            row = await cur.fetchone()
            if row:
                reg_open = row[0].lower() == "true"

        invite_row = None
        if not reg_open:
            if not data.invite_code:
                raise HTTPException(400, "Registration is invite-only. Enter your invite code.")
            invite_row = await _validate_invite(db, data.invite_code)

        async with db.execute("SELECT id FROM users WHERE email = ?", (email,)) as cur:
            if await cur.fetchone():
                raise HTTPException(400, "Email already registered")

        color = random.choice(AVATAR_COLORS)
        await db.execute(
            "INSERT INTO users (email, username, password_hash, avatar_color) VALUES (?,?,?,?)",
            (email, username, hash_password(password), color)
        )
        await db.commit()

        if invite_row:
            async with db.execute("SELECT id FROM users WHERE email = ?", (email,)) as cur:
                new_user = await cur.fetchone()
            await db.execute(
                "UPDATE invites SET use_count=use_count+1, used_by=?, used_at=datetime('now') WHERE id=?",
                (new_user["id"], invite_row["id"])
            )
            await db.commit()

        async with db.execute(
            "SELECT id, email, username, avatar_color, created_at, is_admin, is_active, role FROM users WHERE email=?",
            (email,)
        ) as cur:
            user = dict(await cur.fetchone())

    token = create_token({"sub": str(user["id"])})
    # Fire-and-forget welcome email (won't block or break registration if email fails)
    import asyncio
    asyncio.create_task(send_welcome(email, username))
    return Token(access_token=token, user=UserOut(**user))


@router.post("/login", response_model=Token)
async def login(data: UserLogin):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id,email,username,password_hash,avatar_color,created_at,is_admin,is_active,role FROM users WHERE email=?",
            (data.email.lower().strip(),)
        ) as cur:
            row = await cur.fetchone()

    if not row:
        raise HTTPException(401, "Invalid credentials")
    user = dict(row)
    if not user.get("is_active", 1):
        raise HTTPException(403, "Account deactivated. Contact support.")
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")

    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("UPDATE users SET last_login=datetime('now') WHERE id=?", (user["id"],))
        await db.commit()

    token = create_token({"sub": str(user["id"])})
    return Token(
        access_token=token,
        user=UserOut(id=user["id"], email=user["email"], username=user["username"],
                     avatar_color=user["avatar_color"], created_at=user["created_at"],
                     is_admin=user.get("is_admin",0), is_active=user.get("is_active",1),
                     role=user.get("role"))
    )


@router.get("/me", response_model=UserOut)
async def me(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Not authenticated")
    return UserOut(**current_user)


@router.get("/registration-status")
async def registration_status():
    open_flag = settings.registration_open
    async with aiosqlite.connect(settings.db_path) as db:
        async with db.execute("SELECT value FROM app_settings WHERE key='registration_open'") as cur:
            row = await cur.fetchone()
            if row:
                open_flag = row[0].lower() == "true"
    return {"registration_open": open_flag}


# ── Invite management (admin only) ──────────────────────────────────

@router.post("/invites")
async def create_invite(data: InviteCreate, current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    from datetime import datetime, timedelta
    expires_at = None
    if data.expires_in_days:
        expires_at = (datetime.utcnow() + timedelta(days=data.expires_in_days)).isoformat()
    code = _generate_code()
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT INTO invites (code, label, email_hint, created_by, max_uses, expires_at) VALUES (?,?,?,?,?,?)",
            (code, data.label, data.email_hint.lower(), current_user["id"], data.max_uses, expires_at)
        )
        await db.commit()
    return {"code": code, "label": data.label, "email_hint": data.email_hint,
            "max_uses": data.max_uses, "expires_at": expires_at}


@router.get("/invites")
async def list_invites(current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
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
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("DELETE FROM invites WHERE id=?", (invite_id,))
        await db.commit()
    return {"deleted": invite_id}


@router.post("/invites/validate")
async def validate_code(body: dict = Body(...)):
    code = body.get("code","")
    if not code:
        raise HTTPException(400, "code required")
    async with aiosqlite.connect(settings.db_path) as db:
        try:
            await _validate_invite(db, code)
            return {"valid": True}
        except HTTPException as e:
            return {"valid": False, "reason": e.detail}


@router.post("/registration-toggle")
async def toggle_registration(body: dict = Body(...), current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    open_flag = bool(body.get("open", True))
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('registration_open',?,datetime('now'))",
            ("true" if open_flag else "false",)
        )
        await db.commit()
    return {"registration_open": open_flag}
