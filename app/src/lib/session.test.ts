import { afterEach, expect, it, vi } from "vitest";
import { checkSession } from "./session";

afterEach(() => vi.unstubAllGlobals());

it("shows sign-in for a 401", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
  expect(await checkSession()).toEqual({ status: "signed-out" });
});

it("shows an error for a 500, including an empty response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
  expect(await checkSession()).toEqual({ status: "error" });
});

it("shows an error for a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  expect(await checkSession()).toEqual({ status: "error" });
});

it("checks the session again after an outage and signs in on success", async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 500 }))
    .mockResolvedValueOnce(Response.json({ email: "owner@example.com" }));
  vi.stubGlobal("fetch", fetch);
  expect(await checkSession()).toEqual({ status: "error" });
  expect(await checkSession()).toEqual({ status: "signed-in", email: "owner@example.com" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith("/api/me", expect.objectContaining({ credentials: "same-origin" }));
});
