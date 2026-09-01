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

Tabla **`feed`** — contenido curado de Capacitación, Entretenimiento e
Inteligencia comercial. **Una fila por pieza**, no un JSON monolítico:

| Columna | Notas |
|---|---|
| `user_id` | dueño (FK a auth.users), con RLS por usuario |
| `seccion` | `capacitacion` \| `entretenimiento` \| `inteligencia` |
| `tema` | `ia`, `finanzas`, `rayados`, `f1`… |
| `titulo`, `resumen`, `fuente_url`, `fuente_nombre`, `publicado_at` | la pieza |
| `leido`, `guardado`, `descartado` | estado por pieza |

- **RLS activo con 4 políticas** (`user_id = auth.uid()`) desde su creación.
- Índice único `(user_id, fuente_url)`: la rutina de curación corre a diario y
  sin eso insertaría el mismo artículo en cada corrida.
- ⚠️ **Regla de oro:** el contenido se **inserta y actualiza fila por fila**.
  Cada acción de la app es un `UPDATE` de un solo campo de una sola fila. Así el
  bug que vació los tableros dos veces no puede repetirse aquí.

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

## Curación del feed

Rutina cloud **`Curación del feed`** (`trig_01DAsAuygxaKnRWN4cDw5YCv`), lunes a
viernes 7:30 am, más *pull* a mano desde https://claude.ai/code/routines.
Escribe en `feed`, nunca en `boards`.

**Prioridad de fuente**, en este orden — es lo que Pablo pidió explícitamente:

1. **Prensa validada**, mexicana y de **Estados Unidos**. Tiene suscripción a
   El Norte / Reforma. Para nearshoring: Cluster Industrial, Mexico Industry,
   Site Selection, Area Development. Internacional: WSJ, Bloomberg, Reuters, FT.
2. **Fuente primaria**: boletines de la Secretaría de Economía de NL, Banxico,
   INEGI, comunicados de la propia empresa, filings a la SEC.
3. **Académico y de investigación**: NBER, HBR, MIT Sloan, Nature, Lancet, NEJM,
   JAMA, McKinsey / BCG / Bain.
4. **Blogs y Substack de autores reconocidos.** El criterio es la persona, no la
   plataforma: trayectoria verificable y firma propia. En `fuente_nombre` va
   `Nombre Apellido (Substack)`.

⚠️ **Muro de pago:** la rutina no puede leer el cuerpo de El Norte, Reforma, WSJ
ni FT. Guarda la liga para que Pablo la abra con su suscripción, pero tiene
instrucción de **no inventar detalle que no pudo leer**.

**Volumen:** inteligencia comercial hasta 6 · capacitación 2 por tema ·
entretenimiento 1 por tema. Se subió inteligencia y se bajó entretenimiento el
1-sep, porque la primera corrida trajo 10 de entretenimiento y 1 de
inteligencia — al revés de lo que sirve.

**Ventana de tiempo, distinta por sección** — el ajuste que de verdad destrabó
inteligencia:

| Sección | Ventana | Por qué |
|---|---|---|
| `inteligencia` | **30 días** | Un anuncio de planta o un cambio de director general sigue siendo un lead vivo semanas después. Con 7 días la sección salía casi vacía **aunque la búsqueda sí encontrara material bueno** — se descartaban NIFCO en Apodaca, KIA en Pesquería, el nuevo DG de Metalsa y el relevo de CEO en Nemak. |
| `capacitacion` | 14 días (30 para papers) | El análisis firmado no caduca en una semana. |
| `entretenimiento` | 7 días | Aquí sí caduca rápido. |

⚠️ **Dominios bloqueados por el proxy del entorno cloud:** `clusterindustrial.com.mx`,
`mexicoindustry.com` y `nl.gob.mx` no se pueden abrir con WebFetch, aunque sí
aparecen por WebSearch. La rutina tiene instrucción de no perder tiempo
intentándolo y de decir en el resumen que no pudo leer el cuerpo.

## Rutinas automáticas

Arquitectura **híbrida**: rutinas en la nube (corren solas, no dependen de que
la Mac esté abierta) y rutinas locales (necesitan la Mac encendida porque tocan
archivos). El catálogo completo con el prompt exacto de cada una está en
`session_log` con el tag `receta`.

### Rutinas cloud (Routines de Claude Code, con `trigger_id`)

**Cuatro activas.** Verificado contra la API el 31-ago-2026.

| Hora (Monterrey) | Días | Rutina | Qué hace | Conectores |
|---|---|---|---|---|
| **06:45** | todos | Captura diaria de flota | parsea el correo *DASHBOARD MEXJET* y lo escribe en `flota_dia` y `flota_evento`. Solo captura: no analiza, no notifica | Gmail, Supabase |
| **07:10** | lun-vie | Respaldo de tableros | snapshot a `boards_backup`, purga >90 días y **alerta si un tablero quedó vacío o perdió >30% de tarjetas** | Supabase |
| **08:00** | lunes | Revisión de salud | vencidos, acciones sin cerrar, integridad de los tableros. **Solo lee** | Supabase |
| **09:00 · 13:00 · 17:00** | lun-vie | Monitoreo `info@ale.mx` | tría el buzón general, marca 🔴 lo que toca **Monterrey** y **escribe los leads reales al tablero de Ventas**, columna `lead` | Gmail, Supabase |

**Cinco desactivadas:** Parte matutino completo · Estatus de flota e incidencias ·
Resumen matutino · Pipeline de ventas · Pendientes de Dirección. Se conservan por
si hace falta volver a encenderlas.

> ⚠️ **El parte matutino ya no corre en la nube.** Decisión de Pablo (21-ago): lo
> quiere disparar **desde una sesión en el celular**, para poder dar indicaciones
> y corregir sobre la marcha mientras planea el día. Una rutina que solo deposita
> un texto no le sirve para eso.

> **El monitoreo del buzón estuvo apagado del 24-jul al 31-ago-2026** y en ese mes
> se acumularon las solicitudes sin triar — entre ellas un lead de JetCard de
> Johnson Controls. Al reactivarlo se le cambió el diseño de entrega: antes solo
> emitía un reporte, que Pablo no llegaba a ver porque **las notificaciones nunca
> le llegan al teléfono**; ahora **escribe la tarjeta en el tablero**, que sí abre.
> El reporte quedó como respaldo, no como la entrega.

> **Lección de catálogo:** este bloque decía «tres activas» y listaba el parte
> matutino como la principal, cuando llevaba semanas apagado, y no mencionaba dos
> rutinas que sí corrían. Un catálogo que no se verifica contra la API envejece
> mal y hace tomar decisiones sobre una realidad que ya no existe.

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
- [x] ~~**Sin rutina de salud.**~~ **Resuelto:** existe *Revisión de salud*, los
  lunes a las 8:00, que revisa vencidos, acciones sin cerrar e integridad de los
  tableros. Solo lee, nunca modifica.
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

### 2026-08-31 — Se repitió, y esta vez lo causó una sesión de Claude

**Qué pasó.** Probando el arreglo de `auth.js` **contra la app real**, se inyectó
estado vacío en los módulos y se llamó `abrirSesion()`, que dispara `start()`.
Con el estado vacío en memoria, `loadBoard` → `upsert` sobrescribió los tres
tableros. Los `edge_logs` lo muestran: seis `POST /rest/v1/boards` con
`on_conflict=user_id,kind` desde el navegador.

**Cómo se recuperó.** Desde `boards_backup`, que esta vez sí existía: el
respaldo diario más dos snapshots manuales tomados minutos antes. Se verificó
por id que ningún elemento de ningún respaldo de los últimos 7 días faltara.

**Qué se hizo para que no se repita.**

1. 🔒 **Trigger `boards_rechaza_vaciado_trg`** — la base de datos rechaza
   cualquier `UPDATE` que deje un tablero con cero `cards`, `tasks` y `rems`
   si antes tenía contenido. No depende de la app: aplica a cualquier cliente.
   Es la defensa que faltaba desde el 1-ago.
2. La regla de pruebas de abajo.
3. 🔒 **`loadBoard` ya no escribe** (`js/sync.js`) — *aplicado el 31-ago por la
   tarde*. La rama `else` sembraba el estado vacío **y lo hacía `upsert`**; ahora
   el seed se queda solo en memoria y la fila se crea cuando el usuario actúa.
   Ese `upsert` al arrancar es el mecanismo común de los dos borrados: lo dispara
   cualquier cosa que deje la consulta sin fila —sesión que aún no autentica, RLS
   que filtra, un hipo de red que no llega a marcarse como `error`, o un estado
   vacío inyectado en una prueba—. El comentario de la cabecera del archivo decía
   que `save()` nunca corre al arrancar, y era cierto; el hueco era que
   `loadBoard` no llamaba a `save()` sino a `upsert()` directo.
4. 🔒 **Candado en `upsert()`** — se niega a escribir un tablero que esté vacío en
   memoria, antes de salir a la red. Complementa al trigger: la base es la última
   línea, ésta es la primera.

> Las cuatro medidas son de capas distintas a propósito: la app puede fallar y el
> dato sobrevive; la base puede no tener el trigger y el cliente ya no lo intenta.

**Lección.** El respaldo salvó los datos, pero el respaldo es la última línea,
no la primera. Lo que faltaba era que la base **se negara** a quedarse vacía.

## ⛔ Regla de pruebas: nunca contra producción

**No hay base de datos de pruebas.** `index.html` servido en `localhost` y el
desplegado en GitHub Pages apuntan al MISMO Supabase real. Cualquier prueba que
ejecute `start()`, `abrirSesion()` o `save()` **escribe en los tableros de
verdad**. Así se borraron el 31-ago.

Antes de tocar nada en una sesión de navegador, dejar el cliente inerte:

```js
const cfg = await import('./js/config.js');
cfg.sb.from = () => { throw new Error('BLOQUEADO: prueba escribiendo a produccion') };
cfg.sb.channel = cfg.sb.from;
```

y **comprobar que quedó puesto** antes de seguir. Con eso se pueden probar los
módulos de render con datos de prueba sin riesgo.

> Ojo con la caché de módulos ES: tras editar un archivo, el navegador puede
> seguir sirviendo el anterior. Verificar con
> `(await import('./js/x.js?cb='+Date.now())).f.toString()` que el código
> cargado es el nuevo. Si se hace cache-bust de dos módulos que comparten
> estado, se crean **instancias distintas** — bustear solo el que cambió.

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
