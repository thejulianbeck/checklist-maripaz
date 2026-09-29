# Checklist Maripaz — Editorial KDP

PWA interactiva del checklist **solo** para *Maripaz y la Navidad que Casi Desaparece*.

- **89 ítems** desde `CHECKLIST-Maripaz.md` (sin inventar)
- Progreso **ponderado** (`weight_pct`, suma 100 %); N/A = 0 %
- Sync entre dispositivos vía **Firebase Realtime Database** (plan Spark, sin facturación)
- Instalable en iPhone/iPad (Safari → Añadir a pantalla de inicio)

## Live

https://thejulianbeck.github.io/checklist-maripaz/

## Sync

- Endpoint REST: `https://checklist-maripaz-default-rtdb.firebaseio.com/maripaz.json`
- Estado: `{ project, updatedAt, checked, notes }` (merge por `updatedAt`; localStorage de respaldo)
- Polling ~20 s (pausa con pestaña oculta); PUT con debounce
- **Aviso:** la ruta `/maripaz` es de lectura/escritura pública por diseño (uso familiar). No guardes secretos ahí.

## Local

Abre `index.html` con un servidor estático (o GitHub Pages). Sin build / sin npm.

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Shell UI |
| `styles.css` | UI editorial |
| `app.js` | Checklist, progreso ponderado, sync Firebase REST |
| `data.json` | Ítems + pesos |
| `weights.json` | Fuente de pesos Editorial KDP |
| `manifest.webmanifest` / `sw.js` / `icons/` | PWA |
