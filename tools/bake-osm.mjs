// Bake a real slice of Gurugram (DLF Cyber City, Cyber Hub, NH-48) from OpenStreetMap into public/osm/gurugram.json.
// Data © OpenStreetMap contributors, ODbL. Run: node tools/bake-osm.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BBOX = [28.4865, 77.0790, 28.5035, 77.0985]; // south, west, north, east
const ORIGIN = { lat: 28.4950, lon: 77.0890 };
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'lantern-game-dev/1.0 (personal non-commercial game; contact via github.com/lftibw)';

const b = BBOX.join(',');
const query = `[out:json][timeout:120];
(
  way["building"](${b}); relation["building"]["type"="multipolygon"](${b});
  way["highway"](${b});
  way["railway"](${b});
  way["leisure"~"park|garden|pitch"](${b});
  way["landuse"](${b});
  way["natural"~"water|wood|scrub"](${b});
  node["amenity"](${b});
);
out geom;`;

async function fetchOverpass() {
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      console.log('fetched from', url);
      return await r.json();
    } catch (e) { console.warn('overpass failed:', url, e.message); }
  }
  throw new Error('all Overpass endpoints failed');
}

// lat/lon → local metres: x east, z south (three.js: -z is north)
const kx = Math.cos((ORIGIN.lat * Math.PI) / 180) * 111320, kz = 110540;
const toXZ = (g) => [+(((g.lon - ORIGIN.lon) * kx).toFixed(1)), +((-(g.lat - ORIGIN.lat) * kz).toFixed(1))];
const flat = (geom) => geom.flatMap(toXZ);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };

const data = await fetchOverpass();
const out = { origin: ORIGIN, bbox: BBOX, attribution: '© OpenStreetMap contributors', buildings: [], roads: [], rails: [], areas: [], amenities: [] };
for (const e of data.elements) {
  const t = e.tags ?? {};
  if (e.type === 'node') { if (t.amenity) out.amenities.push({ p: toXZ(e), t: t.amenity }); continue; }
  // multipolygon buildings: take outer rings
  const rings = e.type === 'relation' ? (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry) : e.geometry ? [e.geometry] : [];
  for (const g of rings) {
    if (g.length < 2) continue;
    if (t.building || t['building:part']) {
      if (g.length < 4) continue;
      out.buildings.push({ p: flat(g), h: num(t.height), lv: num(t['building:levels']), mh: num(t.min_height), t: t.building === 'yes' ? (t.amenity || t.shop || t.office ? 'commercial' : 'yes') : t.building, n: t.name });
    } else if (t.highway) {
      out.roads.push({ p: flat(g), c: t.highway, br: t.bridge && t.bridge !== 'no' ? 1 : 0, l: num(t.layer) ?? 0, ln: num(t.lanes), ow: t.oneway === 'yes' ? 1 : 0, n: t.name });
    } else if (t.railway) {
      out.rails.push({ p: flat(g), c: t.railway, br: t.bridge && t.bridge !== 'no' ? 1 : 0, l: num(t.layer) ?? 0, n: t.name });
    } else {
      const k = t.leisure || (t.natural ? 'n_' + t.natural : t.landuse ? 'l_' + t.landuse : null);
      if (k && g.length >= 4) out.areas.push({ p: flat(g), k });
    }
  }
}
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'osm', 'gurugram.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out));
const tally = (a, k) => Object.entries(a.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {})).sort((x, y) => y[1] - x[1]).slice(0, 10);
console.log({ buildings: out.buildings.length, withHeight: out.buildings.filter((x) => x.h || x.lv).length, roads: out.roads.length, bridges: out.roads.filter((r) => r.br).length, rails: out.rails.length, areas: out.areas.length, amenities: out.amenities.length });
console.log('road classes', tally(out.roads, 'c'));
console.log('building types', tally(out.buildings, 't'));
console.log('rails', tally(out.rails, 'c'), 'area kinds', tally(out.areas, 'k'));
