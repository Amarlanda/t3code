import type { ContextMenuItem } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

export interface ElectronMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface ElectronMenuContextInput {
  readonly window: Electron.BrowserWindow;
  readonly items: readonly ContextMenuItem[];
  readonly position: Option.Option<ElectronMenuPosition>;
}

export interface ElectronMenuTemplateInput {
  readonly window: Electron.BrowserWindow;
  readonly template: readonly Electron.MenuItemConstructorOptions[];
  readonly frame?: Electron.WebFrameMain;
}

const ElectronMenuOperation = Schema.Literals([
  "set-application-menu",
  "popup-template",
  "show-context-menu",
]);

export class ElectronMenuOperationError extends Schema.TaggedError<ElectronMenuOperationError>()(
  "ElectronMenuOperationError",
  {
    operation: ElectronMenuOperation,
    platform: Schema.String,
    windowId: Schema.NullOr(Schema.Number),
    itemCount: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const window = this.windowId === null ? "" : ` for window ${this.windowId}`;
    return `Electron menu operation ${JSON.stringify(this.operation)} failed${window} with ${this.itemCount} items on ${this.platform}.`;
  }
}

export class ElectronMenu extends Context.Service<
  ElectronMenu,
  {
    readonly setApplicationMenu: (
      template: readonly Electron.MenuItemConstructorOptions[],
    ) => Effect.Effect<void>;
    readonly showContextMenu: (
      input: ElectronMenuContextInput,
    ) => Effect.Effect<Option.Option<string>>;
    readonly popupTemplate: (input: ElectronMenuTemplateInput) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/electron/ElectronMenu") {}

export function handleCommandMenuInput(
  event: Pick<Electron.Event, "preventDefault">,
  input: Electron.Input,
  platform: NodeJS.Platform,
  contents: Electron.WebContents,
): boolean {
  if (
    platform === "darwin" ||
    input.type !== "keyDown" ||
    !input.meta ||
    input.control ||
    input.isComposing
  )
    return false;
  const matches = (item: Electron.MenuItem): boolean => {
    if (!item.enabled || !item.accelerator) return false;
    const parts = item.accelerator.toLowerCase().split("+");
    const key = parts.pop();
    if (!parts.includes("super") || parts.includes("alt") !== input.alt) return false;
    if (key !== "plus" && parts.includes("shift") !== input.shift) return false;
    if (key === "numadd") return input.code === "NumpadAdd";
    if (key === "numsub") return input.code === "NumpadSubtract";
    if (key === "num0") return input.code === "Numpad0";
    return input.key.toLowerCase() === (key === "plus" ? "+" : key);
  };
  const find = (menu: Electron.Menu): Electron.MenuItem | undefined => {
    for (const item of menu.items) {
      if (matches(item)) return item;
      if (item.submenu) {
        const match = find(item.submenu);
        if (match) return match;
      }
    }
    return undefined;
  };
  const menu = Electron.Menu.getApplicationMenu();
  const item = menu && find(menu);
  if (!item) return false;
  // Linux Super accelerators can leave printable input behind; cancel both input and native dispatch.
  event.preventDefault();
  if (
    ["undo", "redo", "cut", "copy", "paste", "selectall"].includes(item.role?.toLowerCase() ?? "")
  ) {
    // Keep rich-editor history on its keyboard path; nested input would reset Chromium's Meta-char suppression.
    const modifiers: Array<"control" | "shift"> = input.shift ? ["control", "shift"] : ["control"];
    setImmediate(() => {
      if (contents.isDestroyed()) return;
      for (const type of ["keyDown", "keyUp"] as const) {
        contents.sendInputEvent({ type, keyCode: input.key, modifiers });
      }
    });
    return true;
  }
  item.click(
    {
      ctrlKey: input.control,
      shiftKey: input.shift,
      altKey: input.alt,
      metaKey: input.meta,
      triggeredByAccelerator: true,
    },
    Electron.BaseWindow.getFocusedWindow(),
    contents,
  );
  return true;
}

function normalizeContextMenuItems(source: readonly ContextMenuItem[]): ContextMenuItem[] {
  const normalizedItems: ContextMenuItem[] = [];

  for (const sourceItem of source) {
    if (typeof sourceItem.id !== "string" || typeof sourceItem.label !== "string") {
      continue;
    }

    // Native menus cannot display the web fallback's decorative headers.
    if (sourceItem.header === true) {
      continue;
    }

    const normalizedItem: ContextMenuItem = {
      id: sourceItem.id,
      label: sourceItem.label,
      destructive: sourceItem.destructive === true,
      disabled: sourceItem.disabled === true,
      ...(sourceItem.separatorBefore === true ? { separatorBefore: true } : {}),
      ...(typeof sourceItem.checked === "boolean" ? { checked: sourceItem.checked } : {}),
    };

    if (sourceItem.children) {
      const normalizedChildren = normalizeContextMenuItems(sourceItem.children);
      if (normalizedChildren.length === 0) {
        continue;
      }
      normalizedItem.children = normalizedChildren;
    }

    normalizedItems.push(normalizedItem);
  }

  return normalizedItems;
}

// popup() and inspectElement() take window points; renderer CSS coordinates need page zoom.
const normalizePosition = (
  position: Option.Option<ElectronMenuPosition>,
  zoomFactor: number,
): Option.Option<ElectronMenuPosition> =>
  Option.filter(
    position,
    ({ x, y }) =>
      Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && Number.isFinite(zoomFactor),
  ).pipe(
    Option.map(({ x, y }) => ({ x: Math.floor(x * zoomFactor), y: Math.floor(y * zoomFactor) })),
  );

/** @public */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  let destructiveMenuIconCache: Option.Option<Electron.NativeImage> | undefined;

  const getDestructiveMenuIcon = (): Option.Option<Electron.NativeImage> => {
    if (platform !== "darwin") {
      return Option.none();
    }
    if (destructiveMenuIconCache !== undefined) {
      return destructiveMenuIconCache;
    }

    try {
      const icon = Electron.nativeImage.createFromNamedImage("trash").resize({
        width: 12,
        height: 12,
      });
      icon.setTemplateImage(true);
      destructiveMenuIconCache = icon.isEmpty() ? Option.none() : Option.some(icon);
    } catch {
      destructiveMenuIconCache = Option.none();
    }

    return destructiveMenuIconCache;
  };

  const buildTemplate = (
    entries: readonly ContextMenuItem[],
    complete: (selectedItemId: Option.Option<string>) => void,
  ): Electron.MenuItemConstructorOptions[] => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    let hasInsertedDestructiveSeparator = false;
    let sectionStartedByExplicitSeparator = false;
    const appendSeparator = () => {
      if (template.length === 0 || template.at(-1)?.type === "separator") return;
      template.push({ type: "separator" });
    };

    for (const item of entries) {
      if (item.separatorBefore) {
        appendSeparator();
        sectionStartedByExplicitSeparator = true;
      }
      if (
        item.destructive &&
        !hasInsertedDestructiveSeparator &&
        !sectionStartedByExplicitSeparator &&
        template.length > 0
      ) {
        appendSeparator();
        hasInsertedDestructiveSeparator = true;
      }

      const itemOption: Electron.MenuItemConstructorOptions = {
        label: item.label,
        enabled: !item.disabled,
        ...(typeof item.checked === "boolean" ? { type: "checkbox", checked: item.checked } : {}),
      };
      if (item.children && item.children.length > 0) {
        itemOption.submenu = buildTemplate(item.children, complete);
      } else {
        itemOption.click = () => complete(Option.some(item.id));
      }
      if (item.destructive && (!item.children || item.children.length === 0)) {
        const destructiveIcon = getDestructiveMenuIcon();
        if (Option.isSome(destructiveIcon)) {
          itemOption.icon = destructiveIcon.value;
        }
      }

      template.push(itemOption);
    }

    return template;
  };

  return ElectronMenu.of({
    setApplicationMenu: Effect.fn("ElectronMenu.setApplicationMenu")(function (template) {
      return Effect.try({
        try: () => {
          Electron.Menu.setApplicationMenu(Electron.Menu.buildFromTemplate([...template]));
        },
        catch: (cause) =>
          new ElectronMenuOperationError({
            operation: "set-application-menu",
            platform,
            windowId: null,
            itemCount: template.length,
            cause,
          }),
      }).pipe(Effect.orDie);
    }),
    popupTemplate: Effect.fn("ElectronMenu.popupTemplate")(function (input) {
      return input.template.length === 0
        ? Effect.void
        : Effect.try({
            try: () =>
              Electron.Menu.buildFromTemplate([...input.template]).popup({
                window: input.window,
                ...(input.frame ? { frame: input.frame } : {}),
              }),
            catch: (cause) =>
              new ElectronMenuOperationError({
                operation: "popup-template",
                platform,
                windowId: input.window.id,
                itemCount: input.template.length,
                cause,
              }),
          }).pipe(Effect.orDie);
    }),
    showContextMenu: Effect.fn("ElectronMenu.showContextMenu")(function (input) {
      return Effect.callback<Option.Option<string>>((resume) => {
        const normalizedItems = normalizeContextMenuItems(input.items);
        if (normalizedItems.length === 0) {
          resume(Effect.succeedNone);
          return;
        }

        let completed = false;
        const complete = (selectedItemId: Option.Option<string>) => {
          if (completed) {
            return;
          }
          completed = true;
          resume(Effect.succeed(selectedItemId));
        };

        try {
          const zoomFactor = input.window.webContents.getZoomFactor();
          const popupPosition = normalizePosition(input.position, zoomFactor);
          const inspectPosition = Option.getOrElse(popupPosition, () => {
            const cursor = Electron.screen.getCursorScreenPoint();
            const bounds = input.window.getContentBounds();
            return {
              x: Math.max(0, cursor.x - bounds.x),
              y: Math.max(0, cursor.y - bounds.y),
            };
          });
          const template = buildTemplate(normalizedItems, complete);
          template.push(
            { type: "separator" },
            {
              label: "Inspect Element",
              click: () => {
                if (!input.window.isDestroyed() && !input.window.webContents.isDestroyed()) {
                  input.window.webContents.inspectElement(inspectPosition.x, inspectPosition.y);
                }
                complete(Option.none());
              },
            },
          );
          const menu = Electron.Menu.buildFromTemplate(template);
          const popupOptions = Option.match(popupPosition, {
            onNone: (): Electron.PopupOptions => ({
              window: input.window,
              callback: () => complete(Option.none()),
            }),
            onSome: (position): Electron.PopupOptions => ({
              window: input.window,
              x: position.x,
              y: position.y,
              callback: () => complete(Option.none()),
            }),
          });
          menu.popup(popupOptions);
        } catch (cause) {
          if (completed) {
            return;
          }
          completed = true;
          resume(
            Effect.die(
              new ElectronMenuOperationError({
                operation: "show-context-menu",
                platform,
                windowId: input.window.id,
                itemCount: normalizedItems.length,
                cause,
              }),
            ),
          );
        }
      });
    }),
  });
});

export const layer = Layer.effect(ElectronMenu, make);
