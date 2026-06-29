import type { Metadata } from "next";
import { Bebas_Neue, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import ThemeProvider from "@/components/providers/ThemeProvider";

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "optional",
});

const dmSans = DM_Sans({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-body",
});

const jetbrainsMono = JetBrains_Mono({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://vynx.network"),
  title: {
    default: "VynX",
    template: "%s — VynX",
  },
  description:
    "The clearing layer for the machine-to-machine economy. 200ms sealed-bid OFA with collateral-backed, fulfillment-or-refund settlement.",
  openGraph: {
    title: "VynX",
    description: "The clearing layer for the machine-to-machine economy.",
    url: "https://vynx.network",
    siteName: "VynX",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "VynX — The Clearing Layer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VynX — The Clearing Layer",
    description: "The clearing layer for the machine-to-machine economy.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bebasNeue.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <ThemeProvider>
          <Navbar />
          {children}
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
