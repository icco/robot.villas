/** The same URL policy applies to HTML pages and federated HTML. */
export function safeParseUrl(link: string | undefined): URL | undefined {
  if (!link) {
    return undefined;
  }
  try {
    const url = new URL(link);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}
