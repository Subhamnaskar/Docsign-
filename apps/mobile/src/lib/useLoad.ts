import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ApiError } from './api';

/** Loads data when the screen comes into view, with pull-to-refresh state and a readable error. */
export function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(
    async (pull = false) => {
      if (pull) setRefreshing(true);
      try {
        setData(await load());
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load. Pull down to try again.');
      } finally {
        setRefreshing(false);
      }
    },
    [load],
  );

  useFocusEffect(
    useCallback(() => {
      run();
    }, [run]),
  );

  return { data, error, refreshing, refresh: () => run(true), reload: () => run() };
}
