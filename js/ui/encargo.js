// "Encargar a Claude": deja un encargo sobre una tarjeta o un pendiente para que
// Claude lo trabaje en la siguiente sesión (Mac o iPhone).
//
// No hay chat ni API dentro de la app (decisión de Pablo, 26-oct-2026: opción
// A + C). El encargo es UNA fila nueva en `session_log`, con las etiquetas
// `accion-pendiente` y `encargo-app` — el mismo buzón que ya usan las sesiones
// para dejarse trabajo entre dispositivos. Solo INSERT: la app nunca edita ni
// borra la bitácora, y no toca `boards`.
import { sb } from "../config.js";
import { app } from "../state.js";
import { clip } from "../util.js";
import { setSync } from "../sync.js";

export const ETIQUETAS_ENCARGO = ["accion-pendiente", "encargo-app"];

export function textoEncargo({ kind, tipo, id, titulo }, pedido) {
  return `ENCARGO DESDE LA APP — tablero ${kind} · ${tipo} ${id} «${clip(titulo || "", 120)}»: ${pedido}`;
}

// Devuelve true si el encargo quedó guardado.
export async function encargar(ref) {
  const pedido = (prompt(`¿Qué le encargas a Claude sobre «${clip(ref.titulo || "", 60)}»?`, "") || "").trim();
  if (!pedido) return false;
  setSync("saving");
  const { error } = await sb.from("session_log").insert({
    user_id: app.user.id,
    device: "app",
    session_ref: "encargo",
    summary: textoEncargo(ref, pedido),
    tags: [...ETIQUETAS_ENCARGO, ref.kind],
  });
  if (error) {
    setSync("error");
    alert("No se pudo dejar el encargo. Intenta de nuevo.\n\n(" + (error.message || "error") + ")");
    return false;
  }
  setSync("ok");
  alert("Listo: Claude lo verá al abrir la siguiente sesión.");
  return true;
}
