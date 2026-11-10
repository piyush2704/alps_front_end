export type State = { id: number; name: string | null };
export type Policy = { id: string; name: string | null; color?: string | null };
export type IMEI = { imei: string | null; isPrimary: boolean | null };
export type Device = {
  id: string;
  serialNumber: string | null;
  modelMarketingName: string | null;
  brandName: string | null;
  IMEIs: (IMEI | null)[] | null;
  state: State | null;
  policy: Policy | null;
  lastCheckin: string | null;
};
export type Detail = {
  id: string;
  serialNumber: string | null;
  deviceBrandName: string | null;
  deviceModelMarketingName: string | null;
  IMEIs: (IMEI | null)[] | null;
  imsi: string | null;
  locale: string | null;
  firstEnrollAt: string | null;
  state: State | null;
  policy: Policy | null;
  lastCheckin: {
    label: string | null;
    date: string | null;
    color: string | null;
  } | null;
};
export type HistoryRow = {
  type: string | null;
  createdAt: string | null;
  email: string | null;
  policyName: string | null;
  nextPolicyName: string | null;
  actionName: string | null;
};
export type Action = {
  id: string;
  actionName: string | null;
  policyName: string | null;
  stateId: number | null;
};
export type ListData = {
  listDevices: {
    pageInfo: { total_count: number | null } | null;
    deviceList: (Device | null)[] | null;
  } | null;
};
export type DetailData = { deviceDetail: Detail | null };
export type HistoryData = {
  listDeviceHistory: {
    pageInfo: { total_count: number | null } | null;
    histories: (HistoryRow | null)[] | null;
  } | null;
};
export type ActionsData = { listAvailableActions: (Action | null)[] | null };
