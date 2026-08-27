"""Agent-to-agent calls. Every call here is a real network hop to another
container - that is the point, not an accident of deployment."""
import json
from functools import lru_cache
from typing import Any

from fastmcp import Client

from cinex.config import get_settings
from cinex.logging import get_logger

log = get_logger("cinex.mcp")


class AgentUnavailable(Exception):
    """An agent could not be reached, or answered with something unusable."""


def unwrap_result(result: Any) -> dict:
    """FastMCP has returned structured output two different ways across versions.
    Accept both so a dependency bump does not break every call site."""
    data = getattr(result, "data", None)
    if isinstance(data, dict):
        return data
    content = getattr(result, "content", None) or []
    for block in content:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError as exc:
                raise AgentUnavailable(f"agent returned non-JSON text: {text[:200]}") from exc
    raise AgentUnavailable("agent returned no usable result")


class AgentClients:
    def __init__(self, urls: dict[str, str]) -> None:
        self._urls = urls

    async def call(self, agent: str, tool: str, args: dict) -> dict:
        url = self._urls.get(agent)
        if url is None:
            raise AgentUnavailable(f"unknown agent: {agent}")
        log.info("mcp_call", extra={"agent": agent, "tool": tool})
        try:
            async with Client(url) as client:
                result = await client.call_tool(tool, args)
        except AgentUnavailable:
            raise
        except Exception as exc:
            raise AgentUnavailable(f"{agent}.{tool} failed: {exc}") from exc
        return unwrap_result(result)

    async def list_tools(self, agent: str) -> list[str]:
        url = self._urls.get(agent)
        if url is None:
            raise AgentUnavailable(f"unknown agent: {agent}")
        async with Client(url) as client:
            return [t.name for t in await client.list_tools()]


@lru_cache
def get_agents() -> AgentClients:
    return AgentClients(get_settings().agent_urls())
