export const LIST =
  "query ListDevices(\n  $tenantId: String\n  $imei: String\n  $serialNumber: String\n  $stateId: Int\n  $page: Int\n  $pageSize: Int\n) {\n  listDevices(\n    tenantId: $tenantId\n    imei: $imei\n    serialNumber: $serialNumber\n    stateId: $stateId\n    page: $page\n    pageSize: $pageSize\n  ) {\n    pageInfo {\n      total_count\n    }\n    deviceList {\n      id\n      serialNumber\n      modelMarketingName\n      brandName\n      IMEIs {\n        imei\n        isPrimary\n      }\n      state {\n        id\n        name\n      }\n      policy {\n        id\n        name\n        color\n      }\n      lastCheckin\n    }\n  }\n}";
export const DETAIL =
  "query DeviceDetail($tenantId: String!, $deviceId: String!) {\n  deviceDetail(tenantId: $tenantId, deviceId: $deviceId) {\n    id\n    serialNumber\n    deviceBrandName\n    deviceModelMarketingName\n    imsi\n    locale\n    firstEnrollAt\n    IMEIs {\n      imei\n      isPrimary\n    }\n    state {\n      id\n      name\n    }\n    policy {\n      id\n      name\n      color\n    }\n    lastCheckin {\n      label\n      date\n      color\n    }\n  }\n}";
export const HISTORY =
  "query ListDeviceHistory($tenantId: String!, $deviceId: String!, $page: Int, $pageSize: Int) {\n  listDeviceHistory(tenantId: $tenantId, deviceId: $deviceId, page: $page, pageSize: $pageSize) {\n    pageInfo {\n      total_count\n    }\n    histories {\n      type\n      createdAt\n      email\n      policyName\n      nextPolicyName\n      actionName\n    }\n  }\n}";
export const ACTIONS =
  "query ListAvailableActions($tenantId: String, $stateId: String) {\n  listAvailableActions(tenantId: $tenantId, stateId: $stateId) {\n    id\n    actionName\n    policyName\n    stateId\n  }\n}";
export const LOCK =
  "mutation AssignAction($tenantId: String!, $deviceId: String!, $actionId: String!) {\n  assignAction(tenantId: $tenantId, deviceId: $deviceId, actionId: $actionId)\n}";
