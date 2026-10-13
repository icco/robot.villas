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
});
