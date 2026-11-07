import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

export const PIN_COLORS = [
  { value: "blue", label: "Blue", hex: "#3b82f6" },
  { value: "purple", label: "Purple", hex: "#a855f7" },
  { value: "pink", label: "Pink", hex: "#ec4899" },
  { value: "red", label: "Red", hex: "#ef4444" },
  { value: "orange", label: "Orange", hex: "#f97316" },
  { value: "yellow", label: "Yellow", hex: "#eab308" },
  { value: "green", label: "Green", hex: "#22c55e" },
  { value: "teal", label: "Teal", hex: "#14b8a6" },
] as const;

export type PinnedThreadColor = (typeof PIN_COLORS)[number]["value"];
const STORAGE_KEY = "t3code:pinned-thread-colors:v1";
const PersistedColors = Schema.Struct({
  colorByThreadKey: Schema.Record(
    Schema.String,
    Schema.Literals(PIN_COLORS.map((color) => color.value)),
  ),
});
const decodeColors = Schema.decodeUnknownSync(PersistedColors);

export function getPinnedThreadColorHex(color: PinnedThreadColor): string {
  const option = PIN_COLORS.find((entry) => entry.value === color);
  if (!option) throw new Error(`Unknown pinned thread colour: ${color}`);
  return option.hex;
}

function readColors(): Record<string, PinnedThreadColor> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? {} : decodeColors(JSON.parse(raw)).colorByThreadKey;
}

function storageFailure(operation: string, error: unknown): string {
  const message = `Could not ${operation} pinned tab colours: ${error instanceof Error ? error.message : String(error)}`;
  console.error("[PINNED-THREAD-COLORS]", message);
  return message;
}

function initialColors() {
  try {
    return { colorByThreadKey: readColors(), storageError: null };
  } catch (error) {
    return { colorByThreadKey: {}, storageError: storageFailure("load", error) };
  }
}

interface PinnedThreadColorsState {
  colorByThreadKey: Record<string, PinnedThreadColor>;
  pickerThreadKey: string | null;
  storageError: string | null;
  openPicker: (thread: ScopedThreadRef) => void;
  closePicker: () => void;
  setColor: (threadKey: string, color: PinnedThreadColor) => boolean;
}

export const usePinnedThreadColors = create<PinnedThreadColorsState>((set) => ({
  ...initialColors(),
  pickerThreadKey: null,
  openPicker: (thread) => set({ pickerThreadKey: scopedThreadKey(thread) }),
  closePicker: () => set({ pickerThreadKey: null }),
  setColor: (threadKey, color) => {
    try {
      const colorByThreadKey = { ...readColors(), [threadKey]: color };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ colorByThreadKey }));
      set({ colorByThreadKey, storageError: null });
      return true;
    } catch (error) {
      set({ storageError: storageFailure("save", error) });
      return false;
    }
  },
}));
