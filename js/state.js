// Estado en memoria. Se exporta como objetos mutables (no como `let` sueltos)
// para que todos los módulos compartan la misma referencia viva.

export const app = { user: null, cur: "ventas", curtab: "pipeline" };

export const S = { ventas: null, direccion: null, personal: null };

// Marca de la última escritura propia por tablero, para ignorar el eco de Realtime.
export const lastWrite = { ventas: 0, direccion: 0, personal: 0 };

// Datos del tablero visible.
export const D = () => S[app.cur];

// Estado inicial de un tablero que todavía no existe en la base.
export function seed(kind) {
  if (kind === "ventas") return { cards: [], tasks: [], rems: [],
    frentes: [{name:"Renovaciones Equity",pct:0},{name:"Prospección",pct:0}] };
  if (kind === "direccion") return { cards: [], tasks: [], rems: [],
    frentes: [{name:"Proyectos",pct:0},{name:"Operación",pct:0}] };
  return { cards: [], tasks: [], rems: [], frentes: [] };
}
