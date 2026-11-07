import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

const { buildFromTemplate, getCursorScreenPoint, getApplicationMenu, getFocusedWindow } =
  vi.hoisted(() => ({
    buildFromTemplate: vi.fn(),
    getCursorScreenPoint: vi.fn(),
    getApplicationMenu: vi.fn(),
    getFocusedWindow: vi.fn(),
  }));

vi.mock("electron", () => ({
  Menu: { buildFromTemplate, getApplicationMenu },
  BaseWindow: { getFocusedWindow },
  screen: { getCursorScreenPoint },
}));

import * as ElectronMenu from "./ElectronMenu.ts";

it("consumes Command menu input once without taking renderer shortcuts or Control input", () => {
  vi.useFakeTimers({ toFake: ["setImmediate", "clearImmediate"] });
  using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
  const sendInputEvent = vi.fn();
  const isDestroyed = vi.fn(() => false);
  const contents = { sendInputEvent, isDestroyed } as unknown as Electron.WebContents;
  const window = {} as Electron.BaseWindow;
  const click = vi.fn();
  getFocusedWindow.mockReset().mockReturnValue(window);
  for (const [accelerator, key, code, shift, role] of [
    ["Super+,", ",", "Comma", false],
    ["Super+R", "r", "KeyR", false],
    ["Shift+Super+R", "R", "KeyR", true],
    ["Super+Shift+V", "V", "KeyV", true],
    ["Super+=", "=", "Equal", false],
    ["Super+Plus", "+", "Equal", true],
    ["Super+-", "-", "Minus", false],
    ["Super+numadd", "+", "NumpadAdd", false],
    ["Super+numsub", "-", "NumpadSubtract", false],
    ["Super+num0", "0", "Numpad0", false],
    ["Super+A", "a", "KeyA", false, "selectall"],
    ["Super+Z", "z", "KeyZ", false, "undo"],
    ["Super+Shift+Z", "Z", "KeyZ", true, "redo"],
    ["Super+C", "c", "KeyC", false, "copy"],
    ["Super+X", "x", "KeyX", false, "cut"],
    ["Super+V", "v", "KeyV", false, "paste"],
  ] as const) {
    click.mockClear();
    sendInputEvent.mockClear();
    isDestroyed.mockReturnValue(false);
    getApplicationMenu.mockReset().mockReturnValue({
      items: [{ submenu: { items: [{ accelerator, role, enabled: true, click }] } }],
    });
    const input = {
      type: "keyDown",
      key,
      code,
      shift,
      meta: true,
      control: false,
      alt: false,
      isAutoRepeat: false,
      isComposing: false,
    } as Electron.Input;
    const event = { preventDefault: vi.fn() };
    assert.isTrue(
      ElectronMenu.handleCommandMenuInput(event, input, "linux", contents),
      accelerator,
    );
    assert.equal(event.preventDefault.mock.calls.length, 1);
    assert.equal(sendInputEvent.mock.calls.length, 0);
    vi.runAllTimers();
    if (role) {
      assert.deepEqual(sendInputEvent.mock.calls, [
        [{ type: "keyDown", keyCode: key, modifiers: shift ? ["control", "shift"] : ["control"] }],
        [{ type: "keyUp", keyCode: key, modifiers: shift ? ["control", "shift"] : ["control"] }],
      ]);
      assert.equal(click.mock.calls.length, 0);
    } else {
      assert.equal(sendInputEvent.mock.calls.length, 0);
      assert.equal(click.mock.calls.length, 1);
      assert.equal(click.mock.calls[0]?.[1], window);
      assert.equal(click.mock.calls[0]?.[2], contents);
      assert.isTrue(click.mock.calls[0]?.[0].triggeredByAccelerator);
    }

    for (const ignored of [
      { ...input, type: "keyUp" },
      { ...input, key: "t", code: "KeyT", shift: false },
      { ...input, meta: false, control: true },
      { ...input, alt: true },
      { ...input, isComposing: true },
    ]) {
      assert.isFalse(ElectronMenu.handleCommandMenuInput(event, ignored, "linux", contents));
    }
    assert.isFalse(ElectronMenu.handleCommandMenuInput(event, input, "darwin", contents));
    assert.equal(event.preventDefault.mock.calls.length, 1);
    assert.equal(click.mock.calls.length, role ? 0 : 1);
    assert.equal(sendInputEvent.mock.calls.length, role ? 2 : 0);
    if (role) {
      sendInputEvent.mockClear();
      ElectronMenu.handleCommandMenuInput(event, input, "linux", contents);
      isDestroyed.mockReturnValue(true);
      vi.runAllTimers();
      assert.equal(sendInputEvent.mock.calls.length, 0);
    }
  }
});

it.effect("keeps app actions and inspects custom menu targets in window points", () =>
  Effect.gen(function* () {
    const menu = yield* ElectronMenu.ElectronMenu;
    for (const testCase of [
      { action: "Open", position: Option.some({ x: 240, y: 120 }), destroyed: false },
      { action: "Inspect Element", position: Option.some({ x: 240, y: 120 }), destroyed: false },
      { action: "Inspect Element", position: Option.none(), destroyed: false },
      { action: "Inspect Element", position: Option.some({ x: 240, y: 120 }), destroyed: true },
    ]) {
      const inspectElement = vi.fn();
      const window = {
        id: 41,
        isDestroyed: () => testCase.destroyed,
        getContentBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
        webContents: {
          getZoomFactor: () => 2,
          isDestroyed: () => testCase.destroyed,
          inspectElement,
        },
      } as unknown as Electron.BrowserWindow;
      getCursorScreenPoint.mockReset().mockReturnValue({ x: 360, y: 260 });
      buildFromTemplate
        .mockReset()
        .mockImplementation((template: Electron.MenuItemConstructorOptions[]) => ({
          popup: (options: Electron.PopupOptions) => {
            assert.deepEqual(
              template.map((item) => item.label ?? item.type),
              ["Open", "separator", "Inspect Element"],
            );
            if (Option.isSome(testCase.position)) {
              assert.equal(options.x, 480);
              assert.equal(options.y, 240);
            }
            // The target is captured before the pointer moves into the native menu.
            getCursorScreenPoint.mockReturnValue({ x: 800, y: 600 });
            template
              .find((item) => item.label === testCase.action)
              ?.click?.({} as Electron.MenuItem, window, {} as Electron.KeyboardEvent);
            options.callback?.();
          },
        }));

      const selected = yield* menu.showContextMenu({
        window,
        items: [{ id: "open", label: "Open" }],
        position: testCase.position,
      });
      assert.deepEqual(selected, testCase.action === "Open" ? Option.some("open") : Option.none());
      assert.deepEqual(
        inspectElement.mock.calls,
        testCase.action === "Open" || testCase.destroyed
          ? []
          : Option.isSome(testCase.position)
            ? [[480, 240]]
            : [[260, 180]],
      );
    }
  }).pipe(Effect.provide(ElectronMenu.layer), Effect.provideService(HostProcess.Platform, "linux")),
);
