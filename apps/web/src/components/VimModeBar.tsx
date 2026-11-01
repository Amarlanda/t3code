import { useSyncExternalStore } from "react";
import { useEffect } from "react";

import { focusSidebarRow } from "../lib/sidebarTree";
import { requestWorkspaceContentFocus } from "../lib/workspaceFocus";
import { useSidebar } from "./ui/sidebar";

type VimMode = "INSERT" | "NORMAL" | "SIDEBAR";

const EDITABLE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
const COMPOSER = '[data-composer-rich-text="true"]';

function readMode(): VimMode {
  const active = document.activeElement;
  if (active?.closest('[data-slot="sidebar"]') && !active.matches(EDITABLE)) return "SIDEBAR";
  if (active?.matches(EDITABLE) || active?.closest(EDITABLE)) return "INSERT";
  return "NORMAL";
}

function subscribe(onChange: () => void) {
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", onChange);
  return () => {
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", onChange);
  };
}

/**
 * Vim-style modes: Escape leaves the prompt for NORMAL mode, `i` returns to it, and `h`
 * moves to the sidebar list. The terminal keeps Escape for programs running inside it.
 */
export function VimModeBar() {
  const mode = useSyncExternalStore(subscribe, readMode, () => "NORMAL" as const);
  const { open, setOpen, isMobile } = useSidebar();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener for vim mode keys
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === "Escape" && target?.closest(COMPOSER)) {
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (document.activeElement !== document.body) return;
      if (event.key === "i") {
        event.preventDefault();
        requestWorkspaceContentFocus();
      } else if (event.key === "h" && !isMobile) {
        event.preventDefault();
        if (!open) setOpen(true);
        window.setTimeout(focusSidebarRow, 0);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobile, open, setOpen]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-2 bottom-1 z-50 rounded-sm bg-background/80 px-1.5 font-mono text-2xs text-muted-foreground"
      data-vim-mode={mode}
    >
      -- {mode} --
    </div>
  );
}
