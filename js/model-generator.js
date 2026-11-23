/**
 * model-generator.js - Procedural 3D Mesh Generator for Parametric Trays
 */

class ModelGenerator {
  /**
   * Generates a complete Three.js Group representing the tray,
   * plus raw geometry ready for STL export.
   */
  static generateTray(params, layout) {
    const {
      width,
      depth,
      height,
      wallThickness,
      bottomThickness,
      fillet,
      partitionHeight,
      stackable,
      scoop,
      label,
      fingerPull,
      gripSides,
      meshColor,
      wireframe
    } = params;

    const group = new THREE.Group();

    // Material for realistic plastic 3D print
    const material = new THREE.MeshStandardMaterial({
      color: meshColor || 0x0077ff,
      roughness: 0.35,
      metalness: 0.05,
      wireframe: !!wireframe,
      side: THREE.DoubleSide
    });

    const geometries = [];

    // Safe clamp for fillet
    const maxFillet = Math.min(fillet, Math.min(width, depth) / 4);
    const rOuter = Math.max(0.1, maxFillet);
    const rInner = Math.max(0.0, rOuter - wallThickness);
    const innerW = width - 2 * wallThickness;
    const innerD = depth - 2 * wallThickness;

    // Outer 2D contour shape
    const outerShape = this.createRoundedRectShape(width, depth, rOuter);

    // -------------------------------------------------------------
    // STACKABLE STEPPED JOINT PARAMETERS
    // -------------------------------------------------------------
    const stepH = stackable ? 2.4 : 0; // Height of top step recess
    const footH = stackable ? 2.1 : 0; // Height of bottom mating foot (with 0.3mm vertical tolerance)
    const halfT = wallThickness / 2;    // Step thickness is exactly half the wall
    const clearance = 0.25;            // 0.25mm horizontal clearance for 3D print tolerances

    const baseZ = footH; // Floor begins right above bottom foot
    const floorZ = baseZ + bottomThickness; // Cavity floor height
    const mainWallTopZ = height - stepH;    // Height where full-thickness wall ends
    const mainWallHeight = Math.max(1, mainWallTopZ - floorZ);
    const actualPartitionH = Math.min(partitionHeight, mainWallHeight);

    // -------------------------------------------------------------
    // 1. BOTTOM STACKING FOOT (when stackable is true)
    // -------------------------------------------------------------
    if (stackable && footH > 0) {
      const footW = width - 2 * (halfT + clearance);
      const footD = depth - 2 * (halfT + clearance);
      const footFillet = Math.max(0.0, rOuter - (halfT + clearance));

      const footShape = this.createRoundedRectShape(footW, footD, footFillet);
      footShape.holes.push(this.createRoundedRectPath(innerW, innerD, rInner));

      const footGeom = new THREE.ExtrudeGeometry(footShape, {
        depth: footH,
        bevelEnabled: false,
        curveSegments: 16
      });
      footGeom.center();
      footGeom.translate(0, 0, footH / 2);
      geometries.push(footGeom);
    }

    // -------------------------------------------------------------
    // 2. BASE FLOOR (Bottom plate)
    // -------------------------------------------------------------
    const baseShape = outerShape.clone();
    const baseGeom = new THREE.ExtrudeGeometry(baseShape, {
      depth: bottomThickness,
      bevelEnabled: false,
      curveSegments: 16
    });
    baseGeom.center();
    baseGeom.translate(0, 0, baseZ + bottomThickness / 2);
    geometries.push(baseGeom);

    // -------------------------------------------------------------
    // 3. MAIN WALLS & FILLETED COMPARTMENTS (Full thickness T)
    // -------------------------------------------------------------
    const makeCellHole = (cell) => {
      const isLeft = Math.abs(cell.x) < 0.05;
      const isRight = Math.abs((cell.x + cell.w) - innerW) < 0.05;
      const isTop = Math.abs(cell.y) < 0.05;
      const isBottom = Math.abs((cell.y + cell.h) - innerD) < 0.05;

      // Single cavity tray: perfectly concentric with outer perimeter
      if (isLeft && isRight && isTop && isBottom) {
        return this.createRoundedRectPath(innerW, innerD, rInner);
      }

      // Multi-compartment: outer corners match rInner, interior dividers use internal fillet
      const cx = cell.x + cell.w / 2 - innerW / 2;
      const cy = -(cell.y + cell.h / 2 - innerD / 2);
      const x0 = cx - cell.w / 2;
      const x1 = cx + cell.w / 2;
      const y0 = cy - cell.h / 2;
      const y1 = cy + cell.h / 2;

      const rInternal = Math.max(0, Math.min(fillet, Math.min(cell.w, cell.h) / 3, 2.0));
      const rBL = (isLeft && isBottom) ? rInner : rInternal;
      const rBR = (isRight && isBottom) ? rInner : rInternal;
      const rTR = (isRight && isTop) ? rInner : rInternal;
      const rTL = (isLeft && isTop) ? rInner : rInternal;

      return this.createPositionedRoundedRectPath(x0, x1, y0, y1, rBL, rBR, rTR, rTL);
    };

    if (mainWallHeight > 0 && layout && layout.cells && layout.cells.length > 0) {
      const hasDividers = layout.cells.length > 1;
      if (hasDividers && actualPartitionH < mainWallHeight - 0.5) {
        // Lower portion: outer wall + dividers
        const lowerShape = outerShape.clone();
        layout.cells.forEach(cell => lowerShape.holes.push(makeCellHole(cell)));
        const lowerGeom = new THREE.ExtrudeGeometry(lowerShape, {
          depth: actualPartitionH,
          bevelEnabled: false,
          curveSegments: 16
        });
        lowerGeom.center();
        lowerGeom.translate(0, 0, floorZ + actualPartitionH / 2);
        geometries.push(lowerGeom);

        // Upper portion: outer wall only up to mainWallTopZ
        const upperH = mainWallHeight - actualPartitionH;
        const upperShape = outerShape.clone();
        upperShape.holes.push(this.createRoundedRectPath(innerW, innerD, rInner));
        const upperGeom = new THREE.ExtrudeGeometry(upperShape, {
          depth: upperH,
          bevelEnabled: false,
          curveSegments: 16
        });
        upperGeom.center();
        upperGeom.translate(0, 0, floorZ + actualPartitionH + upperH / 2);
        geometries.push(upperGeom);
      } else {
        // Full height of main walls
        const wallShape = outerShape.clone();
        layout.cells.forEach(cell => wallShape.holes.push(makeCellHole(cell)));
        const wallGeom = new THREE.ExtrudeGeometry(wallShape, {
          depth: mainWallHeight,
          bevelEnabled: false,
          curveSegments: 16
        });
        wallGeom.center();
        wallGeom.translate(0, 0, floorZ + mainWallHeight / 2);
        geometries.push(wallGeom);
      }
    }

    // -------------------------------------------------------------
    // 4. TOP STEPPED RIM (when stackable is true)
    // -------------------------------------------------------------
    if (stackable && stepH > 0) {
      const topLipShape = outerShape.clone();
      const topLipHoleW = width - 2 * halfT;
      const topLipHoleD = depth - 2 * halfT;
      const topLipHoleFillet = Math.max(0.0, rOuter - halfT);
      topLipShape.holes.push(this.createRoundedRectPath(topLipHoleW, topLipHoleD, topLipHoleFillet));

      const topLipGeom = new THREE.ExtrudeGeometry(topLipShape, {
        depth: stepH,
        bevelEnabled: false,
        curveSegments: 16
      });
      topLipGeom.center();
      topLipGeom.translate(0, 0, mainWallTopZ + stepH / 2);
      geometries.push(topLipGeom);
    }

    // -------------------------------------------------------------
    // 5. SCOOP (CURVED CONCAVE BOTTOM RAMPS)
    // -------------------------------------------------------------
    if (scoop && layout && layout.cells) {
      layout.cells.forEach(cell => {
        const cx = cell.x + cell.w / 2 - innerW / 2;
        const cy = -(cell.y + cell.h / 2 - innerD / 2);
        const isLeft = Math.abs(cell.x) < 0.05;
        const isBottom = Math.abs((cell.y + cell.h) - innerD) < 0.05;
        const cornerR = (isLeft && isBottom) ? rInner : Math.max(0, Math.min(fillet, Math.min(cell.w, cell.h) / 3, 2.0));

        const spanW = cell.w - 2 * cornerR;
        if (spanW > 2) {
          const x1 = cx - spanW / 2;
          const x2 = cx + spanW / 2;
          const wallY = cy - cell.h / 2;
          const R = Math.max(1.5, Math.min(4.5, Math.min(actualPartitionH * 0.45, cell.h * 0.35)));

          const scoopGeom = ModelGenerator.buildConcaveScoop(x1, x2, wallY, floorZ, R, true);
          geometries.push(scoopGeom);
        }
      });
    }

    // -------------------------------------------------------------
    // 5. ERGONOMIC FINGER GRIPS & ACCESSORIES
    // -------------------------------------------------------------
    // A) Dual Lateral Concave Finger Grips (for lifting out of tight drawers)
    if (gripSides) {
      const grips = ModelGenerator.buildLateralFingerGrips(width, depth, height, wallThickness, bottomThickness, stackable);
      if (grips && grips.length > 0) {
        geometries.push(...grips);
      }
    }

    // B) Front Pull Tab (for sliding out)
    if (fingerPull) {
      const pullW = Math.min(42, width * 0.45);
      const pullH = Math.min(5, height * 0.3);
      const pullD = 6;
      
      const pullShape = new THREE.Shape();
      pullShape.moveTo(-pullW / 2 + 2, 0);
      pullShape.lineTo(pullW / 2 - 2, 0);
      pullShape.quadraticCurveTo(pullW / 2, 0, pullW / 2, -2);
      pullShape.lineTo(pullW / 2, -pullD + 2);
      pullShape.quadraticCurveTo(pullW / 2, -pullD, pullW / 2 - 2, -pullD);
      pullShape.lineTo(-pullW / 2 + 2, -pullD);
      pullShape.quadraticCurveTo(-pullW / 2, -pullD, -pullW / 2, -pullD + 2);
      pullShape.lineTo(-pullW / 2, -2);
      pullShape.quadraticCurveTo(-pullW / 2, 0, -pullW / 2 + 2, 0);

      const pullGeom = new THREE.ExtrudeGeometry(pullShape, {
        depth: pullH,
        bevelEnabled: false,
        curveSegments: 8
      });
      pullGeom.center();
      pullGeom.translate(0, -depth / 2 - pullD / 2, height - pullH / 2);
      geometries.push(pullGeom);
    }

    if (label) {
      // Top rear label plate ledge
      const lblW = Math.min(60, width * 0.7);
      const lblD = 12;
      const lblH = 1.8;
      const lblGeom = new THREE.BoxGeometry(lblW, lblD, lblH);
      lblGeom.translate(0, depth / 2 - lblD / 2 - wallThickness, height - lblH / 2);
      geometries.push(lblGeom);
    }

    // -------------------------------------------------------------
    // MERGE & ROTATE FOR THREE.JS VIEWPORT (Y is Up in Viewport)
    // -------------------------------------------------------------
    geometries.forEach(geom => {
      // Rotate -90 on X so Z (height in 3D print) becomes Y (height in Three.js)
      geom.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });

    return {
      group,
      geometries,
      material
    };
  }

  // Helper: Create rounded rectangle THREE.Shape with exact circular arcs (absarc)
  static createRoundedRectShape(w, h, r) {
    const shape = new THREE.Shape();
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    const x0 = -w / 2;
    const x1 = w / 2;
    const y0 = -h / 2;
    const y1 = h / 2;

    if (radius <= 0.05) {
      shape.moveTo(x0, y0);
      shape.lineTo(x1, y0);
      shape.lineTo(x1, y1);
      shape.lineTo(x0, y1);
      shape.closePath();
      return shape;
    }

    shape.moveTo(x0 + radius, y0);
    shape.lineTo(x1 - radius, y0);
    shape.absarc(x1 - radius, y0 + radius, radius, -Math.PI / 2, 0, false);
    shape.lineTo(x1, y1 - radius);
    shape.absarc(x1 - radius, y1 - radius, radius, 0, Math.PI / 2, false);
    shape.lineTo(x0 + radius, y1);
    shape.absarc(x0 + radius, y1 - radius, radius, Math.PI / 2, Math.PI, false);
    shape.lineTo(x0, y0 + radius);
    shape.absarc(x0 + radius, y0 + radius, radius, Math.PI, Math.PI * 1.5, false);
    shape.closePath();

    return shape;
  }

  // Helper: Create rounded rectangle THREE.Path (for holes) with exact circular arcs (absarc)
  static createRoundedRectPath(w, h, r) {
    const path = new THREE.Path();
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    const x0 = -w / 2;
    const x1 = w / 2;
    const y0 = -h / 2;
    const y1 = h / 2;

    if (radius <= 0.05) {
      path.moveTo(x0, y0);
      path.lineTo(x1, y0);
      path.lineTo(x1, y1);
      path.lineTo(x0, y1);
      path.closePath();
      return path;
    }

    path.moveTo(x0 + radius, y0);
    path.lineTo(x1 - radius, y0);
    path.absarc(x1 - radius, y0 + radius, radius, -Math.PI / 2, 0, false);
    path.lineTo(x1, y1 - radius);
    path.absarc(x1 - radius, y1 - radius, radius, 0, Math.PI / 2, false);
    path.lineTo(x0 + radius, y1);
    path.absarc(x0 + radius, y1 - radius, radius, Math.PI / 2, Math.PI, false);
    path.lineTo(x0, y0 + radius);
    path.absarc(x0 + radius, y0 + radius, radius, Math.PI, Math.PI * 1.5, false);
    path.closePath();

    return path;
  }

  // Helper: Create positioned rounded rectangle THREE.Path with independent corner radii (for individual compartment holes)
  static createPositionedRoundedRectPath(x0, x1, y0, y1, rBL = 0, rBR = 0, rTR = 0, rTL = 0) {
    const path = new THREE.Path();
    const maxR = Math.min((x1 - x0) / 2, (y1 - y0) / 2);
    const bl = Math.min(Math.max(0, rBL), maxR);
    const br = Math.min(Math.max(0, rBR), maxR);
    const tr = Math.min(Math.max(0, rTR), maxR);
    const tl = Math.min(Math.max(0, rTL), maxR);

    // Bottom edge to bottom-right corner
    path.moveTo(x0 + bl, y0);
    path.lineTo(x1 - br, y0);
    if (br > 0.05) {
      path.absarc(x1 - br, y0 + br, br, -Math.PI / 2, 0, false);
    } else {
      path.lineTo(x1, y0);
    }

    // Right edge to top-right corner
    path.lineTo(x1, y1 - tr);
    if (tr > 0.05) {
      path.absarc(x1 - tr, y1 - tr, tr, 0, Math.PI / 2, false);
    } else {
      path.lineTo(x1, y1);
    }

    // Top edge to top-left corner
    path.lineTo(x0 + tl, y1);
    if (tl > 0.05) {
      path.absarc(x0 + tl, y1 - tl, tl, Math.PI / 2, Math.PI, false);
    } else {
      path.lineTo(x0, y1);
    }

    // Left edge to bottom-left corner
    path.lineTo(x0, y0 + bl);
    if (bl > 0.05) {
      path.absarc(x0 + bl, y0 + bl, bl, Math.PI, Math.PI * 1.5, false);
    } else {
      path.lineTo(x0, y0);
    }

    path.closePath();
    return path;
  }

  // Estimate solid plastic volume in cm³ & weight in g
  static estimateMetrics(params, layout) {
    const { width, depth, height, wallThickness, bottomThickness, partitionHeight } = params;
    const innerW = width - 2 * wallThickness;
    const innerD = depth - 2 * wallThickness;

    // Floor volume (mm³)
    let solidMm3 = width * depth * bottomThickness;

    // Outer perimeter walls volume
    solidMm3 += (width * depth - innerW * innerD) * (height - bottomThickness);

    // Dividers volume
    const actualPartH = Math.min(partitionHeight, height - bottomThickness);
    if (layout && layout.dividers) {
      layout.dividers.forEach(div => {
        solidMm3 += div.w * div.h * actualPartH;
      });
    }

    const volumeCm3 = Math.max(1, solidMm3 / 1000);
    // PLA density ~1.24 g/cm3. Factoring in 20% infill for thick areas and solid perimeters
    const weightGrams = volumeCm3 * 1.24 * 0.95;

    return {
      volumeCm3: Math.round(volumeCm3 * 10) / 10,
      weightGrams: Math.round(weightGrams)
    };
  }

  // Generates a 100% solid, closed concave ramp fillet connecting vertical wall and horizontal floor
  static buildConcaveScoop(x1, x2, wallY, floorZ, R, isFront = true, steps = 10) {
    const positions = [];
    const indices = [];
    const sign = isFront ? 1 : -1;
    const arcLeft = [];
    const arcRight = [];

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * (Math.PI / 2);
      const y = wallY + sign * R * (1 - Math.cos(t));
      const z = floorZ + R * (1 - Math.sin(t));
      arcLeft.push([x1, y, z]);
      arcRight.push([x2, y, z]);
    }

    const addTri = (p1, p2, p3) => {
      const base = positions.length / 3;
      positions.push(...p1, ...p2, ...p3);
      indices.push(base, base + 1, base + 2);
    };

    // Curved concave ramp surface
    for (let i = 0; i < steps; i++) {
      const L1 = arcLeft[i];
      const L2 = arcLeft[i + 1];
      const R1 = arcRight[i];
      const R2 = arcRight[i + 1];
      if (isFront) {
        addTri(L1, R1, L2);
        addTri(R1, R2, L2);
      } else {
        addTri(L1, L2, R1);
        addTri(R1, L2, R2);
      }
    }

    // Flat back wall & Flat bottom floor faces
    const cornerLeft = [x1, wallY, floorZ];
    const cornerRight = [x2, wallY, floorZ];
    const wallTopLeft = [x1, wallY, floorZ + R];
    const wallTopRight = [x2, wallY, floorZ + R];
    const floorInLeft = [x1, wallY + sign * R, floorZ];
    const floorInRight = [x2, wallY + sign * R, floorZ];

    if (isFront) {
      addTri(wallTopLeft, cornerLeft, wallTopRight);
      addTri(wallTopRight, cornerLeft, cornerRight);
      addTri(cornerLeft, floorInLeft, cornerRight);
      addTri(cornerRight, floorInLeft, floorInRight);
    } else {
      addTri(wallTopLeft, wallTopRight, cornerLeft);
      addTri(wallTopRight, cornerRight, cornerLeft);
      addTri(cornerLeft, cornerRight, floorInLeft);
      addTri(cornerRight, floorInRight, floorInLeft);
    }

    // Side end caps (quarter-circle wedges)
    for (let i = 0; i < steps; i++) {
      if (isFront) {
        addTri(cornerLeft, arcLeft[i], arcLeft[i + 1]);
        addTri(cornerRight, arcRight[i + 1], arcRight[i]);
      } else {
        addTri(cornerLeft, arcLeft[i + 1], arcLeft[i]);
        addTri(cornerRight, arcRight[i], arcRight[i + 1]);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  // Ergonomic Dual Lateral Finger Grips (Side Scoops)
  static buildLateralFingerGrips(width, depth, height, wallThickness, bottomThickness, stackable) {
    const geometries = [];

    // Length of grip along Y (depth)
    const L = Math.min(36, Math.max(20, depth * 0.45));
    // Vertical span
    const stepH = stackable ? 2.4 : 0;
    const Ztop = height - (stackable ? 3.0 : 1.2);
    const Gh = Math.min(10, Math.max(5.5, (height - bottomThickness - stepH) * 0.5));
    const Zbot = Ztop - Gh;
    if (Gh < 4) return geometries;

    const Pmax = 2.8; // Maximum projection outward in mm
    const Ny = 16;     // Slices along Y

    const zMid = (Zbot + Ztop) / 2;
    // Profile offsets: dx is outward offset from wall, z is absolute height
    const profile = [
      { dx: 0, z: Zbot },
      { dx: Pmax * 0.85, z: Zbot + Gh * 0.35 },  // 45° overhang slope
      { dx: Pmax * 0.50, z: zMid },             // Ergonomic concave groove (finger rest)
      { dx: Pmax * 0.95, z: Ztop - Gh * 0.15 }, // Positive upper lock ridge
      { dx: Pmax * 0.70, z: Ztop },             // Top bevel
      { dx: 0, z: Ztop }                        // Top back to wall
    ];
    const Nz = profile.length;

    // Helper to generate grip on one side (+1 for right wall at +width/2, -1 for left wall at -width/2)
    const buildSide = (sideSign) => {
      const positions = [];
      const indices = [];

      // Grid of vertices: i along Y (0..Ny), j along profile (0..Nz-1)
      for (let i = 0; i <= Ny; i++) {
        const u = i / Ny;
        const y = -L / 2 + u * L;
        // Smooth envelope: 0 at ends, 1 in the middle
        const env = Math.sin(Math.PI * u);

        for (let j = 0; j < Nz; j++) {
          const p = profile[j];
          const x = sideSign * (width / 2 + p.dx * env);
          positions.push(x, y, p.z);
        }
      }

      // Generate quads between slice i and slice i+1
      for (let i = 0; i < Ny; i++) {
        for (let j = 0; j < Nz; j++) {
          const nextJ = (j + 1) % Nz; // closed loop in profile!

          const v00 = i * Nz + j;
          const v01 = i * Nz + nextJ;
          const v10 = (i + 1) * Nz + j;
          const v11 = (i + 1) * Nz + nextJ;

          if (sideSign > 0) {
            // Right side: counter-clockwise winding
            indices.push(v00, v10, v01);
            indices.push(v01, v10, v11);
          } else {
            // Left side: inverted winding for outward normal
            indices.push(v00, v01, v10);
            indices.push(v01, v11, v10);
          }
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setIndex(indices);
      geom.computeVertexNormals();
      return geom;
    };

    geometries.push(buildSide(1));  // Right side
    geometries.push(buildSide(-1)); // Left side

    return geometries;
  }
}
