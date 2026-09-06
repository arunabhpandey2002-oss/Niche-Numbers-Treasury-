import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Niche Numbers Treasury",
  description: "Standalone treasury scenario planning, cash flow, runway and Google Sheets write-back.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
