import type { RunStatus as RunStatusData } from '../types.js';

interface Props {
  data: RunStatusData | null;
  error: string | null;
  loading: boolean;
  wsConnected: boolean;
}

export function RunStatus({ data, error, loading, wsConnected }: Props) {
  if (loading && !data) {
    return <header className="panel run-status">Loading run status...</header>;
  }

  if (error && !data) {
    return (
      <header className="panel run-status error-panel">
        Run Status Error: {error}
      </header>
    );
  }

  if (!data) return null;

  const statusClass = data.status === 'running' ? 'status-running' : 'status-stopped';

  return (
    <header className="panel run-status">
      <div className="run-status-grid">
        <div className="run-status-item">
          <span className="label">Run</span>
          <span className="value mono">{data.run_id.slice(0, 12)}...</span>
        </div>
        <div className="run-status-item">
          <span className="label">Status</span>
          <span className={`value ${statusClass}`}>{data.status.toUpperCase()}</span>
        </div>
        <div className="run-status-item">
          <span className="label">Tick</span>
          <span className="value mono">{data.current_tick}</span>
        </div>
        <div className="run-status-item">
          <span className="label">Agents</span>
          <span className="value">{data.active_agent_count}/{data.agent_count}</span>
        </div>
        <div className="run-status-item">
          <span className="label">Bankrupt</span>
          <span className="value">{data.bankrupt_count}</span>
        </div>
        <div className="run-status-item">
          <span className="label">Trades</span>
          <span className="value">{data.total_trades}</span>
        </div>
        <div className="run-status-item">
          <span className="label">WS</span>
          <span className={`value ${wsConnected ? 'status-running' : 'status-stopped'}`}>
            {wsConnected ? 'LIVE' : 'OFF'}
          </span>
        </div>
      </div>
      {error && <div className="error-banner">Polling error: {error}</div>}
    </header>
  );
}
