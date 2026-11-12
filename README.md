# Argentina a tus pies · Editor de videos

App web para el club de fans de Luis Miguel **“Argentina a tus pies”**. Sirve para que cualquiera suba un video filmado con el celular y, sin saber editar, le sume intro, final, zócalos y gráficas doradas, y lo exporte listo para Instagram.

Funciona entera en el navegador: los videos no se suben a ningún servidor. Anda en celulares (iPhone con Safari, Android con Chrome) y en compus.

## Cómo se usa

1. **Video**: subís el video, lo recortás si hace falta y elegís el formato (Reels/Historias 9:16, Feed 4:5 o Cuadrado 1:1) y la transición (fundido, fundido a negro o corte).
2. **Intro** y 3. **Final**: elegís uno de la biblioteca, el **título dorado editable** (generador con letras doradas, brillos y glitter) o subís un MP4 propio.
4. **Gráficas**: zócalos, título dorado, mosca/logo, brillos y marco dorado. El **logo del club** se sube con fondo negro y se suma en modo *add* (el negro desaparece).
5. **Exportar**: crea el video y abre *Guardar / Compartir* (en el iPhone permite guardarlo en Fotos o mandarlo directo a Instagram).

La exportación se hace en tiempo real, así que tarda lo mismo que dura el video. Mientras tanto la pantalla tiene que quedar encendida, sin cambiar de app.

## Sumar intros y finales a la biblioteca

1. Copiá el MP4 en `assets/library/` (lo ideal es 1080×1920 con fondo negro; también se aceptan otros tamaños: los horizontales se muestran completos sobre negro).
2. Opcional: agregá una miniatura `.jpg` de unos 270 px de ancho.
3. Agregá una entrada en `assets/library.json`:

```json
{ "id": "intro-recital", "name": "Recital 2026", "src": "assets/library/intro-recital.mp4", "poster": "assets/library/intro-recital.jpg" }
```

en `intros` o en `outros`. El audio de cada clip se funde con el del video.

Otra forma de hacerlo: en la app elegí **Título dorado (editable)**, escribí el texto y tocá **“Bajar este título como MP4”**. Ese archivo se puede sumar a la biblioteca.

### Volver a renderizar los clips base

Los clips que vienen incluidos se generan con el mismo motor de la app:

```bash
npm i puppeteer-core
node tools/render-clips.mjs . /ruta/a/chrome   # necesita ffmpeg
```

Para cambiar los textos, editá `CLIPS` en `tools/render-clips.mjs`.

## Técnica

- HTML/CSS/JS sin dependencias ni build (módulos ES). Se puede publicar en GitHub Pages o Cloudflare Pages tal cual.
- El render se hace en Canvas 2D. El audio se mezcla con Web Audio (con fundidos programados) y la grabación usa `MediaRecorder` (MP4 H.264/AAC en Chrome y Safari).
- `js/gold.js`: letras doradas (bisel, halo, barrido de luz y destellos). `js/particles.js`: glitter. `js/graphics.js`: tarjetas, zócalos y overlays. `js/engine.js`: línea de tiempo, preview y exportación. `js/app.js`: interfaz.
- Tipografías: Cinzel y Cormorant Garamond (SIL Open Font License, en `assets/fonts`).
