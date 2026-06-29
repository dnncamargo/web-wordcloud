import type { Metadata } from "next";
import { notoSans, plexMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nuvem Digital",
  description: "Plataforma colaborativa de nuvens de palavras",
    openGraph: {
    title: "Nuvem Digital",
    description:
      "Nuvem Digital - plataforma colaborativa de ideias.",
    type: "website",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Nuvem Digital - plataforma colaborativa de ideias",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nuvem Digital",
    description:
      "Nuvem Digital - plataforma colaborativa de ideias.",
    images: ["/twitter-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${notoSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
