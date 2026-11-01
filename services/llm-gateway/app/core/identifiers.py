"""Formats of user-chosen identifiers, enforced by both the API and database constraints."""

PROVIDER_ID_PATTERN = r"^[a-z][a-z0-9_-]{0,62}$"
TASK_NAME_PATTERN = r"^[a-z][a-z0-9_.-]{0,62}$"
# A local deployment's name doubles as the model ID sent upstream (e.g. "qwen3.5-0.8b").
DEPLOYMENT_NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"

# A task route tries at most this many models (plus the default model when appended).
MAX_CHAIN_STEPS = 10
