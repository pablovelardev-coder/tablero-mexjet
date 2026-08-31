// Bus mínimo de eventos. Existe para romper los ciclos de importación:
// un módulo avisa que los datos cambiaron sin tener que importar al que repinta.
const oyentes = {};

export function on(evento, fn) {
  (oyentes[evento] ||= []).push(fn);
}

export function emit(evento, dato) {
  (oyentes[evento] || []).forEach(fn => fn(dato));
}
