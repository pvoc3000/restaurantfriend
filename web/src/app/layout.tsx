import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "restaurantfriend",
  description: "Restaurant operations — purchasing",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-neutral-900">
        {children}
      </body>
    </html>
  );
}
