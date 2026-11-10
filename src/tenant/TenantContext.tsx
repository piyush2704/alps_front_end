import { createContext, useContext, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "../api/client";
const TenantContext = createContext<string | undefined>(undefined);
export function useTenant() {
  const tenant = useContext(TenantContext);
  if (!tenant) throw new Error("TenantProvider is required");
  return tenant;
}
export function TenantProvider({
  tenant,
  children,
}: {
  tenant: string;
  children: ReactNode;
}) {
  return (
    <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>
  );
}
export function TenantShell({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState("tenant-alpha");
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">TRUSTONIC / OPERATOR CONSOLE</span>
          <h1>
            ALPS <span>Device Console</span>
          </h1>
        </div>
        <label>
          Workspace
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            <option value="tenant-alpha">Tenant Alpha</option>
            <option value="tenant-beta">Tenant Beta</option>
          </select>
        </label>
      </header>
      <TenantProvider key={tenant} tenant={tenant}>
        {children}
      </TenantProvider>
    </>
  );
}
export function useTenantQuery<TData, TVars = Record<string, unknown>>(
  query: string,
  options: { variables?: TVars; fetchFirst?: boolean; queryKey?: string },
) {
  const tenantId = useTenant();
  const result = useQuery<TData, TVars & { tenantId: string }>(query, {
    ...options,
    queryKey: options.queryKey ? `${tenantId}:${options.queryKey}` : undefined,
    variables: { ...options.variables, tenantId } as TVars & {
      tenantId: string;
    },
  });
  return {
    ...result,
    refetch: (variables?: TVars, replace = false) =>
      result.refetch(
        { ...variables, tenantId } as TVars & { tenantId: string },
        replace,
      ),
    reset: (queryKey?: string) =>
      result.reset(queryKey ? `${tenantId}:${queryKey}` : undefined),
  };
}
export function useTenantMutation<TData, TVars = Record<string, unknown>>(
  query: string,
  options: { variables?: TVars; throwError?: boolean },
) {
  const tenantId = useTenant();
  const result = useMutation<TData, TVars & { tenantId: string }>(query, {
    ...options,
    variables: { ...options.variables, tenantId } as TVars & {
      tenantId: string;
    },
  });
  return {
    ...result,
    mutateData: (variables?: TVars, replace = false) =>
      result.mutateData(
        { ...variables, tenantId } as TVars & { tenantId: string },
        replace,
      ),
  };
}
