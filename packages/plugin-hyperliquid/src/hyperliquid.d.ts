declare module "hyperliquid" {
  export interface HyperliquidConfig {
    privateKey?: string;
    testnet?: boolean;
    enableWs?: boolean;
  }

  export interface OrderRequest {
    coin: string;
    asset: number;
    is_buy: boolean;
    sz: number;
    limit_px: number;
    reduce_only: boolean;
    order_type: { market: {} } | { limit: { tif: "Ioc" | "Gtc" } };
  }

  export interface OrderResponse {
    status: string;
    response?: {
      type: string;
      data?: {
        statuses?: Array<{
          px?: string;
          error?: string;
          orderId?: string;
        }>;
      };
    };
  }

  export interface TokenInfo {
    name: string;
    szDecimals: number;
  }

  export interface AssetContext {
    coin: string;
    midPx: string | null;
    prevDayPx: string;
    dayNtlVlm: string;
  }

  export class Hyperliquid {
    constructor(config: HyperliquidConfig);
    connect(): Promise<void>;

    info: {
      spot: {
        getSpotMetaAndAssetCtxs(): Promise<
          [{ tokens: TokenInfo[] }, AssetContext[]]
        >;
      };
    };

    exchange: {
      placeOrder(order: OrderRequest): Promise<OrderResponse>;
    };

    custom: {
      cancelAllOrders(): Promise<OrderResponse>;
    };
  }
}
