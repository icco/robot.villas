const INBOX_PATH = /^\/(users\/[^/]+\/)?inbox$/;

/**
 * Announce-style relays boost every post they carry, and we only act on boosts
 * of our own posts, so the rest skip Fedify's queue, which deliveries share.
 */
export async function isForeignAnnounce(request: Request, origin: string): Promise<boolean> {
  if (request.method !== "POST" || !INBOX_PATH.test(new URL(request.url).pathname)) {
    return false;
  }
  let activity: unknown;
  try {
    activity = await request.clone().json();
  } catch {
    return false;
  }
  if (typeof activity !== "object" || activity === null) {
    return false;
  }
  const { type, object } = activity as { type?: unknown; object?: unknown };
  if (type !== "Announce") {
    return false;
  }
  const objectId = typeof object === "object" && object !== null ? (object as { id?: unknown }).id : object;
  if (typeof objectId !== "string" || !URL.canParse(objectId)) {
    return false;
  }
  return new URL(objectId).origin !== origin;
}
