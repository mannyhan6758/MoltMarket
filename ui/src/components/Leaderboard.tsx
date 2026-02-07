import type { Leaderboard as LeaderboardData } from '../types.js';

interface Props {
  data: LeaderboardData | null;
  error: string | null;
  loading: boolean;
}

export function Leaderboard({ data, error, loading }: Props) {
  if (loading && !data) {
    return (
      <section className="panel">
        <h2>Leaderboard</h2>
        <p className="muted">Loading...</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="panel">
        <h2>Leaderboard</h2>
        <div className="error-panel">{error}</div>
      </section>
    );
  }

  if (!data || data.rankings.length === 0) {
    return (
      <section className="panel">
        <h2>Leaderboard</h2>
        <p className="muted">No agents yet</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Leaderboard <span className="muted">({data.metric})</span></h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Agent</th>
            <th>PnL</th>
            <th>PnL %</th>
          </tr>
        </thead>
        <tbody>
          {data.rankings.map((r) => {
            const pnl = parseFloat(r.value);
            const pnlClass = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';
            return (
              <tr key={r.rank}>
                <td>{r.rank}</td>
                <td className="mono">{r.agent_name}</td>
                <td className={`mono ${pnlClass}`}>{pnl.toFixed(2)}</td>
                <td className={`mono ${pnlClass}`}>{r.pnl_pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <div className="error-banner">Polling error: {error}</div>}
    </section>
  );
}
