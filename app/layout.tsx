import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nautex AI ERP",
  description: "AI-native ERP platform for maritime procurement and ship supply operations.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/nautex-icon-256.png", type: "image/png", sizes: "256x256" },
    ],
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link href="/fonts/fonts.css" rel="stylesheet" />
      </head>
      <body className="bg-surface-base text-on-surface antialiased">{children}</body>
    </html>
  );
}
