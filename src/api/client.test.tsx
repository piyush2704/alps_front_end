import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  canonical,
  endpoint,
  entryFor,
  request,
  TTL,
  useMutation,
  useQuery,
} from "./client";
import { TenantProvider, useTenantQuery } from "../tenant/TenantContext";
import { server } from "../test/setup";
const QUERY = "query Read($id: String) { value }";
const reply = (data: unknown) => HttpResponse.json({ data });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("query contract", () => {
  it("canonicalizes variables by value while preserving array order", () => {
    expect(canonical({ b: { z: 1, a: 2 }, a: [2, 1] })).toBe(
      canonical({ a: [2, 1], b: { a: 2, z: 1 } }),
    );
    expect(canonical({ a: [1, 2] })).not.toBe(canonical({ a: [2, 1] }));
  });
  it("deduplicates consumers, retains partial data and expires at TTL", async () => {
    let calls = 0;
    server.use(
      http.post(endpoint, () => {
        calls++;
        return HttpResponse.json({
          data: { value: "usable" },
          errors: [{ message: "Field unavailable" }],
        });
      }),
    );
    const { result, rerender } = renderHook(() => [
      useQuery<{ value: string }, { id: string }>(QUERY, {
        variables: { id: "same" },
        fetchFirst: true,
      }),
      useQuery(QUERY, { variables: { id: "same" }, fetchFirst: true }),
    ]);
    await waitFor(() =>
      expect(result.current[0].data).toEqual({ value: "usable" }),
    );
    expect(result.current[1].data).toEqual({ value: "usable" });
    expect(result.current[0].errors).toEqual(["Field unavailable"]);
    rerender();
    expect(calls).toBe(1);
    const entry = entryFor(QUERY, { id: "same" });
    await request(entry);
    expect(calls).toBe(1);
    entry.timestamp = Date.now() - TTL;
    await act(async () => {
      await request(entry);
    });
    expect(calls).toBe(2);
  });
  it("never lets an old response win even if transport ignores abort", async () => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) =>
        JSON.parse(String(init?.body)).variables.id === "old"
          ? old.promise
          : fresh.promise,
      );
    const { result, rerender } = renderHook(
      ({ id }) =>
        useQuery<{ value: string }, { id: string }>(QUERY, {
          variables: { id },
          fetchFirst: true,
        }),
      { initialProps: { id: "old" } },
    );
    rerender({ id: "new" });
    expect(result.current.data).toBeUndefined();
    await act(async () => {
      fresh.resolve(new Response(JSON.stringify({ data: { value: "new" } })));
    });
    await waitFor(() => expect(result.current.data?.value).toBe("new"));
    await act(async () => {
      old.resolve(new Response(JSON.stringify({ data: { value: "old" } })));
    });
    expect(result.current.data?.value).toBe("new");
    expect(entryFor(QUERY, { id: "old" }).snapshot.data).toBeUndefined();
    fetchMock.mockRestore();
  });
  it("merges refetch variables with configured variables and supports replace", async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(endpoint, async ({ request }) => {
        const body = (await request.json()) as { variables: unknown };
        seen.push(body.variables);
        return reply({ value: "ok" });
      }),
    );
    const { result } = renderHook(() =>
      useQuery(QUERY, {
        variables: { id: "base", page: 1 },
        fetchFirst: false,
      }),
    );
    await act(async () => {
      await result.current.refetch({ id: "next", page: 2 });
    });
    await act(async () => {
      await result.current.refetch({ page: 3 } as { id: string; page: number });
    });
    await act(async () => {
      await result.current.refetch(
        { page: 4 } as { id: string; page: number },
        true,
      );
    });
    expect(seen).toEqual([
      { id: "next", page: 2 },
      { id: "base", page: 3 },
      { page: 4 },
    ]);
  });
  it("reset cancels shared work and clears every consumer without an automatic restart", async () => {
    const response = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      signal = init?.signal;
      return response.promise;
    });
    const { result } = renderHook(() => [
      useQuery(QUERY, { variables: {}, fetchFirst: true, queryKey: "shared" }),
      useQuery(QUERY, { variables: {}, fetchFirst: true, queryKey: "another" }),
    ]);
    act(() => result.current[0].reset("shared"));
    expect(signal?.aborted).toBe(true);
    expect(result.current.every((item) => !item.loading && !item.data)).toBe(
      true,
    );
    await act(async () => {
      response.resolve(
        new Response(JSON.stringify({ data: { value: "late" } })),
      );
    });
    expect(result.current.every((item) => !item.data)).toBe(true);
  });
  it("injects context tenant even when replacement variables try to override it", async () => {
    const tenants: string[] = [];
    server.use(
      http.post(endpoint, async ({ request }) => {
        const body = (await request.json()) as {
          variables: { tenantId: string };
        };
        tenants.push(body.variables.tenantId);
        return reply({ value: body.variables.tenantId });
      }),
    );
    const { result, rerender } = renderHook(
      ({ tenant }) => {
        return useTenantQuery<{ value: string }>(QUERY, {
          variables: { tenantId: "forged" },
          fetchFirst: true,
        });
      },
      {
        initialProps: { tenant: "tenant-alpha" },
        wrapper: ({ children }) => (
          <TenantProvider tenant="tenant-alpha">{children}</TenantProvider>
        ),
      },
    );
    await waitFor(() =>
      expect(result.current.data?.value).toBe("tenant-alpha"),
    );
    await act(async () => {
      await result.current.refetch({ tenantId: "forged" }, true);
    });
    rerender({ tenant: "tenant-alpha" });
    expect(tenants.every((tenant) => tenant === "tenant-alpha")).toBe(true);
  });
});

it("mutation supports swallowed and thrown GraphQL errors", async () => {
  server.use(
    http.post(endpoint, () =>
      HttpResponse.json({ errors: [{ message: "Rejected" }] }),
    ),
  );
  const { result } = renderHook(() => ({
    normal: useMutation(QUERY, {}),
    throwing: useMutation(QUERY, { throwError: true }),
  }));
  await act(async () => {
    expect(await result.current.normal.mutateData()).toBeUndefined();
  });
  expect(result.current.normal.errors).toEqual(["Rejected"]);
  await act(async () => {
    await expect(result.current.throwing.mutateData()).rejects.toThrow(
      "Rejected",
    );
  });
  expect(result.current.throwing.loading).toBe(false);
});
