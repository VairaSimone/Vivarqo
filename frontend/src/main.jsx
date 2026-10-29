import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { PublicAnimalPage } from "./DocumentsHub.jsx";
import { ConfirmProvider } from "./ui/ConfirmDialog.jsx";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(registration => {
      const announceUpdateIfWaiting = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        window.dispatchEvent(new CustomEvent("vivarqo:pwa-update-ready", {
          detail: { registration }
        }));
      };

      announceUpdateIfWaiting();
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") announceUpdateIfWaiting();
        });
      });
    }).catch(() => {
      // L'app rimane utilizzabile online anche se il service worker non si registra.
    });
  });
}
const publicProfileMatch = window.location.pathname.match(/^\/public\/animals\/([^/]+)\/?$/);
const screen = publicProfileMatch
  ? <PublicAnimalPage slug={decodeURIComponent(publicProfileMatch[1])} />
  : <App />;
createRoot(document.getElementById("root")).render(
  <React.StrictMode><ConfirmProvider>{screen}</ConfirmProvider></React.StrictMode>
);