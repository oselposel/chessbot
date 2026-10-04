import type { Metadata } from "next";
import "./globals.css";
import "./studio.css";
import "./training.css";

export const metadata: Metadata = {
  title: "Chessbot · Trénink zahájení",
  description: "Trénuj zahájení podle skutečných partií vybraného hráče na Lichessu.",
  icons: {
    icon: "/chessbot.svg",
    shortcut: "/chessbot.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body className="antialiased">{children}</body>
    </html>
  );
}
