import { AsyncLocalStorage } from "node:async_hooks";
const bindings = new AsyncLocalStorage<Record<string, unknown>>();
export function withRequestBindings<T>(values: Record<string, unknown>, callback: () => T): T {
  return bindings.run(values, callback);
}
export function runtimeBinding(key: string): unknown {
  const current = bindings.getStore();
  if (current) return current[key];
  return (globalThis as Record<string, unknown>)[key] ?? process.env[key];
}
