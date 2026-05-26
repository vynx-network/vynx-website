import type { Metadata } from "next";
import { Bebas_Neue, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

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
    "The native settlement layer for AI agents on Base. 200ms sealed-bid OFA with institutional cryptoeconomic guarantees.",
  openGraph: {
    title: "VynX",
    description: "Deterministic Settlement for the M2M Economy.",
    url: "https://vynx.network",
    siteName: "VynX",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "VynX — M2M Settlement",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VynX — M2M Settlement",
    description: "The settlement layer for AI agents on Base.",
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
    >
      <body className="flex flex-col min-h-screen" suppressHydrationWarning>
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
