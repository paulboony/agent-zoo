# Themes

Each theme is a folder under this directory. Themes are auto-registered — no central list to edit.

## Required files

```
<theme-id>/
├── theme.json
├── mascots.css
├── preview.png        (256×256)
└── mascots/
    ├── main.svg
    ├── code-reviewer.svg
    ├── explorer.svg
    ├── writer.svg
    └── general.svg
```

Optional: `notification.mp3` (short audio file).

## SVG conventions

- Root `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">`.
- Use `currentColor` and CSS variables (`var(--accent)` etc.) — no hardcoded hex.
- Required class hooks: `.mascot-body`, `.mascot-eyes`, `.mascot-accent`.
- No `<script>`, no `<foreignObject>`, no inline `style="..."`, no external image refs.

## Visual rubric

- **Kind** = identity. Convey via silhouette, prop, pose, OR palette — pick one and commit per theme.
- **Theme** = aesthetic. Colour, texture, line weight, character archetype.
- **State** = behaviour. Animation timing/curve. running = energetic, waiting = expectant, idle = subdued, error = perturbed.

## CSS animation conventions

`mascots.css` is loaded as a string and injected into a `<style>` tag at runtime. Use attribute selectors (`.mascot[data-state="running"]`). Every theme MUST include `@media (prefers-reduced-motion: reduce) { .mascot * { animation: none !important; } }`.
