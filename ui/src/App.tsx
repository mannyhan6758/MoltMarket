import { fetchRunStatus, fetchOrderBook, fetchTrades, fetchLeaderboard } from './api.js';
import { usePolling } from './state/usePolling.js';
import { useEventStream } from './state/useEventStream.js';
import { RunStatus } from './components/RunStatus.js';
import { PriceChart } from './components/PriceChart.js';
import { OrderBook } from './components/OrderBook.js';
import { Leaderboard } from './components/Leaderboard.js';
import { EventFeed } from './components/EventFeed.js';

const POLL_MS = 500;

export function App() {
  const status = usePolling(fetchRunStatus, POLL_MS);
  const book = usePolling(fetchOrderBook, POLL_MS);
  const trades = usePolling(() => fetchTrades(200), POLL_MS);
  const leaderboard = usePolling(fetchLeaderboard, POLL_MS);
  const stream = useEventStream(200);

  return (
    <div className="app">
      <RunStatus
        data={status.data}
        error={status.error}
        loading={status.loading}
        wsConnected={stream.connected}
      />
      <div className="dashboard-grid">
        <div className="col-left">
          <PriceChart
            trades={trades.data?.trades ?? []}
            error={trades.error}
          />
          <OrderBook data={book.data} error={book.error} loading={book.loading} />
        </div>
        <div className="col-right">
          <Leaderboard data={leaderboard.data} error={leaderboard.error} loading={leaderboard.loading} />
          <EventFeed events={stream.events} connected={stream.connected} clear={stream.clear} />
        </div>
      </div>
    </div>
  );
}
