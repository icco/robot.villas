import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@fedify/fedify";
import { Accept, type Activity, Follow, Reject } from "@fedify/vocab";
import type { Db } from "../db";
import { registerInboxListeners } from "../federation";
import { receiveFollowResponse } from "../inbox-state";

vi.mock("../inbox-state", async (importOriginal) => ({
  ...await importOriginal<typeof import("../inbox-state")>(),
  receiveFollowResponse: vi.fn(),
}));

const actor = new URL("https://remote.example/users/alice");
const followId = new URL("https://robot.test/users/bot/follows/old");
const db = {} as Db;
const listeners = new Map<unknown, (ctx: Context<void>, activity: Activity) => unknown>();
const setters = {
  setSharedKeyDispatcher: () => setters,
  on: (type: unknown, listener: (ctx: Context<void>, activity: Activity) => unknown) => (listeners.set(type, listener), setters),
  onRequestFinished: () => setters,
  onError: () => setters,
};
registerInboxListeners({ setInboxListeners: () => setters } as never, db, ["bot"], new Set());
const ctx = {
  documentLoader: async () => {
    throw new Error("HTTP 404: obsolete Follow");
  },
} as unknown as Context<void>;

describe("Follow responses", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["Accept", Accept, "accepted"],
    ["Reject", Reject, "rejected"],
  ] as const)("processes %s references without dereferencing an obsolete Follow", async (_name, Response, status) => {
    await listeners.get(Response)!(ctx, new Response({ actor, object: followId }));
    expect(receiveFollowResponse).toHaveBeenCalledExactlyOnceWith(db, followId.href, actor.href, status);
  });

  it.each([["Accept", Accept], ["Reject", Reject]] as const)("ignores %s without an actor or object ID", async (_name, Response) => {
    await listeners.get(Response)!(ctx, new Response({ object: followId }));
    await listeners.get(Response)!(ctx, new Response({ actor }));
    expect(receiveFollowResponse).not.toHaveBeenCalled();
  });

  it("uses the ID of an embedded Follow", async () => {
    await listeners.get(Accept)!(ctx, new Accept({ actor, object: new Follow({ id: followId }) }));
    expect(receiveFollowResponse).toHaveBeenCalledExactlyOnceWith(db, followId.href, actor.href, "accepted");
  });
});
