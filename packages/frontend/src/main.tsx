import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("SnakeBee root element was not found");
createRoot(root).render(<StrictMode><App /></StrictMode>);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      console.info("[SnakeBee PWA] Service worker registered.", {
        scope: registration.scope,
        active: registration.active?.state ?? null,
        waiting: registration.waiting?.state ?? null,
        installing: registration.installing?.state ?? null,
      });
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => console.info("[SnakeBee PWA] Service worker state:", installing.state));
      });
    }).catch((error: unknown) => {
      console.error("[SnakeBee PWA] Service worker registration failed.", error);
    });
  }, { once: true });
}
