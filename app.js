(() => {
  "use strict";

  const MAX_DIM = 1600;   // working resolution cap (keeps recolouring fast)
  const UNDO_LIMIT = 25;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const view = $("view");
  const vctx = view.getContext("2d");
  const fileInput = $("fileInput");
  const hint = $("hint");

  // ---------- State ----------
  let W = 0, H = 0;
  let origData = null;          // ImageData of the photo
  let Lmap = null;              // Float32Array of CIE L* per pixel
  let labCache = null;          // Float32Array [L,a,b,...] for magic wand
  const mask = document.createElement("canvas");     // white = roof
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  const feather = document.createElement("canvas");  // blurred mask
  const fctx = feather.getContext("2d", { willReadFrequently: true });
  const comp = document.createElement("canvas");     // rendered result
  const cctx = comp.getContext("2d");
  const tint = document.createElement("canvas");     // highlight overlay
  const tctx = tint.getContext("2d");

  let maskAlpha = null;         // Uint8 feathered alpha
  let meanL = 50;
  let maskDirty = true;
  let colour = null;            // {name, hex}
  let tool = "wand";
  let comparing = false;
  let undoStack = [];
  let polyPts = [];
  let pointer = null;           // last pointer position in image coords
  let painting = false;
  let lastPaint = null;
  let renderQueued = false;

  // ---------- Colour maths (sRGB <-> CIE Lab, D65) ----------
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const finv = (t) => (t > 0.206893 ? t * t * t : (t - 16 / 116) / 7.787);
  const gamma = (c) => {
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };

  function rgbToLab(r, g, b, out, o) {
    const R = toLin[r], G = toLin[g], B = toLin[b];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / Xn;
    const y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / Yn;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / Zn;
    const fx = f(x), fy = f(y), fz = f(z);
    out[o] = 116 * fy - 16;
    out[o + 1] = 500 * (fx - fy);
    out[o + 2] = 200 * (fy - fz);
  }

  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const x = finv(fx) * Xn, y = finv(fy) * Yn, z = finv(fz) * Zn;
    return [
      gamma(x * 3.2406 + y * -1.5372 + z * -0.4986),
      gamma(x * -0.9689 + y * 1.8758 + z * 0.0415),
      gamma(x * 0.0557 + y * -0.204 + z * 1.057),
    ];
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ---------- Loading ----------
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { loadImage(img); URL.revokeObjectURL(url); };
    img.onerror = () => { alert("Sorry, that image couldn't be opened."); URL.revokeObjectURL(url); };
    img.src = url;
    fileInput.value = "";
  });

  function loadImage(img) {
    const s = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    W = Math.round(img.naturalWidth * s);
    H = Math.round(img.naturalHeight * s);
    for (const c of [view, mask, feather, comp, tint]) { c.width = W; c.height = H; }

    cctx.drawImage(img, 0, 0, W, H);
    origData = cctx.getImageData(0, 0, W, H);

    const d = origData.data, n = W * H;
    Lmap = new Float32Array(n);
    labCache = new Float32Array(n * 3);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      rgbToLab(d[p], d[p + 1], d[p + 2], labCache, i * 3);
      Lmap[i] = labCache[i * 3];
    }

    mctx.clearRect(0, 0, W, H);
    undoStack = [];
    polyPts = [];
    maskDirty = true;
    $("empty").hidden = true;
    $("stage").hidden = false;
    updateHint();
    recompute();
  }

  // ---------- Mask helpers ----------
  function pushUndo() {
    if (!W) return;
    undoStack.push(mctx.getImageData(0, 0, W, H));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function maskChanged() { maskDirty = true; scheduleRecompute(); }

  function refreshMask() {
    // Soften the edge slightly so the new colour blends into the photo.
    fctx.clearRect(0, 0, W, H);
    fctx.filter = "blur(1.2px)";
    fctx.drawImage(mask, 0, 0);
    fctx.filter = "none";
    const fd = fctx.getImageData(0, 0, W, H).data;
    const n = W * H;
    maskAlpha = new Uint8Array(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      // Boost alpha so the soft edge sits just outside the selection and
      // covers the photo's own anti-aliased roof edge (avoids a fringe).
      const a = Math.min(255, fd[i * 4 + 3] * 2);
      maskAlpha[i] = a;
      if (a > 127) { sum += Lmap[i]; cnt++; }
    }
    meanL = cnt ? sum / cnt : 50;

    // Highlight overlay
    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(mask, 0, 0);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = "rgba(30, 144, 255, 0.45)";
    tctx.fillRect(0, 0, W, H);
    tctx.globalCompositeOperation = "source-over";
    maskDirty = false;
  }

  // ---------- Recolouring ----------
  // Keeps the photo's shading and texture: the roof's lightness variation
  // (relative to its average) is applied around the chosen colour's lightness,
  // while hue/saturation come from the chosen colour.
  function recompute() {
    if (!W) return;
    if (maskDirty) refreshMask();
    if (!colour) { cctx.putImageData(origData, 0, 0); draw(); return; }

    const [r, g, b] = hexToRgb(colour.hex);
    const t = new Float32Array(3);
    rgbToLab(r, g, b, t, 0);
    const k = Number($("contrast").value) / 100;

    // Lookup table indexed by original L* (0..100 in 0.1 steps)
    const lut = new Uint8ClampedArray(1001 * 3);
    for (let q = 0; q <= 1000; q++) {
      const L = Math.max(0, Math.min(100, t[0] + (q / 10 - meanL) * k));
      const [R, G, B] = labToRgb(L, t[1], t[2]);
      lut[q * 3] = R; lut[q * 3 + 1] = G; lut[q * 3 + 2] = B;
    }

    const out = new ImageData(new Uint8ClampedArray(origData.data), W, H);
    const d = out.data, n = W * H;
    for (let i = 0; i < n; i++) {
      const a = maskAlpha[i];
      if (!a) continue;
      const q = Math.max(0, Math.min(1000, Math.round(Lmap[i] * 10))) * 3;
      const p = i * 4;
      if (a === 255) {
        d[p] = lut[q]; d[p + 1] = lut[q + 1]; d[p + 2] = lut[q + 2];
      } else {
        const m = a / 255, im = 1 - m;
        d[p] = d[p] * im + lut[q] * m;
        d[p + 1] = d[p + 1] * im + lut[q + 1] * m;
        d[p + 2] = d[p + 2] * im + lut[q + 2] * m;
      }
    }
    cctx.putImageData(out, 0, 0);
    draw();
  }

  function scheduleRecompute() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; recompute(); });
  }

  // ---------- Drawing the view ----------
  function displayScale() { return W / view.getBoundingClientRect().width || 1; }

  function draw() {
    if (!W) return;
    if (comparing) { vctx.putImageData(origData, 0, 0); return; }
    vctx.clearRect(0, 0, W, H);
    vctx.drawImage(comp, 0, 0);
    if ($("showMask").checked) vctx.drawImage(tint, 0, 0);

    const s = displayScale();
    // Outline in progress
    if (polyPts.length) {
      vctx.save();
      vctx.lineWidth = 2 * s;
      vctx.strokeStyle = "#ffeb3b";
      vctx.fillStyle = "rgba(255,235,59,0.2)";
      vctx.beginPath();
      polyPts.forEach((p, i) => (i ? vctx.lineTo(p.x, p.y) : vctx.moveTo(p.x, p.y)));
      if (pointer) vctx.lineTo(pointer.x, pointer.y);
      vctx.fill();
      vctx.stroke();
      for (const [i, p] of polyPts.entries()) {
        vctx.beginPath();
        vctx.arc(p.x, p.y, (i === 0 ? 6 : 4) * s, 0, Math.PI * 2);
        vctx.fillStyle = i === 0 ? "#ff5722" : "#ffeb3b";
        vctx.fill();
      }
      vctx.restore();
    }
    // Brush cursor
    if (pointer && (tool === "brush" || tool === "erase")) {
      vctx.save();
      vctx.lineWidth = 1.5 * s;
      vctx.strokeStyle = tool === "erase" ? "#ff5252" : "#ffffff";
      vctx.beginPath();
      vctx.arc(pointer.x, pointer.y, brushRadius(), 0, Math.PI * 2);
      vctx.stroke();
      vctx.restore();
    }
  }

  // ---------- Tools ----------
  function brushRadius() { return (Number($("brushSize").value) / 2) * displayScale(); }

  function toImage(e) {
    const r = view.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  }

  function paintTo(p) {
    mctx.save();
    mctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    mctx.strokeStyle = mctx.fillStyle = "#fff";
    mctx.lineCap = mctx.lineJoin = "round";
    mctx.lineWidth = brushRadius() * 2;
    mctx.beginPath();
    if (lastPaint) { mctx.moveTo(lastPaint.x, lastPaint.y); mctx.lineTo(p.x, p.y); mctx.stroke(); }
    else { mctx.arc(p.x, p.y, brushRadius(), 0, Math.PI * 2); mctx.fill(); }
    mctx.restore();
    lastPaint = p;
    maskChanged();
  }

  function magicWand(p, subtract) {
    const sx = Math.floor(p.x), sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const tol = Number($("tolerance").value);
    const tol2 = tol * tol;
    const s = (sy * W + sx) * 3;
    const L0 = labCache[s], a0 = labCache[s + 1], b0 = labCache[s + 2];
    const seen = new Uint8Array(W * H);
    const stack = [sy * W + sx];
    seen[sy * W + sx] = 1;
    const sel = new Uint8Array(W * H);
    while (stack.length) {
      const i = stack.pop();
      const o = i * 3;
      // Lightness is weighted down so shadows across the roof are included.
      const dL = (labCache[o] - L0) * 0.5, da = labCache[o + 1] - a0, db = labCache[o + 2] - b0;
      if (dL * dL + da * da + db * db > tol2) continue;
      sel[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W); }
    }
    // Turn the selection into an image so it can be merged into the mask
    const img = new ImageData(W, H);
    for (let i = 0; i < W * H; i++) if (sel[i]) { img.data[i * 4 + 3] = 255; }
    const tmp = document.createElement("canvas");
    tmp.width = W; tmp.height = H;
    tmp.getContext("2d").putImageData(img, 0, 0);

    pushUndo();
    mctx.save();
    mctx.globalCompositeOperation = subtract ? "destination-out" : "source-over";
    mctx.drawImage(tmp, 0, 0);
    mctx.restore();
    // Make the mask white wherever it is opaque (wand pixels were black)
    mctx.save();
    mctx.globalCompositeOperation = "source-in";
    mctx.fillStyle = "#fff";
    mctx.fillRect(0, 0, W, H);
    mctx.restore();
    maskChanged();
  }

  function closePolygon(subtract) {
    if (polyPts.length >= 3) {
      pushUndo();
      mctx.save();
      mctx.globalCompositeOperation = subtract ? "destination-out" : "source-over";
      mctx.fillStyle = "#fff";
      mctx.beginPath();
      polyPts.forEach((p, i) => (i ? mctx.lineTo(p.x, p.y) : mctx.moveTo(p.x, p.y)));
      mctx.closePath();
      mctx.fill();
      mctx.restore();
      maskChanged();
    }
    polyPts = [];
    draw();
  }

  view.addEventListener("pointerdown", (e) => {
    if (!W) return;
    const p = toImage(e);
    pointer = p;
    if (tool === "wand") {
      magicWand(p, e.shiftKey || e.altKey);
    } else if (tool === "poly") {
      const first = polyPts[0];
      if (first && Math.hypot(first.x - p.x, first.y - p.y) < 12 * displayScale() && polyPts.length >= 3) {
        closePolygon(e.shiftKey || e.altKey);
      } else {
        polyPts.push(p);
        draw();
      }
    } else {
      view.setPointerCapture(e.pointerId);
      pushUndo();
      painting = true;
      lastPaint = null;
      paintTo(p);
    }
  });

  view.addEventListener("pointermove", (e) => {
    if (!W) return;
    pointer = toImage(e);
    if (painting) paintTo(pointer);
    else draw();
  });

  const endPaint = () => { painting = false; lastPaint = null; };
  view.addEventListener("pointerup", endPaint);
  view.addEventListener("pointercancel", endPaint);
  view.addEventListener("pointerleave", () => { if (!painting) { pointer = null; draw(); } });
  view.addEventListener("dblclick", (e) => {
    if (tool !== "poly") return;
    // The double-click's two pointerdowns added the same point twice; drop the duplicate.
    if (polyPts.length > 1) polyPts.pop();
    closePolygon(e.shiftKey || e.altKey);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && polyPts.length) { polyPts = []; draw(); }
    if (e.key === "Enter" && polyPts.length) closePolygon(e.shiftKey);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  });

  // ---------- Controls ----------
  document.querySelectorAll(".tool").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b === btn));
      tool = btn.dataset.tool;
      if (tool !== "poly") polyPts = [];
      updateHint();
      draw();
    })
  );

  function updateHint() {
    $("tolRow").hidden = tool !== "wand";
    $("sizeRow").hidden = !(tool === "brush" || tool === "erase");
    const hints = {
      wand: "Tap the roof to select areas of similar colour. Tap again to add more. If it grabs too much, Undo and lower the tolerance.",
      poly: "Tap each corner of the roof, then tap the first point (orange) to finish. Undo removes the last point.",
      brush: "Paint over any parts of the roof that were missed.",
      erase: "Paint over areas that shouldn't be recoloured (gutters, chimneys, sky).",
    };
    hint.textContent = W ? hints[tool] : "";
  }

  function undo() {
    if (polyPts.length) { polyPts.pop(); draw(); return; }
    const prev = undoStack.pop();
    if (!prev) return;
    mctx.putImageData(prev, 0, 0);
    maskChanged();
  }
  $("undoBtn").addEventListener("click", undo);
  $("clearBtn").addEventListener("click", () => {
    if (!W) return;
    pushUndo();
    mctx.clearRect(0, 0, W, H);
    polyPts = [];
    maskChanged();
  });
  $("showMask").addEventListener("change", draw);
  $("contrast").addEventListener("input", scheduleRecompute);

  const cmp = $("compareBtn");
  const setCompare = (v) => { comparing = v; draw(); };
  cmp.addEventListener("pointerdown", () => setCompare(true));
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => cmp.addEventListener(ev, () => setCompare(false)));

  $("downloadBtn").addEventListener("click", () => {
    if (!W) return;
    comp.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `roof-${colour ? colour.name.toLowerCase().replace(/\s+/g, "-") : "original"}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/jpeg", 0.92);
  });

  window.addEventListener("resize", draw);

  // ---------- Swatches ----------
  const swatchBox = $("swatches");
  (window.ROOF_COLOUR_GROUPS || []).forEach((g) => {
    const head = document.createElement("h3");
    head.className = "swatch-group";
    head.textContent = g.name;
    if (g.note) {
      const note = document.createElement("small");
      note.textContent = g.note;
      head.appendChild(note);
    }
    swatchBox.appendChild(head);
    g.colours.forEach((c) => {
      const b = document.createElement("button");
      b.className = "swatch";
      b.title = c.name;
      b.dataset.name = c.name;
      b.innerHTML = `<span class="chip" style="background:${c.hex}"></span><span class="label"></span>`;
      b.querySelector(".label").textContent = c.name.replace(/^Colorbond /, "");
      b.addEventListener("click", () => {
        colour = c;
        // The same colour can appear in more than one group; mark them all.
        swatchBox.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.name === c.name));
        $("selectedName").textContent = c.name;
        // Hide the blue highlight so the colour can be seen.
        $("showMask").checked = false;
        scheduleRecompute();
      });
      swatchBox.appendChild(b);
    });
  });
})();
