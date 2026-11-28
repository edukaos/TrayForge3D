/**
 * app.js - Main Application Controller
 */

class BentoApp {
  constructor() {
    this.state = window.appState;
    this.currentGeometries = [];
    this.currentMeshGroup = null;

    document.documentElement.setAttribute('data-tab', this.state.state.activeTab || 'preview');
    this.initTheme();
    this.init3D();
    this.init2D();
    this.initUI();
    this.bindEvents();

    // Initial build
    this.updateModel();
    this.updateStats();
  }

  /* ========================================================================
     THEME MANAGEMENT (DARK MODE DEFAULT)
     ======================================================================== */
  initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem('trayforge_theme') || 'dark'; } catch (e) { /* almacenamiento no disponible */ }
    this.setTheme(saved);
  }

  setTheme(themeName) {
    if (themeName === 'light') {
      document.body.classList.remove('theme-dark');
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
      document.body.classList.add('theme-dark');
    }
    document.documentElement.setAttribute('data-theme', themeName);
    try { localStorage.setItem('trayforge_theme', themeName); } catch (e) { /* almacenamiento no disponible */ }

    if (this.scene) {
      if (this.gridHelper) {
        this.scene.remove(this.gridHelper);
      }
      if (this.bedPlane) {
        this.scene.remove(this.bedPlane);
      }
      this.createPrintBedGrid();
    }

    if (this.partitionEditor) {
      this.partitionEditor.render();
    }
  }

  toggleTheme() {
    const isDark = document.body.classList.contains('theme-dark');
    this.setTheme(isDark ? 'light' : 'dark');
  }

  /* ========================================================================
     THREE.JS 3D SCENE SETUP
     ======================================================================== */
  init3D() {
    const container = document.getElementById('viewport-3d');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene (fondo transparente: se ve el degradado ambiental del CSS detrás)
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 2000);
    this.camera.position.set(130, 160, 190);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05; // don't go under bed
    this.controls.target.set(0, 12, 0);

    // Lights (intensidades físicas de three.js r155+)
    const hemiLight = new THREE.HemisphereLight(0xf3f6fb, 0x24365a, 1.6);
    this.scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
    dirLight.position.set(100, 250, 150);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 600;
    dirLight.shadow.camera.left = -150;
    dirLight.shadow.camera.right = 150;
    dirLight.shadow.camera.top = 150;
    dirLight.shadow.camera.bottom = -150;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xbad4ff, 0.9);
    fillLight.position.set(-100, 100, -100);
    this.scene.add(fillLight);

    // 3D Print Bed Grid
    this.createPrintBedGrid();

    // Animation Loop
    const animate = () => {
      requestAnimationFrame(animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();

    // Resize Handler
    this.resize3D = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.camera.aspect = w / h;
      this.renderer.setSize(w, h);
      this.applyStageOffset(w, h);
    };
    window.addEventListener('resize', this.resize3D);
    this.resize3D();
  }

  // El visor ocupa toda la ventana y el panel flota encima: desplazamos el
  // centro óptico de la cámara hacia la zona libre para que la bandeja no
  // quede tapada por el panel ni por la barra superior.
  applyStageOffset(w, h) {
    const stage = document.querySelector('.canvas-stage');
    let dx = 0, dy = 0, zoom = 1;
    if (stage) {
      const r = stage.getBoundingClientRect();
      dx = (r.left + r.width / 2) - w / 2;
      dy = (r.top + r.height / 2) - h / 2;
      // Si la zona libre es mucho más pequeña que la ventana (móvil), alejamos la vista.
      zoom = Math.min(1, Math.min(r.width / w, r.height / h) * 1.5);
    }
    this.camera.zoom = zoom;
    this.camera.setViewOffset(w, h, -dx, -dy, w, h);
    this.camera.updateProjectionMatrix();
  }

  createPrintBedGrid() {
    const isDark = document.body.classList.contains('theme-dark');
    const bedSize = 260;
    
    // Grid helper with theme-aware colors
    const colorCenter = isDark ? 0x8a6d2c : 0xd9a21e;
    const colorGrid = isDark ? 0x2a3d60 : 0xc4cfdf;
    this.gridHelper = new THREE.GridHelper(bedSize, 26, colorCenter, colorGrid);
    this.gridHelper.position.y = 0;
    this.gridHelper.material.transparent = true;
    this.gridHelper.material.opacity = isDark ? 0.7 : 0.8;
    this.scene.add(this.gridHelper);

    // Subtle build plate plane
    const planeGeo = new THREE.PlaneGeometry(bedSize, bedSize);
    const planeMat = new THREE.MeshBasicMaterial({
      color: isDark ? 0x0c1830 : 0xf4f7fb,
      transparent: true,
      opacity: isDark ? 0.55 : 0.7,
      depthWrite: false
    });
    this.bedPlane = new THREE.Mesh(planeGeo, planeMat);
    this.bedPlane.rotation.x = -Math.PI / 2;
    this.bedPlane.position.y = -0.1;
    this.bedPlane.receiveShadow = true;
    this.scene.add(this.bedPlane);
  }

  /* ========================================================================
     2D CANVAS SETUP
     ======================================================================== */
  init2D() {
    const canvas = document.getElementById('grid-canvas');
    this.partitionEditor = new PartitionEditor(canvas, this.state);
    this.partitionEditor.onCellSelect = (cell) => {
      this.syncCavityInspector(cell);
    };
  }

  /* ========================================================================
     UI BINDINGS & STATE SYNC
     ======================================================================== */
  initUI() {
    // Sync all controls with initial state
    this.syncFormControls(this.state.state);

    // State subscriber to update 3D and UI
    this.state.subscribe((state, changedKeys) => {
      this.syncFormControls(state);
      this.updateModel();
      this.updateStats();
      this.updateUndoRedoButtons();
    });
  }

  syncFormControls(s) {
    // Inputs & Sliders
    this.setVal('input-width', s.width);
    this.setVal('input-depth', s.depth);
    this.setVal('input-height', s.height);

    this.setVal('input-wall-thickness', s.wallThickness);
    this.setVal('slider-wall-thickness', s.wallThickness);

    this.setVal('input-bottom-thickness', s.bottomThickness);
    this.setVal('slider-bottom-thickness', s.bottomThickness);

    this.setVal('input-fillet', s.fillet);
    this.setVal('slider-fillet', s.fillet);

    this.setVal('input-partition-height', s.partitionHeight);
    this.setVal('slider-partition-height', s.partitionHeight);

    // Floating badges text
    document.getElementById('dim-val-w').textContent = `${s.width} mm`;
    document.getElementById('dim-val-d').textContent = `${s.depth} mm`;
    document.getElementById('dim-val-h').textContent = `${s.height} mm`;

    // Stackable cards
    const btnUnstack = document.getElementById('btn-unstackable');
    const btnStack = document.getElementById('btn-stackable');
    if (s.stackable) {
      btnStack.classList.add('active');
      btnUnstack.classList.remove('active');
    } else {
      btnUnstack.classList.add('active');
      btnStack.classList.remove('active');
    }

    // Toggles
    document.getElementById('toggle-scoop').checked = s.scoop;
    document.getElementById('toggle-label').checked = s.label;
    const togGrip = document.getElementById('toggle-grip-sides');
    if (togGrip) togGrip.checked = !!s.gripSides;
    document.getElementById('toggle-finger-pull').checked = s.fingerPull;

    // Sync selected cavity inspector
    this.syncCavityInspector();
  }

  syncCavityInspector(cell) {
    const group = document.getElementById('cavity-inspector-group');
    if (!group) return;

    const layout = this.state.computeLayout();
    if (!layout.cells || layout.cells.length === 0) return;

    const activeCell = cell || this.partitionEditor?.selectedCell || layout.cells[0];
    if (!activeCell) return;

    const cellIdx = layout.cells.findIndex(c => c.id === activeCell.id);
    const titleEl = document.getElementById('inspector-cell-title');
    if (titleEl) {
      titleEl.textContent = `Compartimento #${cellIdx >= 0 ? cellIdx + 1 : 1}`;
    }

    const inputW = document.getElementById('input-cell-width');
    if (inputW && document.activeElement !== inputW) {
      inputW.value = activeCell.w.toFixed(1);
    }

    const inputH = document.getElementById('input-cell-height');
    if (inputH && document.activeElement !== inputH) {
      inputH.value = activeCell.h.toFixed(1);
    }

    const btnDelete = document.getElementById('btn-inspector-delete');
    if (btnDelete) {
      btnDelete.disabled = layout.cells.length <= 1;
    }
  }

  setVal(id, val) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) {
      el.value = val;
    }
    if (el && el.type === 'range') this.paintRange(el);
  }

  // Pinta la parte recorrida del slider con el color de acento.
  paintRange(el) {
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    el.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
  }

  bindEvents() {
    // 1. Navigation Tabs
    const tabs = ['size', 'grid', 'preview'];
    tabs.forEach(tabName => {
      const btn = document.getElementById(`tab-${tabName}`);
      btn.addEventListener('click', () => this.switchTab(tabName));
    });

    // Theme toggle button
    const btnTheme = document.getElementById('btn-theme-toggle');
    if (btnTheme) {
      btnTheme.addEventListener('click', () => this.toggleTheme());
    }

    // Floating edit grid button in Size mode
    document.getElementById('btn-floating-edit-grid').addEventListener('click', () => {
      this.switchTab('grid');
    });

    // 2. Numeric inputs & Sliders pairings
    this.bindInputPair('wall-thickness', 0.8, 8.0, 0.2);
    this.bindInputPair('bottom-thickness', 0.8, 8.0, 0.2);
    this.bindInputPair('fillet', 0, 25, 0.5);
    this.bindInputPair('partition-height', 2, 140, 1);

    // Dimensions
    const bindDimInput = (id, key, min, max) => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => {
        let v = parseFloat(el.value);
        if (isNaN(v)) v = this.state.state[key];
        v = Math.max(min, Math.min(max, Math.round(v)));
        this.state.update({ [key]: v });
      });
    };
    bindDimInput('input-width', 'width', 30, 350);
    bindDimInput('input-depth', 'depth', 30, 350);
    bindDimInput('input-height', 'height', 10, 150);

    // 3. Floating 3D Stepper Buttons
    document.querySelectorAll('.step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const axis = btn.getAttribute('data-axis');
        const dir = parseInt(btn.getAttribute('data-dir'), 10);
        const current = this.state.state[axis];
        let next = current + dir;
        const limits = { width: [30, 350], depth: [30, 350], height: [10, 150] };
        next = Math.max(limits[axis][0], Math.min(limits[axis][1], next));
        this.state.update({ [axis]: next });
      });
    });

    // 4. Stackable cards
    document.getElementById('btn-unstackable').addEventListener('click', () => {
      this.state.update({ stackable: false });
    });
    document.getElementById('btn-stackable').addEventListener('click', () => {
      this.state.update({ stackable: true });
    });

    // 5. Toggles
    document.getElementById('toggle-scoop').addEventListener('change', (e) => {
      this.state.update({ scoop: e.target.checked });
    });
    document.getElementById('toggle-label').addEventListener('change', (e) => {
      this.state.update({ label: e.target.checked });
    });
    const togGrip = document.getElementById('toggle-grip-sides');
    if (togGrip) {
      togGrip.addEventListener('change', (e) => {
        this.state.update({ gripSides: e.target.checked });
      });
    }

    document.getElementById('toggle-finger-pull').addEventListener('change', (e) => {
      this.state.update({ fingerPull: e.target.checked });
    });

    // 6. Size Presets (Punto 3: Estándares Populares)
    document.querySelectorAll('.cat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.getAttribute('data-cat');
        document.querySelectorAll('.size-preset-card').forEach(card => {
          if (cat === 'all' || card.getAttribute('data-cat') === cat) {
            card.style.display = 'flex';
          } else {
            card.style.display = 'none';
          }
        });
      });
    });

    document.querySelectorAll('.size-preset-card').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.size-preset-card').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const presetKey = btn.getAttribute('data-preset');
        const p = this.state.applySizePreset(presetKey);
        if (p) {
          this.showToast(`✓ Preset aplicado: ${p.name} (${p.dims})`);
        }
      });
    });

    // 7. Partition Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const preset = btn.getAttribute('data-preset');
        this.state.applyPreset(preset);
      });
    });

    // Ratio Quick Buttons (Asymmetric division adjustment)
    document.querySelectorAll('.ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ratio = parseFloat(btn.getAttribute('data-ratio'));
        const activeDiv = this.partitionEditor.selectedDivider || this.partitionEditor.hoveredDivider;
        if (activeDiv) {
          this.state.updateSplitRatio(activeDiv.id, ratio, true);
        } else if (this.state.state.partitionTree && this.state.state.partitionTree.type === 'split') {
          this.state.updateSplitRatio(this.state.state.partitionTree.id, ratio, true);
        }
      });
    });

    // Cavity Inspector Numeric Dimensions & Steppers
    const getActiveCellId = () => {
      const layout = this.state.computeLayout();
      return this.partitionEditor?.selectedCell?.id || layout.cells[0]?.id;
    };

    const inputCellW = document.getElementById('input-cell-width');
    if (inputCellW) {
      inputCellW.addEventListener('change', () => {
        const id = getActiveCellId();
        if (id) {
          const val = parseFloat(inputCellW.value);
          this.state.setCellDimension(id, 'width', val);
        }
      });
    }

    const inputCellH = document.getElementById('input-cell-height');
    if (inputCellH) {
      inputCellH.addEventListener('change', () => {
        const id = getActiveCellId();
        if (id) {
          const val = parseFloat(inputCellH.value);
          this.state.setCellDimension(id, 'height', val);
        }
      });
    }

    document.getElementById('btn-cell-w-minus')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (!id) return;
      const info = this.state.getCellInfo(id);
      if (info) this.state.setCellDimension(id, 'width', Math.max(5, info.cell.w - 1));
    });

    document.getElementById('btn-cell-w-plus')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (!id) return;
      const info = this.state.getCellInfo(id);
      if (info) this.state.setCellDimension(id, 'width', info.cell.w + 1);
    });

    document.getElementById('btn-cell-h-minus')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (!id) return;
      const info = this.state.getCellInfo(id);
      if (info) this.state.setCellDimension(id, 'height', Math.max(5, info.cell.h - 1));
    });

    document.getElementById('btn-cell-h-plus')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (!id) return;
      const info = this.state.getCellInfo(id);
      if (info) this.state.setCellDimension(id, 'height', info.cell.h + 1);
    });

    document.getElementById('btn-inspector-split-v')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (id) this.state.splitCompartment(id, 'v');
    });

    document.getElementById('btn-inspector-split-h')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (id) this.state.splitCompartment(id, 'h');
    });

    document.getElementById('btn-inspector-delete')?.addEventListener('click', () => {
      const id = getActiveCellId();
      if (id) this.state.deleteCompartment(id);
    });

    // Reset grid
    document.getElementById('btn-reset-grid').addEventListener('click', () => {
      this.state.resetGrid();
    });

    // 7. Undo / Redo
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    btnUndo.addEventListener('click', () => this.state.undo());
    btnRedo.addEventListener('click', () => this.state.redo());

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          this.state.redo();
        } else {
          this.state.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        this.state.redo();
      }
    });

    // 8. Viewport Toolbar
    // Colors
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        const color = parseInt(dot.getAttribute('data-color'), 16);
        this.state.update({ meshColor: color }, false);
      });
    });

    // Views
    document.getElementById('btn-view-iso').addEventListener('click', () => {
      this.camera.position.set(130, 160, 190);
      this.controls.target.set(0, 12, 0);
    });

    document.getElementById('btn-view-top').addEventListener('click', () => {
      this.camera.position.set(0, 240, 0.01);
      this.controls.target.set(0, 12, 0);
    });

    document.getElementById('btn-toggle-wireframe').addEventListener('click', (e) => {
      const active = e.target.classList.toggle('active');
      this.state.update({ wireframe: active }, false);
    });

    // 9. Download STL
    document.getElementById('btn-download').addEventListener('click', () => {
      this.exportSTL();
    });
  }

  bindInputPair(name, min, max, step) {
    const input = document.getElementById(`input-${name}`);
    const slider = document.getElementById(`slider-${name}`);
    const keyMap = {
      'wall-thickness': 'wallThickness',
      'bottom-thickness': 'bottomThickness',
      'fillet': 'fillet',
      'partition-height': 'partitionHeight'
    };
    const key = keyMap[name];

    const updateVal = (val, isFinal = true) => {
      let num = parseFloat(val);
      if (isNaN(num)) num = min;
      num = Math.max(min, Math.min(max, num));
      input.value = num;
      slider.value = num;
      this.state.update({ [key]: num }, isFinal);
    };

    slider.addEventListener('input', () => { updateVal(slider.value, false); this.paintRange(slider); });
    slider.addEventListener('change', () => updateVal(slider.value, true));
    input.addEventListener('change', () => updateVal(input.value, true));
  }

  switchTab(tabName) {
    const tabs = ['size', 'grid', 'preview'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-${t}`);
      if (t === tabName) btn.classList.add('active');
      else btn.classList.remove('active');
      btn.setAttribute('aria-selected', t === tabName ? 'true' : 'false');
    });

    const vp2d = document.getElementById('viewport-2d');
    const overlays = document.getElementById('dimension-overlays');

    if (tabName === 'grid') {
      vp2d.classList.remove('hidden');
      overlays.classList.add('hidden');
      // Ensure layout has computed before resizing canvas
      requestAnimationFrame(() => {
        this.partitionEditor.resizeCanvas();
        this.partitionEditor.render();
      });
    } else if (tabName === 'size') {
      vp2d.classList.add('hidden');
      overlays.classList.remove('hidden');
    } else {
      // preview
      vp2d.classList.add('hidden');
      overlays.classList.add('hidden');
    }

    document.documentElement.setAttribute('data-tab', tabName);
    this.state.update({ activeTab: tabName }, false);
  }

  updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = !this.state.canUndo();
    document.getElementById('btn-redo').disabled = !this.state.canRedo();
  }

  /* ========================================================================
     3D MODEL GENERATION & STATS
     ======================================================================== */
  updateModel() {
    if (this.currentMeshGroup) {
      this.scene.remove(this.currentMeshGroup);
      this.currentGeometries.forEach(g => g.dispose());
    }

    const layout = this.state.computeLayout();
    const result = ModelGenerator.generateTray(this.state.state, layout);

    this.currentMeshGroup = result.group;
    this.currentGeometries = result.geometries;
    this.scene.add(this.currentMeshGroup);
  }

  updateStats() {
    const s = this.state.state;
    const layout = this.state.computeLayout();
    const metrics = ModelGenerator.estimateMetrics(s, layout);

    document.getElementById('stat-dims').textContent = `${s.width} × ${s.depth} × ${s.height} mm`;
    document.getElementById('stat-compartments').textContent = layout.cells.length;
    document.getElementById('stat-volume').textContent = `~${metrics.volumeCm3} cm³`;
    document.getElementById('stat-weight').textContent = `~${metrics.weightGrams} g`;
  }

  exportSTL() {
    if (!this.currentGeometries || this.currentGeometries.length === 0) return;
    const s = this.state.state;
    const filename = `trayforge_${s.width}x${s.depth}x${s.height}mm.stl`;

    STLExporter.exportToSTL(this.currentGeometries, filename);
    this.showToast(`¡Descargando ${filename}! Listo para abrir en tu laminador.`);
  }

  showToast(message) {
    let toast = document.querySelector('.toast-msg');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast-msg';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new BentoApp();
});
