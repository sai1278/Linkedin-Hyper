import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { WebSocketProvider } from "@/components/providers/WebSocketProvider";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "LinkedIn Hyper-V",
  description: "Self-hosted LinkedIn automation dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body
        className="antialiased"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <noscript>
          <div
            style={{
              background: 'var(--bg-panel)',
              borderBottom: '1px solid var(--border)',
              padding: '12px 16px',
              fontSize: '14px',
            }}
          >
            JavaScript is disabled. Interactive dashboard screens will stay in read-only fallback mode.
          </div>
        </noscript>
        <AuthProvider>
          <WebSocketProvider>
            {children}
          </WebSocketProvider>
        </AuthProvider>
        <Toaster 
          position="top-right"
          toastOptions={{
            style: {
              background: 'var(--bg-panel)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            },
          }}
        />
      </body>
    </html>
  );
}
