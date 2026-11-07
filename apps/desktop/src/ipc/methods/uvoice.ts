// @effect-diagnostics globalTimers:off -- Socket callbacks need bounded renderer deadlines outside an Effect fiber.
// @effect-diagnostics nodeBuiltinImport:off -- Linux desktop adapter owns the local UVoice socket.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import {
  DesktopUVoiceRequest,
  DesktopUVoiceResponse,
  DesktopUVoiceSpeechContext,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { WebContents } from "electron";

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

const MAX_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 256;
const decodeRequest = Schema.decodeUnknownSync(DesktopUVoiceRequest);
export class UVoiceError extends Schema.TaggedError<UVoiceError>()("UVoiceError", {
  message: Schema.String,
}) {}

const SpeakInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_BYTES)),
  source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  context: Schema.optionalKey(DesktopUVoiceSpeechContext),
});

function failure(requestId: string, error: string): DesktopUVoiceResponse {
  return { ok: false, requestId, error };
}

async function prepareSocket(address: string) {
  const existing = await NodeFSP.lstat(address).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!existing) return;
  if (!existing.isSocket()) throw new Error("The UVoice socket path contains a non-socket file.");
  const active = await new Promise<boolean>((resolve, reject) => {
    const probe = NodeNet.createConnection(address);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    probe.setTimeout(1000, () => {
      probe.destroy();
      reject(new Error("UVoice socket probe timed out."));
    });
  });
  if (active) throw new Error("Another T3 Code instance owns the UVoice socket.");
  if ((await NodeFSP.lstat(address)).ino !== existing.ino)
    throw new Error("The UVoice socket changed during startup.");
  await NodeFSP.unlink(address);
}

async function startSocket(
  address: string,
  handle: (raw: unknown) => Promise<DesktopUVoiceResponse>,
) {
  await prepareSocket(address);
  const sockets = new Set<NodeNet.Socket>();
  const server = NodeNet.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let handled = false;
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {
      Effect.runSync(Effect.logWarning("UVoice socket client disconnected with an error"));
    });
    const finish = (response: DesktopUVoiceResponse) => {
      if (!socket.destroyed) socket.end(JSON.stringify(response) + "\n");
    };
    socket.setTimeout(REQUEST_TIMEOUT_MS + 1000, () => {
      finish(failure("invalid-request", "UVoice request timed out."));
      socket.destroySoon();
    });
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_BYTES) {
        handled = true;
        finish(failure("invalid-request", "UVoice request exceeds 256 KiB."));
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      handled = true;
      let raw: unknown;
      try {
        raw = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
      } catch {
        finish(failure("invalid-request", "UVoice request must be newline-delimited JSON."));
        return;
      }
      void handle(raw).then(finish, () =>
        finish(failure("invalid-request", "UVoice request failed.")),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const inode = (await NodeFSP.lstat(address)).ino;
  server.on("error", () => Effect.runSync(Effect.logError("UVoice socket server failed")));
  try {
    await NodeFSP.chmod(address, 0o600);
  } catch (error) {
    server.close();
    await NodeFSP.unlink(address);
    throw error;
  }
  return async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const current = await NodeFSP.lstat(address).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (current?.ino === inode) await NodeFSP.unlink(address);
  };
}

function createRequestHandler(
  getRenderer: () => WebContents | undefined,
  nowMillis: () => number,
  pending: Map<string, (response: DesktopUVoiceResponse) => void>,
) {
  const recent = new Map<
    string,
    { fingerprint: string; expires: number; result: Promise<DesktopUVoiceResponse> }
  >();
  return async (raw: unknown): Promise<DesktopUVoiceResponse> => {
    let request: DesktopUVoiceRequest;
    try {
      if (typeof raw !== "object" || raw === null) throw new Error();
      if ("windowPid" in raw && raw.windowPid !== process.pid)
        throw new Error("UVoice window process does not match this T3 Code instance.");
      const normalized =
        "action" in raw &&
        (raw.action === "target" || raw.action === "open") &&
        !("requestId" in raw)
          ? { ...raw, requestId: NodeCrypto.randomUUID() }
          : raw;
      request = decodeRequest(normalized);
      if (request.action === "send" && !request.text?.trim())
        throw new Error("UVoice send requires text.");
      if (
        request.action === "open" &&
        !request.conversationId &&
        (!request.threadId || !request.environmentId)
      )
        throw new Error(
          "UVoice open requires a thread and environment or an exact conversation ID.",
        );
    } catch {
      return failure("invalid-request", "Invalid UVoice request or mismatched window process.");
    }
    const now = nowMillis();
    for (const [id, entry] of recent)
      if (entry.expires <= now && !pending.has(id)) recent.delete(id);
    const fingerprint = JSON.stringify([
      request.action,
      request.threadId,
      request.environmentId,
      request.conversationId,
      request.text,
    ]);
    const cached = recent.get(request.requestId);
    if (cached)
      return cached.fingerprint === fingerprint
        ? cached.result
        : failure(request.requestId, "UVoice requestId was reused with different content.");
    const renderer = getRenderer();
    if (!renderer || renderer.isDestroyed())
      return failure(request.requestId, "T3 Code renderer is not ready.");
    if (pending.has(request.requestId))
      return failure(request.requestId, "UVoice request is already pending.");
    if (request.action === "send" && recent.size >= CACHE_LIMIT)
      return failure(request.requestId, "UVoice request cache is full; try later.");
    const target = renderer;
    const result = new Promise<DesktopUVoiceResponse>((resolve) => {
      const finish = (response: DesktopUVoiceResponse) => {
        clearTimeout(timer);
        pending.delete(request.requestId);
        if (request.action !== "target" && response.ok && response.accepted !== true) {
          resolve(
            failure(request.requestId, "T3 Code did not acknowledge acceptance of this request."),
          );
          return;
        }
        if (
          request.action === "open" &&
          response.ok &&
          (!response.threadId ||
            !response.environmentId ||
            (request.threadId && response.threadId !== request.threadId) ||
            (request.environmentId && response.environmentId !== request.environmentId))
        ) {
          resolve(
            failure(request.requestId, "T3 Code did not confirm the requested conversation."),
          );
          return;
        }
        Effect.runSync(
          Effect.logInfo("UVoice request completed", {
            action: request.action,
            requestId: request.requestId,
            ok: response.ok,
          }),
        );
        resolve(response);
      };
      const timer = setTimeout(
        () =>
          finish(
            failure(request.requestId, "T3 Code did not confirm delivery before the deadline."),
          ),
        REQUEST_TIMEOUT_MS,
      );
      pending.set(request.requestId, finish);
      try {
        target.send(Channels.UVOICE_REQUEST_CHANNEL, request);
      } catch {
        finish(failure(request.requestId, "T3 Code renderer could not receive the request."));
      }
    });
    if (request.action === "send") {
      recent.set(request.requestId, { fingerprint, expires: now + CACHE_TTL_MS, result });
      void result.then((response) => {
        if (!response.ok && recent.get(request.requestId)?.result === result)
          recent.delete(request.requestId);
      });
    }
    return result;
  };
}

const speak = Effect.fn("desktop.uvoice.requestSpeech")(function* (input: typeof SpeakInput.Type) {
  const client = yield* HttpClient.HttpClient;
  const request = yield* HttpClientRequest.bodyJson(
    HttpClientRequest.post("http://127.0.0.1:8765/speak"),
    { ...input, wait_for_response: false, route: "origin" },
  );
  const response = yield* client.execute(request);
  if (response.status < 200 || response.status >= 300) {
    return yield* new UVoiceError({
      message: `UVoice speech request failed (HTTP ${response.status}).`,
    });
  }
  const result = yield* response.json;
  if (
    typeof result !== "object" ||
    result === null ||
    ("status" in result && result.status === "error") ||
    ("ok" in result && result.ok === false)
  ) {
    return yield* new UVoiceError({ message: "UVoice rejected the speech request." });
  }
}, Effect.timeout(REQUEST_TIMEOUT_MS));

export const installUVoice = Effect.fn("desktop.ipc.installUVoice")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const windows = yield* ElectronWindow.ElectronWindow;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const clock = yield* Clock.Clock;
  let renderer: WebContents | undefined;
  let startupFailure: string | undefined;
  const pending = new Map<string, (response: DesktopUVoiceResponse) => void>();
  const requireMain = Effect.fn("desktop.uvoice.requireMain")(function* (
    event?: DesktopIpc.DesktopIpcInvokeEvent,
  ) {
    const main = yield* windows.main;
    if (
      Option.isNone(main) ||
      main.value.isDestroyed() ||
      main.value.webContents.id !== event?.sender.id
    ) {
      return yield* new UVoiceError({ message: "UVoice IPC requires the main T3 Code window." });
    }
    return main.value.webContents;
  });
  const disconnect = () => {
    renderer?.removeListener("destroyed", disconnect);
    renderer?.removeListener("did-start-navigation", onNavigation);
    renderer?.removeListener("render-process-gone", disconnect);
    renderer = undefined;
    for (const [requestId, resolve] of pending)
      resolve(failure(requestId, "T3 Code renderer disconnected; delivery is unconfirmed."));
  };
  const onNavigation = (
    event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
  ) => {
    if (event.isMainFrame && !event.isSameDocument) disconnect();
  };
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: Channels.UVOICE_READY_CHANNEL,
      payload: Schema.Boolean,
      result: Schema.Void,
      handler: Effect.fn("desktop.uvoice.ready")(function* (ready, event) {
        const sender = yield* requireMain(event);
        if (!ready) {
          disconnect();
          return;
        }
        if (startupFailure) return yield* new UVoiceError({ message: startupFailure });
        if (renderer === sender) return;
        disconnect();
        renderer = sender;
        sender.once("destroyed", disconnect);
        sender.on("did-start-navigation", onNavigation);
        sender.once("render-process-gone", disconnect);
      }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: Channels.UVOICE_COMPLETE_CHANNEL,
      payload: DesktopUVoiceResponse,
      result: Schema.Void,
      handler: Effect.fn("desktop.uvoice.complete")(function* (response, event) {
        yield* requireMain(event);
        pending.get(response.requestId)?.(response);
      }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: Channels.UVOICE_SPEAK_CHANNEL,
      payload: SpeakInput,
      result: Schema.Void,
      handler: Effect.fn("desktop.uvoice.speak")(function* (input, event) {
        yield* requireMain(event);
        yield* speak(input);
      }),
    }),
  );
  yield* Effect.addFinalizer(() => Effect.sync(disconnect));
  if (platform !== "linux") return;
  const directory = environment.XDG_RUNTIME_DIR;
  if (!directory || !NodePath.isAbsolute(directory)) {
    startupFailure = "UVoice requires an absolute XDG_RUNTIME_DIR.";
    yield* Effect.logError("UVoice bridge unavailable", { reason: startupFailure });
    return;
  }
  const handle = createRequestHandler(
    () => renderer,
    () => clock.currentTimeMillisUnsafe(),
    pending,
  );
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => startSocket(NodePath.join(directory, "t3code-uvoice.sock"), handle),
      catch: (error) =>
        new UVoiceError({
          message: error instanceof Error ? error.message : "UVoice socket startup failed.",
        }),
    }).pipe(
      Effect.catch((error) => {
        startupFailure = error.message;
        return Effect.logError("UVoice bridge unavailable", { reason: startupFailure }).pipe(
          Effect.as(null),
        );
      }),
    ),
    (close) => (close ? Effect.tryPromise(close).pipe(Effect.orDie) : Effect.void),
  );
  if (!startupFailure) yield* Effect.logInfo("UVoice local bridge listening");
});
