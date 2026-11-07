import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { shouldRefocusComposerOnWindowFocus } from "./ChatView.logic";

it("preserves NORMAL and keyboard focus on window return while clicked sidebar rows yield", async () => {
  expect(shouldRefocusComposerOnWindowFocus(null)).toBe(false);
  expect(shouldRefocusComposerOnWindowFocus(document.body)).toBe(false);
  const tree = document.createElement("div");
  tree.setAttribute("role", "tree");
  const row = (name: string, tabIndex: number) => {
    const element = document.createElement("div");
    element.setAttribute("role", "treeitem");
    element.tabIndex = tabIndex;
    element.textContent = name;
    tree.append(element);
    return element;
  };
  const clicked = row("Clicked thread", -1);
  const tabbed = row("Tabbed thread", 0);
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
  document.body.append(tree, conversation, actions);
  using _elements = {
    [Symbol.dispose]: () => {
      tree.remove();
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
