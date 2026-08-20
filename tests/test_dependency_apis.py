"""Pins the third-party API surface this codebase depends on.

If these fail after a dependency bump, the wrapper modules
(cinex/mcp_client.py, cinex/llm/gemini.py) need updating - not these tests.
"""
import inspect


def test_fastmcp_server_surface():
    from fastmcp import FastMCP
    server = FastMCP("probe")
    assert hasattr(server, "tool"), "decorator used by every agent service"
    assert hasattr(server, "http_app"), "used to mount MCP under FastAPI"


def test_fastmcp_client_surface():
    from fastmcp import Client
    assert hasattr(Client, "call_tool")
    assert hasattr(Client, "list_tools")


def test_google_genai_async_surface():
    from google import genai
    client = genai.Client(api_key="probe-key-not-used")
    assert hasattr(client, "aio"), "async namespace required - no blocking LLM calls"
    sig = inspect.signature(client.aio.models.generate_content)
    assert "config" in sig.parameters, "response_schema is passed via config"
