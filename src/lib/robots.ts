import { getLogger } from "@logtape/logtape";
import { compileRobotsText, type CrawlerRules } from "@trybyte/robotstxt-parser";
import { fetchRemote, readLimitedText } from "./remote-fetch";

const logger = getLogger(["robot-villas", "robots"]);

export function createRobotsCheck(userAgent: string): (url: URL) => Promise<void> {
  const policies = new Map<string, CrawlerRules | null>();
  return async (url) => {
    if (url.pathname === "/robots.txt") {
      return;
    }
    const robotsUrl = new URL("/robots.txt", url);
    if (!policies.has(url.origin)) {
      let policy: CrawlerRules | null = null;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2_000);
      try {
        const response = await fetchRemote(robotsUrl, {
          signal: controller.signal,
          headers: { Accept: "text/plain", "User-Agent": userAgent },
          cache: "no-store",
        });
        if (response.ok) {
          policy = compileRobotsText(await readLimitedText(response, 500 * 1024), { policy: "rfc9309" }).forCrawler("RSS");
        } else {
          await response.body?.cancel();
          logger.debug("Ignoring robots.txt HTTP {status} for {origin}", { status: response.status, origin: url.origin });
        }
      } catch (error) {
        logger.warn("Could not check robots.txt for {origin}: {error}", { origin: url.origin, error });
      } finally {
        clearTimeout(timeout);
      }
      policies.set(url.origin, policy);
    }
    if (policies.get(url.origin)?.isAllowed(url.href) === false) {
      throw new Error(`Blocked by robots.txt: ${url.href}`);
    }
  };
}
