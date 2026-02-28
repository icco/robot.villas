import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Roboto, Roboto_Mono } from "next/font/google";
import { CpuChipIcon } from "@heroicons/react/24/solid";
import { getGlobals } from "@/lib/globals";
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

export function generateMetadata(): Metadata {
  const { domain } = getGlobals();
  return {
    title: {
      default: `${domain} – RSS-to-Mastodon Bridge`,
      template: `%s – ${domain}`,
    },
    description: `RSS-to-Mastodon bridge on ${domain}`,
    icons: {
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'><path d='M16.5 7.5h-9v9h9v-9Z' /><path fill-rule='evenodd' d='M8.25 2.25A.75.75 0 0 1 9 3v.75h2.25V3a.75.75 0 0 1 1.5 0v.75H15V3a.75.75 0 0 1 1.5 0v.75h.75a3 3 0 0 1 3 3v.75H21A.75.75 0 0 1 21 9h-.75v2.25H21a.75.75 0 0 1 0 1.5h-.75V15H21a.75.75 0 0 1 0 1.5h-.75v.75a3 3 0 0 1-3 3h-.75V21a.75.75 0 0 1-1.5 0v-.75h-2.25V21a.75.75 0 0 1-1.5 0v-.75H9V21a.75.75 0 0 1-1.5 0v-.75h-.75a3 3 0 0 1-3-3v-.75H3A.75.75 0 0 1 3 15h.75v-2.25H3a.75.75 0 0 1 0-1.5h.75V9H3a.75.75 0 0 1 0-1.5h.75v-.75a3 3 0 0 1 3-3h.75V3a.75.75 0 0 1 .75-.75ZM6 6.75A.75.75 0 0 1 6.75 6h10.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H6.75a.75.75 0 0 1-.75-.75V6.75Z' clip-rule='evenodd' /></svg>",
    },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const { domain } = getGlobals();

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
