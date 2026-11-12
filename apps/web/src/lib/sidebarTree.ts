import { requestWorkspaceFocus } from "./workspaceFocus";

const ROW = "[data-sidebar-row]";
const VIM_ROW_KEYS: Readonly<Record<string, string>> = {
  j: "ArrowDown",
  k: "ArrowUp",
  h: "ArrowLeft",
};

export function focusSidebarSearch(): boolean {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search threads"]');
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

export function focusSidebarRow(): boolean {
  const list = document.querySelector<HTMLElement>("[data-sidebar-thread-list]");
  const rows = Array.from(list?.querySelectorAll<HTMLElement>(ROW) ?? []).filter(
    (row) => !row.closest('[hidden], [inert], [aria-hidden="true"]') && !row.matches(":disabled"),
  );
  const row =
    rows.find((candidate) => candidate === document.activeElement) ??
    rows.find((candidate) => candidate.matches('[aria-current]:not([aria-current="false"])')) ??
    rows[0];
  if (!row) return false;
  row.scrollIntoView({ block: "nearest" });
  row.focus({ preventScroll: true });
  return true;
}

/** Ref callback for a sidebar list; installs its keyboard navigation and returns its cleanup. */
export function attachSidebarTree(element: HTMLElement | null, onExit?: () => void) {
  return element ? installSidebarTree(element, onExit) : undefined;
}

/**
 * Arrow keys move focus between rows without opening them, as in VS Code's list commands.
 * Rows stay ordinary buttons in the Tab order so screen readers can browse the list.
 */
export function installSidebarTree(root: HTMLElement, onExit?: () => void) {
  let focusedId: string | undefined;
  let focusedParent: string | undefined;
  let focusedIndex = -1;
  let ownsFocus = false;
  let contextMenuRow: HTMLElement | undefined;

  const isVisibleRow = (row: HTMLElement) => {
    const hidden = row.closest('[hidden], [inert], [aria-hidden="true"]');
    // A dialog can temporarily make the whole workspace inert. Keep rows navigable
    // for its return while still excluding exiting row clones.
    return (!hidden || !root.contains(hidden)) && !row.matches(":disabled");
  };
  const visibleRows = () =>
    Array.from(root.querySelectorAll<HTMLElement>(ROW)).filter(isVisibleRow);

  const ownerRow = (element: HTMLElement) => {
    const row = element.closest<HTMLElement>(ROW);
    if (row) return row;
    const linked = element.dataset.sidebarActionFor;
    return linked
      ? root.querySelector<HTMLElement>(`[data-sidebar-row="${CSS.escape(linked)}"]`)
      : null;
  };

  const focusRow = (row: HTMLElement) => {
    // Revealing before focusing also materializes content-visibility:auto descendants.
    row.scrollIntoView({ block: "nearest" });
    row.focus({ preventScroll: true });
  };

  // A row that moves shelves remounts and drops focus to the body; follow it.
  const restoreFocus = () => {
    if (!ownsFocus || focusedId === undefined) return;
    const active = document.activeElement;
    const lost =
      active === document.body ||
      (active instanceof HTMLElement &&
        root.contains(active) &&
        active.matches(ROW) &&
        !isVisibleRow(active));
    if (!lost) return;
    const rows = visibleRows();
    const target =
      rows.find((row) => row.dataset.sidebarRow === focusedId) ??
      rows.find((row) => row.dataset.sidebarRow === focusedParent) ??
      rows[Math.min(Math.max(focusedIndex, 0), rows.length - 1)];
    // A settled row moves to the bottom shelf; scrolling after it fights the route reveal.
    target?.focus({ preventScroll: true });
  };

  // Clicking non-focusable content, including empty list space, drops focus to the body
  // without a focusin event. A click on the focused row fires no focusin either.
  const onPointerDown = (event: PointerEvent) => {
    const focusable =
      event.target instanceof Element
        ? event.target.closest(`${ROW}, button, a[href], input, [tabindex]`)
        : null;
    ownsFocus = focusable !== null && root.contains(focusable);
  };
  const onFocus = (event: FocusEvent) => {
    ownsFocus = root.contains(event.target as Node);
    if (!ownsFocus || !(event.target instanceof HTMLElement)) return;
    const row = ownerRow(event.target);
    if (!row) return;
    focusedId = row.dataset.sidebarRow;
    focusedParent = row.dataset.sidebarParent;
    focusedIndex = visibleRows().indexOf(row);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const row = event.target;
    if (
      !event.defaultPrevented &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ContextMenu" || (!event.shiftKey && event.key === "m")) &&
      row instanceof HTMLElement &&
      row.matches(ROW)
    ) {
      event.preventDefault();
      event.stopPropagation();
      contextMenuRow = row;
      return;
    }
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (!(row instanceof HTMLElement) || !row.matches(ROW)) return;
    const rows = visibleRows();
    const index = rows.indexOf(row);
    if (index < 0) return;
    let target: HTMLElement | undefined;
    if (event.key === "l" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      onExit?.();
      requestWorkspaceFocus({ area: "conversation", restore: false });
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      event.stopPropagation();
      focusSidebarSearch();
      return;
    }
    switch (VIM_ROW_KEYS[event.key] ?? event.key) {
      case "ArrowDown":
        target = rows[Math.min(index + 1, rows.length - 1)];
        break;
      case "ArrowUp":
        target = rows[Math.max(index - 1, 0)];
        break;
      case "Home":
        target = rows[0];
        break;
      case "End":
        target = rows.at(-1);
        break;
      case "ArrowLeft":
        if (row.getAttribute("aria-expanded") === "true") row.click();
        else
          target = rows.find(
            (candidate) => candidate.dataset.sidebarRow === row.dataset.sidebarParent,
          );
        break;
      // Row handlers own Enter, Space, and rename.
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target) focusRow(target);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!contextMenuRow || (event.key !== "ContextMenu" && event.key !== "m")) return;
    const row = contextMenuRow;
    contextMenuRow = undefined;
    event.preventDefault();
    event.stopPropagation();
    if (document.activeElement !== row || !row.isConnected) return;
    const rect = row.getBoundingClientRect();
    // Like VS Code's list, suppress keydown and open on release. Reuse the row's
    // selection-aware handler, including its Electron native menu route.
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.bottom,
      }),
    );
  };
  const observer = new MutationObserver(restoreFocus);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "inert", "aria-hidden"],
  });
  document.addEventListener("focusin", onFocus);
  document.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("keyup", onKeyUp, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("pointerdown", onPointerDown, true);
    root.removeEventListener("keydown", onKeyDown, true);
    root.removeEventListener("keyup", onKeyUp, true);
  };
}
