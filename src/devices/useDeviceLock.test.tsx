import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, graphql } from "msw";
import { expect, it } from "vitest";
import { entryFor, patch } from "../api/client";
import { ACTIONS, DETAIL, HISTORY, LIST } from "../api/operations";
import type {
  Detail,
  DetailData,
  Device,
  HistoryData,
  ListData,
} from "../api/types";
import { TenantProvider, useTenantQuery } from "../tenant/TenantContext";
import { server } from "../test/setup";
import { reconcileListRows, useDeviceLock } from "./useDeviceLock";
const api = graphql.link("http://localhost:3000/graphql");
const action = {
  id: "server-lock-id",
  actionName: "Lock device",
  policyName: "Hard Lock",
  stateId: 3,
};
const row: Device = {
  id: "dev-1",
  serialNumber: "SN-1",
  modelMarketingName: "G22",
  brandName: "Nokia",
  IMEIs: [],
  state: { id: 2, name: "ACTIVE" },
  policy: { id: "pol-1", name: "Baseline" },
  lastCheckin: "2026-01-01T00:00:00Z",
};
const detail: Detail = {
  id: row.id,
  serialNumber: row.serialNumber,
  deviceBrandName: row.brandName,
  deviceModelMarketingName: row.modelMarketingName,
  IMEIs: [],
  state: row.state,
  policy: row.policy,
  imsi: null,
  locale: "en-GB",
  firstEnrollAt: row.lastCheckin,
  lastCheckin: { label: "Last seen", date: row.lastCheckin, color: null },
};
function wrapper({ children }: { children: React.ReactNode }) {
  return <TenantProvider tenant="tenant-alpha">{children}</TenantProvider>;
}
function useConsoleHooks() {
  const list = useTenantQuery<ListData>(LIST, {
    variables: { page: 1, pageSize: 10 },
    fetchFirst: true,
    queryKey: "devices:list",
  });
  const device = useTenantQuery<DetailData>(DETAIL, {
    variables: { deviceId: row.id },
    fetchFirst: true,
    queryKey: `device:${row.id}:detail`,
  });
  const history = useTenantQuery<HistoryData>(HISTORY, {
    variables: { deviceId: row.id, page: 1, pageSize: 5 },
    fetchFirst: true,
    queryKey: `device:${row.id}:history`,
  });
  const lock = useDeviceLock();
  return { list, device, history, lock };
}
it("rolls a rejected optimistic lock back in both list and detail through the real hooks", async () => {
  let rejectMutation!: () => void;
  const gate = new Promise<void>((resolve) => {
    rejectMutation = resolve;
  });
  server.use(
    api.query("ListDevices", () =>
      HttpResponse.json({
        data: {
          listDevices: { deviceList: [row], pageInfo: { total_count: 1 } },
        },
      }),
    ),
    api.query("DeviceDetail", () =>
      HttpResponse.json({ data: { deviceDetail: detail } }),
    ),
    api.query("ListDeviceHistory", () =>
      HttpResponse.json({
        data: {
          listDeviceHistory: { histories: [], pageInfo: { total_count: 0 } },
        },
      }),
    ),
    api.query("ListAvailableActions", () =>
      HttpResponse.json({ data: { listAvailableActions: [action] } }),
    ),
    api.mutation("AssignAction", async ({ variables }) => {
      expect(variables).toEqual({
        tenantId: "tenant-alpha",
        deviceId: row.id,
        actionId: action.id,
      });
      await gate;
      return HttpResponse.json({
        errors: [{ message: "State transition rejected" }],
      });
    }),
  );
  const { result } = renderHook(
    () => {
      const hooks = useConsoleHooks();
      const actions = useTenantQuery<{
        listAvailableActions: (typeof action)[];
      }>(ACTIONS, { variables: { stateId: "2" }, fetchFirst: true });
      return { ...hooks, actions };
    },
    { wrapper },
  );
  await waitFor(() =>
    expect(result.current.actions.data?.listAvailableActions[0]).toEqual(
      action,
    ),
  );
  await waitFor(() =>
    expect(result.current.device.data?.deviceDetail?.state?.name).toBe(
      "ACTIVE",
    ),
  );
  await waitFor(() =>
    expect(
      result.current.list.data?.listDevices?.deviceList?.[0]?.state?.name,
    ).toBe("ACTIVE"),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.lock.lock(
      row.id,
      result.current.actions.data!.listAvailableActions[0],
    );
  });
  expect(
    result.current.lock.project(
      result.current.list.data!.listDevices!.deviceList![0]!,
    ).state?.name,
  ).toBe("LOCKED");
  expect(
    result.current.lock.project(result.current.device.data!.deviceDetail!).state
      ?.name,
  ).toBe("LOCKED");
  expect(result.current.lock.transactions[row.id]?.phase).toBe("pending");
  await act(async () => {
    rejectMutation();
    await pending;
  });
  expect(
    result.current.lock.project(
      result.current.list.data!.listDevices!.deviceList![0]!,
    ).state?.name,
  ).toBe("ACTIVE");
  expect(
    result.current.lock.project(result.current.device.data!.deviceDetail!).state
      ?.name,
  ).toBe("ACTIVE");
  expect(result.current.lock.errors[row.id]).toBe("State transition rejected");
});
it("confirms a lock, patches the cached row and refreshes history without another list request", async () => {
  let locked = false;
  let listCalls = 0;
  let historyCalls = 0;
  server.use(
    api.query("ListDevices", () => {
      listCalls++;
      return HttpResponse.json({
        data: {
          listDevices: { deviceList: [row], pageInfo: { total_count: 1 } },
        },
      });
    }),
    api.query("DeviceDetail", () =>
      HttpResponse.json({
        data: {
          deviceDetail: locked
            ? {
                ...detail,
                state: { id: 3, name: "LOCKED" },
                policy: { id: "pol-3", name: "Hard Lock" },
              }
            : detail,
        },
      }),
    ),
    api.query("ListDeviceHistory", () => {
      historyCalls++;
      return HttpResponse.json({
        data: {
          listDeviceHistory: {
            histories: locked
              ? [{ type: "POLICY_CHANGE", actionName: "Lock device" }]
              : [],
            pageInfo: { total_count: locked ? 1 : 0 },
          },
        },
      });
    }),
    api.mutation("AssignAction", () => {
      locked = true;
      return HttpResponse.json({ data: { assignAction: true } });
    }),
  );
  const { result } = renderHook(useConsoleHooks, { wrapper });
  await waitFor(() =>
    expect(result.current.device.data?.deviceDetail).toBeTruthy(),
  );
  await waitFor(() =>
    expect(result.current.list.data?.listDevices).toBeTruthy(),
  );
  await waitFor(() => expect(result.current.history.loading).toBe(false));
  await act(async () => {
    await result.current.lock.lock(row.id, action);
  });
  expect(
    result.current.list.data?.listDevices?.deviceList?.[0]?.state?.name,
  ).toBe("LOCKED");
  expect(result.current.device.data?.deviceDetail?.policy?.id).toBe("pol-3");
  expect(
    result.current.history.data?.listDeviceHistory?.histories?.[0]?.actionName,
  ).toBe("Lock device");
  expect(result.current.lock.transactions[row.id]).toBeUndefined();
  expect(listCalls).toBe(1);
  expect(historyCalls).toBe(2);
});
it("does not roll back a server-confirmed lock when confirmation refresh fails", async () => {
  server.use(
    api.mutation("AssignAction", () =>
      HttpResponse.json({ data: { assignAction: true } }),
    ),
    api.query("DeviceDetail", () =>
      HttpResponse.json({ errors: [{ message: "Detail unavailable" }] }),
    ),
    api.query("ListDeviceHistory", () =>
      HttpResponse.json({ errors: [{ message: "History unavailable" }] }),
    ),
  );
  const { result } = renderHook(useDeviceLock, { wrapper });
  await act(async () => {
    await result.current.lock(row.id, action);
  });
  expect(result.current.project(row).state?.name).toBe("LOCKED");
  expect(result.current.transactions[row.id]?.phase).toBe("refresh-error");
  expect(result.current.errors[row.id]).toBeFalsy();
});
it("removes a row that leaves a state filter and adjusts its count only once", () => {
  const entry = entryFor(LIST, {
    tenantId: "tenant-alpha",
    stateId: 2,
    page: 1,
    pageSize: 10,
  });
  patch(entry, {
    listDevices: { deviceList: [row], pageInfo: { total_count: 1 } },
  });
  const locked = { ...detail, state: { id: 3, name: "LOCKED" } };
  reconcileListRows("tenant-alpha", locked);
  reconcileListRows("tenant-alpha", locked);
  expect((entry.snapshot.data as ListData).listDevices).toEqual({
    deviceList: [],
    pageInfo: { total_count: 0 },
  });
  expect(entry.timestamp).toBe(0);
});

it("reconciles an already-running list response before publication without restarting it", async () => {
  let finish!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  server.use(
    api.query("ListDevices", async () => {
      calls++;
      started();
      await gate;
      return HttpResponse.json({
        data: {
          listDevices: { deviceList: [row], pageInfo: { total_count: 1 } },
        },
      });
    }),
  );
  const { result } = renderHook(
    () =>
      useTenantQuery<ListData>(LIST, {
        variables: { page: 1 },
        fetchFirst: true,
      }),
    { wrapper },
  );
  await startedPromise;
  act(() =>
    reconcileListRows("tenant-alpha", {
      ...detail,
      state: { id: 3, name: "LOCKED" },
    }),
  );
  finish();
  await waitFor(() =>
    expect(result.current.data?.listDevices?.deviceList?.[0]?.state?.name).toBe(
      "LOCKED",
    ),
  );
  expect(calls).toBe(1);
});
