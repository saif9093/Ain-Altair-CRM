import type { Metadata } from "next";
import { Archivo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/client";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Ain AlTair Lead Intelligence", template: "%s · Ain AlTair Lead Intelligence" },
  description: "AI-assisted business prospecting, lead research and CRM for Ain AlTair.",
  icons: { icon: "/brand/ainaltair-logo.png" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-ink text-paper"><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
