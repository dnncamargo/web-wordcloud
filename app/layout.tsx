import type { Metadata } from "next";
import { notoSans, plexMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nuvem Digital",
  description: "Plataforma colaborativa de nuvens de palavras",
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
