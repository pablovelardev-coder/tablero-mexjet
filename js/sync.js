// Lectura y escritura contra Supabase.
//
// ⚠️ El upsert reemplaza `data` completo: si un cliente escribe con el estado
// vacío, borra el tablero entero. Pasó el 1-ago-2026. Por eso `save()` solo se
// dispara desde una acción del usuario, nunca al arrancar.
import { sb } from "./config.js";
import { app, S, lastWrite, seed } from "./state.js";
import { $ } from "./util.js";

let saveTimer = null;

export function setSync(st) {
  const el = $("sync");
  if (st === "saving") el.textContent = "guardando…";
  else if (st === "ok") el.textContent = "✓ sincronizado " + new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  else if (st === "error") el.textContent = "⚠︎ error de conexión";
  else el.textContent = "·";
}

export async function loadBoard(kind) {
  const { data, error } = await sb.from("boards").select("data").eq("kind",kind).maybeSingle();
  if (error) { setSync("error"); return }
  if (data && data.data) { S[kind] = data.data }
  else { S[kind] = seed(kind); await upsert(kind) }
}

export async function upsert(kind) {
  lastWrite[kind] = Date.now();
  const { error } = await sb.from("boards").upsert(
    { user_id: app.user.id, kind, data: S[kind], updated_at: new Date().toISOString() },
    { onConflict: "user_id,kind" }
  );
  setSync(error ? "error" : "ok");
}

// Guardado con debounce de 400ms sobre el tablero visible.
export function save() {
  setSync("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => upsert(app.cur), 400);
}

// Sincronización entre pestañas y dispositivos. Ignora el eco de la escritura
// propia durante 1.5s para no repintar encima de lo que el usuario está haciendo.
let canal = null;

export function subscribeBoards(onRemoteChange) {
  if (canal) return canal;   // ya suscrito: no acumular canales
  canal = sb.channel("boards-rt")
    .on("postgres_changes", { event:"*", schema:"public", table:"boards" }, payload => {
      const row = payload.new;
      if (!row || !row.kind) return;
      if (Date.now() - lastWrite[row.kind] < 1500) return;
      S[row.kind] = row.data;
      if (row.kind === app.cur) onRemoteChange();
    })
    .subscribe();
  return canal;
}
