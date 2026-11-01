import type { KeybindingCommand } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { KeyboardIcon } from "lucide-react";

import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";

const QUICK_SHORTCUTS: ReadonlyArray<{ command: KeybindingCommand; label: string }> = [
  { command: "sidebar.toggle", label: "Toggle sidebar" },
  { command: "terminal.toggle", label: "Toggle terminal" },
  { command: "threadPanel.toggle", label: "Toggle thread details" },
  { command: "rightPanel.toggle", label: "Toggle right panel" },
  { command: "diff.toggle", label: "Toggle diff" },
  { command: "commandPalette.toggle", label: "Command palette" },
  { command: "chat.new", label: "New thread" },
  { command: "chat.find", label: "Find in thread" },
];

export function SidebarShortcutsMenu() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const rows = QUICK_SHORTCUTS.flatMap(({ command, label }) => {
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return shortcut ? [{ command, label, shortcut }] : [];
  });

  const handleAllShortcutsClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings/keybindings" });
  };

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover>
        <PopoverTrigger render={<SidebarMenuButton aria-label="Keyboard shortcuts" size="icon" />}>
          <KeyboardIcon />
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" width="sm" padding="compact">
          <PopoverTitle className="mb-2">Keyboard shortcuts</PopoverTitle>
          <ul className="flex flex-col gap-1.5 text-sm">
            {rows.map((row) => (
              <li key={row.command} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
                <Kbd>{row.shortcut}</Kbd>
              </li>
            ))}
          </ul>
          <PopoverClose
            render={
              <Button className="mt-3 w-full" size="sm" variant="outline">
                All shortcuts
              </Button>
            }
            onClick={handleAllShortcutsClick}
          />
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
