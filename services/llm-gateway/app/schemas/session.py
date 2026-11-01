"""Admin sign-in."""

from datetime import datetime

from pydantic import BaseModel, Field, SecretStr

from app.schemas.base import StrictRequestModel


class LoginRequest(StrictRequestModel):
    """Admin credentials."""

    username: str = Field(min_length=1, max_length=128)
    password: SecretStr = Field(min_length=1, max_length=1024)


class SessionResponse(BaseModel):
    """The signed-in admin."""

    username: str
    expires_at: datetime
