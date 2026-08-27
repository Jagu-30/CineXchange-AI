import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from cinex.config import get_settings

ALGORITHM = "HS256"
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Producer:
    id: uuid.UUID


def issue_demo_token() -> str:
    settings = get_settings()
    claims = {
        "sub": settings.demo_producer_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=1),
        "iss": "cinexchange-demo",
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def verify_token(token: str) -> Producer:
    """The single seam real IAM replaces. Nothing downstream knows about JWTs."""
    try:
        claims = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
        return Producer(id=uuid.UUID(claims["sub"]))
    except (JWTError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid or expired token") from exc


def require_producer(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Producer:
    # The installed FastAPI's HTTPBearer(auto_error=True) raises 401 for a
    # missing header, but this API's contract distinguishes "no credentials
    # supplied at all" (403) from "credentials supplied but invalid/expired"
    # (401, raised by verify_token below). auto_error=False plus this explicit
    # check restores that distinction regardless of the installed version's
    # default.
    if creds is None:
        raise HTTPException(status_code=403, detail="Not authenticated")
    return verify_token(creds.credentials)
