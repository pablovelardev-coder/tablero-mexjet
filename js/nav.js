// Cambio de tablero y de pestaña. Solo alterna clases: no repinta ni guarda,
// para que ningún módulo de render tenga que importar a este.
import { TABS, TAB_LABELS, SECCIONES, esSeccion } from "./config.js";
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

  // Las secciones transversales no tienen vistas fijas: sus pestañas son temas.
  if (esSeccion(app.cur)) {
    const temas = SECCIONES[app.cur].temas;
    if (!temas.some(x => x.id === app.curtab)) app.curtab = temas[0].id;
    temas.forEach(tema => {
      const el = document.createElement("div");
      el.className = "tab" + (tema.id === app.curtab ? " on" : "") + (tema.destacado ? " destacado" : "");
      el.textContent = tema.rotulo;
      el.onclick = () => mostrarTema(tema.id);
      t.appendChild(el);
    });
    document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.dataset.v === "feed"));
    return;
  }

  TABS[app.cur].forEach(v => {
    const el = document.createElement("div");
    el.className = "tab" + (v === app.curtab ? " on" : "");
    el.textContent = rotuloTab(v);
    el.onclick = () => showTab(v);
    t.appendChild(el);
  });
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.dataset.v === app.curtab));
}

// Cambia de tema dentro de una sección. Avisa por callback para no importar el render.
let alCambiarTema = () => {};
export const onTemaChange = fn => { alCambiarTema = fn };

export function mostrarTema(id) {
  app.curtab = id;
  const temas = SECCIONES[app.cur].temas;
  const idx = temas.findIndex(x => x.id === id);
  document.querySelectorAll(".tab").forEach((x, i) => x.classList.toggle("on", i === idx));
  alCambiarTema();
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
