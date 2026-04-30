import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Roboto, Roboto_Mono } from "next/font/google";
import { Footer } from "@icco/react-common/Footer";
import { SiteHeader } from "@icco/react-common/SiteHeader";
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
        <WebVitals analyticsPath="/analytics/robot-villas" />
        <SiteHeader
          showThemeToggle={false}
          brand={
            <Link
              href="/"
              className="text-xl font-display font-bold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2"
            >
              <span className="text-2xl">🤖</span>
              <span>{domain}</span>
            </Link>
          }
          links={[
            { name: "Posts", href: "/posts" },
            { name: "Tags", href: "/tags" },
            { name: "Stats", href: "/stats" },
            { name: "Status", href: "/status" },
          ]}
        />
        <main className="container mx-auto flex-1 px-4 py-8 max-w-4xl">
          {children}
        </main>
        <div className="container mx-auto w-full max-w-4xl px-4">
          <Footer
            startYear={2025}
            sourceRepo="https://github.com/icco/robot.villas"
            editUrl="https://github.com/icco/robot.villas/edit/main/feeds.yml"
            showRecurseCenter={false}
            showSocial={false}
            showRecurseRing={false}
            showXXIIVVRing={false}
            showPrivacyPolicy={true}
          />
        </div>
      </body>
    </html>
  );
}
