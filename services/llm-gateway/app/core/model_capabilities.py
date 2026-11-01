"""What a model can do beyond plain text chat. Stored per model, enforced per task."""

from typing import Literal

ModelCapability = Literal["vision"]
VISION_CAPABILITY: ModelCapability = "vision"
