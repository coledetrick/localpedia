// Localpedia — Wikipedia articles within a 30-minute walk.
// Pure client-side: Nominatim + postcodes.io for geocoding, Wikipedia geosearch for articles, OSM tiles via Leaflet.

const WALK_METRES = 2400;           // ~30 min at 80 m/min
const WIKI_LIMIT = 500;             // max for anonymous API users
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

const $ = (id) => document.getElementById(id);
const els = {
  form: $('search-form'), q: $('q'), nearMe: $('near-me'), random: $('random'), lang: $('lang'),
  searchArea: $('search-area'), status: $('status'), list: $('list'), count: $('count'),
  filter: $('filter'), sort: $('sort'), intro: $('intro'),
};

let map, markerLayer, centerMarker, circle;
let articles = [];           // current result set
let markersById = new Map();
let centre = null;

// ---------- map ----------
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([54.5, -3], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('moveend', () => { if (centre) els.searchArea.hidden = false; });
}

function setCentre(lat, lon, label) {
  centre = { lat, lon };
  if (centerMarker) centerMarker.remove();
  if (circle) circle.remove();
  centerMarker = L.circleMarker([lat, lon], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#000000', fillOpacity: 1 })
    .addTo(map).bindTooltip(label || 'Here');
  circle = L.circle([lat, lon], { radius: WALK_METRES, color: '#10B981', weight: 1.5, fillColor: '#10B981', fillOpacity: 0.06 }).addTo(map);
  map.fitBounds(circle.getBounds());
}

// ---------- status ----------
function status(msg) {
  els.status.hidden = !msg;
  els.status.textContent = msg || '';
}

// ---------- geocoding ----------
async function geocode(query) {
  const q = query.trim();
  if (UK_POSTCODE.test(q)) {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q.replace(/\s+/g, ''))}`);
    if (r.ok) {
      const { result } = await r.json();
      return { lat: result.latitude, lon: result.longitude, label: `${result.postcode}, ${result.admin_district}` };
    }
  }
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'Accept-Language': els.lang.value } });
  const hits = await r.json();
  if (!hits.length) throw new Error(`Couldn't find "${q}"`);
  return { lat: +hits[0].lat, lon: +hits[0].lon, label: hits[0].display_name.split(',').slice(0, 2).join(',') };
}

// ---------- wikipedia ----------
function wikiBase() { return `https://${els.lang.value}.wikipedia.org`; }

async function fetchArticles(lat, lon, radius = WALK_METRES) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: Math.min(radius, 10000), ggslimit: WIKI_LIMIT,
    prop: 'coordinates|description|pageimages', piprop: 'thumbnail', pithumbsize: 120, pilimit: WIKI_LIMIT, colimit: WIKI_LIMIT,
  });
  const r = await fetch(`${wikiBase()}/w/api.php?${params}`);
  const data = await r.json();
  const pages = Object.values(data.query?.pages || {});
  return pages
    .filter((p) => p.coordinates?.length)
    .map((p) => ({
      id: p.pageid,
      title: p.title,
      desc: p.description || '',
      thumb: p.thumbnail?.source || null,
      lat: p.coordinates[0].lat,
      lon: p.coordinates[0].lon,
      url: `${wikiBase()}/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    }));
}

async function randomPlace() {
  // Grab random articles until one has coordinates.
  for (let i = 0; i < 5; i++) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*',
      generator: 'random', grnnamespace: 0, grnlimit: 50, prop: 'coordinates',
    });
    const r = await fetch(`${wikiBase()}/w/api.php?${params}`);
    const data = await r.json();
    const hit = Object.values(data.query?.pages || {}).find((p) => p.coordinates?.length);
    if (hit) return { lat: hit.coordinates[0].lat, lon: hit.coordinates[0].lon, label: hit.title };
  }
  throw new Error('No random place found, try again');
}

// ---------- distance ----------
function haversine(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(m) {
  const mins = Math.round(m / 80);
  return m < 1000 ? `${Math.round(m)} m · ${mins} min` : `${(m / 1000).toFixed(1)} km · ${mins} min`;
}

// ---------- rendering ----------
function render() {
  const term = els.filter.value.trim().toLowerCase();
  let rows = articles.filter((a) => !term || a.title.toLowerCase().includes(term) || a.desc.toLowerCase().includes(term));
  rows = els.sort.value === 'alpha'
    ? rows.sort((a, b) => a.title.localeCompare(b.title))
    : rows.sort((a, b) => a.dist - b.dist);

  els.count.textContent = rows.length === articles.length ? `(${articles.length})` : `(${rows.length} of ${articles.length})`;
  els.list.innerHTML = '';
  for (const a of rows) {
    const li = document.createElement('li');
    li.dataset.id = a.id;
    li.innerHTML = `
      ${a.thumb ? `<img class="thumb" src="${a.thumb}" alt="" loading="lazy">` : ''}
      <div class="title"><a href="${a.url}" target="_blank" rel="noopener">${esc(a.title)}</a><span class="dist">${fmtDist(a.dist)}</span></div>
      ${a.desc ? `<div class="desc">${esc(a.desc)}</div>` : ''}`;
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      const m = markersById.get(a.id);
      if (m) { map.panTo([a.lat, a.lon]); m.openPopup(); }
      highlight(a.id);
    });
    els.list.appendChild(li);
  }
}

function highlight(id) {
  for (const li of els.list.children) li.classList.toggle('active', +li.dataset.id === id);
  const li = els.list.querySelector(`[data-id="${id}"]`);
  if (li) li.scrollIntoView({ block: 'nearest' });
}

function plot() {
  markerLayer.clearLayers();
  markersById.clear();
  for (const a of articles) {
    const m = L.circleMarker([a.lat, a.lon], { radius: 7, color: '#ffffff', weight: 1.5, fillColor: '#10B981', fillOpacity: 0.95 }).addTo(markerLayer);
    m.bindPopup(`<strong><a href="${a.url}" target="_blank" rel="noopener">${esc(a.title)}</a></strong>
      ${a.desc ? `<div class="desc">${esc(a.desc)}</div>` : ''}<div class="desc">${fmtDist(a.dist)}</div>`);
    m.on('click', () => highlight(a.id));
    markersById.set(a.id, m);
  }
}

function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- orchestration ----------
async function showPlace({ lat, lon, label }, { radius = WALK_METRES, fit = true } = {}) {
  status('Mapping the articles…');
  els.intro.hidden = true;
  els.searchArea.hidden = true;
  try {
    if (fit) setCentre(lat, lon, label);
    const found = await fetchArticles(lat, lon, radius);
    const origin = centre || { lat, lon };
    articles = found.map((a) => ({ ...a, dist: haversine(origin, a) }));
    plot();
    render();
    status(articles.length ? '' : 'Wikipedia has nothing with coordinates here.');
  } catch (err) {
    status(err.message || 'Something went wrong');
  }
}

async function search(q, { pushUrl = true } = {}) {
  if (!q.trim()) return;
  els.q.value = q;
  status('Finding the place…');
  try {
    const place = await geocode(q);
    if (pushUrl) history.replaceState(null, '', `?q=${encodeURIComponent(q.trim())}`);
    await showPlace(place);
  } catch (err) {
    status(err.message);
  }
}

els.form.addEventListener('submit', (e) => { e.preventDefault(); search(els.q.value); });

els.nearMe.addEventListener('click', () => {
  if (!navigator.geolocation) return status('Your browser has no geolocation');
  status('Asking your browser where you are…');
  navigator.geolocation.getCurrentPosition(
    (pos) => { history.replaceState(null, '', location.pathname); els.q.value = ''; showPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'You' }); },
    () => status('Location not shared'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

els.random.addEventListener('click', async () => {
  status('Picking somewhere…');
  try { const p = await randomPlace(); history.replaceState(null, '', location.pathname); els.q.value = p.label; showPlace(p); }
  catch (err) { status(err.message); }
});

els.searchArea.addEventListener('click', () => {
  const c = map.getCenter();
  const b = map.getBounds();
  const radius = Math.round(haversine({ lat: c.lat, lon: c.lng }, { lat: b.getNorth(), lon: c.lng }));
  centre = { lat: c.lat, lon: c.lng };
  if (circle) circle.remove();
  if (centerMarker) centerMarker.remove();
  showPlace({ lat: c.lat, lon: c.lng }, { radius, fit: false });
});

els.filter.addEventListener('input', render);
els.sort.addEventListener('change', render);
els.lang.addEventListener('change', () => { if (centre) showPlace({ ...centre, label: els.q.value }, { fit: false }); });

initMap();
const initialQ = new URLSearchParams(location.search).get('q');
if (initialQ) search(initialQ, { pushUrl: false });
