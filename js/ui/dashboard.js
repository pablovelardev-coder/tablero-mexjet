// Pestaña "Hoy": no cuenta pendientes, decide por dónde empezar.
//
// Modelo de deuda (Pablo, 31-ago): toda tarea se le debe a alguien para una fecha.
// Si el deudor es Pablo → la acción es entregar. Si el deudor es otro → presionar.
// De ahí salen los dos montones. Lo bloqueado no es un estado aparte: es una
// deuda de la que Pablo es el acreedor.
import { D } from "../state.js";
import { $, esc, clip, diasDesde, dueClass } from "../util.js";
import { save } from "../sync.js";
import { showTab } from "../nav.js";
import { renderTasks, setTaskFilter } from "./tasks.js";

export const YO = "Pablo";

// Señales de que la pelota ya está del otro lado. Dos familias:
// (a) Pablo entregó y espera respuesta; (b) la tarea está delegada en alguien más.
// Calibrado contra 26 pendientes reales de Dirección: 25 de 26 correctos.
const SENAL_ME_DEBEN = /esperando|en espera|pendiente\s+(?:la|el|de)\s+(?:firma|respuesta|regreso|confirmaci|que)|qued[oó]\s+(?:de|en)|ya\s+(?:le\s+)?(?:escrib|envi|mand)|correo\s+enviado|contrato\s+ya\s+enviado|sin\s+respuesta|falta\s+que|no\s+ha\s+(?:respondido|mandado|contestado)|a\s+cargo\s+de|del\s+lado\s+de|lo\s+ve\s+(?:con|el)|depende\s+de|est[aá]\s+en\s+manos\s+de/i;

// Señales de que la pelota es de Pablo: un verbo de entrega en imperativo.
const SENAL_DEBO = /^\s*(?:mandar|enviar|preparar|armar|responder|contestar|revisar|definir|hacer|cerrar|completar|documentar|elaborar|cotizar|comprar|contratar|agendar|hablarle|buscar|retomar|confirmar|pedir|fijar|entrar|generar)/i;

// Clasifica de qué lado está la deuda. Devuelve el lado y si fue inferido,
// porque una inferencia se marca como tal: Pablo la corrige, no la hereda a ciegas.
export function ladoDe(t) {
  if (t.deudor) return { lado: t.deudor === YO ? "debo" : "me-deben", inferido: false, quien: t.deudor };
  const tx = t.text || "";
  // Ojo: "Bloqueada" NO implica que alguien le deba a Pablo. ORSAN está bloqueada
  // por decisión suya (stand by). El estado no dice de qué lado está la pelota;
  // el texto sí. Probado: dar por hecho que Bloqueada = deuda ajena falla.
  if (SENAL_ME_DEBEN.test(tx)) return { lado: "me-deben", inferido: true, quien: "" };
  if (SENAL_DEBO.test(tx)) return { lado: "debo", inferido: true, quien: YO };
  return { lado: "debo", inferido: true, quien: YO };
}

// Qué detiene esta deuda: lo demás que sigue abierto en su mismo frente.
// Se deduce del frente en vez de capturarse a mano.
function detiene(t) {
  if (!t.frente) return 0;
  return D().tasks.filter(o => o.id !== t.id && o.status !== "Hecha" && (o.frente||"") === t.frente).length;
}

const diasAtraso = t => { const d = diasDesde(t.due); return d !== null && d > 0 ? d : 0 };

// Orden: primero lo más atrasado, y a igual atraso lo que detiene más cosas.
// No pondera por valor de cuenta todavía: eso exige ligar el frente al CRM.
const peso = t => diasAtraso(t) * 10 + detiene(t);

function fila(t, lado) {
  const inf = ladoDe(t);
  const atraso = diasAtraso(t);
  const det = detiene(t);
  const el = document.createElement("div");
  el.className = "deuda " + (atraso >= 30 ? "grave" : atraso > 0 ? "tarde" : "");

  const quien = t.deudor || (inf.inferido && lado === "debo" ? YO : "");
  const etiqueta = lado === "debo" ? "acreedor" : "deudor";
  const contraparte = lado === "debo" ? (t.acreedor || "") : (t.deudor || "");

  el.innerHTML = `
    <div class="deuda-cab">
      <span class="deuda-quien">${contraparte ? esc(contraparte) : `<i class="sin">¿${etiqueta}?</i>`}</span>
      ${inf.inferido ? `<span class="inferido" title="Lo deduje del texto: confírmalo o corrígelo">inferido</span>` : ""}
      ${atraso > 0 ? `<span class="atraso">${atraso} d tarde</span>` : t.due ? `<span class="alfecha">${t.due.slice(5)}</span>` : ""}
    </div>
    <div class="deuda-tx">${esc(clip(t.text || "", 190))}</div>
    <div class="deuda-pie">
      ${t.frente ? `<span class="deuda-frente">${esc(t.frente)}</span>` : ""}
      ${det ? `<button class="deuda-detiene" type="button">detiene ${det} más</button>` : ""}
      <input class="deuda-in" placeholder="${etiqueta}…" value="${esc(contraparte)}">
    </div>`;

  // Asignar la contraparte desde aquí: los campos se llenan usando el tablero,
  // no en una migración aparte.
  el.querySelector(".deuda-in").onchange = e => {
    const v = e.target.value.trim();
    if (lado === "debo") { t.acreedor = v; t.deudor = YO }
    else { t.deudor = v; t.acreedor = YO }
    save();
    renderDashboard();
  };

  const btn = el.querySelector(".deuda-detiene");
  if (btn) btn.onclick = () => { setTaskFilter({ label: t.frente, frente: t.frente }); showTab("pendientes"); renderTasks() };

  return el;
}

function pintarMonton(contenedor, lista, lado, vacio) {
  const c = $(contenedor);
  c.innerHTML = "";
  if (!lista.length) { c.innerHTML = `<p class="sub">${vacio}</p>`; return }
  lista.forEach(t => c.appendChild(fila(t, lado)));
}

export function renderDashboard() {
  const wrap = $("dashWrap");
  if (!wrap) return;

  const abiertos = (D().tasks || []).filter(t => t.status !== "Hecha");
  const meDeben = abiertos.filter(t => ladoDe(t).lado === "me-deben").sort((a,b) => peso(b) - peso(a));
  const debo    = abiertos.filter(t => ladoDe(t).lado === "debo").sort((a,b) => peso(b) - peso(a));

  $("dashMeDebenN").textContent = meDeben.length;
  $("dashDeboN").textContent = debo.length;

  pintarMonton("dashMeDeben", meDeben.slice(0,12), "me-deben", "Nadie te debe nada abierto.");
  pintarMonton("dashDebo", debo.slice(0,12), "debo", "No debes nada abierto.");

  // Sin contraparte asignada: el montón que se vacía solo conforme Pablo usa el tablero.
  const sinAsignar = abiertos.filter(t => !t.deudor && !t.acreedor).length;
  $("dashSinAsignar").textContent = sinAsignar
    ? `${sinAsignar} de ${abiertos.length} pendientes todavía sin deudor confirmado — el lado está inferido del texto.`
    : "Todos los pendientes tienen contraparte asignada.";
}
