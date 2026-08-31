// Único punto que repinta todo. Importa a los cuatro renderizadores y a nadie
// más importa a él, salvo main.js: así el grafo de dependencias no tiene ciclos.
import { renderBoard } from "./ui/board.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderTasks } from "./ui/tasks.js";
import { renderRem } from "./ui/rems.js";
import { renderFrentes } from "./ui/frentes.js";
import { renderFeed } from "./ui/feed.js";
import { esSeccion } from "./config.js";
import { app } from "./state.js";

export function renderAll() {
  // Una sección transversal no tiene tablero que pintar: solo su feed.
  if (esSeccion(app.cur)) return renderFeed();
  renderDashboard();
  renderBoard();
  renderTasks();
  renderRem();
  renderFrentes();
}
