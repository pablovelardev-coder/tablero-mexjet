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

// Avisa por el bus en vez de llamar a start(): así auth no depende del render.
export function initAuth() {
  $("btnSend").onclick = doEnter;
  $("pass").addEventListener("keydown", e => { if (e.key === "Enter") doEnter() });
  $("btnOut").onclick = async () => { await sb.auth.signOut(); location.reload() };

  sb.auth.onAuthStateChange((_e, session) => {
    if (session && session.user) { app.user = session.user; emit("sesion-iniciada") }
  });
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) { app.user = data.session.user; emit("sesion-iniciada") }
  })();
}
