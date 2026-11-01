"""Base classes shared by request schemas."""

from pydantic import BaseModel, ConfigDict


class StrictRequestModel(BaseModel):
    """Rejects unknown fields so typos in admin requests fail loudly."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
