// Utilidades puras: sin estado propio y sin tocar Supabase.
import { TAGPAL } from "./config.js";

export const $ = id => document.getElementById(id);
export const uid = () => Math.random().toString(36).slice(2,9);
// Fechas AAAA-MM-DD en hora LOCAL. Con toISOString() el "hoy" era el de UTC,
// que después de las 18:00 de Monterrey ya es mañana: vencidas un día antes,
// atrasos y "hace N d" corridos en uno, y una tarea nueva nacía con fecha de mañana.
const ymd = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
export const today = () => ymd(new Date());
export const addDays = n => { const d = new Date(); d.setDate(d.getDate()+n); return ymd(d) };
export const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export const clip = (s,n) => s.length > n ? s.slice(0,n)+"…" : s;

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
export const fchCorta = d => { if(!d) return ""; const [,m,dd] = d.split("-"); return dd+" "+MESES[+m-1] };

// Días de calendario entre dos AAAA-MM-DD: cada fecha se vuelve la medianoche
// UTC de ese día, así la resta da días enteros sin que influya la hora ni el
// cambio de horario.
const diaUTC = s => { const [y,m,d] = String(s).slice(0,10).split("-").map(Number); return Date.UTC(y, m-1, d) };
export function diasDesde(d) { if(!d) return null; return Math.round((diaUTC(today()) - diaUTC(d)) / 864e5) }

// Semáforo por fecha: vencida (rojo) / próxima ≤7 días (ámbar) / sin urgencia
export function dueClass(due, status) {
  if (status === "Hecha" || !due) return "";
  const diff = (diaUTC(due) - diaUTC(today())) / 864e5;
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
