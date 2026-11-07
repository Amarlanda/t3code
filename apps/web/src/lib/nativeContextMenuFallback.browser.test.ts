import { expect, it } from "vite-plus/test";
import { installNativeContextMenuFallback } from "../../../desktop/src/nativeContextMenuFallback";

it("keeps native inspection available before local capture handlers without taking remote clicks", () => {
  using elements = new DisposableStack();
  const root = document.createElement("div");
  const local = document.createElement("button");
  const remoteSurface = document.createElement("div");
  remoteSurface.dataset.serverBrowserSurface = "remote-tab";
  const remoteCanvas = document.createElement("canvas");
  remoteSurface.append(remoteCanvas);
  root.append(local, remoteSurface);
  document.body.append(root);
  elements.defer(() => root.remove());

  let customMenuCount = 0;
  root.addEventListener(
    "contextmenu",
    (event) => {
      customMenuCount += 1;
      event.preventDefault();
    },
    { capture: true },
  );
  using _fallback = { [Symbol.dispose]: installNativeContextMenuFallback(window) };

  for (const testCase of [
    { target: local, shiftKey: true, button: 2, prevented: false },
    { target: local, shiftKey: false, button: 2, prevented: true },
    { target: local, shiftKey: true, button: 0, prevented: true },
    { target: remoteCanvas, shiftKey: true, button: 2, prevented: true },
  ]) {
    customMenuCount = 0;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      shiftKey: testCase.shiftKey,
      button: testCase.button,
    });
    testCase.target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(testCase.prevented);
    expect(customMenuCount).toBe(testCase.prevented ? 1 : 0);
  }
});
