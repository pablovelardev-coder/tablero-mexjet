// Prueba del botón "Encargar a Claude" (js/ui/encargo.js): desde una tarjeta o
// un pendiente se deja un encargo en `session_log` para la siguiente sesión.
//
// ⛔ NUNCA toca producción: archivos servidos desde disco, cliente de Supabase
// falso que anota cada escritura con su contenido, y cualquier otra petición de
// red se aborta y hace fallar la prueba. Datos ficticios: el repo es público.
//
// Cómo correrla:
//   NODE_PATH="$(npm root -g)" node tests/encargo.test.mjs

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = "http://prueba.local";
const CAPTURAS = process.env.CAPTURAS || "";

function datosDePrueba() {
  const ventas = {
    cards: [
      { id: "a1", title: "Cuenta Uno", frente: "Frente Alfa", col: "lead" },
      { id: "a2", title: "Cuenta Dos", frente: "Frente Alfa", col: "prop" },
    ],
    tasks: [
      { id: "t1", text: "Mandar propuesta a Cuenta Uno", frente: "Frente Alfa", status: "Por hacer", due: "2030-01-15" },
      { id: "t2", text: "Revisar contrato de Cuenta Dos", frente: "Frente Alfa", status: "En curso", due: "2030-01-20" },
    ],
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
      card_events: [], feed: [], session_log: [],
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
        insert(fila) { escribe(tabla, fila); return Promise.resolve(D.falla.includes(tabla) ? { error: { message: "falla de prueba" } } : { error: null }) },
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
const pestana = (page, rotulo) => page.locator(".tab", { hasText: rotulo }).first().click();
const capturar = async (page, nombre) => { if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, nombre + ".png"), fullPage: true }) };
const dialogos = (page, respuesta) => {
  const vistos = [];
  page.on("dialog", d => { vistos.push([d.type(), d.message()]); d.type() === "prompt" ? (respuesta === null ? d.dismiss() : d.accept(respuesta)) : d.accept() });
  return vistos;
};

caso("Desde una tarjeta: deja UNA fila en session_log con la referencia y no toca los tableros", async () => {
  const { page, ctx } = await abrirApp();
  const vistos = dialogos(page, "Prepárame la propuesta");
  await pestana(page, "Pipeline");
  await page.locator(".card", { hasText: "Cuenta Uno" }).first().click();
  await page.waitForSelector("#cardDlg[open]");
  assert.equal(await page.locator("#cEncargo").isVisible(), true);
  await capturar(page, "1-tarjeta");
  await page.locator("#cEncargo").click();
  await page.waitForFunction(() => window.__datos.length > 0);
  await page.waitForTimeout(100);
  const es = await escrituras(page);
  assert.equal(es.length, 1, JSON.stringify(es));
  const [tabla, fila] = es[0];
  assert.equal(tabla, "session_log");
  assert.equal(fila.user_id, "u-prueba");
  assert.equal(fila.device, "app");
  assert.equal(fila.session_ref, "encargo");
  assert.deepEqual(fila.tags, ["accion-pendiente", "encargo-app", "ventas"]);
  assert.equal(fila.summary, "ENCARGO DESDE LA APP — tablero ventas · tarjeta a1 «Cuenta Uno»: Prepárame la propuesta");
  assert.deepEqual(vistos.map(v => v[0]), ["prompt", "alert"]);
  assert.match(vistos[1][1], /siguiente sesión/);
  assert.equal(await page.locator("#cardDlg[open]").count(), 1);   // la ventana sigue abierta
  await ctx.close();
});

caso("Una tarjeta nueva (sin guardar) no muestra el botón", async () => {
  const { page, ctx } = await abrirApp();
  await pestana(page, "Pipeline");
  await page.locator(".addcard").first().click();
  await page.waitForSelector("#cardDlg[open]");
  assert.equal(await page.locator("#cEncargo").isVisible(), false);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Desde un pendiente: 🤖 encarga y ✕ sigue borrando solo ese pendiente", async () => {
  const { page, ctx } = await abrirApp();
  dialogos(page, "Dale seguimiento");
  await pestana(page, "Pendientes");
  const fila = page.locator("#tblTasks tbody tr", { has: page.locator('input[value="Revisar contrato de Cuenta Dos"]') });
  await fila.locator(".b-encargo").click();
  await page.waitForFunction(() => window.__datos.length > 0);
  await page.waitForTimeout(100);
  let es = await escrituras(page);
  assert.equal(es.length, 1, JSON.stringify(es));
  assert.equal(es[0][0], "session_log");
  assert.equal(es[0][1].summary, "ENCARGO DESDE LA APP — tablero ventas · pendiente t2 «Revisar contrato de Cuenta Dos»: Dale seguimiento");
  assert.equal(await page.locator("#tblTasks tbody tr").count(), 2);   // encargar no borra
  await capturar(page, "2-pendientes");
  await fila.locator(".b-borrar").click();
  await page.waitForFunction(() => window.__datos.some(([t]) => t === "boards"));
  es = await escrituras(page);
  const guardado = es.find(([t]) => t === "boards")[1];
  assert.deepEqual(guardado.data.tasks.map(t => t.id), ["t1"]);
  await ctx.close();
});

caso("Si se cancela el pedido, no se escribe nada", async () => {
  const { page, ctx } = await abrirApp();
  dialogos(page, null);
  await pestana(page, "Pendientes");
  await page.locator("#tblTasks .b-encargo").first().click();
  await page.waitForTimeout(300);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Si la base rechaza el encargo, se avisa que no quedó", async () => {
  const datos = datosDePrueba();
  datos.falla = ["session_log"];
  const { page, ctx } = await abrirApp({ datos });
  const vistos = dialogos(page, "Algo");
  await pestana(page, "Pendientes");
  await page.locator("#tblTasks .b-encargo").first().click();
  await page.waitForFunction(() => /error/.test(document.getElementById("sync").textContent));
  await page.waitForTimeout(100);
  assert.deepEqual(vistos.map(v => v[0]), ["prompt", "alert"]);
  assert.match(vistos[1][1], /No se pudo/);
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
