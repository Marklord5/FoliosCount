const pdfsUnir = document.getElementById('pdfsUnir');
const listaUnir = document.getElementById('listaUnir');
const avisoUnir = document.getElementById('avisoUnir');
const unirPdf = document.getElementById('unirPdf');
let archivosUnir = [];

function avisarUnir(texto, error = false) {
  avisoUnir.textContent = texto;
  avisoUnir.className = error ? 'error' : '';
}

function mostrarPdfs() {
  listaUnir.replaceChildren(...archivosUnir.map(archivo => {
    const fila = document.getElementById('plantillaPdf').content.firstElementChild.cloneNode(true);
    fila.querySelector('span').textContent = archivo.name;
    return fila;
  }));
  unirPdf.disabled = archivosUnir.length < 2;
}

function agregarPdfs() {
  archivosUnir.push(...pdfsUnir.files);
  pdfsUnir.value = '';
  avisarUnir('');
  mostrarPdfs();
}

function ordenarPdfs(event) {
  const boton = event.target.closest('button');
  if (!boton) return;
  const i = [...listaUnir.children].indexOf(boton.closest('li'));
  const [archivo] = archivosUnir.splice(i, 1);
  if (boton.classList.contains('subir')) archivosUnir.splice(i - 1, 0, archivo);
  mostrarPdfs();
}

async function unirPdfs() {
  unirPdf.disabled = true;
  avisarUnir('Uniendo…');
  try {
    descargarArchivo(await juntarPdfs(archivosUnir), 'PDF unido.pdf');
    avisarUnir('');
  } catch (error) {
    avisarUnir(error.message, true);
  }
  unirPdf.disabled = archivosUnir.length < 2;
}

function limpiarUnir() {
  archivosUnir = [];
  avisarUnir('');
  mostrarPdfs();
}

pdfsUnir.addEventListener('change', agregarPdfs);
listaUnir.addEventListener('click', ordenarPdfs);
unirPdf.addEventListener('click', unirPdfs);
document.getElementById('limpiarUnir').addEventListener('click', limpiarUnir);
