import { jest } from "bun:test";
import type { AgentRuntime, Memory, State } from "@elizaos/core";

export const createMockRuntime = (
  settings: Record<string, any> = {}
): AgentRuntime => {
  const mockRuntime = {
    getSetting: jest.fn((key: string) => settings[key]),
    composeState: jest.fn().mockResolvedValue({
      userId: "test-user",
      entityId: "test-entity",
      agentId: "test-agent",
      recentMessagesString: "Test recent messages",
    }),
    updateRecentMessageState: jest.fn().mockResolvedValue({}),
    useModel: jest.fn().mockResolvedValue("{}"),
    messageManager: {
      createMemory: jest.fn(),
      getMemories: jest.fn().mockResolvedValue([]),
    },
    agentId: "test-agent",
    character: {
      name: "test-character",
    },
  } as unknown as AgentRuntime;

  return mockRuntime;
};

export const createMockMemory = (content: string = "Test message"): Memory => ({
  id: "00000000-0000-0000-0000-000000000001" as any,
  entityId: "00000000-0000-0000-0000-000000000002" as any,
  agentId: "00000000-0000-0000-0000-000000000003" as any,
  roomId: "00000000-0000-0000-0000-000000000004" as any,
  content: {
    text: content,
  },
  createdAt: Date.now(),
});

export const createMockState = (): State =>
  ({
    userId: "test-user",
    entityId: "test-entity",
    agentId: "test-agent",
    recentMessagesString: "Test recent messages",
    values: {},
    data: {},
    text: "",
  }) as State;

export const createMockCallback = () => jest.fn();

export const mockHyperliquidSdk = {
  connect: jest.fn().mockResolvedValue(undefined),
  info: {
    spot: {
      getSpotMetaAndAssetCtxs: jest.fn().mockResolvedValue([
        {
          tokens: [
            { name: "HYPE", szDecimals: 2 },
            { name: "ETH", szDecimals: 4 },
            { name: "PIP", szDecimals: 2 },
          ],
        },
        [
          {
            coin: "HYPE-SPOT",
            midPx: "20.50",
            prevDayPx: "20.00",
            dayNtlVlm: "1000000",
          },
          {
            coin: "ETH-SPOT",
            midPx: "3500.00",
            prevDayPx: "3400.00",
            dayNtlVlm: "50000000",
          },
          {
            coin: "PIP-SPOT",
            midPx: "19.73",
            prevDayPx: "20.10",
            dayNtlVlm: "1053445.75",
          },
        ],
      ]),
    },
  },
  exchange: {
    placeOrder: jest.fn().mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [
            {
              px: "20.50",
              error: null,
            },
          ],
        },
      },
    }),
  },
  custom: {
    cancelAllOrders: jest.fn().mockResolvedValue({
      response: {
        data: {
          statuses: [{ orderId: "order1" }, { orderId: "order2" }],
        },
      },
    }),
  },
};

// Mock the Hyperliquid module - do it before tests
