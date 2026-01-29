"""
MCP HTTP/SSE Transport

Provides HTTP endpoints for MCP protocol communication.
Supports Server-Sent Events (SSE) for streaming responses.
"""

import json
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from src.mcp.server import create_mcp_server
from src.mcp.tools import TOOL_DEFINITIONS, get_tool_by_name

logger = structlog.get_logger()

router = APIRouter(prefix="/mcp", tags=["MCP"])

# Global server instance
_mcp_server = None


def get_mcp_server():
    """Get or create MCP server instance."""
    global _mcp_server
    if _mcp_server is None:
        _mcp_server = create_mcp_server()
    return _mcp_server


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class ToolCallRequest(BaseModel):
    """Request to call an MCP tool."""

    name: str = Field(..., description="Tool name")
    arguments: dict[str, Any] = Field(default_factory=dict, description="Tool arguments")


class ToolCallResponse(BaseModel):
    """Response from an MCP tool call."""

    success: bool
    tool: str
    result: Any
    error: str | None = None
    execution_time_ms: int


class ToolDefinition(BaseModel):
    """Tool definition for listing."""

    name: str
    description: str
    inputSchema: dict[str, Any]


class ListToolsResponse(BaseModel):
    """Response listing available tools."""

    tools: list[ToolDefinition]
    count: int


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/tools", response_model=ListToolsResponse)
async def list_tools():
    """
    List all available MCP tools.

    Returns tool definitions with names, descriptions, and input schemas.
    """
    return ListToolsResponse(
        tools=[
            ToolDefinition(
                name=tool["name"],
                description=tool["description"],
                inputSchema=tool["inputSchema"],
            )
            for tool in TOOL_DEFINITIONS
        ],
        count=len(TOOL_DEFINITIONS),
    )


@router.get("/tools/{tool_name}")
async def get_tool(tool_name: str):
    """
    Get a specific tool definition.
    """
    tool = get_tool_by_name(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool not found: {tool_name}")

    return ToolDefinition(
        name=tool["name"],
        description=tool["description"],
        inputSchema=tool["inputSchema"],
    )


@router.post("/tools/{tool_name}/call", response_model=ToolCallResponse)
async def call_tool(tool_name: str, request: ToolCallRequest):
    """
    Call an MCP tool by name.

    Executes the tool with provided arguments and returns the result.
    """
    if request.name != tool_name:
        raise HTTPException(
            status_code=400,
            detail="Tool name in URL must match tool name in request body",
        )

    tool = get_tool_by_name(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool not found: {tool_name}")

    logger.info("MCP HTTP tool call", tool=tool_name, arguments=request.arguments)

    start_time = datetime.utcnow()

    try:
        server = get_mcp_server()
        result = await server._execute_tool(tool_name, request.arguments)

        execution_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return ToolCallResponse(
            success=True,
            tool=tool_name,
            result=result,
            execution_time_ms=execution_time,
        )

    except Exception as e:
        logger.error("MCP HTTP tool call failed", tool=tool_name, error=str(e))

        execution_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return ToolCallResponse(
            success=False,
            tool=tool_name,
            result=None,
            error=str(e),
            execution_time_ms=execution_time,
        )


@router.post("/call", response_model=ToolCallResponse)
async def call_tool_direct(request: ToolCallRequest):
    """
    Call an MCP tool directly.

    Alternative endpoint without tool name in URL.
    """
    return await call_tool(request.name, request)


# =============================================================================
# SSE STREAMING ENDPOINT
# =============================================================================


@router.get("/sse")
async def sse_stream(request: Request):
    """
    Server-Sent Events endpoint for MCP communication.

    Provides real-time streaming of MCP events.
    """

    async def event_generator():
        # Send initial connection event
        yield {
            "event": "connected",
            "data": json.dumps({
                "server": "drovi-intelligence",
                "version": "0.1.0",
                "tools_available": len(TOOL_DEFINITIONS),
            }),
        }

        # Keep connection alive with heartbeat
        while True:
            if await request.is_disconnected():
                break

            yield {
                "event": "heartbeat",
                "data": json.dumps({"timestamp": datetime.utcnow().isoformat()}),
            }

            # Wait 30 seconds between heartbeats
            import asyncio
            await asyncio.sleep(30)

    return EventSourceResponse(event_generator())


# =============================================================================
# JSON-RPC ENDPOINT (MCP Protocol)
# =============================================================================


class JsonRpcRequest(BaseModel):
    """JSON-RPC 2.0 request."""

    jsonrpc: str = "2.0"
    id: int | str | None = None
    method: str
    params: dict[str, Any] | None = None


class JsonRpcResponse(BaseModel):
    """JSON-RPC 2.0 response."""

    jsonrpc: str = "2.0"
    id: int | str | None = None
    result: Any | None = None
    error: dict[str, Any] | None = None


@router.post("/jsonrpc")
async def jsonrpc_endpoint(request: JsonRpcRequest) -> JsonRpcResponse:
    """
    JSON-RPC 2.0 endpoint for MCP protocol.

    Supports:
    - initialize
    - tools/list
    - tools/call
    - resources/list
    - resources/read
    """
    logger.info("MCP JSON-RPC request", method=request.method)

    try:
        if request.method == "initialize":
            return JsonRpcResponse(
                id=request.id,
                result={
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {
                        "name": "drovi-intelligence",
                        "version": "0.1.0",
                    },
                    "capabilities": {
                        "tools": {"listChanged": False},
                        "resources": {"subscribe": False, "listChanged": False},
                    },
                },
            )

        elif request.method == "tools/list":
            return JsonRpcResponse(
                id=request.id,
                result={
                    "tools": [
                        {
                            "name": tool["name"],
                            "description": tool["description"],
                            "inputSchema": tool["inputSchema"],
                        }
                        for tool in TOOL_DEFINITIONS
                    ]
                },
            )

        elif request.method == "tools/call":
            if not request.params:
                return JsonRpcResponse(
                    id=request.id,
                    error={"code": -32602, "message": "Missing params"},
                )

            tool_name = request.params.get("name")
            arguments = request.params.get("arguments", {})

            tool = get_tool_by_name(tool_name)
            if not tool:
                return JsonRpcResponse(
                    id=request.id,
                    error={"code": -32601, "message": f"Tool not found: {tool_name}"},
                )

            server = get_mcp_server()
            result = await server._execute_tool(tool_name, arguments)

            return JsonRpcResponse(
                id=request.id,
                result={
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, indent=2, default=str),
                        }
                    ],
                    "isError": False,
                },
            )

        elif request.method == "resources/list":
            # We don't expose resources currently
            return JsonRpcResponse(
                id=request.id,
                result={"resources": []},
            )

        elif request.method == "resources/read":
            return JsonRpcResponse(
                id=request.id,
                error={"code": -32601, "message": "Resource not found"},
            )

        else:
            return JsonRpcResponse(
                id=request.id,
                error={"code": -32601, "message": f"Method not found: {request.method}"},
            )

    except Exception as e:
        logger.error("MCP JSON-RPC error", method=request.method, error=str(e))
        return JsonRpcResponse(
            id=request.id,
            error={"code": -32603, "message": str(e)},
        )


# =============================================================================
# HEALTH & INFO
# =============================================================================


@router.get("/info")
async def mcp_info():
    """
    Get MCP server information.
    """
    return {
        "name": "drovi-intelligence",
        "version": "0.1.0",
        "protocol_version": "2024-11-05",
        "tools_count": len(TOOL_DEFINITIONS),
        "capabilities": {
            "tools": True,
            "resources": False,
            "prompts": False,
        },
        "endpoints": {
            "list_tools": "/mcp/tools",
            "call_tool": "/mcp/tools/{tool_name}/call",
            "jsonrpc": "/mcp/jsonrpc",
            "sse": "/mcp/sse",
        },
    }
