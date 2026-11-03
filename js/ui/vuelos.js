// Pestaña Vuelos (Ventas): los vuelos de los clientes en seguimiento.
//
// La lista de clientes vigilados vivía solo en el SKILL.md de la tarea
// vigilancia-vuelos-clientes de la Mac: agregar o quitar a alguien obligaba a
// editar ese archivo y el teléfono no la veía (3-nov-2026). Ahora vive en la
// tabla `vuelos_vigilados`; la tarea la lee de ahí y escribe en `vuelos` cada
// vuelo que detecta.
//
// ⚠️ Como en el feed, nunca se escribe un conjunto completo: agregar es un
// INSERT y quitar es un UPDATE de una fila (activo = false). Nada se borra.
import { sb } from "../config.js";
import { $, esc, today, fchCorta } from "../util.js";
import { setSync, consultar } from "../sync.js";

const TZ = "America/Monterrey";
let VIG = [], VUE = [], estado = "cargando";

// Día local (AAAA-MM-DD) de un instante, en hora de Monterrey.
const diaDe = iso => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

// Si leer vuelos falla, falla solo esta pestaña: el arranque y los tableros siguen.
export async function cargarVuelos() {
  const desde = new Date(Date.now() - 2 * 864e5).toISOString();
  let a, b;
  try {
    [a, b] = await Promise.all([
      consultar(() => sb.from("vuelos_vigilados").select("*").order("nombre")),
      consultar(() => sb.from("vuelos").select("*").gte("sale_at", desde).order("sale_at")),
    ]);
  } catch (e) {
    console.warn("vuelos: no se pudieron leer", e);
    a = { error: e };
  }
  if (a.error || (b && b.error)) { estado = "error"; renderVuelos(); return }
  VIG = a.data || [];
  VUE = b.data || [];
  estado = "ok";
  renderVuelos();
}

// Lo que se ve: de hoy en adelante, sin cancelados al final de la fila.
export function proximos(vuelos, hoy = today()) {
  return vuelos
    .filter(v => diaDe(v.sale_at) >= hoy)
    .sort((x, y) => x.sale_at.localeCompare(y.sale_at));
}

// Un seguimiento con fecha ya pasada está cumplido: se avisa, no se esconde.
export const cumplido = (c, hoy = today()) =>
  c.tipo === "seguimiento" && !!c.hasta_fecha && c.hasta_fecha < hoy;

function fechaVuelo(v) {
  const d = new Date(v.sale_at);
  const dia = d.toLocaleDateString("es-MX", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
  if (v.hora_por_confirmar) return `${dia} · hora por confirmar`;
  return `${dia} · ${d.toLocaleTimeString("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}`;
}

function pintarVuelo(v) {
  const el = document.createElement("div");
  const marca = v.estado === "cambio" ? " tarde" : v.estado === "cancelado" ? " grave" : "";
  el.className = "deuda vuelo" + marca;
  const badge = v.estado === "cambio" ? `<span class="badge warn">cambió</span>`
    : v.estado === "cancelado" ? `<span class="badge over">cancelado</span>`
    : v.hora_por_confirmar ? `<span class="badge warn">hora por confirmar</span>` : "";
  const ruta = [v.origen, v.destino].filter(Boolean).join(" → ");
  const datos = [ruta, v.pasajeros ? `${v.pasajeros} pax` : "", v.equipo, v.clave_reserva].filter(Boolean).join(" · ");
  el.innerHTML = `
    <div class="deuda-cab"><span class="deuda-quien">${esc(v.cliente)}</span>${badge}</div>
    <div class="deuda-tx"><b>${esc(fechaVuelo(v))}</b>${datos ? " — " + esc(datos) : ""}</div>
    ${v.nota ? `<div class="sub" style="margin:4px 0 0">${esc(v.nota)}</div>` : ""}
    ${v.liga ? `<div class="deuda-pie"><a href="${esc(v.liga)}" target="_blank" rel="noopener noreferrer">abrir hilo ↗</a></div>` : ""}`;
  return el;
}

function pintarVigilado(c) {
  const el = document.createElement("div");
  const venc = cumplido(c);
  el.className = "deuda vigilado" + (venc ? " grave" : "");
  const tipo = c.tipo === "fijo" ? `<span class="badge">Fijo</span>`
    : venc ? `<span class="badge over">cumplido el ${esc(fchCorta(c.hasta_fecha))}</span>`
    : `<span class="badge warn">hasta ${esc(c.hasta_fecha ? fchCorta(c.hasta_fecha) : c.hasta_viajes ? c.hasta_viajes + " viajes" : "—")}</span>`;
  el.innerHTML = `
    <div class="deuda-cab"><span class="deuda-quien">${esc(c.nombre)}</span>${tipo}${c.claves ? `<span class="deuda-frente">${esc(c.claves)}</span>` : ""}</div>
    ${c.motivo ? `<div class="deuda-tx">${esc(c.motivo)}</div>` : ""}
    ${c.contacto ? `<div class="sub" style="margin:4px 0 0">${esc(c.contacto)}</div>` : ""}
    <div class="deuda-pie"><button type="button" class="mini b-quitar">${venc ? "Quitar de la vigilancia" : "Quitar"}</button></div>`;
  el.querySelector(".b-quitar").onclick = () => quitar(c);
  return el;
}

async function quitar(c) {
  if (!confirm(`¿Dejar de vigilar los vuelos de ${c.nombre}? Se guarda en el historial; no se borra.`)) return;
  setSync("saving");
  const { error } = await sb.from("vuelos_vigilados").update({ activo: false }).eq("id", c.id);
  if (error) { setSync("error"); alert("No se pudo quitar. Intenta de nuevo."); return }
  c.activo = false;
  setSync("ok");
  renderVuelos();
}

export function renderVuelos() {
  const lista = $("vueLista"), vig = $("vigLista");
  if (!lista || !vig) return;
  lista.innerHTML = ""; vig.innerHTML = "";
  if (estado === "cargando") { lista.innerHTML = `<p class="sub">Cargando…</p>`; return }
  if (estado === "error") { lista.innerHTML = `<p class="sub">No se pudieron leer los vuelos. Revisa la conexión y vuelve a la pestaña.</p>`; return }

  const prox = proximos(VUE);
  $("vueN").textContent = prox.length;
  if (!prox.length) lista.innerHTML = `<p class="sub">No hay vuelos próximos de los clientes vigilados.</p>`;
  prox.forEach(v => lista.appendChild(pintarVuelo(v)));

  const activos = VIG.filter(c => c.activo);
  const fuera = VIG.filter(c => !c.activo);
  $("vigN").textContent = activos.length;
  if (!activos.length) vig.innerHTML = `<p class="sub">Nadie en vigilancia.</p>`;
  activos.forEach(c => vig.appendChild(pintarVigilado(c)));
  $("vigFuera").textContent = fuera.length
    ? `Ya no se vigilan: ${fuera.map(c => c.nombre).join(", ")}.` : "";
}

export function initVuelos() {
  const f = $("vigForm");
  if (!f) return;
  f.onsubmit = async ev => {
    ev.preventDefault();
    const val = k => (f.elements[k].value || "").trim();
    const fila = {
      nombre: val("nombre").toUpperCase(),
      claves: val("claves") || null,
      tipo: val("tipo"),
      hasta_fecha: val("hasta") || null,
      motivo: val("motivo") || null,
      contacto: val("contacto") || null,
      correos: val("correos") || null,
      recordatorios: true,
    };
    if (!fila.nombre) return alert("Falta el nombre del cliente.");
    if (fila.tipo === "seguimiento" && !fila.hasta_fecha) return alert("Un seguimiento necesita fecha de fin: ¿hasta cuándo se vigila?");
    if (!fila.correos && !fila.claves) return alert("Pon al menos una clave de contrato o un correo, para que la vigilancia sepa qué buscar.");
    setSync("saving");
    const { error } = await sb.from("vuelos_vigilados").insert(fila);
    if (error) { setSync("error"); alert("No se pudo agregar. Intenta de nuevo."); return }
    setSync("ok");
    f.reset();
    f.closest("details")?.removeAttribute("open");
    cargarVuelos();
  };
}
