// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App session check", () => {
  let container: HTMLDivElement;
  let root: Root;
  const me = vi.fn<() => Promise<Response>>();

  const render = () => act(() => root.render(createElement(App)));
  const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === name);
  const outage = () => new Response(null, { status: 500 });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", async (path: string) => {
      if (path === "/api/me") return me();
      if (path === "/api/batches") return Response.json([]);
      if (path === "/api/spend") return Response.json({ month: "2026-11", totalUsd: 0, capUsd: 100 });
      throw new Error(`Unexpected request: ${path}`);
    });
    me.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("shows Retry, not the sign-in form, when the session check fails", async () => {
    me.mockResolvedValueOnce(outage());
    await render();
    expect(button("Retry")).toBeDefined();
    expect(container.querySelector("#password")).toBeNull();
  });

  it("keeps the Retry screen during a recheck, then opens the app", async () => {
    let respond!: (response: Response) => void;
    me.mockResolvedValueOnce(outage()).mockReturnValueOnce(new Promise((resolve) => { respond = resolve; }));
    await render();
    await act(async () => button("Retry")!.click());
    expect(button("Retry")!.disabled).toBe(true);
    expect(button("Retry")!.getAttribute("aria-busy")).toBe("true");
    await act(async () => respond(Response.json({ email: "owner@example.com" })));
    expect(button("Retry")).toBeUndefined();
    expect(button("Sign out")).toBeDefined();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("shows the sign-in form for a 401", async () => {
    me.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await render();
    expect(container.querySelector("#password")).not.toBeNull();
    expect(button("Retry")).toBeUndefined();
  });
});
