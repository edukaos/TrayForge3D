# TrayForge 3D 🛠️

**Generador paramétrico interactivo de bandejas organizadoras para impresión 3D.**

Diseña y personaliza bandejas organizadoras a medida, ajusta compartimentos y exporta directamente en formato STL listo para laminar e imprimir.

---

## ✨ Características

- **Diseño Paramétrico Completo:**
  - Ancho, profundidad y altura configurables en tiempo real.
  - Espesor de paredes y fondo ajustables.
  - Radio de curvatura en esquinas (fillet).
  - Altura personalizable de las divisiones internas.
  - Fondo curvo (*scoop*) para facilitar la recogida de piezas pequeñas / tornillos.
  - Tiradores frontales y rebajes laterales de agarre (*finger grips*).
  - Pestañas para etiquetas rotulables.
  - Opción de bandeja apilable con reborde superior e inferior.

- **Presets Populares (1-Clic):**
  - **Gridfinity:** Tamaños estándar 1×1, 1×2, 2×2, 2×3, 3×3.
  - **IKEA Alex:** Módulos largo, medio, estrecho y cuadrante.
  - **Taller / Tornillos:** Bandejas optimizadas para tornillería M3/M4.
  - **Escritorio / EDC:** Vaciabolsillos y organizadores de tarjetas SD / USB.

- **Editor 2D / 3D Interactivo:**
  - Vista previa 3D en tiempo real con Three.js y OrbitControls.
  - Editor 2D interactivo para dividir cavidades vertical y horizontalmente con cotas milimétricas precisas.
  - Plantillas asimétricas (Bento, 1/3 + 2/3, herramientas, etc.).

- **Exportación:**
  - Descarga directa en STL binario compatible con cualquier laminador (Bambu Studio, PrusaSlicer, Cura, OrcaSlicer).
  - Estimación en tiempo real de volumen ($cm^3$) y peso en filamento PLA (g).

---

## 🚀 Despliegue y Uso Local

Al ser una aplicación web estática (Vanilla JS + HTML5 + CSS3 + Three.js), no requiere instalación de dependencias ni compilación.

1. Abre directamente `index.html` en cualquier navegador moderno.
2. O ejecuta `start.bat` en Windows.

### Three.js

La app usa **three.js r187** empaquetado en `lib/three.bundle.min.js` (incluye `OrbitControls` y expone `window.THREE`), así sigue funcionando sin servidor ni compilación. Para actualizarlo a una versión nueva:

```bash
npm install three@latest --save-dev
npm run build:three
```

### Estilo visual

La interfaz sigue el lenguaje **Liquid Glass** de Qlamps: visor 3D a pantalla completa, barra y panel flotando en vidrio translúcido, fondo navy y acento dorado, con modo oscuro y claro. Todo vive en `style.css` (tokens `--lg-*` al principio del archivo).
