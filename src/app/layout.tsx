import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Roboto, Roboto_Mono } from "next/font/google";
import { CpuChipIcon } from "@heroicons/react/24/solid";
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
        <header className="navbar bg-base-200 border-b border-base-300">
          <div className="container mx-auto flex items-center">
            <Link
              href="/"
              className="text-xl font-display font-bold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2"
            >
              <CpuChipIcon className="w-6 h-6" />
              <span>{domain}</span>
            </Link>
            <Link
              href="/stats"
              className="btn btn-ghost btn-sm font-display ml-auto"
            >
              Stats
            </Link>
          </div>
        </header>
        <main className="container mx-auto flex-1 px-4 py-8 max-w-4xl">
          {children}
        </main>
        <footer className="footer sm:footer-horizontal footer-center bg-base-200 border-t border-base-300 text-base-content p-6 text-sm">
          <nav className="flex flex-wrap justify-center gap-x-1">
            <span>
              &copy;{" "}
              <a href="https://natwelch.com" className="link link-hover">
                Nat Welch
              </a>
            </span>
            <span>&middot;</span>
            <a
              href="https://github.com/icco/robot.villas"
              className="link link-hover"
            >
              Source code
            </a>
            <span>&middot;</span>
            <a
              href="https://github.com/icco/robot.villas/edit/main/feeds.yml"
              className="link link-hover"
            >
              Add or update a feed
            </a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
