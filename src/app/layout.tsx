import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import Script from "next/script";
import { getGlobals } from "@/lib/globals";

export function generateMetadata(): Metadata {
  const { domain } = getGlobals();
  return {
    title: {
      default: `${domain} – RSS-to-Mastodon Bridge`,
      template: `%s – ${domain}`,
    },
    description: `RSS-to-Mastodon bridge on ${domain}`,
    icons: {
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>",
    },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const { domain } = getGlobals();

  return (
    <html lang="en" data-theme="dim">
      <head>
        <link
          href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css"
          rel="stylesheet"
          type="text/css"
        />
        <link
          href="https://cdn.jsdelivr.net/npm/daisyui@5"
          rel="stylesheet"
          type="text/css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <style
          type="text/tailwindcss"
          dangerouslySetInnerHTML={{
            __html: `
    @theme {
      --font-display: "Roboto Mono", monospace;
      --font-body: "Roboto", sans-serif;
    }`,
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-base-100 font-body">
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
        <Script
          src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
