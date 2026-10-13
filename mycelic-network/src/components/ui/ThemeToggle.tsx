"use client";
import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";
const KEY = "mycelic.theme";
const EVENT = "mycelic-theme-change";
type Theme = "light" | "dark";
const snapshot = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";
const subscribe = (callback: () => void) => {
  const changed = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    const theme =
      event.newValue === "light" || event.newValue === "dark"
        ? event.newValue
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.dataset.theme = theme;
    callback();
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", changed);
  };
};
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "dark" as const,
  );
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* Theme still works when browser storage is blocked. */
        }
        window.dispatchEvent(new Event(EVENT));
      }}
    >
      <Icon name={next === "light" ? "sun" : "moon"} />
      <span>{next === "light" ? "Light" : "Dark"}</span>
    </button>
  );
}
