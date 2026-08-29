import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Panel Cuantitativo // Intradía",
  description:
    "Análisis técnico en vivo de BTC/USD, ETH/USD y XRP/USD — EMA 55/200 4h, soportes/resistencias por pivotes y estructura de mercado. Datos de Binance.",
  keywords: [
    "BTC",
    "ETH",
    "XRP",
    "EMA",
    "análisis técnico",
    "crypto",
    "cuantitativo",
    "Binance",
  ],
  authors: [{ name: "Panel Cuantitativo" }],
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#11151c",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#e6edf3",
            },
          }}
        />
      </body>
    </html>
  );
}
