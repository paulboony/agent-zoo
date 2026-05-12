---
name: add-sprite-theme
description: Use when the user wants to scaffold a new sprite-sheet theme in agent-zoo. Triggers on "add a new theme", "create a sprite theme", "I have a sprite sheet to add", or any request to wire a new mascot sheet into apps/web/src/themes/. Do not use for editing the default (svg-mode) theme or for changes to existing themes' configs.
---

# Adding a sprite-sheet theme to agent-zoo

Scaffolds the boilerplate so adding a new theme is just "give me the sheet
and tell me a few numbers." The variable parts (row-per-kind, frame
ranges, chroma-key colour) still need the user to confirm; the file
structure, CSS template, and PNG processing are mechanical.

## What to ask the user upfront

1. **Theme id** (kebab-case). Used for both the folder name and the
   value stored in `localStorage` — once shipped, don't rename or
   existing user preferences point at a missing theme.
2. **Display name** — shown in the picker.
3. **Path to the sprite sheet PNG**.

Everything else is derived or asked after inspecting the sheet.

## Step 1 — inspect the sprite sheet

Sample the corner and a couple of interior pixels to figure out:
- Image dimensions.
- Whether there's a chroma-key colour (a saturated unnatural value like
  bright pink, cyan-blue, magenta, lime). If `getpixel((0,0))` has
  `alpha == 255` and the colour is unnatural, plan to strip it later.
  If `alpha < 255` the sheet already has proper transparency — skip
  Step 4.

```bash
python3 -c "
from PIL import Image
img = Image.open('<path>').convert('RGBA')
print(f'size={img.size}')
for x,y in [(0,0), (1,1), (5,5), (50,50), (img.width-1, img.height-1)]:
    print(f'  ({x},{y}): {img.getpixel((x,y))}')
"
```

Use the sheet width and the suspected cell size to sanity-check the
grid: `(width - 2*padding_x + gap_x) / (cell_width + gap_x)` should be
an integer.

## Step 2 — collect the spec

Default values to propose (override only if the user contradicts):

- `cell` — common JRPG sizes are 16×16, 16×24, 20×24, 32×32. Confirm.
- `gap` — many sheets have `0,0`. Some have spacing between cells.
- `padding` — empty border around the grid. Often `0,0`; sometimes
  `8,8` or similar.
- `rows` — one entry per `AgentKind`. The current set is
  `main`, `code-reviewer`, `explorer`, `writer`, `coder`, `general`.
  Map every kind. If unsure, point them all at row 0 — the user can
  tune individual rows later.
- `states` — frames per `MascotState`. Sensible defaults:
  ```jsonc
  "idle":    { "frames": [0] }
  "running": { "frames": [0, 1], "fps": 6 }
  "waiting": { "frames": [6, 7], "fps": 3 }
  "error":   { "frames": [10] }
  ```
  `frames` can be non-contiguous (e.g. `[0, 3]` if the run cycle
  skips columns).

## Step 3 — generate files

Create `apps/web/src/themes/<id>/`:

1. **`theme.json`** — start from an existing sprite theme's tokens
   (`apps/web/src/themes/final-fantasy-v/theme.json` is the most
   complete; it has every required token including the sidebar set).
   Change `id` and `name`, keep `mascot_mode: "sprite"`, plug in the
   `mascot_sprite` block.

2. **`mascots.css`** — copy verbatim from any existing sprite theme.
   These files are byte-identical across all sprite themes and only
   contain the `.mascot-sprite` rules, the per-frame-count `@keyframes
   sprite-2/3/4`, and the reduced-motion guard. **Do not customise per
   theme** — animation timing is driven by `theme.json`, not CSS.

   ```bash
   cp apps/web/src/themes/final-fantasy-v/mascots.css \
      apps/web/src/themes/<id>/mascots.css
   ```

3. **`preview.png`** — copy any existing theme's `preview.png` as a
   placeholder. It's only shown in the theme picker preview area, and
   isn't critical.

4. **`mascots/sprites.png`** — move/copy the user's sheet into place:
   ```bash
   mkdir -p apps/web/src/themes/<id>/mascots
   cp <user-path> apps/web/src/themes/<id>/mascots/sprites.png
   ```

There are **no per-kind SVG fallback files** required for sprite-mode
themes. The validator (`apps/web/src/lib-theme/validate.ts`) skips the
SVG presence check when `mascot_mode === "sprite"`.

## Step 4 — strip chroma key (only if needed)

First decide which kind of background the sheet has. Sample the
non-transparent-pixel-count by colour using `Counter(img.getdata())`:

- **Clean pixel art** (one or two unique opaque background colours
  dominate, e.g. one colour with thousands of pixels) → exact-match
  strip (4a).
- **Screenshot / scaled / anti-aliased image** (many similar shades of
  the background colour, no single value dominates) → tolerance-band
  strip (4b).

### 4a — exact-match (clean pixel art)

```bash
python3 -c "
from PIL import Image
src = 'apps/web/src/themes/<id>/mascots/sprites.png'
target = (R, G, B)
img = Image.open(src).convert('RGBA')
n = sum(1 for r,g,b,a in img.getdata() if (r,g,b) == target and a > 0)
img.putdata([(r,g,b,0) if (r,g,b) == target else (r,g,b,a)
             for r,g,b,a in img.getdata()])
img.save(src)
print(f'cleared {n} px')
"
```

### 4b — tolerance band (anti-aliased / screenshot)

```bash
python3 -c "
from PIL import Image
src = 'apps/web/src/themes/<id>/mascots/sprites.png'
targets = [(R1, G1, B1), (R2, G2, B2)]   # one or more; sheet can mix
threshold_sq = 60 * 60                   # ~radius 60 in RGB space
img = Image.open(src).convert('RGBA')
new = []
n = 0
for r, g, b, a in img.getdata():
    keep = a
    if a > 0:
        for tr, tg, tb in targets:
            if (r-tr)**2 + (g-tg)**2 + (b-tb)**2 < threshold_sq:
                keep = 0
                n += 1
                break
    new.append((r, g, b, keep))
img.putdata(new)
img.save(src)
print(f'cleared {n} px')
"
```

Tuning: start at `threshold = 60`. Bump higher if anti-aliased edges
still ring around the character, lower if character pixels start
disappearing. Verify visually in the preview.

Common chroma keys seen so far:
- `(0, 136, 255)` — Final Fantasy V sheet (exact-match)
- `(255, 5, 238)` — Final Fantasy (FF1) sheet (exact-match)
- `(144, 144, 255)` blue sky + `(0, 255, 0)` green gap — Super Mario
  Bros. sheet (tolerance band, both colours together)

## Step 5 — verify

```bash
pnpm typecheck     # must pass
pnpm test          # Playwright suite must still pass
```

**Then restart the dev server** (kill + `pnpm dev`). Vite's
`import.meta.glob(eager: true)` in `apps/web/src/lib-theme/registry.ts`
runs at startup; **new theme folders are NOT picked up by HMR**. After
the restart, open the dashboard, switch to the new theme via the
picker, and confirm each agent kind shows its expected row.

If a Claude Preview server is running, `preview_screenshot` is the
quickest way to confirm.

## Step 6 — commit

```bash
git add apps/web/src/themes/<id>
git commit -m "feat(themes): add <name> sprite theme"
```

If the chroma-key strip materially changed the PNG, mention it in the
commit body (the byte size will change; reviewers might wonder).

## Gotchas worth surfacing while you work

- **Cell aspect ratio is preserved at render time.** A 16×24 cell
  rendered at `size=64` ends up as a 42.67×64 box — the mascot card
  reserves the right amount of width. Don't try to "fix" this by
  forcing square output.

- **Folder name and `id` should match** for clarity (`final-fantasy-v`
  folder, `final-fantasy-v` id) — but they don't have to. The registry
  uses `manifest.id` as the key, not the folder name.

- **`rows` must have an entry for every `AgentKind`** in the union, or
  the validator will warn at startup (`"mascot_sprite.rows missing
  entry for kind '<x>'"`).

- **`states` must include all four**: `running`, `waiting`, `idle`,
  `error`. Adding a fifth state requires touching `MascotState` in
  `apps/web/src/lib-theme/types.ts` and `<Mascot>` — out of scope for
  this skill.

- **If the user provides custom palette tokens**, set them in `tokens`
  in `theme.json`. Otherwise inherit the FF V token set as a sensible
  default — they're already tuned for a JRPG aesthetic on a dark
  surface and cover every required CSS variable.

- **Don't propose CLAUDE.md or README.md updates** unless a new
  convention is being introduced. Adding a theme is a content addition,
  not a convention change.
