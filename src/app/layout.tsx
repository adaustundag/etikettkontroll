import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { siteUrl } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "EtikettKontroll – Vad står egentligen på etiketten?",
    template: "%s – EtikettKontroll",
  },
  description:
    "Granskad databas med ingredienser och näringsvärden från matetiketter. Sök på produktnamn eller streckkod – varje ändring kontrolleras av communityn innan den publiceras.",
  keywords: [
    "EtikettKontroll",
    "etikett",
    "ingredienser",
    "näringsvärden",
    "streckkod",
    "livsmedelsdatabas",
    "livsmedel",
    "ingrediensförteckning",
    "open data",
  ],
  applicationName: "EtikettKontroll",
  manifest: "/manifest.webmanifest",
  openGraph: {
    siteName: "EtikettKontroll",
    locale: "sv_SE",
    type: "website",
  },
  twitter: {
    card: "summary",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "EtikettKontroll",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          {children}
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
