import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIGHTBOX_JS } from "../worker/portal";

// A small fake page. It has no browser, so it checks what the script does with the events it gets, not how a browser draws.
type Fn = (e: Record<string, unknown>) => void;
const target = () => {
  const on: Record<string, Fn[]> = {};
  return {
    addEventListener: (t: string, f: Fn) => void (on[t] ??= []).push(f),
    fire: (t: string, e: Record<string, unknown> = {}) => {
      const ev = { type: t, preventDefault() { (this as Record<string, unknown>).prevented = true; }, ...e };
      for (const f of on[t] ?? []) f(ev);
      return ev as Record<string, unknown>;
    },
  };
};

function page(initialHash = "", reduceMotion = false) {
  const doc = target();
  const win = target();
  const lb = target();
  const style: Record<string, string> = {};
  const lbStyle: Record<string, string> = {};
  const track = { style, scrollLeft: 400, clientWidth: 400, children: [{ id: "view-1" }, { id: "view-2" }, { id: "view-3" }] };
  const calls: string[] = [];
  const pic = { focus: (o: unknown) => calls.push(`focus ${JSON.stringify(o)}`) };
  const w = Object.assign(win, { scrollY: 700, innerHeight: 800, ...(reduceMotion ? { matchMedia: () => ({ matches: true }) } : {}), scrollTo: (o: { top: number }) => { calls.push(`scrollTo ${o.top}`); w.scrollY = o.top; } });
  const location = {
    hash: initialHash,
    pathname: "/c/tok",
    search: "?x=1",
    replace(url: string) {
      calls.push(`replace ${url}`);
      location.hash = url.includes("#") && url.split("#")[1] ? `#${url.split("#")[1]}` : "";
      win.fire("hashchange");
    },
  };
  const history = { back() { calls.push("back"); location.hash = ""; win.fire("hashchange"); } };
  const document = Object.assign(doc, { querySelector: (s: string) => (s === ".lb" ? Object.assign(lb, { style: lbStyle, querySelector: () => track }) : null) });
  new Function("document", "window", "location", "history", LIGHTBOX_JS)(document, w, location, history);
  const click = (map: Record<string, unknown>) => doc.fire("click", { target: { closest: (sel: string) => map[sel] ?? null } });
  const touch = (type: string, pts: [number, number][], changed = pts) => lb.fire(type, { touches: pts.map(([x, y]) => ({ clientX: x, clientY: y })), changedTouches: changed.map(([x, y]) => ({ clientX: x, clientY: y })) });
  /** What the browser does when a picture link is followed. */
  const openByPicture = () => { click({ "a.pic": pic }); location.hash = "#view-1"; win.fire("hashchange"); };
  return { doc, win: w, style, lbStyle, track, calls, pic, location, click, touch, openByPicture };
}

describe("enlarged view script, run against a fake page", () => {
  let p: ReturnType<typeof page>;
  beforeEach(() => { vi.useFakeTimers(); p = page(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does nothing when the picture or the dark margin is clicked or touched", () => {
    p.openByPicture();
    p.click({}); // the picture, and the margin around it, are in no link
    expect(p.calls).toEqual([]);
    expect(p.location.hash).toBe("#view-1");
  });

  it("the x button closes it, goes back (no jump to an ad) and keeps the page where it was", () => {
    p.openByPicture();
    p.win.scrollY = 0; // the browser moved the page when the view opened
    const ev = p.click({ ".slide .x": {} });
    expect(ev.prevented).toBe(true);
    expect(p.calls).toEqual(["back", "scrollTo 700", 'focus {"preventScroll":true}']);
    expect(p.location.hash).toBe("");
  });

  it("Esc closes it; other keys and Esc on a closed page do nothing", () => {
    p.doc.fire("keydown", { key: "Escape" });
    expect(p.calls).toEqual([]);
    p.openByPicture();
    p.doc.fire("keydown", { key: "a" });
    expect(p.calls).toEqual([]);
    p.doc.fire("keydown", { key: "Escape" });
    expect(p.calls[0]).toBe("back");
    expect(p.location.hash).toBe("");
  });

  it("the arrows replace the address, so one close always leaves the view", () => {
    p.openByPicture();
    p.click({ ".slide .nav": { hash: "#view-2" } });
    expect(p.calls).toEqual(["replace #view-2"]);
    expect(p.location.hash).toBe("#view-2");
    p.doc.fire("keydown", { key: "Escape" });
    expect(p.calls.filter((c) => c === "back")).toHaveLength(1);
  });

  it("a page opened by a link with #view-N (nothing to go back to) closes in place", () => {
    const d = page("#view-2");
    d.doc.fire("keydown", { key: "Escape" });
    expect(d.calls).toEqual(["replace /c/tok?x=1#"]);
    expect(d.location.hash).toBe("");
  });

  it("ignores any other address fragment", () => {
    for (const hash of ["#view-", "#view-1x", "#ad-1", "#view-1<img src=x>"]) {
      const d = page(hash);
      d.doc.fire("keydown", { key: "Escape" });
      expect(d.calls, hash).toEqual([]);
    }
  });

  it("a swipe down of more than 90 px slides and fades the view away, then closes it", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[102, 220]]);
    expect(p.style.transform).toContain("translateY(120px)"); // the picture follows the finger
    expect(p.lbStyle.backgroundColor).toMatch(/^rgba\(20,12,7,0\.[0-9]+\)$/); // the dark backdrop thins out
    p.touch("touchend", [], [[102, 260]]);
    expect(p.calls).toEqual([]); // not closed yet: the view is still sliding away
    expect(p.style.opacity).toBe("0");
    expect(p.lbStyle.backgroundColor).toBe("rgba(20,12,7,0)");
    expect(p.style.transition).toContain(".22s");
    vi.advanceTimersByTime(230);
    expect(p.calls[0]).toBe("back");
    expect(p.style.transform).toBe(""); // put back for the next time it opens
    expect(p.lbStyle.backgroundColor).toBe("");
  });

  it("a short but quick flick down also closes it; a slow short drag does not", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    vi.advanceTimersByTime(20);
    p.touch("touchmove", [[100, 120]]);
    vi.advanceTimersByTime(20);
    p.touch("touchmove", [[100, 150]]); // 50 px in 40 ms
    p.touch("touchend", [], [[100, 150]]);
    vi.advanceTimersByTime(230);
    expect(p.calls[0]).toBe("back");
    const q = page();
    q.openByPicture();
    q.touch("touchstart", [[100, 100]]);
    vi.advanceTimersByTime(20);
    q.touch("touchmove", [[100, 120]]);
    vi.advanceTimersByTime(20);
    q.touch("touchmove", [[100, 150]]);
    vi.advanceTimersByTime(400); // the finger rests before it lifts
    q.touch("touchend", [], [[100, 150]]);
    vi.advanceTimersByTime(1000);
    expect(q.calls).toEqual([]);
  });

  it("with reduced motion it closes at once, with no slide", () => {
    const d = page("", true);
    d.openByPicture();
    d.touch("touchstart", [[100, 100]]);
    d.touch("touchmove", [[100, 260]]);
    d.touch("touchend", [], [[100, 260]]);
    expect(d.calls[0]).toBe("back");
  });

  it("Esc during the slide away closes once; a touch during it is ignored; a stuck close puts the view back", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[100, 260]]);
    p.touch("touchend", [], [[100, 260]]);
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[100, 200]]);
    expect(p.style.opacity).toBe("0"); // the new touch did not grab the sliding view
    p.doc.fire("keydown", { key: "Escape" });
    vi.advanceTimersByTime(1000);
    expect(p.calls.filter((c) => c === "back")).toHaveLength(1);
    // close() that cannot leave the view (the address stays): the view comes back after 0.9 s
    const d = page();
    d.openByPicture();
    (d as unknown as { location: { hash: string } }).location.hash = "#view-1";
    d.win.fire = () => ({}) as never; // the address never changes, so no hashchange follows
    d.touch("touchstart", [[100, 100]]);
    d.touch("touchmove", [[100, 260]]);
    d.touch("touchend", [], [[100, 260]]);
    expect(d.style.opacity).toBe("0");
    vi.advanceTimersByTime(1000);
    expect(d.style.opacity).toBe("");
  });

  it("left and right arrow keys move one ad with no slide, like the arrow buttons", () => {
    p.openByPicture();
    p.track.scrollLeft = 400; // showing ad 2
    const right = p.doc.fire("keydown", { key: "ArrowRight" });
    expect(right.prevented).toBe(true); // the browser's own sliding scroll never starts
    expect(p.calls).toEqual(["replace #view-3"]);
    p.track.scrollLeft = 800;
    p.doc.fire("keydown", { key: "ArrowRight" }); // last ad: nothing further
    expect(p.calls).toEqual(["replace #view-3"]);
    const left = p.doc.fire("keydown", { key: "ArrowLeft" });
    expect(left.prevented).toBe(true);
    expect(p.calls).toEqual(["replace #view-3", "replace #view-2"]);
    p.track.scrollLeft = 0;
    p.doc.fire("keydown", { key: "ArrowLeft" }); // first ad: nothing before it
    expect(p.calls).toHaveLength(2);
  });

  it("arrow keys do nothing when the view is closed, or with a modifier key held", () => {
    const closed = p.doc.fire("keydown", { key: "ArrowRight" });
    expect(closed.prevented).toBeUndefined(); // the page keeps its normal key behaviour
    expect(p.calls).toEqual([]);
    p.openByPicture();
    for (const m of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) p.doc.fire("keydown", { key: "ArrowRight", [m]: true });
    expect(p.calls).toEqual([]);
  });

  it("a short drag down snaps back and stays open; a swipe across or up never starts the drag", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[100, 140]]);
    p.touch("touchend", [], [[100, 140]]);
    expect(p.calls).toEqual([]);
    expect(p.style.transform).toBe("");
    for (const [x, y] of [[300, 108], [100, 20]] as [number, number][]) {
      p.touch("touchstart", [[100, 100]]);
      p.touch("touchmove", [[x, y]]);
      expect(p.style.transform, `${x},${y}`).toBe("");
      p.touch("touchend", [], [[x, y + 300]]);
    }
    expect(p.calls).toEqual([]);
  });

  it("a second finger during a swipe down puts the picture back and ends the drag", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[100, 200]]);
    expect(p.style.transform).toContain("translateY(100px)");
    p.touch("touchstart", [[100, 200], [200, 200]]); // the second finger lands
    expect(p.style.transform).toBe("");
    expect(p.style.opacity).toBe("");
    p.touch("touchmove", [[100, 400], [200, 400]]);
    p.touch("touchend", [[200, 400]], [[100, 400]]); // one finger lifts, one stays
    expect(p.calls).toEqual([]);
    expect(p.style.transform).toBe("");
  });

  it("a cancelled touch snaps back and does not close", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[100, 300]]);
    p.touch("touchcancel", [], [[100, 300]]);
    expect(p.calls).toEqual([]);
    expect(p.style.transform).toBe("");
  });
});
