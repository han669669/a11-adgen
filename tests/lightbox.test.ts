import { beforeEach, describe, expect, it } from "vitest";
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

function page(initialHash = "") {
  const doc = target();
  const win = target();
  const lb = target();
  const style: Record<string, string> = {};
  const track = { style };
  const calls: string[] = [];
  const pic = { focus: (o: unknown) => calls.push(`focus ${JSON.stringify(o)}`) };
  const w = Object.assign(win, { scrollY: 700, scrollTo: (o: { top: number }) => { calls.push(`scrollTo ${o.top}`); w.scrollY = o.top; } });
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
  const document = Object.assign(doc, { querySelector: (s: string) => (s === ".lb" ? Object.assign(lb, { querySelector: () => track }) : null) });
  new Function("document", "window", "location", "history", LIGHTBOX_JS)(document, w, location, history);
  const click = (map: Record<string, unknown>) => doc.fire("click", { target: { closest: (sel: string) => map[sel] ?? null } });
  const touch = (type: string, pts: [number, number][], changed = pts) => lb.fire(type, { touches: pts.map(([x, y]) => ({ clientX: x, clientY: y })), changedTouches: changed.map(([x, y]) => ({ clientX: x, clientY: y })) });
  /** What the browser does when a picture link is followed. */
  const openByPicture = () => { click({ "a.pic": pic }); location.hash = "#view-1"; win.fire("hashchange"); };
  return { doc, win: w, style, calls, pic, location, click, touch, openByPicture };
}

describe("enlarged view script, run against a fake page", () => {
  let p: ReturnType<typeof page>;
  beforeEach(() => { p = page(); });

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

  it("a swipe down of more than 90 px closes it, and the picture follows the finger", () => {
    p.openByPicture();
    p.touch("touchstart", [[100, 100]]);
    p.touch("touchmove", [[102, 220]]);
    expect(p.style.transform).toBe("translateY(120px)");
    p.touch("touchend", [], [[102, 260]]);
    expect(p.calls[0]).toBe("back");
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
    expect(p.style.transform).toBe("translateY(100px)");
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
