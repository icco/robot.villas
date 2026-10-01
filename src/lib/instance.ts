/** Accepts `mastodon.social`, `https://mastodon.social/`, or `@me@mastodon.social`. */
export function normalizeInstance(input: string): string | null {
  let value = input.trim();
  if (!value) {
    return null;
  }
  const handle = value.match(/^@?[^@\s/]+@([^@\s/]+)$/);
  if (handle) {
    value = handle[1];
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (
    // interactionUrl() always uses https, so accept only https input.
    url.protocol !== "https:" ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !url.hostname.includes(".")
  ) {
    return null;
  }
  return url.host.toLowerCase();
}

export function interactionUrl(instance: string, uri: string): string {
  const url = new URL("/authorize_interaction", `https://${instance}`);
  url.searchParams.set("uri", uri);
  return url.href;
}

/** Suggestions come from a third-party API; accept only a list of hostnames. */
export function parseSuggestions(json: unknown): string[] {
  if (!Array.isArray(json)) {
    return [];
  }
  return json
    .filter((s): s is string => typeof s === "string" && normalizeInstance(s) === s.toLowerCase())
    .slice(0, 10);
}
