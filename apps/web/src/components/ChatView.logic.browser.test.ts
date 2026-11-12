import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { createWorkspaceFocusController } from "../lib/workspaceFocus";
import { shouldRefocusComposerOnWindowFocus } from "./ChatView.logic";

it("preserves NORMAL and keyboard focus on window return while clicked sidebar rows yield", async () => {
  expect(shouldRefocusComposerOnWindowFocus(null)).toBe(false);
  expect(shouldRefocusComposerOnWindowFocus(document.body)).toBe(false);
  const list = document.createElement("ul");
  const row = (name: string) => {
    const element = document.createElement("div");
    element.setAttribute("role", "button");
    element.tabIndex = 0;
    element.dataset.sidebarRow = name;
    element.textContent = name;
    list.append(element);
    return element;
  };
  const clicked = row("Clicked thread");
  const tabbed = row("Tabbed thread");
  const conversation = document.createElement("div");
  conversation.dataset.workspaceArea = "conversation";
  conversation.tabIndex = -1;
  conversation.textContent = "Conversation";
  const actions = document.createElement("div");
  actions.dataset.workspaceArea = "details";
  actions.dataset.threadLauncherGroup = "";
  const launcher = document.createElement("button");
  launcher.textContent = "Open in VS Code";
  actions.append(launcher);
  document.body.append(list, conversation, actions);
  using _elements = {
    [Symbol.dispose]: () => {
      list.remove();
      conversation.remove();
      actions.remove();
    },
  };

  await userEvent.click(conversation);
  expect(document.activeElement).toBe(conversation);
  expect(shouldRefocusComposerOnWindowFocus(document.activeElement)).toBe(false);

  await userEvent.click(clicked);
  expect(document.activeElement).toBe(clicked);
  expect(shouldRefocusComposerOnWindowFocus(document.activeElement)).toBe(true);

  await userEvent.tab();
  expect(document.activeElement).toBe(tabbed);
  expect(shouldRefocusComposerOnWindowFocus(document.activeElement)).toBe(false);

  await userEvent.tab();
  expect(document.activeElement).toBe(launcher);
  expect(shouldRefocusComposerOnWindowFocus(document.activeElement)).toBe(false);
});

it("refocuses the composer on window return from a clicked area after a bare key press", async () => {
  const controller = createWorkspaceFocusController(document);
  const root = document.createElement("div");
  root.innerHTML =
    '<nav data-workspace-area="sidebar" data-workspace-order="0" tabindex="-1"><button>Thread</button></nav>' +
    '<section data-workspace-area="details" data-workspace-order="1" tabindex="-1" style="height: 200px"></section>';
  document.body.append(root);
  using _root = {
    [Symbol.dispose]: () => {
      controller.dispose();
      root.remove();
    },
  };
  const details = root.querySelector("section")!;

  await userEvent.click(details);
  expect(document.activeElement).toBe(details);
  // A window switch can deliver a lone modifier key without moving focus.
  await userEvent.keyboard("{Shift}");
  expect(
    shouldRefocusComposerOnWindowFocus(document.activeElement),
    "a clicked area counts as reached from the keyboard after a bare key press",
  ).toBe(true);

  await userEvent.keyboard("{F6}");
  controller.move(-1);
  await userEvent.keyboard("{F6}");
  controller.move(1);
  expect(document.activeElement).toBe(details);
  expect(shouldRefocusComposerOnWindowFocus(document.activeElement)).toBe(false);
});
