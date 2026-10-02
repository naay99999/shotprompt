'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { checkResponse } from './ui-error';
import { useEvents } from './use-events';
import type { WhisperOptions } from './whisper-options';

export type SystemInfo = WhisperOptions & {
  ffmpeg: boolean; ffprobe: boolean; whisper: boolean; libass: boolean; libx264: boolean; acceleration: string;
  installGuide: { platform: string; architecture: string; manager: string; commands: string[]; note: string; manualUrl: string };
};
export function useSystem() {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = checkResponse(await api.system.doctor.get());
      if (!response.data) throw new Error('Empty system response');
      setSystem(response.data as SystemInfo);
    } catch (error) { setError(error); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEvents(event => {
    if (event.type === '$reconnect' || (event.type === 'model:download' && event.done)) void refresh();
  });
  return { system, loading, error, refresh };
}
