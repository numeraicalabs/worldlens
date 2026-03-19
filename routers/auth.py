"""World Lens — Auth router"""
import aiosqlite
from fastapi import APIRouter, HTTPException, Depends
from models import UserRegister, UserLogin, Token, UserOut
from auth import hash_password, verify_password, create_token, get_current_user
from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

AVATAR_COLORS = ["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#06B6D4","#EC4899"]


@router.post("/register", response_model=Token)
async def register(data: UserRegister):
    import random
    if len(data.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    async with aiosqlite.connect(settings.db_path) as db:
        async with db.execute("SELECT id FROM users WHERE email = ?", (data.email.lower(),)) as cur:
            if await cur.fetchone():
                raise HTTPException(400, "Email already registered")
        color = random.choice(AVATAR_COLORS)
        await db.execute(
            "INSERT INTO users (email, username, password_hash, avatar_color) VALUES (?,?,?,?)",
            (data.email.lower(), data.username, hash_password(data.password), color)
        )
        await db.commit()
        async with db.execute(
            "SELECT id, email, username, avatar_color, created_at, is_admin, is_active, role FROM users WHERE email = ?",
            (data.email.lower(),)
        ) as cur:
            row = await cur.fetchone()
            user = dict(zip([d[0] for d in cur.description], row))

    token = create_token({"sub": str(user["id"])})
    return Token(
        access_token=token,
        user=UserOut(**user)
    )


@router.post("/login", response_model=Token)
async def login(data: UserLogin):
    async with aiosqlite.connect(settings.db_path) as db:
        async with db.execute(
            "SELECT id, email, username, password_hash, avatar_color, created_at, is_admin, is_active, role FROM users WHERE email = ?",
            (data.email.lower(),)
        ) as cur:
            row = await cur.fetchone()
            if not row:
                raise HTTPException(401, "Invalid credentials")
            cols = [d[0] for d in cur.description]
            user = dict(zip(cols, row))

    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")

    # Update last login
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", (user["id"],))
        await db.commit()

    token = create_token({"sub": str(user["id"])})
    return Token(
        access_token=token,
        user=UserOut(
            id=user["id"], email=user["email"], username=user["username"],
            avatar_color=user["avatar_color"], created_at=user["created_at"],
            is_admin=user.get("is_admin", 0), is_active=user.get("is_active", 1),
            role=user.get("role")
        )
    )


@router.get("/me", response_model=UserOut)
async def me(current_user=Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Not authenticated")
    return UserOut(**current_user)
