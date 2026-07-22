# CLAUDE.md — Tablero MexJet

Contexto del proyecto para retomar el trabajo en futuras sesiones.

## Qué es

Tablero personal de trabajo para **Pablo Velarde** (MexJet). Aplicación web
estática de una sola página, servida por **GitHub Pages** en:

- https://pablovelardev-coder.github.io/tablero-mexjet/

## Arquitectura

- **Frontend:** todo vive en un único `index.html` (HTML + CSS + JavaScript
  vanilla, sin paso de build ni framework). Se importa
  `@supabase/supabase-js@2` como módulo ES desde `https://esm.sh`.
- **Backend / datos:** [Supabase](https://supabase.com).
  - Proyecto: `hiofkvotqppahhzoaybr` (`https://hiofkvotqppahhzoaybr.supabase.co`).
  - La clave incrustada en el HTML es la **anon key** (pública, de cliente).
    Por sí sola no da acceso a datos: todo está protegido con RLS.
- **Hosting:** GitHub Pages sirve la rama por defecto directamente (no hay CI).

### Autenticación

- Correo + contraseña (`sb.auth.signInWithPassword`).
- La primera vez, si el login falla, intenta `signUp` automáticamente: crea la
  cuenta con la contraseña escrita.
- Requiere tener **desactivado "Confirm email"** en Supabase para que el
  usuario entre directo sin confirmar correo (hay un mensaje que lo recuerda).

### Base de datos

Tabla **`boards`** con:

| Columna       | Notas                                             |
|---------------|---------------------------------------------------|
| `user_id`     | dueño de la fila (FK a auth.users)                |
| `kind`        | `ventas` \| `direccion` \| `personal`             |
| `data`        | JSON con todo el estado del tablero               |
| `updated_at`  | timestamp de última escritura                     |

- Clave de conflicto para upsert: `user_id,kind`.
- **RLS activo:** cada usuario solo lee/escribe sus propias filas.
- **Realtime:** el cliente se suscribe a `postgres_changes` sobre `boards`
  para sincronizar entre pestañas/dispositivos. Ignora el "eco" de la propia
  escritura durante 1.5s (`lastWrite`).

### Forma del JSON `data`

```js
{
  cards:   [{ id, title, meta, col }],          // tarjetas del pipeline (Kanban)
  tasks:   [{ id, due, text, frente, status }], // pendientes
  rems:    [{ id, date, text, frente }],        // recordatorios
  frentes: [{ name, pct }]                       // frentes de trabajo (avance %)
}
```

## Funcionalidad

Tres tableros conmutables — **Ventas · Dirección · Personal** — cada uno con
sus propias columnas de pipeline y su propio orden de pestañas.

**Columnas de pipeline por tablero** (`COLS`):
- **Ventas:** Prospecto → Calificado → Propuesta enviada → Negociación → Ganado / Perdido
- **Dirección:** Nuevo → En proceso → En espera → Resuelto
- **Personal:** Ideas → Por hacer → En curso → Hecho

**Vistas / pestañas** (`TABS`, el orden cambia por tablero):
- **Pipeline** (Kanban con drag & drop; se etiqueta "Temas"/"Tablero" en
  Dirección/Personal).
- **Pendientes** — tabla con fecha de vencimiento; vencidas en rojo, próximas
  (≤7 días) en ámbar, hechas tachadas. Estados: Por hacer / En curso /
  Bloqueada / Hecha.
- **Recordatorios** — acciones programadas por fecha.
- **Frentes** — barras de avance con slider de porcentaje.

**Guardado:** con debounce de 400ms (`save()` → `upsert()`); indicador de
estado en la cabecera ("guardando…" / "✓ sincronizado HH:MM" / "⚠︎ error").

## Estructura del repositorio

```
.
├── index.html   # toda la app (markup + estilos + lógica)
├── README.md    # descripción breve
└── CLAUDE.md    # este archivo
```

## Convenciones de trabajo

- **No hay build ni dependencias locales:** se edita `index.html` directamente.
- Para probar en local basta abrir `index.html` en el navegador (o servir la
  carpeta con cualquier servidor estático); la auth y los datos van contra el
  Supabase real.
- Estilos con variables CSS y soporte de **tema claro/oscuro** vía
  `prefers-color-scheme`.
- IDs cortos con `uid()`; escape de HTML con `esc()` al pintar contenido del
  usuario.
- **No** meter datos de negocio ni secretos en el repo: solo la anon key
  pública puede aparecer en el cliente.

## Historial

1. `cf982ae` — Tablero MexJet: Ventas, Dirección y Personal (versión inicial).
2. `415e90a` — Mensaje de error claro cuando la contraseña es incorrecta y el
   registro está apagado.
