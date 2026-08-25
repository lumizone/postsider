import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Changa_One } from "next/font/google";
import { AppRoot } from "@/components/app-root";
import { AuthProvider } from "@/lib/auth-context";
import { I18nProvider } from "@/lib/i18n";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/lib/theme";
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
    // suppressHydrationWarning: the inline script below stamps data-theme on
    // <html> before React hydrates, so the served markup and the live DOM
    // differ by that one attribute on purpose.
    <html
      lang="en"
      className={`${inter.variable} ${changaOne.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <AppRoot>{children}</AppRoot>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
