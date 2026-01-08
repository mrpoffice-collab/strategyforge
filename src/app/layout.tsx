import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  verification: {
    google: '9P7qz0NOhYQvUysVKCiN010tkpOCU48JFmpStGPhGYw',
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://strategyforge.vercel.app'),
  title: "StrategyForge - Autonomous Swing Trading Simulator",
  description: "Compare and analyze swing trading strategies with real-time simulations. Track performance, win rates, and P&L across multiple whitepaper-based strategies.",
  openGraph: {
    title: "StrategyForge - Autonomous Swing Trading Simulator",
    description: "Compare and analyze swing trading strategies with real-time simulations.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
