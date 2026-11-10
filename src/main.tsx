import { createRoot } from "react-dom/client";
import { TenantShell } from "./tenant/TenantContext";
import { Console } from "./devices/Console";
import "./style.css";
async function start() {
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
  createRoot(document.getElementById("root")!).render(
    <TenantShell>
      <Console />
    </TenantShell>,
  );
}
void start().catch((error) => {
  const root = document.getElementById("root");
  if (root)
    root.textContent = `The local mock could not start: ${error instanceof Error ? error.message : "Unknown error"}. Reload to retry.`;
});
