// Correo + contraseña. La primera vez, si el login falla, crea la cuenta.
import { sb } from "./config.js";
import { app } from "./state.js";
import { $ } from "./util.js";
import { emit } from "./bus.js";

function gmsg(t, cls) {
  $("gateMsg").textContent = t;
  $("gateMsg").className = "msg " + (cls || "");
}

async function doEnter() {
  const email = $("email").value.trim();
  const password = $("pass").value;
  if (!email || !password) return gmsg("Escribe correo y contraseña","err");
  if (password.length < 6) return gmsg("La contraseña debe tener al menos 6 caracteres","err");
  gmsg("Entrando…");
  $("btnSend").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const r = await sb.auth.signUp({ email, password });
    if (r.error) {
      $("btnSend").disabled = false;
      const m = r.error.message || "";
      const conocido = /already|disabled|not allowed|registered/i.test(m);
      return gmsg(conocido ? "Correo o contraseña incorrectos." : m, "err");
    }
    if (!r.data.session) {
      $("btnSend").disabled = false;
      return gmsg("Cuenta creada. Falta desactivar 'Confirm email' en Supabase para entrar directo.","err");
    }
  }
  $("btnSend").disabled = false;
}

// Usuario para el que ya se avisó "sesion-iniciada". Es el candado que evita
// arrancar la app más de una vez.
let sesionAbierta = null;

/* Abre la sesión UNA sola vez por usuario.
 *
 * Hace falta el candado porque hay dos fuentes que avisan de lo mismo:
 *   - getSession() al cargar la página
 *   - onAuthStateChange, que además de SIGNED_IN dispara INITIAL_SESSION y
 *     TOKEN_REFRESHED (este último cada ~50 min, mientras la pestaña siga abierta)
 *
 * Sin candado, cada refresco de token volvía a arrancar la app: recargaba los
 * tres tableros desde el servidor —pisando lo que estuviera esperando en el
 * debounce de 400ms— y abría otro canal de Realtime, que se iban acumulando.
 *
 * Se exporta para poder probarlo sin una sesión real. */
export function abrirSesion(session) {
  if (!session || !session.user) return false;
  if (sesionAbierta === session.user.id) return false;   // ya arrancamos para este usuario
  sesionAbierta = session.user.id;
  app.user = session.user;
  emit("sesion-iniciada");
  return true;
}

export function cerrarSesion() {
  sesionAbierta = null;
  app.user = null;
}

// Avisa por el bus en vez de llamar a start(): así auth no depende del render.
export function initAuth() {
  $("btnSend").onclick = doEnter;
  $("pass").addEventListener("keydown", e => { if (e.key === "Enter") doEnter() });
  $("btnOut").onclick = async () => { await sb.auth.signOut(); location.reload() };

  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === "SIGNED_OUT") return cerrarSesion();
    abrirSesion(session);
  });
  (async () => {
    const { data } = await sb.auth.getSession();
    abrirSesion(data.session);
  })();
}
