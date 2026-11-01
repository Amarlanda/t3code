import { readDesktopPrimaryBearerToken } from "../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

// Records every key press, click, route change and window layout change, so agents can
// reconstruct what the user did. The server keeps three days of it under logs/ui-activity.
const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUED_EVENTS = 5000;
const LABEL_MAX_LENGTH = 80;

type UiActivityEvent = {
  readonly t: number;
  readonly type: string;
  readonly [key: string]: unknown;
};

let started = false;
let queue: UiActivityEvent[] = [];
let flushing = false;
let lastPath: string | null = null;

const truncate = (value: string) =>
  value.length > LABEL_MAX_LENGTH ? `${value.slice(0, LABEL_MAX_LENGTH)}…` : value;

function describeElement(element: Element | null) {
  if (!element) return null;
  const labelled = element.closest("[aria-label],button,a,[role],input,textarea,[data-slot]");
  const target = labelled ?? element;
  const text = (target as HTMLElement).innerText?.trim().replace(/\s+/g, " ") ?? "";
  const region = element.closest(
    "[role=dialog],[role=region],nav,main,header,aside,[data-slot=sidebar]",
  );
  return {
    tag: target.tagName.toLowerCase(),
    role: target.getAttribute("role") ?? undefined,
    label: target.getAttribute("aria-label") ?? (text ? truncate(text) : undefined),
    slot: target.getAttribute("data-slot") ?? undefined,
    id: target.id || undefined,
    region:
      region?.getAttribute("aria-label") ??
      region?.getAttribute("data-slot") ??
      region?.tagName.toLowerCase(),
  };
}

function record(type: string, details: Record<string, unknown>) {
  const path = window.location.pathname + window.location.search;
  const routeChanged = path !== lastPath;
  lastPath = path;
  if (routeChanged) queue.push({ t: Date.now(), type: "route", path });
  if (type === "route") return;
  queue.push({ t: Date.now(), type, path, ...details });
  if (queue.length > MAX_QUEUED_EVENTS) queue = queue.slice(-MAX_QUEUED_EVENTS);
}

function layoutSnapshot() {
  const wrapper = document.querySelector("[data-slot=sidebar-wrapper]");
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    zoom: window.desktopBridge?.getWindowZoomFactor() ?? 1,
    sidebar: wrapper?.getAttribute("data-sidebar-state") ?? undefined,
    focused: document.hasFocus(),
  };
}

async function flush() {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue;
  queue = [];
  try {
    const token = await readDesktopPrimaryBearerToken();
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl("/api/observability/ui-activity"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        credentials: token ? "omit" : "include",
        body: JSON.stringify(batch),
        keepalive: true,
      },
    );
    if (!response.ok && response.status >= 500) queue = [...batch, ...queue];
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUED_EVENTS);
  } finally {
    flushing = false;
  }
}

export function startUiActivityJournal() {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener(
    "keydown",
    (event) => {
      record("key", {
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey || undefined,
        alt: event.altKey || undefined,
        shift: event.shiftKey || undefined,
        meta: event.metaKey || undefined,
        repeat: event.repeat || undefined,
        target: describeElement(document.activeElement),
      });
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "pointerdown",
    (event) => {
      record("click", {
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        button: event.button,
        pointer: event.pointerType,
        target: describeElement(event.target instanceof Element ? event.target : null),
      });
    },
    { capture: true, passive: true },
  );

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => record("layout", layoutSnapshot()), 250);
  });
  window.addEventListener("focus", () => record("window", { focused: true }));
  window.addEventListener("blur", () => record("window", { focused: false }));
  window.addEventListener("popstate", () => record("route", {}));
  const navigation = (window as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigatesuccess", () => record("route", {}));
  window.addEventListener("pagehide", () => void flush());

  record("layout", layoutSnapshot());
  setInterval(() => void flush(), FLUSH_INTERVAL_MS);
}
