import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;
const worker = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
});

async function openApp(request: Request, url: URL) {
  const response = await fetch(request, { cache: "no-cache" }).catch(() => undefined);
  if (response?.ok) return response;

  // The installed shell and its dependencies are precached together.
  const shell = url.searchParams.get("demo") === "1" ? "/?demo=1" : "/";
  return (await worker.matchPrecache(shell)) ?? response ?? Response.error();
}

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === "/") {
    event.respondWith(openApp(event.request, url));
  }
});
worker.addEventListeners();
