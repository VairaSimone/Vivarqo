import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { PublicAnimalPage } from "./DocumentsHub.jsx";
import { ConfirmProvider } from "./ui/ConfirmDialog.jsx";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
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