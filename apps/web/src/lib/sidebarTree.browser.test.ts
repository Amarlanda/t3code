import { createElement, Fragment, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { Sidebar, SidebarProvider, useSidebar } from "../components/ui/sidebar";
import { useStableCallback } from "../hooks/useStableCallback";
import { attachSidebarTree, installSidebarTree } from "./sidebarTree";
import { startWorkspaceFocus, workspaceAreaProps } from "./workspaceFocus";

function setup() {
  const root = document.createElement("div");
  root.setAttribute("role", "tree");
  document.body.append(root);
  let dispose: (() => void) | undefined;
  const row = (id: string, parent?: string) => {
    const element = document.createElement("button");
    element.dataset.sidebarRow = id;
    if (parent) element.dataset.sidebarParent = parent;
    element.setAttribute("role", "treeitem");
    element.textContent = id;
    root.append(element);
    return element;
  };
  return {
    root,
    row,
    install: () => {
      dispose = installSidebarTree(root);
    },
    [Symbol.dispose]() {
      dispose?.();
      root.remove();
    },
  };
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function SidebarNavigationFixture() {
  const { isMobile, setOpenMobile } = useSidebar();
  const [expanded, setExpanded] = useState(false);
  const leaveSidebar = useStableCallback(() => {
    if (isMobile) setOpenMobile(false);
  });
  return createElement(
    Fragment,
    null,
    createElement("button", { onClick: () => setOpenMobile(true) }, "Open sidebar"),
    createElement(
      Sidebar,
      null,
      createElement(
        "div",
        {
          role: "tree",
          ref: (node: HTMLDivElement | null) => attachSidebarTree(node, leaveSidebar),
        },
        createElement(
          "button",
          {
            role: "treeitem",
            "data-sidebar-row": "project",
            "aria-expanded": expanded,
            onClick: () => setExpanded(!expanded),
          },
          "Project",
        ),
      ),
    ),
    createElement(
      "section",
      workspaceAreaProps("conversation", 1, "Conversation"),
      createElement("button", null, "Copy message"),
    ),
    createElement(
      "section",
      workspaceAreaProps("composer", 2, "Composer"),
      createElement("textarea", { "aria-label": "Prompt" }),
    ),
  );
}

describe("sidebar keyboard navigation", () => {
  it("moves focus without activating rows, clamps at the ends, and keeps one Tab stop", () => {
    using tree = setup();
    const first = tree.row("first");
    const second = tree.row("second");
    const last = tree.row("last");
    const activate = vi.fn();
    tree.root.addEventListener("click", activate);
    tree.install();
    first.focus();
    press(first, "ArrowDown");
    expect(document.activeElement).toBe(second);
    press(second, "k");
    expect(document.activeElement).toBe(first);
    press(first, "j");
    expect(document.activeElement).toBe(second);
    press(second, "ArrowUp");
    expect(document.activeElement).toBe(first);
    press(first, "ArrowDown");
    expect(document.activeElement).toBe(second);
    press(second, "End");
    expect(document.activeElement).toBe(last);
    press(last, "ArrowDown");
    expect(document.activeElement).toBe(last);
    press(last, "Home");
    expect(document.activeElement).toBe(first);
    expect(activate).not.toHaveBeenCalled();
    expect(tree.root.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it.each(["{Enter}", " "])("toggles a group with %s and returns to its parent", async (key) => {
    using tree = setup();
    const group = tree.row("project");
    group.setAttribute("aria-expanded", "false");
    group.addEventListener("click", () => {
      const expanded = group.getAttribute("aria-expanded") === "true";
      group.setAttribute("aria-expanded", String(!expanded));
      if (expanded) tree.root.querySelector('[data-sidebar-row="thread"]')?.remove();
      else tree.row("thread", "project");
    });
    tree.install();
    group.focus();
    await userEvent.keyboard(key);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(group);
    // The tree picks up the new child from its mutation observer.
    await vi.waitFor(() =>
      expect(
        tree.root.querySelector('[data-sidebar-parent="project"]')?.getAttribute("aria-level"),
      ).toBe("2"),
    );
    press(group, "ArrowDown");
    const child = document.activeElement as HTMLElement;
    expect(child.dataset.sidebarRow).toBe("thread");
    press(child, "ArrowLeft");
    expect(document.activeElement).toBe(group);
    press(group, "ArrowLeft");
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(press(group, "h").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(group);
    await userEvent.keyboard(key);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard(key);
    expect(group.getAttribute("aria-expanded")).toBe("false");
  });

  it.each([
    { key: "l", width: 767 },
    { key: "ArrowRight", width: 767 },
    { key: "l", width: 768 },
    { key: "ArrowRight", width: 768 },
  ])(
    "returns to the conversation in Normal mode with $key at width $width",
    async ({ key, width }) => {
      await page.viewport(width, 800);
      await using screen = await render(
        createElement(SidebarProvider, null, createElement(SidebarNavigationFixture)),
      );
      using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
      const conversation = screen.getByRole("region", { name: "Conversation" }).element();
      const prompt = screen.getByRole("textbox", { name: "Prompt" });
      await userEvent.click(screen.getByRole("button", { name: "Copy message" }));
      await userEvent.click(prompt);
      if (width < 768) {
        await userEvent.click(screen.getByRole("button", { name: "Open sidebar" }));
        await expect.element(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible();
      }
      const group = page.getByRole("treeitem", { name: "Project" }).element() as HTMLElement;
      group.focus();
      for (const modifiers of [
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { shiftKey: true },
        { isComposing: true },
        { keyCode: 229 },
      ]) {
        expect(press(group, key, modifiers).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(group);
      }
      expect(press(group, key).defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(document.activeElement).toBe(conversation));
      expect(group.getAttribute("aria-expanded")).toBe("false");
      await expect.element(prompt).toHaveValue("");
      if (width < 768)
        await expect.element(page.getByRole("dialog", { name: "Sidebar" })).not.toBeInTheDocument();
      else await expect.element(page.getByRole("treeitem", { name: "Project" })).toBeVisible();
    },
  );

  it.each(["m", "ContextMenu"])("opens the row menu on %s release without moving focus", (key) => {
    using tree = setup();
    tree.row("first");
    const selected = tree.row("selected");
    const contextMenu = vi.fn((event: MouseEvent) => event.preventDefault());
    selected.addEventListener("contextmenu", contextMenu);
    tree.install();
    selected.focus();
    for (const modifiers of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
      { isComposing: true },
      { keyCode: 229 },
    ]) {
      expect(press(selected, "m", modifiers).defaultPrevented).toBe(false);
      selected.dispatchEvent(new KeyboardEvent("keyup", { key: "m", bubbles: true }));
      expect(contextMenu).not.toHaveBeenCalled();
    }
    expect(press(selected, "F10", { shiftKey: true }).defaultPrevented).toBe(false);
    selected.dispatchEvent(
      new KeyboardEvent("keyup", { key: "F10", shiftKey: true, bubbles: true }),
    );
    expect(contextMenu).not.toHaveBeenCalled();
    expect(press(selected, key).defaultPrevented).toBe(true);
    expect(contextMenu).not.toHaveBeenCalled();
    selected.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    expect(contextMenu).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(selected);
  });

  it("lets Tab reach only the focused row's buttons", () => {
    using tree = setup();
    const first = tree.row("first");
    const second = tree.row("second");
    const action = (owner: string) => {
      const button = document.createElement("button");
      button.textContent = `Archive ${owner}`;
      button.dataset.sidebarActionFor = owner;
      tree.root.append(button);
      return button;
    };
    const firstAction = action("first");
    const secondAction = action("second");
    tree.install();
    first.focus();
    expect([firstAction.tabIndex, secondAction.tabIndex]).toEqual([0, -1]);
    press(first, "ArrowDown");
    expect(document.activeElement).toBe(second);
    expect([firstAction.tabIndex, secondAction.tabIndex]).toEqual([-1, 0]);
  });

  it("keeps a rendered row under a collapsed group reachable", () => {
    using tree = setup();
    const shelf = tree.row("shelf:settled");
    shelf.setAttribute("aria-expanded", "false");
    // A collapsed shelf still renders the open thread.
    const open = tree.row("thread", "shelf:settled");
    tree.install();
    shelf.focus();
    press(shelf, "ArrowDown");
    expect(document.activeElement).toBe(open);
  });

  it("skips disabled rows and leaves controls outside rows in the Tab order", () => {
    using tree = setup();
    const first = tree.row("first");
    const loading = tree.row("settled:more");
    loading.disabled = true;
    const undo = document.createElement("button");
    undo.textContent = "Undo";
    tree.root.append(undo);
    tree.install();
    first.focus();
    press(first, "ArrowDown");
    expect(document.activeElement).toBe(first);
    expect(undo.tabIndex).toBe(0);
  });

  it("gives row buttons back their own tab order when the tree reinstalls", () => {
    using tree = setup();
    tree.row("first");
    const second = tree.row("second");
    const action = (owner: string) => {
      const button = document.createElement("button");
      button.dataset.sidebarActionFor = owner;
      tree.root.append(button);
      return button;
    };
    const firstAction = action("first");
    const secondAction = action("second");
    const dispose = installSidebarTree(tree.root);
    second.focus();
    dispose();
    expect([firstAction.tabIndex, secondAction.tabIndex]).toEqual([0, 0]);
    tree.install();
    expect([firstAction.tabIndex, secondAction.tabIndex]).toEqual([-1, 0]);
  });

  it("keeps the scroll position when focus follows a row that moved away", async () => {
    using tree = setup();
    Object.assign(tree.root.style, { height: "100px", overflow: "auto" });
    const settled = tree.row("settled");
    const settle = document.createElement("button");
    settle.textContent = "Settle";
    settled.after(settle);
    settle.dataset.sidebarActionFor = "settled";
    for (let index = 0; index < 20; index++) tree.row(`row-${index}`).style.display = "block";
    tree.install();
    settle.focus();
    // Settling moves the row to the shelf at the bottom and removes the focused button.
    settle.remove();
    settled.remove();
    const moved = tree.row("settled");
    await vi.waitFor(() => expect(document.activeElement).toBe(moved));
    expect(tree.root.scrollTop).toBe(0);
  });

  it("does not pull focus back after a click outside the tree", async () => {
    using tree = setup();
    const first = tree.row("first");
    tree.install();
    const text = document.createElement("p");
    text.textContent = "Chat text";
    document.body.append(text);
    using _text = { [Symbol.dispose]: () => text.remove() };
    first.focus();
    await userEvent.click(text);
    expect(document.activeElement).toBe(document.body);
    // A status change re-renders the tree while the user works elsewhere.
    tree.row("second");
    await vi.waitFor(() =>
      expect(
        tree.root.querySelector('[data-sidebar-row="second"]')?.getAttribute("aria-posinset"),
      ).toBe("2"),
    );
    expect(document.activeElement).toBe(document.body);
  });
});
