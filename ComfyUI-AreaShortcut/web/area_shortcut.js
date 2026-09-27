import { app } from "../../scripts/app.js";

const TYPE = "AreaShortcut";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const ASPECT = 16 / 9;
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;
const HANDLE_HIT_RADIUS = 12;

// Only one region-set session can be active at a time, across all nodes.
let activeCapture = null;

// Given a raw drag delta, derive a 16:9-locked delta -- whichever axis is
// "driving" the drag (adjusted for aspect) determines the other axis. Works
// the same whether dx/dy are screen pixels or world units, since aspect is
// scale-invariant.
function lockTo169(dx, dy) {
    if (Math.abs(dx) / ASPECT >= Math.abs(dy)) {
        const w = dx;
        const h = (Math.sign(dy) || 1) * (Math.abs(dx) / ASPECT);
        return { w, h };
    } else {
        const h = dy;
        const w = (Math.sign(dx) || 1) * (Math.abs(dy) * ASPECT);
        return { w, h };
    }
}

function cornerWorld(region, key) {
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    switch (key) {
        case "tl": return { x: region.x, y: region.y };
        case "tr": return { x: right, y: region.y };
        case "bl": return { x: region.x, y: bottom };
        case "br": return { x: right, y: bottom };
    }
}

function getKeyWidget(node) {
    return node.widgets?.find((w) => w.name === "shortcut_key");
}

function updateButtonLabel(node) {
    if (!node.regionButton) return;
    const key = getKeyWidget(node)?.value;
    if (key === "0") {
        node.regionButton.name = "Whole canvas";
        return;
    }
    const has = node.properties?.regions?.[key];
    node.regionButton.name = has ? "Redraw Region" : "Set Region";
}

function makeToolbar() {
    const bar = document.createElement("div");
    Object.assign(bar.style, {
        position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: "6px", padding: "6px", background: "rgba(30,30,30,0.92)",
        border: "1px solid #555", borderRadius: "8px", zIndex: "10000",
        fontFamily: "sans-serif", fontSize: "13px",
    });
    document.body.appendChild(bar);
    return bar;
}

function makeButton(bar, label, extraStyle) {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
        padding: "6px 14px", borderRadius: "6px", border: "1px solid #666",
        background: "#3a3a3a", color: "#eee", cursor: "pointer",
    }, extraStyle || {});
    bar.appendChild(btn);
    return btn;
}

function setActive(buttons, activeBtn) {
    for (const b of Object.values(buttons)) {
        const isActive = b === activeBtn;
        b.style.background = isActive ? "#ffcc00" : "#3a3a3a";
        b.style.color = isActive ? "#000" : "#eee";
    }
}

function makeOverlay() {
    const el = document.createElement("div");
    Object.assign(el.style, {
        position: "fixed", left: "0px", top: "0px", width: "100vw", height: "100vh",
        zIndex: "9999", cursor: "grab",
    });
    document.body.appendChild(el);
    return el;
}

function makeRectPreview() {
    const el = document.createElement("div");
    Object.assign(el.style, {
        position: "fixed", border: "2px dashed #ffcc00", background: "rgba(255, 204, 0, 0.15)",
        boxSizing: "border-box", pointerEvents: "none", zIndex: "10001", display: "none",
    });
    document.body.appendChild(el);
    return el;
}

function makeHandle(cursor) {
    const el = document.createElement("div");
    Object.assign(el.style, {
        position: "fixed", width: "10px", height: "10px", marginLeft: "-5px", marginTop: "-5px",
        background: "#ffcc00", border: "1px solid #000", borderRadius: "2px",
        pointerEvents: "none", zIndex: "10002", display: "none", cursor,
    });
    document.body.appendChild(el);
    return el;
}

function startCapture(node) {
    const canvas = app.canvas;
    const canvasEl = canvas?.canvas;
    if (!canvas || !canvasEl) return;

    const keyWidget = getKeyWidget(node);
    const key = keyWidget?.value;
    if (!key) return;

    if (activeCapture) activeCapture.cancel();

    const overlay = makeOverlay();
    const rectPreview = makeRectPreview();
    const handles = {
        tl: makeHandle("nwse-resize"),
        tr: makeHandle("nesw-resize"),
        bl: makeHandle("nesw-resize"),
        br: makeHandle("nwse-resize"),
    };
    const toolbar = makeToolbar();
    const buttons = {
        pan: makeButton(toolbar, "Pan"),
        zoom: makeButton(toolbar, "Zoom"),
        draw: makeButton(toolbar, "Draw"),
    };
    const assignBtn = makeButton(toolbar, `Assign to ${key}`, { background: "#3d8b40", borderColor: "#2f6e31" });
    const cancelBtn = makeButton(toolbar, "Cancel");
    assignBtn.style.display = "none";

    let mode = "pan";
    setActive(buttons, buttons.pan);

    function setMode(next, btn) {
        mode = next;
        setActive(buttons, btn);
        overlay.style.cursor = next === "draw" ? "crosshair" : next === "zoom" ? "ns-resize" : "grab";
    }

    buttons.pan.onclick = () => setMode("pan", buttons.pan);
    buttons.zoom.onclick = () => setMode("zoom", buttons.zoom);
    buttons.draw.onclick = () => setMode("draw", buttons.draw);
    cancelBtn.onclick = () => finish();
    assignBtn.onclick = () => {
        if (draftRegion) {
            node.properties.regions[key] = { ...draftRegion };

            // Auto-advance to the next shortcut slot so the user can just
            // keep drawing + assigning without touching the dropdown. On
            // the last slot, leave it as-is and let the user pick manually.
            const idx = KEYS.indexOf(key);
            if (idx >= 0 && idx + 1 < KEYS.length) {
                keyWidget.value = KEYS[idx + 1];
            }
        }
        finish();
    };

    // The region being edited this session, in graph/world coordinates.
    // Preloaded from any previously saved region for this key so
    // "Redraw Region" lets you nudge/resize instead of starting over.
    let draftRegion = node.properties.regions[key] ? { ...node.properties.regions[key] } : null;

    let dragging = false;
    let interaction = null; // "creating" | "moving" | "resizing"
    let dragStart = null; // client coords at mousedown
    let moveStartRegion = null; // world-space snapshot, for "moving"
    let resizeAnchorWorld = null; // fixed opposite corner, for "resizing"
    let initialScale = null;
    let initialOffset = null;
    let zoomAnchorWorld = null;

    function screenToWorld(clientX, clientY) {
        const rect = canvasEl.getBoundingClientRect();
        return {
            x: (clientX - rect.left) / canvas.ds.scale - canvas.ds.offset[0],
            y: (clientY - rect.top) / canvas.ds.scale - canvas.ds.offset[1],
        };
    }

    function worldToScreen(wx, wy) {
        const rect = canvasEl.getBoundingClientRect();
        return {
            x: (wx + canvas.ds.offset[0]) * canvas.ds.scale + rect.left,
            y: (wy + canvas.ds.offset[1]) * canvas.ds.scale + rect.top,
        };
    }

    function onDown(e) {
        if (e.button !== 0) return; // left button only
        e.preventDefault();
        dragging = true;
        dragStart = { x: e.clientX, y: e.clientY };

        if (mode === "draw") {
            if (draftRegion) {
                const topLeft = worldToScreen(draftRegion.x, draftRegion.y);
                const w = draftRegion.width * canvas.ds.scale;
                const h = draftRegion.height * canvas.ds.scale;
                const corners = {
                    tl: { x: topLeft.x, y: topLeft.y },
                    tr: { x: topLeft.x + w, y: topLeft.y },
                    bl: { x: topLeft.x, y: topLeft.y + h },
                    br: { x: topLeft.x + w, y: topLeft.y + h },
                };
                const hit = Object.entries(corners).find(([, p]) =>
                    Math.hypot(e.clientX - p.x, e.clientY - p.y) <= HANDLE_HIT_RADIUS
                );
                if (hit) {
                    const [hkey] = hit;
                    const opposite = { tl: "br", tr: "bl", bl: "tr", br: "tl" }[hkey];
                    resizeAnchorWorld = cornerWorld(draftRegion, opposite);
                    interaction = "resizing";
                    return;
                }
                const inside = e.clientX >= topLeft.x && e.clientX <= topLeft.x + w &&
                               e.clientY >= topLeft.y && e.clientY <= topLeft.y + h;
                if (inside) {
                    interaction = "moving";
                    moveStartRegion = { ...draftRegion };
                    return;
                }
            }
            // Otherwise: start a fresh box, replacing any existing one.
            interaction = "creating";
            draftRegion = null;
        } else if (mode === "pan") {
            initialOffset = [canvas.ds.offset[0], canvas.ds.offset[1]];
            overlay.style.cursor = "grabbing";
        } else if (mode === "zoom") {
            initialScale = canvas.ds.scale;
            zoomAnchorWorld = screenToWorld(e.clientX, e.clientY);
        }
    }

    function onMove(e) {
        if (!dragging) return;
        e.preventDefault();

        if (mode === "draw") {
            if (interaction === "creating") {
                const dx = e.clientX - dragStart.x;
                const dy = e.clientY - dragStart.y;
                const { w, h } = lockTo169(dx, dy);
                const x0 = Math.min(dragStart.x, dragStart.x + w);
                const y0 = Math.min(dragStart.y, dragStart.y + h);
                const topLeftWorld = screenToWorld(x0, y0);
                draftRegion = {
                    x: topLeftWorld.x,
                    y: topLeftWorld.y,
                    width: Math.abs(w) / canvas.ds.scale,
                    height: Math.abs(h) / canvas.ds.scale,
                };
            } else if (interaction === "moving") {
                const dx = (e.clientX - dragStart.x) / canvas.ds.scale;
                const dy = (e.clientY - dragStart.y) / canvas.ds.scale;
                draftRegion = { ...moveStartRegion, x: moveStartRegion.x + dx, y: moveStartRegion.y + dy };
            } else if (interaction === "resizing") {
                const currentWorld = screenToWorld(e.clientX, e.clientY);
                const dx = currentWorld.x - resizeAnchorWorld.x;
                const dy = currentWorld.y - resizeAnchorWorld.y;
                const { w, h } = lockTo169(dx, dy);
                draftRegion = {
                    x: Math.min(resizeAnchorWorld.x, resizeAnchorWorld.x + w),
                    y: Math.min(resizeAnchorWorld.y, resizeAnchorWorld.y + h),
                    width: Math.abs(w),
                    height: Math.abs(h),
                };
            }
        } else if (mode === "pan") {
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            canvas.ds.offset[0] = initialOffset[0] + dx / canvas.ds.scale;
            canvas.ds.offset[1] = initialOffset[1] + dy / canvas.ds.scale;
            canvas.setDirty(true, true);
        } else if (mode === "zoom") {
            const rect = canvasEl.getBoundingClientRect();
            const dy = e.clientY - dragStart.y;
            let newScale = initialScale * Math.exp(-dy * 0.003);
            newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
            canvas.ds.scale = newScale;
            canvas.ds.offset[0] = (dragStart.x - rect.left) / newScale - zoomAnchorWorld.x;
            canvas.ds.offset[1] = (dragStart.y - rect.top) / newScale - zoomAnchorWorld.y;
            canvas.setDirty(true, true);
        }
    }

    function onUp(e) {
        if (!dragging) return;
        e.preventDefault();
        dragging = false;
        interaction = null;
        if (mode === "pan") overlay.style.cursor = "grab";
        // Draw-mode edits just stop here -- the box stays for further
        // editing until Assign or Cancel is clicked.
    }

    function onWheel(e) {
        e.preventDefault();
        const rect = canvasEl.getBoundingClientRect();
        const beforeWorld = screenToWorld(e.clientX, e.clientY);
        const factor = Math.exp(-e.deltaY * 0.001);
        let newScale = canvas.ds.scale * factor;
        newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
        canvas.ds.scale = newScale;
        canvas.ds.offset[0] = (e.clientX - rect.left) / newScale - beforeWorld.x;
        canvas.ds.offset[1] = (e.clientY - rect.top) / newScale - beforeWorld.y;
        canvas.setDirty(true, true);
    }

    function onKeyDown(e) {
        if (e.key === "Escape") finish();
    }

    let rafId = null;
    function renderLoop() {
        if (!activeCapture) return;

        assignBtn.style.display = draftRegion ? "inline-block" : "none";

        if (draftRegion) {
            const topLeft = worldToScreen(draftRegion.x, draftRegion.y);
            const w = draftRegion.width * canvas.ds.scale;
            const h = draftRegion.height * canvas.ds.scale;

            rectPreview.style.display = "block";
            rectPreview.style.left = `${topLeft.x}px`;
            rectPreview.style.top = `${topLeft.y}px`;
            rectPreview.style.width = `${w}px`;
            rectPreview.style.height = `${h}px`;

            const showHandles = mode === "draw";
            const pts = {
                tl: { x: topLeft.x, y: topLeft.y },
                tr: { x: topLeft.x + w, y: topLeft.y },
                bl: { x: topLeft.x, y: topLeft.y + h },
                br: { x: topLeft.x + w, y: topLeft.y + h },
            };
            for (const hkey of Object.keys(handles)) {
                handles[hkey].style.left = `${pts[hkey].x}px`;
                handles[hkey].style.top = `${pts[hkey].y}px`;
                handles[hkey].style.display = showHandles ? "block" : "none";
            }
        } else {
            rectPreview.style.display = "none";
            for (const h of Object.values(handles)) h.style.display = "none";
        }

        rafId = requestAnimationFrame(renderLoop);
    }

    function finish() {
        overlay.removeEventListener("mousedown", onDown);
        overlay.removeEventListener("wheel", onWheel);
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
        if (rafId) cancelAnimationFrame(rafId);
        overlay.remove();
        rectPreview.remove();
        for (const h of Object.values(handles)) h.remove();
        toolbar.remove();
        updateButtonLabel(node);
        activeCapture = null;
    }

    overlay.addEventListener("mousedown", onDown);
    overlay.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("keydown", onKeyDown, true);

    activeCapture = { cancel: finish };
    renderLoop();
}

function goToRegion(region) {
    const canvas = app.canvas;
    if (!canvas || !region) return;
    const rect = canvas.canvas.getBoundingClientRect();

    const scale = Math.min(rect.width / region.width, rect.height / region.height);
    canvas.ds.scale = scale;

    const centerX = region.x + region.width / 2;
    const centerY = region.y + region.height / 2;
    canvas.ds.offset[0] = rect.width / (2 * scale) - centerX;
    canvas.ds.offset[1] = rect.height / (2 * scale) - centerY;

    canvas.setDirty(true, true);
}

function fitWholeCanvas() {
    const canvas = app.canvas;
    const nodes = app.graph?._nodes;
    if (!canvas || !nodes?.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
        minX = Math.min(minX, n.pos[0]);
        minY = Math.min(minY, n.pos[1]);
        maxX = Math.max(maxX, n.pos[0] + n.size[0]);
        maxY = Math.max(maxY, n.pos[1] + n.size[1]);
    }
    if (!isFinite(minX)) return;

    const PAD = 60; // world-space padding around the bounds
    goToRegion({
        x: minX - PAD,
        y: minY - PAD,
        width: (maxX - minX) + PAD * 2,
        height: (maxY - minY) + PAD * 2,
    });
}

app.registerExtension({
    name: "areaShortcut.RegionZoom",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TYPE) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            if (!this.properties) this.properties = {};
            if (!this.properties.regions) this.properties.regions = {};
            for (const k of KEYS) {
                if (this.properties.regions[k] === undefined) this.properties.regions[k] = null;
            }

            this.regionButton = this.addWidget("button", "Set Region", null, () => {
                if (getKeyWidget(this)?.value === "0") return; // whole-canvas is automatic
                startCapture(this);
            });
            updateButtonLabel(this);

            const keyWidget = getKeyWidget(this);
            if (keyWidget) {
                const origCallback = keyWidget.callback;
                keyWidget.callback = (...args) => {
                    origCallback?.apply(keyWidget, args);
                    updateButtonLabel(this);
                };
            }
        };

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            onDrawForeground?.apply(this, arguments);
            if (this.flags?.collapsed) return;

            const keyWidget = getKeyWidget(this);
            if (!keyWidget) return;
            const regions = this.properties?.regions || {};

            const y = this.size[1] - 10;
            const slotWidth = this.size[0] / KEYS.length;

            ctx.save();
            ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "center";
            KEYS.forEach((k, i) => {
                const cx = slotWidth * (i + 0.5);
                if (k === keyWidget.value) {
                    ctx.fillStyle = "rgba(255,255,255,0.18)";
                    ctx.fillRect(cx - slotWidth / 2 + 2, y - 15, slotWidth - 4, 20);
                }
                const isSet = k === "0" ? true : !!regions[k];
                ctx.fillStyle = isSet ? "#ffcc00" : "#777";
                ctx.fillText(k, cx, y);
            });
            ctx.restore();
        };
    },

    async setup() {
        window.addEventListener("keydown", (e) => {
            if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
            if (activeCapture) return; // region-editing UI is open -- don't fire shortcuts

            const active = document.activeElement;
            if (
                active &&
                (active.tagName === "INPUT" ||
                    active.tagName === "TEXTAREA" ||
                    active.isContentEditable)
            ) {
                return;
            }

            if (!/^[0-9]$/.test(e.key)) return;

            if (e.key === "0") {
                fitWholeCanvas();
                e.preventDefault();
                return;
            }

            const nodes = app.graph._nodes.filter((n) => n.type === TYPE);
            for (const node of nodes) {
                const region = node.properties?.regions?.[e.key];
                if (region) {
                    goToRegion(region);
                    e.preventDefault();
                    break;
                }
            }
        });
    },
});
