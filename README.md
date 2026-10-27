# Localpedia

A clone of [Walkipedia](https://www.neil-scott.com/walkipedia/): every Wikipedia article with
coordinates within a 30-minute walk of a place, on a map.

Pure static site, no backend. Data comes live from public APIs:

- Wikipedia geosearch API (articles, descriptions, thumbnails, coordinates)
- Nominatim (place names) and postcodes.io (UK postcodes) for geocoding
- OpenStreetMap tiles via Leaflet

## Run

```
cd site && python3 -m http.server 8000
```

Then open http://localhost:8000. Query strings like `?q=Glasgow` are shareable.

## Layout

- `site/index.html` — page shell
- `site/style.css` — styling, light and dark
- `site/app.js` — geocoding, Wikipedia queries, map and list rendering
