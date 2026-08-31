// Cambio de tablero y de pestaña. Solo alterna clases: no repinta ni guarda,
// para que ningún módulo de render tenga que importar a este.
import { TABS, TAB_LABELS } from "./config.js";
import { app } from "./state.js";
import { $ } from "./util.js";

// En Dirección y Personal el pipeline se llama distinto.
function rotuloTab(v) {
  if (v === "pipeline" && app.cur !== "ventas") return app.cur === "direccion" ? "Temas" : "Tablero";
  return TAB_LABELS[v];
}

export function buildTabs() {
  const t = $("tabs");
  t.innerHTML = "";
  TABS[app.cur].forEach(v => {
    const el = document.createElement("div");
    el.className = "tab" + (v === app.curtab ? " on" : "");
    el.textContent = rotuloTab(v);
    el.onclick = () => showTab(v);
    t.appendChild(el);
  });
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.dataset.v === app.curtab));
}

export function showTab(v) {
  app.curtab = v;
  const idx = TABS[app.cur].indexOf(v);
  document.querySelectorAll(".tab").forEach((x,i) => x.classList.toggle("on", i === idx));
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.dataset.v === v));
}

export function initBoardSwitch(alCambiar) {
  document.querySelectorAll(".switch button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".switch button").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    app.cur = b.dataset.b;
    app.curtab = "pipeline";
    alCambiar();
  });
}
