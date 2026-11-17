import { getLogger, reset } from "@logtape/logtape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupLogging } from "../logging";

describe("setupLogging", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await reset();
  });

  it("writes outbox records to the console once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await setupLogging();

    getLogger(["fedify", "federation", "outbox"]).error("Failed to send activity");

    expect(error).toHaveBeenCalledTimes(1);
  });

  it("drops per-request http info records but keeps warnings", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setupLogging();
    info.mockClear();
    warn.mockClear();

    const http = getLogger(["fedify", "federation", "http"]);
    http.info('"GET" "/users/alice/outbox": 200');
    http.warn('"GET" "/users/bob/outbox": 404');

    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
