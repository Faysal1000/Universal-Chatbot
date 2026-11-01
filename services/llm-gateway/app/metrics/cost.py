"""Cost and throughput calculations for one request."""

from decimal import Decimal

from app.protocols.types import TokenUsage, UpstreamTarget

_ONE_MILLION = Decimal(1_000_000)
_COST_PRECISION = Decimal("0.00000001")


def estimate_cost_usd(target: UpstreamTarget, token_usage: TokenUsage) -> Decimal | None:
    """Price the request with the model's per-million-token prices, if any are configured.

    Cached input tokens use the cached price when set, otherwise the normal input price.
    Prices are captured per row, so later price edits never rewrite history.
    """
    input_price = target.input_price_usd_per_million_tokens
    output_price = target.output_price_usd_per_million_tokens
    if input_price is None and output_price is None:
        return None
    if token_usage.input_tokens is None and token_usage.output_tokens is None:
        return None  # Nothing was reported, so the cost is unknown rather than zero.
    cached_input_tokens = token_usage.cached_input_tokens or 0
    uncached_input_tokens = max((token_usage.input_tokens or 0) - cached_input_tokens, 0)
    cached_input_price = target.cached_input_price_usd_per_million_tokens
    if cached_input_price is None:
        cached_input_price = input_price
    total_cost = (
        Decimal(uncached_input_tokens) * (input_price or Decimal(0))
        + Decimal(cached_input_tokens) * (cached_input_price or Decimal(0))
        + Decimal(token_usage.output_tokens or 0) * (output_price or Decimal(0))
    ) / _ONE_MILLION
    return total_cost.quantize(_COST_PRECISION)


def estimate_prompt_cache_savings_usd(target: UpstreamTarget, token_usage: TokenUsage) -> Decimal | None:
    """What the provider's prompt cache saved: cached input tokens times the price discount.

    ``None`` when nothing was cached or the model has no cached-input discount configured.
    """
    input_price = target.input_price_usd_per_million_tokens
    cached_input_price = target.cached_input_price_usd_per_million_tokens
    if not token_usage.cached_input_tokens or input_price is None or cached_input_price is None:
        return None
    discount_per_million_tokens = max(input_price - cached_input_price, Decimal(0))
    savings = Decimal(token_usage.cached_input_tokens) * discount_per_million_tokens / _ONE_MILLION
    return savings.quantize(_COST_PRECISION)


def compute_output_tokens_per_second(
    output_tokens: int | None, total_duration_ms: float, time_to_first_token_ms: float | None
) -> float | None:
    """Generation speed. For streams, time before the first token is excluded."""
    if not output_tokens:
        return None
    generation_ms = total_duration_ms - (time_to_first_token_ms or 0.0)
    if generation_ms <= 0:
        return None
    return round(output_tokens / (generation_ms / 1000.0), 3)
