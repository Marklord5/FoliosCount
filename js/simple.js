const inicial = document.getElementById('inicial');
const final = document.getElementById('final');
const resultado = document.getElementById('resultado');
const borrarTodo = document.getElementById('borrarTodo');
const copiarFolios = document.getElementById('copiarFolios');

function aceptarSoloNumeros(event) {
  event.target.value = event.target.value.replace(/\D/g, '');
  calcular();
}

function borrar(...inputs) {
  inputs.forEach(input => input.value = '');
  inputs[0].focus();
  calcular();
}

function borrarConEscape(event) {
  if (event.key === 'Escape') borrar(event.target);
}

function calcular() {
  resultado.className = '';
  borrarTodo.disabled = inicial.value === '' && final.value === '';
  copiarFolios.disabled = true;

  if (inicial.value === '' || final.value === '') {
    resultado.textContent = 'Escribe ambos folios';
    return;
  }

  const a = Number(inicial.value);
  const b = Number(final.value);

  if (b < a) {
    resultado.className = 'error';
    resultado.textContent = 'El folio final debe ser mayor o igual al inicial';
    return;
  }

  const total = b - a + 1;
  resultado.innerHTML = `<strong>${total.toLocaleString('es-MX')}</strong> folios en total`;
  copiarFolios.disabled = false;
}

async function copiarRango() {
  await navigator.clipboard.writeText(`${inicial.value} ${final.value}`);
  copiarFolios.querySelector('span').textContent = 'Copiado';
  setTimeout(() => copiarFolios.querySelector('span').textContent = 'Copiar folios', 1500);
}

inicial.addEventListener('input', aceptarSoloNumeros);
final.addEventListener('input', aceptarSoloNumeros);
inicial.addEventListener('keydown', borrarConEscape);
final.addEventListener('keydown', borrarConEscape);
document.getElementById('borrarInicial').addEventListener('click', () => borrar(inicial));
document.getElementById('borrarFinal').addEventListener('click', () => borrar(final));
borrarTodo.addEventListener('click', () => borrar(inicial, final));
copiarFolios.addEventListener('click', copiarRango);
calcular();
