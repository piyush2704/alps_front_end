import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, graphql } from "msw";
import { expect, it } from "vitest";
import { server } from "../test/setup";
import { TenantShell } from "../tenant/TenantContext";
import { Console } from "./Console";
const api = graphql.link("http://localhost:3000/graphql");
function listRow(serial: string) {
  return {
    id: serial,
    serialNumber: serial,
    modelMarketingName: "G22",
    IMEIs: [{ imei: "350000000000001", isPrimary: true }],
    state: { id: 2, name: "ACTIVE" },
    lastCheckin: "2026-01-01T00:00:00Z",
  };
}
function show() {
  return render(
    <TenantShell>
      <Console />
    </TenantShell>,
  );
}
it("removes tenant rows and selected detail immediately when switching workspace", async () => {
  server.use(
    api.query("ListDevices", ({ variables }) =>
      HttpResponse.json({
        data: {
          listDevices: {
            deviceList: [listRow(String(variables.tenantId))],
            pageInfo: { total_count: 1 },
          },
        },
      }),
    ),
    api.query("DeviceDetail", ({ variables }) =>
      HttpResponse.json({
        data: {
          deviceDetail: {
            ...listRow(String(variables.deviceId)),
            deviceModelMarketingName: "Alpha-only detail",
          },
        },
      }),
    ),
    api.query("ListDeviceHistory", () =>
      HttpResponse.json({
        data: {
          listDeviceHistory: { histories: [], pageInfo: { total_count: 0 } },
        },
      }),
    ),
    api.query("ListAvailableActions", () =>
      HttpResponse.json({ data: { listAvailableActions: [] } }),
    ),
  );
  show();
  fireEvent.click(await screen.findByRole("button", { name: "tenant-alpha" }));
  await screen.findByText("Alpha-only detail");
  fireEvent.change(screen.getByLabelText("Workspace"), {
    target: { value: "tenant-beta" },
  });
  expect(screen.queryByRole("button", { name: "tenant-alpha" })).toBeNull();
  expect(screen.queryByText("Alpha-only detail")).toBeNull();
  await screen.findByRole("button", { name: "tenant-beta" });
});
it("renders partial detail and its warnings while a failed history stays independent", async () => {
  server.use(
    api.query("ListDevices", () =>
      HttpResponse.json({
        data: {
          listDevices: {
            deviceList: [listRow("SN-0000-POISON")],
            pageInfo: { total_count: 1 },
          },
        },
      }),
    ),
    api.query("DeviceDetail", () =>
      HttpResponse.json({
        data: {
          deviceDetail: {
            ...listRow("SN-0000-POISON"),
            deviceModelMarketingName: "Poison detail model",
            imsi: null,
            policy: null,
          },
        },
        errors: [
          { message: "Subscriber record unavailable" },
          { message: "Policy service timed out" },
        ],
      }),
    ),
    api.query("ListDeviceHistory", () =>
      HttpResponse.json({ errors: [{ message: "History unavailable" }] }),
    ),
    api.query("ListAvailableActions", () =>
      HttpResponse.json({ data: { listAvailableActions: [] } }),
    ),
  );
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "SN-0000-POISON" }),
  );
  await screen.findByText("Poison detail model");
  await screen.findByText("Subscriber record unavailable");
  await screen.findByText("Policy service timed out");
  await screen.findByText("History unavailable");
  expect(screen.getByText("Poison detail model")).toBeTruthy();
});
it("uses server counts for pagination and resets a debounced search to page one", async () => {
  const seen: Record<string, unknown>[] = [];
  server.use(
    api.query("ListDevices", ({ variables }) => {
      seen.push(variables);
      return HttpResponse.json({
        data: {
          listDevices: {
            deviceList: [listRow(`Page-${variables.page}`)],
            pageInfo: { total_count: 11 },
          },
        },
      });
    }),
  );
  show();
  await screen.findByRole("button", { name: "Page-1" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("button", { name: "Page-2" });
  expect(
    (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Search devices"), {
    target: { value: "SN-0000" },
  });
  expect(seen.at(-1)?.page).toBe(2);
  await waitFor(() => expect(seen.at(-1)?.serialNumber).toBe("SN-0000"));
  expect(seen.at(-1)?.page).toBe(1);
  expect(seen.at(-1)?.imei).toBeUndefined();
  await screen.findByRole("button", { name: "Page-1" });
  const table = screen.getByRole("table");
  expect(within(table).getByRole("button", { name: "Page-1" })).toBeTruthy();
});
