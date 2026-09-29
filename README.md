# Checklist Maripaz — Editorial KDP

PWA interactiva del checklist **solo** para *Maripaz y la Navidad que Casi Desaparece*.

- **89 ítems** desde `CHECKLIST-Maripaz.md` (sin inventar)
- Progreso **ponderado** (`weight_pct`, suma 100 %); N/A = 0 %
- Sync entre dispositivos vía ExtendsClass JSON Storage (`faeafdc`)
- Instalable en iPhone/iPad (Safari → Añadir a pantalla de inicio)

## Live

https://thejulianbeck.github.io/checklist-maripaz/

## Local

Abre `index.html` con un servidor estático (o GitHub Pages). Sin build / sin npm.

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | Shell UI |
| `styles.css` | UI editorial |
| `app.js` | Checklist, progreso ponderado, sync |
| `data.json` | Ítems + pesos |
| `weights.json` | Fuente de pesos Editorial KDP |
| `manifest.webmanifest` / `sw.js` / `icons/` | PWA |

