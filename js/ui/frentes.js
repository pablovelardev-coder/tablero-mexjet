// Pestaña Frentes: barras de avance con slider.
import { D } from "../state.js";
import { $, esc } from "../util.js";
import { save } from "../sync.js";

export function renderFrentes() {
  const w = $("frentesWrap");
  if (!w) return;
  w.innerHTML = "";
  (D().frentes || []).forEach(f => {
    const el = document.createElement("div");
    el.className = "frente";
    el.innerHTML = `<b style="min-width:200px">${esc(f.name)}</b><div class="bar"><i style="width:${f.pct}%"></i></div>
      <span style="width:42px;text-align:right">${f.pct}%</span><input type="range" min="0" max="100" step="5" value="${f.pct}" style="width:110px">`;
    const rng = el.querySelector("input");
    // Mueve la barra en vivo, pero solo guarda al soltar.
    rng.oninput = e => {
      f.pct = +e.target.value;
      el.querySelector(".bar i").style.width = f.pct + "%";
      el.querySelector("span").textContent = f.pct + "%";
    };
    rng.onchange = () => save();
    w.appendChild(el);
  });
}
