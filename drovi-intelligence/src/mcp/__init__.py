"""
MCP (Model Context Protocol) Server

Exposes Drovi Intelligence as MCP tools and resources for AI agents.
"""

from src.mcp.server import create_mcp_server
from src.mcp.tools import TOOL_DEFINITIONS

__all__ = ["create_mcp_server", "TOOL_DEFINITIONS"]
