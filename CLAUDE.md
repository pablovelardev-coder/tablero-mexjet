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
| Conocimiento por entidad (wiki) | Repo privado del vault | `pablovelardev-coder/segundo-cerebro` |
| Respaldo de los tableros | Supabase → `boards_backup` | `where kind = … order by taken_at desc` |
| Histórico de disponibilidad de flota | Supabase → `flota_dia`, `flota_evento` | solo conector admin; la app no las lee |

## Qué es

Tablero personal de trabajo para **Pablo Velarde** (MexJet). Aplicación web
estática de una sola página, servida por **GitHub Pages** en:

- https://pablovelardev-coder.github.io/tablero-mexjet/

## Arquitectura

- **Frontend:** HTML + CSS + JavaScript vanilla, **sin paso de build ni
  framework**. Repartido en módulos ES nativos (`js/`), que GitHub Pages sirve
  tal cual. `index.html` es solo el markup. Se importa
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
- ⚠️ **El upsert reemplaza `data` completo.** Si un cliente arranca con estado
  vacío y sincroniza, borra el tablero entero. Pasó el 1-ago-2026 (ver
  *Incidentes*). Cualquier escritura automatizada debe **agregar** al arreglo,
  nunca reemplazar la fila.
- **RLS activo:** cada usuario solo lee/escribe sus propias filas.
- **Realtime:** el cliente se suscribe a `postgres_changes` sobre `boards`
  para sincronizar entre pestañas/dispositivos. Ignora el "eco" de la propia
  escritura durante 1.5s (`lastWrite`).

Tabla **`boards_backup`** — snapshots de `boards`:

| Columna | Notas |
|---|---|
| `kind`, `data` | copia literal de la fila de `boards` |
| `n_cards`, `n_tasks`, `n_rems` | conteos, para detectar pérdidas de un vistazo |
| `vacio` | columna generada: `true` si el tablero quedó sin tarjetas |
| `taken_at` | cuándo se tomó |

- **RLS activo y sin políticas:** solo el conector de administrador entra. La
  app web (anon key) **no puede tocarla**, ni para leer.
- La escribe la rutina cloud *Respaldo de tableros*, cada día hábil a las 07:10.
- Restaurar:
  `update boards set data = (select data from boards_backup where kind='X' and vacio=false order by taken_at desc limit 1) where kind='X';`

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
├── index.html          # solo markup: el gate, la app y el diálogo de tarjeta
├── css/styles.css      # todos los estilos (variables CSS, claro/oscuro)
├── js/
│   ├── main.js         # entrada: engancha los módulos y arranca con la sesión
│   ├── config.js       # cliente de Supabase, COLS, TABS, STATUSES, paleta
│   ├── util.js         # helpers puros: esc, uid, fechas, dueClass, tagColor
│   ├── state.js        # estado en memoria (app, S, lastWrite) y seed()
│   ├── sync.js         # loadBoard / upsert / save / Realtime
│   ├── auth.js         # login, alta y cierre de sesión
│   ├── nav.js          # cambio de tablero y de pestaña (solo alterna clases)
│   ├── bus.js          # pub/sub mínimo, para romper ciclos de importación
│   ├── render.js       # renderAll(): único punto que repinta todo
│   └── ui/
│       ├── board.js        # pipeline (Kanban) y la cara de la tarjeta
│       ├── card-dialog.js  # ventana de edición: etiquetas, checklist, rems
│       ├── tasks.js        # pestaña Pendientes y su filtro por tema
│       ├── rems.js         # pestaña Recordatorios
│       └── frentes.js      # pestaña Frentes
├── README.md
└── CLAUDE.md           # este archivo
```

**Regla de dependencias: el grafo no tiene ciclos.** Las capas van de abajo
hacia arriba —`config`/`util`/`state`/`bus` → `sync` → `nav` → `ui/*` →
`render` → `main`— y ningún módulo importa a uno de su misma capa o superior.
Las dos aristas que sí volverían hacia atrás (guardar una tarjeta y tener que
repintar; borrar una y tener que repintar) se resuelven con el bus: el módulo
emite `datos-cambiaron` y `main.js` es quien llama a `renderAll()`. Si en algún
momento un módulo de `ui/` necesita importar a `render.js`, es señal de que hay
que mandar un evento, no una importación.

## Convenciones de trabajo

- **No hay build ni dependencias locales:** se editan los archivos directamente
  y GitHub Pages los sirve tal cual.
- ⚠️ **Ya no sirve abrir `index.html` con doble clic.** Los módulos ES se piden
  por HTTP y el navegador los bloquea por CORS desde `file://`. Hay que servir
  la carpeta:

  ```
  python3 -m http.server 4173
  ```

  y entrar a `http://localhost:4173`. La auth y los datos van contra el
  Supabase real, así que lo que se toque en local **se guarda de verdad**.
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
| `boards`, `boards_backup`, `session_log` (Supabase) | `~/.claude/scheduled-tasks/` |
| Gmail, Google Calendar, Drive | El CSV del CRM |
| Rutinas *cloud* (Routines con `trig_…`) | Los PDFs de evidencia |
| Este repo (`CLAUDE.md`, código) | Rutinas *locales* (scheduled-tasks) |
| El vault de conocimiento (repo privado) | Respaldos en archivo del tablero |

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

Tablas **`flota_dia`** y **`flota_evento`** — serie histórica de disponibilidad
de flota, alimentada desde el correo *DASHBOARD MEXJET*. No las usa la app: las
escriben las rutinas cloud a través del conector de administrador.

- **RLS activo y sin políticas**, más los permisos revocados a `anon` y
  `authenticated` — mismo patrón que `boards_backup`.
- ⚠️ **Estuvieron con RLS desactivado del 20 al 31-ago-2026.** Como la anon key
  vive incrustada en el `index.html` de este repositorio *público*, durante esos
  once días cualquiera pudo leer y modificar el historial de flota. Se cerró el
  31-ago. La anon key **no** se rotó ni hacía falta: es pública por diseño, y el
  problema era la falta de RLS, no la clave.
- **Regla que deja el incidente:** una tabla nueva en este proyecto nace con RLS.
  Si la escribe una rutina y no la app, va sin políticas y solo entra el conector
  de administrador. Verificar con `get_advisors` después de crear cualquier tabla.

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

**Tres activas**, lunes a viernes, encadenadas de forma que el respaldo corre
antes del parte y el parte encuentra los datos ya asegurados:

| Hora (Monterrey) | Rutina | Qué hace | Push |
|---|---|---|---|
| **07:10** | Respaldo de tableros | snapshot a `boards_backup`, purga >90 días y **alerta si un tablero quedó vacío o perdió >30% de tarjetas** | sí |
| **07:20** | Parte matutino completo | juntas del día · estatus de flota · incidencias · quejas de clientes · pendientes de Dirección agrupados por departamento · pipeline de Ventas · leads del buzón | sí + correo |
| 07:00 | Pipeline de ventas | oportunidades en Negociación y Propuesta, y el riesgo de flota 2028 | — |

**Cuatro desactivadas** por haberse consolidado en *Parte matutino completo*:
Resumen matutino · Estatus de flota · Pendientes de Dirección · Monitoreo del
buzón. Se conservan por si hace falta volver a separarlas.

> Consolidado el 2026-08-01. Antes había seis rutinas, cinco a la misma hora y
> con contenido traslapado; además varias tenían el canal de notificación sin
> configurar, y por eso su resultado nunca llegaba al teléfono.

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
- **Verificar la fuente antes de citarla.** Si un documento invoca un contrato,
  una cláusula o una cifra, hay que leer el instrumento y confirmarlo. Ya hubo
  un borrador que citaba una fecha de contrato equivocada y una cláusula
  inexistente; se detectó antes de enviarlo al cliente.

## Procesamiento de documentos (PDF, escaneos, Word)

Regla de costo: un PDF **con capa de texto** se lee barato (extraer y filtrar).
Un PDF **escaneado** obliga a renderizar páginas y leerlas como imagen, lo que
cuesta del orden de 10-20x más. Por eso conviene resolverlo una sola vez.

Herramientas en la Mac (`brew install poppler tesseract tesseract-lang ocrmypdf
qpdf pandoc`):

| Herramienta | Para qué |
|---|---|
| `poppler` | `pdftotext` (extraer texto), `pdftoppm` (renderizar) |
| `tesseract` + `tesseract-lang` | OCR, con español |
| `ocrmypdf` | Inyecta capa de texto a un escaneo: queda buscable para siempre |
| `qpdf`, `pandoc` | Partir/unir PDFs; convertir Word a texto |

**Flujo para documentos entrantes:** original intacto a `/raw` (evidencia) →
`ocrmypdf` para hacerlo buscable → nota de la entidad en `/wiki`.

> Estas herramientas **solo las alcanza una sesión corriendo en la Mac**. Desde
> iPhone o nube no existen. Por eso el paso de **subir el resultado al vault es
> obligatorio**: se procesa una vez en la Mac y se consulta barato desde
> cualquier dispositivo.

## Conectores y su comportamiento

Claude opera con Supabase, Gmail, Google Calendar y Drive. Nota operativa: los
conectores **se reconectan bajo identidades distintas** y, cuando eso pasa,
vuelven a pedir aprobación aunque ya se hubiera dado "permitir siempre". El
síntoma es un error de *approval required* en medio de una tarea. La salida es
reautorizar y reintentar, o dejar la acción en el buzón (ver patrón arriba).

## Huecos conocidos

- [x] ~~**Vault de Obsidian atado a la Mac.**~~ **Resuelto 2026-08-01:** el vault
  es repo git privado (`pablovelardev-coder/segundo-cerebro`) y ya viaja. Trae
  un `INDEX.md` como puerta de entrada. Detalle técnico: la base de datos de git
  vive **fuera de iCloud** (`git init --separate-git-dir`), porque el Mac tiene
  *Optimize Mac Storage* activo y iCloud puede desalojar objetos de `.git` y
  corromper el repo. El árbol de trabajo sigue en iCloud para que Obsidian iOS
  lo abra.
- [~] **Capa de conocimiento (`/wiki`).** Carpeta creada el 2026-08-01, **vacía**.
  Las notas por entidad siguen en su ubicación original; la propuesta de
  migración está en el `INDEX.md` del vault, sin aplicar. Ojo: mover rompe los
  enlaces `[[…]]`, conviene hacerlo desde el propio Obsidian.
- [~] **Capa de evidencia (`/raw`).** Carpeta creada, **vacía**. Falta decidir si
  los PDFs originales se copian al vault — implica peso y subir más material
  sensible, aunque el repo sea privado.
- [ ] **Taxonomía de tags sin control.** ~90 tags distintos en `session_log`, la
  mayoría usados una sola vez; degrada la búsqueda. Falta vocabulario corto.
- [ ] **Sin rutina de salud.** Nadie revisa vencidos, acciones sin cerrar ni
  notas huérfanas. Ya hubo un recordatorio que venció sin ejecutarse. *(La
  rutina de respaldo ya vigila la integridad de los tableros, pero no la salud
  de los pendientes.)*
- [x] ~~**Rutinas cloud solapadas.**~~ **Resuelto 2026-08-01:** tres activas,
  encadenadas y con push encendido; cuatro desactivadas.
- [ ] **Sin automatización de commit/push del vault.** Hoy es manual desde la
  Mac. Mientras no se haga push, lo escrito ahí no viaja.
- [ ] **El repo del vault no está conectado como fuente de Claude.** Está
  publicado, pero una sesión en la nube o en el iPhone todavía no lo lee solo.

> **Importante:** el vault de conocimiento debe vivir en un repositorio
> **privado**, porque contiene nombres de clientes, montos y asuntos. Este
> repositorio es público: aquí solo va arquitectura, nunca datos de negocio.

## Incidentes

### 2026-08-01 — Borrado de los tres tableros

**Qué pasó.** Al abrir por primera vez la app nueva (GitHub Pages), sincronizó
su estado inicial vacío sobre `boards` y borró los tres tableros. Coexistían dos
clientes apuntando a la misma tabla: esta app y una versión anterior en HTML
local. Ambos hacen `upsert` reemplazando `data` completo.

**Cómo se recuperó.** No había respaldo. Dirección y Personal se reconstruyeron
desde el historial de la conversación en curso; **Ventas se recuperó de los
transcripts locales de Claude** (`~/.claude/projects/*.jsonl`), donde había
quedado un inventario por columna y el detalle de las tarjetas.

**Qué se hizo para que no se repita.**
1. `boards_backup` + rutina cloud diaria que **alerta** si un tablero queda vacío
   o pierde más del 30% de sus tarjetas.
2. Respaldo semanal a archivo en la Mac, como copia fuera de Supabase.
3. Los HTML de la app anterior se renombraron a `_OBSOLETO_NO-ABRIR_*` con un
   `LEEME.md` al lado.
4. Las rutinas que escriben en `boards` llevan instrucción explícita de **solo
   agregar**, nunca reemplazar la fila.

**Lecciones.** (a) Un `upsert` de fila completa es un borrado esperando su turno.
(b) Dos clientes sobre la misma tabla es un riesgo, no una comodidad.
(c) Los transcripts locales salvaron el día — pero no son una estrategia de
respaldo, son arqueología.

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
7. `f0ac23f` — Actualiza la doc del JSON y las columnas a la versión actual.
8. Documenta `boards_backup`, el incidente del 1-ago y su remediación; corrige
   el catálogo de rutinas (3 activas, encadenadas); marca como resueltos los
   huecos del vault y del solapamiento.
9. Modulariza la app: `index.html` queda solo con el markup, los estilos pasan a
   `css/styles.css` y la lógica a módulos ES en `js/`. Sin cambio de
   comportamiento y sin build, como preparación para las ventanas nuevas
   (dashboards, capacitación, entretenimiento) que habrían llevado el archivo
   único a ~100 KB.
