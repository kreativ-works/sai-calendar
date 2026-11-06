import assert from "node:assert/strict";
import test from "node:test";
import { bindDialogViewport, createDialogViewportTracker, lockDialogScroll } from "../lib/client/dialog-viewport.ts";

const portrait = (patch = {}) => ({ layoutWidth: 390, layoutHeight: 844, visualViewport: { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 }, editableFocused: false, ...patch });

test("a mobile keyboard reduces usable sheet height and preserves the visual viewport's pan", () => {
  const measure = createDialogViewportTracker();
  measure(portrait());
  assert.deepEqual(measure(portrait({ editableFocused: true, visualViewport: { width: 390, height: 484, offsetTop: 42, offsetLeft: 0, scale: 1 } })), { width: 390, height: 484, top: 42, left: 0, keyboardOpen: true });
  assert.equal(measure(portrait({ editableFocused: true })).keyboardOpen, false);
});

test("small browser-toolbar movements and unfocused viewport changes do not imply a keyboard", () => {
  const measure = createDialogViewportTracker();
  measure(portrait());
  assert.equal(measure(portrait({ editableFocused: true, visualViewport: { width: 390, height: 744, offsetTop: 0, offsetLeft: 0, scale: 1 } })).keyboardOpen, false);
  assert.equal(measure(portrait({ visualViewport: { width: 390, height: 484, offsetTop: 0, offsetLeft: 0, scale: 1 } })).keyboardOpen, false);
});

test("rotation resets the height reference and desktop resizing does not enable the mobile keyboard state", () => {
  const measure = createDialogViewportTracker();
  measure(portrait());
  assert.equal(measure({ layoutWidth: 844, layoutHeight: 390, visualViewport: { width: 844, height: 390, offsetTop: 0, offsetLeft: 0, scale: 1 }, editableFocused: true }).keyboardOpen, false);
  assert.equal(measure(portrait({ editableFocused: true })).keyboardOpen, false);
  assert.equal(measure({ layoutWidth: 1024, layoutHeight: 768, visualViewport: { width: 1024, height: 420, offsetTop: 0, offsetLeft: 0, scale: 1 }, editableFocused: true }).keyboardOpen, false);
});

test("pinch zoom does not compact or chase the zoomed viewport", () => {
  const measure = createDialogViewportTracker();
  measure(portrait());
  assert.deepEqual(measure(portrait({ editableFocused: true, visualViewport: { width: 195, height: 422, offsetTop: 180, offsetLeft: 90, scale: 2 } })), { width: 390, height: 844, top: 0, left: 0, keyboardOpen: false });
});

test("missing viewport support and invalid measurements keep finite bounded geometry", () => {
  const measure = createDialogViewportTracker();
  assert.deepEqual(measure(portrait({ visualViewport: null })), { width: 390, height: 844, top: 0, left: 0, keyboardOpen: false });
  assert.deepEqual(measure(portrait({ visualViewport: { width: 900, height: 500, offsetTop: 9999, offsetLeft: -30, scale: 1 } })), { width: 390, height: 500, top: 344, left: 0, keyboardOpen: false });
  for (const value of Object.values(measure({ layoutWidth: NaN, layoutHeight: -1, visualViewport: { width: Infinity, height: NaN, offsetTop: Infinity, offsetLeft: NaN, scale: NaN }, editableFocused: false }))) assert.ok(typeof value === "boolean" || Number.isFinite(value));
});

class Style {
  values = new Map();
  getPropertyValue(name) { return this.values.get(name)?.value ?? ""; }
  getPropertyPriority(name) { return this.values.get(name)?.priority ?? ""; }
  setProperty(name, value, priority = "") { this.values.set(name, { value, priority }); }
  removeProperty(name) { this.values.delete(name); }
}

test("viewport event bursts share one frame and closing restores styles, attributes and subscriptions", () => {
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const frames = new Map();
  let nextFrame = 0;
  const view = Object.assign(new EventTarget(), { visualViewport: viewport, innerWidth: 390, innerHeight: 844, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id) });
  const active = { matches: () => true };
  const style = new Style(), attributes = new Map([["data-keyboard-open", "previous"]]);
  style.setProperty("--dialog-viewport-top", "3px", "important");
  const dialog = Object.assign(new EventTarget(), { style, ownerDocument: { defaultView: view, documentElement: { clientWidth: 390, clientHeight: 844 }, activeElement: active }, contains: element => element === active, getAttribute: name => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) });
  const cleanup = bindDialogViewport(dialog);
  assert.equal(style.getPropertyValue("--dialog-viewport-height"), "844px");
  viewport.height = 484; viewport.offsetTop = 42;
  for (let i = 0; i < 5; i++) viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll")); view.dispatchEvent(new Event("resize"));
  assert.equal(frames.size, 1);
  const [id, callback] = [...frames][0]; frames.delete(id); callback();
  assert.equal(style.getPropertyValue("--dialog-viewport-height"), "484px");
  assert.equal(style.getPropertyValue("--dialog-viewport-top"), "42px");
  assert.equal(attributes.get("data-keyboard-open"), "true");
  viewport.dispatchEvent(new Event("resize"));
  cleanup();
  assert.equal(frames.size, 0);
  assert.equal(style.getPropertyValue("--dialog-viewport-height"), "");
  assert.equal(style.getPropertyValue("--dialog-viewport-top"), "3px");
  assert.equal(style.getPropertyPriority("--dialog-viewport-top"), "important");
  assert.equal(attributes.get("data-keyboard-open"), "previous");
  viewport.dispatchEvent(new Event("resize")); view.dispatchEvent(new Event("resize")); dialog.dispatchEvent(new Event("focusin"));
  assert.equal(frames.size, 0);
});

test("nested dialogs keep the document locked and restore exact styles and calendar scroll once", () => {
  const root = new Style(), body = new Style(), scrolls = [];
  root.setProperty("scroll-behavior", "smooth", "important");
  root.setProperty("overflow", "clip");
  body.setProperty("width", "96%");
  const doc = { documentElement: { style: root }, body: { style: body }, defaultView: { scrollX: 0, scrollY: 672, scrollTo: (...position) => scrolls.push(position) } };
  const closeFirst = lockDialogScroll({ ownerDocument: doc });
  const closeSecond = lockDialogScroll({ ownerDocument: doc });
  assert.equal(body.getPropertyValue("position"), "fixed");
  assert.equal(body.getPropertyValue("top"), "-672px");
  closeFirst(); closeFirst();
  assert.equal(body.getPropertyValue("position"), "fixed");
  assert.equal(scrolls.length, 0);
  closeSecond();
  assert.deepEqual(scrolls, [[0, 672]]);
  assert.equal(body.getPropertyValue("position"), "");
  assert.equal(body.getPropertyValue("width"), "96%");
  assert.equal(root.getPropertyValue("overflow"), "clip");
  assert.equal(root.getPropertyValue("scroll-behavior"), "smooth");
  assert.equal(root.getPropertyPriority("scroll-behavior"), "important");
});
