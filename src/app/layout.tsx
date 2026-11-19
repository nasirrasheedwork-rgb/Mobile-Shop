import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mobile Shop CRM",
  description: "Inventory, checkout and finance for your mobile shop",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#142536" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
