import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Roboto, Roboto_Mono } from "next/font/google";
import { Footer } from "@icco/react-common/Footer";
import { WebVitals } from "@icco/react-common/WebVitals";
import { faviconSvg } from "@/lib/og-icon";
import "./globals.css";

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-display",
  display: "swap",
});

function getDomain(): string {
  return process.env.DOMAIN || "localhost";
}

export function generateMetadata(): Metadata {
  const domain = getDomain();
  return {
    metadataBase: new URL(`https://${domain}`),
    title: {
      default: `${domain} – RSS-to-Mastodon Bridge`,
      template: `%s – ${domain}`,
    },
    description: `RSS-to-Mastodon bridge on ${domain}`,
    twitter: {
      card: "summary_large_image",
    },
    icons: {
      icon: faviconSvg,
    },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const domain = getDomain();

  return (
    <html
      lang="en"
      data-theme="dim"
      className={`${roboto.variable} ${robotoMono.variable}`}
    >
      <body className="min-h-screen flex flex-col bg-base-100 font-body">
        <WebVitals analyticsPath="analytics/robot-villas" />
        <header className="navbar bg-base-200 border-b border-base-300">
          <div className="container mx-auto flex items-center">
            <Link
              href="/"
              className="text-xl font-display font-bold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2"
            >
              <span className="text-2xl">🤖</span>
              <span>{domain}</span>
            </Link>
            <Link
              href="/posts"
              className="btn btn-ghost btn-sm font-display ml-auto"
            >
              Posts
            </Link>
            <Link
              href="/tags"
              className="btn btn-ghost btn-sm font-display"
            >
              Tags
            </Link>
            <Link
              href="/stats"
              className="btn btn-ghost btn-sm font-display"
            >
              Stats
            </Link>
            <Link
              href="/status"
              className="btn btn-ghost btn-sm font-display"
            >
              Status
            </Link>
          </div>
        </header>
        <main className="container mx-auto flex-1 px-4 py-8 max-w-4xl">
          {children}
        </main>
        <Footer
          sourceRepo="https://github.com/icco/robot.villas"
          editUrl="https://github.com/icco/robot.villas/edit/main/feeds.yml"
          showRecurseCenter={false}
          showSocial={false}
          showRecurseRing={false}
          showXXIIVVRing={false}
        />
      </body>
    </html>
  );
}
