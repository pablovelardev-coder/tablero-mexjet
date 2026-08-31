// Configuración y constantes del tablero.
// La clave es la anon key pública: por sí sola no da acceso, todo está protegido con RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = "https://hiofkvotqppahhzoaybr.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpb2Zrdm90cXBwYWhoem9heWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzk1NTUsImV4cCI6MjA5Njg1NTU1NX0.h_4rD9hKANbRkX7MqmcO5myQr5WNulIZXoQ4879Paic";

export const sb = createClient(SB_URL, SB_KEY);

// Columnas del pipeline por tablero: [id, rótulo, color]
export const COLS = {
  ventas: [["lead","Prospecto","var(--lead)"],["calif","Calificado","var(--calif)"],["prop","Propuesta enviada","var(--prop)"],["nego","Negociación","var(--nego)"],["win","Ganado","var(--win)"],["lost","Perdido","var(--lost)"],["archivo","Archivo","var(--muted)"]],
  direccion: [["nuevo","Nuevo","var(--lead)"],["proceso","En proceso","var(--calif)"],["espera","En espera","var(--prop)"],["hecho","Resuelto","var(--win)"]],
  personal: [["ideas","Ideas","var(--nego)"],["todo","Por hacer","var(--lead)"],["doing","En curso","var(--calif)"],["done","Hecho","var(--win)"]]
};

// Orden de las pestañas por tablero
export const TABS = {
  ventas: ["pipeline","pendientes","recordatorios","frentes"],
  direccion: ["hoy","pendientes","recordatorios","frentes","pipeline"],
  personal: ["pipeline","pendientes","recordatorios"]
};

export const STATUSES = ["Por hacer","En curso","Bloqueada","Hecha"];

export const TAB_LABELS = { hoy:"Hoy", pipeline:"Pipeline", pendientes:"Pendientes", recordatorios:"Recordatorios", frentes:"Frentes" };

export const TAGPAL = ["#0b5fff","#16a34a","#f97316","#8b5cf6","#dc2626","#0891b2","#b45309","#db2777","#4d7c0f","#475569"];
