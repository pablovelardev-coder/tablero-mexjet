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
  if (!t.frente || !D()) return 0;
  return (D().tasks || []).filter(o => o.id !== t.id && o.status !== "Hecha" && (o.frente||"") === t.frente).length;
}

const diasAtraso = t => { const d = diasDesde(t.due); return d !== null && d > 0 ? d : 0 };

/* ---------- Árbol de decisión (Pablo, 31-ago) ----------
   Preguntas en orden de importancia, no una suma ponderada. Un "sí" en la
   primera gana sobre cualquier cosa de la segunda: así no hay que inventar pesos
   y Pablo puede auditar por qué algo salió arriba.

     1. ¿Impacta el bono?   ← "todo lo que impacta en bono es prioridad" (Pablo)
     2. ¿Genera —o protege— dinero?
     3. ¿Se le debe a un externo o a alguien de jerarquía?
     4. ¿Bloquea otra tarea?

   El atraso ya no ordena: desempata. Una tarea vieja que no genera dinero ni
   bloquea a nadie no debería encabezar el día solo por ser vieja.

   El bono va arriba de "dinero" porque es dinero de Pablo, no de la empresa,
   y porque sus indicadores dependen de terceros: si no se empujan, no se
   evalúan. Las quejas de clientes entran aquí vía la hoja Afectaciones.     */

// Jefes y directores. La deuda con ellos pesa más que con un par.
//
// ⚠️ Nombres COMPLETOS a propósito. Verificado contra los tableros y el índice
// de personas del vault, donde los nombres sueltos chocan con otras personas:
//   "Miguel"  → Miguel Ángel González (jefe) vs Miguel Padrón (proveedor) vs Miguel Garza (cliente)
//   "Ponce"   → Alejandro/Alex Ponce (jefe) vs Daniela Ponce (otra persona)
//   "Arturo"  → Arturo Ortega (jefe) vs "el mecánico Arturo" vs "el depa de Arturo"
//   "Sierra"  → Manuel Sierra (CEO) vs una dirección de inmueble en Guadalupe
//   "Salazar" → Rodrigo Salazar (dir. ventas) vs Claudia, Karina y Laura Salazar
const JEFES = [
  /manuel\s+sierra/i,     // CEO de Aerolíneas Ejecutivas
  /rodrigo\s+salazar/i,   // Director de ventas MexJet
  /santiago\s+ortega/i,
  /miguel\s+[áa]ngel(\s+gonz[áa]lez)?/i,
  /(alejandro|alex)\s+ponce/i,
  // Isabel Avelarde, de RRHH. Se aceptan las dos formas porque los pendientes
  // ya escritos dicen "ISABEL DE RRHH" (se capturaron sin el apellido).
  /isabel\s+(avelarde|de\s+rrhh)/i,
  /arturo\s+ortega/i,
  /\bdirector(a|es)?\b/i  // cualquier director, por título
];

const mencionaJefe = s => JEFES.some(rx => rx.test(s || ""));

// ¿Impacta el bono? Explícito, o la tarea lo dice, o su frente está marcado.
export function impactaBono(t) {
  if (typeof t.bono === "boolean") return t.bono;
  if (/^\s*bono\b|impacta\w*\s+(en\s+)?(el\s+)?bono/i.test(t.text || "")) return true;
  const mapa = (D() || {}).bonoFrentes || {};
  const f = t.frente || "";
  if (f in mapa) return !!mapa[f];
  return adivinaBono(f);
}

// Quejas y afectaciones alimentan la hoja Afectaciones, que es indicador del bono.
export const adivinaBono = f => /operaci[oó]n|cliente/i.test(f || "");

// ¿El frente genera (o protege) dinero? A diferencia del deudor, esto SÍ es
// uniforme por frente, así que vive en el tablero y no en cada tarea.
export function generaDinero(t) {
  const mapa = (D() || {}).dinero || {};
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
  if (mencionaJefe(t.deudor) || mencionaJefe(t.acreedor) || mencionaJefe(t.text)) return true;
  return /comercial|cobranza|cliente|backlog|prospecc/i.test(t.frente || "");
}

// Distingue jerarquía de externo, para que la etiqueta diga la verdad.
const esJerarquia = t => t.tipo === "jerarquico"
  || mencionaJefe(t.deudor) || mencionaJefe(t.acreedor) || mencionaJefe(t.text);

// Vector lexicográfico: se compara elemento por elemento, en orden.
export function prioridad(t) {
  return [
    impactaBono(t)         ? 1 : 0,
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
  if (impactaBono(t)) r.push("🎯 bono");
  if (generaDinero(t)) r.push("💰 dinero");
  if (esExternoOJerarquico(t)) r.push(esJerarquia(t) ? "▲ jerarquía" : "↗ externo");
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
  const dn = (D() || {}).dinero || {}, bn = (D() || {}).bonoFrentes || {};

  cont.innerHTML = `<table class="ftab"><thead><tr>
      <th>Frente</th>
      <th title="Todo lo que impacta el bono es prioridad">🎯 bono</th>
      <th>💰 dinero</th>
    </tr></thead><tbody>` +
    frentes.map(f => {
      const b = (f in bn) ? !!bn[f] : adivinaBono(f);
      const d = (f in dn) ? !!dn[f] : adivinaDinero(f);
      return `<tr><td>${esc(f)}</td>
        <td><input type="checkbox" data-k="bono" data-f="${esc(f)}" ${b ? "checked" : ""}>${(f in bn) ? "" : `<span class="inferido">inf</span>`}</td>
        <td><input type="checkbox" data-k="dinero" data-f="${esc(f)}" ${d ? "checked" : ""}>${(f in dn) ? "" : `<span class="inferido">inf</span>`}</td></tr>`;
    }).join("") + `</tbody></table>`;

  cont.querySelectorAll("input").forEach(chk => chk.onchange = () => {
    const clave = chk.dataset.k === "bono" ? "bonoFrentes" : "dinero";
    const d = D();
    d[clave] = { ...(d[clave] || {}), [chk.dataset.f]: chk.checked };
    save();
    renderDashboard();
  });
}


/* ==================== Bloque 3: decisiones que desbloquean ====================
   No es "lo bloqueado": es lo que Pablo puede resolver de un tirón y que libera
   trabajo detenido. El valor está en el cociente — poco esfuerzo, mucho suelto. */

// La tarea pide una decisión, no una ejecución.
const ES_DECISION = /^\s*(definir|decidir|elegir|fijar|autorizar|aprobar|confirmar|resolver)\b|\bdefinir si\b|\bdecidir\b|\bfalta (el )?dato\b|\bpor confirmar\b|\bdesbloquea\b|\bqueda por definir\b/i;

export function esDecision(t) {
  return t.status === "Bloqueada" || ES_DECISION.test(t.text || "");
}

export function decisionesQueDesbloquean(abiertos) {
  return abiertos
    .filter(esDecision)
    .map(t => ({ t, libera: detiene(t) }))
    // Primero lo que más libera. Pero "liberar" solo cuenta pendientes del mismo
    // frente, y hay decisiones cuyo costo es externo — "definir quién monitorea
    // info@ale.mx" no destraba ninguna tarea y sin embargo se está perdiendo
    // demanda entrante. Por eso a igualdad de liberación manda el árbol (bono,
    // dinero), y solo al final la decisión más corta de explicar.
    .sort((a, b) => (b.libera - a.libera) || comparaPrioridad(a.t, b.t)
                 || ((a.t.text || "").length - (b.t.text || "").length));
}

function pintarDecisiones(abiertos) {
  const c = $("dashDecisiones");
  if (!c) return;
  const lista = decisionesQueDesbloquean(abiertos);
  $("dashDecisionesN").textContent = lista.length;
  if (!lista.length) { c.innerHTML = `<p class="sub">Ninguna decisión pendiente detectada.</p>`; return }

  c.innerHTML = "";
  lista.slice(0, 8).forEach(({ t, libera }) => {
    const el = document.createElement("div");
    el.className = "deci" + (libera >= 5 ? " gorda" : "");
    el.innerHTML = `
      <div class="deci-cab">
        ${libera ? `<span class="libera">libera ${libera}</span>` : `<span class="libera cero">no libera nada</span>`}
        ${t.status === "Bloqueada" ? `<span class="razon">bloqueada</span>` : ""}
        ${impactaBono(t) ? `<span class="razon">🎯 bono</span>` : ""}
      </div>
      <div class="deuda-tx">${esc(clip(t.text || "", 180))}</div>
      ${t.frente ? `<div class="deuda-pie"><span class="deuda-frente">${esc(t.frente)}</span>
        ${libera ? `<button class="deuda-detiene" type="button">ver lo que libera</button>` : ""}</div>` : ""}`;
    const b = el.querySelector(".deuda-detiene");
    if (b) b.onclick = () => { setTaskFilter({ label: t.frente, frente: t.frente }); showTab("pendientes"); renderTasks() };
    c.appendChild(el);
  });
}

/* ==================== Bloque 4: estatus operativo del tablero ==================
   Salud del tablero como sistema, no del negocio. Responde "¿me puedo fiar de
   lo que estoy viendo?". Cubre el hueco que el CLAUDE.md llama "sin rutina de
   salud": nadie revisa vencidos, huérfanos ni duplicados.                     */

const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

export function saludDelTablero(abiertos, cards) {
  // Duplicados: mismo texto en dos pendientes distintos. Ya apareció uno real
  // (la tarea de Isabel estaba en dos frentes) y nadie lo habría notado.
  const porTexto = {};
  abiertos.forEach(t => { const k = norm(t.text); if (k) (porTexto[k] ||= []).push(t) });
  const duplicados = Object.values(porTexto).filter(g => g.length > 1);

  return [
    { id: "sinFecha",    n: abiertos.filter(t => !t.due).length,
      etiqueta: "sin fecha", ayuda: "No se pueden priorizar por vencimiento ni salen en el semáforo." },
    { id: "sinFrente",   n: abiertos.filter(t => !t.frente).length,
      etiqueta: "sin frente", ayuda: "No se ligan a ninguna tarjeta: son invisibles en el pipeline." },
    { id: "sinDeudor",   n: abiertos.filter(t => !t.deudor && !t.acreedor).length,
      etiqueta: "sin contraparte", ayuda: "Su montón está inferido del texto, no confirmado." },
    { id: "duplicados",  n: duplicados.length,
      etiqueta: "duplicados", ayuda: "El mismo pendiente escrito dos veces; infla lo que cada frente parece detener.",
      detalle: duplicados.map(g => `${g.length}× ${clip(g[0].text || "", 70)}`) },
    { id: "sinSiguiente", n: cards.filter(c => !(c.siguiente && c.siguiente.texto)).length,
      etiqueta: "tarjetas sin siguiente acción", ayuda: "Nadie sabe qué sigue en ellas." },
    { id: "estancadas",  n: cards.filter(c => { const d = diasDesde((c.ultima || {}).fecha); return d !== null && d >= 30 }).length,
      etiqueta: "tarjetas estancadas +30d", ayuda: "Sin movimiento registrado en más de un mes." }
  ];
}

function pintarSalud(abiertos) {
  const c = $("dashSalud");
  if (!c) return;
  const cards = (D() || {}).cards || [];
  const m = saludDelTablero(abiertos, cards);
  c.innerHTML = m.map(x => `
    <div class="salud${x.n ? (x.id === "duplicados" || x.id === "sinFrente" ? " mal" : " ojo") : " bien"}" title="${esc(x.ayuda)}">
      <b>${x.n}</b><span>${esc(x.etiqueta)}</span>
    </div>`).join("");

  const dup = m.find(x => x.id === "duplicados");
  const det = $("dashSaludDetalle");
  if (det) det.innerHTML = (dup && dup.n)
    ? `<b>Duplicados:</b><ul>${dup.detalle.map(d => `<li>${esc(d)}</li>`).join("")}</ul>`
    : "";
}

export function renderDashboard() {
  const wrap = $("dashWrap");
  if (!wrap) return;

  if (!D()) return;
  const abiertos = (D().tasks || []).filter(t => t.status !== "Hecha");
  const meDeben = abiertos.filter(t => ladoDe(t).lado === "me-deben").sort(comparaPrioridad);
  const debo    = abiertos.filter(t => ladoDe(t).lado === "debo").sort(comparaPrioridad);

  pintarFrentesDinero(abiertos);
  $("dashMeDebenN").textContent = meDeben.length;
  $("dashDeboN").textContent = debo.length;

  pintarMonton("dashMeDeben", meDeben.slice(0,12), "me-deben", "Nadie te debe nada abierto.");
  pintarMonton("dashDebo", debo.slice(0,12), "debo", "No debes nada abierto.");
  pintarDecisiones(abiertos);
  pintarSalud(abiertos);

  // Sin contraparte asignada: el montón que se vacía solo conforme Pablo usa el tablero.
  const sinAsignar = abiertos.filter(t => !t.deudor && !t.acreedor).length;
  $("dashSinAsignar").textContent = sinAsignar
    ? `${sinAsignar} de ${abiertos.length} pendientes todavía sin deudor confirmado — el lado está inferido del texto.`
    : "Todos los pendientes tienen contraparte asignada.";
}
