# Keyboard focus

The command palette keeps focus while open. Closing it returns focus to the composer in chat,
or to the previous control on other pages. Choosing a workspace focus command moves to that
area instead. Opening Pull Requests moves focus into that page.
While the palette or model picker is open, number shortcuts select its entries instead of
switching threads. Model shortcuts work in Settings as well as the composer.
See [Keybindings](./keybindings.md) to customize these shortcuts.

If you return to typing while a terminal is starting, the composer keeps focus when the terminal
becomes ready. Opening or switching to a terminal explicitly still focuses it.

## Move between workspace areas

Use `Tab` and `Shift+Tab` to move between controls. In NORMAL mode, `Tab` and
`Shift+Tab` move between workspace areas. **Focus Next Workspace Area** and
**Focus Previous Workspace Area** are also available in the command palette and
can be assigned custom shortcuts in Settings → Keybindings. Hidden areas are skipped.
No function keys are required.

## Leave and return to typing

Escape leaves the message input and enters NORMAL mode. If a composer menu is open,
Escape closes that menu first. In NORMAL mode, press `i` to focus the message input and
return to INSERT mode. Other letter keys do not start typing in the message input.

From NORMAL mode, Left Arrow or `h` focuses the Threads sidebar. From the sidebar,
Right Arrow or `l` returns to the conversation in NORMAL mode. Right Arrow or `l` from the conversation
opens the thread details and focuses the first editor action. In the actions, use
Up/Down to choose and Enter to launch; Left Arrow or `h` returns to the conversation
in NORMAL mode. These navigation keys leave the message input unfocused.

You can also focus the input by clicking it or using a workspace focus command.

## Browse threads

Tab enters the sidebar once. Up and Down move between threads without opening them; Enter
opens the focused thread or toggles a group. Left Arrow or `h` collapses a group or
selects its parent; Right Arrow or `l` returns to the conversation in NORMAL mode.
Tab moves from the focused thread to its buttons. `r` renames the focused thread.

Press `m` or the Context Menu key to open the focused thread's menu. Use the arrow
keys to move through it, Enter to choose, and Escape to close it.

## Terminal layouts

**Command+T** opens or hides the terminal. **Command+J** cycles between bottom half,
side by side, and full workspace. The layout buttons in the terminal header offer
the same choices. Switching layouts keeps the shell session running; hiding the
terminal returns focus to the message input. Control works as an alternative modifier.

## Inspect a desktop element

On desktop, hold Shift while right-clicking to reach **Inspect Element** in areas with
their own menus. Streamed browser pages keep their page interactions; this shortcut does
not inspect their remote page content.

The Settings section list works the same way: Up and Down move between sections, and Enter
opens one.
