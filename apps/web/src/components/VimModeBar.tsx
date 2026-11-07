import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";

import { shortcutLabelForCommand } from "../keybindings";
import { focusSidebarRow } from "../lib/sidebarTree";
import {
  moveWorkspaceFocus,
  requestWorkspaceContentFocus,
  requestWorkspaceFocus,
} from "../lib/workspaceFocus";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { useSidebar } from "./ui/sidebar";

type VimMode = "INSERT" | "NORMAL" | "SIDEBAR" | "SEARCH" | "INPUT" | "ACTIONS" | "TERMINAL";

const SHORTCUTS: ReadonlyArray<{ command: KeybindingCommand; label: string }> = [
  { command: "sidebar.toggle", label: "Sidebar" },
  { command: "terminal.toggle", label: "Terminal" },
  { command: "terminal.cycleLayout", label: "Layout" },
  { command: "commandPalette.toggle", label: "Commands" },
];
const MODE_SHORTCUTS = {
  INSERT: [{ shortcut: "Esc", label: "Leave prompt" }],
  INPUT: [],
  TERMINAL: [],
  ACTIONS: [
    { shortcut: "↑ / ↓", label: "Choose" },
    { shortcut: "Enter", label: "Open" },
    { shortcut: "← / h", label: "Conversation" },
  ],
  SEARCH: [
    { shortcut: "Esc", label: "Clear / back" },
    { shortcut: "↓", label: "Threads" },
  ],
  NORMAL: [
    { shortcut: "i", label: "Write" },
    { shortcut: "← / h", label: "Threads" },
    { shortcut: "→ / l", label: "Actions" },
    { shortcut: "Tab", label: "Next area" },
  ],
  SIDEBAR: [
    { shortcut: "j / k", label: "Move" },
    { shortcut: "← / h", label: "Parent" },
    { shortcut: "→ / l", label: "Conversation" },
    { shortcut: "/", label: "Search" },
    { shortcut: "r", label: "Rename" },
    { shortcut: "m", label: "Menu" },
    { shortcut: "Enter", label: "Open" },
  ],
} satisfies Record<VimMode, ReadonlyArray<{ shortcut: string; label: string }>>;

function readActiveElement() {
  return document.activeElement;
}

function readMode(active: Element | null): VimMode {
  if (isTerminalFocused()) return "TERMINAL";
  if (active?.closest("[data-thread-launcher-group]")) return "ACTIONS";
  if (active?.matches('input[aria-label="Search threads"]')) return "SEARCH";
  if (active?.closest("[data-composer-rich-text]")) return "INSERT";
  if (isEditableFocused(active)) return "INPUT";
  if (active?.closest('[role="tree"][aria-label="Threads"]')) return "SIDEBAR";
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
export function VimModeBar({ keybindings }: { keybindings: ResolvedKeybindingsConfig }) {
  const activeElement = useSyncExternalStore(subscribe, readActiveElement, () => null);
  const mode = readMode(activeElement);
  const [expanded, setExpanded] = useState(false);
  const { open, setOpen, isMobile, setOpenMobile } = useSidebar();
  const modeRows = MODE_SHORTCUTS[mode];
  const rows = SHORTCUTS.flatMap(({ command, label }) => {
    const shortcut = shortcutLabelForCommand(keybindings, command, {
      context: {
        terminalFocus: isTerminalFocused(),
        previewFocus: isPreviewFocused(),
        editableFocus: isEditableFocused(activeElement),
      },
    });
    return shortcut ? [{ shortcut, label }] : [];
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document keydown listener for vim mode keys
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        document.activeElement?.closest("[data-thread-launcher-group]") &&
        (event.key === "ArrowLeft" || event.key === "h")
      ) {
        event.preventDefault();
        requestWorkspaceFocus({ area: "conversation", restore: false });
        return;
      }
      if (
        document.activeElement !== document.body &&
        !document.activeElement?.matches(
          '[data-workspace-area="conversation"], .shortcut-helper-toggle',
        )
      )
        return;
      if (event.key === "i") {
        event.preventDefault();
        requestWorkspaceContentFocus();
      } else if (event.key === "h" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (isMobile) setOpenMobile(true);
        else if (!open) setOpen(true);
        window.setTimeout(focusSidebarRow, 0);
      } else if (event.key === "ArrowRight" || event.key === "l") {
        event.preventDefault();
        const toggle = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            'button[aria-label="Toggle thread details panel"]',
          ),
        ).find((button) => button.checkVisibility());
        if (toggle?.getAttribute("aria-pressed") === "false") toggle.click();
        requestWorkspaceFocus({
          area: "details",
          selector: "button[data-thread-launcher]:not(:disabled)",
          restore: false,
        });
      } else if (event.key === "Tab") {
        event.preventDefault();
        moveWorkspaceFocus(event.shiftKey ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobile, open, setOpen, setOpenMobile]);

  return (
    <aside aria-label="Shortcut helper" className="shortcut-helper" data-vim-mode={mode}>
      <button
        type="button"
        className="shortcut-helper-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse shortcut helper" : "Expand shortcut helper"}
        onClick={() => setExpanded(!expanded)}
      >
        <span aria-live="polite">-- {mode} --</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <ul className="shortcut-helper-keys">
          {[...modeRows, ...rows].map(({ shortcut, label }) => (
            <li key={label}>
              <kbd>{shortcut}</kbd>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
