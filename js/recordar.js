// Al refrescar se conserva el modo y lo escrito; se olvida al cerrar la pestaña.
// Las fotos de la INE y los PDF no se guardan: pesan mucho y la INE trae datos personales.
const CLAVE_ESTADO = 'estado';
const CAMPOS = ['inicial', 'final', 'solicitante', 'area', 'observaciones', 'foliosQr', 'colorQr'];

function guardarEstado() {
  sessionStorage.setItem(CLAVE_ESTADO, JSON.stringify({
    modo: document.querySelector('.modo:not([hidden])').id,
    campos: Object.fromEntries(CAMPOS.map(id => [id, document.getElementById(id).value])),
    secciones: [...lista.children].map(seccion => [...seccion.querySelectorAll('input')].map(input => input.value)),
    pegadoPorTipo,
    tipo: tipoElegido(),
    formato: formatos.querySelector(':checked').value,
  }));
}

function restaurarEstado() {
  const estado = JSON.parse(sessionStorage.getItem(CLAVE_ESTADO));
  if (!estado) return;

  CAMPOS.forEach(id => document.getElementById(id).value = estado.campos[id]);
  calcular();

  lista.replaceChildren();
  estado.secciones.forEach(valores => {
    lista.append(document.getElementById('plantillaSeccion').content.cloneNode(true));
    lista.lastElementChild.querySelectorAll('input').forEach((input, i) => input.value = valores[i]);
  });
  resumir();

  Object.assign(pegadoPorTipo, estado.pegadoPorTipo);
  tipo.querySelectorAll('button').forEach(boton => boton.setAttribute('aria-pressed', boton.textContent.toUpperCase() === estado.tipo));
  pegado.value = pegadoPorTipo[estado.tipo];
  leerPegado();

  formatos.querySelector(`[value="${estado.formato}"]`).checked = true;
  contarFolios();

  const modo = document.getElementById(estado.modo);
  document.querySelectorAll('.modo').forEach(seccion => seccion.hidden = seccion !== modo);
  modos.forEach(boton => boton.setAttribute('aria-pressed', boton.dataset.modo === modo.id));
  modo.querySelector('input, textarea').focus({ preventScroll: true });
}

try { restaurarEstado(); } catch {}
addEventListener('pagehide', () => { try { guardarEstado(); } catch {} });
