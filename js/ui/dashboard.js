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

/* ---------- Árbol de decisión (Pablo, 31-ago) ----------
   Tres preguntas en orden de importancia, no una suma ponderada. Un "sí" en la
   primera gana sobre cualquier cosa de la segunda: así no hay que inventar pesos
   y Pablo puede auditar por qué algo salió arriba.

     1. ¿Genera dinero?
     2. ¿Se le debe a un externo o a alguien de jerarquía?
     3. ¿Bloquea otra tarea?

   El atraso ya no ordena: desempata. Una tarea vieja que no genera dinero ni
   bloquea a nadie no debería encabezar el día solo por ser vieja.           */

// ¿El frente genera (o protege) dinero? A diferencia del deudor, esto SÍ es
// uniforme por frente, así que vive en el tablero y no en cada tarea.
export function generaDinero(t) {
  const mapa = D().dinero || {};
  const f = t.frente || "";
  if (f in mapa) return !!mapa[f];
  return adivinaDinero(f);
}

// Primera pasada mientras Pablo no marque los frentes a mano.
// Incluye retención: una queja de cliente no genera ingreso, pero perderlo cuesta.
export const adivinaDinero = f => /comercial|cobranza|venta|prospecc|cliente|operaci/i.test(f || "");

// Externo (cliente, proveedor, autoridad) o jerárquico (jefe) pesan más que interno.
function esExternoOJerarquico(t) {
  if (t.tipo) return t.tipo === "externo" || t.tipo === "jerarquico";
  return /comercial|cobranza|cliente|backlog|prospecc/i.test(t.frente || "");
}

// Vector lexicográfico: se compara elemento por elemento, en orden.
export function prioridad(t) {
  return [
    generaDinero(t)        ? 1 : 0,
    esExternoOJerarquico(t) ? 1 : 0,
    detiene(t) > 0          ? 1 : 0,
    diasAtraso(t)
  ];
}

const comparaPrioridad = (a, b) => {
  const pa = prioridad(a), pb = prioridad(b);
  for (let i = 0; i < pa.length; i++) if (pb[i] !== pa[i]) return pb[i] - pa[i];
  return 0;
};

// Por qué quedó donde quedó. Se muestra en la tarjeta: sin esto el orden es magia.
function razones(t) {
  const r = [];
  if (generaDinero(t)) r.push("💰 dinero");
  if (esExternoOJerarquico(t)) r.push(t.tipo === "jerarquico" ? "▲ jerarquía" : "↗ externo");
  const d = detiene(t);
  if (d) r.push(`⛓ detiene ${d}`);
  return r;
}

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
    <div class="deuda-razones">${razones(t).map(x => `<span class="razon">${x}</span>`).join("") || `<span class="razon flojo">sin señal de prioridad</span>`}</div>
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

// Los frentes que generan dinero: una casilla por frente, no por tarea.
// Es la decisión que sí se puede tomar al por mayor.
function pintarFrentesDinero(abiertos) {
  const cont = $("dashDinero");
  if (!cont) return;
  const frentes = [...new Set(abiertos.map(t => t.frente).filter(Boolean))].sort();
  const mapa = D().dinero || {};
  cont.innerHTML = frentes.map(f => {
    const marcado = (f in mapa) ? !!mapa[f] : adivinaDinero(f);
    const inferido = !(f in mapa);
    return `<label class="fdin${marcado ? " on" : ""}">
      <input type="checkbox" data-f="${esc(f)}" ${marcado ? "checked" : ""}>
      ${esc(f)}${inferido ? `<span class="inferido">inferido</span>` : ""}</label>`;
  }).join("");
  cont.querySelectorAll("input").forEach(chk => chk.onchange = () => {
    D().dinero = { ...(D().dinero || {}), [chk.dataset.f]: chk.checked };
    save();
    renderDashboard();
  });
}

export function renderDashboard() {
  const wrap = $("dashWrap");
  if (!wrap) return;

  const abiertos = (D().tasks || []).filter(t => t.status !== "Hecha");
  const meDeben = abiertos.filter(t => ladoDe(t).lado === "me-deben").sort(comparaPrioridad);
  const debo    = abiertos.filter(t => ladoDe(t).lado === "debo").sort(comparaPrioridad);

  pintarFrentesDinero(abiertos);
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
