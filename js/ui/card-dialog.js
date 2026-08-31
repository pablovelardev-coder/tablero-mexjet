// Ventana de edición de tarjeta: etiquetas, checklist y recordatorios propios.
//
// Trabaja sobre copias temporales (DTAGS/DCK/DREM) y solo vuelca al estado real
// al enviar el formulario, para que "Cancelar" no deje rastro.
import { COLS } from "../config.js";
import { app, D } from "../state.js";
import { $, esc, uid, addDays, autoGrow, tagColor } from "../util.js";
import { save } from "../sync.js";
import { emit } from "../bus.js";

let editing = null;
let DTAGS = [], DCK = [], DREM = [];

/* ---- etiquetas ---- */
function drawTags() {
  $("cTagWrap").innerHTML = DTAGS.length
    ? DTAGS.map((l,i) => `<span class="tag" style="background:${tagColor(l)}">${esc(l)}<button type="button" data-i="${i}">×</button></span>`).join("")
    : `<span style="color:var(--muted);font-size:12px">Sin etiquetas</span>`;
  $("cTagWrap").querySelectorAll("button").forEach(b => b.onclick = () => { DTAGS.splice(+b.dataset.i,1); drawTags() });
}
function addTag() {
  const v = $("cTagIn").value.trim();
  if (!v) return;
  if (!DTAGS.includes(v)) DTAGS.push(v);
  $("cTagIn").value = "";
  drawTags();
}

/* ---- checklist ---- */
function drawCk() {
  const done = DCK.filter(i => i.done).length;
  $("cCkCount").textContent = `${done} / ${DCK.length}`;
  $("cCkBar").style.width = DCK.length ? Math.round(done/DCK.length*100)+"%" : "0%";
  $("cCkList").innerHTML = DCK.map((it,i) =>
    `<div class="ck${it.done?" done":""}"><input type="checkbox" data-i="${i}" ${it.done?"checked":""}>
     <input type="text" data-t="${i}" value="${esc(it.text)}"><button type="button" class="del" data-d="${i}">✕</button></div>`).join("")
    || `<div style="color:var(--muted);font-size:12px;padding:4px 0">Sin puntos todavía</div>`;
  $("cCkList").querySelectorAll("input[type=checkbox]").forEach(b => b.onchange = () => { DCK[+b.dataset.i].done = b.checked; drawCk() });
  $("cCkList").querySelectorAll("input[type=text]").forEach(b => b.onchange = () => { DCK[+b.dataset.t].text = b.value });
  $("cCkList").querySelectorAll("button.del").forEach(b => b.onclick = () => { DCK.splice(+b.dataset.d,1); drawCk() });
}
function addCk() {
  const v = $("cCkIn").value.trim();
  if (!v) return;
  DCK.push({ id: uid(), text: v, done: false });
  $("cCkIn").value = "";
  drawCk();
}

/* ---- recordatorios de la tarjeta ---- */
function drawRem() {
  $("cRemList").innerHTML = DREM.map((r,i) =>
    `<div class="remrow"><input type="date" data-d="${i}" value="${r.date||""}">
     <input type="text" data-t="${i}" value="${esc(r.text)}"><button type="button" class="del" data-x="${i}">✕</button></div>`).join("")
    || `<div style="color:var(--muted);font-size:12px;padding:4px 0">Sin recordatorios</div>`;
  $("cRemList").querySelectorAll("input[type=date]").forEach(b => b.onchange = () => { DREM[+b.dataset.d].date = b.value });
  $("cRemList").querySelectorAll("input[type=text]").forEach(b => b.onchange = () => { DREM[+b.dataset.t].text = b.value });
  $("cRemList").querySelectorAll("button.del").forEach(b => b.onclick = () => { DREM.splice(+b.dataset.x,1); drawRem() });
}
function addRemCard() {
  const v = $("cRemIn").value.trim();
  if (!v) return;
  DREM.push({ id: uid(), date: $("cRemDate").value || addDays(7), text: v });
  $("cRemIn").value = "";
  $("cRemDate").value = "";
  drawRem();
}

export function openCard(id, col) {
  editing = id;
  const c = id
    ? D().cards.find(x => x.id === id)
    : { title:"", meta:"", col: col || COLS[app.cur][0][0], frente:"", notes:"", labels:[], checklist:[] };
  $("cardDlgTitle").textContent = id ? "Editar tarjeta" : "Nueva tarjeta";
  $("cTitle").value = c.title;
  $("cMeta").value = c.meta || "";
  $("cNotes").value = c.notes || "";
  $("cFrente").value = c.frente || "";
  const u = c.ultima || {}, g = c.siguiente || {};
  $("cUltFecha").value = u.fecha || ""; $("cUltTexto").value = u.texto || "";
  $("cSigFecha").value = g.fecha || ""; $("cSigTexto").value = g.texto || ""; $("cSigQuien").value = g.quien || "";
  $("cCol").innerHTML = COLS[app.cur].map(k => `<option value="${k[0]}">${k[1]}</option>`).join("");
  $("cCol").value = c.col;
  DTAGS = [...(c.labels || [])];
  DCK = (c.checklist || []).map(i => ({...i}));
  DREM = id ? (D().rems || []).filter(r => r.cardId === id).map(r => ({...r})) : [];
  drawTags(); drawCk(); drawRem();
  $("cardDlg").showModal();
  [$("cMeta"), $("cNotes")].forEach(autoGrow);
}

export function initCardDialog() {
  ["cMeta","cNotes"].forEach(k => $(k).addEventListener("input", e => autoGrow(e.target)));
  $("cTagAdd").onclick = addTag;
  $("cTagIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTag() } });
  $("cCkAdd").onclick = addCk;
  $("cCkIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addCk() } });
  $("cRemAdd").onclick = addRemCard;
  $("cRemIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addRemCard() } });

  $("cardForm").onsubmit = e => {
    e.preventDefault();
    const t = $("cTitle").value.trim();
    if (!t) return;
    const payload = {
      title: t,
      meta: $("cMeta").value.trim(),
      notes: $("cNotes").value,
      col: $("cCol").value,
      frente: $("cFrente").value.trim(),
      labels: [...DTAGS],
      checklist: DCK.filter(i => i.text.trim()),
      ultima: { fecha: $("cUltFecha").value || "", texto: $("cUltTexto").value.trim() },
      siguiente: { fecha: $("cSigFecha").value || "", texto: $("cSigTexto").value.trim(), quien: $("cSigQuien").value.trim() }
    };
    let cid = editing;
    if (editing) { Object.assign(D().cards.find(x => x.id === editing), payload) }
    else { cid = uid(); D().cards.push({ id: cid, ...payload }) }
    // Los recordatorios de la tarjeta se reescriben completos: se quitan los suyos y se vuelven a poner.
    D().rems = (D().rems || []).filter(r => r.cardId !== cid);
    DREM.filter(r => r.text.trim()).forEach(r => D().rems.push({
      id: r.id || uid(), date: r.date || addDays(7), text: r.text, frente: payload.frente || "", cardId: cid
    }));
    save();
    emit("datos-cambiaron");
    $("cardDlg").close();
  };

  $("cCancel").onclick = () => $("cardDlg").close();

  $("cDel").onclick = () => {
    if (editing) {
      D().cards = D().cards.filter(x => x.id !== editing);
      D().rems = (D().rems || []).filter(r => r.cardId !== editing);
      save();
      emit("datos-cambiaron");
    }
    $("cardDlg").close();
  };
}
