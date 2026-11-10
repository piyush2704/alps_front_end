import { useEffect, useState } from "react";
import { ACTIONS, DETAIL, HISTORY, LIST } from "../api/operations";
import type {
  ActionsData,
  DetailData,
  HistoryData,
  ListData,
  State,
} from "../api/types";
import { useTenantQuery } from "../tenant/TenantContext";
import { useDeviceLock, type DeviceLock } from "./useDeviceLock";
export function date(value?: string | null) {
  return value ? new Date(value).toLocaleString("en-GB") : "Unavailable";
}
function Status({
  loading,
  errors,
  hasData,
  retry,
}: {
  loading: boolean;
  errors: string[];
  hasData: boolean;
  retry: () => unknown;
}) {
  return (
    <>
      {loading && <p role="status">{hasData ? "Refreshing…" : "Loading…"}</p>}
      {errors.length > 0 && (
        <div role="alert" className="notice">
          <strong>
            {hasData
              ? "Some information is unavailable"
              : "Could not load information"}
          </strong>
          <ul>
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
          <button onClick={() => void retry()}>Retry</button>
        </div>
      )}
    </>
  );
}
export function Pagination({
  page,
  pageSize,
  total,
  disabled,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number | null | undefined;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  const count = total == null ? undefined : Math.ceil(total / pageSize);
  return (
    <nav aria-label="Pagination" className="pagination">
      <span>
        {total == null
          ? "Count unavailable"
          : `${total} results · Page ${count ? page : 0} of ${count}`}
      </span>
      <div>
        <button
          disabled={disabled || page <= 1 || total === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          disabled={disabled || total == null || page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
function Badge({ state, pending }: { state: State | null; pending?: string }) {
  return (
    <span className={`badge state-${state?.id ?? 0}`}>
      {state?.name ?? "Unavailable"}
      {pending
        ? ` · ${pending === "pending" ? "Pending" : pending === "confirming" ? "Confirming" : "Refresh needed"}`
        : ""}
    </span>
  );
}
export function Console() {
  const [search, setSearch] = useState("");
  const [field, setField] = useState("serialNumber");
  const [filter, setFilter] = useState("");
  const [parameters, setParameters] = useState({
    search: "",
    field: "serialNumber",
    state: "",
    page: 1,
  });
  const [selected, setSelected] = useState<string>();
  const locks = useDeviceLock();
  useEffect(() => {
    if (search === parameters.search && field === parameters.field) return;
    const timer = setTimeout(
      () =>
        setParameters((previous) => ({ ...previous, search, field, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, field, parameters.search, parameters.field]);
  const list = useTenantQuery<ListData>(LIST, {
    variables: {
      [parameters.field]: parameters.search || undefined,
      stateId: parameters.state ? Number(parameters.state) : undefined,
      page: parameters.page,
      pageSize: 10,
    },
    fetchFirst: true,
    queryKey: "devices:list",
  });
  const rows =
    list.data?.listDevices?.deviceList?.filter((row) => row != null) ?? [];
  const searchPending =
    search !== parameters.search || field !== parameters.field;
  return (
    <main>
      <section className="page-title">
        <div>
          <span className="eyebrow">DEVICE LIFECYCLE</span>
          <h2>Device inventory</h2>
          <p>Find a device, inspect its activity and manage protection.</p>
        </div>
        <span className="local">● Local mock environment</span>
      </section>
      <div className="workspace">
        <section className="panel inventory">
          <div className="filters">
            <label>
              Search by
              <select value={field} onChange={(e) => setField(e.target.value)}>
                <option value="serialNumber">Serial number</option>
                <option value="imei">IMEI</option>
              </select>
            </label>
            <label className="search">
              Search devices
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  field === "imei" ? "Enter an IMEI…" : "Search serial number…"
                }
              />
            </label>
            <label>
              State
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setParameters((previous) => ({
                    ...previous,
                    state: e.target.value,
                    page: 1,
                  }));
                }}
              >
                <option value="">All states</option>
                {["ENROLLED", "ACTIVE", "LOCKED", "RELEASED"].map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {searchPending && <p role="status">Waiting for search…</p>}
          <Status
            {...list}
            hasData={!!list.data}
            retry={() => list.refetch()}
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Serial / IMEI</th>
                  <th>Model</th>
                  <th>State</th>
                  <th>Last check-in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const shown = locks.project(row);
                  return (
                    <tr
                      key={row.id}
                      className={selected === row.id ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="device-link"
                          onClick={() => setSelected(row.id)}
                          aria-pressed={selected === row.id}
                        >
                          {row.serialNumber ?? row.id}
                        </button>
                        <small>
                          {row.IMEIs?.find((imei) => imei?.isPrimary)?.imei ??
                            "Unavailable"}
                        </small>
                      </td>
                      <td>{row.modelMarketingName ?? "Unavailable"}</td>
                      <td>
                        <Badge
                          state={shown.state}
                          pending={locks.transactions[row.id]?.phase}
                        />
                      </td>
                      <td>{date(row.lastCheckin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!list.loading && !list.errors.length && rows.length === 0 && (
            <p className="empty">No devices match your filters.</p>
          )}
          <Pagination
            page={parameters.page}
            pageSize={10}
            total={list.data?.listDevices?.pageInfo?.total_count}
            disabled={list.loading || searchPending}
            onPage={(page) =>
              setParameters((previous) => ({ ...previous, page }))
            }
          />
        </section>
        <aside>
          {selected ? (
            <DevicePanel key={selected} deviceId={selected} locks={locks} />
          ) : (
            <section className="panel empty">
              <h3>Device details</h3>
              <p>Select a device to view its protection status and activity.</p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
function DevicePanel({
  deviceId,
  locks,
}: {
  deviceId: string;
  locks: DeviceLock;
}) {
  const detail = useTenantQuery<DetailData>(DETAIL, {
    variables: { deviceId },
    fetchFirst: true,
    queryKey: `device:${deviceId}:detail`,
  });
  const device = detail.data?.deviceDetail;
  return (
    <>
      <section className="panel detail">
        <span className="eyebrow">DEVICE DETAILS</span>
        <Status {...detail} hasData={!!device} retry={() => detail.refetch()} />
        {device ? (
          <>
            <h3>{device.serialNumber ?? device.id}</h3>
            <p>
              {device.deviceBrandName} {device.deviceModelMarketingName}
            </p>
            <Badge
              state={locks.project(device).state}
              pending={locks.transactions[deviceId]?.phase}
            />
            <dl>
              <dt>Policy</dt>
              <dd>
                {locks.transactions[deviceId]?.action.policyName ??
                  device.policy?.name ??
                  "Unavailable"}
              </dd>
              <dt>IMSI</dt>
              <dd>{device.imsi ?? "Unavailable"}</dd>
              <dt>Primary IMEI</dt>
              <dd>
                {device.IMEIs?.find((item) => item?.isPrimary)?.imei ??
                  "Unavailable"}
              </dd>
              <dt>Locale</dt>
              <dd>{device.locale ?? "Unavailable"}</dd>
              <dt>Enrolled</dt>
              <dd>{date(device.firstEnrollAt)}</dd>
              <dt>Last check-in</dt>
              <dd>{date(device.lastCheckin?.date)}</dd>
            </dl>
            <LockAction
              deviceId={deviceId}
              stateId={device.state?.id}
              locks={locks}
            />
          </>
        ) : (
          !detail.loading &&
          !detail.errors.length && <p>No device details available.</p>
        )}
      </section>
      <History
        key={`${deviceId}:${locks.versions[deviceId] ?? 0}`}
        deviceId={deviceId}
      />
    </>
  );
}
function LockAction({
  deviceId,
  stateId,
  locks,
}: {
  deviceId: string;
  stateId?: number;
  locks: DeviceLock;
}) {
  const actions = useTenantQuery<ActionsData>(ACTIONS, {
    variables: { stateId: String(stateId ?? "") },
    fetchFirst: stateId != null,
    queryKey: `device:${deviceId}:actions`,
  });
  const action = actions.data?.listAvailableActions?.find(
    (item) => item?.actionName === "Lock device",
  );
  const transaction = locks.transactions[deviceId];
  return (
    <div className="action">
      <Status
        {...actions}
        hasData={!!actions.data}
        retry={() => actions.refetch()}
      />
      <button
        className="primary"
        disabled={
          !action || actions.loading || !!actions.errors.length || !!transaction
        }
        onClick={() => action && void locks.lock(deviceId, action)}
      >
        {transaction?.phase === "pending"
          ? "Lock pending…"
          : transaction?.phase === "confirming"
            ? "Confirming lock…"
            : "Lock device"}
      </button>
      {!actions.loading && !actions.errors.length && !action && (
        <p className="muted">Lock is unavailable in the current state.</p>
      )}
      {locks.errors[deviceId] && <p role="alert">{locks.errors[deviceId]}</p>}
      {transaction?.error && (
        <div role="alert">
          <p>{transaction.error}</p>
          <button onClick={() => void locks.retry(deviceId)}>
            Retry refresh
          </button>
        </div>
      )}
    </div>
  );
}
function History({ deviceId }: { deviceId: string }) {
  const [page, setPage] = useState(1);
  const history = useTenantQuery<HistoryData>(HISTORY, {
    variables: { deviceId, page, pageSize: 5 },
    fetchFirst: true,
    queryKey: `device:${deviceId}:history`,
  });
  const rows =
    history.data?.listDeviceHistory?.histories?.filter((row) => row != null) ??
    [];
  return (
    <section className="panel history">
      <span className="eyebrow">AUDIT TRAIL</span>
      <h3>Device history</h3>
      <Status
        {...history}
        hasData={!!history.data}
        retry={() => history.refetch()}
      />
      <ol>
        {rows.map((row, i) => (
          <li key={`${row.createdAt}-${i}`}>
            <strong>{row.actionName ?? row.type ?? "Event"}</strong>
            <span>{row.type}</span>
            <p>
              {row.policyName ?? "Unavailable"} →{" "}
              {row.nextPolicyName ?? "Unavailable"}
            </p>
            <small>
              {date(row.createdAt)} · {row.email ?? "Unavailable"}
            </small>
          </li>
        ))}
      </ol>
      {!history.loading && !history.errors.length && !rows.length && (
        <p>No history available.</p>
      )}
      <Pagination
        page={page}
        pageSize={5}
        total={history.data?.listDeviceHistory?.pageInfo?.total_count}
        disabled={history.loading}
        onPage={setPage}
      />
    </section>
  );
}
