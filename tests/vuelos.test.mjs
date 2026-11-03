// Prueba de la pestaña Vuelos (js/ui/vuelos.js): próximos vuelos de los clientes
// en vigilancia y la lista de clientes vigilados.
//
// ⛔ NUNCA toca producción, igual que las otras pruebas: archivos servidos desde
// disco, cliente de Supabase falso que anota cada escritura CON su contenido, y
// cualquier otra petición de red se aborta y hace fallar la prueba.
//
// Los datos son ficticios a propósito: el repo es público.
//
// Cómo correrla:
//   NODE_PATH="$(npm root -g)" node tests/vuelos.test.mjs
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

// Instantes relativos a ahora. en(n) = dentro de n días (negativo = hace n días).
const en = (d, h = 12) => { const x = new Date(Date.now() + d * 864e5); x.setHours(h, 0, 0, 0); return x.toISOString() };
const dia = d => new Date(Date.now() + d * 864e5).toLocaleDateString("en-CA");

function datosDePrueba() {
  const vacio = { cards: [{ id: "c1", title: "Cuenta Uno", frente: "Frente Alfa", col: "lead" }], tasks: [], rems: [] };
  return {
    falla: [],
    tablas: {
      boards: [
        { kind: "ventas", data: vacio },
        { kind: "direccion", data: { cards: [{ id: "d1", title: "Tema Uno", col: "proceso" }], tasks: [], rems: [] } },
        { kind: "personal", data: { cards: [{ id: "p1", title: "Idea Uno", col: "ideas" }], tasks: [], rems: [] } },
      ],
      card_events: [],
      feed: [],
      vuelos_vigilados: [
        { id: "vv1", nombre: "CLIENTE FIJO", claves: "CLF1", tipo: "fijo", activo: true, motivo: "Viaja seguido", contacto: "Asistente de prueba" },
        { id: "vv2", nombre: "CLIENTE TEMPORAL", claves: "CLT1", tipo: "seguimiento", hasta_fecha: dia(5), activo: true, motivo: "Un vuelo que hay que cuidar" },
        { id: "vv3", nombre: "CLIENTE VENCIDO", claves: "CLV1", tipo: "seguimiento", hasta_fecha: dia(-3), activo: true, motivo: "Ya pasó su fecha" },
        { id: "vv4", nombre: "CLIENTE ANTERIOR", claves: "CLA1", tipo: "seguimiento", hasta_fecha: dia(-40), activo: false },
      ],
      vuelos: [
        { id: "f1", cliente: "CLIENTE TEMPORAL", clave_reserva: "RSV02", sale_at: en(4), hora_por_confirmar: true, origen: "Origen B", destino: "Destino B", pasajeros: 5, estado: "programado" },
        { id: "f2", cliente: "CLIENTE FIJO", clave_reserva: "RSV01", sale_at: en(2, 10), origen: "Origen A", destino: "Destino A", equipo: "Equipo X", pasajeros: 2, estado: "cambio", nota: "Cambió el horario" },
        { id: "f3", cliente: "CLIENTE FIJO", clave_reserva: "RSV00", sale_at: en(-1), origen: "Ayer", destino: "Ya voló", estado: "programado" },
      ],
    },
  };
}

// --- El cliente falso de Supabase. Lee de `datos`; anota cada escritura. ---
function instalarFalso(datos) {
  window.__log = [];
  const D = datos;
  window.__fakeSb = {
    auth: {
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      getSession() { return Promise.resolve({ data: { session: { user: { id: "u-prueba" } } } }) },
      refreshSession() { return Promise.resolve({ data: {}, error: null }) },
      signOut() { return Promise.resolve({}) },
    },
    from(tabla) {
      const f = { filtros: [], single: false, escritura: null };
      const resolver = () => {
        if (f.escritura) {
          window.__log.push(["ESCRITURA", tabla, f.escritura.op, f.escritura.valor, f.filtros]);
          return { data: null, error: D.falla.includes("escribir") ? { message: "falla de prueba" } : null };
        }
        window.__log.push(["select", tabla]);
        if (D.falla.includes(tabla)) return { data: null, error: { message: "falla de prueba" } };
        let filas = (D.tablas[tabla] || []).slice();
        for (const [op, col, val] of f.filtros) {
          if (op === "eq") filas = filas.filter(r => r[col] === val);
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
        insert(v) { f.escritura = { op: "insert", valor: v }; return q },
        update(v) { f.escritura = { op: "update", valor: v }; return q },
        upsert(v) { f.escritura = { op: "upsert", valor: v }; return q },
        delete() { f.escritura = { op: "delete", valor: null }; return q },
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
  const ctx = await navegador.newContext({ viewport, timezoneId: "America/Monterrey" });
  await ctx.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("https://esm.sh/@supabase/supabase-js")) {
      return route.fulfill({ contentType: "text/javascript", body: STUB_SUPABASE });
    }
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
  page.on("dialog", d => { page.__dialogos.push(d.message()); d.type() === "confirm" ? d.accept() : d.dismiss() });
  page.__dialogos = [];
  await page.addInitScript(instalarFalso, datos);
  await page.goto(ORIGEN + "/");
  await page.waitForSelector("#app:not(.hidden)");
  return { page, ctx };
}

const pestana = (page, rotulo) => page.locator(".tab", { hasText: rotulo }).first().click();
const tablero = (page, b) => page.locator(`.switch button[data-b="${b}"]`).click();
const escrituras = page => page.evaluate(() => window.__log.filter(x => x[0] === "ESCRITURA"));
const capturar = async (page, nombre) => { if (CAPTURAS) await page.screenshot({ path: join(CAPTURAS, nombre + ".png"), fullPage: true }) };
const irAVuelos = async page => { await pestana(page, "Vuelos"); await page.waitForSelector("#vigLista .vigilado") };

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });

caso("Ventas trae la pestaña Vuelos; Dirección y Personal no", async () => {
  const { page, ctx } = await abrirApp();
  const tabs = () => page.$$eval(".tab", ts => ts.map(t => t.textContent));
  assert.ok((await tabs()).includes("Vuelos"), (await tabs()).join(" | "));
  await tablero(page, "direccion");
  assert.ok(!(await tabs()).includes("Vuelos"));
  await tablero(page, "personal");
  assert.ok(!(await tabs()).includes("Vuelos"));
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Próximos vuelos: solo de hoy en adelante, en orden, con cambio y hora por confirmar marcados", async () => {
  const { page, ctx } = await abrirApp();
  await irAVuelos(page);
  const filas = await page.$$eval("#vueLista .vuelo", vs => vs.map(v => v.textContent.replace(/\s+/g, " ")));
  assert.equal(filas.length, 2, filas.join("\n"));
  assert.match(filas[0], /CLIENTE FIJO.*cambió.*Origen A → Destino A · 2 pax · Equipo X · RSV01/);
  assert.match(filas[0], /Cambió el horario/);
  assert.match(filas[1], /CLIENTE TEMPORAL.*hora por confirmar/);
  assert.ok(!filas.some(f => /Ya voló/.test(f)), "un vuelo de ayer no es próximo");
  assert.equal(await page.locator("#vueN").textContent(), "2");
  await capturar(page, "1-vuelos");
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Clientes vigilados: fijo, hasta su fecha, y el vencido sale como cumplido; los inactivos aparte", async () => {
  const { page, ctx } = await abrirApp();
  await irAVuelos(page);
  const vig = await page.$$eval("#vigLista .vigilado", vs => vs.map(v => v.textContent.replace(/\s+/g, " ")));
  assert.equal(vig.length, 3, vig.join("\n"));
  assert.ok(vig.some(v => /CLIENTE FIJO.*Fijo/.test(v)));
  assert.ok(vig.some(v => /CLIENTE TEMPORAL.*hasta/.test(v)));
  assert.ok(vig.some(v => /CLIENTE VENCIDO.*cumplido/.test(v)));
  assert.match(await page.locator("#vigFuera").textContent(), /CLIENTE ANTERIOR/);
  assert.equal(await page.locator("#vigN").textContent(), "3");
  await ctx.close();
});

caso("Agregar un cliente: UN insert en vuelos_vigilados con lo capturado, y nada en boards", async () => {
  const { page, ctx } = await abrirApp();
  await irAVuelos(page);
  await page.locator("#vigNuevo summary").click();
  await page.fill('#vigForm [name="nombre"]', "cliente nuevo");
  await page.fill('#vigForm [name="claves"]', "CLN1");
  await page.fill('#vigForm [name="hasta"]', dia(10));
  await page.fill('#vigForm [name="motivo"]', "Vuelo de prueba");
  await page.click('#vigForm button[type="submit"]');
  await page.waitForFunction(() => window.__log.some(x => x[0] === "ESCRITURA"));
  const es = await escrituras(page);
  assert.equal(es.length, 1, JSON.stringify(es));
  const [, tabla, op, fila] = es[0];
  assert.equal(tabla, "vuelos_vigilados");
  assert.equal(op, "insert");
  assert.equal(fila.nombre, "CLIENTE NUEVO");
  assert.equal(fila.tipo, "seguimiento");
  assert.equal(fila.hasta_fecha, dia(10));
  assert.equal(fila.claves, "CLN1");
  await ctx.close();
});

caso("Un seguimiento sin fecha de fin no se agrega: avisa y no escribe", async () => {
  const { page, ctx } = await abrirApp();
  await irAVuelos(page);
  await page.locator("#vigNuevo summary").click();
  await page.fill('#vigForm [name="nombre"]', "Sin fecha");
  await page.fill('#vigForm [name="claves"]', "SF1");
  await page.click('#vigForm button[type="submit"]');
  await page.waitForTimeout(150);
  assert.ok(page.__dialogos.some(m => /fecha de fin/.test(m)), page.__dialogos.join(" | "));
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("Quitar a un cliente es un UPDATE activo=false de su fila, nunca un borrado", async () => {
  const { page, ctx } = await abrirApp();
  await irAVuelos(page);
  await page.locator("#vigLista .vigilado", { hasText: "CLIENTE VENCIDO" }).locator(".b-quitar").click();
  await page.waitForFunction(() => window.__log.some(x => x[0] === "ESCRITURA"));
  const es = await escrituras(page);
  assert.equal(es.length, 1, JSON.stringify(es));
  const [, tabla, op, valor, filtros] = es[0];
  assert.equal(tabla, "vuelos_vigilados");
  assert.equal(op, "update");
  assert.deepEqual(valor, { activo: false });
  assert.deepEqual(filtros, [["eq", "id", "vv3"]]);
  assert.equal(await page.locator("#vigLista .vigilado").count(), 2);
  await ctx.close();
});

caso("Si no se pueden leer los vuelos, la pestaña lo dice y el resto de la app sigue", async () => {
  const datos = datosDePrueba();
  datos.falla.push("vuelos");
  const { page, ctx } = await abrirApp({ datos });
  await pestana(page, "Vuelos");
  await page.waitForFunction(() => /No se pudieron leer/.test(document.getElementById("vueLista").textContent));
  await pestana(page, "Pipeline");
  assert.match(await page.locator("#board").textContent(), /Cuenta Uno/);
  assert.deepEqual(await escrituras(page), []);
  await ctx.close();
});

caso("iPhone: la pestaña Vuelos no desborda a lo ancho", async () => {
  const { page, ctx } = await abrirApp({ viewport: { width: 390, height: 844 } });
  await irAVuelos(page);
  await page.locator("#vigNuevo summary").click();
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(ancho <= 390, "la página mide " + ancho + " px de ancho");
  await capturar(page, "2-vuelos-iphone");
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
