# Simulador de Sombras FV · Nikola (v0.3)

Simulador web de sombras por panel para instalaciones fijas (techo, suelo y carport).

## Qué hace
- Casa configurable: pisos, alto por piso, ancho/fondo, rotación, techo plano / 1 agua / 2 aguas / 4 aguas, pendiente, alero, parapeto.
- Campos de paneles ubicados libremente (arrastrables): coplanares al faldón o sobre bases inclinables 10–15°, 15–30°, 30–60°.
- Objetos que dan sombra (árbol, poste, edificio vecino, muro, chimenea) arrastrables, con cota en vivo hasta la casa.
- Sombra por celda (72 celdas/módulo) con raytracing analítico, difusa isotrópica bloqueada, pérdida eléctrica con 3 diodos bypass.
- Análisis instante / día / año. Año con cielo despejado, archivo de clima horario o PVGIS (TMY, vía `/api/pvgis`).
- Clima: archivos del **Explorador Solar** (Descargas → “Datos Horarios TMY SAM” o “Datos Horarios PVsyst”), EPW, PVGIS CSV/JSON
  y CSV genéricos. Detecta zona horaria y desfase horario automáticamente. Transposición Perez (difusa circunsolar sombreada como la directa).
- Modelo eléctrico detallado: curva IV por celda (diodo simple ajustado a la ficha), 3 diodos bypass, strings en serie,
  strings en paralelo por MPPT, ventana de voltaje del inversor, temperatura (NOCT).
- Escenarios: sin sombra, configuración actual, string sin optimizadores, optimizadores en todos. Recomendaciones automáticas:
  dónde poner optimizadores (selectivos, tipo buck) y qué módulos conviene eliminar.
- Guardar/abrir proyecto (.json) y exportar CSV.

## Desarrollo
```bash
npm install
npm run dev          # http://localhost:5173 (sin /api)
npx vercel dev       # incluye la función /api/pvgis
```

## Publicar en Vercel
1. Sube esta carpeta a un repositorio de GitHub.
2. En vercel.com → Add New → Project → importa el repositorio. Vercel detecta Vite automáticamente
   (Build: `npm run build`, Output: `dist`). La carpeta `api/` se publica como función serverless.
3. Cada `git push` a `main` vuelve a publicar.

## Estructura
- `src/engine/engine.ts`  — sol (NOAA), cielo despejado, intersecciones, sombra por celda, modelo bypass.
- `src/engine/project.ts` — modelo del proyecto, geometría de la casa y techos, campos, obstáculos, distancias.
- `src/engine/electrical.ts` — curvas IV, bypass, strings, MPPT, optimizadores, análisis marginal.
- `src/engine/weather.ts` — lectura de archivos de clima y alineación horaria.
- `src/engine/sim.ts` / `worker.ts` — simulación día/año en un Web Worker.
- `src/components/*` — visor 3D (react-three-fiber), barra lateral, resultados.
- `api/pvgis.ts` — proxy a PVGIS TMY (evita CORS y cachea 30 días).
