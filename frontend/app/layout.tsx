import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "F1 PitWall | Race Engineering",
  description:
    "Historical Formula 1 analysis, tyre strategy, and reproducible race pace estimates.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
