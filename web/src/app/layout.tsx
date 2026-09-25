import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "restaurantfriend",
  description: "Restaurant operations — purchasing",
  // Opened from the home screen, iPadOS runs the app full screen (see
  // app/manifest.ts). "black", not "black-translucent": the status bar keeps
  // its own strip, so no page needs safe-area padding under it. The icon is
  // a plain file in `public/` — also the path iPadOS tries on its own. (As
  // `app/apple-icon.png`, Next's file convention, it 500'd every page in dev.)
  icons: { apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Restaurant Friend", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-ink">
        {children}
      </body>
    </html>
  );
}
