// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Batch, Final } from "@/lib/api";
import { Board } from "./Board";

// The decorative draft checkbox is not part of final polling.
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: () => null }));

const batchPath = "/api/batches/batch-1";
const refreshPath = "/api/renders/final-1/refresh";

function batch(final: Partial<Final> = {}): Batch {
  return {
    id: "batch-1",
    label: "Test batch",
    status: "board",
    brand: { slug: "test", name: "Test brand", kitVersion: 1 },
    picks: [],
    ideas: [{
      id: "idea-1",
      n: 1,
      format: "tof",
      insight: "Test insight",
      headline: "Test headline",
      picked: false,
      drafts: [{ key: "draft-1", url: "/draft.jpg", rank: null, reason: null, picked: false }],
      finals: [{ id: "final-1", status: "queued", error: null, images: [], composed: null, composeError: null, ...final }],
    }],
  };
}

describe("Board final polling", () => {
  let container: HTMLDivElement;
  let root: Root;
  const getBatch = vi.fn<() => Promise<Response>>();
  const onSpend = vi.fn();
  const refresh = vi.fn<() => Promise<Response>>();

  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  const render = () => act(() => root.render(createElement(Board, { id: "batch-1", onSpend })));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      if (path === batchPath && init.method === "GET") return getBatch();
      if (path === refreshPath && init.method === "POST") return refresh();
      throw new Error(`Unexpected request: ${init.method} ${path}`);
    });
    getBatch.mockReset().mockResolvedValueOnce(Response.json(batch()));
    onSpend.mockClear();
    refresh.mockReset().mockImplementation(async () => Response.json({}));
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries after a failed batch refresh and stops when the final is ready", async () => {
    getBatch
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json(batch({ status: "done", composed: { key: "final", url: "/final.jpg" } })));
    await render();
    expect(container.textContent).toContain("Rendering…");

    await advance(8000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getBatch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Rendering…");

    await advance(8000);
    expect(getBatch).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onSpend).toHaveBeenCalledTimes(2);
    expect(container.querySelector('img[alt="Final"]')?.getAttribute("src")).toBe("/final.jpg");

    await advance(24000);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(getBatch).toHaveBeenCalledTimes(3);
  });

  it("shows a finished final with no logo and does not check it or draw on it", async () => {
    getBatch.mockReset().mockResolvedValue(Response.json(batch({ status: "done", images: [{ key: "raw", url: "/raw.jpg" }] })));
    await render();
    await advance(24000);
    expect(refresh).not.toHaveBeenCalled();
    expect(getBatch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img[alt="Final"]')?.getAttribute("src")).toBe("/raw.jpg");
    expect(container.textContent).toContain("Render without the logo");
  });

  it("does not overlap polls or restart a poll after leaving the board", async () => {
    let respond!: (response: Response) => void;
    getBatch.mockReturnValueOnce(new Promise((resolve) => { respond = resolve; }));
    await render();
    await advance(24000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getBatch).toHaveBeenCalledTimes(2);

    await act(() => root.render(null));
    respond(Response.json({}, { status: 503 }));
    await advance(24000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getBatch).toHaveBeenCalledTimes(2);
  });

  it("does not request the batch after leaving during a render refresh", async () => {
    let respond!: (response: Response) => void;
    refresh.mockReturnValueOnce(new Promise((resolve) => { respond = resolve; }));
    await render();
    await advance(8000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getBatch).toHaveBeenCalledTimes(1);

    await act(() => root.render(null));
    respond(Response.json({}));
    await advance(8000);
    expect(getBatch).toHaveBeenCalledTimes(1);
    expect(onSpend).not.toHaveBeenCalled();
  });
});
