/**
 * HTTP API Server for MoltMarket.
 * Fastify-based REST API with WebSocket support.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { Kernel } from '../kernel/tick-controller.js';
import { hashApiKey } from '../utils/hash.js';
import { formatAmount, formatAmountDisplay, parseAmount } from '../types/amount.js';
import {
  getAgent,
  getAgentByApiKeyHash,
  getAgentOpenOrders,
  getBookLevels,
  getMidPrice,
  getSpread,
  getRecentTrades,
  getActiveAgentCount,
  getBankruptCount,
} from '../kernel/world-state.js';
import type { Action } from '../types/domain.js';

export interface ApiServerConfig {
  port: number;
  host: string;
}

export interface ApiServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getApp(): FastifyInstance;
}

/**
 * Create an API server for a kernel.
 */
export function createApiServer(kernel: Kernel, config: ApiServerConfig): ApiServer {
  const app = Fastify({ logger: true });

  // Auth middleware - extracts agent from API key
  const authenticateAgent = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header',
        },
      });
      return;
    }

    const apiKey = authHeader.slice(7);
    const apiKeyHash = hashApiKey(apiKey);
    const state = kernel.getState();
    const agent = getAgentByApiKeyHash(state, apiKeyHash);

    if (!agent) {
      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
      return;
    }

    // Attach agent to request
    (request as any).agent = agent;
  };

  // Setup routes
  const setupRoutes = async () => {
    await app.register(cors, { origin: true });
    await app.register(websocket);

    // Serve built UI assets if available
    const thisFile = fileURLToPath(import.meta.url);
    const uiDist = join(dirname(thisFile), '..', '..', 'ui', 'dist');
    if (existsSync(uiDist)) {
      await app.register(fastifyStatic, {
        root: uiDist,
        prefix: '/',
        wildcard: false,
      });
      // SPA fallback: serve index.html for non-API, non-file routes
      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/v1/') || request.url.startsWith('/health')) {
          reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
        } else {
          reply.sendFile('index.html');
        }
      });
    }

    // Health check
    app.get('/health', async () => ({ status: 'ok' }));

    // === API Discovery ===

    app.get('/v1', async () => ({
      name: 'MoltMarket',
      version: '0.1.0',
      description: 'Deterministic multi-agent market simulation',
      endpoints: {
        register: { method: 'POST', path: '/v1/agents/register', auth: false, description: 'Register a new trading agent. Returns API key.' },
        submit_actions: { method: 'POST', path: '/v1/actions', auth: true, description: 'Submit trading actions (place_limit_order, cancel_order).' },
        agent_state: { method: 'GET', path: '/v1/agent', auth: true, description: "Get your agent's balances, open orders, stats." },
        order_book: { method: 'GET', path: '/v1/market/book?depth=10', auth: false, description: 'Current order book (bids/asks).' },
        recent_trades: { method: 'GET', path: '/v1/market/trades?limit=100', auth: false, description: 'Recent trade history.' },
        market_stats: { method: 'GET', path: '/v1/market/stats', auth: false, description: 'Market statistics.' },
        run_status: { method: 'GET', path: '/v1/run/status', auth: false, description: 'Current simulation status.' },
        leaderboard: { method: 'GET', path: '/v1/leaderboard', auth: false, description: 'Agent rankings by PnL.' },
        stream: { method: 'WS', path: '/v1/stream', auth: false, description: 'Real-time event stream.' },
      },
      action_types: {
        place_limit_order: { fields: ['side (bid|ask)', 'price (decimal string)', 'quantity (decimal string)'] },
        cancel_order: { fields: ['order_id'] },
      },
      quick_start: '1) POST /v1/agents/register with {name}. 2) Use returned api_key as Bearer token. 3) GET /v1/market/book to see the market. 4) POST /v1/actions to trade.',
    }));

    // === Public Agent Registration ===

    app.post('/v1/agents/register', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { name?: string } | null;

      if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
        return reply.code(400).send({
          error: { code: 'INVALID_REQUEST', message: 'Missing or empty "name" field.' },
        });
      }

      const name = body.name.trim();

      if (name.length > 64) {
        return reply.code(400).send({
          error: { code: 'INVALID_REQUEST', message: 'Name must be 64 characters or fewer.' },
        });
      }

      // Check agent count limit (prevent abuse)
      const state = kernel.getState();
      if (state.agents.size >= 20) {
        return reply.code(429).send({
          error: { code: 'LIMIT_REACHED', message: 'Maximum number of agents (20) reached for this run.' },
        });
      }

      // Check for duplicate name
      for (const agent of state.agents.values()) {
        if (agent.name === name) {
          return reply.code(409).send({
            error: { code: 'NAME_TAKEN', message: `Agent name "${name}" is already registered.` },
          });
        }
      }

      const { agentId, apiKey } = kernel.createAgent(name);

      return reply.code(201).send({
        agent_id: agentId,
        api_key: apiKey,
        name,
        message: 'Save your API key — it is shown only once.',
      });
    });

    // === Agent Endpoints (authenticated) ===

    // Submit actions
    app.post('/v1/actions', {
      preHandler: authenticateAgent,
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const agent = (request as any).agent;
        const body = request.body as {
          idempotency_key: string;
          actions: Array<{
            type: string;
            side?: string;
            price?: string;
            quantity?: string;
            order_id?: string;
          }>;
        };

        if (!body.idempotency_key || !Array.isArray(body.actions)) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Missing idempotency_key or actions array',
            },
          });
        }

        // Convert snake_case to camelCase for internal processing
        const actions: Action[] = body.actions.map((a) => {
          if (a.type === 'place_limit_order') {
            return {
              type: 'place_limit_order' as const,
              side: a.side as 'bid' | 'ask',
              price: a.price!,
              quantity: a.quantity!,
            };
          } else if (a.type === 'cancel_order') {
            return {
              type: 'cancel_order' as const,
              orderId: a.order_id!,
            };
          }
          throw new Error(`Unknown action type: ${a.type}`);
        });

        const results = kernel.submitActions(agent.id, actions, body.idempotency_key);

        return {
          tick_id: kernel.getCurrentTick(),
          results: results.map((r) => ({
            action_index: r.actionIndex,
            status: r.status,
            order_id: r.orderId,
            reason_code: r.reasonCode,
            message: r.message,
          })),
        };
      },
    });

    // Get agent state
    app.get('/v1/agent', {
      preHandler: authenticateAgent,
      handler: async (request: FastifyRequest) => {
        const agent = (request as any).agent;
        const state = kernel.getState();
        const openOrders = getAgentOpenOrders(state, agent.id);

        return {
          agent_id: agent.id,
          name: agent.name,
          status: agent.status,
          balances: {
            cash: formatAmount(agent.cashBalance),
            asset: formatAmount(agent.assetBalance),
          },
          open_orders: openOrders.map((o) => ({
            order_id: o.id,
            side: o.side,
            price: formatAmount(o.price),
            quantity: formatAmount(o.quantity),
            filled_quantity: formatAmount(o.filledQuantity),
            tick_created: o.tickCreated,
          })),
          stats: {
            trade_count: state.trades.filter(
              (t) => t.bidAgentId === agent.id || t.askAgentId === agent.id
            ).length,
            order_count: Array.from(state.orders.values()).filter(
              (o) => o.agentId === agent.id
            ).length,
            reject_count: kernel
              .getEventStore()
              .getByType('ORDER_REJECTED')
              .filter((e) => e.agentId === agent.id).length,
          },
          current_tick: kernel.getCurrentTick(),
        };
      },
    });

    // Get agent trade history
    app.get('/v1/agent/history', {
      preHandler: authenticateAgent,
      handler: async (request: FastifyRequest) => {
        const agent = (request as any).agent;
        const query = request.query as {
          limit?: string;
          offset?: string;
          from_tick?: string;
          to_tick?: string;
        };

        const limit = Math.min(parseInt(query.limit || '100'), 1000);
        const offset = parseInt(query.offset || '0');
        const fromTick = query.from_tick ? parseInt(query.from_tick) : undefined;
        const toTick = query.to_tick ? parseInt(query.to_tick) : undefined;

        const state = kernel.getState();
        let trades = state.trades.filter(
          (t) => t.bidAgentId === agent.id || t.askAgentId === agent.id
        );

        if (fromTick !== undefined) {
          trades = trades.filter((t) => t.tickId >= fromTick);
        }
        if (toTick !== undefined) {
          trades = trades.filter((t) => t.tickId <= toTick);
        }

        const total = trades.length;
        trades = trades.slice(offset, offset + limit);

        return {
          trades: trades.map((t) => ({
            trade_id: t.id,
            tick_id: t.tickId,
            side: t.bidAgentId === agent.id ? 'buy' : 'sell',
            price: formatAmount(t.price),
            quantity: formatAmount(t.quantity),
            fee: formatAmount(t.feeTotal / 2n), // Per-side fee
            counterparty_anonymous: true,
          })),
          total,
          limit,
          offset,
        };
      },
    });

    // === Market Data Endpoints (public) ===

    // Get order book
    app.get('/v1/market/book', async (request: FastifyRequest) => {
      const query = request.query as { depth?: string };
      const depth = Math.min(parseInt(query.depth || '10'), 50);

      const state = kernel.getState();
      const bids = getBookLevels(state, 'bid', depth);
      const asks = getBookLevels(state, 'ask', depth);
      const midPrice = getMidPrice(state);
      const spread = getSpread(state);

      return {
        tick_id: kernel.getCurrentTick(),
        instrument: 'ASSET/CASH',
        bids: bids.map((b) => ({
          price: formatAmount(b.price),
          quantity: formatAmount(b.quantity),
        })),
        asks: asks.map((a) => ({
          price: formatAmount(a.price),
          quantity: formatAmount(a.quantity),
        })),
        spread: spread ? formatAmount(spread) : null,
        mid_price: midPrice ? formatAmount(midPrice) : null,
      };
    });

    // Get recent trades
    app.get('/v1/market/trades', async (request: FastifyRequest) => {
      const query = request.query as { limit?: string; from_tick?: string };
      const limit = Math.min(parseInt(query.limit || '100'), 1000);
      const fromTick = query.from_tick ? parseInt(query.from_tick) : undefined;

      const state = kernel.getState();
      let trades = getRecentTrades(state, limit);

      if (fromTick !== undefined) {
        trades = trades.filter((t) => t.tickId >= fromTick);
      }

      return {
        tick_id: kernel.getCurrentTick(),
        trades: trades.map((t) => ({
          trade_id: t.id,
          tick_id: t.tickId,
          price: formatAmount(t.price),
          quantity: formatAmount(t.quantity),
          aggressor_side: 'bid', // Simplified - would need to track this
        })),
      };
    });

    // Get market stats
    app.get('/v1/market/stats', async () => {
      const state = kernel.getState();
      const trades = state.trades;
      const lastTrade = trades[trades.length - 1];

      // Calculate 24h equivalent (using last 1000 ticks as proxy)
      const recentTrades = trades.filter(
        (t) => t.tickId >= state.currentTick - 1000
      );

      let high = 0n;
      let low = parseAmount('999999999.99');
      let volume = 0n;

      for (const t of recentTrades) {
        if (t.price > high) high = t.price;
        if (t.price < low) low = t.price;
        volume += t.quantity;
      }

      return {
        tick_id: kernel.getCurrentTick(),
        instrument: 'ASSET/CASH',
        last_price: lastTrade ? formatAmount(lastTrade.price) : null,
        high_24h: recentTrades.length > 0 ? formatAmount(high) : null,
        low_24h: recentTrades.length > 0 ? formatAmount(low) : null,
        volume_24h: formatAmount(volume),
        trade_count_24h: recentTrades.length,
        open_interest: formatAmount(
          Array.from(state.orders.values())
            .filter((o) => o.status === 'open')
            .reduce((sum, o) => sum + o.quantity - o.filledQuantity, 0n)
        ),
      };
    });

    // Get run status
    app.get('/v1/run/status', async () => {
      const state = kernel.getState();

      return {
        run_id: state.runId,
        status: kernel.isRunning() ? 'running' : 'stopped',
        current_tick: kernel.getCurrentTick(),
        agent_count: state.agents.size,
        active_agent_count: getActiveAgentCount(state),
        bankrupt_count: getBankruptCount(state),
        total_trades: state.trades.length,
        started_at: null, // Would track this in kernel
      };
    });

    // Get leaderboard
    app.get('/v1/leaderboard', async (request: FastifyRequest) => {
      const query = request.query as { metric?: string; limit?: string };
      const metric = query.metric || 'pnl';
      const limit = Math.min(parseInt(query.limit || '20'), 100);

      const state = kernel.getState();
      const midPrice = getMidPrice(state) || parseAmount('100.00');

      // Calculate metrics for each agent
      const agentMetrics = Array.from(state.agents.values()).map((agent) => {
        const equity =
          agent.cashBalance + (agent.assetBalance * midPrice) / parseAmount('1.00');
        const initialEquity =
          state.config.initialCash +
          (state.config.initialAsset * midPrice) / parseAmount('1.00');
        const pnl = equity - initialEquity;
        const pnlPct =
          initialEquity > 0n ? Number((pnl * 10000n) / initialEquity) / 100 : 0;

        return {
          agent_name: agent.name,
          equity,
          pnl,
          pnlPct,
          trade_count: state.trades.filter(
            (t) => t.bidAgentId === agent.id || t.askAgentId === agent.id
          ).length,
        };
      });

      // Sort by metric
      agentMetrics.sort((a, b) => {
        if (metric === 'pnl') return Number(b.pnl - a.pnl);
        if (metric === 'equity') return Number(b.equity - a.equity);
        if (metric === 'trade_count') return b.trade_count - a.trade_count;
        return Number(b.pnl - a.pnl);
      });

      return {
        tick_id: kernel.getCurrentTick(),
        metric,
        rankings: agentMetrics.slice(0, limit).map((m, i) => ({
          rank: i + 1,
          agent_name: m.agent_name,
          value: formatAmount(metric === 'trade_count' ? BigInt(m.trade_count) * parseAmount('1.00') : m.pnl),
          pnl_pct: m.pnlPct.toFixed(2),
        })),
      };
    });

    // WebSocket endpoint
    app.register(async function (fastify) {
      fastify.get('/v1/stream', { websocket: true }, (socket, req) => {
        const query = (req as any).query as { api_key?: string };
        const apiKey = query.api_key;

        let agent = null;
        if (apiKey) {
          const apiKeyHash = hashApiKey(apiKey);
          agent = getAgentByApiKeyHash(kernel.getState(), apiKeyHash);
        }

        // Send initial connection message
        socket.send(
          JSON.stringify({
            type: 'connected',
            tick_id: kernel.getCurrentTick(),
            agent_id: agent?.id || null,
          })
        );

        // Handle subscribe messages
        socket.on('message', (message: unknown) => {
          try {
            const data = JSON.parse(String(message));
            if (data.type === 'subscribe') {
              socket.send(
                JSON.stringify({
                  type: 'subscribed',
                  channels: data.channels,
                })
              );
            }
          } catch (e) {
            // Ignore invalid messages
          }
        });

        socket.on('close', () => {
          // Cleanup
        });
      });
    });
  };

  async function start(): Promise<void> {
    await setupRoutes();
    await app.listen({ port: config.port, host: config.host });
  }

  async function stop(): Promise<void> {
    await app.close();
  }

  function getApp(): FastifyInstance {
    return app;
  }

  return {
    start,
    stop,
    getApp,
  };
}
