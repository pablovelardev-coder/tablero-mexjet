// Pipeline (Kanban) con drag & drop.
// La cara de la tarjeta resume: etiquetas, última/siguiente acción, checklist,
// recordatorios, notas y los pendientes ligados por `frente` o por `tids`.
import { COLS } from "../config.js";
import { app, D } from "../state.js";
import { $, esc, clip, fchCorta, diasDesde, dueClass, tagColor } from "../util.js";
import { save } from "../sync.js";
import { showTab } from "../nav.js";
import { renderTasks, setTaskFilter } from "./tasks.js";
import { openCard } from "./card-dialog.js";

// Bloque de "última y siguiente acción". Si la tarjeta no tiene ninguna,
// cae de vuelta al detalle (meta) para no dejar la cara vacía.
function actsHtml(c) {
  const u = c.ultima || {}, g = c.siguiente || {};
  const hayU = !!(u.texto || u.fecha), hayG = !!(g.texto || g.fecha);
  if (!hayU && !hayG) return c.meta ? `<div class="meta">${esc(clip(c.meta,110))}</div>` : "";

  let h = '<div class="acts">';
  if (hayG) {
    const cl = dueClass(g.fecha, "");
    h += `<div class="act sig ${cl}"><span class="mk">▸</span><span class="tx">`
      + (g.fecha ? `<span class="fch">${fchCorta(g.fecha)}</span>` : "")
      + esc(clip(g.texto || "", 120))
      + (g.quien ? ` <span class="quien">· ${esc(g.quien)}</span>` : "")
      + `</span></div>`;
  }
  if (hayU) {
    h += `<div class="act ult"><span class="mk">✓</span><span class="tx">`
      + (u.fecha ? `<span class="fch">${fchCorta(u.fecha)}</span>` : "")
      + esc(clip(u.texto || "", 110))
      + `</span></div>`;
  }
  h += '</div>';

  // Alerta de tarjeta estancada, a partir de la última acción.
  const d = diasDesde(u.fecha);
  if (d !== null && d >= 14) h += `<span class="stale ${d >= 30 ? "bad" : ""}">${d} días sin movimiento</span>`;
  return h;
}

// Pendientes abiertos de una tarjeta: por ids explícitos (tids) o por frente.
function pendientesDe(c) {
  const tie = Array.isArray(c.tids) && c.tids.length;
  return (D().tasks || [])
    .filter(t => t.status !== "Hecha" && (tie ? c.tids.includes(t.id) : (c.frente && (t.frente||"") === c.frente)))
    .sort((a,b) => (a.due||"9999-99-99").localeCompare(b.due||"9999-99-99"));
}

function pintarTarjeta(c, color) {
  const card = document.createElement("div");
  card.className = "card";
  card.draggable = true;
  card.style.borderLeftColor = color;

  const pend = pendientesDe(c);
  const li = pend.slice(0,4).map(t => {
    const cls = dueClass(t.due, t.status);
    const col = cls === "overdue" ? "var(--lost)" : cls === "soon" ? "var(--warn)" : "var(--muted,#888)";
    const f = t.due ? `<span style="color:${col};font-weight:600">${t.due.slice(5)}</span> ` : "";
    return `<li style="margin:2px 0">${f}${esc(clip(t.text,68))}</li>`;
  }).join("");

  const tags = (c.labels || []).map(l => `<span class="tag" style="background:${tagColor(l)}">${esc(l)}</span>`).join("");

  const ck = c.checklist || [], ckDone = ck.filter(i => i.done).length;
  const ckHtml = ck.length
    ? `<div class="prog"><i style="width:${Math.round(ckDone/ck.length*100)}%"></i></div>
       <div class="meta" style="font-size:11px">☑️ ${ckDone} de ${ck.length}${ckDone === ck.length ? " · completo" : ""}</div>`
    : "";

  const cr = (D().rems || []).filter(r => r.cardId === c.id).sort((a,b) => (a.date||"").localeCompare(b.date||""));
  let remHtml = "";
  if (cr.length) {
    const n = cr[0], cl = dueClass(n.date, "");
    remHtml = `<span class="badge ${cl === "overdue" ? "over" : cl === "soon" ? "warn" : ""}">⏰ ${n.date ? n.date.slice(5) : ""}${cr.length > 1 ? " +"+(cr.length-1) : ""}</span>`;
  }
  const noteHtml = c.notes ? `<span class="badge">📝 notas</span>` : "";

  card.innerHTML = `<b>${esc(c.title)}</b>`
    + (tags ? `<div class="tags">${tags}</div>` : "")
    + actsHtml(c)
    + ckHtml
    + ((remHtml || noteHtml) ? `<div style="margin-top:5px">${remHtml}${noteHtml}</div>` : "")
    + (pend.length ? `<div style="margin-top:6px;border-top:1px dashed #d9d9d9;padding-top:5px">
        <ul style="margin:0;padding-left:14px;font-size:11px;line-height:1.35">${li}</ul>
        ${pend.length > 4 ? `<div style="font-size:11px;opacity:.65;padding-left:14px">+${pend.length-4} más…</div>` : ""}
        <button class="seeall" style="margin-top:5px;font-size:11px;cursor:pointer;border:1px solid #ccc;border-radius:5px;background:#fafafa;padding:2px 7px">📋 Ver los ${pend.length} pendientes</button>
      </div>` : "");

  card.onclick = () => openCard(c.id);

  const sa = card.querySelector(".seeall");
  if (sa) sa.onclick = ev => {
    ev.stopPropagation();
    const tie = Array.isArray(c.tids) && c.tids.length;
    setTaskFilter(tie ? { label: c.title, ids: c.tids } : { label: c.frente, frente: c.frente });
    showTab("pendientes");
    renderTasks();
  };

  card.ondragstart = ev => { ev.dataTransfer.setData("id", c.id); card.classList.add("dragging") };
  card.ondragend = () => card.classList.remove("dragging");
  return card;
}

export function renderBoard() {
  const cols = COLS[app.cur], b = $("board");
  b.style.gridTemplateColumns = `repeat(${cols.length},minmax(180px,1fr))`;
  b.innerHTML = "";

  cols.forEach(([cid, name, color]) => {
    const enCol = D().cards.filter(c => c.col === cid);
    const el = document.createElement("div");
    el.className = "col";
    el.dataset.col = cid;
    el.innerHTML = `<h3><span class="dot" style="background:${color}"></span>${name}<span class="count">${enCol.length}</span></h3>`;

    enCol.forEach(c => el.appendChild(pintarTarjeta(c, color)));

    const add = document.createElement("button");
    add.className = "addcard";
    add.textContent = "+ tarjeta";
    add.onclick = () => openCard(null, cid);
    el.appendChild(add);

    el.ondragover = ev => { ev.preventDefault(); el.classList.add("over") };
    el.ondragleave = () => el.classList.remove("over");
    el.ondrop = ev => {
      ev.preventDefault();
      el.classList.remove("over");
      const c = D().cards.find(x => x.id === ev.dataTransfer.getData("id"));
      if (c) { c.col = cid; save(); renderBoard() }
    };
    b.appendChild(el);
  });
}
