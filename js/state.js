/**
 * state.js - Reactive state manager with Undo / Redo & BSP Partition Tree
 */

class AppState {
  constructor() {
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 40;
    this.listeners = new Set();

    // Default configuration (closely matches Bento3D defaults)
    this.data = {
      // Dimensions (mm)
      width: 100,
      depth: 100,
      height: 25,

      // Structural parameters (mm)
      wallThickness: 2.4,
      bottomThickness: 2.0,
      fillet: 3.0,
      partitionHeight: 20.0,

      // Features
      stackable: false,
      scoop: true,
      label: false,
      fingerPull: false,
      gripSides: false,

      // Active view tab: 'size' | 'grid' | 'preview'
      activeTab: 'preview',

      // Color preview
      meshColor: 0x0077ff,
      wireframe: false,

      // Partition tree: Root node
      // Type: 'leaf' | 'split'
      // Split node: { id, type: 'split', dir: 'v'|'h', ratio: 0.5, left: node, right: node }
      // Leaf node: { id, type: 'leaf' }
      // Partition tree: Root node (default asymmetric bento like reference)
      partitionTree: {
        id: 's_root',
        type: 'split',
        dir: 'v',
        ratio: 0.42,
        left: { id: 'c_left', type: 'leaf' },
        right: {
          id: 's_right',
          type: 'split',
          dir: 'h',
          ratio: 0.58,
          left: { id: 'c_top_right', type: 'leaf' },
          right: { id: 'c_bottom_right', type: 'leaf' }
        }
      }
    };

    // Save initial state to history
    this.pushHistory();
  }

  get state() {
    return this.data;
  }

  // Subscribe to changes
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(changedKeys = []) {
    this.listeners.forEach(fn => fn(this.data, changedKeys));
  }

  // Update properties with history record
  update(partial, saveToHistory = true) {
    let changed = [];
    for (const [k, v] of Object.entries(partial)) {
      if (this.data[k] !== v) {
        this.data[k] = v;
        changed.push(k);
      }
    }

    // Keep partitionHeight within bounds
    const maxPartitionH = Math.max(2, this.data.height - this.data.bottomThickness);
    if (this.data.partitionHeight > maxPartitionH) {
      this.data.partitionHeight = maxPartitionH;
    }

    if (saveToHistory && changed.length > 0) {
      this.pushHistory();
    }

    this.notify(changed);
  }

  // History Undo / Redo
  pushHistory() {
    // Truncate forward history if we were in the middle
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Deep clone data
    const snapshot = JSON.parse(JSON.stringify(this.data));
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
    this.notify(['history']);
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  undo() {
    if (!this.canUndo()) return;
    this.historyIndex--;
    this.data = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
    this.notify(['all']);
  }

  redo() {
    if (!this.canRedo()) return;
    this.historyIndex++;
    this.data = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
    this.notify(['all']);
  }

  /* ========================================================================
     PARTITION TREE OPERATIONS
     ======================================================================== */

  // Unique ID generator
  generateId(prefix = 'c') {
    return `${prefix}_${Math.random().toString(36).substr(2, 7)}`;
  }

  // Find leaf compartment by ID
  findNode(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    if (node.type === 'split') {
      return this.findNode(node.left, id) || this.findNode(node.right, id);
    }
    return null;
  }

  // Split a leaf compartment with optional custom ratio
  splitCompartment(compartmentId, direction = 'v', ratio = 0.5) {
    const splitRecursive = (node) => {
      if (!node) return null;
      if (node.id === compartmentId && node.type === 'leaf') {
        return {
          id: this.generateId('s'),
          type: 'split',
          dir: direction,
          ratio: Math.max(0.1, Math.min(0.9, ratio)),
          left: { id: this.generateId('c'), type: 'leaf' },
          right: { id: this.generateId('c'), type: 'leaf' }
        };
      }
      if (node.type === 'split') {
        return {
          ...node,
          left: splitRecursive(node.left),
          right: splitRecursive(node.right)
        };
      }
      return node;
    };

    this.data.partitionTree = splitRecursive(this.data.partitionTree);
    this.pushHistory();
    this.notify(['partitionTree']);
  }

  // Delete a compartment (merges with sibling)
  deleteCompartment(compartmentId) {
    // If root is a leaf, cannot delete the only cavity
    if (this.data.partitionTree.type === 'leaf') return;

    const deleteRecursive = (node) => {
      if (!node || node.type === 'leaf') return node;

      if (node.left.id === compartmentId) {
        return node.right;
      }
      if (node.right.id === compartmentId) {
        return node.left;
      }

      return {
        ...node,
        left: deleteRecursive(node.left),
        right: deleteRecursive(node.right)
      };
    };

    this.data.partitionTree = deleteRecursive(this.data.partitionTree);
    this.pushHistory();
    this.notify(['partitionTree']);
  }

  // Update ratio of a split node (e.g. dragging divider)
  updateSplitRatio(splitId, newRatio, isFinal = false) {
    const updateRecursive = (node) => {
      if (!node) return node;
      if (node.id === splitId && node.type === 'split') {
        return { ...node, ratio: Math.max(0.1, Math.min(0.9, newRatio)) };
      }
      if (node.type === 'split') {
        return {
          ...node,
          left: updateRecursive(node.left),
          right: updateRecursive(node.right)
        };
      }
      return node;
    };

    this.data.partitionTree = updateRecursive(this.data.partitionTree);
    if (isFinal) {
      this.pushHistory();
    }
    this.notify(['partitionTree']);
  }

  // Get structural info and ancestors for a specific compartment cell
  getCellInfo(cellId) {
    const layout = this.computeLayout();
    const cell = layout.cells.find(c => c.id === cellId);
    if (!cell) return null;

    const findPath = (node, path = []) => {
      if (!node) return null;
      if (node.id === cellId) return path;
      if (node.type === 'split') {
        const leftPath = findPath(node.left, [...path, { node, side: 'left' }]);
        if (leftPath) return leftPath;
        const rightPath = findPath(node.right, [...path, { node, side: 'right' }]);
        if (rightPath) return rightPath;
      }
      return null;
    };

    const path = findPath(this.data.partitionTree) || [];
    const vAncestor = [...path].reverse().find(step => step.node.dir === 'v');
    const hAncestor = [...path].reverse().find(step => step.node.dir === 'h');

    return {
      cell,
      vAncestor,
      hAncestor,
      innerW: layout.innerW,
      innerH: layout.innerH,
      cellsCount: layout.cells.length
    };
  }

  // Set exact interior useful dimension (mm) for a cell
  setCellDimension(cellId, dimension, targetValueMm) {
    const info = this.getCellInfo(cellId);
    if (!info) return false;

    const wt = this.data.wallThickness;
    const target = parseFloat(targetValueMm);
    if (isNaN(target) || target <= 0) return false;

    if (dimension === 'width') {
      if (!info.vAncestor) {
        // No vertical split divides this cell; its width is total innerW.
        const newTrayW = Math.max(30, Math.min(350, Math.round(target + 2 * wt)));
        this.update({ width: newTrayW });
        return true;
      }

      const { node, side } = info.vAncestor;
      const layout = this.computeLayout();
      const div = layout.dividers.find(d => d.id === node.id);
      if (!div) return false;

      const availableW = div.parentBounds.rw - wt;
      if (availableW <= 10) return false;

      let newRatio = (side === 'left') ? (target / availableW) : (1 - (target / availableW));
      newRatio = Math.max(0.05, Math.min(0.95, newRatio));

      this.updateSplitRatio(node.id, newRatio, true);
      return true;
    }

    if (dimension === 'height') {
      if (!info.hAncestor) {
        // No horizontal split divides this cell; its height is total innerH.
        const newTrayD = Math.max(30, Math.min(350, Math.round(target + 2 * wt)));
        this.update({ depth: newTrayD });
        return true;
      }

      const { node, side } = info.hAncestor;
      const layout = this.computeLayout();
      const div = layout.dividers.find(d => d.id === node.id);
      if (!div) return false;

      const availableH = div.parentBounds.rh - wt;
      if (availableH <= 10) return false;

      let newRatio = (side === 'left') ? (target / availableH) : (1 - (target / availableH));
      newRatio = Math.max(0.05, Math.min(0.95, newRatio));

      this.updateSplitRatio(node.id, newRatio, true);
      return true;
    }

    return false;
  }

  // Reset to single empty compartment
  resetGrid() {
    this.data.partitionTree = { id: 'c_root', type: 'leaf' };
    this.pushHistory();
    this.notify(['partitionTree']);
  }

  // Apply quick presets (including asymmetric configurations)
  applyPreset(presetKey) {
    const g = (p) => this.generateId(p);
    switch (presetKey) {
      case '1x1':
        this.data.partitionTree = { id: g('c'), type: 'leaf' };
        break;
      case '1x2':
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.5,
          left: { id: g('c'), type: 'leaf' },
          right: { id: g('c'), type: 'leaf' }
        };
        break;
      case '2x1':
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
          left: { id: g('c'), type: 'leaf' },
          right: { id: g('c'), type: 'leaf' }
        };
        break;
      case '2x2':
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.5,
          left: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          },
          right: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          }
        };
        break;
      // ASYMMETRIC PRESETS:
      case 'asym_bento': // Exactamente como la imagen: 1 grande lateral (40%), y 2 asimétricas (60%/40%) a la derecha
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.42,
          left: { id: g('c'), type: 'leaf' },
          right: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.58,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          }
        };
        break;
      case '1_3_2_3': // Asimétrico 1/3 y 2/3
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.333,
          left: { id: g('c'), type: 'leaf' },
          right: { id: g('c'), type: 'leaf' }
        };
        break;
      case 'tools': // 1 compartimento inferior largo (30%) + 3 compartimentos verticales superiores asimétricos
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'h', ratio: 0.68,
          left: {
            id: g('s'), type: 'split', dir: 'v', ratio: 0.32,
            left: { id: g('c'), type: 'leaf' },
            right: {
              id: g('s'), type: 'split', dir: 'v', ratio: 0.52,
              left: { id: g('c'), type: 'leaf' },
              right: { id: g('c'), type: 'leaf' }
            }
          },
          right: { id: g('c'), type: 'leaf' }
        };
        break;
      case 'mix_4': // 4 compartimentos todos con diferentes proporciones
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.38,
          left: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.65,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          },
          right: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.40,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          }
        };
        break;
      case '3x2':
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.333,
          left: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          },
          right: {
            id: g('s'), type: 'split', dir: 'v', ratio: 0.5,
            left: {
              id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
              left: { id: g('c'), type: 'leaf' },
              right: { id: g('c'), type: 'leaf' }
            },
            right: {
              id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
              left: { id: g('c'), type: 'leaf' },
              right: { id: g('c'), type: 'leaf' }
            }
          }
        };
        break;
      case '3x3':
        const makeCol = () => ({
          id: g('s'), type: 'split', dir: 'h', ratio: 0.333,
          left: { id: g('c'), type: 'leaf' },
          right: {
            id: g('s'), type: 'split', dir: 'h', ratio: 0.5,
            left: { id: g('c'), type: 'leaf' },
            right: { id: g('c'), type: 'leaf' }
          }
        });
        this.data.partitionTree = {
          id: g('s'), type: 'split', dir: 'v', ratio: 0.333,
          left: makeCol(),
          right: {
            id: g('s'), type: 'split', dir: 'v', ratio: 0.5,
            left: makeCol(),
            right: makeCol()
          }
        };
        break;
    }
    this.pushHistory();
    this.notify(['partitionTree']);
  }

  // Apply popular standard size preset (Gridfinity, IKEA Alex, Taller, EDC)
  applySizePreset(presetKey) {
    const p = AppState.SIZE_PRESETS[presetKey];
    if (!p) return null;

    this.data.width = p.width;
    this.data.depth = p.depth;
    this.data.height = p.height;
    if (p.fillet !== undefined) this.data.fillet = p.fillet;
    if (p.wallThickness !== undefined) this.data.wallThickness = p.wallThickness;
    if (p.bottomThickness !== undefined) this.data.bottomThickness = p.bottomThickness;
    if (p.stackable !== undefined) this.data.stackable = p.stackable;
    if (p.scoop !== undefined) this.data.scoop = p.scoop;
    if (p.gripSides !== undefined) this.data.gripSides = p.gripSides;

    // Adjust partition height to fit inside tray
    const maxPartitionH = Math.max(2, this.data.height - this.data.bottomThickness);
    this.data.partitionHeight = Math.min(this.data.partitionHeight, maxPartitionH);

    // Apply layout if defined
    if (p.layout) {
      this.applyPreset(p.layout);
    }

    this.pushHistory();
    this.notify([
      'width', 'depth', 'height', 'fillet',
      'wallThickness', 'bottomThickness', 'partitionHeight',
      'stackable', 'scoop', 'gripSides', 'partitionTree'
    ]);
    return p;
  }

  /* ========================================================================
     GEOMETRY LAYOUT SOLVER
     Calculates exact (x, y, w, h) in mm for cells and divider walls
     ======================================================================== */
  computeLayout() {
    const { width, depth, wallThickness } = this.data;
    const innerW = Math.max(10, width - 2 * wallThickness);
    const innerH = Math.max(10, depth - 2 * wallThickness);

    const cells = [];
    const dividers = [];

    // Traverse BSP tree
    const solve = (node, rx, ry, rw, rh) => {
      if (!node) return;

      if (node.type === 'leaf') {
        cells.push({
          id: node.id,
          x: rx,
          y: ry,
          w: rw,
          h: rh
        });
        return;
      }

      if (node.type === 'split') {
        const wt = wallThickness;
        if (node.dir === 'v') {
          // Vertical divider splitting width
          const availableW = rw - wt;
          const leftW = availableW * node.ratio;
          const rightW = availableW - leftW;
          const divX = rx + leftW;
          const divY = ry;
          const divW = wt;
          const divH = rh;

          dividers.push({
            id: node.id,
            dir: 'v',
            splitNode: node,
            x: divX,
            y: divY,
            w: divW,
            h: divH,
            parentBounds: { rx, ry, rw, rh }
          });

          solve(node.left, rx, ry, leftW, rh);
          solve(node.right, divX + wt, ry, rightW, rh);
        } else {
          // Horizontal divider splitting depth/height
          const availableH = rh - wt;
          const topH = availableH * node.ratio;
          const bottomH = availableH - topH;
          const divX = rx;
          const divY = ry + topH;
          const divW = rw;
          const divH = wt;

          dividers.push({
            id: node.id,
            dir: 'h',
            splitNode: node,
            x: divX,
            y: divY,
            w: divW,
            h: divH,
            parentBounds: { rx, ry, rw, rh }
          });

          solve(node.left, rx, ry, rw, topH);
          solve(node.right, rx, divY + wt, rw, bottomH);
        }
      }
    };

    solve(this.data.partitionTree, 0, 0, innerW, innerH);

    return {
      innerW,
      innerH,
      cells,
      dividers
    };
  }
}

// Popular Standard Size Presets
AppState.SIZE_PRESETS = {
  // GRIDFINITY (Módulos estándar 42mm, radio esquinas 3.75mm)
  'gf_1x1': {
    category: 'gridfinity',
    name: 'Gridfinity 1×1',
    dims: '42 × 42 × 28 mm',
    width: 42, depth: 42, height: 28,
    fillet: 3.75, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: false,
    layout: '1x1'
  },
  'gf_1x2': {
    category: 'gridfinity',
    name: 'Gridfinity 1×2',
    dims: '42 × 84 × 28 mm',
    width: 42, depth: 84, height: 28,
    fillet: 3.75, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: false,
    layout: '1x2'
  },
  'gf_2x2': {
    category: 'gridfinity',
    name: 'Gridfinity 2×2',
    dims: '84 × 84 × 35 mm',
    width: 84, depth: 84, height: 35,
    fillet: 3.75, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: true,
    layout: '2x2'
  },
  'gf_2x3': {
    category: 'gridfinity',
    name: 'Gridfinity 2×3',
    dims: '84 × 126 × 35 mm',
    width: 84, depth: 126, height: 35,
    fillet: 3.75, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: true,
    layout: 'asym_bento'
  },
  'gf_3x3': {
    category: 'gridfinity',
    name: 'Gridfinity 3×3',
    dims: '126 × 126 × 42 mm',
    width: 126, depth: 126, height: 42,
    fillet: 3.75, wallThickness: 2.2, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: true,
    layout: 'mix_4'
  },

  // IKEA ALEX (Módulos optimizados para cajón Alex 294 × 520 mm)
  'alex_larga': {
    category: 'alex',
    name: 'IKEA Alex Larga',
    dims: '145 × 290 × 45 mm',
    width: 145, depth: 290, height: 45,
    fillet: 3.0, wallThickness: 2.4, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: true,
    layout: 'tools'
  },
  'alex_media': {
    category: 'alex',
    name: 'IKEA Alex Media',
    dims: '145 × 145 × 45 mm',
    width: 145, depth: 145, height: 45,
    fillet: 3.0, wallThickness: 2.4, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: true,
    layout: 'asym_bento'
  },
  'alex_estrecha': {
    category: 'alex',
    name: 'IKEA Alex Estrecha',
    dims: '95 × 145 × 45 mm',
    width: 95, depth: 145, height: 45,
    fillet: 3.0, wallThickness: 2.2, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: true,
    layout: '1_3_2_3'
  },
  'alex_cuad': {
    category: 'alex',
    name: 'IKEA Alex Cuadrante',
    dims: '95 × 95 × 45 mm',
    width: 95, depth: 95, height: 45,
    fillet: 3.0, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: false,
    layout: '1x1'
  },

  // TALLER & TORNILLERÍA (Fondo curvo para agarre de piezas y apilables)
  'taller_m3': {
    category: 'taller',
    name: 'Tornillería M3/M4',
    dims: '75 × 55 × 25 mm',
    width: 75, depth: 55, height: 25,
    fillet: 3.0, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: true, scoop: true, gripSides: true,
    layout: '1x2'
  },
  'taller_3cav': {
    category: 'taller',
    name: 'Organizador 3 Cavidades',
    dims: '120 × 60 × 30 mm',
    width: 120, depth: 60, height: 30,
    fillet: 3.0, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: true, scoop: true, gripSides: true,
    layout: 'tools'
  },

  // ESCRITORIO & EDC (Vaciabolsillos y accesorios)
  'edc_vaciabolsillos': {
    category: 'edc',
    name: 'Vaciabolsillos EDC',
    dims: '180 × 120 × 28 mm',
    width: 180, depth: 120, height: 28,
    fillet: 5.0, wallThickness: 2.4, bottomThickness: 2.2,
    stackable: false, scoop: true, gripSides: true,
    layout: 'asym_bento'
  },
  'edc_sd_cards': {
    category: 'edc',
    name: 'Tarjetas SD y Pendrives',
    dims: '105 × 65 × 22 mm',
    width: 105, depth: 65, height: 22,
    fillet: 3.0, wallThickness: 2.0, bottomThickness: 2.0,
    stackable: false, scoop: true, gripSides: false,
    layout: 'asym_bento'
  }
};

// Global state instance
window.appState = new AppState();
