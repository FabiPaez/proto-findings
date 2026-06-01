# Sistema de Hallazgos SGC - OFIJU

Aplicacion web para reportar hallazgos, sugerencias y oportunidades de mejora. Replica el flujo del formulario actual de Google Apps Script y agrega una base SQLite para seguimiento, estados y futuras estadisticas.

## Stack

- React + Vite
- Node.js + Express
- SQLite embebido con `better-sqlite3`

## Primer uso

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

La web queda en `http://127.0.0.1:5173` y la API en `http://127.0.0.1:4000`.

Credenciales iniciales de admin, si no cambia `.env`:

## Roles

- Usuarios generales: pueden cargar reportes y ver el estado de todos los hallazgos.
- Administradores: pueden revisar, clasificar, asignar responsable, cambiar estado, cargar plazos, eficacia, acciones y observaciones.

## Campos inspirados en el formulario actual

- Quien reporta
- Fecha del hallazgo
- Area o proceso
- Sistema o lugar
- Ubicacion concreta
- Descripcion breve
- Urgencia aparente
- Evidencia por link
- Tipo SGC, estado, responsable, plazo, accion requerida, eficacia, fecha de cierre y observaciones

## Evidencia

El reporte permite agregar un link de evidencia y, opcionalmente, cargar una captura PNG, JPG o WebP de hasta 5 MB. Los archivos se guardan en `data/uploads`, carpeta excluida del repositorio.

## Despliegue

`.env`, `data/`, `dist/` y `node_modules/` estan excluidos en `.gitignore`.

Vercel puede publicar la interfaz y ejecutar la API como funcion serverless, pero SQLite embebido y archivos subidos no son persistentes en ese entorno. Para uso real con SQLite local conviene desplegar en un servidor con disco persistente.
