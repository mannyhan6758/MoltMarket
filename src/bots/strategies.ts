/**
 * Bot trading strategies.
 */

import { BaseBot, BotConfig, MarketState } from './base-bot.js';
import type { Action } from '../types/domain.js';

/**
 * Random Bot: Places random orders near the current price.
 */
export class RandomBot extends BaseBot {
  private readonly priceRange: number;
  private readonly maxQuantity: number;

  constructor(config: BotConfig, priceRange = 0.05, maxQuantity = 5) {
    super(config);
    this.priceRange = priceRange;
    this.maxQuantity = maxQuantity;
  }

  decide(state: MarketState): Action[] {
    const actions: Action[] = [];

    // Skip if no market price reference
    const refPrice = state.midPrice || 100;

    // Randomly decide whether to trade
    if (!this.rng.chance(0.3)) {
      return actions;
    }

    // Determine side
    const side = this.rng.chance(0.5) ? 'bid' : 'ask';

    // Generate price near reference
    const priceOffset = (this.rng.next() - 0.5) * 2 * this.priceRange * refPrice;
    const price = Math.max(0.01, refPrice + priceOffset);

    // Generate quantity
    const quantity = Math.max(0.1, this.rng.next() * this.maxQuantity);

    // Check if we can afford it
    if (side === 'bid' && price * quantity > state.cashBalance * 0.5) {
      return actions;
    }
    if (side === 'ask' && quantity > state.assetBalance * 0.5) {
      return actions;
    }

    if (side === 'bid') {
      actions.push(this.placeBid(price, quantity));
    } else {
      actions.push(this.placeAsk(price, quantity));
    }

    return actions;
  }
}

/**
 * Market Maker Bot: Quotes both sides to capture spread.
 */
export class MarketMakerBot extends BaseBot {
  private readonly spreadBps: number;
  private readonly orderSize: number;
  private readonly maxInventory: number;

  constructor(config: BotConfig, spreadBps = 50, orderSize = 2, maxInventory = 50) {
    super(config);
    this.spreadBps = spreadBps;
    this.orderSize = orderSize;
    this.maxInventory = maxInventory;
  }

  decide(state: MarketState): Action[] {
    const actions: Action[] = [];

    const refPrice = state.midPrice || 100;
    const halfSpread = (refPrice * this.spreadBps) / 10000 / 2;

    // Cancel existing orders
    for (const order of state.openOrders) {
      actions.push(this.cancelOrder(order.orderId));
    }

    // Calculate inventory imbalance
    const initialAsset = 100; // Assume
    const inventoryRatio = state.assetBalance / initialAsset;
    const skew = (inventoryRatio - 1) * halfSpread * 2; // Skew quotes based on inventory

    // Place bid (lower if holding too much)
    const bidPrice = refPrice - halfSpread - skew;
    if (state.cashBalance > bidPrice * this.orderSize && state.assetBalance < this.maxInventory) {
      actions.push(this.placeBid(bidPrice, this.orderSize));
    }

    // Place ask (lower if holding too little)
    const askPrice = refPrice + halfSpread - skew;
    if (state.assetBalance > this.orderSize) {
      actions.push(this.placeAsk(askPrice, this.orderSize));
    }

    return actions;
  }
}

/**
 * Trend Follower Bot: Follows momentum by buying after price rises, selling after drops.
 */
export class TrendFollowerBot extends BaseBot {
  private readonly lookback: number;
  private readonly threshold: number;
  private readonly orderSize: number;
  private lastPrice: number | null = null;
  private priceHistory: number[] = [];

  constructor(config: BotConfig, lookback = 5, threshold = 0.01, orderSize = 3) {
    super(config);
    this.lookback = lookback;
    this.threshold = threshold;
    this.orderSize = orderSize;
  }

  decide(state: MarketState): Action[] {
    const actions: Action[] = [];

    if (!state.midPrice) return actions;

    // Update price history
    this.priceHistory.push(state.midPrice);
    if (this.priceHistory.length > this.lookback) {
      this.priceHistory.shift();
    }

    // Need enough history
    if (this.priceHistory.length < this.lookback) {
      return actions;
    }

    // Calculate trend
    const oldPrice = this.priceHistory[0]!;
    const currentPrice = this.priceHistory[this.priceHistory.length - 1]!;
    const change = (currentPrice - oldPrice) / oldPrice;

    // Only trade sometimes
    if (!this.rng.chance(0.2)) {
      return actions;
    }

    if (change > this.threshold) {
      // Uptrend - buy
      if (state.cashBalance > currentPrice * this.orderSize) {
        const price = currentPrice * 1.001; // Slightly aggressive
        actions.push(this.placeBid(price, this.orderSize));
      }
    } else if (change < -this.threshold) {
      // Downtrend - sell
      if (state.assetBalance > this.orderSize) {
        const price = currentPrice * 0.999; // Slightly aggressive
        actions.push(this.placeAsk(price, this.orderSize));
      }
    }

    return actions;
  }
}

/**
 * Mean Reversion Bot: Fades moves, buying after drops and selling after rises.
 */
export class MeanReversionBot extends BaseBot {
  private readonly lookback: number;
  private readonly threshold: number;
  private readonly orderSize: number;
  private priceHistory: number[] = [];

  constructor(config: BotConfig, lookback = 10, threshold = 0.02, orderSize = 2) {
    super(config);
    this.lookback = lookback;
    this.threshold = threshold;
    this.orderSize = orderSize;
  }

  decide(state: MarketState): Action[] {
    const actions: Action[] = [];

    if (!state.midPrice) return actions;

    // Update price history
    this.priceHistory.push(state.midPrice);
    if (this.priceHistory.length > this.lookback) {
      this.priceHistory.shift();
    }

    // Need enough history
    if (this.priceHistory.length < this.lookback) {
      return actions;
    }

    // Calculate mean
    const mean = this.priceHistory.reduce((a, b) => a + b, 0) / this.priceHistory.length;
    const currentPrice = state.midPrice;
    const deviation = (currentPrice - mean) / mean;

    // Only trade sometimes
    if (!this.rng.chance(0.15)) {
      return actions;
    }

    if (deviation > this.threshold) {
      // Price above mean - sell expecting reversion
      if (state.assetBalance > this.orderSize) {
        const price = currentPrice * 0.998;
        actions.push(this.placeAsk(price, this.orderSize));
      }
    } else if (deviation < -this.threshold) {
      // Price below mean - buy expecting reversion
      if (state.cashBalance > currentPrice * this.orderSize) {
        const price = currentPrice * 1.002;
        actions.push(this.placeBid(price, this.orderSize));
      }
    }

    return actions;
  }
}

/**
 * Aggressive Taker Bot: Places marketable orders to take liquidity.
 */
export class AggressiveTakerBot extends BaseBot {
  private readonly orderSize: number;

  constructor(config: BotConfig, orderSize = 1) {
    super(config);
    this.orderSize = orderSize;
  }

  decide(state: MarketState): Action[] {
    const actions: Action[] = [];

    // Only trade occasionally
    if (!this.rng.chance(0.1)) {
      return actions;
    }

    // Decide direction randomly
    const buyOrSell = this.rng.chance(0.5);

    if (buyOrSell && state.bestAsk) {
      // Buy at best ask (take liquidity)
      if (state.cashBalance > state.bestAsk * this.orderSize) {
        actions.push(this.placeBid(state.bestAsk * 1.001, this.orderSize));
      }
    } else if (!buyOrSell && state.bestBid) {
      // Sell at best bid (take liquidity)
      if (state.assetBalance > this.orderSize) {
        actions.push(this.placeAsk(state.bestBid * 0.999, this.orderSize));
      }
    }

    return actions;
  }
}
