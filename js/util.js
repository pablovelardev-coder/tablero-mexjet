// Utilidades puras: sin estado propio y sin tocar Supabase.
import { TAGPAL } from "./config.js";

export const $ = id => document.getElementById(id);
export const uid = () => Math.random().toString(36).slice(2,9);
export const today = () => new Date().toISOString().slice(0,10);
export const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10) };
export const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export const clip = (s,n) => s.length > n ? s.slice(0,n)+"…" : s;

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
export const fchCorta = d => { if(!d) return ""; const [,m,dd] = d.split("-"); return dd+" "+MESES[+m-1] };

export function diasDesde(d) { if(!d) return null; return Math.floor((new Date(today()) - new Date(d)) / 864e5) }

// Semáforo por fecha: vencida (rojo) / próxima ≤7 días (ámbar) / sin urgencia
export function dueClass(due, status) {
  if (status === "Hecha" || !due) return "";
  const diff = (new Date(due) - new Date(today())) / 864e5;
  return diff < 0 ? "overdue" : diff <= 7 ? "soon" : "";
}

// Color estable por etiqueta: la misma palabra siempre cae en el mismo color.
export function tagColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
  return TAGPAL[h % TAGPAL.length];
}

// Crece el textarea con el contenido hasta su max-height, y luego deja scroll.
export function autoGrow(el) {
  el.style.height = "auto";
  const max = parseInt(getComputedStyle(el).maxHeight) || 280;
  const h = el.scrollHeight + 2;
  el.style.height = Math.min(h,max) + "px";
  el.style.overflowY = (h > max) ? "auto" : "hidden";
  const hint = el.parentNode.querySelector(".grow-hint");
  if (hint) hint.classList.toggle("on", h > max);
}
