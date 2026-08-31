// Punto de entrada: engancha los módulos y arranca cuando hay sesión.
import { app } from "./state.js";
import { loadBoard, subscribeBoards, setSync } from "./sync.js";
import { buildTabs, initBoardSwitch, onTemaChange } from "./nav.js";
import { esSeccion } from "./config.js";
import { cargarFeed, renderFeed } from "./ui/feed.js";
import { renderAll } from "./render.js";
import { initAuth } from "./auth.js";
import { initCardDialog } from "./ui/card-dialog.js";
import { initTasks } from "./ui/tasks.js";
import { initRems } from "./ui/rems.js";
import { $ } from "./util.js";
import { on } from "./bus.js";

async function start() {
  $("gate").classList.add("hidden");
  $("app").classList.remove("hidden");
  await Promise.all([loadBoard("ventas"), loadBoard("direccion"), loadBoard("personal")]);
  subscribeBoards(renderAll);
  buildTabs();
  renderAll();
  setSync("ok");
}

initAuth();
initCardDialog();
initTasks();
initRems();
initBoardSwitch(() => {
  buildTabs();
  if (esSeccion(app.cur)) cargarFeed(app.cur);   // lee `feed`, no `boards`
  else renderAll();
});
onTemaChange(renderFeed);

on("sesion-iniciada", start);
on("datos-cambiaron", renderAll);
