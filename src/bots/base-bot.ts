/**
 * Base bot class for trading agents.
 */

import type { RNG } from '../utils/rng.js';
import type { Action, OrderSide } from '../types/domain.js';

export interface BotConfig {
  name: string;
  rng: RNG;
}

export interface MarketState {
  midPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  cashBalance: number;
  assetBalance: number;
  openOrders: Array<{
    orderId: string;
    side: OrderSide;
    price: number;
    quantity: number;
  }>;
  recentTrades: Array<{
    price: number;
    quantity: number;
    tickId: number;
  }>;
  currentTick: number;
}

export interface Bot {
  name: string;
  decide(state: MarketState): Action[];
}

export abstract class BaseBot implements Bot {
  public readonly name: string;
  protected readonly rng: RNG;

  constructor(config: BotConfig) {
    this.name = config.name;
    this.rng = config.rng;
  }

  abstract decide(state: MarketState): Action[];

  protected formatPrice(price: number): string {
    return price.toFixed(8);
  }

  protected formatQuantity(quantity: number): string {
    return quantity.toFixed(8);
  }

  protected placeBid(price: number, quantity: number): Action {
    return {
      type: 'place_limit_order',
      side: 'bid',
      price: this.formatPrice(price),
      quantity: this.formatQuantity(quantity),
    };
  }

  protected placeAsk(price: number, quantity: number): Action {
    return {
      type: 'place_limit_order',
      side: 'ask',
      price: this.formatPrice(price),
      quantity: this.formatQuantity(quantity),
    };
  }

  protected cancelOrder(orderId: string): Action {
    return {
      type: 'cancel_order',
      orderId,
    };
  }
}
