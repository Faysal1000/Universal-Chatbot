"""Looks up the protocol adapter for a provider's configured ``api_protocol``."""

from app.protocols.adapter_base import ProtocolAdapter
from app.protocols.anthropic_messages.adapter import AnthropicMessagesAdapter
from app.protocols.openai_chat_completions.adapter import OpenAIChatCompletionsAdapter
from app.protocols.openai_responses.adapter import OpenAIResponsesAdapter
from app.protocols.types import ApiProtocol

PROTOCOL_ADAPTERS: dict[ApiProtocol, ProtocolAdapter] = {
    "openai_chat_completions": OpenAIChatCompletionsAdapter(),
    "openai_responses": OpenAIResponsesAdapter(),
    "anthropic_messages": AnthropicMessagesAdapter(),
}


def adapter_for(api_protocol: ApiProtocol) -> ProtocolAdapter:
    """Return the stateless adapter for ``api_protocol``."""
    return PROTOCOL_ADAPTERS[api_protocol]
