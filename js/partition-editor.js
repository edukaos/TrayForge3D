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
    const container = document.querySelector('.viewport-container') || document.getElementById('viewport-2d');
    const rect = container ? container.getBoundingClientRect() : null;
    const dpr = window.devicePixelRatio || 1;

    const containerW = (rect && rect.width > 50) ? rect.width : (window.innerWidth - 330);
    const containerH = (rect && rect.height > 50) ? rect.height : (window.innerHeight - 56);

    const maxW = Math.max(300, Math.min(containerW - 80, 720));
    const maxH = Math.max(300, Math.min(containerH - 120, 680));

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
    // 0. Check if clicking an interactive dimension badge
    for (const b of this.dimBadges) {
      if (pos.x >= b.x && pos.y >= b.y && pos.x <= b.x + b.w && pos.y <= b.y + b.h) {
        const axisLabel = b.dimension === 'width' ? 'Ancho Interior útil (X)' : 'Largo/Alto Interior útil (Y)';
        const valStr = prompt(`Ingresa el nuevo ${axisLabel} en mm (luz libre para objetos):`, b.val.toFixed(1));
        if (valStr !== null) {
          const parsed = parseFloat(valStr);
          if (!isNaN(parsed) && parsed > 0) {
            this.state.setCellDimension(b.cellId, b.dimension, parsed);
          }
        }
        return;
      }
    }

    // 1. Check if clicking an action button (+ or trash)
    for (const btn of this.actionButtons) {
      const dist = Math.hypot(pos.x - btn.x, pos.y - btn.y);
      if (dist <= btn.radius + 4) {
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

    // 2. Check if starting divider drag or selection
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
    const padding = 65;
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

    const isDark = document.body.classList.contains('theme-dark');

    // 1. Draw outer tray body shadow & rounded rect
    ctx.save();
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.09)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;

    ctx.fillStyle = isDark ? '#1c202a' : '#ffffff';
    ctx.strokeStyle = isDark ? '#373f50' : '#d7dbe2';
    ctx.lineWidth = 1.5;

    const rOuter = Math.min(fillet * this.scale, Math.min(trayPixelW, trayPixelH) / 4);
    this.drawRoundedRect(ctx, trayX, trayY, trayPixelW, trayPixelH, rOuter);
    ctx.fill();
    ctx.restore();

    ctx.stroke();

    // 2. Draw wall thickness border area (inner cavity background)
    ctx.save();
    ctx.fillStyle = isDark ? '#13151c' : '#f0f2f6';
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
        grad.addColorStop(0, isDark ? '#232836' : '#ffffff');
        grad.addColorStop(1, isDark ? '#1c202c' : '#f8fbff');
      } else {
        grad.addColorStop(0, isDark ? '#1c202a' : '#fdfdfd');
        grad.addColorStop(1, isDark ? '#161922' : '#f4f5f8');
      }

      ctx.fillStyle = grad;
      const cellCornerR = Math.min(4, Math.min(cw, ch) / 6);
      this.drawRoundedRect(ctx, cx + 1, cy + 1, cw - 2, ch - 2, cellCornerR);
      ctx.fill();

      // Subtle inner shadow for 3D depth perception
      ctx.strokeStyle = isSelected ? '#3b82f6' : (isDark ? '#2c3344' : '#e2e6ed');
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.stroke();
      ctx.restore();

      // If active cell, show interactive buttons and dimensions
      if (isSelected) {
        this.renderCellControls(cell, cx, cy, cw, ch);
      } else {
        // Subtle dimension label
        ctx.fillStyle = isDark ? '#828a9b' : '#9aa1b0';
        ctx.font = '500 11px system-ui, sans-serif';
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
      ctx.fillStyle = (isDivHovered || isDivDragging) ? '#3b82f6' : (isDark ? '#272c3a' : '#ffffff');
      ctx.strokeStyle = (isDivHovered || isDivDragging) ? '#60a5fa' : (isDark ? '#3d4557' : '#d2d6df');
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
      ctx.fillStyle = (isDivHovered || isDivDragging) ? '#3b82f6' : (isDark ? 'rgba(40, 46, 60, 0.95)' : 'rgba(30, 32, 37, 0.85)');
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      this.drawRoundedRect(ctx, midX - pillW / 2, midY - pillH / 2, pillW, pillH, 10);
      ctx.fill();

      // Grip icon / arrows
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px system-ui, sans-serif';
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
      ctx.fillStyle = '#1e2025';
      ctx.beginPath();
      ctx.arc(hx, hy, 11, 0, Math.PI * 2);
      ctx.fill();

      // Plus sign
      ctx.strokeStyle = '#ffffff';
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

    // Dimension badges (Bento3D style: blue pill tags with arrows)
    this.drawDimBadge(cx + cw / 2, cy - 2, `↔ Int: ${cell.w.toFixed(1)} mm`, 'h', '#2563eb', 'width', cell.id, cell.w);
    this.drawDimBadge(cx - 2, cy + ch / 2, `↕ Int: ${cell.h.toFixed(1)} mm`, 'v', '#2563eb', 'height', cell.id, cell.h);

    // Action buttons inside the cell:
    // 1. Split vertically button (+) on right border
    const btnV_x = cx + cw;
    const btnV_y = cy + ch / 2;
    this.drawCircleBtn(btnV_x, btnV_y, 11, '+', 'split_v', cell.id);

    // 2. Split horizontally button (+) on bottom border
    const btnH_x = cx + cw / 2;
    const btnH_y = cy + ch;
    this.drawCircleBtn(btnH_x, btnH_y, 11, '+', 'split_h', cell.id);

    // 3. Delete / Merge button (Trash) in center if more than 1 cell
    if (this.state.state.partitionTree.type === 'split') {
      const btnTrash_x = cx + cw / 2;
      const btnTrash_y = cy + ch / 2;
      this.drawTrashBtn(btnTrash_x, btnTrash_y, 13, cell.id);
    }
  }

  drawDimBadge(x, y, text, orientation, color, dimension, cellId, val) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '700 11px system-ui, sans-serif';
    const textWidth = ctx.measureText(text).width;
    const badgeW = textWidth + 18;
    const badgeH = 20;

    let bx = x;
    let by = y;

    if (orientation === 'h') {
      bx = x - badgeW / 2;
      by = y - badgeH - 5;
    } else {
      bx = x - badgeW - 7;
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

    ctx.fillStyle = color;
    this.drawRoundedRect(ctx, bx, by, badgeW, badgeH, 5);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 1;
    this.drawRoundedRect(ctx, bx, by, badgeW, badgeH, 5);
    ctx.stroke();

    // Arrows and text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText(`${text}`, bx + badgeW / 2, by + badgeH / 2);
    ctx.restore();
  }

  drawCircleBtn(x, y, radius, text, actionType, cellId) {
    const { ctx } = this;
    this.actionButtons.push({ type: actionType, x, y, radius, cellId });

    ctx.save();
    ctx.fillStyle = '#1e2025';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // White plus sign
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 4.5, y);
    ctx.lineTo(x + 4.5, y);
    ctx.moveTo(x, y - 4.5);
    ctx.lineTo(x, y + 4.5);
    ctx.stroke();
    ctx.restore();
  }

  drawTrashBtn(x, y, radius, cellId) {
    const { ctx } = this;
    this.actionButtons.push({ type: 'delete', x, y, radius, cellId });

    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw trash icon
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 4, y - 3, 8, 8);
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 3);
    ctx.lineTo(x + 6, y - 3);
    ctx.moveTo(x - 2, y - 5);
    ctx.lineTo(x + 2, y - 5);
    ctx.stroke();
    ctx.restore();
  }

  renderOuterDimensions(tx, ty, tw, th, w, d) {
    const { ctx } = this;
    const isDark = document.body.classList.contains('theme-dark');
    ctx.save();
    ctx.strokeStyle = isDark ? '#373d4c' : '#c5cbda';
    ctx.fillStyle = isDark ? '#9aa1b2' : '#646a78';
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

    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b';
    ctx.fillText(`Exterior Total: ${w} mm (Ancho)`, tx + tw / 2, botY + 16);

    ctx.font = '500 10.5px system-ui, sans-serif';
    ctx.fillStyle = isDark ? '#818ca2' : '#64748b';
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
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b';
    ctx.fillText(`Exterior Total: ${d} mm (Profundidad)`, 0, 0);

    ctx.font = '500 10.5px system-ui, sans-serif';
    ctx.fillStyle = isDark ? '#818ca2' : '#64748b';
    ctx.fillText(`[Espacio interior libre total: ${innerD} mm]`, 0, 15);
    ctx.restore();

    // Top-left Canvas Legend for interior vs exterior clarity
    ctx.textAlign = 'left';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = isDark ? 'rgba(37, 99, 235, 0.22)' : 'rgba(37, 99, 235, 0.12)';
    this.drawRoundedRect(ctx, 12, 12, 340, 26, 6);
    ctx.fill();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = isDark ? '#93c5fd' : '#1d4ed8';
    ctx.fillText(`🟦 Azul = Medida INTERIOR libre (para tus objetos)`, 22, 25);

    ctx.restore();
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
