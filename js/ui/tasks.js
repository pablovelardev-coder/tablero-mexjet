// Pestaña Pendientes: tabla editable con semáforo por fecha de vencimiento.
import { STATUSES } from "../config.js";
import { app, D } from "../state.js";
import { $, esc, uid, today, dueClass } from "../util.js";
import { save } from "../sync.js";
import { showTab } from "../nav.js";
import { encargar } from "./encargo.js";

// Filtro activo cuando se entra desde "ver los N pendientes" de una tarjeta.
let TASKFILTER = null;
export const setTaskFilter = f => { TASKFILTER = f };

function pintarBarraFiltro() {
  let bar = $("taskFilterBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "taskFilterBar";
    const tbl = $("tblTasks");
    tbl.parentNode.insertBefore(bar, tbl);
  }
  bar.innerHTML = TASKFILTER
    ? `<span class="filtro">
         Tema: <b>${esc(TASKFILTER.label || "")}</b>
         <button id="clrFilter">Ver todos</button>
         <button id="backBoard">Ver en el tablero</button>
       </span>`
    : "";
  const clr = $("clrFilter");
  if (clr) clr.onclick = () => { TASKFILTER = null; renderTasks() };
  const bb = $("backBoard");
  if (bb) bb.onclick = () => showTab("pipeline");
}

export function renderTasks() {
  const tb = document.querySelector("#tblTasks tbody");
  tb.innerHTML = "";
  D().tasks.sort((a,b) => (a.due||"").localeCompare(b.due||""));
  pintarBarraFiltro();

  const lista = TASKFILTER
    ? D().tasks.filter(t => TASKFILTER.ids ? TASKFILTER.ids.includes(t.id) : (t.frente||"") === TASKFILTER.frente)
    : D().tasks;

  lista.forEach(t => {
    const tr = document.createElement("tr");
    tr.className = (t.status === "Hecha" ? "done " : "") + dueClass(t.due, t.status);
    tr.innerHTML = `<td><input type="date" value="${t.due||""}"></td><td><input value="${esc(t.text)}"></td>
      <td><input value="${esc(t.frente||"")}"></td><td><select>${STATUSES.map(s => `<option ${s===t.status?"selected":""}>${s}</option>`).join("")}</select></td>
      <td class="acciones"><button class="mini b-encargo" title="Encargar a Claude">🤖</button><button class="mini b-borrar">✕</button></td>`;
    const [d, tx, fr, st] = tr.querySelectorAll("input,select");
    d.onchange = e => { t.due = e.target.value; save(); renderTasks() };
    tx.onchange = e => { t.text = e.target.value; save() };
    fr.onchange = e => { t.frente = e.target.value; save() };
    st.onchange = e => { t.status = e.target.value; save(); renderTasks() };
    tr.querySelector(".b-borrar").onclick = () => { D().tasks = D().tasks.filter(x => x.id !== t.id); save(); renderTasks() };
    tr.querySelector(".b-encargo").onclick = () => encargar({ kind: app.cur, tipo: "pendiente", id: t.id, titulo: t.text });
    tb.appendChild(tr);
  });
}

export function initTasks() {
  $("addTask").onclick = () => {
    D().tasks.push({ id: uid(), due: today(), text: "Nueva tarea", frente: "", status: "Por hacer" });
    save();
    renderTasks();
  };
}
