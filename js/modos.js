const modos = document.querySelectorAll('nav button');

const tarjeta = document.querySelector('main');
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)');
const curva = 'cubic-bezier(.22, 1, .36, 1)';
let redimension;
let turno = 0;

// Cada pieza del modo entra en cascada desde el lado del botón elegido
function entrar(seccion, direccion) {
  const piezas = seccion.querySelectorAll('.panel > *');
  [...piezas].forEach((pieza, i) => pieza.animate([
    { opacity: 0, translate: `${28 * direccion}px 6px`, filter: 'blur(6px)' },
    { opacity: 1, translate: '0 0', filter: 'blur(0)' }
  ], { duration: 420, delay: Math.min(i, 8) * 35, easing: curva, fill: 'backwards' }));
}

async function cambiarModo(event) {
  const boton = event.currentTarget;
  const nuevo = document.getElementById(boton.dataset.modo);
  const actual = document.querySelector('.modo:not([hidden])');
  const botones = [...modos];
  const direccion = botones.indexOf(boton) >= botones.findIndex(b => b.dataset.modo === actual.id) ? 1 : -1;
  const mio = ++turno;
  modos.forEach(b => b.setAttribute('aria-pressed', b === boton));

  // Volvió a elegir la opción que todavía estaba saliendo: se queda
  if (nuevo === actual) {
    const saliendo = actual.getAnimations();
    if (!saliendo.length) return;
    saliendo.forEach(a => a.cancel());
    if (!sinMovimiento.matches) entrar(actual, direccion);
    return;
  }

  // Lo actual sale hacia el lado contrario antes de cambiar
  if (!sinMovimiento.matches) {
    await actual.animate([
      { opacity: 1, translate: '0 0', filter: 'blur(0)' },
      { opacity: 0, translate: `${-20 * direccion}px 0`, filter: 'blur(4px)' }
    ], { duration: 160, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).finished.catch(() => {});
    if (mio !== turno) return;
  }

  const antes = tarjeta.getBoundingClientRect();
  redimension?.cancel();
  actual.hidden = true;
  actual.getAnimations().forEach(a => a.cancel());
  nuevo.hidden = false;
  nuevo.querySelector('input, textarea').focus({ preventScroll: true });
  if (sinMovimiento.matches) return;

  // La tarjeta pasa suave de su tamaño anterior al nuevo
  const despues = tarjeta.getBoundingClientRect();
  const tamano = r => ({ width: `${r.width}px`, height: `${r.height}px`, maxWidth: 'none', overflow: 'clip' });
  redimension = tarjeta.animate([tamano(antes), tamano(despues)], { duration: 480, easing: curva });
  entrar(nuevo, direccion);
}

// Píldora que se desliza al botón activo en cada selector
document.querySelectorAll('.modos').forEach(grupo => {
  const indicador = grupo.appendChild(document.createElement('span'));
  indicador.className = 'indicador';
  const mover = () => {
    const activo = grupo.querySelector('[aria-pressed="true"]');
    Object.assign(indicador.style, {
      translate: `${activo.offsetLeft}px ${activo.offsetTop}px`,
      width: `${activo.offsetWidth}px`,
      height: `${activo.offsetHeight}px`
    });
  };
  new ResizeObserver(() => {
    mover();
    requestAnimationFrame(() => grupo.classList.add('listo'));
  }).observe(grupo);
  grupo.addEventListener('click', event => {
    if (!event.target.closest('button')) return;
    mover();
    // Pequeño estirón de la píldora al moverse
    if (!sinMovimiento.matches) indicador.animate([{ scale: '1' }, { scale: '1.08 .9' }, { scale: '1' }], { duration: 450, easing: curva });
  });
});

modos.forEach(boton => boton.addEventListener('click', cambiarModo));
