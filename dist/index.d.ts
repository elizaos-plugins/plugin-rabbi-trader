import { IAgentRuntime, Plugin } from '@elizaos/core';

declare function loadTokenAddresses(): string[];
interface SellDetailsData {
    sell_price: number;
    sell_timeStamp: string;
    sell_amount: number;
    received_sol: number;
    sell_value_usd: number;
    profit_usd: number;
    profit_percent: number;
    sell_market_cap: number;
    market_cap_change: number;
    sell_liquidity: number;
    liquidity_change: number;
    rapidDump: boolean;
    sell_recommender_id: string | null;
}
declare module "@elizaos/plugin-trustdb" {
    interface TrustScoreDatabase {
        updateTradePerformanceOnSell(tokenAddress: string, // Changed order: tokenAddress first
        recommenderId: string, // recommenderId second
        buyTimeStamp: string, // buyTimeStamp third
        sellDetails: SellDetailsData, // sellDetails fourth
        isSimulation: boolean): boolean;
    }
}
declare function createRabbiTraderPlugin(getSetting: (key: string) => string | undefined, runtime?: IAgentRuntime): Promise<Plugin>;

export { createRabbiTraderPlugin as default, loadTokenAddresses };
