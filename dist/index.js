// src/index.ts
import { elizaLogger as elizaLogger8, settings as settings2 } from "@elizaos/core";
import { TwitterClientInterface } from "@elizaos/client-twitter";
import {
  solanaPlugin,
  trustScoreProvider,
  trustEvaluator,
  getTokenBalance
} from "@elizaos/plugin-solana";

// src/providers/token.ts
import { elizaLogger } from "@elizaos/core";
import NodeCache from "node-cache";

// src/utils/bignumber.ts
import BigNumber from "bignumber.js";
function toBN(value) {
  return new BigNumber(value);
}

// src/providers/token.ts
var TokenProvider = class {
  constructor(tokenAddress, options) {
    this.tokenAddress = tokenAddress;
    this.cache = new NodeCache({ stdTTL: 300 });
    this.isBase = options?.isBase || false;
  }
  cache;
  isBase;
  async getProcessedTokenData() {
    const cacheKey = `processed_${this.tokenAddress}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    try {
      const dexData = await this.fetchDexScreenerData();
      const pair = dexData.pairs[0];
      const security = {
        ownerBalance: toBN(pair.liquidity.base).toString(),
        creatorBalance: "0",
        ownerPercentage: 0,
        creatorPercentage: 0,
        top10HolderBalance: toBN(pair.liquidity.base).times(0.1).toString(),
        top10HolderPercent: 10
      };
      const tradeData = {
        price: Number(pair.priceUsd),
        priceChange24h: pair.priceChange.h24,
        volume24h: pair.volume.h24,
        volume24hUsd: toBN(pair.volume.h24).toString(),
        uniqueWallets24h: pair.txns.h24.buys + pair.txns.h24.sells,
        uniqueWallets24hChange: 0
      };
      const holderDistributionTrend = this.analyzeHolderDistribution(tradeData);
      const processedData = {
        security,
        tradeData,
        dexScreenerData: { pairs: [pair] },
        holderDistributionTrend,
        highValueHolders: [],
        recentTrades: pair.volume.h24 > 0,
        highSupplyHoldersCount: 0,
        tokenCodex: { isScam: false }
      };
      this.cache.set(cacheKey, processedData);
      return processedData;
    } catch (error) {
      elizaLogger.error(`Failed to process token data: ${error}`);
      throw error;
    }
  }
  analyzeHolderDistribution(tradeData) {
    const buyRatio = tradeData.uniqueWallets24h > 0 ? tradeData.uniqueWallets24hChange / tradeData.uniqueWallets24h : 0;
    if (buyRatio > 0.1) return "increasing";
    if (buyRatio < -0.1) return "decreasing";
    return "stable";
  }
  async shouldTradeToken() {
    const data = await this.getProcessedTokenData();
    const pair = data.dexScreenerData.pairs[0];
    return pair.liquidity.usd > 5e4 && pair.volume.h24 > 1e4 && Math.abs(pair.priceChange.h24) < 30 && !data.tokenCodex?.isScam;
  }
  async fetchDexScreenerData() {
    const chainParam = this.isBase ? "base" : "solana";
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${this.tokenAddress}?chainId=${chainParam}`);
    const data = await response.json();
    return data;
  }
};

// src/index.ts
import { Connection as Connection2, PublicKey as PublicKey2 } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// src/providers/trustScoreProvider.ts
import { elizaLogger as elizaLogger2 } from "@elizaos/core";
var TrustScoreProvider = class {
  tokenProviders = /* @__PURE__ */ new Map();
  getTokenProvider(tokenAddress) {
    if (!this.tokenProviders.has(tokenAddress)) {
      this.tokenProviders.set(tokenAddress, new TokenProvider(tokenAddress));
    }
    return this.tokenProviders.get(tokenAddress);
  }
  async calculateTrustScore(tokenData) {
    const pair = tokenData.dexScreenerData.pairs[0];
    const {
      liquidity,
      volume,
      marketCap
    } = pair;
    const LIQUIDITY_WEIGHT = 0.4;
    const VOLUME_WEIGHT = 0.4;
    const MCAP_WEIGHT = 0.2;
    const liquidityScore = Math.min(liquidity.usd / 1e5, 1) * LIQUIDITY_WEIGHT;
    const volumeScore = Math.min(volume.h24 / 5e4, 1) * VOLUME_WEIGHT;
    const mcapScore = Math.min(marketCap / 1e6, 1) * MCAP_WEIGHT;
    return liquidityScore + volumeScore + mcapScore;
  }
  async evaluateToken(tokenAddress) {
    try {
      const provider = this.getTokenProvider(tokenAddress);
      const tokenData = await provider.getProcessedTokenData();
      const trustScore = await this.calculateTrustScore(tokenData);
      const pair = tokenData.dexScreenerData.pairs[0];
      const riskLevel = trustScore > 0.7 ? "LOW" : trustScore > 0.4 ? "MEDIUM" : "HIGH";
      let tradingAdvice = "HOLD";
      let reason = "Market conditions stable";
      if (pair.priceChange.h24 > 5 && trustScore > 0.4) {
        tradingAdvice = "BUY";
        reason = "Strong upward momentum with good trust score";
      } else if (pair.priceChange.h24 < -10 || trustScore < 0.3) {
        tradingAdvice = "SELL";
        reason = "Deteriorating conditions or low trust score";
      }
      return { trustScore, riskLevel, tradingAdvice, reason };
    } catch (error) {
      elizaLogger2.error(`Trust evaluation failed: ${error}`);
      throw error;
    }
  }
};

// src/services/simulationService.ts
import { elizaLogger as elizaLogger3 } from "@elizaos/core";
var SimulationService = class {
  trustScoreProvider;
  constructor() {
    this.trustScoreProvider = new TrustScoreProvider();
  }
  async simulateTrade(tokenAddress, amount) {
    try {
      const evaluation = await this.trustScoreProvider.evaluateToken(tokenAddress);
      const tokenProvider = new TokenProvider(tokenAddress);
      const tokenData = await tokenProvider.getProcessedTokenData();
      const liquidity = tokenData.dexScreenerData.pairs[0]?.liquidity?.usd || 0;
      const priceImpact = amount / liquidity * 100;
      let recommendedAction = "ABORT";
      let reason = "Default safety check failed";
      if (evaluation.trustScore > 0.4 && priceImpact < 1) {
        recommendedAction = "EXECUTE";
        reason = "Trade meets safety parameters";
      }
      return {
        expectedPrice: tokenData.tradeData.price,
        priceImpact,
        recommendedAction,
        reason
      };
    } catch (error) {
      elizaLogger3.error("Trade simulation failed:", error);
      throw error;
    }
  }
};

// src/constants.ts
var SAFETY_LIMITS = {
  MINIMUM_TRADE: 0.01,
  // Minimum 0.01 SOL per trade
  MAX_POSITION_SIZE: 0.1,
  // Maximum 10% of token liquidity
  MAX_SLIPPAGE: 0.05,
  // Maximum 5% slippage allowed
  MIN_LIQUIDITY: 1e3,
  // Minimum $1000 liquidity required
  MIN_VOLUME: 2e3,
  // Minimum $2000 24h volume required
  MIN_TRUST_SCORE: 0.4,
  // Minimum trust score to trade
  STOP_LOSS: 0.2,
  // 20% stop loss trigger
  CHECK_INTERVAL: 5 * 60 * 1e3,
  // Check every 5 minutes
  TAKE_PROFIT: 0.12,
  // Take profit at 12% gain
  TRAILING_STOP: 0.2,
  // 20% trailing stop from highest
  PARTIAL_TAKE: 0.06,
  // Take 50% profit at 6% gain
  REENTRY_DELAY: 60 * 60 * 1e3,
  // Wait 1 hour before re-entering
  MAX_ACTIVE_POSITIONS: 5,
  // Maximum concurrent positions
  MIN_WALLET_BALANCE: 0.05
  // Keep minimum 0.05 SOL in wallet
};
var ANALYSIS_HISTORY_EXPIRY = 24 * 60 * 60 * 1e3;
var MAX_TWEETS_PER_HOUR = {
  trade: 10,
  market_search: 5
};
var MARKET_SEARCH_INTERVAL = 60 * 60 * 1e3;

// src/index.ts
import NodeCache2 from "node-cache";
import { TrustScoreDatabase } from "@elizaos/plugin-trustdb";

// ../../node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// ../../node_modules/uuid/dist/esm-node/regex.js
var regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

// ../../node_modules/uuid/dist/esm-node/validate.js
function validate(uuid) {
  return typeof uuid === "string" && regex_default.test(uuid);
}
var validate_default = validate;

// ../../node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).substr(1));
}
function stringify(arr, offset = 0) {
  const uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
  if (!validate_default(uuid)) {
    throw TypeError("Stringified UUID is invalid");
  }
  return uuid;
}
var stringify_default = stringify;

// ../../node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return stringify_default(rnds);
}
var v4_default = v4;

// src/actions/analyzeTrade.ts
import {
  elizaLogger as elizaLogger4,
  generateText,
  ModelClass,
  parseJSONObjectFromText
} from "@elizaos/core";
var analyzeTradeAction = {
  name: "ANALYZE_TRADE",
  description: "Analyze a token for trading opportunities",
  similes: [
    "ANALYZE",
    "ANALYZE_TOKEN",
    "TRADE",
    "ANALYZE_TRADE",
    "EVALUATE",
    "ASSESS"
  ],
  examples: [],
  validate: async () => true,
  handler: async (runtime, memory, state, params, callback) => {
    try {
      if (!state) {
        state = await runtime.composeState(memory);
      } else state = await runtime.updateRecentMessageState(state);
      const tokenData = {
        walletBalance: params.walletBalance,
        tokenAddress: params.tokenAddress,
        price: params.price,
        volume: params.volume,
        marketCap: params.marketCap,
        liquidity: params.liquidity,
        holderDistribution: params.holderDistribution,
        trustScore: params.trustScore,
        dexscreener: params.dexscreener,
        position: params.position
      };
      const prompt = `Analyze the following token data and provide a trading recommendation.
Return the response as a JSON object with the following structure:
{
  "recommendation": "BUY" | "SELL" | "HOLD",
  "confidence": number (0-100),
  "reasoning": string,
  "risks": string[],
  "opportunities": string[]
}

Token Data:
${JSON.stringify(tokenData, null, 2)}`;
      const content = await generateText({
        runtime,
        context: prompt,
        modelClass: ModelClass.LARGE
      });
      if (!content) {
        throw new Error("No analysis generated");
      }
      elizaLogger4.log(`Raw analysis response:`, content);
      const recommendation = parseJSONObjectFromText(content);
      elizaLogger4.log(
        `Parsed recommendation for ${params.tokenAddress}:`,
        recommendation
      );
      if (callback) {
        await callback({
          text: JSON.stringify(recommendation),
          type: "analysis"
        });
      }
      return true;
    } catch (error) {
      elizaLogger4.error(`Analysis failed:`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : void 0
      });
      return false;
    }
  }
};

// src/actions.ts
var actions = [analyzeTradeAction];

// src/services/twitter.ts
import { z } from "zod";
import { elizaLogger as elizaLogger5 } from "@elizaos/core";
var TwitterConfigSchema = z.object({
  enabled: z.boolean(),
  username: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
  apiKey: z.string().optional()
});
var tweetTrade = async (twitterService, alert) => {
  if (twitterService) {
    await twitterService.postTradeAlert({
      ...alert,
      timestamp: Date.now()
    });
  }
};
function canTweet(tweetType) {
  const now = Date.now();
  const hourKey = `tweets_${tweetType}_${Math.floor(now / 36e5)}`;
  const tweetCounts = /* @__PURE__ */ new Map();
  const currentCount = tweetCounts.get(hourKey) || 0;
  if (currentCount >= MAX_TWEETS_PER_HOUR[tweetType]) {
    elizaLogger5.warn(`Tweet rate limit reached for ${tweetType}`);
    return false;
  }
  tweetCounts.set(hourKey, currentCount + 1);
  return true;
}
var TwitterService = class {
  client;
  config;
  // Add public getter for config
  getConfig() {
    return this.config;
  }
  constructor(client, config) {
    this.client = client;
    this.config = config;
  }
  async postTradeAlert(alert) {
    try {
      const tweetContent = this.formatBuyAlert(alert);
      if (this.config.dryRun) {
        elizaLogger5.log(
          "Dry run mode - would have posted tweet:",
          tweetContent
        );
        return true;
      }
      if (!canTweet("trade")) {
        elizaLogger5.warn("Trade tweet rate limit reached");
        return false;
      }
      await this.client.post.client.twitterClient.sendTweet(tweetContent);
      elizaLogger5.log("Successfully posted trade alert to Twitter:", {
        content: tweetContent
      });
      return true;
    } catch (error) {
      elizaLogger5.error("Failed to post trade alert to Twitter:", {
        error: error instanceof Error ? error.message : String(error),
        alert
      });
      return false;
    }
  }
  formatBuyAlert(alert) {
    const priceChangePrefix = alert.marketData.priceChange24h >= 0 ? "+" : "";
    const trustScoreEmoji = alert.trustScore >= 0.8 ? "\u{1F7E2}" : alert.trustScore >= 0.5 ? "\u{1F7E1}" : "\u{1F534}";
    const hasValidTxId = alert.hash || alert.signature;
    const explorerUrl = hasValidTxId ? `https://solscan.io/tx/${alert.signature}` : null;
    if (alert.action === "SELL") {
      const actionEmoji = Number(alert.profitPercent?.replace("%", "")) >= 0 ? "\u{1F4B0} PROFIT SELL" : "\u{1F534} LOSS SELL";
      const lines = [
        `${actionEmoji} | ${alert.token}`,
        `\u{1F4CA} P/L: ${alert.profitPercent}`,
        `\u26A0\uFE0F Risk: ${alert.riskLevel}`,
        `\u{1F4B2} Price: $${alert.price?.toFixed(6)}`,
        `\u{1F4C8} 24h: ${priceChangePrefix}${alert.marketData.priceChange24h.toFixed(1)}%`,
        explorerUrl ? `\u{1F50D} ${explorerUrl}` : null,
        `$${alert.token}`
      ];
      return lines.filter(Boolean).join("\n");
    } else {
      const lines = [
        `\u{1F7E2} BUY | ${alert.token}`,
        `\u{1F3AF} Trust: ${trustScoreEmoji} ${(alert.trustScore * 100).toFixed(0)}%`,
        `\u{1F4C8} 24h: ${priceChangePrefix}${alert.marketData.priceChange24h.toFixed(1)}%`,
        `\u26A0\uFE0F Risk: ${alert.riskLevel}`,
        `\u{1F4B2} Price: $${alert.price?.toFixed(6)}`,
        explorerUrl ? `\u{1F50D} ${explorerUrl}` : null,
        `$${alert.token}`
      ];
      return lines.filter(Boolean).join("\n");
    }
  }
};

// src/wallet.ts
import { elizaLogger as elizaLogger7 } from "@elizaos/core";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

// src/utils.ts
import { elizaLogger as elizaLogger6, settings } from "@elizaos/core";
import { PublicKey } from "@solana/web3.js";

// src/config.ts
var BASE_CONFIG = {
  RPC_URL: process.env.EVM_PROVIDER_URL || "https://mainnet.base.org",
  ROUTER_ADDRESS: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
  // Base Uniswap V2 Router
  WETH_ADDRESS: "0x4200000000000000000000000000000000000006",
  // Base WETH
  CHAIN_ID: 8453,
  // Add Aerodrome-specific addresses
  AERODROME: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"
  }
};
var ZEROEX_CONFIG = {
  API_URL: "https://api.0x.org",
  API_KEY: process.env.ZEROEX_API_KEY || "",
  QUOTE_ENDPOINT: "/swap/permit2/quote",
  PRICE_ENDPOINT: "/swap/permit2/price",
  SUPPORTED_CHAINS: {
    BASE: 8453
  },
  HEADERS: {
    "Content-Type": "application/json",
    "0x-api-key": process.env.ZEROEX_API_KEY || "",
    "0x-version": "v2"
  }
};

// src/utils.ts
function decodeBase58(str) {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ALPHABET_MAP = new Map(
    ALPHABET.split("").map((c, i) => [c, BigInt(i)])
  );
  let result = BigInt(0);
  for (const char of str) {
    const value = ALPHABET_MAP.get(char);
    if (value === void 0) throw new Error("Invalid base58 character");
    result = result * BigInt(58) + value;
  }
  const bytes = [];
  while (result > 0n) {
    bytes.unshift(Number(result & 0xffn));
    result = result >> 8n;
  }
  for (let i = 0; i < str.length && str[i] === "1"; i++) {
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

// src/wallet.ts
function getWalletKeypair(runtime) {
  const privateKeyString = runtime?.getSetting("WALLET_PRIVATE_KEY");
  if (!privateKeyString) {
    throw new Error("No wallet private key configured");
  }
  try {
    const privateKeyBytes = decodeBase58(privateKeyString);
    return Keypair.fromSecretKey(privateKeyBytes);
  } catch (error) {
    elizaLogger7.error("Failed to create wallet keypair:", error);
    throw error;
  }
}
async function getWalletBalance(runtime) {
  try {
    const walletKeypair = getWalletKeypair(runtime);
    const walletPubKey = walletKeypair.publicKey;
    const connection = new Connection(
      runtime.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
    );
    const balance = await connection.getBalance(walletPubKey);
    const solBalance = balance / 1e9;
    elizaLogger7.log("Fetched Solana wallet balance:", {
      address: walletPubKey.toBase58(),
      lamports: balance,
      sol: solBalance
    });
    return solBalance;
  } catch (error) {
    elizaLogger7.error("Failed to get wallet balance:", error);
    return 0;
  }
}
async function getConnection(runtime) {
  return new Connection(
    runtime.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
  );
}
async function executeTrade(runtime, params, retryCount = 0) {
  try {
    elizaLogger7.log("Executing Solana trade with params:", params);
    const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
    if (!params.isSell && params.amount < SAFETY_LIMITS.MINIMUM_TRADE) {
      elizaLogger7.warn("Trade amount too small:", {
        amount: params.amount,
        minimumRequired: SAFETY_LIMITS.MINIMUM_TRADE
      });
      return {
        success: false,
        error: "Trade amount too small",
        details: {
          amount: params.amount,
          minimumRequired: SAFETY_LIMITS.MINIMUM_TRADE
        }
      };
    }
    const walletKeypair = getWalletKeypair(runtime);
    const connection = await getConnection(runtime);
    const inputTokenCA = params.isSell ? params.tokenAddress : SOL_ADDRESS;
    const outputTokenCA = params.isSell ? SOL_ADDRESS : params.tokenAddress;
    const swapAmount = Math.floor(params.amount * 1e9);
    elizaLogger7.log("Trade execution details:", {
      isSell: params.isSell,
      inputToken: inputTokenCA,
      outputToken: outputTokenCA,
      amount: params.amount,
      slippage: params.slippage
    });
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputTokenCA}&outputMint=${outputTokenCA}&amount=${swapAmount}&slippageBps=${Math.floor(params.slippage * 1e4)}`
    );
    if (!quoteResponse.ok) {
      const error = await quoteResponse.text();
      elizaLogger7.warn("Quote request failed:", {
        status: quoteResponse.status,
        error
      });
      return {
        success: false,
        error: "Failed to get quote",
        details: { status: quoteResponse.status, error }
      };
    }
    const quoteData = await quoteResponse.json();
    if (!quoteData || quoteData.error) {
      elizaLogger7.warn("Invalid quote data:", quoteData);
      return {
        success: false,
        error: "Invalid quote data",
        details: quoteData
      };
    }
    elizaLogger7.log("Quote received:", quoteData);
    const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quoteData,
        userPublicKey: walletKeypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 2e6,
        dynamicComputeUnitLimit: true
      })
    });
    const swapData = await swapResponse.json();
    if (!swapData?.swapTransaction) {
      throw new Error("No swap transaction returned");
    }
    elizaLogger7.log("Swap transaction received");
    const transactionBuf = Buffer.from(swapData.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(transactionBuf);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
    tx.message.recentBlockhash = blockhash;
    tx.sign([walletKeypair]);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 5,
      preflightCommitment: "processed"
    });
    elizaLogger7.log("Transaction sent:", signature);
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight
      },
      "processed"
    );
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }
    const status = await connection.getSignatureStatus(signature);
    if (status.value?.err) {
      throw new Error(
        `Transaction verification failed: ${status.value.err}`
      );
    }
    elizaLogger7.log("Solana trade executed successfully:", {
      signature,
      explorer: `https://solscan.io/tx/${signature}`
    });
    return {
      success: true,
      signature,
      confirmation,
      explorer: `https://solscan.io/tx/${signature}`
    };
  } catch (error) {
    if ((error.message?.includes("Blockhash not found") || error.message?.includes("block height exceeded")) && retryCount < 3) {
      elizaLogger7.warn(
        `Transaction error, retrying (${retryCount + 1}/3)...`
      );
      await new Promise((resolve2) => setTimeout(resolve2, 5e3));
      return executeTrade(runtime, params, retryCount + 1);
    }
    elizaLogger7.error("Trade execution failed:", {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : void 0,
      params,
      retryCount
    });
    return {
      success: false,
      error: error.message || error,
      params,
      stack: error instanceof Error ? error.stack : void 0
    };
  }
}
async function getChainWalletBalance(runtime, _tokenAddress) {
  return await getWalletBalance(runtime);
}

// src/index.ts
var REQUIRED_SETTINGS = {
  WALLET_PUBLIC_KEY: "Solana wallet public key",
  DEXSCREENER_WATCHLIST_ID: "DexScreener watchlist ID",
  COINGECKO_API_KEY: "CoinGecko API key"
};
function validateSolanaAddress(address) {
  if (!address) return false;
  try {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      elizaLogger8.warn(`Solana address failed format check: ${address}`);
      return false;
    }
    const pubKey = new PublicKey2(address);
    const isValid = Boolean(pubKey.toBase58());
    elizaLogger8.log(
      `Solana address validation result for ${address}: ${isValid}`
    );
    return isValid;
  } catch (error) {
    elizaLogger8.error(`Address validation error for ${address}:`, error);
    return false;
  }
}
function loadTokenAddresses() {
  try {
    const filePath = path.resolve(
      process.cwd(),
      "../characters/tokens/tokenaddresses.json"
    );
    const data = fs.readFileSync(filePath, "utf8");
    const addresses = JSON.parse(data);
    const validAddresses = addresses.filter((addr) => {
      return validateSolanaAddress(addr);
    });
    elizaLogger8.log("Loaded token addresses:", {
      total: validAddresses.length,
      solana: validAddresses.filter((addr) => !addr.startsWith("0x")).length,
      base: validAddresses.filter((addr) => addr.startsWith("0x")).length
    });
    return validAddresses;
  } catch (error) {
    elizaLogger8.error("Failed to load token addresses:", error);
    throw new Error("Token addresses file not found or invalid");
  }
}
var tokenCache = new NodeCache2({
  stdTTL: 1200,
  // 20 minutes in seconds
  checkperiod: 120
  // Check for expired entries every 2 minutes
});
async function updateSellDetails(runtime, tokenAddress, recommenderId, tradeAmount, latestTrade, tokenData) {
  const trustScoreDb = new TrustScoreDatabase(runtime.databaseAdapter.db);
  const trade = await trustScoreDb.getLatestTradePerformance(
    tokenAddress,
    recommenderId,
    false
  );
  if (!trade) {
    elizaLogger8.error(
      `No trade found for token ${tokenAddress} and recommender ${recommenderId}`
    );
    throw new Error("No trade found to update");
  }
  const currentPrice = tokenData.dexScreenerData.pairs[0]?.priceUsd || 0;
  const marketCap = tokenData.dexScreenerData.pairs[0]?.marketCap || 0;
  const liquidity = tokenData.dexScreenerData.pairs[0]?.liquidity?.usd || 0;
  const sellValueUsd = tradeAmount * Number(currentPrice);
  const profitUsd = sellValueUsd - trade.buy_value_usd;
  const profitPercent = profitUsd / trade.buy_value_usd * 100;
  const sellDetails = {
    sell_price: Number(currentPrice),
    sell_timeStamp: (/* @__PURE__ */ new Date()).toISOString(),
    sell_amount: tradeAmount,
    received_sol: tradeAmount,
    sell_value_usd: sellValueUsd,
    profit_usd: profitUsd,
    profit_percent: profitPercent,
    sell_market_cap: marketCap,
    market_cap_change: marketCap - trade.buy_market_cap,
    sell_liquidity: liquidity,
    liquidity_change: liquidity - trade.buy_liquidity,
    rapidDump: false,
    sell_recommender_id: recommenderId || null
  };
  elizaLogger8.log("Attempting to update trade performance with data:", {
    sellDetails,
    whereClause: {
      tokenAddress,
      recommenderId,
      buyTimeStamp: trade.buy_timeStamp
    },
    isSimulation: false
  });
  try {
    try {
      elizaLogger8.log(
        "Verifying parameters for updateTradePerformanceOnSell:",
        {
          sellDetails,
          tokenAddress,
          recommenderId,
          buyTimeStamp: trade.buy_timeStamp,
          isSimulation: false
        }
      );
      const success = await trustScoreDb.updateTradePerformanceOnSell(
        tokenAddress,
        // 1. WHERE token_address = ?
        recommenderId,
        // 2. WHERE recommender_id = ?
        trade.buy_timeStamp,
        // 3. WHERE buy_timeStamp = ?
        sellDetails,
        // 4. SET clause parameters
        false
        // 5. isSimulation flag
      );
      if (!success) {
        elizaLogger8.warn("Trade update returned false", {
          tokenAddress,
          recommenderId,
          buyTimeStamp: trade.buy_timeStamp
        });
      }
      elizaLogger8.log("Trade performance update completed", {
        success,
        tokenAddress,
        recommenderId,
        profitPercent: profitPercent.toFixed(2) + "%",
        profitUsd: profitUsd.toFixed(4) + " USD"
      });
    } catch (dbError) {
      elizaLogger8.error("Database error during trade update:", {
        error: dbError,
        query: {
          sellDetails,
          whereClause: {
            tokenAddress,
            recommenderId,
            buyTimeStamp: trade.buy_timeStamp
          }
        }
      });
      throw dbError;
    }
  } catch (error) {
    elizaLogger8.error("Failed to update trade performance:", {
      error,
      parameters: {
        sellDetails,
        whereClause: {
          tokenAddress,
          recommenderId,
          buyTimeStamp: trade.buy_timeStamp
        },
        originalTrade: trade
      },
      errorDetails: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error
    });
    throw error;
  }
  return {
    sellDetails,
    currentPrice,
    profitDetails: {
      profitUsd,
      profitPercent,
      sellValueUsd
    }
  };
}
async function getChainBalance(connection, walletAddress, tokenAddress) {
  return await getTokenBalance(
    connection,
    // TODO: Resolve type conflict caused by multiple versions of @solana/web3.js
    walletAddress,
    new PublicKey2(tokenAddress)
  );
}
async function createRabbiTraderPlugin(getSetting, runtime) {
  const resumeTrading = async () => {
    const tokenAddresses = loadTokenAddresses().filter(
      (addr) => !addr.startsWith("0x")
    );
    elizaLogger8.log(`Analyzing ${tokenAddresses.length} Solana tokens...`);
    for (const tokenAddress of tokenAddresses) {
      await analyzeToken(
        runtime,
        connection,
        twitterService,
        tokenAddress
      );
    }
    await new Promise((resolve2) => setTimeout(resolve2, 12e5));
  };
  elizaLogger8.log("Starting GOAT plugin initialization");
  const connection = new Connection2(
    runtime?.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
  );
  const keypair = getWalletKeypair(runtime);
  const missingSettings = [];
  for (const [key, description] of Object.entries(REQUIRED_SETTINGS)) {
    if (!getSetting(key)) {
      missingSettings.push(`${key} (${description})`);
    }
  }
  if (missingSettings.length > 0) {
    const errorMsg = `Missing required settings: ${missingSettings.join(
      ", "
    )}`;
    elizaLogger8.error(errorMsg);
    throw new Error(errorMsg);
  }
  elizaLogger8.log("Initializing Solana connection...");
  const walletProvider = {
    connection,
    getChain: () => ({ type: "solana" }),
    getAddress: () => keypair.publicKey.toBase58(),
    signMessage: async (_message) => {
      throw new Error(
        "Message signing not implemented for Solana wallet"
      );
    },
    balanceOf: async (tokenAddress) => {
      try {
        if (tokenAddress.startsWith("0x")) {
          const baseBalance = await getChainBalance(
            connection,
            keypair.publicKey,
            tokenAddress
          );
          return {
            value: BigInt(baseBalance.toString()),
            decimals: 18,
            // Base uses 18 decimals
            formatted: (baseBalance / 1e18).toString(),
            symbol: "ETH",
            name: "Base"
          };
        } else {
          const tokenPublicKey = new PublicKey2(tokenAddress);
          const amount = await getTokenBalance(
            connection,
            // TODO: Resolve type conflict caused by multiple versions of @solana/web3.js
            keypair.publicKey,
            tokenPublicKey
          );
          return {
            value: BigInt(amount.toString()),
            decimals: 9,
            formatted: (amount / 1e9).toString(),
            symbol: "SOL",
            name: "Solana"
          };
        }
      } catch {
        return {
          value: BigInt(0),
          decimals: tokenAddress.startsWith("0x") ? 18 : 9,
          formatted: "0",
          symbol: tokenAddress.startsWith("0x") ? "ETH" : "SOL",
          name: tokenAddress.startsWith("0x") ? "Base" : "Solana"
        };
      }
    },
    getMaxBuyAmount: async (tokenAddress) => {
      try {
        if (tokenAddress.startsWith("0x")) {
          const baseBalance = await getChainBalance(
            connection,
            keypair.publicKey,
            tokenAddress
          );
          return baseBalance * 0.9 / 1e18;
        } else {
          const balance = await connection.getBalance(
            keypair.publicKey
          );
          return balance * 0.9 / 1e9;
        }
      } catch (error) {
        elizaLogger8.error(
          `Failed to get max buy amount for ${tokenAddress}:`,
          error
        );
        return 0;
      }
    },
    executeTrade: async (_params) => {
      return { success: true };
    },
    getFormattedPortfolio: async () => ""
  };
  elizaLogger8.log(
    "Solana connection and wallet provider initialized successfully"
  );
  let twitterService;
  try {
    elizaLogger8.log(
      "Configuring Twitter service for trade notifications..."
    );
    const twitterConfig = TwitterConfigSchema.parse({
      enabled: getSetting("TWITTER_ENABLED") === "true",
      username: getSetting("TWITTER_USERNAME"),
      dryRun: false
    });
    if (twitterConfig.enabled && runtime) {
      elizaLogger8.log("Starting Twitter client initialization...");
      const twitterClient = await TwitterClientInterface.start(runtime);
      twitterService = new TwitterService(twitterClient, twitterConfig);
      await new Promise((resolve2) => setTimeout(resolve2, 5e3));
      elizaLogger8.log("Twitter service initialized successfully", {
        username: twitterConfig.username,
        dryRun: twitterConfig.dryRun
      });
    }
  } catch (error) {
    elizaLogger8.error("Failed to initialize Twitter service:", error);
  }
  elizaLogger8.log("Initializing Solana plugin components...");
  try {
    const customActions = actions;
    const plugin = {
      name: "[Rabbi Trader] Onchain Actions with Solana Integration",
      description: "Autonomous trading integration with AI analysis",
      evaluators: [trustEvaluator, ...solanaPlugin.evaluators || []],
      providers: [
        walletProvider,
        trustScoreProvider,
        ...solanaPlugin.providers || []
      ],
      actions: [...customActions, ...solanaPlugin.actions || []],
      services: [],
      autoStart: true
    };
    if (!runtime) return;
    elizaLogger8.log("Starting autonomous trading system...");
    const analyzeTradeAction2 = plugin.actions.find(
      (a) => a.name === "ANALYZE_TRADE"
    );
    if (!analyzeTradeAction2) return;
    const interval = Number(runtime.getSetting("TRADING_INTERVAL")) || 3e5;
    if (!settings2.ENABLE_TRADING) return;
    elizaLogger8.log("Initializing trading loop...");
    await resumeTrading();
    setInterval(resumeTrading, interval);
    elizaLogger8.log("GOAT plugin initialization completed successfully");
    return plugin;
  } catch (error) {
    elizaLogger8.error("Failed to initialize plugin components:", error);
    throw new Error(
      `Plugin initialization failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
async function analyzeToken(runtime, connection, twitterService, tokenAddress) {
  try {
    const cachedData = tokenCache.get(tokenAddress);
    const now = Date.now();
    if (cachedData && now - cachedData.lastAnalysis < 12e5) {
      elizaLogger8.log(
        `Using cached data for ${tokenAddress}, last analyzed ${Math.floor(
          (now - cachedData.lastAnalysis) / 1e3
        )}s ago`
      );
      return;
    }
    elizaLogger8.log(`Starting analysis for token: ${tokenAddress}`);
    await new Promise((resolve2) => setTimeout(resolve2, 2e3));
    if (!validateSolanaAddress(tokenAddress)) {
      elizaLogger8.error(`Invalid token address format: ${tokenAddress}`);
      return;
    }
    const tokenProvider = new TokenProvider(tokenAddress);
    elizaLogger8.log(`Fetching token data for ${tokenAddress}`);
    const tokenData = await tokenProvider.getProcessedTokenData();
    elizaLogger8.log(`Token data fetched for ${tokenAddress}:`, tokenData);
    const trustProvider = new TrustScoreProvider();
    const trustEvaluation = await trustProvider.evaluateToken(tokenAddress);
    const { trustScore } = trustEvaluation;
    const cacheEntry = {
      lastAnalysis: Date.now(),
      tokenData,
      trustScore,
      analysisResult: null
      // Will be updated after analysis
    };
    tokenCache.set(tokenAddress, cacheEntry);
    const walletPublicKey = runtime.getSetting("WALLET_PUBLIC_KEY");
    if (!walletPublicKey) {
      elizaLogger8.error("No wallet public key configured");
      return;
    }
    const trustScoreDb = new TrustScoreDatabase(runtime.databaseAdapter.db);
    const latestTrade = trustScoreDb.getLatestTradePerformance(
      tokenAddress,
      runtime.agentId,
      false
      // not simulation
    );
    elizaLogger8.log(`Latest trade for ${tokenAddress}:`, latestTrade);
    const walletBalance = await getChainWalletBalance(
      runtime,
      tokenAddress
    );
    const pair = tokenData.dexScreenerData.pairs[0];
    const analysisParams = {
      walletBalance,
      // Now using the correct chain's balance
      tokenAddress,
      price: Number(pair?.priceUsd || 0),
      volume: pair?.volume?.h24 || 0,
      marketCap: pair?.marketCap || 0,
      liquidity: pair?.liquidity?.usd || 0,
      holderDistribution: tokenData.holderDistributionTrend,
      trustScore: trustScore || 0,
      dexscreener: tokenData.dexScreenerData,
      position: latestTrade ? {
        token_address: latestTrade.token_address,
        entry_price: latestTrade.buy_price,
        size: latestTrade.buy_amount,
        stop_loss: latestTrade.buy_price * 0.85,
        // 15% stop loss
        take_profit: latestTrade.buy_price * 1.3,
        // 30% take profit
        open_timeStamp: latestTrade.buy_timeStamp,
        status: latestTrade.sell_timeStamp ? "CLOSED" : "OPEN"
      } : void 0
    };
    const state = await runtime.composeState({
      userId: runtime.agentId,
      agentId: runtime.agentId,
      roomId: runtime.agentId,
      content: {
        text: `Initialize state for ${tokenAddress}`,
        type: "analysis"
      }
    });
    const analysisMemory = {
      userId: state.userId,
      agentId: runtime.agentId,
      roomId: state.roomId,
      content: {
        text: `Analyze trade for ${tokenAddress}`,
        type: "analysis"
      }
    };
    const analysisResult = await analyzeTradeAction.handler(
      runtime,
      analysisMemory,
      state,
      analysisParams,
      async (response) => {
        if (!response) {
          elizaLogger8.error(
            `Empty response from analysis for ${tokenAddress}`
          );
          return [];
        }
        elizaLogger8.log(
          `Analysis result for ${tokenAddress}:`,
          response
        );
        try {
          const result = typeof response.text === "string" ? JSON.parse(response.text) : response.text;
          if (!result) {
            elizaLogger8.error(
              `Invalid analysis result for ${tokenAddress}`
            );
            return [];
          }
          if (result.shouldTrade && result.recommendedAction === "BUY") {
            await buy({
              result,
              runtime,
              state,
              tokenAddress,
              tokenData,
              twitterService,
              trustScore
            });
          } else if (result.recommendedAction === "SELL") {
            await sell({
              latestTrade,
              result,
              runtime,
              state,
              tokenAddress,
              tokenProvider,
              trustScoreDb,
              twitterService,
              trustScore
            });
          } else {
            elizaLogger8.log(
              `Trade not recommended for ${tokenAddress}:`,
              result
            );
          }
        } catch (err) {
          elizaLogger8.error("rabbi - trade error", err);
        }
        return [];
      }
    );
    cacheEntry.analysisResult = analysisResult;
    tokenCache.set(tokenAddress, cacheEntry);
  } catch (tokenError) {
    elizaLogger8.error(`Error processing token ${tokenAddress}:`, {
      error: tokenError,
      stack: tokenError instanceof Error ? tokenError.stack : void 0
    });
    await new Promise((resolve2) => setTimeout(resolve2, 2e3));
  }
}
async function buy({
  runtime,
  tokenAddress,
  state,
  tokenData,
  result,
  twitterService,
  trustScore
}) {
  elizaLogger8.log(`Trade recommended for ${tokenAddress}:`, result);
  const simulationService = new SimulationService();
  const simulation = await simulationService.simulateTrade(
    tokenAddress,
    result.suggestedAmount || SAFETY_LIMITS.MINIMUM_TRADE
  );
  if (simulation.recommendedAction === "EXECUTE") {
    try {
      const currentBalance = await getWalletBalance(runtime);
      const tradeAmount = Math.min(
        result.suggestedAmount || SAFETY_LIMITS.MINIMUM_TRADE,
        currentBalance * 0.95
        // Leave some SOL for fees
      );
      if (tradeAmount < SAFETY_LIMITS.MINIMUM_TRADE) {
        elizaLogger8.warn(
          `Insufficient balance for trade: ${currentBalance} SOL`
        );
      }
      const tradeMemory = {
        userId: state.userId,
        agentId: runtime.agentId,
        roomId: state.roomId,
        content: {
          text: `Execute trade for ${tokenAddress}`,
          tokenAddress,
          amount: SAFETY_LIMITS.MINIMUM_TRADE,
          action: "BUY",
          source: "system",
          type: "trade"
        }
      };
      const tradeResult = await executeTrade(runtime, {
        tokenAddress,
        amount: tradeAmount,
        slippage: tokenAddress.startsWith("0x") ? 0.03 : 0.3,
        // 3% for Base, 30% for Solana
        chain: tokenAddress.startsWith("0x") ? "base" : "solana"
      });
      if (tradeResult.success) {
        elizaLogger8.log(
          `Trade executed successfully for ${tokenAddress}:`,
          {
            signature: tradeResult.signature,
            amount: tradeAmount,
            memory: tradeMemory
          }
        );
        if (twitterService && result.recommendedAction === "BUY") {
          await tweetTrade(twitterService, {
            token: tokenData.dexScreenerData.pairs[0]?.baseToken?.symbol || tokenAddress,
            tokenAddress,
            amount: tradeAmount,
            trustScore: Number(trustScore) || 0,
            riskLevel: result.riskLevel || "MEDIUM",
            marketData: {
              priceChange24h: tokenData.dexScreenerData.pairs[0]?.priceChange?.h24 || 0,
              volume24h: tokenData.dexScreenerData.pairs[0]?.volume?.h24 || 0,
              liquidity: {
                usd: tokenData.dexScreenerData.pairs[0]?.liquidity?.usd || 0
              }
            },
            timestamp: Date.now(),
            signature: tradeResult.signature,
            hash: tradeResult.hash,
            action: "BUY",
            price: Number(
              tokenData.dexScreenerData.pairs[0]?.priceUsd || 0
            )
          });
        } else {
          elizaLogger8.log("Skipping tweet due to rate limit");
        }
        const trustScoreDb = new TrustScoreDatabase(
          runtime.databaseAdapter.db
        );
        try {
          elizaLogger8.log(
            `Attempting to validate token address: ${tokenAddress}`
          );
          const formattedAddress = tokenAddress.startsWith("0x") ? tokenAddress : new PublicKey2(tokenAddress).toBase58();
          elizaLogger8.log(
            `Token address validated successfully: ${formattedAddress}`
          );
          const uuid = v4_default();
          const recommender = await trustScoreDb.getOrCreateRecommender({
            id: uuid,
            address: "",
            solanaPubkey: runtime.getSetting("WALLET_PUBLIC_KEY") || ""
          });
          elizaLogger8.log(`Created/retrieved recommender:`, {
            recommender,
            chainType: tokenAddress.startsWith("0x") ? "base" : "solana"
          });
          const tradeData = {
            buy_amount: tradeAmount,
            is_simulation: false,
            token_address: new PublicKey2(tokenAddress).toBase58(),
            buy_price: tokenData.dexScreenerData.pairs[0]?.priceUsd || 0,
            buy_timeStamp: (/* @__PURE__ */ new Date()).toISOString(),
            buy_market_cap: tokenData.dexScreenerData.pairs[0]?.marketCap || 0,
            buy_liquidity: tokenData.dexScreenerData.pairs[0]?.liquidity?.usd || 0,
            buy_value_usd: tradeAmount * Number(
              tokenData.dexScreenerData.pairs[0]?.priceUsd || 0
            )
          };
          elizaLogger8.log(`Prepared trade data:`, tradeData);
          await trustScoreDb.addTradePerformance(
            {
              token_address: formattedAddress,
              // Use the properly formatted address
              recommender_id: recommender.id,
              buy_price: Number(tradeData.buy_price),
              buy_timeStamp: tradeData.buy_timeStamp,
              buy_amount: tradeData.buy_amount,
              buy_value_usd: tradeData.buy_value_usd,
              buy_market_cap: tradeData.buy_market_cap,
              buy_liquidity: tradeData.buy_liquidity,
              buy_sol: tradeAmount,
              last_updated: (/* @__PURE__ */ new Date()).toISOString(),
              sell_price: 0,
              sell_timeStamp: "",
              sell_amount: 0,
              received_sol: 0,
              sell_value_usd: 0,
              sell_market_cap: 0,
              sell_liquidity: 0,
              profit_usd: 0,
              profit_percent: 0,
              market_cap_change: 0,
              liquidity_change: 0,
              rapidDump: false
            },
            false
          );
          elizaLogger8.log(
            `Successfully recorded trade performance for ${tokenAddress}`
          );
        } catch (error) {
          elizaLogger8.error("Failed to record trade performance:", {
            error,
            tokenAddress,
            errorMessage: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : void 0,
            errorType: error?.constructor?.name
          });
        }
      } else {
        elizaLogger8.error(
          `Trade execution failed for ${tokenAddress}:`,
          tradeResult.error
        );
      }
    } catch (tradeError) {
      elizaLogger8.error(
        `Error during trade execution for ${tokenAddress}:`,
        {
          error: tradeError,
          stack: tradeError instanceof Error ? tradeError.stack : void 0
        }
      );
    }
  } else {
    elizaLogger8.log(
      `Simulation rejected trade for ${tokenAddress}:`,
      simulation
    );
  }
}
async function sell({
  // eslint-disable-next-line
  state,
  runtime,
  tokenAddress,
  tokenProvider,
  twitterService,
  trustScoreDb,
  latestTrade,
  result,
  trustScore
}) {
  const tradeAmount = Number(latestTrade?.buy_amount || 0);
  const tradeResult = await executeTrade(runtime, {
    tokenAddress,
    amount: tradeAmount,
    slippage: 0.3,
    //  30% for Solana
    chain: "solana"
  });
  if (tradeResult.success) {
    elizaLogger8.log(`Sell executed successfully for ${tokenAddress}:`, {
      signature: tradeResult.signature,
      amount: tradeAmount
    });
    const tokenData = await tokenProvider.getProcessedTokenData();
    const uuid = v4_default();
    const recommender = await trustScoreDb.getOrCreateRecommender({
      id: uuid,
      address: "",
      // Empty since we're only handling Solana
      solanaPubkey: runtime.getSetting("WALLET_PUBLIC_KEY") || ""
    });
    const { sellDetails, currentPrice } = await updateSellDetails(
      runtime,
      tokenAddress,
      recommender.id,
      tradeAmount,
      latestTrade,
      tokenData
    );
    if (twitterService) {
      await tweetTrade(twitterService, {
        token: tokenData.dexScreenerData.pairs[0]?.baseToken?.symbol || tokenAddress,
        tokenAddress,
        amount: tradeAmount,
        trustScore: Number(trustScore) || 0,
        riskLevel: result.riskLevel || "MEDIUM",
        marketData: {
          priceChange24h: tokenData.dexScreenerData.pairs[0]?.priceChange?.h24 || 0,
          volume24h: tokenData.dexScreenerData.pairs[0]?.volume?.h24 || 0,
          liquidity: {
            usd: tokenData.dexScreenerData.pairs[0]?.liquidity?.usd || 0
          }
        },
        timestamp: Date.now(),
        signature: tradeResult.signature,
        hash: tradeResult.hash,
        action: "SELL",
        price: Number(currentPrice),
        profitPercent: `${sellDetails.profit_percent.toFixed(2)}%`,
        profitUsd: `${sellDetails.profit_usd.toFixed(4)} USD`,
        reason: `P/L: ${sellDetails.profit_percent.toFixed(2)}%`
      });
    }
    elizaLogger8.log(
      `Successfully updated sell details for ${tokenAddress}`,
      {
        sellPrice: currentPrice,
        sellAmount: tradeAmount
      }
    );
  } else {
    elizaLogger8.error(
      `Sell execution failed for ${tokenAddress}:`,
      tradeResult.error
    );
  }
}
var index_default = createRabbiTraderPlugin;
export {
  index_default as default,
  loadTokenAddresses
};
//# sourceMappingURL=index.js.map