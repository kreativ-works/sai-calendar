type VisualViewportMeasurement = { width: number; height: number; offsetTop: number; offsetLeft: number; scale: number };
export type DialogViewportMeasurement = {
  layoutWidth: number;
  layoutHeight: number;
  visualViewport?: VisualViewportMeasurement | null;
  editableFocused: boolean;
};
export type DialogViewportGeometry = { width: number; height: number; top: number; left: number; keyboardOpen: boolean };

const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
const clamp = (value: number, maximum: number) => Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : 0;

/** Keyboard visibility is a heuristic; geometry comes from the actual viewport. */
export function createDialogViewportTracker(): (measurement: DialogViewportMeasurement) => DialogViewportGeometry {
  let reference: { width: number; height: number } | null = null;
  return ({ layoutWidth, layoutHeight, visualViewport, editableFocused }) => {
    const width = positive(layoutWidth, 1), height = positive(layoutHeight, 1);
    const scale = positive(visualViewport?.scale ?? 1, 1);
    const unzoomed = Math.abs(scale - 1) < 0.05;
    const widthChanged = !!reference && Math.abs(width - reference.width) > Math.max(24, reference.width * 0.1);
    if (!reference || widthChanged) reference = { width, height };
    else if (unzoomed) reference.height = Math.max(reference.height, height);

    // Let the browser pan/zoom normally instead of chasing a pinch with a
    // newly shrunk/recentered dialog. Pinch zoom is never keyboard evidence.
    const visibleWidth = unzoomed ? Math.min(width, positive(visualViewport?.width ?? width, width)) : width;
    const visibleHeight = unzoomed ? Math.min(height, positive(visualViewport?.height ?? height, height)) : height;
    const reduction = reference.height - visibleHeight;
    return {
      width: visibleWidth,
      height: visibleHeight,
      top: unzoomed ? clamp(visualViewport?.offsetTop ?? 0, height - visibleHeight) : 0,
      left: unzoomed ? clamp(visualViewport?.offsetLeft ?? 0, width - visibleWidth) : 0,
      keyboardOpen: editableFocused && unzoomed && width <= 640 && !widthChanged && reduction >= Math.max(150, reference.height * 0.2),
    };
  };
}

type SavedStyle = { name: string; value: string; priority: string };
function saveStyles(style: CSSStyleDeclaration, names: string[]): SavedStyle[] {
  return names.map(name => ({ name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) }));
}
function restoreStyles(style: CSSStyleDeclaration, saved: SavedStyle[]): void {
  for (const { name, value, priority } of saved) {
    if (value) style.setProperty(name, value, priority);
    else style.removeProperty(name);
  }
}

const scrollLocks = new WeakMap<Document, { dialogs: Set<HTMLDialogElement>; restore: () => void }>();

/** One document lock survives until its final nested SAI dialog is released. */
export function lockDialogScroll(dialog: HTMLDialogElement): () => void {
  const doc = dialog.ownerDocument, view = doc.defaultView;
  if (!view || !doc.body) return () => {};
  let lock = scrollLocks.get(doc);
  if (!lock) {
    const root = doc.documentElement, body = doc.body;
    const x = view.scrollX, y = view.scrollY;
    const rootStyles = saveStyles(root.style, ["overflow", "overscroll-behavior", "scroll-behavior"]);
    const bodyStyles = saveStyles(body.style, ["position", "top", "left", "width", "overflow"]);
    root.style.setProperty("overflow", "hidden");
    root.style.setProperty("overscroll-behavior", "none");
    body.style.setProperty("position", "fixed");
    body.style.setProperty("top", `${-y}px`);
    body.style.setProperty("left", `${-x}px`);
    body.style.setProperty("width", "100%");
    body.style.setProperty("overflow", "hidden");
    lock = {
      dialogs: new Set(),
      restore: () => {
        restoreStyles(body.style, bodyStyles);
        restoreStyles(root.style, rootStyles);
        root.style.setProperty("scroll-behavior", "auto");
        view.scrollTo(x, y);
        restoreStyles(root.style, rootStyles.filter(item => item.name === "scroll-behavior"));
      },
    };
    scrollLocks.set(doc, lock);
  }
  const current = lock;
  current.dialogs.add(dialog);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.dialogs.delete(dialog);
    if (!current.dialogs.size) {
      scrollLocks.delete(doc);
      current.restore();
    }
  };
}

/** Publish CSS geometry synchronously; only subsequent events wait for a frame. */
export function bindDialogViewport(dialog: HTMLDialogElement): () => void {
  const doc = dialog.ownerDocument, view = doc.defaultView;
  if (!view) return () => {};
  const viewport = view.visualViewport;
  const tracker = createDialogViewportTracker();
  const names = ["--dialog-viewport-height", "--dialog-viewport-top", "--dialog-viewport-width", "--dialog-viewport-left"];
  const styles = saveStyles(dialog.style, names);
  const previousKeyboard = dialog.getAttribute("data-keyboard-open");
  let frame: number | null = null;
  const update = () => {
    frame = null;
    const active = doc.activeElement;
    const editableFocused = !!active && dialog.contains(active) && (active.matches('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])') || (active instanceof HTMLElement && active.isContentEditable));
    const geometry = tracker({
      layoutWidth: Math.max(doc.documentElement.clientWidth, view.innerWidth),
      layoutHeight: Math.max(doc.documentElement.clientHeight, view.innerHeight),
      visualViewport: viewport,
      editableFocused,
    });
    dialog.style.setProperty(names[0], `${geometry.height}px`);
    dialog.style.setProperty(names[1], `${geometry.top}px`);
    dialog.style.setProperty(names[2], `${geometry.width}px`);
    dialog.style.setProperty(names[3], `${geometry.left}px`);
    dialog.setAttribute("data-keyboard-open", String(geometry.keyboardOpen));
  };
  const schedule = () => { if (frame === null) frame = view.requestAnimationFrame(update); };
  update();
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  view.addEventListener("resize", schedule);
  view.addEventListener("orientationchange", schedule);
  dialog.addEventListener("focusin", schedule);
  dialog.addEventListener("focusout", schedule);
  return () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    view.removeEventListener("resize", schedule);
    view.removeEventListener("orientationchange", schedule);
    dialog.removeEventListener("focusin", schedule);
    dialog.removeEventListener("focusout", schedule);
    restoreStyles(dialog.style, styles);
    if (previousKeyboard === null) dialog.removeAttribute("data-keyboard-open");
    else dialog.setAttribute("data-keyboard-open", previousKeyboard);
  };
}
