import type { OrderBook as OrderBookData } from '../types.js';

interface Props {
  data: OrderBookData | null;
  error: string | null;
  loading: boolean;
}

export function OrderBook({ data, error, loading }: Props) {
  if (loading && !data) {
    return (
      <section className="panel">
        <h2>Order Book</h2>
        <p className="muted">Loading...</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="panel">
        <h2>Order Book</h2>
        <div className="error-panel">{error}</div>
      </section>
    );
  }

  if (!data) return null;

  const hasBids = data.bids.length > 0;
  const hasAsks = data.asks.length > 0;

  // Find max quantity for bar sizing
  const allQty = [...data.bids, ...data.asks].map((l) => parseFloat(l.quantity));
  const maxQty = Math.max(...allQty, 1);

  return (
    <section className="panel">
      <h2>
        Order Book{' '}
        <span className="muted">
          {data.mid_price ? `Mid: ${parseFloat(data.mid_price).toFixed(2)}` : ''}
          {data.spread ? ` | Spread: ${parseFloat(data.spread).toFixed(2)}` : ''}
        </span>
      </h2>
      <div className="book-container">
        <table className="book-table">
          <thead>
            <tr>
              <th>Bid Qty</th>
              <th>Price</th>
              <th>Ask Qty</th>
            </tr>
          </thead>
          <tbody>
            {/* Asks (reversed so highest is at top) */}
            {hasAsks &&
              [...data.asks].reverse().map((level, i) => {
                const pct = (parseFloat(level.quantity) / maxQty) * 100;
                return (
                  <tr key={`a-${i}`} className="ask-row">
                    <td></td>
                    <td className="price ask-price">{parseFloat(level.price).toFixed(2)}</td>
                    <td className="qty-cell">
                      <div className="qty-bar ask-bar" style={{ width: `${pct}%` }} />
                      <span className="qty-text">{parseFloat(level.quantity).toFixed(4)}</span>
                    </td>
                  </tr>
                );
              })}
            {/* Spread row */}
            {(hasBids || hasAsks) && (
              <tr className="spread-row">
                <td colSpan={3} className="spread-cell">
                  {data.spread ? `Spread: ${parseFloat(data.spread).toFixed(4)}` : 'No spread'}
                </td>
              </tr>
            )}
            {/* Bids */}
            {hasBids &&
              data.bids.map((level, i) => {
                const pct = (parseFloat(level.quantity) / maxQty) * 100;
                return (
                  <tr key={`b-${i}`} className="bid-row">
                    <td className="qty-cell">
                      <div className="qty-bar bid-bar" style={{ width: `${pct}%` }} />
                      <span className="qty-text">{parseFloat(level.quantity).toFixed(4)}</span>
                    </td>
                    <td className="price bid-price">{parseFloat(level.price).toFixed(2)}</td>
                    <td></td>
                  </tr>
                );
              })}
            {!hasBids && !hasAsks && (
              <tr>
                <td colSpan={3} className="muted">Empty book</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && <div className="error-banner">Polling error: {error}</div>}
    </section>
  );
}
