"""
Unit tests for MCP tool definitions.

Tests the tool definitions, schemas, and utility functions.
"""

import pytest
from src.mcp.tools import TOOL_DEFINITIONS, get_tool_by_name

pytestmark = pytest.mark.unit


class TestToolDefinitions:
    """Tests for MCP tool definitions."""

    def test_tool_count(self):
        """Test expected number of tools are defined."""
        # Based on tools.py, there should be 18 tools
        assert len(TOOL_DEFINITIONS) >= 18

    def test_all_tools_have_name(self):
        """Test all tools have a name field."""
        for tool in TOOL_DEFINITIONS:
            assert "name" in tool
            assert isinstance(tool["name"], str)
            assert len(tool["name"]) > 0

    def test_all_tools_have_description(self):
        """Test all tools have a description field."""
        for tool in TOOL_DEFINITIONS:
            assert "description" in tool
            assert isinstance(tool["description"], str)
            assert len(tool["description"]) > 0

    def test_all_tools_have_input_schema(self):
        """Test all tools have an inputSchema field."""
        for tool in TOOL_DEFINITIONS:
            assert "inputSchema" in tool
            assert isinstance(tool["inputSchema"], dict)

    def test_input_schemas_are_valid_json_schema(self):
        """Test input schemas have required JSON Schema fields."""
        for tool in TOOL_DEFINITIONS:
            schema = tool["inputSchema"]
            assert "type" in schema
            assert schema["type"] == "object"
            assert "properties" in schema

    def test_tool_names_are_unique(self):
        """Test all tool names are unique."""
        names = [tool["name"] for tool in TOOL_DEFINITIONS]
        assert len(names) == len(set(names)), "Duplicate tool names found"

    def test_required_fields_exist_in_properties(self):
        """Test required fields exist in properties."""
        for tool in TOOL_DEFINITIONS:
            schema = tool["inputSchema"]
            required = schema.get("required", [])
            properties = schema.get("properties", {})

            for req_field in required:
                # Handle oneOf cases where required might be nested
                if req_field in properties:
                    continue
                # Check if it's in a oneOf block
                one_of = schema.get("oneOf", [])
                found_in_one_of = any(
                    req_field in block.get("required", [])
                    for block in one_of
                )
                if not found_in_one_of:
                    assert req_field in properties, (
                        f"Tool {tool['name']}: required field '{req_field}' not in properties"
                    )


class TestCustomerContextTools:
    """Tests for customer context related tools."""

    def test_get_customer_context_exists(self):
        """Test get_customer_context tool exists."""
        tool = get_tool_by_name("get_customer_context")
        assert tool is not None

    def test_get_customer_context_schema(self):
        """Test get_customer_context has correct schema."""
        tool = get_tool_by_name("get_customer_context")
        schema = tool["inputSchema"]

        assert "contact_id" in schema["properties"]
        assert "email" in schema["properties"]
        assert "organization_id" in schema["properties"]
        assert "include_timeline" in schema["properties"]

    def test_search_customers_exists(self):
        """Test search_customers tool exists."""
        tool = get_tool_by_name("search_customers")
        assert tool is not None
        assert "query" in tool["inputSchema"]["properties"]

    def test_get_customer_timeline_exists(self):
        """Test get_customer_timeline tool exists."""
        tool = get_tool_by_name("get_customer_timeline")
        assert tool is not None
        assert "contact_id" in tool["inputSchema"]["properties"]

    def test_get_relationship_health_exists(self):
        """Test get_relationship_health tool exists."""
        tool = get_tool_by_name("get_relationship_health")
        assert tool is not None

    def test_generate_relationship_summary_exists(self):
        """Test generate_relationship_summary tool exists."""
        tool = get_tool_by_name("generate_relationship_summary")
        assert tool is not None

    def test_list_open_commitments_exists(self):
        """Test list_open_commitments tool exists."""
        tool = get_tool_by_name("list_open_commitments")
        assert tool is not None

    def test_list_open_commitments_status_enum(self):
        """Test list_open_commitments has correct status enum."""
        tool = get_tool_by_name("list_open_commitments")
        status_prop = tool["inputSchema"]["properties"]["status"]

        assert "enum" in status_prop
        assert "open" in status_prop["enum"]
        assert "fulfilled" in status_prop["enum"]


class TestAnalyticsTools:
    """Tests for analytics and blindspot tools."""

    def test_get_organization_profile_exists(self):
        """Test get_organization_profile tool exists."""
        tool = get_tool_by_name("get_organization_profile")
        assert tool is not None
        assert "days" in tool["inputSchema"]["properties"]

    def test_get_organization_profile_days_limits(self):
        """Test get_organization_profile has days limits."""
        tool = get_tool_by_name("get_organization_profile")
        days_prop = tool["inputSchema"]["properties"]["days"]

        assert "minimum" in days_prop
        assert "maximum" in days_prop
        assert days_prop["minimum"] == 7
        assert days_prop["maximum"] == 365

    def test_list_blindspots_exists(self):
        """Test list_blindspots tool exists."""
        tool = get_tool_by_name("list_blindspots")
        assert tool is not None

    def test_list_blindspots_severity_enum(self):
        """Test list_blindspots has severity enum."""
        tool = get_tool_by_name("list_blindspots")
        severity_prop = tool["inputSchema"]["properties"]["severity"]

        assert "enum" in severity_prop
        assert "low" in severity_prop["enum"]
        assert "medium" in severity_prop["enum"]
        assert "high" in severity_prop["enum"]

    def test_dismiss_blindspot_exists(self):
        """Test dismiss_blindspot tool exists."""
        tool = get_tool_by_name("dismiss_blindspot")
        assert tool is not None

    def test_dismiss_blindspot_required_fields(self):
        """Test dismiss_blindspot has correct required fields."""
        tool = get_tool_by_name("dismiss_blindspot")
        required = tool["inputSchema"]["required"]

        assert "organization_id" in required
        assert "blindspot_id" in required
        assert "reason" in required

    def test_get_calibration_metrics_exists(self):
        """Test get_calibration_metrics tool exists."""
        tool = get_tool_by_name("get_calibration_metrics")
        assert tool is not None

    def test_get_signal_noise_stats_exists(self):
        """Test get_signal_noise_stats tool exists."""
        tool = get_tool_by_name("get_signal_noise_stats")
        assert tool is not None

    def test_list_patterns_exists(self):
        """Test list_patterns tool exists."""
        tool = get_tool_by_name("list_patterns")
        assert tool is not None
        assert "active_only" in tool["inputSchema"]["properties"]

    def test_record_pattern_feedback_exists(self):
        """Test record_pattern_feedback tool exists."""
        tool = get_tool_by_name("record_pattern_feedback")
        assert tool is not None

    def test_record_pattern_feedback_required_fields(self):
        """Test record_pattern_feedback has correct required fields."""
        tool = get_tool_by_name("record_pattern_feedback")
        required = tool["inputSchema"]["required"]

        assert "pattern_id" in required
        assert "was_correct" in required

    def test_get_organizational_health_exists(self):
        """Test get_organizational_health tool exists."""
        tool = get_tool_by_name("get_organizational_health")
        assert tool is not None


class TestSearchTools:
    """Tests for search related tools."""

    def test_search_intelligence_exists(self):
        """Test search_intelligence tool exists."""
        tool = get_tool_by_name("search_intelligence")
        assert tool is not None

    def test_search_intelligence_schema(self):
        """Test search_intelligence has correct schema."""
        tool = get_tool_by_name("search_intelligence")
        props = tool["inputSchema"]["properties"]

        assert "query" in props
        assert "organization_id" in props
        assert "types" in props
        assert "source_types" in props
        assert "include_graph_context" in props
        assert "limit" in props

    def test_search_intelligence_types_is_array(self):
        """Test search_intelligence types is array."""
        tool = get_tool_by_name("search_intelligence")
        types_prop = tool["inputSchema"]["properties"]["types"]

        assert types_prop["type"] == "array"
        assert "items" in types_prop


class TestMemoryTools:
    """Tests for memory related tools."""

    def test_query_memory_exists(self):
        """Test query_memory tool exists."""
        tool = get_tool_by_name("query_memory")
        assert tool is not None

    def test_query_memory_schema(self):
        """Test query_memory has correct schema."""
        tool = get_tool_by_name("query_memory")
        props = tool["inputSchema"]["properties"]

        assert "query" in props
        assert "organization_id" in props
        assert "user_id" in props
        assert "as_of" in props

    def test_query_memory_as_of_format(self):
        """Test query_memory as_of has datetime format."""
        tool = get_tool_by_name("query_memory")
        as_of_prop = tool["inputSchema"]["properties"]["as_of"]

        assert as_of_prop.get("format") == "date-time"

    def test_add_memory_exists(self):
        """Test add_memory tool exists."""
        tool = get_tool_by_name("add_memory")
        assert tool is not None

    def test_add_memory_required_fields(self):
        """Test add_memory has correct required fields."""
        tool = get_tool_by_name("add_memory")
        required = tool["inputSchema"]["required"]

        assert "content" in required
        assert "organization_id" in required
        assert "source" in required


class TestGraphTools:
    """Tests for graph related tools."""

    def test_get_node_exists(self):
        """Test get_node tool exists."""
        tool = get_tool_by_name("get_node")
        assert tool is not None

    def test_get_node_schema(self):
        """Test get_node has correct schema."""
        tool = get_tool_by_name("get_node")
        props = tool["inputSchema"]["properties"]

        assert "node_id" in props
        assert "organization_id" in props
        assert "include_relationships" in props

    def test_get_node_neighbors_exists(self):
        """Test get_node_neighbors tool exists."""
        tool = get_tool_by_name("get_node_neighbors")
        assert tool is not None

    def test_get_node_neighbors_schema(self):
        """Test get_node_neighbors has correct schema."""
        tool = get_tool_by_name("get_node_neighbors")
        props = tool["inputSchema"]["properties"]

        assert "node_id" in props
        assert "relationship_types" in props
        assert "depth" in props
        assert "limit" in props


class TestGetToolByName:
    """Tests for get_tool_by_name utility function."""

    def test_get_existing_tool(self):
        """Test getting an existing tool."""
        tool = get_tool_by_name("search_intelligence")

        assert tool is not None
        assert tool["name"] == "search_intelligence"

    def test_get_nonexistent_tool(self):
        """Test getting a non-existent tool."""
        tool = get_tool_by_name("nonexistent_tool")

        assert tool is None

    def test_get_tool_case_sensitive(self):
        """Test tool name lookup is case sensitive."""
        # Tool names are lowercase
        tool_lower = get_tool_by_name("search_intelligence")
        tool_upper = get_tool_by_name("SEARCH_INTELLIGENCE")

        assert tool_lower is not None
        assert tool_upper is None

    def test_get_all_defined_tools(self):
        """Test all defined tools can be retrieved."""
        for tool_def in TOOL_DEFINITIONS:
            retrieved = get_tool_by_name(tool_def["name"])
            assert retrieved is not None
            assert retrieved["name"] == tool_def["name"]


class TestToolSchemaDefaults:
    """Tests for tool schema default values."""

    def test_defaults_are_valid_types(self):
        """Test all default values match their property types."""
        type_validators = {
            "string": lambda x: isinstance(x, str),
            "integer": lambda x: isinstance(x, int) and not isinstance(x, bool),
            "number": lambda x: isinstance(x, (int, float)) and not isinstance(x, bool),
            "boolean": lambda x: isinstance(x, bool),
            "array": lambda x: isinstance(x, list),
            "object": lambda x: isinstance(x, dict),
        }

        for tool in TOOL_DEFINITIONS:
            for prop_name, prop_def in tool["inputSchema"]["properties"].items():
                if "default" in prop_def:
                    prop_type = prop_def.get("type")
                    default_value = prop_def["default"]

                    if prop_type in type_validators:
                        validator = type_validators[prop_type]
                        assert validator(default_value), (
                            f"Tool {tool['name']}.{prop_name}: default value {default_value} "
                            f"doesn't match type {prop_type}"
                        )

    def test_limit_defaults_are_reasonable(self):
        """Test limit defaults are reasonable values."""
        for tool in TOOL_DEFINITIONS:
            for prop_name, prop_def in tool["inputSchema"]["properties"].items():
                if prop_name == "limit" and "default" in prop_def:
                    default = prop_def["default"]
                    assert 1 <= default <= 100, (
                        f"Tool {tool['name']}: limit default {default} seems unreasonable"
                    )


class TestToolDescriptions:
    """Tests for tool descriptions."""

    def test_descriptions_are_informative(self):
        """Test descriptions have minimum length."""
        min_description_length = 20

        for tool in TOOL_DEFINITIONS:
            desc = tool["description"]
            assert len(desc) >= min_description_length, (
                f"Tool {tool['name']}: description too short ({len(desc)} chars)"
            )

    def test_descriptions_not_duplicated(self):
        """Test descriptions are unique."""
        descriptions = [tool["description"] for tool in TOOL_DEFINITIONS]
        assert len(descriptions) == len(set(descriptions)), "Duplicate descriptions found"

    def test_property_descriptions_exist(self):
        """Test properties have descriptions."""
        for tool in TOOL_DEFINITIONS:
            for prop_name, prop_def in tool["inputSchema"]["properties"].items():
                assert "description" in prop_def, (
                    f"Tool {tool['name']}.{prop_name}: missing description"
                )
