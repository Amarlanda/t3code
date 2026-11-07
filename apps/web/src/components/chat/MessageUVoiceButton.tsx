import { useState } from "react";
import { Volume2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { toastManager } from "../ui/toast";

export function MessageUVoiceButton({
  text,
  messageId,
  streaming,
  threadRef,
}: {
  text: string;
  messageId: string;
  streaming: boolean;
  threadRef: ScopedThreadRef | null;
}) {
  const [busy, setBusy] = useState(false);
  const bridge = window.desktopBridge?.uvoice;
  const label = bridge ? "Send to UVoice" : "UVoice requires the desktop app";
  const send = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      const markers = Array.from(
        text.matchAll(/<!--\s*SPEAK(?:\s+high)?\s*\[[^\]]+\]:\s*([\s\S]*?)-->/g),
        (match) => match[1]?.trim() ?? "",
      ).filter(Boolean);
      const spoken = markers.length ? markers.join("\n\n") : text.trim();
      if (!spoken) throw new Error("This response has no text to send to UVoice.");
      await bridge.speak({
        text: spoken,
        source: `T3:${messageId}`,
        ...(threadRef
          ? {
              context: {
                t3_environment_id: threadRef.environmentId,
                t3_thread_id: threadRef.threadId,
                t3_message_id: messageId,
              },
            }
          : {}),
      });
      toastManager.add({ type: "success", title: "Sent to UVoice" });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not send to UVoice",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={label}
            disabled={!bridge || busy || streaming}
            onClick={() => {
              void send();
            }}
          />
        }
      >
        <Volume2Icon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">{busy ? "Sending to UVoice…" : label}</TooltipPopup>
    </Tooltip>
  );
}
