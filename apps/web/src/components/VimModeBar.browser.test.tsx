import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { useRef, useState } from "react";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { shortcutLabelForCommand } from "../keybindings";

import { render } from "../../test/render";
import { moveWorkspaceFocus, startWorkspaceFocus, workspaceAreaProps } from "../lib/workspaceFocus";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import { useChatShortcuts } from "./chat/useChatShortcuts";
import { pasteTextToFocusComposer } from "./chat/composerFocusRedirect";
import { Sidebar, SidebarProvider } from "./ui/sidebar";
import { VimModeBar } from "./VimModeBar";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";

function ThreadActionsFixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-label="Toggle thread details panel"
        aria-pressed={open}
        onClick={() => setOpen(!open)}
      >
        Details
      </button>
      {open && (
        <aside {...workspaceAreaProps("details", 3, "Thread details")} data-thread-launcher-group>
          <button data-thread-launcher="vscode">Open VS Code</button>
          <button data-thread-launcher="gitgrove">Open GitGrove</button>
        </aside>
      )}
    </>
  );
}

function ComposerWithChatShortcuts(props: { richText: boolean; menuOpen: () => boolean }) {
  const [value, setValue] = useState("");
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  useChatShortcuts({
    enabled: true,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    scriptKeybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
      modelPickerOpen: false,
    }),
    threadFindActive: false,
    // The chat adapter forwards captured typing into the real controlled editor.
    composerRef: {
      current: {
        insertTextAtEnd: (text: string) => {
          setValue((current) => current + text);
          editorRef.current?.focusAtEnd();
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: { "workspace.focusNext": () => moveWorkspaceFocus(1) },
    fallback: () => undefined,
  });
  return (
    <div {...workspaceAreaProps("composer", 4, "Message input")}>
      <ComposerPromptEditorTiptap
        editorRef={editorRef}
        value={value}
        cursor={value.length}
        richTextEnabled={props.richText}
        ariaLabel="Prompt"
        contextRecords={new Map()}
        skills={[]}
        disabled={false}
        placeholder=""
        onChange={setValue}
        onPaste={() => {}}
        onCommandKeyDown={(key) => key === "Escape" && props.menuOpen()}
      />
    </div>
  );
}

it.each([true, false])("leaves and re-enters the composer with rich text %s", async (richText) => {
  await page.viewport(1280, 800);
  let menuOpen = true;
  await using screen = await render(
    <SidebarProvider defaultOpen={false}>
      <Sidebar collapsible="offcanvas">
        <div role="tree" aria-label="Threads">
          <button role="treeitem" data-sidebar-row="thread" tabIndex={0}>
            A thread
          </button>
        </div>
      </Sidebar>
      <div {...workspaceAreaProps("conversation", 1, "Conversation")}>Conversation history</div>
      <ThreadActionsFixture />
      <ComposerWithChatShortcuts richText={richText} menuOpen={() => menuOpen} />
      <VimModeBar keybindings={DEFAULT_RESOLVED_KEYBINDINGS} />
    </SidebarProvider>,
  );
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
  const prompt = screen.getByRole("textbox", { name: "Prompt" });
  await userEvent.click(prompt);
  await expect.element(screen.getByText("-- INSERT --")).toBeVisible();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(prompt).toHaveFocus();
  await expect.element(screen.getByText("-- INSERT --")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Collapse shortcut helper" }));
  await userEvent.keyboard("i");
  await expect.element(prompt).toHaveFocus();

  await userEvent.keyboard("{Escape}");
  await expect.element(prompt).toHaveFocus();
  menuOpen = false;
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByText("-- NORMAL --")).toBeVisible();
  await expect.element(prompt).not.toHaveFocus();

  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", "Do not insert while NORMAL");
  const paste = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(paste);
  expect(pasteTextToFocusComposer(paste)).toBeNull();

  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "i",
      code: "KeyI",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    }),
  );
  await expect.element(prompt).not.toHaveFocus();
  await expect.element(screen.getByText("-- NORMAL --")).toBeVisible();

  await userEvent.keyboard("abZ29;/?...");
  await expect.element(prompt).not.toHaveFocus();
  await expect.element(prompt).toHaveTextContent("");
  await expect.element(screen.getByText("-- NORMAL --")).toBeVisible();

  await userEvent.keyboard("i");
  await expect.element(prompt).toHaveFocus();
  await expect.element(prompt).toHaveTextContent("");
  await expect.element(screen.getByText("-- INSERT --")).toBeVisible();

  await userEvent.keyboard("{Escape}{ArrowLeft}");
  await expect.element(screen.getByRole("treeitem", { name: "A thread" })).toHaveFocus();
  await expect.element(screen.getByText("-- SIDEBAR --")).toBeVisible();
  await userEvent.click(prompt);
  await expect.element(prompt).toHaveFocus();
  await expect.element(screen.getByText("-- INSERT --")).toBeVisible();

  await userEvent.keyboard("{Escape}");
  for (const [right, left] of [
    ["{ArrowRight}", "{ArrowLeft}"],
    ["l", "h"],
  ] as const) {
    await userEvent.keyboard(right);
    await expect.element(screen.getByRole("button", { name: "Open VS Code" })).toHaveFocus();
    await expect.element(screen.getByText("-- ACTIONS --")).toBeVisible();
    await userEvent.keyboard(left);
    await expect.element(screen.getByRole("region", { name: "Conversation" })).toHaveFocus();
    await expect.element(screen.getByText("-- NORMAL --")).toBeVisible();
    await expect.element(prompt).toHaveTextContent("");
  }
  await userEvent.keyboard("{Tab}");
  await expect.element(screen.getByRole("button", { name: "Open VS Code" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(screen.getByRole("region", { name: "Conversation" })).toHaveFocus();
  await userEvent.keyboard("i");
  await expect.element(prompt).toHaveFocus();
  await expect.element(screen.getByText("-- INSERT --")).toBeVisible();
});

it("updates hints for editable and terminal focus and remapped bindings", async () => {
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "ctrl+shift+y", command: "terminal.toggle" },
    { key: "ctrl+alt+c", command: "commandPalette.toggle", when: "!terminalFocus" },
    { key: "ctrl+b", command: "sidebar.toggle", when: "!editableFocus" },
  ]);
  const fixture = (bindings: ResolvedKeybindingsConfig) => (
    <SidebarProvider>
      <div role="tree" aria-label="Threads">
        <button role="treeitem">A thread</button>
        <input aria-label="Thread title" />
      </div>
      <div data-terminal-owner="drawer">
        <textarea aria-label="Terminal input" />
      </div>
      <VimModeBar keybindings={bindings} />
    </SidebarProvider>
  );
  await using screen = await render(fixture(keybindings));
  const helper = screen.getByRole("complementary", { name: "Shortcut helper" });
  const title = screen.getByRole("textbox", { name: "Thread title" });
  await userEvent.click(title);
  await userEvent.keyboard("jk");
  await expect.element(title).toHaveValue("jk");
  await expect.element(helper.getByText("-- INPUT --")).toBeVisible();
  await expect.element(helper.getByText("Sidebar", { exact: true })).not.toBeInTheDocument();
  await expect.element(helper.getByText("Commands", { exact: true })).toBeVisible();

  await userEvent.click(screen.getByRole("textbox", { name: "Terminal input" }));
  await expect.element(helper.getByText("-- TERMINAL --")).toBeVisible();
  await expect.element(helper.getByText("Commands", { exact: true })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("treeitem", { name: "A thread" }));
  await expect.element(helper.getByText("-- SIDEBAR --")).toBeVisible();
  await expect.element(helper.getByText("Sidebar", { exact: true })).toBeVisible();
  await expect.element(helper.getByText("Commands", { exact: true })).toBeVisible();
  const previous = shortcutLabelForCommand(keybindings, "terminal.toggle")!;
  await expect.element(helper.getByText(previous, { exact: true })).toBeVisible();

  const remapped = compileResolvedKeybindingsConfig([
    { key: "ctrl+alt+t", command: "terminal.toggle" },
  ]);
  await screen.rerender(fixture(remapped));
  await expect.element(helper.getByText(previous, { exact: true })).not.toBeInTheDocument();
  await expect
    .element(
      helper.getByText(shortcutLabelForCommand(remapped, "terminal.toggle")!, { exact: true }),
    )
    .toBeVisible();
});
