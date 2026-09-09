import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ServiceWorker } from "@/components/service-worker";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Spendwise",
  title: {
    default: "Spendwise",
    template: "%s · Spendwise",
  },
  description: "Track expenses solo or with your flatmates.",
  // Installed on an iPhone: standalone window, default (light) status bar.
  // The manifest (app/manifest.ts) covers Android and desktop; the icon and
  // apple-icon files beside this layout are picked up automatically.
  appleWebApp: {
    capable: true,
    title: "Spendwise",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Let the page extend under the iPhone home indicator / notch so
  // env(safe-area-inset-*) is non-zero and pinned bars can pad for it.
  viewportFit: "cover",
  // Browser UI colour follows the app header (see AppHeader): white in light
  // mode, zinc-900 in dark. The manifest's theme_color only shows before the
  // page has loaded.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
