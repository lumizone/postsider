import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Changa_One } from "next/font/google";
import { AppRoot } from "@/components/app-root";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const changaOne = Changa_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-brand",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PostSider",
  description: "Social media scheduling and publishing platform.",
  robots: "noindex, nofollow",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${changaOne.variable}`}>
      <body>
        <I18nProvider>
          <AuthProvider>
            <AppRoot>{children}</AppRoot>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
