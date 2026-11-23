/**
 * stl-exporter.js - Fast Binary STL Exporter for 3D Slicers (Bambu Studio, Cura, PrusaSlicer)
 */

class STLExporter {
  /**
   * Exports an array of THREE.BufferGeometry into a binary STL Blob,
   * oriented with tray sitting flat on the print bed (Z-up, bottom at Z=0).
   */
  static exportToSTL(geometries, filename = 'bandeja_parametrica.stl') {
    // 1. Collect all triangles from all geometries
    const triangles = [];

    geometries.forEach(geom => {
      // Ensure geometry has position and normal attributes
      let g = geom.clone();
      // If indexed, convert to non-indexed for simple triangle reading
      if (g.index) {
        g = g.toNonIndexed();
      }
      g.computeVertexNormals();

      const pos = g.attributes.position.array;
      const norm = g.attributes.normal.array;

      for (let i = 0; i < pos.length; i += 9) {
        // In Three.js scene: X is width, Y is height(up), Z is -depth
        // In 3D Slicer (STL): X is width, Y is depth, Z is height(up)
        // Transform vertices:
        // stlX = threeX
        // stlY = -threeZ
        // stlZ = threeY
        const v1 = {
          x: pos[i],
          y: -pos[i + 2],
          z: pos[i + 1]
        };
        const v2 = {
          x: pos[i + 3],
          y: -pos[i + 5],
          z: pos[i + 4]
        };
        const v3 = {
          x: pos[i + 6],
          y: -pos[i + 8],
          z: pos[i + 7]
        };

        // Normal
        const n = {
          x: norm[i],
          y: -norm[i + 2],
          z: norm[i + 1]
        };

        triangles.push({ n, v1, v2, v3 });
      }
    });

    // 2. Find min Z to align bottom flush with Z = 0
    let minZ = Infinity;
    triangles.forEach(t => {
      minZ = Math.min(minZ, t.v1.z, t.v2.z, t.v3.z);
    });

    // Shift so minimum Z is 0 (sits flat on print bed)
    if (isFinite(minZ) && minZ !== 0) {
      triangles.forEach(t => {
        t.v1.z -= minZ;
        t.v2.z -= minZ;
        t.v3.z -= minZ;
      });
    }

    // 3. Allocate Binary Buffer
    // 80 bytes header + 4 bytes uint32 count + 50 bytes per triangle
    const bufferSize = 84 + triangles.length * 50;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Write header (80 bytes)
    const headerString = 'TrayForge 3D Parametric Tray Generator - binary STL';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < headerString.length ? headerString.charCodeAt(i) : 0);
    }

    // Write triangle count (uint32)
    view.setUint32(80, triangles.length, true); // little-endian

    // Write triangles
    let offset = 84;
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i];

      // Normal vector (3 floats = 12 bytes)
      view.setFloat32(offset, t.n.x, true);
      view.setFloat32(offset + 4, t.n.y, true);
      view.setFloat32(offset + 8, t.n.z, true);
      offset += 12;

      // Vertex 1 (12 bytes)
      view.setFloat32(offset, t.v1.x, true);
      view.setFloat32(offset + 4, t.v1.y, true);
      view.setFloat32(offset + 8, t.v1.z, true);
      offset += 12;

      // Vertex 2 (12 bytes)
      view.setFloat32(offset, t.v2.x, true);
      view.setFloat32(offset + 4, t.v2.y, true);
      view.setFloat32(offset + 8, t.v2.z, true);
      offset += 12;

      // Vertex 3 (12 bytes)
      view.setFloat32(offset, t.v3.x, true);
      view.setFloat32(offset + 4, t.v3.y, true);
      view.setFloat32(offset + 8, t.v3.z, true);
      offset += 12;

      // Attribute byte count (2 bytes uint16 = 0)
      view.setUint16(offset, 0, true);
      offset += 2;
    }

    // 4. Trigger download
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }
}
