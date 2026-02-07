import { useEffect, useRef, useState } from 'react';

/**
 * Poll a fetch function at a fixed interval.
 * Returns { data, error, loading }.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs = 500,
): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const result = await fetcherRef.current();
        if (active) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    // Initial fetch
    poll();

    const id = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return { data, error, loading };
}
