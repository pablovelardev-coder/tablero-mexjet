// Pestaña Recordatorios. Incluye los que cuelgan de una tarjeta (cardId).
import { D } from "../state.js";
import { $, esc, uid, addDays, dueClass } from "../util.js";
import { save } from "../sync.js";

export function renderRem() {
  const tb = document.querySelector("#tblRem tbody");
  tb.innerHTML = "";
  D().rems.sort((a,b) => (a.date||"").localeCompare(b.date||""));
  D().rems.forEach(r => {
    const tr = document.createElement("tr");
    tr.className = dueClass(r.date, "");
    const src = r.cardId ? (D().cards.find(c => c.id === r.cardId) || {}).title : "";
    tr.innerHTML = `<td><input type="date" value="${r.date||""}"></td>
      <td><input value="${esc(r.text)}">${src ? `<div style="font-size:11px;color:var(--muted);padding-left:6px">📌 ${esc(src)}</div>` : ""}</td>
      <td><input value="${esc(r.frente||"")}"></td><td><button class="mini">✕</button></td>`;
    const [d, tx, fr] = tr.querySelectorAll("input");
    d.onchange = e => { r.date = e.target.value; save(); renderRem() };
    tx.onchange = e => { r.text = e.target.value; save() };
    fr.onchange = e => { r.frente = e.target.value; save() };
    tr.querySelector("button").onclick = () => { D().rems = D().rems.filter(x => x.id !== r.id); save(); renderRem() };
    tb.appendChild(tr);
  });
}

export function initRems() {
  $("addRem").onclick = () => {
    D().rems.push({ id: uid(), date: addDays(7), text: "Nuevo recordatorio", frente: "" });
    save();
    renderRem();
  };
}
