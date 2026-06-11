"use client";

import { useCallback, useEffect, useState } from "react";
import { listChannels, type BackendIntegration } from "./integrations";
import type { Channel } from "./calendar-data";

export interface UseChannelsState {
  channels: Channel[];
  raw: BackendIntegration[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setChannels: (next: Channel[]) => void;
}

export function useChannels(): UseChannelsState {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [raw, setRaw] = useState<BackendIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listChannels();
      setChannels(res.channels);
      setRaw(res.raw);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { channels, raw, loading, error, refresh, setChannels };
}
