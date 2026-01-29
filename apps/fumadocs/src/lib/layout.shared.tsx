import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Drovi Intelligence",
    },
    links: [
      {
        text: "API Reference",
        url: "/api-reference",
      },
      {
        text: "Connectors",
        url: "/connectors",
      },
      {
        text: "MCP Tools",
        url: "/mcp-tools",
      },
    ],
  };
}
