import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  additionalPrecacheEntries: [{ url: "/", revision: String(Date.now()) }, { url: "/?demo=1", revision: String(Date.now()) }, { url: "/manifest.webmanifest", revision: String(Date.now()) }],
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist({
  poweredByHeader: false,
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
});
