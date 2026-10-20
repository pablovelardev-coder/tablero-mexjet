// Instrumentos de la Cabina: el HUD de Hoy, las cintas por frente, la bitácora
// de movimientos y el radar de contenido.
//
// La historia sale de `card_events`, que llena un trigger en la base cada vez que
// una tarjeta entra al tablero o cambia de columna (desde el 19-oct-2026; lo
// anterior se reconstruyó de `boards_backup` y solo dice "al menos desde").
//
// ⚠️ Solo lectura. Este módulo nunca escribe: ni en `boards`, ni en `card_events`,
// ni en `feed`. Si la consulta falla, pinta con lo que tiene el tablero en memoria.
import { sb, COLS } from "../config.js";
import { app, D } from "../state.js";
import { $, esc, clip, fchCorta, diasDesde } from "../util.js";
import { showTab } from "../nav.js";
import { ladoDe, decisionesQueDesbloquean } from "./dashboard.js";

// Columnas que cierran un asunto y columnas que lo sacan del juego.
const CIERRE = { ventas: ["win"], direccion: ["hecho"], personal: ["done"] };
const FUERA  = { ventas: ["lost", "archivo"], direccion: [], personal: [] };

// Un frente con tarjetas vivas y sin movimiento en tres semanas se marca en rojo.
export const ALERTA_DIAS = 21;

/* ---------- Carga de movimientos (con caché de un minuto por tablero) -------- */
const MOV = {};
const cargando = {};

async function cargarMovimientos(kind) {
  if (cargando[kind]) return;
  cargando[kind] = true;
  try {
    const desde = new Date(Date.now() - 120 * 864e5).toISOString();
    const { data, error } = await sb.from("card_events")
      .select("card_id,title,frente,from_col,to_col,at")
      .eq("kind", kind).gte("at", desde)
      .order("at", { ascending: false }).limit(400);
    MOV[kind] = { at: Date.now(), ev: error ? [] : (data || []), error: !!error };
  } catch (e) {
    MOV[kind] = { at: Date.now(), ev: [], error: true };
  } finally {
    cargando[kind] = false;
  }
  if (app.cur === kind) renderInstrumentos();
}

function movimientos(kind) {
  const m = MOV[kind];
  if (!m || Date.now() - m.at > 60000) cargarMovimientos(kind);
  return m ? m.ev : [];
}

/* ---------- Cálculo de las cintas (puro: se puede probar sin navegador) ------- */
// Fecha AAAA-MM-DD. Un timestamp se pasa a la hora local: un movimiento a las
// 20:00 de Monterrey ya es el día siguiente en UTC. Una fecha sola se deja igual.
const dia = at => {
  const s = String(at || "");
  return s.includes("T") ? new Date(s).toLocaleDateString("en-CA") : s.slice(0, 10);
};

export function cintas(kind, cards, ev) {
  const cols = (COLS[kind] || []).map(c => c[0]);
  const fuera = FUERA[kind] || [], cierre = CIERRE[kind] || [];
  const porId = Object.fromEntries(cards.map(c => [c.id, c]));
  const g = {};

  cards.forEach(c => {
    if (c.col === "archivo") return;
    const f = c.frente || "Sin frente";
    const x = g[f] ||= { frente: f, n: {}, total: 0, vivas: 0, ultimo: null, mov30: 0, altas30: 0, cerr30: 0 };
    x.n[c.col] = (x.n[c.col] || 0) + 1;
    x.total++;
    if (!fuera.includes(c.col) && !cierre.includes(c.col)) x.vivas++;
    // La última acción capturada en la tarjeta también es movimiento.
    const u = (c.ultima || {}).fecha;
    if (u && (!x.ultimo || u > x.ultimo)) x.ultimo = u;
  });

  ev.forEach(e => {
    const c = porId[e.card_id];
    const x = g[(c && c.frente) || e.frente || "Sin frente"];
    if (!x) return;
    const d0 = dia(e.at);
    if (!x.ultimo || d0 > x.ultimo) x.ultimo = d0;
    const d = diasDesde(d0);
    if (d === null || d > 30) return;
    if (!e.from_col) x.altas30++;
    else { x.mov30++; if (cierre.includes(e.to_col)) x.cerr30++ }
  });

  const enJuego = cols.filter(k => !fuera.includes(k));
  return Object.values(g).map(x => {
    x.dias = diasDesde(x.ultimo);
    x.alerta = x.vivas > 0 && (x.dias === null || x.dias >= ALERTA_DIAS);
    // Avance: de las tarjetas en juego, cuántas ya pasaron de la primera etapa.
    const base = enJuego.reduce((s, k) => s + (x.n[k] || 0), 0);
    const pasaron = enJuego.slice(1).reduce((s, k) => s + (x.n[k] || 0), 0);
    x.avance = base ? Math.round(pasaron / base * 100) : 0;
    return x;
  }).sort((a, b) => (b.total - a.total) || a.frente.localeCompare(b.frente));
}

/* ---------- Pintado ----------------------------------------------------------- */
const rotulo = (kind, col) => ((COLS[kind] || []).find(c => c[0] === col) || [col, col])[1];

function pieCinta(x) {
  const partes = [];
  if (x.alerta) partes.push(`<span class="cinta-alerta">▲ ${x.dias === null ? "sin movimiento registrado" : `${x.dias} d sin movimiento`}</span>`);
  else if (x.dias !== null) partes.push(`último movimiento ${x.dias === 0 ? "hoy" : `hace ${x.dias} d`}`);
  if (x.mov30) partes.push(`${x.mov30} ${x.mov30 === 1 ? "cambio" : "cambios"} de etapa en 30 d`);
  if (x.altas30) partes.push(`${x.altas30} ${x.altas30 === 1 ? "alta" : "altas"}`);
  if (x.cerr30) partes.push(`<span class="cinta-cierre">${x.cerr30} ${x.cerr30 === 1 ? "cerrada" : "cerradas"}</span>`);
  return partes.join(" · ");
}

function pintarCintas(kind, lista) {
  const c = $("frentesAuto");
  if (!c) return;
  if (!lista.length) { c.innerHTML = `<p class="sub">Este tablero no tiene tarjetas todavía.</p>`; return }
  const cols = COLS[kind];
  c.innerHTML = lista.map(x => `
    <div class="cinta${x.alerta ? " alerta" : ""}">
      <div class="cinta-cab"><b>${esc(x.frente)}</b><em>${x.total} ${x.total === 1 ? "tarjeta" : "tarjetas"} · ${x.avance}% avanzó</em></div>
      <div class="cinta-bar">${cols.filter(([k]) => x.n[k]).map(([k, nom, color]) =>
        `<i title="${esc(nom)}: ${x.n[k]}" style="flex:${x.n[k]};background:${color}"><span>${x.n[k]}</span></i>`).join("")}</div>
      <div class="cinta-pie">${pieCinta(x)}</div>
    </div>`).join("");
  const ley = $("frentesLeyenda");
  if (ley) ley.innerHTML = cols.filter(([k]) => k !== "archivo")
    .map(([, nom, color]) => `<span><i style="background:${color}"></i>${esc(nom)}</span>`).join("");
}

function pintarBitacora(kind, ev) {
  const c = $("bitacora");
  if (!c) return;
  const nota = $("bitacoraNota");
  const m = MOV[kind];
  if (nota) nota.textContent = m && m.error
    ? "No se pudo leer la historia de movimientos; las cintas usan solo la última acción de cada tarjeta."
    : "Cada vez que una tarjeta entra o cambia de etapa. La historia empieza el 1-ago-2026: lo anterior no quedó registrado.";
  if (!ev.length) { c.innerHTML = `<p class="sub">Sin movimientos en los últimos 120 días.</p>`; return }
  c.innerHTML = ev.slice(0, 12).map(e => {
    const cierre = (CIERRE[kind] || []).includes(e.to_col);
    return `<div class="mov${cierre ? " cierre" : ""}">
      <span class="mov-f">${fchCorta(dia(e.at))}</span>
      <span class="mov-t">${esc(clip(e.title || "", 60))}</span>
      <span class="mov-c">${e.from_col ? `${esc(rotulo(kind, e.from_col))} → ` : "alta en "}${esc(rotulo(kind, e.to_col || ""))}</span>
    </div>`;
  }).join("");
}

function pintarHud(kind, lista, ev) {
  const c = $("dashHud");
  if (!c) return;
  const abiertos = (D().tasks || []).filter(t => t.status !== "Hecha");
  const debo = abiertos.filter(t => ladoDe(t).lado === "debo").length;
  const meDeben = abiertos.length - debo;
  const deci = decisionesQueDesbloquean(abiertos).length;
  const alerta = lista.filter(x => x.alerta);
  const cierre = CIERRE[kind] || [];
  const semana = ev.filter(e => { const d = diasDesde(dia(e.at)); return d !== null && d <= 7 });
  const cerradas = semana.filter(e => e.from_col && cierre.includes(e.to_col)).length;

  // Un punto en el radar por frente en alerta. Posición fija por nombre, para que no baile.
  const puntos = alerta.slice(0, 6).map(x => {
    let h = 0; for (const ch of x.frente) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const ang = (h % 360) * Math.PI / 180, r = 10 + (h % 17);
    return `<i style="left:${29 + Math.cos(ang) * r}px;top:${29 + Math.sin(ang) * r}px"></i>`;
  }).join("");

  c.innerHTML = `
    <div class="radar" aria-hidden="true">${puntos}</div>
    <div class="cell"><span>Yo debo</span><b class="amb">${debo}</b></div>
    <div class="cell"><span>Me deben</span><b class="cian">${meDeben}</b></div>
    <div class="cell"><span>Decisiones</span><b>${deci}</b></div>
    <button type="button" class="cell ir-frentes" title="Ver los frentes"><span>Frentes en alerta</span><b class="${alerta.length ? "rojo" : "verde"}">${alerta.length}</b></button>
    <div class="cell"><span>Movimientos 7 d</span><b class="verde">${semana.length}</b></div>
    <div class="cell"><span>Cerradas 7 d</span><b class="verde">${cerradas}</b></div>`;
  c.querySelector(".ir-frentes").onclick = () => showTab("frentes");
}

/* ---------- Radar de contenido (solo Ventas): lo más nuevo sin leer ---------- */
let RADAR = null, radarAt = 0, radarCargando = false;

async function cargarRadar() {
  if (radarCargando) return;
  radarCargando = true;
  try {
    const { data, error } = await sb.from("feed")
      .select("titulo,fuente_url,fuente_nombre,tema,publicado_at")
      .in("tema", ["inteligencia", "aviacion"])
      .eq("leido", false).eq("descartado", false)
      .order("publicado_at", { ascending: false, nullsFirst: false })
      .limit(6);
    RADAR = error ? [] : (data || []);
  } catch (e) {
    RADAR = [];
  } finally {
    radarAt = Date.now();
    radarCargando = false;
  }
  if (app.cur === "ventas") pintarRadar();
}

function pintarRadar() {
  const box = $("dashRadarBox"), c = $("dashRadar");
  if (!box || !c) return;
  box.classList.toggle("hidden", app.cur !== "ventas");
  if (app.cur !== "ventas") return;
  if (!RADAR || Date.now() - radarAt > 300000) cargarRadar();
  if (!RADAR) { c.innerHTML = `<p class="sub">Cargando…</p>`; return }
  if (!RADAR.length) { c.innerHTML = `<p class="sub">Nada nuevo sin leer.</p>`; return }
  c.innerHTML = RADAR.map(p => `
    <a class="radar-it" href="${esc(p.fuente_url || "#")}" target="_blank" rel="noopener noreferrer">
      <small>${p.tema === "inteligencia" ? "Inteligencia comercial" : "Aviación"}${p.publicado_at ? " · " + fchCorta(dia(p.publicado_at)) : ""}</small>
      ${esc(clip(p.titulo || "", 110))}
      ${p.fuente_nombre ? `<small>${esc(p.fuente_nombre)}</small>` : ""}
    </a>`).join("");
}

export function renderInstrumentos() {
  if (!D() || !COLS[app.cur]) return;
  const kind = app.cur;
  const ev = movimientos(kind);
  const lista = cintas(kind, D().cards || [], ev);
  pintarHud(kind, lista, ev);
  pintarCintas(kind, lista);
  pintarBitacora(kind, ev);
  pintarRadar();
}
