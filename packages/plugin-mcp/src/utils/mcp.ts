import type { IAgentRuntime, Memory } from "@elizaos/core";
import type {
  McpProvider,
  McpProviderData,
  McpResourceInfo,
  McpServer,
  McpToolInfo,
} from "../types";

export async function createMcpMemory(
  runtime: IAgentRuntime,
  message: Memory,
  type: string,
  serverName: string,
  content: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const memory = await runtime.addEmbeddingToMemory({
    entityId: message.entityId,
    agentId: runtime.agentId,
    roomId: message.roomId,
    content: {
      text: `Used the "${type}" from "${serverName}" server. 
        Content: ${content}`,
      metadata: {
        ...metadata,
        serverName,
      },
    },
  });

  await runtime.createMemory(memory, type === "resource" ? "resources" : "tools", true);
}

export function buildMcpProviderData(servers: McpServer[]): McpProvider {
  const mcpData: McpProviderData = {};
  let textContent = "";

  if (servers.length === 0) {
    return {
      values: { mcp: {} },
      data: { mcp: {} },
      text: "No MCP servers are currently connected.",
    };
  }

  for (const server of servers) {
    mcpData[server.name] = {
      status: server.status,
      tools: {} as Record<string, McpToolInfo>,
      resources: {} as Record<string, McpResourceInfo>,
    };

    textContent += `## Server: ${server.name} (${server.status})\n\n`;

    if (server.tools && server.tools.length > 0) {
      textContent += "### Tools:\n\n";

      for (const tool of server.tools) {
        mcpData[server.name].tools[tool.name] = {
          description: tool.description || "No description available",
          inputSchema: tool.inputSchema || {},
        };

        textContent += `- **${tool.name}**: ${tool.description || "No description available"}\n`;
      }
      textContent += "\n";
    }

    if (server.resources && server.resources.length > 0) {
      textContent += "### Resources:\n\n";

      for (const resource of server.resources) {
        mcpData[server.name].resources[resource.uri] = {
          name: resource.name,
          description: resource.description || "No description available",
          mimeType: resource.mimeType,
        };

        textContent += `- **${resource.name}** (${resource.uri}): ${
          resource.description || "No description available"
        }\n`;
      }
      textContent += "\n";
    }
  }

  return {
    values: { mcp: mcpData },
    data: { mcp: mcpData },
    text: `# MCP Configuration\n\n${textContent}`,
  };
}
