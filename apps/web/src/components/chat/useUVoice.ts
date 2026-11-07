import { useEffect, useEffectEvent } from "react";
import {
  CommandId,
  MessageId,
  type DesktopUVoiceRequest,
  type DesktopUVoiceResponse,
} from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../threadRoutes";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { readThreadShells, useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { toastManager } from "../ui/toast";

export function DesktopUVoiceCoordinator() {
  const params = useParams({ strict: false });
  const activeThread = useThreadShell(resolveThreadRouteRef(params));
  const navigate = useNavigate();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const bridge = window.desktopBridge?.uvoice;
  const handle = useEffectEvent(
    async (request: DesktopUVoiceRequest): Promise<DesktopUVoiceResponse> => {
      try {
        if (request.action === "target") {
          if (!activeThread)
            throw new Error("Select an existing T3 conversation before recording a response.");
          return {
            ok: true,
            requestId: request.requestId,
            threadId: activeThread.id,
            environmentId: activeThread.environmentId,
            label: activeThread.title,
          };
        }
        const matches = readThreadShells().filter((candidate) =>
          request.action === "open" && request.conversationId
            ? (candidate.nativeConversationIds ?? []).includes(request.conversationId)
            : candidate.id === request.threadId &&
              candidate.environmentId === request.environmentId,
        );
        if (matches.length !== 1)
          throw new Error(
            matches.length > 1
              ? "More than one T3 conversation matches this message. Open the intended chat manually."
              : "The saved T3 conversation is unavailable. Reconnect its environment before continuing.",
          );
        const thread = matches[0]!;
        if (request.action === "open") {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
          });
          await window.desktopBridge?.revealWindow();
          return {
            ok: true,
            requestId: request.requestId,
            threadId: thread.id,
            environmentId: thread.environmentId,
            accepted: true,
            ...(request.conversationId ? { conversationId: request.conversationId } : {}),
          };
        }
        if (!request.text?.trim()) throw new Error("The UVoice response is empty.");
        const result = await startTurn({
          environmentId: thread.environmentId,
          input: {
            commandId: CommandId.make(request.requestId),
            threadId: thread.id,
            message: {
              messageId: MessageId.make(request.requestId),
              role: "user",
              text: request.text,
              attachments: [],
            },
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            dispatchMode: "auto",
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        return {
          ok: true,
          requestId: request.requestId,
          threadId: thread.id,
          environmentId: thread.environmentId,
          accepted: true,
        };
      } catch (error) {
        return {
          ok: false,
          requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the native UVoice socket and releases its renderer registration on unmount
  useEffect(() => {
    if (!bridge) return;
    const report = (error: unknown) =>
      toastManager.add({
        type: "error",
        title: "UVoice connection failed",
        description: error instanceof Error ? error.message : String(error),
      });
    const unsubscribe = bridge.onRequest((request) => {
      void handle(request)
        .then((response) => bridge.complete(response))
        .catch(report);
    });
    void bridge.setReady(true).catch(report);
    return () => {
      unsubscribe();
      void bridge.setReady(false).catch(report);
    };
  }, [bridge]);
  return null;
}
