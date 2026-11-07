# Roof Colour Visualiser

Allows clients to upload a photo of their house and preview the roof in
different colours from the Dulux "Love Your Roof" colour card.

## How to use

1. Open `index.html` in a browser (or host the folder on any static web host,
   e.g. GitHub Pages, Netlify, or your website). There's no server or build step:
   photos never leave the user's device.
2. Click **Upload house photo**.
3. Mark the roof:
   - **Magic wand**: click the roof to select areas of similar colour (adjust
     *Wand tolerance* if it grabs too little or too much; Shift-click removes).
   - **Outline**: click around the roof's corners, then click the first point,
     double-click, or press Enter to close it.
   - **Brush / Eraser**: touch up the selection.
   - **Undo** (or Ctrl/Cmd+Z) and **Clear selection** are available.
4. Pick a colour. The photo's shading and texture are kept, so the roof still
   looks like a roof. *Shading strength* adjusts how much of that shows through.
5. **Hold to see original** to compare, and **Download image** to save it.

## Editing the colour chart

All colours live in `colours.js` as `{ name, hex }` entries. The names follow
the Dulux roof colour card, but the hex values are **approximations** and
should be checked against the card (or Dulux's published colour values) and
adjusted. Add, remove or reorder entries as needed.

## Files

- `index.html`: page layout
- `styles.css`: styling
- `app.js`: image loading, selection tools and recolouring
- `colours.js`: the colour chart
