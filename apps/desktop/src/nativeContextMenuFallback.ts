export function installNativeContextMenuFallback(target: Window): () => void {
  const handleContextMenu = (event: MouseEvent) => {
    if (!event.shiftKey || event.button !== 2) return;
    const remoteCanvas = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLCanvasElement && node.closest("[data-server-browser-surface]"),
      );
    if (!remoteCanvas) event.stopImmediatePropagation();
  };
  // Capture before app menus can prevent Chromium's native context menu.
  target.addEventListener("contextmenu", handleContextMenu, { capture: true });
  return () => target.removeEventListener("contextmenu", handleContextMenu, { capture: true });
}
