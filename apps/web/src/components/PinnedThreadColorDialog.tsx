import { CheckIcon } from "lucide-react";
import { PIN_COLORS, usePinnedThreadColors } from "../pinnedThreadColors";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export function PinnedThreadColorDialog() {
  const threadKey = usePinnedThreadColors((state) => state.pickerThreadKey);
  const color = usePinnedThreadColors((state) =>
    threadKey ? (state.colorByThreadKey[threadKey] ?? "blue") : "blue",
  );
  const storageError = usePinnedThreadColors((state) => state.storageError);
  const closePicker = usePinnedThreadColors((state) => state.closePicker);
  const setColor = usePinnedThreadColors((state) => state.setColor);

  return (
    <Dialog open={threadKey !== null} onOpenChange={(open) => !open && closePicker()}>
      <DialogPopup className="w-full sm:w-80">
        <DialogHeader>
          <DialogTitle>Choose pinned tab colour</DialogTitle>
          <DialogDescription>
            Blue is the default. Choose a colour to save it on this device.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-4 gap-3" role="group" aria-label="Pinned tab colour">
            {PIN_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={color === option.value}
                className="flex min-h-12 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                style={{ backgroundColor: option.hex }}
                onClick={() => {
                  if (threadKey && setColor(threadKey, option.value)) closePicker();
                }}
              >
                {color === option.value ? (
                  <CheckIcon aria-hidden="true" className="size-5 text-black" />
                ) : null}
              </button>
            ))}
          </div>
          {storageError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {storageError}
            </p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
