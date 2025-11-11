import { type IAgentRuntime, Service, logger } from '@elizaos/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  CallToolResult,
  Resource,
  ResourceTemplate,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  DEFAULT_MCP_TIMEOUT_SECONDS,
  MCP_SERVICE_NAME,
  type McpConnection,
  type McpProvider,
  type McpResourceResponse,
  type McpServer,
  type McpServerConfig,
  type McpSettings,
  type HttpMcpServerConfig,
  type StdioMcpServerConfig,
  DEFAULT_PING_CONFIG,
  MAX_RECONNECT_ATTEMPTS,
  BACKOFF_MULTIPLIER,
  INITIAL_RETRY_DELAY,
  type ConnectionState,
  type PingConfig,
} from './types';
import { buildMcpProviderData } from './utils/mcp';
import {
  createMcpToolCompatibilitySync as createMcpToolCompatibility,
  type McpToolCompatibility,
} from './tool-compatibility';

export class McpService extends Service {
  static serviceType: string = MCP_SERVICE_NAME;
  capabilityDescription = 'Enables the agent to interact with MCP (Model Context Protocol) servers';

  private connections: Map<string, McpConnection> = new Map();
  private connectionStates: Map<string, ConnectionState> = new Map();
  private mcpProvider: McpProvider = {
    values: { mcp: {} },
    data: { mcp: {} },
    text: '',
  };
  private pingConfig: PingConfig = DEFAULT_PING_CONFIG;
  private toolCompatibility: McpToolCompatibility | null = null;
  private compatibilityInitialized = false;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.initializeMcpServers();
  }

  static async start(runtime: IAgentRuntime): Promise<McpService> {
    const service = new McpService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    for (const [name] of this.connections) {
      await this.deleteConnection(name);
    }
    this.connections.clear();
    for (const state of this.connectionStates.values()) {
      if (state.pingInterval) clearInterval(state.pingInterval);
      if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
    }
    this.connectionStates.clear();
  }

  private async initializeMcpServers(): Promise<void> {
    try {
      const mcpSettings = this.getMcpSettings();
      if (!mcpSettings || !mcpSettings.servers) {
        logger.info('No MCP servers configured.');
        return;
      }
      await this.updateServerConnections(mcpSettings.servers);
      const servers = this.getServers();
      this.mcpProvider = buildMcpProviderData(servers);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to initialize MCP servers'
      );
    }
  }

  private getMcpSettings(): McpSettings | undefined {
    return this.runtime.getSetting('mcp') as McpSettings;
  }

  private async updateServerConnections(
    serverConfigs: Record<string, McpServerConfig>
  ): Promise<void> {
    const currentNames = new Set(this.connections.keys());
    const newNames = new Set(Object.keys(serverConfigs));

    for (const name of currentNames) {
      if (!newNames.has(name)) {
        await this.deleteConnection(name);
        logger.info(`Deleted MCP server: ${name}`);
      }
    }

    for (const [name, config] of Object.entries(serverConfigs)) {
      const currentConnection = this.connections.get(name);
      if (!currentConnection) {
        try {
          await this.initializeConnection(name, config);
        } catch (error) {
          logger.error(
            { error: error instanceof Error ? error.message : String(error), serverName: name },
            `Failed to connect to new MCP server ${name}`
          );
        }
      } else if (JSON.stringify(config) !== currentConnection.server.config) {
        try {
          await this.deleteConnection(name);
          await this.initializeConnection(name, config);
          logger.info(`Reconnected MCP server with updated config: ${name}`);
        } catch (error) {
          logger.error(
            { error: error instanceof Error ? error.message : String(error), serverName: name },
            `Failed to reconnect MCP server ${name}`
          );
        }
      }
    }
  }

  private async initializeConnection(name: string, config: McpServerConfig): Promise<void> {
    await this.deleteConnection(name); // Clean up if exists
    const state: ConnectionState = {
      status: 'connecting',
      reconnectAttempts: 0,
      consecutivePingFailures: 0,
    };
    this.connectionStates.set(name, state);
    try {
      const client = new Client({ name: 'ElizaOS', version: '1.0.0' }, { capabilities: {} });
      const transport: StdioClientTransport | SSEClientTransport =
        config.type === 'stdio'
          ? await this.buildStdioClientTransport(name, config)
          : await this.buildHttpClientTransport(name, config);
      const connection: McpConnection = {
        server: {
          name,
          config: JSON.stringify(config),
          status: 'connecting',
        },
        client,
        transport,
      };
      this.connections.set(name, connection);
      this.setupTransportHandlers(name, connection, state);
      await client.connect(transport);
      connection.server = {
        status: 'connected',
        name,
        config: JSON.stringify(config),
        error: '',
        tools: await this.fetchToolsList(name),
        resources: await this.fetchResourcesList(name),
        resourceTemplates: await this.fetchResourceTemplatesList(name),
      };
      state.status = 'connected';
      state.lastConnected = new Date();
      state.reconnectAttempts = 0;
      state.consecutivePingFailures = 0;
      this.startPingMonitoring(name);
      logger.info(`Successfully connected to MCP server: ${name}`);
    } catch (error) {
      state.status = 'disconnected';
      state.lastError = error instanceof Error ? error : new Error(String(error));
      this.handleDisconnection(name, error);
      throw error;
    }
  }

  private setupTransportHandlers(name: string, connection: McpConnection, state: ConnectionState) {
    connection.transport.onerror = async (error) => {
      logger.error({ error, serverName: name }, `Transport error for "${name}"`);
      connection.server.status = 'disconnected';
      this.appendErrorMessage(connection, error.message);
      this.handleDisconnection(name, error);
    };
    connection.transport.onclose = async () => {
      connection.server.status = 'disconnected';
      this.handleDisconnection(name, new Error('Transport closed'));
    };
  }

  private startPingMonitoring(name: string) {
    const state = this.connectionStates.get(name);
    if (!state || !this.pingConfig.enabled) return;
    if (state.pingInterval) clearInterval(state.pingInterval);
    state.pingInterval = setInterval(() => {
      this.sendPing(name).catch((err) => {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err), serverName: name },
          `Ping failed for ${name}`
        );
        this.handlePingFailure(name, err);
      });
    }, this.pingConfig.intervalMs);
  }

  private async sendPing(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) throw new Error(`No connection for ping: ${name}`);
    // Use a lightweight call, e.g., listTools as a ping
    await Promise.race([
      connection.client.listTools(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Ping timeout')), this.pingConfig.timeoutMs)
      ),
    ]);
    // Reset ping failures on success
    const state = this.connectionStates.get(name);
    if (state) state.consecutivePingFailures = 0;
  }

  private handlePingFailure(name: string, error: unknown) {
    const state = this.connectionStates.get(name);
    if (!state) return;
    state.consecutivePingFailures++;
    if (state.consecutivePingFailures >= this.pingConfig.failuresBeforeDisconnect) {
      logger.warn(`Ping failures exceeded for ${name}, disconnecting and attempting reconnect.`);
      this.handleDisconnection(name, error);
    }
  }

  private handleDisconnection(name: string, error: unknown) {
    const state = this.connectionStates.get(name);
    if (!state) return;
    state.status = 'disconnected';
    state.lastError = error instanceof Error ? error : new Error(String(error));
    if (state.pingInterval) clearInterval(state.pingInterval);
    if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
    if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`Max reconnect attempts reached for ${name}. Giving up.`);
      return;
    }
    const delay = INITIAL_RETRY_DELAY * Math.pow(BACKOFF_MULTIPLIER, state.reconnectAttempts);
    state.reconnectTimeout = setTimeout(async () => {
      state.reconnectAttempts++;
      logger.info(`Attempting to reconnect to ${name} (attempt ${state.reconnectAttempts})...`);
      const config = this.connections.get(name)?.server.config;
      if (config) {
        try {
          await this.initializeConnection(name, JSON.parse(config));
        } catch (err) {
          logger.error(
            { error: err instanceof Error ? err.message : String(err), serverName: name },
            `Reconnect attempt failed for ${name}`
          );
          this.handleDisconnection(name, err);
        }
      }
    }, delay);
  }

  async deleteConnection(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (connection) {
      try {
        await connection.transport.close();
        await connection.client.close();
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), serverName: name },
          `Failed to close transport for ${name}`
        );
      }
      this.connections.delete(name);
    }
    const state = this.connectionStates.get(name);
    if (state) {
      if (state.pingInterval) clearInterval(state.pingInterval);
      if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
      this.connectionStates.delete(name);
    }
  }

  private getServerConnection(serverName: string): McpConnection | undefined {
    return this.connections.get(serverName);
  }

  private async buildStdioClientTransport(name: string, config: StdioMcpServerConfig) {
    if (!config.command) {
      throw new Error(`Missing command for stdio MCP server ${name}`);
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: {
        ...config.env,
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      },
      stderr: 'pipe',
      cwd: config.cwd,
    });
  }

  private async buildHttpClientTransport(name: string, config: HttpMcpServerConfig) {
    if (!config.url) {
      throw new Error(`Missing URL for HTTP MCP server ${name}`);
    }

    // Add deprecation warning for legacy "sse" type
    if (config.type === 'sse') {
      logger.warn(
        `Server "${name}": "sse" transport type is deprecated. Use "streamable-http" or "http" instead for the modern Streamable HTTP transport.`
      );
    }

    return new SSEClientTransport(new URL(config.url));
  }

  private appendErrorMessage(connection: McpConnection, error: string) {
    const newError = connection.server.error ? `${connection.server.error}\n${error}` : error;
    connection.server.error = newError;
  }

  private async fetchToolsList(serverName: string): Promise<Tool[]> {
    try {
      const connection = this.getServerConnection(serverName);
      if (!connection) {
        return [];
      }

      const response = await connection.client.listTools();

      const tools = (response?.tools || []).map((tool) => {
        // Apply tool compatibility transformation to the tool's input schema
        let processedTool = { ...tool };

        if (tool.inputSchema) {
          try {
            // Initialize compatibility if not already done
            if (!this.compatibilityInitialized) {
              this.initializeToolCompatibility();
            }

            // Apply compatibility transformations automatically
            processedTool.inputSchema = this.applyToolCompatibility(tool.inputSchema);

            logger.debug(`Applied tool compatibility for: ${tool.name} on server: ${serverName}`);
          } catch (error) {
            logger.warn(
              { error, toolName: tool.name, serverName },
              `Tool compatibility failed for ${tool.name} on ${serverName}`
            );
            // Keep original schema if transformation fails
          }
        }

        return processedTool;
      });

      logger.info(`Fetched ${tools.length} tools for ${serverName}`);
      for (const tool of tools) {
        logger.info(`[${serverName}] ${tool.name}: ${tool.description}`);
      }

      return tools;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), serverName },
        `Failed to fetch tools for ${serverName}`
      );
      return [];
    }
  }

  private async fetchResourcesList(serverName: string): Promise<Resource[]> {
    try {
      const connection = this.getServerConnection(serverName);
      if (!connection) {
        return [];
      }

      const response = await connection.client.listResources();
      return response?.resources || [];
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), serverName },
        `No resources found for ${serverName}`
      );
      return [];
    }
  }

  private async fetchResourceTemplatesList(serverName: string): Promise<ResourceTemplate[]> {
    try {
      const connection = this.getServerConnection(serverName);
      if (!connection) {
        return [];
      }

      const response = await connection.client.listResourceTemplates();
      return response?.resourceTemplates || [];
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), serverName },
        `No resource templates found for ${serverName}`
      );
      return [];
    }
  }

  public getServers(): McpServer[] {
    return Array.from(this.connections.values())
      .filter((conn) => !conn.server.disabled)
      .map((conn) => conn.server);
  }

  public getProviderData(): McpProvider {
    return this.mcpProvider;
  }

  public async callTool(
    serverName: string,
    toolName: string,
    toolArguments?: Record<string, unknown>
  ): Promise<CallToolResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`No connection found for server: ${serverName}`);
    }
    if (connection.server.disabled) {
      throw new Error(`Server "${serverName}" is disabled`);
    }

    let timeout = DEFAULT_MCP_TIMEOUT_SECONDS;
    try {
      const config = JSON.parse(connection.server.config);
      timeout = config.timeoutInMillis || DEFAULT_MCP_TIMEOUT_SECONDS;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), serverName },
        `Failed to parse timeout configuration for server ${serverName}`
      );
    }
    const result = await connection.client.callTool(
      { name: toolName, arguments: toolArguments },
      undefined,
      { timeout }
    );
    if (!result.content) {
      throw new Error('Invalid tool result: missing content array');
    }
    return result as CallToolResult;
  }

  public async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`No connection found for server: ${serverName}`);
    }
    if (connection.server.disabled) {
      throw new Error(`Server "${serverName}" is disabled`);
    }
    return await connection.client.readResource({ uri });
  }

  public async restartConnection(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    const config = connection?.server.config;
    if (config) {
      logger.info(`Restarting ${serverName} MCP server...`);
      connection.server.status = 'connecting';
      connection.server.error = '';
      try {
        await this.deleteConnection(serverName);
        await this.initializeConnection(serverName, JSON.parse(config));
        logger.info(`${serverName} MCP server connected`);
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), serverName },
          `Failed to restart connection for ${serverName}`
        );
        throw new Error(`Failed to connect to ${serverName} MCP server`);
      }
    }
  }

  private initializeToolCompatibility(): void {
    if (this.compatibilityInitialized) return;

    this.toolCompatibility = createMcpToolCompatibility(this.runtime);
    this.compatibilityInitialized = true;

    if (this.toolCompatibility) {
      logger.info(`Tool compatibility enabled`);
    } else {
      logger.info(`No tool compatibility needed`);
    }
  }

  public applyToolCompatibility(toolSchema: any): any {
    if (!this.compatibilityInitialized) {
      this.initializeToolCompatibility();
    }

    if (!this.toolCompatibility || !toolSchema) {
      return toolSchema;
    }

    try {
      return this.toolCompatibility.transformToolSchema(toolSchema);
    } catch (error) {
      logger.warn({ error }, `Tool compatibility transformation failed`);
      return toolSchema; // Fall back to original schema
    }
  }
}
