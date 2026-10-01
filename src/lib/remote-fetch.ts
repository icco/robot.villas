import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

/** Runs during socket connection, not as a preflight followed by a second DNS lookup. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new Error("Remote destination resolves to a non-public address");
    }
    if (options.all) {
      callback(null, addresses);
    } else {
      const selected = addresses.find((a) => !options.family || a.family === options.family);
      if (!selected) {
        throw new Error("No public address for the requested address family");
      }
      callback(null, selected.address, selected.family);
    }
  }).catch((error: Error) => callback(error, "", 4));
};

const dispatcher = new Agent({ connect: { lookup: publicLookup, timeout: 10_000 }, connections: 4 });

export function assertRemoteUrl(input: string | URL): URL {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Remote URLs must use HTTP(S) without credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if ((isIP(host) && !isPublicAddress(host)) || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Remote destination is not public");
  }
  return url;
}

/** Caller owns a deadline covering both this request and consumption of its body. */
export async function fetchRemote(input: string | URL, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  let url = assertRemoteUrl(input);
  const headers = new Headers(init.headers);
  for (let hop = 0; hop <= 5; hop++) {
    const options: RequestInit & { dispatcher: Agent } = { ...init, headers, dispatcher, redirect: "manual" };
    const response = await fetch(url, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || hop === 5) {
      throw new Error("Invalid or excessive remote redirects");
    }
    const next = assertRemoteUrl(new URL(location, url));
    if (next.origin !== url.origin) {
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("if-none-match");
      headers.delete("if-modified-since");
    }
    url = next;
  }
  throw new Error("Excessive remote redirects");
}

export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Remote response exceeds byte limit");
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error("Remote response exceeds byte limit");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
