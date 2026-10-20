// Prueba de la Cabina: HUD de Hoy, cintas por frente, bitácora de movimientos,
// radar de contenido y el catálogo de temas (luxury en vez de autos).
//
// ⛔ NUNCA toca producción, igual que sync.test.mjs:
//   - los archivos de la app se sirven desde disco,
//   - la librería de Supabase (esm.sh) se reemplaza por un cliente falso que
//     contesta con datos inventados y anota cualquier intento de escritura,
//   - cualquier otra petición de red se aborta y hace fallar la prueba
//     (las tipografías de Google Fonts se contestan vacías; solo con CAPTURAS
//     se bajan de verdad, porque son públicas y solo se leen).
//
// Los datos son ficticios a propósito: el repo es público.
//
// Cómo correrla:
//   NODE_PATH="$(npm root -g)" node tests/instrumentos.test.mjs
// Con CAPTURAS=/ruta/a/carpeta además guarda capturas de pantalla.

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
const dia = d => new Date(Date.now() - d * 864e5).toLocaleDateString("en-CA");   // fecha local, como la captura Pablo

function datosDePrueba() {
  const ventas = {
    cards: [
      { id: "a1", title: "Cuenta Uno",    frente: "Frente Alfa", col: "lead", ultima: { fecha: dia(40), texto: "Primer contacto" } },
      { id: "a2", title: "Cuenta Dos",    frente: "Frente Alfa", col: "lead" },
      { id: "a3", title: "Cuenta Tres",   frente: "Frente Alfa", col: "prop" },
      { id: "x1", title: "Cuenta Vieja",  frente: "Frente Alfa", col: "archivo" },
      { id: "b1", title: "Cuenta Cuatro", frente: "Frente Beta", col: "nego", ultima: { fecha: dia(3), texto: "Revisión de contrato" } },
      { id: "b2", title: "Cuenta Cinco",  frente: "Frente Beta", col: "win" },
      { id: "b3", title: "Cuenta Seis",   frente: "Frente Beta", col: "lost" },
      // Como en Ventas de verdad: el pendiente lleva otro frente y se liga por tids.
      { id: "g1", title: "Cuenta Ocho",   frente: "Frente Gamma", col: "prop", tids: ["t9"],
        ultima: { fecha: dia(1), texto: "Propuesta enviada" }, siguiente: { fecha: dia(-5), texto: "Seguimiento" } },
    ],
    tasks: [
      { id: "t1", text: "Mandar propuesta a Cuenta Uno", frente: "Frente Alfa", status: "Por hacer", due: dia(2) },
      { id: "t2", text: "Esperando firma de Cuenta Cuatro", frente: "Frente Beta", status: "En curso" },
      { id: "t3", text: "Definir si se renueva Cuenta Seis", frente: "Frente Beta", status: "Bloqueada" },
      { id: "t9", text: "Revisar contrato de Cuenta Ocho", frente: "MexJet · Comercial", status: "Por hacer", due: dia(-10) },
      { id: "t0", text: "Mandar algo ya resuelto", frente: "Frente Alfa", status: "Hecha", due: dia(9) },
    ],
    rems: [], frentes: [{ name: "Frente Alfa", pct: 0 }],
  };
  return {
    falla: [],
    tablas: {
      boards: [
        { kind: "ventas", data: ventas },
        { kind: "direccion", data: { cards: [{ id: "d1", title: "Tema Uno", frente: "Área Uno", col: "proceso" }], tasks: [], rems: [] } },
        { kind: "personal", data: { cards: [{ id: "p1", title: "Idea Uno", frente: "Casa", col: "ideas" }], tasks: [], rems: [] } },
      ],
      card_events: [
        { kind: "ventas", card_id: "b2", title: "Cuenta Cinco", frente: "Frente Beta", from_col: "nego", to_col: "win",  at: hace(2) },
        { kind: "ventas", card_id: "a3", title: "Cuenta Tres",  frente: "Frente Alfa", from_col: "lead", to_col: "prop", at: hace(45) },
        { kind: "ventas", card_id: "a1", title: "Cuenta Uno",   frente: "Frente Alfa", from_col: null,   to_col: "lead", at: hace(50) },
      ],
      feed: [
        { titulo: "Planta nueva de ejemplo en el corredor", fuente_url: "https://ejemplo.invalid/1", fuente_nombre: "Medio de prueba",
          tema: "inteligencia", seccion: "inteligencia", publicado_at: hace(1), leido: false, descartado: false },
        { titulo: "Pieza de lujo de ejemplo", fuente_url: "https://ejemplo.invalid/2", fuente_nombre: "Medio de prueba",
          tema: "luxury", seccion: "entretenimiento", publicado_at: hace(1), leido: false, descartado: false },
      ],
    },
  };
}

// --- El cliente falso de Supabase. Lee de `datos`; anota cualquier escritura. ---
function instalarFalso(datos) {
  window.__log = [];
  const D = datos;
  const escribe = tabla => { window.__log.push(["ESCRITURA", tabla]) };
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
        upsert() { escribe(tabla); return Promise.resolve({ error: null }) },
        insert() { escribe(tabla); return Promise.resolve({ error: null }) },
        update() { escribe(tabla); return q },
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

const pestana = (page, rotulo) => page.locator(".tab", { hasText: rotulo }).first().click();
const tablero = (page, b) => page.locator(`.switch button[data-b="${b}"]`).click();
const escrituras = page => page.evaluate(() => window.__log.filter(x => x[0] === "ESCRITURA"));
const capturar = async (page, nombre) => { if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, nombre + ".png"), fullPage: true }) };

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });

caso("Hoy en Ventas: el HUD cuenta deudas, frentes en alerta y movimientos de la semana", async () => {
  const { page, ctx } = await abrirApp();
  await pestana(page, "Hoy");
  await page.waitForFunction(() => document.querySelectorAll("#dashHud .cell").length === 6);
  await page.waitForFunction(() => document.querySelector("#dashRadar .radar-it"));
  const hud = await page.$$eval("#dashHud .cell", cs => Object.fromEntries(cs.map(c => [c.querySelector("span").textContent, c.querySelector("b").textContent])));
  assert.equal(hud["Yo debo"], "3");            // t1 y t9 (verbo de entrega) y t3 (sin señal → debo)
  assert.equal(hud["Me deben"], "1");           // t2 ("esperando firma")
  assert.equal(hud["Frentes en alerta"], "1");  // Alfa: 40 días sin moverse
  assert.equal(hud["Movimientos 7 d"], "1");
  assert.equal(hud["Cerradas 7 d"], "1");
  assert.equal(await page.locator(".radar i").count(), 1);
  // Radar de contenido: solo inteligencia/aviación, nada de entretenimiento
  const radar = await page.$$eval("#dashRadar .radar-it", as => as.map(a => a.textContent));
  assert.equal(radar.length, 1);
  assert.match(radar[0], /Planta nueva de ejemplo/);
  await capturar(page, "1-hoy-ventas");
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Frentes: una cinta por frente, con avance, alerta y bitácora; el archivo no cuenta", async () => {
  const { page, ctx } = await abrirApp();
  await pestana(page, "Frentes");
  await page.waitForFunction(() => document.querySelector("#bitacora .mov"));
  const cintas = await page.$$eval(".cinta", cs => cs.map(c => ({
    nombre: c.querySelector(".cinta-cab b").textContent,
    em: c.querySelector(".cinta-cab em").textContent,
    alerta: c.classList.contains("alerta"),
    pie: c.querySelector(".cinta-pie").textContent,
    segmentos: c.querySelectorAll(".cinta-bar i").length,
  })));
  const alfa = cintas.find(c => c.nombre === "Frente Alfa");
  const beta = cintas.find(c => c.nombre === "Frente Beta");
  assert.ok(alfa && beta, "faltan cintas: " + JSON.stringify(cintas));
  assert.equal(alfa.em, "3 tarjetas · 33% avanzó");     // el archivo no cuenta
  assert.equal(alfa.alerta, true);
  assert.match(alfa.pie, /40 d sin movimiento/);
  assert.match(alfa.pie, /1 pendiente \(1 vencido\)/);   // t1; t0 ya está Hecha
  assert.match(alfa.pie, /3 sin siguiente acción/);
  assert.equal(alfa.segmentos, 2);                        // lead y prop
  assert.equal(beta.em, "3 tarjetas · 100% avanzó");     // lo perdido no cuenta para avance
  assert.equal(beta.alerta, false);
  assert.match(beta.pie, /hace 2 d/);
  assert.match(beta.pie, /1 cerrada/);
  assert.match(beta.pie, /2 pendientes/);
  assert.doesNotMatch(beta.pie, /vencido/);
  const gamma = cintas.find(c => c.nombre === "Frente Gamma");
  assert.match(gamma.pie, /1 pendiente/);                  // ligado por tids, no por frente
  assert.doesNotMatch(gamma.pie, /sin siguiente acción/);
  const movs = await page.$$eval("#bitacora .mov", ms => ms.map(m => m.textContent.replace(/\s+/g, " ").trim()));
  assert.equal(movs.length, 3);
  assert.match(movs[0], /Cuenta Cinco Negociación → Ganado/);
  assert.match(movs[2], /alta en Prospecto/);
  await capturar(page, "2-frentes-ventas");
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Si card_events falla, las cintas se pintan con la última acción y se avisa", async () => {
  const datos = datosDePrueba();
  datos.falla = ["card_events"];
  const { page, ctx } = await abrirApp({ datos });
  await pestana(page, "Frentes");
  await page.waitForFunction(() => /No se pudo leer/.test(document.getElementById("bitacoraNota").textContent));
  const alfa = await page.locator(".cinta", { hasText: "Frente Alfa" }).getAttribute("class");
  assert.match(alfa, /alerta/);
  assert.equal(await page.locator("#bitacora .mov").count(), 0);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Entretenimiento: hay pestaña Luxury y ya no hay Autos; salud dice avances e industria", async () => {
  const { page, ctx } = await abrirApp();
  await tablero(page, "entretenimiento");
  const tabs = await page.$$eval(".tab", ts => ts.map(t => t.textContent));
  assert.ok(tabs.includes("Luxury"), tabs.join(" | "));
  assert.ok(!tabs.includes("Autos"), tabs.join(" | "));
  assert.ok(tabs.includes("Salud: avances e industria"), tabs.join(" | "));
  await pestana(page, "Luxury");
  await page.waitForSelector(".pieza");
  assert.match(await page.locator(".pieza h4").first().textContent(), /Pieza de lujo de ejemplo/);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Personal ahora tiene pestaña Frentes; el radar de contenido solo vive en Ventas", async () => {
  const { page, ctx } = await abrirApp();
  await tablero(page, "personal");
  await pestana(page, "Frentes");
  await page.waitForSelector(".cinta");
  assert.equal(await page.locator(".cinta-cab b").first().textContent(), "Casa");
  await tablero(page, "direccion");
  await pestana(page, "Hoy");
  assert.equal(await page.locator("#dashRadarBox").isHidden(), true);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("iPhone: Hoy y Frentes se ven sin desbordar a lo ancho", async () => {
  const { page, ctx } = await abrirApp({ viewport: { width: 390, height: 844 } });
  await pestana(page, "Hoy");
  await page.waitForFunction(() => document.querySelectorAll("#dashHud .cell").length === 6);
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, "la página mide " + ancho + " px de ancho");
  await capturar(page, "3-hoy-iphone");
  await pestana(page, "Frentes");
  await page.waitForSelector(".cinta");
  await capturar(page, "4-frentes-iphone");
  assert.deepEqual(await escrituras(page), []);
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
