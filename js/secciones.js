const lista = document.getElementById('lista');
const resumen = document.getElementById('resumen');
const copiar = document.getElementById('copiar');

function agregarSeccion() {
  lista.append(document.getElementById('plantillaSeccion').content.cloneNode(true));
  lista.lastElementChild.querySelector('input').focus();
  resumir();
}

function reiniciarSecciones() {
  lista.replaceChildren();
  agregarSeccion();
}

function resumir() {
  let total = 0;
  let filas = '';

  [...lista.children].forEach((seccion, i) => {
    const [inicio, fin] = [...seccion.querySelectorAll('input')].map(input => input.value);
    const [a, b] = [inicio, fin].map(folio => folio.replace(/\D/g, ''));
    const salida = seccion.querySelector('output');
    const [letrasInicio, letrasFin] = [inicio, fin].map(folio => folio.replace(/[^A-Z]/g, ''));
    const completa = a !== '' && b !== '';
    let error = '';
    if (completa && Number(b) < Number(a)) error = 'Final menor al inicial';
    if (completa && letrasInicio !== letrasFin) error = 'Las letras no coinciden';

    seccion.classList.toggle('error', error !== '');
    salida.textContent = error;
    if (!completa || error) return;

    const folios = Number(b) - Number(a) + 1;
    total += folios;
    salida.textContent = `${folios.toLocaleString('es-MX')} folios`;
    filas += `<tr><td>${i + 1}</td><td>${inicio}</td><td>${fin}</td><td>${folios}</td></tr>`;
  });

  resumen.tBodies[0].innerHTML = filas;
  document.getElementById('total').textContent = total;
  copiar.disabled = filas === '';
}

function editarSeccion(event) {
  event.target.value = event.target.value.replace(/[^a-z0-9-]/gi, '').toUpperCase();
  resumir();
}

function navegarConTeclado(event) {
  if (!event.target.matches('input')) return;

  if (event.key === 'Escape') {
    event.target.value = '';
    resumir();
  }
  if (event.key === 'Enter') {
    const inputs = [...lista.querySelectorAll('input')];
    const siguiente = inputs[inputs.indexOf(event.target) + 1];
    siguiente ? siguiente.focus() : agregarSeccion();
  }
}

function quitarSeccion(event) {
  const quitar = event.target.closest('.quitar');
  if (!quitar) return;
  quitar.closest('.seccion').remove();
  resumir();
}

async function copiarResumen() {
  const tabla = [...resumen.rows].map(fila => [...fila.cells].map(celda => celda.textContent).join('\t')).join('\n');
  await navigator.clipboard.writeText(tabla);
  copiar.querySelector('span').textContent = 'Copiado';
  setTimeout(() => copiar.querySelector('span').textContent = 'Copiar para Excel', 1500);
}

lista.addEventListener('input', editarSeccion);
lista.addEventListener('keydown', navegarConTeclado);
lista.addEventListener('click', quitarSeccion);
document.getElementById('agregar').addEventListener('click', agregarSeccion);
document.getElementById('reiniciar').addEventListener('click', reiniciarSecciones);
copiar.addEventListener('click', copiarResumen);
agregarSeccion();
