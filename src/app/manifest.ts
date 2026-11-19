import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mobile Shop CRM",
    short_name: "Mobile Shop",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6f9",
    theme_color: "#142536",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
