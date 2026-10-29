import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";
import App from "./App.jsx";
import { PublicAnimalPage } from "./DocumentsHub.jsx";
import { ConfirmProvider } from "./ui/ConfirmDialog.jsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

function PublicAnimalRoute() {
  const { slug } = useParams();
  return slug ? <PublicAnimalPage slug={slug} /> : <App />;
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  let refreshing = false;
  let hasController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The first controller takeover should not reload a page the user just opened.
    if (!hasController) {
      hasController = true;
      return;
    }
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
      // The application remains usable online if the service worker cannot register.
    });
  });
}

const root = document.getElementById("root");
if (!root) throw new Error('Missing application root element with id "root".');

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <Routes>
            <Route path="/public/animals/:slug" element={<PublicAnimalRoute />} />
            <Route path="*" element={<App />} />
          </Routes>
        </ConfirmProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
