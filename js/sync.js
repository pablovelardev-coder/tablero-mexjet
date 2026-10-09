// Lectura y escritura contra Supabase.
//
// ⚠️ El upsert reemplaza `data` completo: si un cliente escribe con el estado
// vacío, borra el tablero entero. Pasó el 1-ago-2026. Por eso `save()` solo se
// dispara desde una acción del usuario, nunca al arrancar.
//
// ⚠️ Y una pestaña con estado VIEJO hace lo mismo a medias: su siguiente
// guardado reescribe la base con su versión. Por eso la pestaña se recarga al
// volver de segundo plano (`vigilarRegreso`), y si la base rechaza un guardado
// —el trigger `boards_rechaza_perdida_parcial_trg`— se recarga y se avisa en vez
// de reintentar (`guardadoRechazado`).
import { sb } from "./config.js";
import { app, S, lastWrite, seed } from "./state.js";
import { $ } from "./util.js";
import { emit } from "./bus.js";

const TABLEROS = ["ventas", "direccion", "personal"];

let saveTimer = null;
let escribiendo = Promise.resolve();   // la escritura en vuelo, para esperarla antes de recargar

export function setSync(st) {
  const el = $("sync");
  if (st === "saving") el.textContent = "guardando…";
  else if (st === "ok") el.textContent = "✓ sincronizado " + new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  else if (st === "actualizando") el.textContent = "actualizando…";
  else if (st === "rechazado") el.textContent = "⛔ guardado rechazado";
  else if (st === "error") el.textContent = "⚠︎ error de conexión";
  else el.textContent = "·";
}

export async function loadBoard(kind) {
  const { data, error } = await sb.from("boards").select("data").eq("kind",kind).maybeSingle();
  if (error) { setSync("error"); return }
  if (data && data.data) { S[kind] = data.data }
  // ⚠️ NUNCA escribir desde aquí. Si la consulta no trajo fila —porque la sesion
  // todavia no autentica, porque RLS la filtro, o por un hipo de red que no llego
  // a marcarse como error— el seed se queda SOLO EN MEMORIA. La fila se crea
  // cuando el usuario haga algo, via save(). Este upsert al arrancar fue lo que
  // borro los tres tableros el 1-ago y el 31-ago-2026.
  else { S[kind] = seed(kind) }
}

// Segundo candado, del lado del cliente. El primero es el trigger
// `boards_rechaza_vaciado_trg` en la base. Aqui se evita siquiera intentarlo:
// un tablero sin tarjetas, sin pendientes y sin recordatorios no se escribe.
function estaVacio(b) {
  return !b || (!(b.cards||[]).length && !(b.tasks||[]).length && !(b.rems||[]).length);
}

export function upsert(kind) {
  if (estaVacio(S[kind])) {
    console.warn("upsert cancelado: el tablero", kind, "esta vacio en memoria. No se escribe.");
    setSync("error");
    return Promise.resolve();
  }
  lastWrite[kind] = Date.now();
  escribiendo = escribir(kind);
  return escribiendo;
}

async function escribir(kind) {
  const { error } = await sb.from("boards").upsert(
    { user_id: app.user.id, kind, data: S[kind], updated_at: new Date().toISOString() },
    { onConflict: "user_id,kind" }
  );
  if (!error) return setSync("ok");
  // 23514 = check_violation: no es la red, es la base protegiendo el dato.
  if (error.code === "23514") return guardadoRechazado(kind, error);
  setSync("error");
}

// La base se negó a guardar porque este tablero, tal como está en memoria,
// habría borrado elementos que la base sí tiene. Casi siempre es una pestaña que
// se quedó atrás. Reintentar no sirve —se rechazaría otra vez, y cada cambio
// siguiente en esta pestaña también—: se trae lo que tiene la base y se avisa,
// para que el cambio se rehaga sobre datos al día.
async function guardadoRechazado(kind, error) {
  console.warn("guardado rechazado por la base:", error.message);
  await recargar(kind);
  emit("datos-cambiaron");
  setSync("rechazado");
  alert("No se guardó tu último cambio.\n\n" +
        "Este tablero estaba desactualizado y, de guardarse, habría borrado cosas " +
        "que sí existen. Ya se recargó con lo que hay en la base: revisa y vuelve a hacer el cambio.\n\n" +
        "(" + error.message + ")");
}

// Guardado con debounce de 400ms sobre el tablero visible.
export function save() {
  setSync("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; upsert(app.cur) }, 400);
}

// Manda ya lo que el debounce tenía pendiente. Lo que el usuario hizo no se tira.
function vaciarPendiente() {
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  return upsert(app.cur);
}

// Trae un tablero de la base y lo pone en memoria SOLO si llegó una fila real.
// ⚠️ A diferencia de loadBoard, nunca siembra: si la consulta falla o no trae
// fila (sesión que aún no autentica, RLS, un hipo de red), se queda lo que ya
// había. Sembrar aquí pintaría un tablero vacío encima del bueno.
async function recargar(kind) {
  const { data, error } = await sb.from("boards").select("data").eq("kind", kind).maybeSingle();
  if (error || !data || !data.data) return false;
  S[kind] = data.data;
  return true;
}

// Recarga los tres tableros de la base. Antes manda lo pendiente y espera a que
// llegue: si recargara primero, leería la versión de antes de ese guardado y la
// pantalla regresaría a ella.
let recargando = null;
export function recargarTodo() {
  if (recargando) return recargando;   // no encimar dos recargas
  recargando = (async () => {
    await vaciarPendiente().catch(() => {});
    await escribiendo.catch(() => {});
    setSync("actualizando");
    const llegaron = await Promise.all(TABLEROS.map(recargar));
    emit("datos-cambiaron");
    setSync(llegaron.every(Boolean) ? "ok" : "error");
  })().finally(() => { recargando = null });
  return recargando;
}

// Una pestaña que estuvo en segundo plano —el celular en la bolsa, la laptop
// dormida— pudo perderse avisos de Realtime, y su siguiente guardado
// reescribiría la base con una versión vieja. Al ocultarse manda lo pendiente;
// al volver (tras 5 s o más fuera, al restaurarse de la caché del navegador o
// al regresar la red) recarga de la base.
const REGRESO_MIN_MS = 5000;
let ocultaDesde = 0;
let vigilando = false;
export function vigilarRegreso() {
  if (vigilando) return;               // start() puede correr otra vez tras un nuevo login
  vigilando = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { ocultaDesde = Date.now(); vaciarPendiente(); return }
    if (ocultaDesde && Date.now() - ocultaDesde >= REGRESO_MIN_MS) recargarTodo();
    ocultaDesde = 0;
  });
  window.addEventListener("pagehide", () => vaciarPendiente());
  window.addEventListener("pageshow", e => { if (e.persisted) recargarTodo() });
  window.addEventListener("online", () => recargarTodo());
}

// Sincronización entre pestañas y dispositivos. Ignora el eco de la escritura
// propia durante 1.5s para no repintar encima de lo que el usuario está haciendo.
let canal = null;
let conectado = false, yaConecto = false;

export function subscribeBoards(onRemoteChange) {
  if (canal) return canal;   // ya suscrito: no acumular canales
  canal = sb.channel("boards-rt")
    .on("postgres_changes", { event:"*", schema:"public", table:"boards" }, payload => {
      const row = payload.new;
      if (!row || !row.kind) return;
      if (Date.now() - lastWrite[row.kind] < 1500) return;
      S[row.kind] = row.data;
      if (row.kind === app.cur) onRemoteChange();
    })
    .subscribe(status => {
      // Si el canal se cayó y volvió, los avisos de en medio se perdieron.
      if (status === "SUBSCRIBED") {
        if (yaConecto && !conectado) recargarTodo();
        yaConecto = conectado = true;
      } else {
        conectado = false;
      }
    });
  return canal;
}
