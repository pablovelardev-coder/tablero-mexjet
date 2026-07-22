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

## Integración multi-dispositivo (Mac ↔ iPhone)

Objetivo de Pablo: continuar el **mismo trabajo** desde Mac y desde iPhone sin
perder el contexto. Para lograrlo hay **tres memorias** complementarias:

1. **Este `CLAUDE.md`** (en el repo) — memoria de *cómo trabajamos*: contexto,
   decisiones y flujos. Viaja con el código; cualquier sesión de Claude abierta
   sobre este repo lo lee al arrancar, en cualquier dispositivo. Para
   conservarlo hay que **hacer commit y push al terminar**.
2. **`boards` en Supabase** — memoria de los *datos vivos* del tablero (tareas,
   tarjetas, frentes). Viaja con la cuenta; la app los sincroniza en tiempo real
   (Realtime) entre dispositivos.
3. **`session_log` en Supabase** — bitácora de cada sesión de Claude (resúmenes
   de contexto). Es la memoria "de conversación" que **sí** viaja entre
   dispositivos (ver más abajo).

### Acceso directo a Supabase desde Claude

Las sesiones de Claude tienen conectado el proyecto de Supabase por un
**conector de administrador** (no por el login de la app). Esto significa:

- **No depende del dispositivo:** funciona igual desde una sesión en Mac o en
  iPhone — es el puente real entre ambos.
- Permite **leer y escribir los tableros directamente** (salta el RLS): agregar,
  mover, editar o cerrar tareas y tarjetas por chat.
- **Solo se usa cuando Pablo lo pide explícitamente.**

Cómo ubicar los datos: la tabla `boards` tiene una fila por `kind`
(`ventas` / `direccion` / `personal`), todas del mismo usuario — basta filtrar
por `kind`. (El `user_id` no hace falta para operar; si se necesita, se consulta
al momento.)

Ejemplos de lo que Pablo puede pedir desde cualquier dispositivo:
- "¿Qué pendientes vencidos tengo en Dirección?"
- "Agrega una tarjeta en el pipeline de Ventas: …"
- "Marca como Hecha la tarea …" / "Mueve la tarjeta … a Negociación".

> Nota: el mismo Supabase aloja además otro proyecto (tablas `users`,
> `matches`, `predictions` — una quiniela de fútbol) y una tabla `assets`. No
> tienen que ver con el tablero; no tocarlas salvo que Pablo lo pida.

### Bitácora de sesiones (`session_log`) — memoria compartida entre dispositivos

Para que el contexto no dependa de recordar un chat, existe la tabla
`public.session_log` en Supabase (RLS por usuario, igual que `boards`). Es la
**memoria compartida real** entre Mac, iPhone y web.

- Columnas: `id`, `user_id`, `device`, `session_ref`, `summary`, `tags`,
  `created_at`.
- **Al abrir una sesión** (cualquier dispositivo): leer las últimas entradas
  para retomar el hilo —
  `select summary, device, created_at from session_log order by created_at desc limit 5;`
- **Al cerrar una sesión** con algo relevante: escribir un resumen breve (qué se
  hizo, decisiones, pendientes). Filtrar/insertar por `user_id`.
- Así, aunque el texto crudo de un chat no viaje entre dispositivos, **el
  resumen sí**: vive en Supabase y lo lee cualquier sesión.

Aclaración sobre "hacerlo desde la Mac": documentar los *Flujos de trabajo*
desde la Mac es **puntual, no una regla permanente** — solo porque ese contexto
todavía vive en chats previos de la Mac. Una vez volcado (a este `CLAUDE.md` o a
`session_log`), **el dispositivo deja de importar** y se puede continuar desde
donde sea. En adelante, el hábito es simplemente: leer la bitácora al empezar y
escribirla al terminar.

### Pendiente abierto

- [ ] **Sección "Flujos de trabajo"** — rutinas recurrentes de Pablo y
  preferencias de cómo debe trabajar Claude con él. Se completará **desde la
  Mac** (ver el pendiente homónimo en el tablero de Dirección, etiqueta
  `Claude`).

## Historial

1. `cf982ae` — Tablero MexJet: Ventas, Dirección y Personal (versión inicial).
2. `415e90a` — Mensaje de error claro cuando la contraseña es incorrecta y el
   registro está apagado.
3. `fd9706d` — Agrega `CLAUDE.md` con el contexto del proyecto.
4. `628e4b7` — Documenta la integración Mac ↔ iPhone y el acceso admin a Supabase.
5. Crea la bitácora `session_log` (memoria compartida) y afina la sección de
   integración multi-dispositivo.
