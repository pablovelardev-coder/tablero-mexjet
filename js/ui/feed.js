// Contenido curado: Capacitación, Inteligencia comercial y Entretenimiento.
//
// ⚠️ A diferencia de los tableros, aquí NUNCA se escribe un JSON completo. Cada
// pieza es una fila de `feed` y cada acción (leído, guardado, descartado) es un
// UPDATE de esa fila. Es la regla que sale del borrado de tableros: un upsert
// de fila completa es un borrado esperando su turno.
import { sb, SECCIONES } from "../config.js";
import { app } from "../state.js";
import { $, esc, clip } from "../util.js";
import { setSync } from "../sync.js";

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
  const { data, error } = await sb.from("feed")
    .select("id,seccion,tema,titulo,resumen,fuente_url,fuente_nombre,publicado_at,leido,guardado,descartado")
    .in("seccion", secciones)
    .eq("descartado", false)
    .order("publicado_at", { ascending: false, nullsFirst: false })
    .limit(400);
  cargando = false;
  if (error) { setSync("error"); FEED[seccionApp] = []; renderFeed(); return }
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
      <button type="button" class="mini b-descartar" title="No volver a mostrarla">✕</button>
    </div>`;
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
