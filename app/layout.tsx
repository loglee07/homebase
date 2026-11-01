import type { Metadata } from "next";
import { Geist, Pixelify_Sans } from "next/font/google";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Pixelify_Sans({ variable: "--font-display", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
  title: "Finance Town",
  description: "A cozy pixel-art town for your real-life finances. Sample data only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
