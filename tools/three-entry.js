// Entrada del bundle de Three.js para TrayForge 3D.
// Expone window.THREE (con OrbitControls) para que la app siga funcionando
// como scripts clásicos, incluso abriendo index.html con doble clic (file://).
import * as THREE_NS from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

window.THREE = Object.assign({}, THREE_NS, { OrbitControls });
