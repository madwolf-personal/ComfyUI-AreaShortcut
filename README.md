# Area Shortcut

A ComfyUI custom node that lets you bookmark up to **10 rectangular regions** of your workflow graph and instantly jump/zoom to any of them by pressing a number key (`0`-`9`) — no output, no side effects, purely a navigation aid for large graphs.

One node covers all 10 shortcuts. No need to clutter your workflow with a separate node per bookmark.

## Features

- **10 shortcut slots** (`1`-`9`, `0`) on a single node.
- **`0` is reserved for "Whole canvas"** — always fits the entire graph, no setup required.
- Draw a region directly on the real canvas — what you see is exactly what gets bookmarked, locked to a **16:9** aspect ratio.
- After drawing, **move and resize** the box (drag inside to move, drag a corner handle to resize) before committing it.
- **Pan / Zoom / Draw** mode toolbar while setting a region, so you can freely navigate to find the right spot without accidentally touching nodes or making a selection.
- **Auto-advance**: after assigning a slot, the dropdown jumps to the next digit so you can keep drawing + assigning back-to-back.
- The node face shows a row of `0`-`9`, lit up for slots that already have a saved region, so you can see what's bookmarked at a glance.
- Regions are stored in the node's `properties`, so they save and load with your workflow `.json` / `.png` like any other node data.

## Installation

1. Download or clone this repository into your ComfyUI `custom_nodes` folder:
   ```
   ComfyUI/custom_nodes/area_shortcut/
   ```
2. Restart ComfyUI.
3. Hard-refresh your browser tab (`Ctrl+Shift+R`) to make sure the new frontend extension isn't served from cache.

## Usage

1. Add the **Area Shortcut** node anywhere in your graph (`utils` category). It has no inputs/outputs and never executes — it's a pure UI helper.
2. Pick a digit in the `shortcut_key` dropdown.
3. Click **Set Region** (or **Redraw Region** if that slot is already set).
4. A toolbar appears at the top of the screen with **Pan / Zoom / Draw / Assign / Cancel**:
   - **Pan** — left-drag to pan the graph.
   - **Zoom** — left-drag up/down to zoom in/out (anchored at your cursor). Scroll wheel zooms in any mode.
   - **Draw** — left-drag on empty space to draw a new 16:9 box. Once a box exists, drag inside it to move it, or drag a corner handle to resize it (still locked to 16:9).
   - **Assign** — saves the current box to the selected slot and closes the toolbar. Only appears once a box exists.
   - **Cancel** / `Esc` — closes the toolbar without saving anything.
5. Press the corresponding number key anywhere on the graph to jump straight to that bookmarked region.
6. Press `0` any time to zoom out and fit the whole graph — this one is automatic and doesn't need to be drawn.

Shortcut keys are ignored while typing in a text field/widget, and while the Set Region toolbar is open.

## Notes

- Only one node needs to exist per workflow for all 10 shortcuts to work; adding more `Area Shortcut` nodes is optional (e.g. if you want to organize bookmarks differently), and their shortcuts are checked the same way.
- Regions are stored per-node under `properties.regions`, keyed by digit string (`"1"`-`"9"`, `"0"`).
