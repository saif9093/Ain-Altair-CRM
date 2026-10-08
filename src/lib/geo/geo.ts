/** Geographic helpers: distances, bounding boxes, polygons and search cells. */

export type BBox = [south: number, west: number, north: number, east: number];
export interface LatLng { lat: number; lng: number }

const R = 6371000; // metres

export function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bboxFromRadius(center: LatLng, radiusM: number): BBox {
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  return [center.lat - dLat, center.lng - dLng, center.lat + dLat, center.lng + dLng];
}

export function bboxCenter(b: BBox): LatLng {
  return { lat: (b[0] + b[2]) / 2, lng: (b[1] + b[3]) / 2 };
}

/** Approximate width/height of a bbox in metres. */
export function bboxSizeM(b: BBox): { widthM: number; heightM: number } {
  const c = bboxCenter(b);
  return {
    widthM: haversine({ lat: c.lat, lng: b[1] }, { lat: c.lat, lng: b[3] }),
    heightM: haversine({ lat: b[0], lng: c.lng }, { lat: b[2], lng: c.lng }),
  };
}

export function bboxOfPolygon(poly: LatLng[]): BBox {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of poly) {
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    w = Math.min(w, p.lng); e = Math.max(e, p.lng);
  }
  return [s, w, n, e];
}

/** Ray-casting point-in-polygon. */
export function pointInPolygon(pt: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat, xj = poly[j].lng, yj = poly[j].lat;
    const intersect = yi > pt.lat !== yj > pt.lat && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function inBBox(pt: LatLng, b: BBox): boolean {
  return pt.lat >= b[0] && pt.lat <= b[2] && pt.lng >= b[1] && pt.lng <= b[3];
}

export interface SearchCell {
  id: string;      // stable id used for coverage tracking
  bbox: BBox;
  center: LatLng;
  radiusM: number; // circle that covers the cell
}

/**
 * Split a bbox into a grid of cells of roughly `cellSizeM` metres so providers
 * with result caps (e.g. 60 per query) can cover large areas. Cells outside
 * an optional polygon are dropped. Cell ids are stable for the same grid.
 */
export function gridCells(b: BBox, cellSizeM: number, polygon?: LatLng[], maxCells = 400): SearchCell[] {
  const { widthM, heightM } = bboxSizeM(b);
  let cols = Math.max(1, Math.ceil(widthM / cellSizeM));
  let rows = Math.max(1, Math.ceil(heightM / cellSizeM));
  while (cols * rows > maxCells) {
    cols = Math.max(1, Math.ceil(cols / 1.5));
    rows = Math.max(1, Math.ceil(rows / 1.5));
  }
  const dLat = (b[2] - b[0]) / rows;
  const dLng = (b[3] - b[1]) / cols;
  const cells: SearchCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cb: BBox = [b[0] + r * dLat, b[1] + c * dLng, b[0] + (r + 1) * dLat, b[1] + (c + 1) * dLng];
      const center = bboxCenter(cb);
      if (polygon && polygon.length >= 3) {
        const corners = [center, { lat: cb[0], lng: cb[1] }, { lat: cb[2], lng: cb[3] }, { lat: cb[0], lng: cb[3] }, { lat: cb[2], lng: cb[1] }];
        if (!corners.some((p) => pointInPolygon(p, polygon))) continue;
      }
      const { widthM: w, heightM: h } = bboxSizeM(cb);
      cells.push({ id: cellId(cb), bbox: cb, center, radiusM: Math.ceil(Math.sqrt(w * w + h * h) / 2) });
    }
  }
  return cells;
}

/** Deterministic cell id at ~100 m precision. */
export function cellId(b: BBox): string {
  return b.map((v) => v.toFixed(3)).join(",");
}
