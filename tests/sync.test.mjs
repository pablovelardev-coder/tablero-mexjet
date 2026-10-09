// Prueba de js/sync.js: recarga al volver a la pestaña y guardado rechazado.
//
// ⛔ NUNCA toca producción, y no depende de que uno se acuerde de eso:
//   - los archivos de la app se sirven desde disco (no hay servidor),
//   - la librería de Supabase (esm.sh) se reemplaza por un cliente falso,
//   - CUALQUIER otra petición de red se aborta y hace fallar la prueba.
//
// Cómo correrla (necesita Node y Playwright con Chromium):
//   NODE_PATH="$(npm root -g)" node tests/sync.test.mjs
//
// No es parte de la app ni de su despliegue: GitHub Pages no la sirve como
// código, y la app sigue sin build ni dependencias.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEN = "http://prueba.local";

// --- El cliente falso de Supabase, instalado en la página antes que la app ---
function instalarFalso() {
  window.__log = [];          // todo lo que la app le pide a la "base"
  window.__alerts = [];
  window.__db = {};           // lo que la "base" regresa al recargar, por tablero
  window.__resp = {
    upsert: () => ({ error: null }),
    select: kind => ({ data: window.__db[kind] ? { data: window.__db[kind] } : null, error: null }),
  };
  window.alert = msg => { window.__log.push(["alert"]); window.__alerts.push(String(msg)) };
  window.__sesion = null;     // sólo la prueba de arranque abre una sesión
  window.__fakeSb = {
    auth: {
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } } },
      getSession() { return Promise.resolve({ data: { session: window.__sesion } }) },
      signOut() { return Promise.resolve({}) },
    },
    from() {
      const q = {
        _kind: null,
        upsert(row) { window.__log.push(["upsert", row.kind]); return Promise.resolve(window.__resp.upsert(row)) },
        select() { return q },
        eq(_col, val) { q._kind = val; return q },
        maybeSingle() { window.__log.push(["select", q._kind]); return Promise.resolve(window.__resp.select(q._kind)) },
      };
      return q;
    },
    channel() {
      const ch = { on() { return ch }, subscribe(cb) { window.__rt = cb; return ch } };
      return ch;
    },
  };
}

const STUB_SUPABASE = "export function createClient() { return window.__fakeSb }";
const PAGINA = '<!doctype html><meta charset="utf-8"><div id="sync"></div>';

let navegador;
const fugas = [];
const erroresJs = [];
const TIPO = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript" };

async function nuevaPagina({ reloj = false, url = "/__prueba__", antes } = {}) {
  const ctx = await navegador.newContext();
  await ctx.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("https://esm.sh/@supabase/supabase-js")) {
      return route.fulfill({ contentType: "text/javascript", body: STUB_SUPABASE });
    }
    if (url.startsWith(ORIGEN + "/")) {
      const ruta = new URL(url).pathname;
      if (ruta === "/__prueba__") return route.fulfill({ contentType: "text/html", body: PAGINA });
      const archivo = normalize(join(RAIZ, ruta));
      if (!archivo.startsWith(RAIZ)) return route.abort();
      const tipo = TIPO[archivo.slice(archivo.lastIndexOf("."))] || "application/octet-stream";
      try { return route.fulfill({ contentType: tipo, body: readFileSync(archivo) }) }
      catch { return route.fulfill({ status: 404, body: "" }) }
    }
    fugas.push(url);           // nada más puede salir
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", e => erroresJs.push(e.message));
  if (reloj) await page.clock.install();
  await page.addInitScript(instalarFalso);
  if (antes) await page.addInitScript(antes);
  await page.goto(ORIGEN + url);
  if (url !== "/__prueba__") return { page, ctx };   // la app completa se arranca sola
  await page.evaluate(async () => {
    window.__sync = await import("/js/sync.js");
    window.__state = await import("/js/state.js");
    const bus = await import("/js/bus.js");
    window.__renders = 0;
    bus.on("datos-cambiaron", () => { window.__renders++; window.__log.push(["render"]) });
    window.__state.app.user = { id: "u-prueba" };
    window.__state.app.cur = "direccion";
    for (const k of ["ventas", "direccion", "personal"]) {
      window.__state.S[k] = { cards: [{ id: k + "-viejo" }], tasks: [], rems: [] };
    }
    // Ocultar / mostrar la pestaña a voluntad.
    let vis = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => vis, configurable: true });
    window.__ver = v => { vis = v; document.dispatchEvent(new Event("visibilitychange")) };
  });
  return { page, ctx };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const log = page => ev(page, () => window.__log);
const sync = page => ev(page, () => document.getElementById("sync").textContent);
const selects = l => l.filter(x => x[0] === "select").length;
const upserts = l => l.filter(x => x[0] === "upsert").length;
const fresco = k => ({ cards: [{ id: k + "-nuevo" }], tasks: [], rems: [] });

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });

// --- Guardado rechazado por la base -----------------------------------------
caso("Rechazo (23514): recarga ese tablero, repinta y LUEGO avisa; dice 'guardado rechazado'", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, f => {
    window.__db.direccion = f;
    window.__resp.upsert = () => ({ error: { code: "23514", message: 'Escritura rechazada en el tablero "direccion": perdería 5 elementos' } });
  }, fresco("direccion"));
  await ev(page, () => window.__sync.upsert("direccion"));
  const l = await log(page);
  assert.deepEqual(l.map(x => x[0]), ["upsert", "select", "render", "alert"]);
  assert.deepEqual(await ev(page, () => window.__state.S.direccion), fresco("direccion"));
  assert.equal(await sync(page), "⛔ guardado rechazado");
  const [msg] = await ev(page, () => window.__alerts);
  assert.match(msg, /No se guardó tu último cambio/);
  assert.match(msg, /perdería 5 elementos/);
  await ctx.close();
});

caso("Error de red: sigue diciendo 'error de conexión', no recarga, no avisa", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__resp.upsert = () => ({ error: { code: "PGRST000", message: "fetch failed" } }) });
  await ev(page, () => window.__sync.upsert("direccion"));
  assert.deepEqual((await log(page)).map(x => x[0]), ["upsert"]);
  assert.equal(await sync(page), "⚠︎ error de conexión");
  assert.deepEqual(await ev(page, () => window.__state.S.direccion.cards[0].id), "direccion-viejo");
  await ctx.close();
});

caso("Guardado normal: 'sincronizado'", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => window.__sync.upsert("direccion"));
  assert.match(await sync(page), /^✓ sincronizado/);
  await ctx.close();
});

// --- Al ocultar la pestaña ---------------------------------------------------
caso("Al ocultar con un cambio en el debounce: se manda YA, una sola vez", async () => {
  const { page, ctx } = await nuevaPagina({ reloj: true });
  await ev(page, () => { window.__sync.vigilarRegreso(); window.__sync.save(); window.__ver("hidden") });
  assert.equal(upserts(await log(page)), 1, "debió mandarse al ocultar, sin esperar los 400 ms");
  await page.clock.runFor(1000);
  assert.equal(upserts(await log(page)), 1, "el debounce no debe mandarlo otra vez");
  await ctx.close();
});

caso("vigilarRegreso dos veces no duplica: un solo guardado al ocultar", async () => {
  const { page, ctx } = await nuevaPagina({ reloj: true });
  await ev(page, () => { window.__sync.vigilarRegreso(); window.__sync.vigilarRegreso(); window.__sync.save(); window.__ver("hidden") });
  assert.equal(upserts(await log(page)), 1);
  await ctx.close();
});

// --- Al volver a la pestaña ---------------------------------------------------
caso("Vuelve tras 6 s: recarga los 3 tableros, repinta, 'sincronizado'", async () => {
  const { page, ctx } = await nuevaPagina({ reloj: true });
  await ev(page, f => { window.__db = f; window.__sync.vigilarRegreso(); window.__ver("hidden") },
    { ventas: fresco("ventas"), direccion: fresco("direccion"), personal: fresco("personal") });
  await page.clock.fastForward(6000);
  await ev(page, () => window.__ver("visible"));
  await page.clock.runFor(10);
  const l = await log(page);
  assert.equal(selects(l), 3);
  assert.deepEqual(await ev(page, () => window.__state.S.personal), fresco("personal"));
  assert.equal(await ev(page, () => window.__renders), 1);
  assert.match(await sync(page), /^✓ sincronizado/);
  await ctx.close();
});

caso("Vuelve tras 2 s: no recarga (Realtime cubre los saltos cortos)", async () => {
  const { page, ctx } = await nuevaPagina({ reloj: true });
  await ev(page, () => { window.__sync.vigilarRegreso(); window.__ver("hidden") });
  await page.clock.fastForward(2000);
  await ev(page, () => window.__ver("visible"));
  await page.clock.runFor(10);
  assert.equal(selects(await log(page)), 0);
  await ctx.close();
});

caso("Restaurada de la caché del navegador (pageshow persisted): recarga", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__sync.vigilarRegreso(); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })) });
  await page.waitForFunction(() => window.__log.filter(x => x[0] === "select").length === 3);
  await ctx.close();
});

caso("Regresa la red (online): recarga", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__sync.vigilarRegreso(); window.dispatchEvent(new Event("online")) });
  await page.waitForFunction(() => window.__log.filter(x => x[0] === "select").length === 3);
  await ctx.close();
});

// --- La recarga no puede empeorar las cosas -----------------------------------
caso("🔴 Recarga SIN fila: NO siembra un tablero vacío, conserva el que había", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__resp.select = () => ({ data: null, error: null }) });
  await ev(page, () => window.__sync.recargarTodo());
  for (const k of ["ventas", "direccion", "personal"]) {
    assert.equal(await ev(page, k => window.__state.S[k].cards[0].id, k), k + "-viejo");
  }
  assert.equal(await sync(page), "⚠︎ error de conexión");
  await ctx.close();
});

caso("Recarga con error de red: conserva lo que había", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__resp.select = () => ({ data: null, error: { message: "fetch failed" } }) });
  await ev(page, () => window.__sync.recargarTodo());
  assert.equal(await ev(page, () => window.__state.S.direccion.cards[0].id), "direccion-viejo");
  await ctx.close();
});

caso("Un cambio pendiente se manda ANTES de recargar", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__sync.save(); return window.__sync.recargarTodo() });
  const tipos = (await log(page)).map(x => x[0]);
  assert.equal(tipos[0], "upsert");
  assert.equal(tipos.filter(t => t === "select").length, 3);
  await ctx.close();
});

caso("La recarga ESPERA a que llegue una escritura en vuelo", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => {
    window.__resp.upsert = () => new Promise(r => setTimeout(() => { window.__log.push(["upsert-llego"]); r({ error: null }) }, 300));
  });
  await ev(page, () => { window.__sync.upsert("direccion"); return window.__sync.recargarTodo() });
  const tipos = (await log(page)).map(x => x[0]);
  const llego = tipos.indexOf("upsert-llego"), leyo = tipos.indexOf("select");
  // Las dos cosas: que el guardado SÍ haya llegado cuando terminó la recarga, y antes
  // de la primera lectura. (Un `indexOf` de -1 haría pasar la comparación sola.)
  assert.notEqual(llego, -1, "la recarga terminó sin esperar al guardado en vuelo: " + tipos);
  assert.ok(llego < leyo, "leyó la base antes de que llegara el guardado: " + tipos);
  await ctx.close();
});

caso("Dos recargas encimadas no duplican: 3 lecturas, no 6", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => Promise.all([window.__sync.recargarTodo(), window.__sync.recargarTodo()]));
  assert.equal(selects(await log(page)), 3);
  await ctx.close();
});

// --- Realtime -----------------------------------------------------------------
caso("Realtime: la primera conexión no recarga; si se cae y vuelve, sí", async () => {
  const { page, ctx } = await nuevaPagina();
  await ev(page, () => { window.__sync.subscribeBoards(() => {}); window.__rt("SUBSCRIBED") });
  assert.equal(selects(await log(page)), 0);
  await ev(page, () => { window.__rt("CHANNEL_ERROR"); window.__rt("SUBSCRIBED") });
  await page.waitForFunction(() => window.__log.filter(x => x[0] === "select").length === 3);
  await ctx.close();
});

// --- La app completa: index.html → main.js → login → start() ---------------------
caso("App completa: arranca, lee los 3 tableros y NO escribe nada al arrancar; luego vigila el regreso", async () => {
  const { page, ctx } = await nuevaPagina({
    url: "/index.html",
    reloj: true,
    antes: () => {
      const col = { ventas: "lead", direccion: "nuevo", personal: "ideas" };
      window.__sesion = { user: { id: "u-prueba", email: "prueba@ejemplo.com" } };
      for (const k of ["ventas", "direccion", "personal"]) {
        window.__db[k] = {
          cards: [{ id: k + "-1", title: "Tarjeta de prueba", col: col[k], labels: [], checklist: [] }],
          tasks: [{ id: k + "-t1", text: "Pendiente de prueba", status: "Por hacer", due: "2026-10-20" }],
          rems: [], frentes: [],
        };
      }
    },
  });
  // Con el reloj simulado, se avanza a mano hasta que la app termine de arrancar.
  for (let i = 0; i < 50 && !/^✓ sincronizado/.test(await sync(page)); i++) await page.clock.runFor(100);
  assert.match(await sync(page), /^✓ sincronizado/, "la app no terminó de arrancar");
  let l = await log(page);
  assert.equal(selects(l), 3, "debió leer los 3 tableros al arrancar");
  assert.equal(upserts(l), 0, "🔴 escribió al arrancar — es exactamente lo que borró los tableros el 1-ago y el 31-ago");
  // main.js sí conectó vigilarRegreso: ocultar 6 s y volver recarga.
  await ev(page, () => {
    let vis = "visible";
    Object.defineProperty(document, "visibilityState", { get: () => vis, configurable: true });
    window.__ver = v => { vis = v; document.dispatchEvent(new Event("visibilitychange")) };
    window.__ver("hidden");
  });
  await page.clock.fastForward(6000);
  await ev(page, () => window.__ver("visible"));
  await page.clock.runFor(50);
  l = await log(page);
  assert.equal(selects(l), 6, "al volver debió recargar los 3 tableros");
  assert.equal(upserts(l), 0, "volver a la pestaña sin cambios pendientes no debe escribir");
  await ctx.close();
});

// --- Corre ----------------------------------------------------------------------
navegador = await chromium.launch();
let fallas = 0;
for (const { nombre, fn } of casos) {
  try { await fn(); console.log("ok   ·", nombre) }
  catch (e) { fallas++; console.log("FALLA ·", nombre, "\n       ", e.message.split("\n")[0]) }
}
await navegador.close();
if (fugas.length) { fallas++; console.log("FALLA · hubo peticiones de red fuera de la prueba:", fugas) }
else console.log("ok   · ninguna petición salió a la red");
if (erroresJs.length) { fallas++; console.log("FALLA · errores de JavaScript en la página:", erroresJs) }
else console.log("ok   · ningún error de JavaScript en la página");
console.log(fallas ? `\n❌ ${fallas} falla(s)` : `\n✅ ${casos.length} casos, todos dan lo esperado.`);
process.exit(fallas ? 1 : 0);
