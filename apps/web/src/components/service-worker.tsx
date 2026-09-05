"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js in production builds. Renders nothing.
 *
 * In development it does the opposite and unregisters any worker on this
 * origin: a worker left behind by a local production build (`next start` on
 * the same port) would keep serving that build's hashed chunks to the dev
 * server and break hot reloading in confusing ways.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((r) => r.unregister())),
        )
        .catch(() => undefined);
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error: unknown) => {
        console.error("Service worker registration failed", error);
      });
  }, []);

  return null;
}
