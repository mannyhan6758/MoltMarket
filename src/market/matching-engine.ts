/**
 * Matching Engine - Pure, deterministic order matching.
 * Implements price-time priority continuous double auction.
 */

import type { Order, Trade, OrderSide, RejectionCode } from '../types/domain.js';
import type { Amount } from '../types/amount.js';
import {
  parseAmount,
  ZERO,
  addAmount,
  subAmount,
  mulAmount,
  mulBasisPoints,
  isPositive,
  isNegative,
  minAmount,
  compareAmount,
} from '../types/amount.js';
import type { WorldState } from '../kernel/world-state.js';
import {
  addOrder,
  getOrder,
  cancelOrder as cancelOrderInState,
  fillOrder,
  getOpenOrdersBySide,
  getAgent,
  updateAgentBalance,
  addTrade,
} from '../kernel/world-state.js';

export interface BalanceUpdate {
  agentId: string;
  cashDelta: Amount;
  assetDelta: Amount;
  newCash: Amount;
  newAsset: Amount;
  reason: string;
}

export interface PlaceOrderResult {
  rejected: boolean;
  rejectionCode?: RejectionCode;
  rejectionMessage?: string;
  order?: Order;
  trades?: Trade[];
  balanceUpdates?: BalanceUpdate[];
}

export interface CancelOrderResult {
  rejected: boolean;
  rejectionCode?: RejectionCode;
  rejectionMessage?: string;
}

export interface MatchingEngine {
  /**
   * Place a limit order and attempt to match.
   * Pure function that updates world state.
   */
  placeOrder(
    state: WorldState,
    agentId: string,
    side: OrderSide,
    priceStr: string,
    quantityStr: string,
    feeBps: number
  ): PlaceOrderResult;

  /**
   * Cancel an existing order.
   */
  cancelOrder(state: WorldState, agentId: string, orderId: string): CancelOrderResult;
}

/**
 * Create a matching engine instance.
 */
export function createMatchingEngine(): MatchingEngine {
  function placeOrder(
    state: WorldState,
    agentId: string,
    side: OrderSide,
    priceStr: string,
    quantityStr: string,
    feeBps: number
  ): PlaceOrderResult {
    // Parse and validate inputs
    let price: Amount;
    let quantity: Amount;

    try {
      price = parseAmount(priceStr);
      quantity = parseAmount(quantityStr);
    } catch {
      return {
        rejected: true,
        rejectionCode: 'INVALID_ACTION',
        rejectionMessage: 'Invalid price or quantity format',
      };
    }

    // Validate price bounds
    if (!isPositive(price)) {
      return {
        rejected: true,
        rejectionCode: 'INVALID_PRICE',
        rejectionMessage: 'Price must be positive',
      };
    }

    if (price > state.config.maxPrice) {
      return {
        rejected: true,
        rejectionCode: 'INVALID_PRICE',
        rejectionMessage: 'Price exceeds maximum',
      };
    }

    if (price < state.config.minPrice) {
      return {
        rejected: true,
        rejectionCode: 'INVALID_PRICE',
        rejectionMessage: 'Price below minimum',
      };
    }

    // Validate quantity
    if (!isPositive(quantity)) {
      return {
        rejected: true,
        rejectionCode: 'INVALID_QUANTITY',
        rejectionMessage: 'Quantity must be positive',
      };
    }

    if (quantity < state.config.minQuantity) {
      return {
        rejected: true,
        rejectionCode: 'INVALID_QUANTITY',
        rejectionMessage: 'Quantity below minimum',
      };
    }

    // Get agent
    const agent = getAgent(state, agentId);
    if (!agent) {
      return {
        rejected: true,
        rejectionCode: 'INVALID_ACTION',
        rejectionMessage: 'Agent not found',
      };
    }

    if (agent.status !== 'active') {
      return {
        rejected: true,
        rejectionCode: 'AGENT_BANKRUPT',
        rejectionMessage: 'Agent is not active',
      };
    }

    // Check sufficient funds
    if (side === 'bid') {
      // Buyer needs CASH
      const orderValue = mulAmount(price, quantity);
      if (agent.cashBalance < orderValue) {
        return {
          rejected: true,
          rejectionCode: 'INSUFFICIENT_FUNDS',
          rejectionMessage: `Insufficient cash: have ${agent.cashBalance}, need ${orderValue}`,
        };
      }
    } else {
      // Seller needs ASSET
      if (agent.assetBalance < quantity) {
        return {
          rejected: true,
          rejectionCode: 'INSUFFICIENT_FUNDS',
          rejectionMessage: `Insufficient asset: have ${agent.assetBalance}, need ${quantity}`,
        };
      }
    }

    // Create the order
    const order = addOrder(state, agentId, side, price, quantity);

    // Attempt matching
    const { trades, balanceUpdates } = matchOrder(state, order, feeBps);

    return {
      rejected: false,
      order,
      trades,
      balanceUpdates,
    };
  }

  function matchOrder(
    state: WorldState,
    incomingOrder: Order,
    feeBps: number
  ): { trades: Trade[]; balanceUpdates: BalanceUpdate[] } {
    const trades: Trade[] = [];
    const balanceUpdates: BalanceUpdate[] = [];

    // Get opposite side orders
    const oppositeSide: OrderSide = incomingOrder.side === 'bid' ? 'ask' : 'bid';
    const oppositeOrders = getOpenOrdersBySide(state, oppositeSide);

    let remainingQty = subAmount(incomingOrder.quantity, incomingOrder.filledQuantity);

    for (const restingOrder of oppositeOrders) {
      if (!isPositive(remainingQty)) break;

      // Check price cross
      const canMatch =
        incomingOrder.side === 'bid'
          ? incomingOrder.price >= restingOrder.price // Bid >= Ask
          : incomingOrder.price <= restingOrder.price; // Ask <= Bid

      if (!canMatch) break; // Orders are sorted, no more matches possible

      // Determine fill quantity
      const restingRemaining = subAmount(restingOrder.quantity, restingOrder.filledQuantity);
      const fillQty = minAmount(remainingQty, restingRemaining);

      if (!isPositive(fillQty)) continue;

      // Trade price is the resting order's price (price-time priority)
      const tradePrice = restingOrder.price;
      const tradeValue = mulAmount(tradePrice, fillQty);

      // Calculate fee (split between parties)
      const totalFee = mulBasisPoints(tradeValue, feeBps);
      const feePerSide = totalFee / 2n;

      // Determine buyer and seller
      const isBuyer = incomingOrder.side === 'bid';
      const buyerOrder = isBuyer ? incomingOrder : restingOrder;
      const sellerOrder = isBuyer ? restingOrder : incomingOrder;
      const buyerAgentId = buyerOrder.agentId;
      const sellerAgentId = sellerOrder.agentId;

      // Update fills
      fillOrder(state, incomingOrder.id, fillQty);
      fillOrder(state, restingOrder.id, fillQty);

      // Update balances
      // Buyer: -CASH, +ASSET
      const buyerCashDelta = -(tradeValue + feePerSide);
      const { newCash: buyerNewCash, newAsset: buyerNewAsset } = updateAgentBalance(
        state,
        buyerAgentId,
        buyerCashDelta,
        fillQty
      );

      balanceUpdates.push({
        agentId: buyerAgentId,
        cashDelta: buyerCashDelta,
        assetDelta: fillQty,
        newCash: buyerNewCash,
        newAsset: buyerNewAsset,
        reason: 'trade_execution',
      });

      // Seller: +CASH, -ASSET
      const sellerCashDelta = tradeValue - feePerSide;
      const { newCash: sellerNewCash, newAsset: sellerNewAsset } = updateAgentBalance(
        state,
        sellerAgentId,
        sellerCashDelta,
        -fillQty
      );

      balanceUpdates.push({
        agentId: sellerAgentId,
        cashDelta: sellerCashDelta,
        assetDelta: -fillQty,
        newCash: sellerNewCash,
        newAsset: sellerNewAsset,
        reason: 'trade_execution',
      });

      // Create trade record
      const trade: Trade = {
        id: state.generateId(),
        runId: state.runId,
        tickId: state.currentTick,
        price: tradePrice,
        quantity: fillQty,
        bidOrderId: buyerOrder.id,
        askOrderId: sellerOrder.id,
        bidAgentId: buyerAgentId,
        askAgentId: sellerAgentId,
        feeTotal: totalFee,
        createdAt: new Date(),
      };

      trades.push(trade);
      addTrade(state, trade);

      remainingQty = subAmount(remainingQty, fillQty);
    }

    return { trades, balanceUpdates };
  }

  function cancelOrder(
    state: WorldState,
    agentId: string,
    orderId: string
  ): CancelOrderResult {
    const order = getOrder(state, orderId);

    if (!order) {
      return {
        rejected: true,
        rejectionCode: 'ORDER_NOT_FOUND',
        rejectionMessage: 'Order does not exist',
      };
    }

    if (order.agentId !== agentId) {
      return {
        rejected: true,
        rejectionCode: 'ORDER_NOT_OWNED',
        rejectionMessage: 'Order belongs to another agent',
      };
    }

    if (order.status !== 'open') {
      return {
        rejected: true,
        rejectionCode: 'ORDER_NOT_FOUND',
        rejectionMessage: 'Order is not open',
      };
    }

    const success = cancelOrderInState(state, orderId);

    if (!success) {
      return {
        rejected: true,
        rejectionCode: 'ORDER_NOT_FOUND',
        rejectionMessage: 'Failed to cancel order',
      };
    }

    return { rejected: false };
  }

  return {
    placeOrder,
    cancelOrder,
  };
}
