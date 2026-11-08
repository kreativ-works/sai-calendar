"use client";

import { useEffect } from "react";
import { collectStaticAssetUrls } from "@/lib/client/static-assets";

const registrations = new WeakMap<Document, Promise<ServiceWorkerRegistration>>();
const warmedDocuments = new WeakSet<Document>();

type DataSavingNavigator = Navigator & { connection?: { saveData?: boolean } };

function loadedAssetUrls(): string[] {
  const candidates = performance.getEntriesByType("resource").map(entry => entry.name);
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach(script => candidates.push(script.src));
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href],link[rel="modulepreload"][href],link[rel="preload"][as="script"][href],link[rel="preload"][as="style"][href]').forEach(link => candidates.push(link.href));
  return collectStaticAssetUrls(window.location.origin, candidates);
}

export function StaticAssets() {
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let idleId: number | undefined;
    let timerId: number | undefined;
    let workerTimerId: number | undefined;
    let detachWorker: (() => void) | undefined;

    const warm = (worker: ServiceWorker) => {
      if (disposed || warmedDocuments.has(document) || (navigator as DataSavingNavigator).connection?.saveData) return;
      warmedDocuments.add(document);
      const urls = loadedAssetUrls();
      if (urls.length) {
        try { worker.postMessage({ type: "sai:cache-static", urls }); } catch { /* A replaced worker can be warmed on the next document load. */ }
      }
    };

    const waitForActiveWorker = (registration: ServiceWorkerRegistration) => {
      if (disposed || warmedDocuments.has(document)) return;
      if (registration.active?.state === "activated") {
        warm(registration.active);
        return;
      }
      const worker = registration.installing ?? registration.waiting ?? registration.active;
      if (!worker) return;
      const stop = () => {
        worker.removeEventListener("statechange", check);
        if (workerTimerId !== undefined) window.clearTimeout(workerTimerId);
        workerTimerId = undefined;
        detachWorker = undefined;
      };
      const check = () => {
        const active = registration.active?.state === "activated" ? registration.active : worker.state === "activated" ? worker : null;
        if (active) { stop(); warm(active); }
        else if (worker.state === "redundant") stop();
      };
      worker.addEventListener("statechange", check);
      detachWorker = stop;
      // Do not leave a listener waiting indefinitely for a stalled installation.
      workerTimerId = window.setTimeout(stop, 30_000);
      check();
    };

    const register = () => {
      idleId = undefined;
      timerId = undefined;
      if (disposed) return;
      let registration = registrations.get(document);
      if (!registration) {
        registration = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        registrations.set(document, registration);
        const attempt = registration;
        void registration.catch(() => {
          if (registrations.get(document) === attempt) registrations.delete(document);
        });
      }
      void registration.then(waitForActiveWorker).catch(() => { /* A later mount may retry a failed registration. */ });
    };

    const schedule = () => {
      if (disposed) return;
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(register, { timeout: 2_000 });
      else timerId = window.setTimeout(register, 1_000);
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", schedule);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
      detachWorker?.();
    };
  }, []);

  return null;
}

export default StaticAssets;
