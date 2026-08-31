// Único punto que repinta todo. Importa a los cuatro renderizadores y a nadie
// más importa a él, salvo main.js: así el grafo de dependencias no tiene ciclos.
import { renderBoard } from "./ui/board.js";
import { renderTasks } from "./ui/tasks.js";
import { renderRem } from "./ui/rems.js";
import { renderFrentes } from "./ui/frentes.js";

export function renderAll() {
  renderBoard();
  renderTasks();
  renderRem();
  renderFrentes();
}
