// Prueba de las fechas de js/util.js: "hoy" es el día local, no el de UTC.
//
// El caso que importa: después de las 18:00 de Monterrey (UTC-6) en UTC ya es
// mañana. Con `toISOString()` las tareas salían vencidas un día antes, los
// atrasos y "N días sin movimiento" salían corridos en uno, y una tarea nueva
// nacía con fecha de mañana. Aquí el reloj se fija a las 20:00 de Monterrey.
//
// ⛔ NUNCA toca producción, igual que sync.test.mjs:
//   - los archivos de la app se sirven desde disco,
//   - la librería de Supabase (esm.sh) se reemplaza por un cliente falso,
//   - cualquier otra petición de red se aborta y hace fallar la prueba.
//
// Los datos son ficticios a propósito: el repo es público.
//
// Cómo correrla:
//   NODE_PATH="$(npm root -g)" node tests/fechas.test.mjs

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = "http://prueba.local";
const ZONA = "America/Monterrey";   // UTC-6 todo el año desde 2022

// 19-oct-2026 a las 20:00 en Monterrey = 20-oct a las 02:00 en UTC.
const NOCHE = new Date("2026-10-19T20:00:00-06:00");

function datosDePrueba() {
  return {
    ventas: {
      cards: [
        { id: "c1", title: "Tarjeta de 14 días", col: "lead", ultima: { fecha: "2026-10-05", texto: "Último contacto" } },
        { id: "c2", title: "Tarjeta de 13 días", col: "lead", ultima: { fecha: "2026-10-06", texto: "Último contacto" } },
      ],
      tasks: [
        { id: "t1", text: "Vence ayer", due: "2026-10-18", status: "Por hacer", frente: "" },
        { id: "t2", text: "Vence hoy",  due: "2026-10-19", status: "Por hacer", frente: "" },
      ],
      rems: [], frentes: [],
    },
  };
}

function instalarFalso(db) {
  window.__log = [];
  window.__fakeSb = {
    auth: {
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      getSession() { return Promise.resolve({ data: { session: { user: { id: "u-prueba" } } } }) },
      signOut() { return Promise.resolve({}) },
    },
    from(tabla) {
      const f = { kind: null };
      const filas = () => tabla === "boards" ? (db[f.kind] ? { data: db[f.kind] } : null) : [];
      const q = {
        select() { return q }, in() { return q }, gte() { return q }, order() { return q }, limit() { return q },
        eq(c, v) { if (c === "kind") f.kind = v; return q },
        maybeSingle() { return Promise.resolve({ data: filas(), error: null }) },
        then(ok, ko) { return Promise.resolve({ data: [], error: null }).then(ok, ko) },
        upsert(row) { window.__log.push(["upsert", row.kind, row.data]); return Promise.resolve({ error: null }) },
        insert() { window.__log.push(["insert", tabla]); return Promise.resolve({ error: null }) },
        update() { window.__log.push(["update", tabla]); return q },
        delete() { window.__log.push(["delete", tabla]); return q },
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

async function abrir(ahora, { app = false } = {}) {
  const ctx = await navegador.newContext({ timezoneId: ZONA });
  await ctx.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("https://esm.sh/@supabase/supabase-js")) {
      return route.fulfill({ contentType: "text/javascript", body: STUB_SUPABASE });
    }
    if (url.startsWith("https://fonts.googleapis.com/") || url.startsWith("https://fonts.gstatic.com/")) {
      return route.fulfill({ contentType: "text/css", body: "" });
    }
    if (url.startsWith(ORIGEN + "/")) {
      let ruta = new URL(url).pathname;
      if (ruta === "/vacia.html") return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8">' });
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
  await page.clock.setFixedTime(ahora);
  await page.addInitScript(instalarFalso, datosDePrueba());
  if (app) {
    await page.goto(ORIGEN + "/");
    await page.waitForSelector("#app:not(.hidden)");
  } else {
    await page.goto(ORIGEN + "/vacia.html");
  }
  return { page, ctx };
}

// Corre las funciones de util.js dentro de la página, con su reloj y su zona.
const util = (page, expr) => page.evaluate(async e => {
  const u = await import("/js/util.js");
  return new Function("u", "return " + e)(u);
}, expr);

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });

caso("El reloj de la prueba sí está a las 20:00 de Monterrey y ya es mañana en UTC", async () => {
  const { page, ctx } = await abrir(NOCHE);
  const r = await page.evaluate(() => ({ iso: new Date().toISOString(), hora: new Date().getHours() }));
  assert.equal(r.iso, "2026-10-20T02:00:00.000Z");
  assert.equal(r.hora, 20);
  await ctx.close();
});

caso("20:00: today() y addDays() dan el día local", async () => {
  const { page, ctx } = await abrir(NOCHE);
  assert.equal(await util(page, "u.today()"), "2026-10-19");
  assert.equal(await util(page, "u.addDays(0)"), "2026-10-19");
  assert.equal(await util(page, "u.addDays(7)"), "2026-10-26");
  assert.equal(await util(page, "u.addDays(-1)"), "2026-10-18");
  assert.equal(await util(page, "u.addDays(13)"), "2026-11-01");   // cruza de mes
  await ctx.close();
});

caso("20:00: diasDesde() cuenta días de calendario locales", async () => {
  const { page, ctx } = await abrir(NOCHE);
  assert.equal(await util(page, 'u.diasDesde("2026-10-19")'), 0);
  assert.equal(await util(page, 'u.diasDesde("2026-10-18")'), 1);
  assert.equal(await util(page, 'u.diasDesde("2026-10-05")'), 14);
  assert.equal(await util(page, 'u.diasDesde("2026-10-20")'), -1);
  assert.equal(await util(page, 'u.diasDesde("2025-10-19")'), 365);
  assert.equal(await util(page, 'u.diasDesde("")'), null);
  await ctx.close();
});

caso("20:00: dueClass() — lo de hoy no está vencido, lo de ayer sí", async () => {
  const { page, ctx } = await abrir(NOCHE);
  assert.equal(await util(page, 'u.dueClass("2026-10-19", "Por hacer")'), "soon");
  assert.equal(await util(page, 'u.dueClass("2026-10-18", "Por hacer")'), "overdue");
  assert.equal(await util(page, 'u.dueClass("2026-10-26", "Por hacer")'), "soon");
  assert.equal(await util(page, 'u.dueClass("2026-10-27", "Por hacer")'), "");
  assert.equal(await util(page, 'u.dueClass("2026-10-18", "Hecha")'), "");
  await ctx.close();
});

caso("Recién pasada la medianoche (00:30) también es el día local", async () => {
  const { page, ctx } = await abrir(new Date("2026-10-20T00:30:00-06:00"));
  assert.equal(await util(page, "u.today()"), "2026-10-20");
  assert.equal(await util(page, 'u.diasDesde("2026-10-19")'), 1);
  await ctx.close();
});

caso("App a las 20:00: Pendientes pinta bien el semáforo y la tarea nueva nace con fecha de hoy", async () => {
  const { page, ctx } = await abrir(NOCHE, { app: true });
  await page.locator(".tab", { hasText: "Pendientes" }).first().click();
  const fila = txt => page.locator("#tblTasks tbody tr", { has: page.locator(`input[value="${txt}"]`) });
  assert.match(await fila("Vence ayer").getAttribute("class"), /overdue/);
  assert.doesNotMatch(await fila("Vence hoy").getAttribute("class"), /overdue/);
  await page.locator("#addTask").click();
  const nueva = fila("Nueva tarea");
  assert.equal(await nueva.locator('input[type="date"]').inputValue(), "2026-10-19");
  // Y es lo que se mandaría a la base (al cliente falso), no solo lo que se pinta.
  await page.waitForFunction(() => window.__log.some(x => x[0] === "upsert"));
  const enviada = await page.evaluate(() => window.__log.filter(x => x[0] === "upsert").pop()[2].tasks.find(t => t.text === "Nueva tarea"));
  assert.equal(enviada.due, "2026-10-19");
  await ctx.close();
});

caso("App a las 20:00: «N días sin movimiento» cuenta desde el día local", async () => {
  const { page, ctx } = await abrir(NOCHE, { app: true });
  await page.locator(".tab", { hasText: "Pipeline" }).first().click();
  const tarjeta = t => page.locator(".card", { hasText: t });
  assert.match(await tarjeta("Tarjeta de 14 días").locator(".stale").textContent(), /^14 días sin movimiento$/);
  assert.equal(await tarjeta("Tarjeta de 13 días").locator(".stale").count(), 0);
  await ctx.close();
});

// --- Correr ----------------------------------------------------------------
navegador = await chromium.launch();
let fallas = 0;
for (const { nombre, fn } of casos) {
  try { await fn(); console.log("✓", nombre) }
  catch (e) { fallas++; console.log("✗", nombre, "\n   ", e.message.split("\n")[0]) }
}
await navegador.close();
if (fugas.length) { fallas++; console.log("✗ peticiones de red no permitidas:", [...new Set(fugas)].join(", ")) }
if (erroresJs.length) { fallas++; console.log("✗ errores de JavaScript en la página:", [...new Set(erroresJs)].join(" | ")) }
console.log(fallas ? `\n${fallas} falla(s)` : `\nTodo en orden: ${casos.length} casos.`);
process.exit(fallas ? 1 : 0);
