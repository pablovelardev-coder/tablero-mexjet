// Contenido curado: Capacitación, Inteligencia comercial y Entretenimiento.
//
// ⚠️ A diferencia de los tableros, aquí NUNCA se escribe un JSON completo. Cada
// pieza es una fila de `feed` y cada acción (leído, guardado, descartado) es un
// UPDATE de esa fila. Es la regla que sale del borrado de tableros: un upsert
// de fila completa es un borrado esperando su turno.
import { sb, SECCIONES } from "../config.js";
import { app, S } from "../state.js";
import { $, esc, clip, uid, today } from "../util.js";
import { setSync, upsert, recargarTablero, consultar } from "../sync.js";
import { emit } from "../bus.js";

// Caché en memoria por sección. Se recarga al entrar, no en cada repintado.
const FEED = {};
let cargando = false;

export function temaActual() {
  const s = SECCIONES[app.cur];
  if (!s) return null;
  return s.temas.find(t => t.id === app.curtab) || s.temas[0];
}

export async function cargarFeed(seccionApp) {
  const s = SECCIONES[seccionApp];
  if (!s) return;
  cargando = true;
  renderFeed();
  // Una sola consulta por sección de la app: trae todas las `seccion` de BD que use.
  const secciones = [...new Set(s.temas.map(t => t.seccion))];
  const { data, error } = await consultar(() => sb.from("feed")
    .select("id,seccion,tema,titulo,resumen,fuente_url,fuente_nombre,publicado_at,leido,guardado,descartado")
    .in("seccion", secciones)
    .eq("descartado", false)
    .order("publicado_at", { ascending: false, nullsFirst: false })
    .limit(400));
  cargando = false;
  // Si falla, se queda lo que ya se veía: vaciarlo dejaba la sección en blanco.
  if (error) { setSync("error"); FEED[seccionApp] ||= []; renderFeed(); return }
  FEED[seccionApp] = data || [];
  renderFeed();
}

// Una acción = un UPDATE de una fila. Nada de reescribir el conjunto.
async function marcar(pieza, campo, valor) {
  pieza[campo] = valor;
  renderFeed();
  const { error } = await sb.from("feed").update({ [campo]: valor }).eq("id", pieza.id);
  setSync(error ? "error" : "ok");
}

// --- De una nota de Inteligencia a una tarjeta de Ventas ---------------------
// Una nota de inteligencia es un lead antes que una noticia: con un clic se
// vuelve tarjeta en la columna Prospecto de Ventas. La tarjeta guarda de qué
// pieza salió (`origen`), y con eso el botón sabe que ya se mandó.
//
// ⚠️ Ventas no es el tablero visible, así que su copia en memoria pudo quedar
// vieja: se recarga de la base antes de agregar, y se agrega al arreglo (nunca
// se reescribe). Si la base rechaza el guardado, sync.js recarga y avisa.

export function yaEnVentas(p) {
  return ((S.ventas && S.ventas.cards) || []).some(c =>
    (c.origen && c.origen.feed_id === p.id) || (p.fuente_url && (c.meta || "").includes(p.fuente_url)));
}

export function tarjetaDesdeNota(p, nombre) {
  return {
    id: "v_intel_" + today().replace(/-/g, "") + "_" + uid(),
    col: "lead",
    title: nombre,
    frente: "Prospección",
    labels: ["Inteligencia"],
    meta: [p.titulo, p.resumen || "", "Fuente: " + (p.fuente_nombre || "") + (p.fuente_url ? " — " + p.fuente_url : "")]
            .filter(Boolean).join("\n\n"),
    ultima: { fecha: today(), texto: "Salió de Inteligencia: " + clip(p.titulo, 90) },
    siguiente: { fecha: "", quien: "Pablo", texto: "Calificar: quién decide y cómo viaja hoy" },
    origen: { feed_id: p.id, fuente_url: p.fuente_url || "" },
  };
}

async function mandarAVentas(p, boton) {
  const nombre = (prompt("¿A nombre de quién va la tarjeta? (empresa o persona)", clip(p.titulo, 60)) || "").trim();
  if (!nombre) return;
  boton.disabled = true;
  setSync("saving");
  if (!(await recargarTablero("ventas"))) {
    setSync("error");
    boton.disabled = false;
    alert("No se pudo leer el tablero de Ventas. No se creó la tarjeta; intenta de nuevo.");
    return;
  }
  if (yaEnVentas(p)) { renderFeed(); setSync("ok"); return }
  const card = tarjetaDesdeNota(p, nombre);
  S.ventas.cards = (S.ventas.cards || []).concat(card);
  await upsert("ventas");
  // Si la base lo rechazó, sync.js ya recargó Ventas sin la tarjeta y avisó.
  if (!S.ventas.cards.some(c => c.id === card.id)) { renderFeed(); return }
  emit("datos-cambiaron");
  if (!p.leido) await marcar(p, "leido", true);
  else renderFeed();
}

function tarjeta(p) {
  const el = document.createElement("article");
  el.className = "pieza" + (p.leido ? " leida" : "") + (p.guardado ? " guardada" : "");
  const fecha = p.publicado_at ? new Date(p.publicado_at).toLocaleDateString("es-MX",{day:"2-digit",month:"short"}) : "";
  el.innerHTML = `
    <div class="pieza-cab">
      ${p.fuente_nombre ? `<span class="fuente">${esc(p.fuente_nombre)}</span>` : ""}
      ${fecha ? `<span class="pieza-fecha">${fecha}</span>` : ""}
    </div>
    <h4>${esc(p.titulo)}</h4>
    ${p.resumen ? `<p>${esc(clip(p.resumen, 320))}</p>` : ""}
    <div class="pieza-pie">
      ${p.fuente_url ? `<a href="${esc(p.fuente_url)}" target="_blank" rel="noopener noreferrer">abrir fuente ↗</a>` : ""}
      <button type="button" class="mini b-leido">${p.leido ? "✓ leído" : "marcar leído"}</button>
      <button type="button" class="mini b-guardar">${p.guardado ? "★ guardado" : "☆ guardar"}</button>
      ${p.seccion === "inteligencia" ? (yaEnVentas(p)
        ? `<button type="button" class="mini b-lead" disabled>✓ en Ventas</button>`
        : `<button type="button" class="mini b-lead" title="Crear tarjeta en Ventas, columna Prospecto">→ lead en Ventas</button>`) : ""}
      <button type="button" class="mini b-descartar" title="No volver a mostrarla">✕</button>
    </div>`;
  const bLead = el.querySelector(".b-lead");
  if (bLead && !bLead.disabled) bLead.onclick = () => mandarAVentas(p, bLead);
  el.querySelector(".b-leido").onclick     = () => marcar(p, "leido", !p.leido);
  el.querySelector(".b-guardar").onclick   = () => marcar(p, "guardado", !p.guardado);
  el.querySelector(".b-descartar").onclick = () => marcar(p, "descartado", true);
  return el;
}

export function renderFeed() {
  const wrap = $("feedWrap");
  if (!wrap || !SECCIONES[app.cur]) return;
  const tema = temaActual();
  const lista = (FEED[app.cur] || []).filter(p => p.tema === tema.id && !p.descartado);

  $("feedTitulo").textContent = tema.rotulo;
  $("feedTitulo").className = "monton-t" + (tema.destacado ? " destacado" : "");
  $("feedNota").textContent = tema.destacado
    ? "Una planta nueva, una expansión anunciada o un cambio de directivo son leads antes que noticias. Esto alimenta el pipeline de Ventas."
    : "";

  const c = $("feedLista");
  c.innerHTML = "";
  if (cargando) { c.innerHTML = `<p class="sub">Cargando…</p>`; return }
  if (!lista.length) {
    c.innerHTML = `<p class="sub">Todavía no hay contenido de <b>${esc(tema.rotulo)}</b>. Lo llena la rutina de curación.</p>`;
    return;
  }
  $("feedSinLeer").textContent = lista.filter(p => !p.leido).length + " sin leer";
  lista.forEach(p => c.appendChild(tarjeta(p)));
}
