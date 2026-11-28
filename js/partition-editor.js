/**
 * partition-editor.js - Interactive 2D Canvas for Bento3D Grid Partitioning
 */

class PartitionEditor {
  constructor(canvasElement, state) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.state = state;

    // View transform & layout
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Interactive state
    this.hoveredCell = null;
    this.selectedCell = null;
    this.hoveredDivider = null;
    this.draggingDivider = null;
    this.dragStartPos = 0;
    this.dragStartRatio = 0.5;

    // Interactive buttons (computed per frame)
    // { type: 'split_v' | 'split_h' | 'delete', x, y, radius, cellId }
    this.actionButtons = [];
    this.dimBadges = [];
    this.onCellSelect = null;

    this.initEvents();
    this.resizeCanvas();

    // Subscribe to state changes
    this.state.subscribe(() => {
      this.render();
    });

    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });
  }

  resizeCanvas() {
    const container = document.querySelector('.canvas-stage') || document.getElementById('viewport-2d');
    const rect = container ? container.getBoundingClientRect() : null;
    const dpr = window.devicePixelRatio || 1;

    const containerW = (rect && rect.width > 50) ? rect.width : (window.innerWidth - 330);
    const containerH = (rect && rect.height > 50) ? rect.height : (window.innerHeight - 56);

    const maxW = Math.max(280, Math.min(containerW - 24, 760));
    const maxH = Math.max(280, Math.min(containerH - 90, 700)); // deja sitio a la barra de instrucciones

    const { width, depth } = this.state.state;
    const aspect = (width || 100) / (depth || 100);

    let displayWidth = maxW;
    let displayHeight = maxW / aspect;

    if (displayHeight > maxH) {
      displayHeight = maxH;
      displayWidth = maxH * aspect;
    }

    displayWidth = Math.round(Math.max(280, displayWidth));
    displayHeight = Math.round(Math.max(280, displayHeight));

    this.canvas.width = displayWidth * dpr;
    this.canvas.height = displayHeight * dpr;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
  }

  initEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    this.canvas.addEventListener('mousemove', (e) => {
      const pos = getPos(e);
      this.handleMouseMove(pos);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      const pos = getPos(e);
      this.handleMouseDown(pos);
    });

    window.addEventListener('mouseup', () => {
      if (this.draggingDivider) {
        this.draggingDivider = null;
        this.state.pushHistory(); // Commit drag to history
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredCell = null;
      this.hoveredDivider = null;
      this.actionButtons = [];
      this.canvas.style.cursor = 'default';
      this.render();
    });
  }

  handleMouseMove(pos) {
    if (this.draggingDivider) {
      // Handle divider dragging
      const div = this.draggingDivider;
      const b = div.parentBounds;
      const wt = this.state.state.wallThickness;

      if (div.dir === 'v') {
        const availableW = b.rw - wt;
        const currentInnerX = (pos.x - this.offsetX) / this.scale - b.rx - wt / 2;
        const ratio = Math.max(0.1, Math.min(0.9, currentInnerX / availableW));
        this.state.updateSplitRatio(div.id, ratio, false);
      } else {
        const availableH = b.rh - wt;
        const currentInnerY = (pos.y - this.offsetY) / this.scale - b.ry - wt / 2;
        const ratio = Math.max(0.1, Math.min(0.9, currentInnerY / availableH));
        this.state.updateSplitRatio(div.id, ratio, false);
      }
      this.canvas.style.cursor = div.dir === 'v' ? 'col-resize' : 'row-resize';
      this.render();
      return;
    }

    // Check action buttons hover
    let hoveredBtn = null;
    for (const btn of this.actionButtons) {
      const dist = Math.hypot(pos.x - btn.x, pos.y - btn.y);
      if (dist <= btn.radius + 4) {
        hoveredBtn = btn;
        break;
      }
    }

    if (hoveredBtn) {
      this.canvas.style.cursor = 'pointer';
      return;
    }

    // Check divider hover with generous hit area
    const layout = this.state.computeLayout();
    const mx = (pos.x - this.offsetX) / this.scale;
    const my = (pos.y - this.offsetY) / this.scale;

    let foundDiv = null;
    const hitTolerance = Math.max(16 / this.scale, 6);

    for (const div of layout.dividers) {
      if (
        mx >= div.x - hitTolerance &&
        mx <= div.x + div.w + hitTolerance &&
        my >= div.y - hitTolerance &&
        my <= div.y + div.h + hitTolerance
      ) {
        foundDiv = div;
        break;
      }
    }

    this.hoveredDivider = foundDiv;
    if (foundDiv) {
      this.canvas.style.cursor = foundDiv.dir === 'v' ? 'col-resize' : 'row-resize';
      this.hoveredCell = null;
      this.render();
      return;
    }

    // Check compartment cell hover
    let foundCell = null;
    for (const cell of layout.cells) {
      if (
        mx >= cell.x &&
        mx <= cell.x + cell.w &&
        my >= cell.y &&
        my <= cell.y + cell.h
      ) {
        foundCell = cell;
        break;
      }
    }

    this.hoveredCell = foundCell;
    this.canvas.style.cursor = foundCell ? 'pointer' : 'default';
    this.render();
  }

  handleMouseDown(pos) {
    // 1. FIRST PRIORITY: Action buttons (+ or trash) ALWAYS take precedence
    for (const btn of this.actionButtons) {
      const dist = Math.hypot(pos.x - btn.x, pos.y - btn.y);
      if (dist <= btn.radius + 6) {
        if (btn.type === 'split_v') {
          this.state.splitCompartment(btn.cellId, 'v');
        } else if (btn.type === 'split_h') {
          this.state.splitCompartment(btn.cellId, 'h');
        } else if (btn.type === 'delete') {
          this.state.deleteCompartment(btn.cellId);
        }
        return;
      }
    }

    // 2. SECOND PRIORITY: Check if clicking an interactive dimension badge
    for (const b of this.dimBadges) {
      if (pos.x >= b.x && pos.y >= b.y && pos.x <= b.x + b.w && pos.y <= b.y + b.h) {
        if (b.dimension === 'both') {
          const wStr = prompt('Ingresa el nuevo Ancho Interior útil (X) en mm (luz libre):', b.val.w.toFixed(1));
          if (wStr !== null) {
            const parsedW = parseFloat(wStr);
            if (!isNaN(parsedW) && parsedW > 0) {
              this.state.setCellDimension(b.cellId, 'width', parsedW);
            }
          }
        } else {
          const axisLabel = b.dimension === 'width' ? 'Ancho Interior útil (X)' : 'Largo/Alto Interior útil (Y)';
          const valStr = prompt(`Ingresa el nuevo ${axisLabel} en mm (luz libre para objetos):`, b.val.toFixed(1));
          if (valStr !== null) {
            const parsed = parseFloat(valStr);
            if (!isNaN(parsed) && parsed > 0) {
              this.state.setCellDimension(b.cellId, b.dimension, parsed);
            }
          }
        }
        return;
      }
    }

    // 3. Check if starting divider drag or selection
    if (this.hoveredDivider) {
      this.draggingDivider = this.hoveredDivider;
      this.selectedDivider = this.hoveredDivider;
      this.render();
      return;
    }

    // 3. Select compartment
    if (this.hoveredCell) {
      this.selectedCell = this.hoveredCell;
      this.selectedDivider = null;
      if (this.onCellSelect) this.onCellSelect(this.selectedCell);
      this.render();
    } else {
      this.selectedCell = null;
      if (this.onCellSelect) this.onCellSelect(null);
      this.render();
    }
  }

  /* ========================================================================
     RENDERING
     ======================================================================== */
  render() {
    const { ctx, displayWidth, displayHeight } = this;
    if (!ctx || !displayWidth) return;

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const { width, depth, wallThickness, fillet } = this.state.state;
    const layout = this.state.computeLayout();

    // Calculate scale to fit canvas with padding for measurements
    const padding = displayWidth < 440 ? 60 : 80; // espacio para las cotas exteriores
    const availW = displayWidth - padding * 2;
    const availH = displayHeight - padding * 2;
    this.scale = Math.min(availW / width, availH / depth);

    // Center tray in canvas
    const trayPixelW = width * this.scale;
    const trayPixelH = depth * this.scale;
    const trayX = (displayWidth - trayPixelW) / 2;
    const trayY = (displayHeight - trayPixelH) / 2;

    this.offsetX = trayX + wallThickness * this.scale;
    this.offsetY = trayY + wallThickness * this.scale;

    this.actionButtons = [];
    this.dimBadges = [];

    // Ensure there is always an active selected cell to inspect
    if (!this.selectedCell && layout.cells.length > 0) {
      this.selectedCell = layout.cells[0];
      if (this.onCellSelect) this.onCellSelect(this.selectedCell);
    } else if (this.selectedCell) {
      const still = layout.cells.find(c => c.id === this.selectedCell.id);
      if (still) {
        this.selectedCell = still;
      } else if (layout.cells.length > 0) {
        this.selectedCell = layout.cells[0];
        if (this.onCellSelect) this.onCellSelect(this.selectedCell);
      }
    }

    const pal = this.palette();

    // 1. Draw outer tray body shadow & rounded rect
    ctx.save();
    ctx.shadowColor = pal.trayShadow;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;

    ctx.fillStyle = pal.trayFill;
    ctx.strokeStyle = pal.trayStroke;
    ctx.lineWidth = 1.5;

    const rOuter = Math.min(fillet * this.scale, Math.min(trayPixelW, trayPixelH) / 4);
    this.drawRoundedRect(ctx, trayX, trayY, trayPixelW, trayPixelH, rOuter);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = pal.trayStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. Draw wall thickness border area (inner cavity background)
    ctx.save();
    ctx.fillStyle = pal.innerFill;
    const innerPixelW = layout.innerW * this.scale;
    const innerPixelH = layout.innerH * this.scale;
    const rInner = Math.max(0, rOuter - wallThickness * this.scale);
    this.drawRoundedRect(ctx, this.offsetX, this.offsetY, innerPixelW, innerPixelH, rInner);
    ctx.fill();
    ctx.restore();

    // 3. Draw Compartments (Cells)
    const activeCellId = this.selectedCell ? this.selectedCell.id : (this.hoveredCell ? this.hoveredCell.id : (layout.cells[0]?.id));

    layout.cells.forEach(cell => {
      const cx = this.offsetX + cell.x * this.scale;
      const cy = this.offsetY + cell.y * this.scale;
      const cw = cell.w * this.scale;
      const ch = cell.h * this.scale;

      const isHovered = this.hoveredCell && this.hoveredCell.id === cell.id;
      const isSelected = activeCellId === cell.id;

      // Cell cavity gradient
      ctx.save();
      const grad = ctx.createLinearGradient(cx, cy, cx, cy + ch);
      if (isSelected) {
        grad.addColorStop(0, pal.cellSelA);
        grad.addColorStop(1, pal.cellSelB);
      } else {
        grad.addColorStop(0, pal.cellA);
        grad.addColorStop(1, pal.cellB);
      }

      ctx.fillStyle = grad;
      const cellCornerR = Math.min(4, Math.min(cw, ch) / 6);
      this.drawRoundedRect(ctx, cx + 1, cy + 1, cw - 2, ch - 2, cellCornerR);
      ctx.fill();

      // Subtle inner shadow for 3D depth perception
      ctx.strokeStyle = isSelected ? pal.selStroke : pal.cellStroke;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();
      ctx.restore();

      // If active cell, show interactive buttons and dimensions
      if (isSelected) {
        this.renderCellControls(cell, cx, cy, cw, ch);
      } else {
        // Subtle dimension label
        ctx.fillStyle = pal.cellText;
        ctx.font = '500 11px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Int: ${cell.w.toFixed(1)} × ${cell.h.toFixed(1)} mm`, cx + cw / 2, cy + ch / 2);
      }
    });

    // 4. Draw Dividers
    layout.dividers.forEach(div => {
      const dx = this.offsetX + div.x * this.scale;
      const dy = this.offsetY + div.y * this.scale;
      const dw = div.w * this.scale;
      const dh = div.h * this.scale;

      const isDivHovered = this.hoveredDivider && this.hoveredDivider.id === div.id;
      const isDivDragging = this.draggingDivider && this.draggingDivider.id === div.id;

      ctx.save();
      ctx.fillStyle = (isDivHovered || isDivDragging) ? pal.accent : pal.divFill;
      ctx.strokeStyle = (isDivHovered || isDivDragging) ? pal.accent : pal.divStroke;
      ctx.lineWidth = (isDivHovered || isDivDragging) ? 2 : 1;
      ctx.fillRect(dx, dy, dw, dh);
      ctx.strokeRect(dx, dy, dw, dh);
      ctx.restore();

      // Draw prominent center drag handle pill when hovered, dragging, or nearby
      const midX = dx + dw / 2;
      const midY = dy + dh / 2;

      ctx.save();
      const pillW = div.dir === 'v' ? 36 : 46;
      const pillH = div.dir === 'v' ? 22 : 18;
      ctx.fillStyle = (isDivHovered || isDivDragging) ? pal.accent : pal.pill;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      this.drawRoundedRect(ctx, midX - pillW / 2, midY - pillH / 2, pillW, pillH, 10);
      ctx.fill();

      // Grip icon / arrows
      ctx.fillStyle = (isDivHovered || isDivDragging) ? pal.onAccent : pal.pillText;
      ctx.font = '700 10px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0;
      ctx.fillText(div.dir === 'v' ? '◀ ❘ ▶' : '▲ ━ ▼', midX, midY);
      ctx.restore();
    });

    // 5. Draw Divider Split Handles (+) on division borders
    this.renderDividerSplitHandles(layout);

    // 6. Draw Overall Tray Dimensions (mm)
    this.renderOuterDimensions(trayX, trayY, trayPixelW, trayPixelH, width, depth);
  }

  // Draw circular split handles (+) like Bento3D
  renderDividerSplitHandles(layout) {
    const { ctx } = this;
    const pal = this.palette();
    layout.dividers.forEach(div => {
      const dx = this.offsetX + div.x * this.scale;
      const dy = this.offsetY + div.y * this.scale;
      const dw = div.w * this.scale;
      const dh = div.h * this.scale;

      // Handle at divider midpoint
      let hx, hy;
      if (div.dir === 'v') {
        hx = dx + dw / 2;
        hy = dy + dh;
      } else {
        hx = dx + dw;
        hy = dy + dh / 2;
      }

      // Draw circular handle
      ctx.save();
      ctx.fillStyle = pal.handle;
      ctx.beginPath();
      ctx.arc(hx, hy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pal.divStroke;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Plus sign
      ctx.strokeStyle = pal.handlePlus;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - 4, hy);
      ctx.lineTo(hx + 4, hy);
      ctx.moveTo(hx, hy - 4);
      ctx.lineTo(hx, hy + 4);
      ctx.stroke();
      ctx.restore();
    });
  }

  // Draw dimension indicators & action buttons for active compartment
  renderCellControls(cell, cx, cy, cw, ch) {
    const { ctx } = this;
    const btnRadius = Math.max(9, Math.min(12, Math.min(cw, ch) / 4.5));

    // Dimension badges placed strictly INSIDE the cell to prevent overlapping with neighbors, borders or dividers:
    if (cw >= 130 && ch >= 75) {
      // Spacious cell: separate width badge (top) and height badge (left)
      this.drawDimBadge(cx + cw / 2, cy + 5, `↔ Int: ${cell.w.toFixed(1)} mm`, 'inside_top', null, 'width', cell.id, cell.w);
      this.drawDimBadge(cx + 6, cy + ch / 2, `↕ Int: ${cell.h.toFixed(1)} mm`, 'inside_left', null, 'height', cell.id, cell.h);
    } else if (cw >= 75 && ch >= 45) {
      // Compact cell: single unified badge centered at top inside
      this.drawDimBadge(cx + cw / 2, cy + 4, `↔ ${cell.w.toFixed(0)} · ↕ ${cell.h.toFixed(0)} mm`, 'inside_top', null, 'both', cell.id, { w: cell.w, h: cell.h });
    }
    // Note: If cell is very small (<75px wide or <45px high), we omit the badge inside the canvas to keep
    // the + and trash buttons unobstructed. The sidebar already displays and edits the exact mm.

    // Action buttons positioned safely INSIDE the cell:
    // 1. Split vertically (+) inside right edge
    const btnV_x = cx + cw - btnRadius - 5;
    const btnV_y = cy + ch / 2;
    this.drawCircleBtn(btnV_x, btnV_y, btnRadius, '+', 'split_v', cell.id);

    // 2. Split horizontally (+) inside bottom edge
    const btnH_x = cx + cw / 2;
    const btnH_y = cy + ch - btnRadius - 5;
    this.drawCircleBtn(btnH_x, btnH_y, btnRadius, '+', 'split_h', cell.id);

    // 3. Delete / Merge button (Trash) in center if more than 1 cell
    if (this.state.state.partitionTree.type === 'split') {
      const btnTrash_x = cx + cw / 2;
      const btnTrash_y = cy + ch / 2;
      const trashRadius = Math.max(9, Math.min(13, btnRadius + 1));
      this.drawTrashBtn(btnTrash_x, btnTrash_y, trashRadius, cell.id);
    }
  }

  drawDimBadge(x, y, text, orientation, color, dimension, cellId, val) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const textWidth = ctx.measureText(text).width;
    const badgeW = textWidth + 16;
    const badgeH = 19;

    let bx = x;
    let by = y;

    if (orientation === 'inside_top' || orientation === 'h') {
      bx = x - badgeW / 2;
      by = y;
    } else if (orientation === 'inside_left' || orientation === 'v') {
      bx = x;
      by = y - badgeH / 2;
    } else {
      bx = x - badgeW / 2;
      by = y - badgeH / 2;
    }

    if (dimension && cellId) {
      this.dimBadges.push({
        x: bx,
        y: by,
        w: badgeW,
        h: badgeH,
        dimension,
        cellId,
        val
      });
    }

    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    const pal = this.palette();
    ctx.fillStyle = color || pal.accent;
    this.drawRoundedRect(ctx, bx, by, badgeW, badgeH, 7);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = pal.badgeEdge;
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, bx, by, badgeW, badgeH, 7);
    ctx.stroke();

    // Arrows and text
    ctx.fillStyle = pal.onAccent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(`${text}`, bx + badgeW / 2, by + badgeH / 2);
    ctx.restore();
  }

  drawCircleBtn(x, y, radius, text, actionType, cellId) {
    const { ctx } = this;
    this.actionButtons.push({ type: actionType, x, y, radius, cellId });

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;

    // High visibility accent plus button
    const pal = this.palette();
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = pal.badgeEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Plus sign
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = pal.onAccent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    const s = Math.max(3.5, radius * 0.45);
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
    ctx.restore();
  }

  drawTrashBtn(x, y, radius, cellId) {
    const { ctx } = this;
    this.actionButtons.push({ type: 'delete', x, y, radius, cellId });

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1.5;

    ctx.fillStyle = this.palette().danger;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw white trash can icon
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    const r = Math.max(3.5, radius * 0.45);
    ctx.strokeRect(x - r + 1, y - r + 2, (r - 1) * 2, r * 2 - 1);
    ctx.beginPath();
    ctx.moveTo(x - r - 1, y - r + 2);
    ctx.lineTo(x + r + 1, y - r + 2);
    ctx.moveTo(x - 2, y - r);
    ctx.lineTo(x + 2, y - r);
    ctx.stroke();
    ctx.restore();
  }

  renderOuterDimensions(tx, ty, tw, th, w, d) {
    const { ctx } = this;
    const pal = this.palette();
    ctx.save();
    ctx.strokeStyle = pal.dimLine;
    ctx.fillStyle = pal.dimSub;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;

    const wt = this.state.state.wallThickness;
    const innerW = (w - 2 * wt).toFixed(1);
    const innerD = (d - 2 * wt).toFixed(1);

    // Bottom overall width
    const botY = ty + th + 35;
    ctx.beginPath();
    ctx.moveTo(tx, botY);
    ctx.lineTo(tx + tw, botY);
    ctx.moveTo(tx, botY - 5);
    ctx.lineTo(tx, botY + 5);
    ctx.moveTo(tx + tw, botY - 5);
    ctx.lineTo(tx + tw, botY + 5);
    ctx.stroke();

    ctx.font = '700 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = pal.dimText;
    ctx.fillText(`Exterior Total: ${w} mm (Ancho)`, tx + tw / 2, botY + 16);

    ctx.font = '500 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = pal.dimSub;
    ctx.fillText(`[Paredes: ${wt} mm c/u · Espacio interior libre total: ${innerW} mm]`, tx + tw / 2, botY + 31);

    // Left overall depth
    const leftX = tx - 35;
    ctx.beginPath();
    ctx.moveTo(leftX, ty);
    ctx.lineTo(leftX, ty + th);
    ctx.moveTo(leftX - 5, ty);
    ctx.lineTo(leftX + 5, ty);
    ctx.moveTo(leftX - 5, ty + th);
    ctx.lineTo(leftX + 5, ty + th);
    ctx.stroke();

    ctx.save();
    ctx.translate(leftX - 16, ty + th / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '700 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = pal.dimText;
    ctx.fillText(`Exterior Total: ${d} mm (Profundidad)`, 0, 0);

    ctx.font = '500 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = pal.dimSub;
    ctx.fillText(`[Espacio interior libre total: ${innerD} mm]`, 0, 15);
    ctx.restore();

    ctx.restore();
  }

  // Paleta del lienzo 2D (estilo Liquid Glass: navy + acento dorado)
  palette() {
    const isDark = document.body.classList.contains('theme-dark');
    const shared = { accent: '#F5C451', onAccent: '#1A1405', badgeEdge: 'rgba(255,255,255,0.55)' };
    return isDark ? {
      ...shared, isDark,
      trayShadow: 'rgba(0, 0, 0, 0.45)', trayFill: '#14223D', trayStroke: 'rgba(255, 255, 255, 0.14)',
      innerFill: '#0C172B',
      cellA: '#17264A', cellB: '#13203D', cellSelA: '#1E3058', cellSelB: '#192A4C',
      cellStroke: 'rgba(255, 255, 255, 0.08)', selStroke: '#F5C451', cellText: 'rgba(232, 238, 248, 0.62)',
      divFill: '#24365A', divStroke: 'rgba(255, 255, 255, 0.18)',
      pill: 'rgba(16, 26, 46, 0.92)', pillText: '#F3F6FB',
      handle: '#24365A', handlePlus: '#F3F6FB',
      danger: '#FF6B5E',
      dimLine: 'rgba(255, 255, 255, 0.22)', dimText: '#F3F6FB', dimSub: 'rgba(232, 238, 248, 0.62)'
    } : {
      ...shared, isDark,
      trayShadow: 'rgba(30, 50, 90, 0.14)', trayFill: '#FFFFFF', trayStroke: 'rgba(11, 20, 36, 0.12)',
      innerFill: '#EEF2F8',
      cellA: '#FFFFFF', cellB: '#F6F8FC', cellSelA: '#FFFFFF', cellSelB: '#FFF8E6',
      cellStroke: 'rgba(11, 20, 36, 0.08)', selStroke: '#D9A21E', cellText: 'rgba(11, 20, 36, 0.55)',
      divFill: '#DCE3EE', divStroke: 'rgba(11, 20, 36, 0.14)',
      pill: 'rgba(11, 20, 36, 0.82)', pillText: '#FFFFFF',
      handle: '#0B1424', handlePlus: '#FFFFFF',
      danger: '#D93025',
      dimLine: 'rgba(11, 20, 36, 0.22)', dimText: '#0B1424', dimSub: 'rgba(11, 20, 36, 0.6)'
    };
  }

  drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
