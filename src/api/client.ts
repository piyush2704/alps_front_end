import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export type Variables = Record<string, unknown>;
export type Envelope<T> = { data?: T; errors: string[] };
export type Snapshot<T> = Envelope<T> & { loading: boolean };
export const TTL = 30_000;
export const endpoint = "http://localhost:3000/graphql";
export function canonical(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item,
    ) ?? "{}"
  );
}
export async function transport<T>(
  query: string,
  variables: unknown,
  signal?: AbortSignal,
): Promise<Envelope<T>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  const body = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    (!("data" in body) && !Array.isArray(body.errors))
  )
    throw new Error("Invalid GraphQL response");
  return {
    data: body.data ?? undefined,
    errors: (body.errors ?? []).map(
      (error: { message?: string }) => error.message ?? "GraphQL error",
    ),
  };
}
export type Entry = {
  document: string;
  variables: Variables;
  keys: Set<string>;
  snapshot: Snapshot<unknown>;
  timestamp: number;
  generation: number;
  controller?: AbortController;
  promise?: Promise<Envelope<unknown>>;
  listeners: Set<() => void>;
  consumers: number;
  reconcileData?: (data: unknown) => unknown;
};
export const cache = new Map<string, Entry>();
export function entryFor(document: string, variables: Variables): Entry {
  const id = document + canonical(variables);
  let entry = cache.get(id);
  if (!entry) {
    entry = {
      document,
      variables,
      keys: new Set(),
      snapshot: { loading: false, errors: [], data: undefined },
      timestamp: 0,
      generation: 0,
      listeners: new Set(),
      consumers: 0,
    };
    cache.set(id, entry);
  }
  return entry;
}
function publish(entry: Entry, snapshot: Snapshot<unknown>) {
  entry.snapshot = snapshot;
  entry.listeners.forEach((listener) => listener());
}
export function cancel(entry: Entry, clear = false) {
  entry.generation++;
  entry.controller?.abort();
  entry.controller = undefined;
  entry.promise = undefined;
  entry.reconcileData = undefined;
  entry.timestamp = 0;
  publish(
    entry,
    clear
      ? { data: undefined, errors: [], loading: false }
      : { ...entry.snapshot, loading: false },
  );
}
export function invalidate(predicate: (entry: Entry) => boolean) {
  cache.forEach((entry) => {
    if (predicate(entry)) cancel(entry);
  });
}
export function patch(entry: Entry, data: unknown, preserveRequest = false) {
  if (!preserveRequest) cancel(entry);
  entry.timestamp = Date.now();
  publish(entry, {
    data,
    errors: [],
    loading: preserveRequest && !!entry.promise,
  });
}
export async function request<T>(
  entry: Entry,
  force = false,
): Promise<Envelope<T>> {
  if (entry.promise) return entry.promise as Promise<Envelope<T>>;
  if (!force && entry.timestamp && Date.now() - entry.timestamp < TTL)
    return entry.snapshot as Envelope<T>;
  const generation = ++entry.generation;
  const controller = new AbortController();
  entry.controller = controller;
  publish(entry, { ...entry.snapshot, errors: [], loading: true });
  const pending = transport<T>(
    entry.document,
    entry.variables,
    controller.signal,
  )
    .then((result) => {
      if (generation === entry.generation) {
        entry.timestamp = result.data !== undefined ? Date.now() : 0;
        if (result.data !== undefined && entry.reconcileData) {
          result = { ...result, data: entry.reconcileData(result.data) as T };
        }
        publish(entry, { ...result, loading: false });
      }
      return result;
    })
    .catch((error: unknown) => {
      if (generation === entry.generation) {
        publish(entry, {
          ...entry.snapshot,
          errors: controller.signal.aborted
            ? []
            : [error instanceof Error ? error.message : "Request failed"],
          loading: false,
        });
      }
      throw error;
    })
    .finally(() => {
      if (generation === entry.generation) {
        entry.promise = undefined;
        entry.controller = undefined;
        entry.reconcileData = undefined;
      }
    });
  entry.promise = pending as Promise<Envelope<unknown>>;
  return pending;
}
export type UseQueryResult<TData, TVars> = {
  loading: boolean;
  errors: string[];
  data: TData | undefined;
  refetch: (variables?: TVars, replace?: boolean) => Promise<void>;
  reset: (queryKey?: string) => void;
};
export function useQuery<TData, TVars>(
  query: string,
  options: { variables?: TVars; fetchFirst?: boolean; queryKey?: string },
): UseQueryResult<TData, TVars> {
  const base = canonical(options.variables);
  const scope = query + base;
  const [override, setOverride] = useState<{
    scope: string;
    variables: Variables;
  }>();
  const value =
    override?.scope === scope ? canonical(override.variables) : base;
  const variables = useMemo(() => JSON.parse(value) as Variables, [value]);
  const entry = useMemo(() => entryFor(query, variables), [query, variables]);
  const key = options.queryKey;
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      entry.consumers++;
      if (key) entry.keys.add(key);
      return () => {
        entry.listeners.delete(listener);
        entry.consumers--;
        if (!entry.consumers && entry.promise) cancel(entry);
      };
    },
    [entry, key],
  );
  const state = useSyncExternalStore(subscribe, () => entry.snapshot);
  useEffect(() => {
    if (options.fetchFirst) void request(entry).catch(() => {});
  }, [entry, options.fetchFirst]);
  const refetch = useCallback(
    async (next?: TVars, replace = false) => {
      const effective = (
        replace ? (next ?? {}) : { ...JSON.parse(base), ...next }
      ) as Variables;
      const target = entryFor(query, effective);
      if (key) target.keys.add(key);
      setOverride({ scope, variables: effective });
      await request(target, true).catch(() => {});
    },
    [query, base, scope, key],
  );
  const reset = useCallback(
    (queryKey?: string) => {
      const target = queryKey ?? key;
      if (target)
        cache.forEach((item) => {
          if (item.keys.has(target)) cancel(item, true);
        });
      else cancel(entry, true);
    },
    [key, entry],
  );
  return { ...state, data: state.data as TData | undefined, refetch, reset };
}
export type UseMutationResult<TData, TVars> = {
  loading: boolean;
  errors: string[];
  mutateData: (
    variables?: TVars,
    replace?: boolean,
  ) => Promise<TData | undefined>;
};
export function useMutation<TData, TVars>(
  query: string,
  options: { variables?: TVars; throwError?: boolean },
): UseMutationResult<TData, TVars> {
  const [state, setState] = useState({
    loading: false,
    errors: [] as string[],
  });
  const generation = useRef(0);
  const mounted = useRef(true);
  const configuration = useRef(options);
  configuration.current = options;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const mutateData = useCallback(
    async (variables?: TVars, replace = false) => {
      const token = ++generation.current;
      const config = configuration.current;
      setState({ loading: true, errors: [] });
      try {
        const result = await transport<TData>(
          query,
          replace ? (variables ?? {}) : { ...config.variables, ...variables },
        );
        if (result.errors.length) throw new Error(result.errors.join("; "));
        return result.data;
      } catch (error) {
        if (mounted.current && generation.current === token)
          setState({
            loading: true,
            errors: [
              error instanceof Error ? error.message : "Mutation failed",
            ],
          });
        if (config.throwError) throw error;
        return undefined;
      } finally {
        if (mounted.current && generation.current === token)
          setState((previous) => ({ ...previous, loading: false }));
      }
    },
    [query],
  );
  return { ...state, mutateData };
}
