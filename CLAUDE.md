# CLAUDE.md — Tablero MexJet

Contexto del proyecto para retomar el trabajo en futuras sesiones.

> **Este archivo es la puerta de entrada (índice).** Léelo primero y usa el
> mapa de abajo para ir directo a lo que necesitas, en vez de escanear todo.
> Para lo que cambia seguido (rutinas, decisiones, estado de asuntos), la
> fuente viva es `session_log` en Supabase — aquí solo va lo estable.

## Mapa rápido — dónde vive cada cosa

| Necesito… | Está en | Cómo se llega |
|---|---|---|
| Cómo funciona la app | Este archivo | Secciones *Arquitectura* y *Funcionalidad* |
| Tareas, pipeline, recordatorios | Supabase → `boards` | Filtrar por `kind` |
| Qué pasó en sesiones previas | Supabase → `session_log` | `order by created_at desc limit 5` |
| Definición de una rutina | Supabase → `session_log` | `where 'receta' = any(tags)` |
| Acciones que quedaron encargadas | Supabase → `session_log` | `where 'accion-pendiente' = any(tags)` |
| Archivos locales de rutinas | **Solo en la Mac** | `~/.claude/scheduled-tasks/` |
| Conocimiento por entidad (wiki) | **Pendiente** — ver *Huecos* | — |

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
  cards:   [{ id, title, meta, notes, col, frente,
              labels: [],                        // etiquetas
              checklist: [{ id, text, done }] }],// tarjetas del pipeline (Kanban)
  tasks:   [{ id, due, text, frente, status }],  // pendientes
  rems:    [{ id, date, text, frente }],         // recordatorios
  frentes: [{ name, pct }]                       // frentes de trabajo (avance %)
}
```

Las tarjetas también pueden llevar recordatorios propios (con fecha), además de
los del arreglo `rems` a nivel tablero.

## Funcionalidad

Tres tableros conmutables — **Ventas · Dirección · Personal** — cada uno con
sus propias columnas de pipeline y su propio orden de pestañas.

**Columnas de pipeline por tablero** (`COLS`):
- **Ventas:** Prospecto → Calificado → Propuesta enviada → Negociación → Ganado / Perdido → Archivo
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
4. **Vault de conocimiento (Obsidian + git)** — notas por *entidad* (clientes,
   contratos, proveedores). **En construcción**; ver *Huecos conocidos*.

### La regla que decide si algo viaja

> **Viaja lo que vive en base de datos o servicio. No viaja lo que vive en el
> disco de la Mac.**

| Sí viaja (accesible desde cualquier sesión) | No viaja (solo en la Mac) |
|---|---|
| `boards`, `session_log` (Supabase) | `~/.claude/scheduled-tasks/` |
| Gmail, Google Calendar, Drive | El vault de Obsidian (hasta que sea repo git) |
| Rutinas *cloud* (Routines con `trig_…`) | El CSV del CRM |
| Este repo (`CLAUDE.md`, código) | Rutinas *locales* (scheduled-tasks) |

Corolario práctico: una sesión en la nube o en el iPhone **no puede** leer ni
editar archivos de la Mac. Si algo requiere disco local, se hace desde una
sesión de Claude Code corriendo **en la Mac** (terminal), no desde la nube.

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

## Rutinas automáticas

Arquitectura **híbrida**: rutinas en la nube (corren solas, no dependen de que
la Mac esté abierta) y rutinas locales (necesitan la Mac encendida porque tocan
archivos). El catálogo completo con el prompt exacto de cada una está en
`session_log` con el tag `receta`.

### Rutinas cloud (Routines de Claude Code, con `trigger_id`)

Seis activas, todas de lunes a viernes. Cinco disparan a las **07:00
America/Monterrey** (`cron '0 13 * * 1-5'` en UTC) y una a las 08:16:

| Rutina | Contenido |
|---|---|
| Parte matutino completo | agenda + flota + pendientes + leads |
| Resumen matutino | agenda + pendientes + leads |
| Estatus de flota + incidencias y quejas | operación del día |
| Pendientes de hoy — Dirección | tablero `direccion` |
| Pendientes de hoy — Ventas | tablero `ventas` |
| Monitoreo de buzón general (08:16) | correo entrante |

> ⚠️ **Solapamiento detectado (2026-08-01):** cinco de estas seis corren a la
> misma hora y su contenido se traslapa — *Parte matutino completo* ya incluye
> lo que entregan *Resumen matutino*, *Pendientes Dirección*, *Pendientes
> Ventas* y buena parte de *Flota*. Además, solo algunas mandan
> `PushNotification`; las demás tienen el canal de notificación **sin
> configurar**, que es la razón por la que su resultado no llega al teléfono.
> Pendiente: consolidar y dejar el push encendido en las que sobrevivan.

### Rutinas locales (`~/.claude/scheduled-tasks/`, solo Mac)

- **Espejo leads → CRM + Obsidian** (activa): copia los leads nuevos del tablero
  Ventas al CSV del CRM y al vault de Obsidian, *cuando la Mac está abierta*.
- Varias tareas *one-time* ya cumplidas y dos rutinas desactivadas por haber
  sido consolidadas en las cloud. Los nombres incluyen datos de terceros, así
  que **no se listan aquí** (repo público): están en `session_log`.

## Patrones de trabajo establecidos

- **Registrar al cerrar.** Toda sesión con algo relevante escribe un resumen en
  `session_log`. Sin eso, el contexto no viaja.
- **Triple registro de un compromiso.** Un pendiente con fecha se anota en
  Calendar (alerta), en `boards` (seguimiento) y en `session_log` (memoria).
  Cada capa tiene una función distinta; no es duplicación ociosa.
- **Buzón de acciones pendientes.** Si una acción se bloquea en un dispositivo
  (típicamente por un conector que pide aprobación), se deja encargada en
  `session_log` con tag `accion-pendiente` y las instrucciones completas. Otro
  dispositivo la ejecuta y la cierra con una entrada `accion-hecha`, para no
  duplicarla.
- **Confirmar antes de actuar hacia afuera.** Los correos a terceros se
  redactan como borrador y se envían solo con visto bueno explícito.

## Conectores y su comportamiento

Claude opera con Supabase, Gmail, Google Calendar y Drive. Nota operativa: los
conectores **se reconectan bajo identidades distintas** y, cuando eso pasa,
vuelven a pedir aprobación aunque ya se hubiera dado "permitir siempre". El
síntoma es un error de *approval required* en medio de una tarea. La salida es
reautorizar y reintentar, o dejar la acción en el buzón (ver patrón arriba).

## Huecos conocidos

- [ ] **Capa de conocimiento (`/wiki`).** Hoy la memoria es *episódica* (qué
  pasó tal día) pero no *semántica* (qué sé de tal cliente). Reconstruir un
  asunto obliga a escanear muchas entradas. Falta una nota por entidad que se
  actualice en vez de acumularse.
- [ ] **Capa de evidencia (`/raw`).** No hay dónde guardar los originales (PDFs
  oficiales, imágenes de tickets, mensajes recibidos). Se han perdido fuentes
  que luego no se pudieron consultar.
- [ ] **Vault de Obsidian atado a la Mac.** Mientras no sea repo git, rompe el
  objetivo de independencia de dispositivo.
- [ ] **Taxonomía de tags sin control.** ~90 tags distintos en `session_log`, la
  mayoría usados una sola vez; degrada la búsqueda. Falta vocabulario corto.
- [ ] **Sin rutina de salud.** Nadie revisa vencidos, acciones sin cerrar ni
  notas huérfanas. Ya hubo un recordatorio que venció sin ejecutarse.
- [ ] **Rutinas cloud solapadas** (ver advertencia arriba).

> **Importante:** el vault de conocimiento debe vivir en un repositorio
> **privado**, porque contiene nombres de clientes, montos y asuntos. Este
> repositorio es público: aquí solo va arquitectura, nunca datos de negocio.

## Historial

1. `cf982ae` — Tablero MexJet: Ventas, Dirección y Personal (versión inicial).
2. `415e90a` — Mensaje de error claro cuando la contraseña es incorrecta y el
   registro está apagado.
3. `fd9706d` — Agrega `CLAUDE.md` con el contexto del proyecto.
4. `628e4b7` — Documenta la integración Mac ↔ iPhone y el acceso admin a Supabase.
5. `60eb9a4` — Crea la bitácora `session_log` (memoria compartida) y afina la
   sección de integración multi-dispositivo.
6. Convierte `CLAUDE.md` en índice: mapa de contenido, regla de qué viaja entre
   dispositivos, catálogo de rutinas, patrones de trabajo y huecos conocidos.
