// Prueba del botón "→ lead en Ventas" de Inteligencia comercial (js/ui/feed.js):
// una nota se vuelve tarjeta en la columna Prospecto de Ventas.
//
// ⛔ NUNCA toca producción, igual que las otras pruebas: archivos servidos desde
// disco, cliente de Supabase falso que anota cada escritura CON su contenido, y
// cualquier otra petición de red se aborta y hace fallar la prueba.
//
// Los datos son ficticios a propósito: el repo es público.
//
// Cómo correrla:
//   NODE_PATH="$(npm root -g)" node tests/lead-desde-nota.test.mjs

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = "http://prueba.local";
const CAPTURAS = process.env.CAPTURAS || "";

const hace = d => new Date(Date.now() - d * 864e5).toISOString();

function datosDePrueba() {
  const ventas = {
    cards: [
      { id: "a1", title: "Cuenta Uno", frente: "Frente Alfa", col: "lead" },
      { id: "a2", title: "Cuenta Dos", frente: "Frente Alfa", col: "prop" },
    ],
    tasks: [{ id: "t1", text: "Pendiente de prueba", frente: "Frente Alfa", status: "Por hacer" }],
    rems: [], frentes: [],
  };
  return {
    falla: [],
    tablas: {
      boards: [
        { kind: "ventas", data: ventas },
        { kind: "direccion", data: { cards: [{ id: "d1", title: "Tema Uno", col: "proceso" }], tasks: [], rems: [] } },
        { kind: "personal", data: { cards: [{ id: "p1", title: "Idea Uno", col: "ideas" }], tasks: [], rems: [] } },
      ],
      card_events: [],
      feed: [
        { id: "f1", titulo: "Empresa ficticia anuncia planta en el corredor", resumen: "Resumen de prueba.",
          fuente_url: "https://ejemplo.invalid/planta", fuente_nombre: "Medio de prueba",
          tema: "inteligencia", seccion: "inteligencia", publicado_at: hace(1), leido: false, guardado: false, descartado: false },
        { id: "f2", titulo: "Nota de aviación de ejemplo", fuente_url: "https://ejemplo.invalid/avion", fuente_nombre: "Medio de prueba",
          tema: "aviacion", seccion: "capacitacion", publicado_at: hace(1), leido: false, guardado: false, descartado: false },
      ],
    },
  };
}

// --- El cliente falso de Supabase. Lee de `datos`; anota cualquier escritura. ---
function instalarFalso(datos) {
  window.__log = [];
  const D = datos;
  window.__datosPrueba = D;
  window.__datos = [];
  const escribe = (tabla, dato) => { window.__log.push(["ESCRITURA", tabla]); window.__datos.push([tabla, dato]) };
  window.__fakeSb = {
    auth: {
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      getSession() { return Promise.resolve({ data: { session: { user: { id: "u-prueba" } } } }) },
      signOut() { return Promise.resolve({}) },
    },
    from(tabla) {
      const f = { filtros: [], single: false };
      const resolver = () => {
        window.__log.push(["select", tabla]);
        if (D.falla.includes(tabla)) return { data: null, error: { message: "falla de prueba" } };
        let filas = (D.tablas[tabla] || []).slice();
        for (const [op, col, val] of f.filtros) {
          if (op === "eq") filas = filas.filter(r => r[col] === val);
          if (op === "in") filas = filas.filter(r => val.includes(r[col]));
          if (op === "gte") filas = filas.filter(r => r[col] >= val);
        }
        return { data: f.single ? (filas[0] || null) : filas, error: null };
      };
      const q = {
        select() { return q },
        eq(c, v) { f.filtros.push(["eq", c, v]); return q },
        in(c, v) { f.filtros.push(["in", c, v]); return q },
        gte(c, v) { f.filtros.push(["gte", c, v]); return q },
        order() { return q }, limit() { return q },
        maybeSingle() { f.single = true; return Promise.resolve(resolver()) },
        then(ok, ko) { return Promise.resolve(resolver()).then(ok, ko) },
        upsert(fila) { escribe(tabla, fila); return Promise.resolve({ error: null }) },
        insert() { escribe(tabla); return Promise.resolve({ error: null }) },
        update(campos) { escribe(tabla, campos); return q },
        delete() { escribe(tabla); return q },
      };
      return q;
    },
    channel() { const ch = { on() { return ch }, subscribe() { return ch } }; return ch },
  };
}

const STUB_SUPABASE = "export function createClient() { return window.__fakeSb }";
const TIPO = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript" };

let navegador;
const fugas = [];
const erroresJs = [];

async function abrirApp({ datos = datosDePrueba(), viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await navegador.newContext({ viewport });
  await ctx.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("https://esm.sh/@supabase/supabase-js")) {
      return route.fulfill({ contentType: "text/javascript", body: STUB_SUPABASE });
    }
    // Tipografías: solo se bajan de verdad si se piden capturas; si no, se contestan vacías.
    if (url.startsWith("https://fonts.googleapis.com/") || url.startsWith("https://fonts.gstatic.com/")) {
      return CAPTURAS ? route.continue() : route.fulfill({ contentType: "text/css", body: "" });
    }
    if (url.startsWith(ORIGEN + "/")) {
      let ruta = new URL(url).pathname;
      if (ruta === "/") ruta = "/index.html";
      const archivo = normalize(join(RAIZ, ruta));
      if (!archivo.startsWith(RAIZ)) return route.abort();
      const tipo = TIPO[archivo.slice(archivo.lastIndexOf("."))] || "application/octet-stream";
      try { return route.fulfill({ contentType: tipo, body: readFileSync(archivo) }) }
      catch { return route.fulfill({ status: 404, body: "" }) }
    }
    fugas.push(url);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => erroresJs.push(e.message));
  await page.addInitScript(instalarFalso, datos);
  await page.goto(ORIGEN + "/");
  await page.waitForSelector("#app:not(.hidden)");
  return { page, ctx };
}


const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const escrituras = page => page.evaluate(() => window.__datos);
const tablero = (page, b) => page.locator(`.switch button[data-b="${b}"]`).click();
const pestana = (page, rotulo) => page.locator(".tab", { hasText: rotulo }).first().click();
const capturar = async (page, nombre) => { if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, nombre + ".png"), fullPage: true }) };

async function irAInteligencia(page) {
  await tablero(page, "capacitacion");
  await pestana(page, "Inteligencia comercial");
  await page.waitForSelector(".pieza");
}

caso("Solo las notas de Inteligencia traen el botón; las de otros temas no", async () => {
  const { page, ctx } = await abrirApp();
  await irAInteligencia(page);
  assert.equal(await page.locator(".pieza .b-lead").count(), 1);
  assert.equal((await page.locator(".pieza .b-lead").textContent()).trim(), "→ lead en Ventas");
  await capturar(page, "1-boton-lead");
  await pestana(page, "Aviación y competencia");
  await page.waitForFunction(() => /aviación de ejemplo/.test(document.getElementById("feedLista").textContent));
  assert.equal(await page.locator(".pieza .b-lead").count(), 0);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Un clic crea la tarjeta en Prospecto: recarga Ventas, agrega sin quitar nada y marca la nota leída", async () => {
  const { page, ctx } = await abrirApp();
  await irAInteligencia(page);
  page.once("dialog", d => { assert.equal(d.type(), "prompt"); d.accept("Empresa Ficticia") });
  const lecturasAntes = await page.evaluate(() => window.__log.filter(x => x[0] === "select" && x[1] === "boards").length);
  await page.locator(".pieza .b-lead").click();
  await page.waitForFunction(() => /en Ventas/.test(document.querySelector(".pieza .b-lead").textContent));
  const lecturasDespues = await page.evaluate(() => window.__log.filter(x => x[0] === "select" && x[1] === "boards").length);
  assert.ok(lecturasDespues > lecturasAntes, "debe recargar Ventas de la base antes de escribir");
  const es = await escrituras(page);
  const aBoards = es.filter(([t]) => t === "boards");
  assert.equal(aBoards.length, 1, JSON.stringify(es));
  const fila = aBoards[0][1];
  assert.equal(fila.kind, "ventas");
  assert.deepEqual(fila.data.cards.slice(0, 2).map(c => c.id), ["a1", "a2"]);   // nada se pierde
  assert.equal(fila.data.tasks.length, 1);
  const nueva = fila.data.cards[2];
  assert.equal(fila.data.cards.length, 3);
  assert.equal(nueva.col, "lead");
  assert.equal(nueva.title, "Empresa Ficticia");
  assert.equal(nueva.frente, "Prospección");
  assert.deepEqual(nueva.labels, ["Inteligencia"]);
  assert.deepEqual(nueva.origen, { feed_id: "f1", fuente_url: "https://ejemplo.invalid/planta" });
  assert.match(nueva.meta, /ejemplo\.invalid\/planta/);
  assert.match(nueva.id, /^v_intel_\d{8}_/);
  assert.deepEqual(es.filter(([t]) => t === "feed").map(([, d]) => d), [{ leido: true }]);
  assert.equal(await page.locator(".pieza .b-lead").isDisabled(), true);
  await capturar(page, "2-ya-en-ventas");
  await ctx.close();
});

caso("Si se cancela el nombre, no se escribe nada", async () => {
  const { page, ctx } = await abrirApp();
  await irAInteligencia(page);
  page.once("dialog", d => d.dismiss());
  await page.locator(".pieza .b-lead").click();
  await page.waitForTimeout(300);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Una nota que ya está en Ventas sale como ✓ en Ventas y no se puede mandar otra vez", async () => {
  const datos = datosDePrueba();
  datos.tablas.boards[0].data.cards.push({ id: "v_intel_x", title: "Ya existe", col: "lead", origen: { feed_id: "f1" } });
  const { page, ctx } = await abrirApp({ datos });
  await irAInteligencia(page);
  assert.equal((await page.locator(".pieza .b-lead").textContent()).trim(), "✓ en Ventas");
  assert.equal(await page.locator(".pieza .b-lead").isDisabled(), true);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Si no se puede leer Ventas de la base, no se escribe y se avisa", async () => {
  const { page, ctx } = await abrirApp();
  await irAInteligencia(page);
  await page.evaluate(() => { const D = window.__datosPrueba; D.falla.push("boards") });
  const dialogos = [];
  page.on("dialog", d => { dialogos.push(d.type()); d.type() === "prompt" ? d.accept("Empresa Ficticia") : d.accept() });
  await page.locator(".pieza .b-lead").click();
  await page.waitForFunction(() => /error/.test(document.getElementById("sync").textContent));
  await page.waitForTimeout(200);
  assert.deepEqual(dialogos, ["prompt", "alert"]);
  assert.deepEqual(await escrituras(page), []);
  assert.equal(await page.locator(".pieza .b-lead").isDisabled(), false);
  await ctx.close();
});

// --- Correr ----------------------------------------------------------------
navegador = await chromium.launch();
let fallas = 0;
for (const { nombre, fn } of casos) {
  try { await fn(); console.log("✓", nombre) }
  catch (e) { fallas++; console.log("✗", nombre, "\n   ", e.message) }
}
await navegador.close();
if (fugas.length) { fallas++; console.log("✗ peticiones de red no permitidas:", [...new Set(fugas)].join(", ")) }
if (erroresJs.length) { fallas++; console.log("✗ errores de JavaScript en la página:", [...new Set(erroresJs)].join(" | ")) }
console.log(fallas ? `\n${fallas} falla(s)` : `\nTodo en orden: ${casos.length} casos.`);
process.exit(fallas ? 1 : 0);
