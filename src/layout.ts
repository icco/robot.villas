import escapeHtml from "escape-html";

export function layout(opts: {
  title: string;
  domain: string;
  content: string;
  path?: string;
  description?: string;
  extraHead?: string;
}): string {
  const desc = opts.description ?? `RSS-to-Mastodon bridge on ${opts.domain}`;
  const url = `https://${opts.domain}${opts.path ?? "/"}`;
  return `<!DOCTYPE html>
<html lang="en" data-theme="dim">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <meta property="og:title" content="${escapeHtml(opts.title)}">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:site_name" content="${escapeHtml(opts.domain)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(opts.title)}">
  <meta name="twitter:description" content="${escapeHtml(desc)}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>">
  <link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />
  <link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style type="text/tailwindcss">
    @theme {
      --font-display: "Roboto Mono", monospace;
      --font-body: "Roboto", sans-serif;
    }
  </style>
  ${opts.extraHead ?? ""}
</head>
<body class="min-h-screen flex flex-col bg-base-100 font-body">
  <header class="navbar bg-base-200 border-b border-base-300">
    <div class="container mx-auto flex items-center">
      <a href="/" class="text-xl font-display font-bold tracking-tight hover:opacity-80 transition-opacity flex items-center gap-2">
        <span class="text-2xl">🤖</span>
        <span>${escapeHtml(opts.domain)}</span>
      </a>
      <a href="/stats" class="btn btn-ghost btn-sm font-display ml-auto">Stats</a>
    </div>
  </header>
  <main class="container mx-auto flex-1 px-4 py-8 max-w-4xl">
    ${opts.content}
  </main>
  <footer class="footer sm:footer-horizontal footer-center bg-base-200 border-t border-base-300 text-base-content p-6 text-sm">
    <nav class="flex flex-wrap justify-center gap-x-1">
      <span>&copy; <a href="https://natwelch.com" class="link link-hover">Nat Welch</a></span>
      <span>·</span>
      <a href="https://github.com/icco/robot.villas" class="link link-hover">Source code</a>
      <span>·</span>
      <a href="https://github.com/icco/robot.villas/edit/main/feeds.yml" class="link link-hover">Add or update a feed</a>
    </nav>
  </footer>
</body>
</html>`;
}
