import { useEffect, useRef, useState } from "react";
import { cache, entryFor, invalidate, patch, request } from "../api/client";
import { ACTIONS, DETAIL, HISTORY, LIST, LOCK } from "../api/operations";
import type {
  Action,
  Detail,
  DetailData,
  HistoryData,
  ListData,
  State,
} from "../api/types";
import { useTenant, useTenantMutation } from "../tenant/TenantContext";

type Transaction = {
  action: Action;
  phase: "pending" | "confirming" | "refresh-error";
  error?: string;
};
export function reconcileListRows(tenantId: string, detail: Detail) {
  cache.forEach((entry) => {
    if (entry.document !== LIST || entry.variables.tenantId !== tenantId)
      return;
    const reconcile = (data: unknown): unknown => {
      const payload = data as ListData | undefined;
      const list = payload?.listDevices;
      if (!list?.deviceList) return data;
      const exists = list.deviceList.some((row) => row?.id === detail.id);
      if (!exists) {
        entry.timestamp = 0;
        return data;
      }
      const matches =
        entry.variables.stateId == null ||
        Number(entry.variables.stateId) === detail.state?.id;
      if (!matches) entry.timestamp = 0;
      return {
        ...payload,
        listDevices: {
          ...list,
          deviceList: list.deviceList.flatMap((row) =>
            row?.id !== detail.id
              ? [row]
              : matches
                ? [
                    {
                      ...row,
                      state: detail.state,
                      policy: detail.policy,
                      lastCheckin: detail.lastCheckin?.date ?? null,
                    },
                  ]
                : [],
          ),
          pageInfo: list.pageInfo
            ? {
                ...list.pageInfo,
                total_count:
                  list.pageInfo.total_count == null
                    ? null
                    : Math.max(
                        0,
                        list.pageInfo.total_count - (matches ? 0 : 1),
                      ),
              }
            : null,
        },
      };
    };
    // Reconcile an already-running search before publishing its response. No new list request.
    if (entry.promise) {
      const previous = entry.reconcileData;
      entry.reconcileData = (data) =>
        reconcile(previous ? previous(data) : data);
    }
    const data = entry.snapshot.data;
    if (data !== undefined) {
      patch(entry, reconcile(data), true);
      // Preserve invalidation where membership/count cannot be reconstructed globally.
      if (
        entry.variables.stateId != null ||
        !(data as ListData).listDevices?.deviceList?.some(
          (row) => row?.id === detail.id,
        )
      )
        entry.timestamp = 0;
    }
  });
}
export function useDeviceLock() {
  const tenantId = useTenant();
  const mutation = useTenantMutation<
    { assignAction: boolean },
    { deviceId: string; actionId: string }
  >(LOCK, { throwError: true });
  const [transactions, setTransactions] = useState<Record<string, Transaction>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const busy = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function update(deviceId: string, transaction?: Transaction) {
    if (mounted.current)
      setTransactions((previous) => {
        const next = { ...previous };
        if (transaction) next[deviceId] = transaction;
        else delete next[deviceId];
        return next;
      });
  }
  async function confirm(deviceId: string, action: Action) {
    update(deviceId, { action, phase: "confirming" });
    invalidate(
      (entry) =>
        entry.variables.tenantId === tenantId &&
        ((entry.variables.deviceId === deviceId &&
          (entry.document === DETAIL || entry.document === HISTORY)) ||
          entry.document === ACTIONS),
    );
    cache.forEach((entry) => {
      if (entry.document === LIST && entry.variables.tenantId === tenantId)
        entry.timestamp = 0;
    });
    const [detailResult, historyResult] = await Promise.allSettled([
      request<DetailData>(entryFor(DETAIL, { tenantId, deviceId }), true),
      request<HistoryData>(
        entryFor(HISTORY, { tenantId, deviceId, page: 1, pageSize: 5 }),
        true,
      ),
    ]);
    const detail =
      detailResult.status === "fulfilled"
        ? detailResult.value.data?.deviceDetail
        : undefined;
    if (detail) reconcileListRows(tenantId, detail);
    if (mounted.current)
      setVersions((previous) => ({
        ...previous,
        [deviceId]: (previous[deviceId] ?? 0) + 1,
      }));
    if (
      !detail ||
      historyResult.status === "rejected" ||
      !historyResult.value.data?.listDeviceHistory ||
      historyResult.value.errors.length
    ) {
      update(deviceId, {
        action,
        phase: "refresh-error",
        error:
          "Lock confirmed, but some device information could not refresh. Retry refresh.",
      });
      return;
    }
    // The detail's authoritative state drives available-actions revalidation in the UI.
    update(deviceId);
  }
  async function lock(deviceId: string, action: Action) {
    if (busy.current.has(deviceId) || transactions[deviceId]) return;
    busy.current.add(deviceId);
    if (mounted.current)
      setErrors((previous) => ({ ...previous, [deviceId]: "" }));
    update(deviceId, { action, phase: "pending" });
    let confirmed = false;
    try {
      const response = await mutation.mutateData({
        deviceId,
        actionId: action.id,
      });
      if (response?.assignAction !== true)
        throw new Error(
          "Server did not confirm the lock. Refresh this device before retrying.",
        );
      confirmed = true;
      await confirm(deviceId, action);
    } catch (error) {
      if (confirmed)
        update(deviceId, {
          action,
          phase: "refresh-error",
          error: "Lock confirmed. Refresh failed; retry refresh.",
        });
      else {
        update(deviceId);
        if (mounted.current)
          setErrors((previous) => ({
            ...previous,
            [deviceId]: error instanceof Error ? error.message : "Lock failed",
          }));
      }
    } finally {
      busy.current.delete(deviceId);
    }
  }
  function project<T extends { id: string; state: State | null }>(
    device: T,
  ): T {
    const transaction = transactions[device.id];
    return transaction
      ? {
          ...device,
          state: { id: transaction.action.stateId ?? 3, name: "LOCKED" },
        }
      : device;
  }
  async function retry(deviceId: string) {
    const transaction = transactions[deviceId];
    if (!transaction || busy.current.has(deviceId)) return;
    busy.current.add(deviceId);
    try {
      await confirm(deviceId, transaction.action);
    } catch {
      update(deviceId, {
        ...transaction,
        phase: "refresh-error",
        error: "Lock confirmed. Refresh failed; retry refresh.",
      });
    } finally {
      busy.current.delete(deviceId);
    }
  }
  return { lock, retry, project, transactions, errors, versions };
}
export type DeviceLock = ReturnType<typeof useDeviceLock>;
