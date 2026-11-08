const OPENCV = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const HEIC = 'https://cdn.jsdelivr.net/npm/heic-to@1.6.5/dist/heic-to.js'; // libheif reciente: heic2any no abre las fotos de iPhone nuevos
const ISNET = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm'; // el mismo modelo que rembg "isnet-general-use", en el navegador
const OPCIONES_ISNET = { model: 'isnet_quint8', output: { format: 'image/png' } };
const ANCHO = 1284; // 85.6 × 54 mm, proporción de la INE
const ALTO = 810;
const HOJA_ANCHO = 1700; // carta a 200 dpi
const HOJA_ALTO = 2200;
const MAX_PIXELES = 16e6; // límite de canvas en iPhone
const MRZ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';
const ENTERA = [[0, 0], [1, 0], [1, 1], [0, 1]]; // esquinas de la imagen completa
let herramientas = null;
let lector = null;
let segmentar = null; // foto (blob) → máscara (blob)

function cargarScript(src) {
  return new Promise((listo, falla) => document.head.append(Object.assign(document.createElement('script'), { src, onload: listo, onerror: falla })));
}

// IS-Net tarda varios segundos por foto: corre en un worker para que la página siga respondiendo.
// Si no se puede (página abierta como archivo, file://), corre en la página como antes.
async function cargarSilueta() {
  try {
    const trabajador = new Worker('js/silueta.js', { type: 'module' });
    const respuesta = () => new Promise((listo, falla) => {
      trabajador.onmessage = ({ data }) => data.error ? falla(new Error(data.error)) : listo(data.mascara);
      trabajador.onerror = falla;
    });
    const preparado = respuesta();
    trabajador.postMessage({ url: ISNET, opciones: OPCIONES_ISNET });
    await preparado;
    segmentar = foto => {
      const mascara = respuesta();
      trabajador.postMessage(foto);
      return mascara;
    };
  } catch {
    const { preload, segmentForeground } = await import(ISNET);
    await preload(OPCIONES_ISNET);
    segmentar = foto => segmentForeground(foto, OPCIONES_ISNET);
  }
}

function prepararIne() {
  herramientas ??= Promise.all([
    cargarSilueta(),
    cargarScript(OPENCV).then(async () => {
      if (window.cv instanceof Promise) window.cv = await window.cv;
      if (!cv.Mat) await new Promise(listo => cv.onRuntimeInitialized = listo);
    }),
    cargarScript(TESSERACT).then(async () => lector = await Tesseract.createWorker('spa')),
  ]).catch(() => {
    herramientas = null;
    throw new Error('No se pudieron descargar las herramientas de recorte y lectura. Revisa tu conexión a internet.');
  });
  return herramientas;
}

// Devuelve el control a la página entre pasos pesados para que no se trabe
function pausa() {
  return new Promise(listo => setTimeout(listo));
}

function nuevoLienzo(ancho, alto) {
  return Object.assign(document.createElement('canvas'), { width: Math.round(ancho), height: Math.round(alto) });
}

function recortar(fuente, ancho, alto, x = 0, y = 0, w = fuente.width, h = fuente.height) {
  const lienzo = nuevoLienzo(ancho, alto);
  lienzo.getContext('2d').drawImage(fuente, x, y, w, h, 0, 0, lienzo.width, lienzo.height);
  return lienzo;
}

function escalar(fuente, lado) {
  const escala = Math.min(1, lado / Math.max(fuente.width, fuente.height));
  return recortar(fuente, fuente.width * escala, fuente.height * escala);
}

// En cuartos de vuelta a la derecha; por defecto, de cabeza
function girar(fuente, cuartos = 2) {
  const acostada = cuartos % 2;
  const lienzo = nuevoLienzo(acostada ? fuente.height : fuente.width, acostada ? fuente.width : fuente.height);
  const pincel = lienzo.getContext('2d');
  pincel.translate(lienzo.width / 2, lienzo.height / 2);
  pincel.rotate(cuartos * Math.PI / 2);
  pincel.drawImage(fuente, -fuente.width / 2, -fuente.height / 2);
  return lienzo;
}

async function abrirImagen(archivo) {
  let mapa;
  try {
    mapa = await createImageBitmap(archivo);
  } catch {
    try {
      const { heicTo } = await import(HEIC);
      mapa = await heicTo({ blob: archivo, type: 'bitmap' });
    } catch {
      throw new Error('Solo se aceptan imágenes JPG, PNG o HEIC');
    }
  }
  const escala = Math.min(1, Math.sqrt(MAX_PIXELES / (mapa.width * mapa.height)));
  return recortar(mapa, mapa.width * escala, mapa.height * escala);
}

// La tarjeta se separa del fondo con el modelo de recorte
async function siluetaTarjeta(chica) {
  const blob = await new Promise(listo => chica.toBlob(listo, 'image/jpeg', .92));
  const mascara = cv.imread(recortar(await createImageBitmap(await segmentar(blob)), chica.width, chica.height));
  cv.cvtColor(mascara, mascara, cv.COLOR_RGBA2GRAY);
  cv.threshold(mascara, mascara, 127, 255, cv.THRESH_BINARY);
  return mascara;
}

// Qué tan "hoja" es cada píxel: claro y sin color (brillo − 2 × saturación); así la mesa, aunque sea clara, queda fuera
function claridad(chica) {
  const imagen = cv.imread(chica);
  const canales = new cv.MatVector();
  cv.cvtColor(imagen, imagen, cv.COLOR_RGBA2RGB);
  cv.cvtColor(imagen, imagen, cv.COLOR_RGB2HSV);
  cv.split(imagen, canales);
  const [saturacion, brillo] = [canales.get(1), canales.get(2)];
  cv.addWeighted(brillo, 1, saturacion, -2, 0, brillo);
  [imagen, canales, saturacion].forEach(valor => valor.delete());
  return brillo;
}

// estricta: un segundo corte solo entre lo claro, por si un reflejo de luz en la mesa se pega a la hoja
function siluetaHoja(claro, estricta = false) {
  const mascara = new cv.Mat();
  const nucleo = cv.Mat.ones(25, 25, cv.CV_8U);
  const corte = cv.threshold(claro, mascara, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  if (estricta) {
    const claros = claro.data.filter(valor => valor > corte);
    const fila = cv.matFromArray(1, claros.length, cv.CV_8U, claros);
    const motas = cv.Mat.ones(9, 9, cv.CV_8U);
    cv.threshold(claro, mascara, cv.threshold(fila, fila, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU), 255, cv.THRESH_BINARY);
    cv.morphologyEx(mascara, mascara, cv.MORPH_OPEN, motas); // el reflejo queda moteado: se borra
    [fila, motas].forEach(valor => valor.delete());
  }
  cv.morphologyEx(mascara, mascara, cv.MORPH_CLOSE, nucleo); // tapa el texto
  nucleo.delete();
  return mascara;
}

// Qué tan marcada es la orilla a lo largo de los 4 lados: claridad justo adentro menos justo afuera.
// En la orilla real de la hoja hay un salto; si el lado cruza una sombra o un reflejo, casi no.
function contraste(claro, puntos) {
  const { cols: w, rows: h, data } = claro;
  const [cx, cy] = [0, 1].map(eje => puntos.reduce((suma, punto) => suma + punto[eje], 0) / 4);
  const valor = (x, y) => x >= 0 && y >= 0 && x < w && y < h ? data[Math.round(y) * w + Math.round(x)] : null;
  let suma = 0;
  let cuenta = 0;
  puntos.forEach(([x0, y0], i) => {
    const [x1, y1] = puntos[(i + 1) % 4];
    const largo = Math.hypot(x1 - x0, y1 - y0) || 1;
    let [nx, ny] = [(y0 - y1) / largo, (x1 - x0) / largo];
    if (nx * (cx - x0) + ny * (cy - y0) < 0) [nx, ny] = [-nx, -ny]; // hacia adentro
    for (let t = .1; t < .95; t += .05) {
      const [px, py] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      const [adentro, afuera] = [valor(px + nx * 8, py + ny * 8), valor(px - nx * 8, py - ny * 8)];
      if (adentro === null || afuera === null) continue; // lado pegado a la orilla de la foto
      suma += adentro - afuera;
      cuenta++;
    }
  });
  return cuenta ? suma / cuenta : 0;
}

// El contorno más grande de la máscara reducido a 4 esquinas, en px
function cuadrilatero(mascara) {
  const { cols: w, rows: h } = mascara;
  const basura = [];
  const mat = valor => (basura.push(valor), valor);
  const contornos = mat(new cv.MatVector());
  cv.morphologyEx(mascara, mascara, cv.MORPH_OPEN, mat(cv.Mat.ones(7, 7, cv.CV_8U)));
  cv.findContours(mascara, contornos, mat(new cv.Mat()), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let contorno = null;
  for (let i = 0; i < contornos.size(); i++) {
    const opcion = mat(contornos.get(i));
    if (!contorno || cv.contourArea(opcion) > cv.contourArea(contorno)) contorno = opcion;
  }
  const area = contorno ? cv.contourArea(contorno) / (w * h) : 0;
  let puntos = null;

  if (area > .1 && area < .9) {
    const casco = mat(new cv.Mat());
    const aproximado = mat(new cv.Mat());
    cv.convexHull(contorno, casco, false, true);
    const perimetro = cv.arcLength(casco, true);
    for (let epsilon = .01; epsilon <= .08 && !puntos; epsilon += .01) {
      cv.approxPolyDP(casco, aproximado, epsilon * perimetro, true);
      if (aproximado.rows === 4) puntos = [0, 1, 2, 3].map(i => [aproximado.data32S[i * 2], aproximado.data32S[i * 2 + 1]]);
    }
    puntos ??= cv.RotatedRect.points(cv.minAreaRect(casco)).map(({ x, y }) => [x, y]);
  }
  basura.forEach(valor => valor.delete());
  return puntos;
}

// Esquinas de la tarjeta (o la hoja) en fracciones del ancho y alto de la imagen.
// Se detecta sobre la foto reducida a 1000 px; el recorte final se hace sobre la original.
async function detectar(imagen, esTarjeta = true) {
  const proporcion = Math.max(imagen.width, imagen.height) / Math.min(imagen.width, imagen.height);
  if (esTarjeta && proporcion > 1.53 && proporcion < 1.64) return ENTERA; // ya es un escaneo o recorte de la tarjeta
  const chica = escalar(imagen, 1000);
  let puntos;
  if (esTarjeta) {
    const mascara = await siluetaTarjeta(chica);
    puntos = cuadrilatero(mascara);
    mascara.delete();
  } else {
    // Hoja: dos cortes (normal y estricto) y gana el que tiene las orillas más marcadas
    const claro = claridad(chica);
    let mejor = -Infinity;
    for (const estricta of [false, true]) {
      const mascara = siluetaHoja(claro, estricta);
      const opcion = cuadrilatero(mascara);
      const nota = opcion ? contraste(claro, opcion) : -Infinity;
      if (nota > mejor) [puntos, mejor] = [opcion, nota];
      mascara.delete();
    }
    claro.delete();
  }
  // null: sin un contorno claro, o un escaneo donde el documento ocupa casi toda la imagen
  return puntos?.map(([x, y]) => [x / chica.width, y / chica.height]) ?? null;
}

// Sup-izq, sup-der, inf-der, inf-izq
function ordenar(puntos) {
  const [cx, cy] = [0, 1].map(eje => puntos.reduce((suma, punto) => suma + punto[eje], 0) / 4);
  const angulo = ([x, y]) => Math.atan2(y - cy, x - cx);
  const ordenados = [...puntos].sort((a, b) => angulo(a) - angulo(b));
  const sumas = ordenados.map(([x, y]) => x + y);
  const inicio = sumas.indexOf(Math.min(...sumas));
  return [...ordenados.slice(inicio), ...ordenados.slice(0, inicio)];
}

function enderezar(imagen, esquinas, ancho = ANCHO, alto = ALTO) {
  let puntos = ordenar(esquinas.map(([x, y]) => [x * imagen.width, y * imagen.height]));
  const lado = (a, b) => Math.hypot(puntos[a][0] - puntos[b][0], puntos[a][1] - puntos[b][1]);
  if ((lado(1, 2) + lado(3, 0) > lado(0, 1) + lado(2, 3)) !== (alto > ancho)) puntos = [...puntos.slice(1), puntos[0]]; // la tarjeta queda horizontal y la hoja vertical

  const foto = cv.imread(imagen);
  const resultado = new cv.Mat();
  const desde = cv.matFromArray(4, 1, cv.CV_32FC2, puntos.flat());
  const hacia = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, ancho, 0, ancho, alto, 0, alto]);
  const matriz = cv.getPerspectiveTransform(desde, hacia);
  cv.warpPerspective(foto, resultado, matriz, new cv.Size(ancho, alto), cv.INTER_LINEAR);
  const tarjeta = nuevoLienzo(ancho, alto);
  cv.imshow(tarjeta, resultado);
  [foto, resultado, desde, hacia, matriz].forEach(valor => valor.delete());
  return tarjeta;
}

// La INE tiene esquinas curvas (3.18 mm); lo que queda fuera de ellas es fondo de la foto y se pinta de blanco
function redondear(tarjeta) {
  const lienzo = nuevoLienzo(tarjeta.width, tarjeta.height);
  const pincel = lienzo.getContext('2d');
  pincel.fillStyle = '#fff';
  pincel.fillRect(0, 0, lienzo.width, lienzo.height);
  pincel.beginPath();
  pincel.roundRect(0, 0, lienzo.width, lienzo.height, tarjeta.width * 3.18 / 85.6);
  pincel.clip();
  pincel.drawImage(tarjeta, 0, 0);
  return lienzo;
}

// Aspecto de escáner: en grises, sin sombras y con el papel blanco.
// El fondo se estima borrando el texto (dilatar + mediana) y la foto se divide entre él.
function escanear(hoja) {
  const imagen = cv.imread(hoja);
  const fondo = new cv.Mat();
  const nucleo = cv.Mat.ones(15, 15, cv.CV_8U);
  cv.cvtColor(imagen, imagen, cv.COLOR_RGBA2GRAY);
  cv.dilate(imagen, fondo, nucleo);
  cv.medianBlur(fondo, fondo, 31);
  cv.divide(imagen, fondo, imagen, 255);
  cv.threshold(imagen, imagen, 230, 255, cv.THRESH_TRUNC); // lo casi blanco pasa a blanco al estirar
  cv.normalize(imagen, imagen, 0, 255, cv.NORM_MINMAX);
  const escaneo = nuevoLienzo(hoja.width, hoja.height);
  cv.imshow(escaneo, imagen);
  [imagen, fondo, nucleo].forEach(valor => valor.delete());
  return escaneo;
}

async function ocr(lienzo, permitidos = '') {
  await lector.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: permitidos });
  return (await lector.recognize(lienzo)).data;
}

// Líneas tipo pasaporte (MRZ) de la parte baja del reverso; vacío si no las hay
async function leerMrz(tarjeta) {
  const { text } = await ocr(recortar(tarjeta, ANCHO, ALTO * .4, 0, ALTO * .6, ANCHO, ALTO * .4), MRZ);
  const lineas = text.split('\n').map(linea => linea.replaceAll(' ', '')).filter(linea => linea.includes('<'));
  return lineas.join('').split('<').length > 10 ? lineas : [];
}

// Bloque NOMBRE del frente, a la derecha de la foto
function zonaNombre(tarjeta) {
  return recortar(tarjeta, ANCHO * .52, ALTO * .4, ANCHO * .28, ALTO * .2, ANCHO * .52, ALTO * .4);
}

// Las etiquetas del frente solo se leen con la tarjeta al derecho; la confianza desempata
function puntaje({ text, confidence }) {
  return ['NOMBRE', 'DOMICILIO'].filter(etiqueta => normalizar(text).includes(etiqueta)).length * 100 + confidence;
}

// Pone la tarjeta al derecho. El reverso se reconoce por la MRZ; el frente, por qué lado se lee mejor.
async function orientar(tarjeta) {
  const girada = girar(tarjeta);
  for (const opcion of [tarjeta, girada]) {
    const mrz = await leerMrz(opcion);
    if (mrz.length) return { tarjeta: opcion, mrz, texto: '' };
  }
  const derecho = await ocr(zonaNombre(tarjeta));
  const deCabeza = await ocr(zonaNombre(girada));
  return puntaje(derecho) >= puntaje(deCabeza)
    ? { tarjeta, mrz: [], texto: derecho.text }
    : { tarjeta: girada, mrz: [], texto: deCabeza.text };
}

function normalizar(texto) {
  return texto.toUpperCase().replace(/[ÁÉÍÓÚÜ]/g, letra => 'AEIOUU'['ÁÉÍÓÚÜ'.indexOf(letra)]);
}

function limpiar(texto) {
  return normalizar(texto).replace(/SEXO.*/g, '').replace(/[^A-ZÑ]/g, ' ').split(' ').filter(palabra => palabra.length > 1).join(' ');
}

// APELLIDO1<APELLIDO2<<NOMBRE1<NOMBRE2 → APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2
function nombreMrz(mrz) {
  for (const linea of [...mrz].reverse()) {
    const partes = linea.match(/^([A-Z]+(?:<[A-Z]+)*)<<([A-Z]+(?:<[A-Z]+)*)/);
    if (partes) return `${partes[1]} ${partes[2]}`.replaceAll('<', ' ');
  }
  return '';
}

// Las 3 líneas bajo NOMBRE: apellido paterno, materno y nombres
function nombreFrente(texto) {
  const lineas = texto.split('\n').map(limpiar);
  const inicio = lineas.findIndex(linea => linea.includes('NOMBRE'));
  if (inicio < 0) return '';
  const nombre = [];
  for (const linea of lineas.slice(inicio + 1)) {
    if (linea.includes('DOMICILIO') || nombre.length === 3) break;
    if (linea) nombre.push(linea);
  }
  return nombre.join(' ');
}

// La MRZ escribe la Ñ como N; se recupera de las palabras con Ñ del frente
function conEnie(nombre, textoFrente) {
  const enies = Object.fromEntries(limpiar(textoFrente).split(' ').filter(palabra => palabra.includes('Ñ')).map(palabra => [palabra.replaceAll('Ñ', 'N'), palabra]));
  return nombre.split(' ').filter(Boolean).map(palabra => enies[palabra] ?? palabra).join(' ');
}

const INE_MAX_BYTES = 15 * 1024 * 1024;
const archivosIne = { frente: document.getElementById('ineFrente'), reverso: document.getElementById('ineReverso') };
const nombreIne = document.getElementById('nombreIne');
const avisoIne = document.getElementById('avisoIne');
const generarPdf = document.getElementById('generarPdf');
const opcionesAnexo = document.querySelectorAll('.opcion');
const editor = document.getElementById('editor');
const lienzo = editor.querySelector('.lienzo');
let ladosIne = { frente: {}, reverso: {} };
let colaIne = Promise.resolve();
let anexos = { acuse: {}, carta: {} }; // { archivo, foto } y, si es foto, { imagen, esquinas, cuartos, plano, escaneo }
let nombreEditado = false;
let alAplicar = null; // recibe las esquinas del editor
let esquinasEditor = [];
let arrastre = null;

function avisarIne(texto, error = false) {
  avisoIne.textContent = texto;
  avisoIne.className = error ? 'error' : '';
}

function cajaAnexo(clave) {
  return document.querySelector(`.anexo[data-anexo="${clave}"]`);
}

// Acuse y carta, en el orden en que van en el PDF
function anexosElegidos() {
  return [...opcionesAnexo].filter(boton => boton.getAttribute('aria-pressed') === 'true').map(boton => boton.dataset.anexo);
}

function estadoLado({ archivo, tarjeta }) {
  return tarjeta ? 'listo' : archivo ? 'procesando' : '';
}

function estadoAnexo({ archivo, foto, escaneo }) {
  return foto && !escaneo ? 'procesando' : archivo ? 'listo' : '';
}

function actualizarResumen() {
  const elegidos = anexosElegidos();
  const lados = Object.values(ladosIne).map(estadoLado);
  const partes = {
    ine: lados.every(estado => estado === 'listo') ? 'listo' : lados.includes('procesando') ? 'procesando' : '',
    acuse: estadoAnexo(anexos.acuse),
    carta: estadoAnexo(anexos.carta),
  };
  for (const [clave, estado] of Object.entries(partes)) {
    const fila = document.querySelector(`[data-parte="${clave}"]`);
    const etiqueta = fila.querySelector('.estado');
    fila.hidden = clave !== 'ine' && !elegidos.includes(clave);
    if (clave !== 'ine') cajaAnexo(clave).hidden = fila.hidden;
    etiqueta.className = `estado ${estado}`;
    etiqueta.textContent = { listo: 'Listo', procesando: 'Procesando…', '': 'Falta' }[estado];
  }
  generarPdf.disabled = ['ine', ...elegidos].some(clave => partes[clave] !== 'listo');
}

function elegirAnexo(event) {
  const boton = event.currentTarget;
  boton.setAttribute('aria-pressed', boton.getAttribute('aria-pressed') !== 'true');
  actualizarResumen();
}

function mostrarAnexo(clave) {
  const { archivo, foto, escaneo } = anexos[clave];
  const caja = cajaAnexo(clave);
  const recorte = caja.querySelector('.recorte');
  const pdf = caja.querySelector('.pdf');
  caja.classList.toggle('cargando', Boolean(foto && !escaneo));
  caja.querySelector('.vacio').hidden = Boolean(archivo);
  caja.querySelector('.herramientas').hidden = !escaneo;
  pdf.hidden = !archivo || foto;
  pdf.querySelector('span').textContent = archivo?.name ?? '';
  recorte.hidden = !escaneo;
  if (escaneo) recorte.src = escaneo.toDataURL('image/jpeg', .8);
  else recorte.removeAttribute('src');
}

function procesarAnexo(clave, estado) {
  colaIne = colaIne.then(async () => {
    if (anexos[clave] !== estado) return;
    let error = '';
    let aviso = '';
    try {
      await prepararIne();
      estado.imagen ??= await abrirImagen(estado.archivo);
      if (!estado.esquinas) {
        estado.esquinas = await detectar(estado.imagen, false) ?? ENTERA;
        if (estado.esquinas === ENTERA) aviso = 'No encontré bien la orilla de la hoja: revisa el recorte con «Ajustar esquinas»';
      }
      await pausa();
      const hoja = enderezar(estado.imagen, estado.esquinas, HOJA_ANCHO, HOJA_ALTO);
      await pausa();
      estado.plano = escanear(hoja);
      estado.escaneo = girar(estado.plano, estado.cuartos);
    } catch (falla) {
      error = falla.message;
    }
    if (anexos[clave] !== estado) return;
    if (error) {
      anexos[clave] = {};
      cajaAnexo(clave).querySelector('input').value = '';
      avisarIne(error, true);
    } else if (aviso) avisarIne(aviso);
    mostrarAnexo(clave);
    actualizarResumen();
  });
}

// Un PDF se anexa tal cual; una foto se recorta y se deja como escaneo
async function cambiarAnexo(event) {
  const clave = event.target.closest('.anexo').dataset.anexo;
  let archivo = event.target.files[0];
  let error = '';
  if (/\.xlsx$/i.test(archivo?.name)) {
    try {
      archivo = await excelAPdf(archivo); // queda como cualquier PDF subido
    } catch {
      archivo = null;
      error = 'No se pudo convertir el Excel a PDF';
    }
  }
  const foto = Boolean(archivo) && !/pdf$/i.test(archivo.type || archivo.name);
  const pesada = foto && archivo.size > INE_MAX_BYTES;
  const estado = anexos[clave] = archivo && !pesada ? { archivo, foto, cuartos: 0 } : {};
  avisarIne(error || (pesada ? 'La imagen pesa más de 15 MB' : ''), true);
  if (!estado.archivo) event.target.value = '';
  mostrarAnexo(clave);
  if (foto && !pesada) procesarAnexo(clave, estado);
  actualizarResumen();
}

function mostrarLado(lado, estado) {
  const caja = document.querySelector(`[data-lado="${lado}"]`);
  const recorte = caja.querySelector('.recorte');
  recorte.hidden = !estado?.tarjeta;
  caja.querySelector('.herramientas').hidden = !estado?.tarjeta;
  if (estado?.tarjeta) recorte.src = estado.tarjeta.toDataURL('image/jpeg', .9);
  else recorte.removeAttribute('src');
}

function marcarCargando(lado, activo) {
  document.querySelector(`[data-lado="${lado}"]`).classList.toggle('cargando', activo);
}

// De uno en uno: hay un solo lector de Tesseract y sus parámetros cambian entre lecturas
function procesarLado(lado, estado) {
  marcarCargando(lado, true);
  colaIne = colaIne.then(async () => {
    if (ladosIne[lado] !== estado) return;
    let error = '';
    try {
      await prepararIne();
      estado.imagen ??= await abrirImagen(estado.archivo);
      estado.esquinas ??= await detectar(estado.imagen) ?? ENTERA;
      await pausa();
      Object.assign(estado, await orientar(redondear(enderezar(estado.imagen, estado.esquinas))));
    } catch (falla) {
      error = falla.message;
    }
    if (ladosIne[lado] !== estado) return;
    if (error) {
      ladosIne[lado] = {};
      archivosIne[lado].value = '';
      avisarIne(error, true);
    }
    marcarCargando(lado, false);
    mostrarLado(lado, ladosIne[lado]);
    revisarIne();
  });
}

function revisarIne() {
  const { frente, reverso } = ladosIne;
  if (frente.mrz?.length && reverso.tarjeta && !reverso.mrz.length) {
    ladosIne = { frente: reverso, reverso: frente };
    [archivosIne.frente.files, archivosIne.reverso.files] = [archivosIne.reverso.files, archivosIne.frente.files];
    Object.keys(ladosIne).forEach(lado => mostrarLado(lado, ladosIne[lado]));
    avisarIne('Venían al revés: intercambié frente y reverso');
  }
  const lados = Object.values(ladosIne);
  const mrz = lados.find(lado => lado.mrz?.length)?.mrz ?? [];
  const texto = lados.find(lado => lado.texto)?.texto ?? '';
  if (!nombreEditado) nombreIne.value = conEnie(nombreMrz(mrz), texto) || nombreFrente(texto);
  actualizarResumen();
}

function cambiarImagen(event) {
  const lado = event.target.closest('.lado').dataset.lado;
  const archivo = event.target.files[0];
  const estado = ladosIne[lado] = archivo?.size <= INE_MAX_BYTES ? { archivo } : {};
  mostrarLado(lado, null);
  avisarIne(archivo?.size > INE_MAX_BYTES ? 'La imagen pesa más de 15 MB' : '', true);
  if (estado.archivo) procesarLado(lado, estado);
  else event.target.value = '';
  revisarIne();
}

function pdfDeHoja(escaneo) {
  const pdf = new jspdf.jsPDF({ unit: 'in', format: 'letter', orientation: escaneo.width > escaneo.height ? 'landscape' : 'portrait' });
  pdf.addImage(escaneo, 'JPEG', 0, 0, escaneo.width / 200, escaneo.height / 200); // a 200 dpi
  return pdf.output('blob');
}

// Dibuja la primera hoja visible del Excel en un PDF carta, ajustada al ancho como al imprimir
async function excelAPdf(archivo) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await archivo.arrayBuffer());
  const hoja = libro.worksheets.find(h => h.state === 'visible') ?? libro.worksheets[0];
  const { orientation, margins, fitToPage, fitToHeight } = hoja.pageSetup;
  const pdf = new jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: orientation === 'landscape' ? 'landscape' : 'portrait' });
  const m = { left: .7, right: .7, top: .75, bottom: .75, ...margins }; // pulgadas
  const anchoUtil = pdf.internal.pageSize.getWidth() - (m.left + m.right) * 72;
  const altoUtil = pdf.internal.pageSize.getHeight() - (m.top + m.bottom) * 72;

  // Medidas en puntos: el ancho de Excel va en caracteres (7 px + 5 de margen) y el alto en puntos
  const anchoCol = c => { const col = hoja.getColumn(c); return col.hidden ? 0 : ((col.width ?? hoja.properties.defaultColWidth ?? 8.43) * 7 + 5) * .75; };
  const altoRen = r => { const ren = hoja.getRow(r); return ren.hidden ? 0 : ren.height ?? hoja.properties.defaultRowHeight ?? 15; };
  const suma = (medida, hasta) => { let total = 0; for (let i = 1; i < hasta; i++) total += medida(i); return total; };
  const x = c => suma(anchoCol, c);
  const y = r => suma(altoRen, r);

  const imagenes = hoja.getImages().map(({ imageId, range: { tl, br, ext } }) => {
    const punto = a => [x(a.nativeCol + 1) + a.nativeColOff / 12700, y(a.nativeRow + 1) + a.nativeRowOff / 12700]; // EMU → pt
    const [x0, y0] = punto(tl);
    const [x1, y1] = ext ? [x0 + ext.width * .75, y0 + ext.height * .75] : punto(br);
    return { imagen: libro.getImage(Number(imageId)), r: tl.nativeRow + 1, x0, y0, x1, y1 };
  });
  const ultRen = Math.max(hoja.rowCount, ...imagenes.map(i => i.r));
  const ultCol = hoja.columnCount;
  let escala = Math.min(1, anchoUtil / Math.max(x(ultCol + 1), ...imagenes.map(i => i.x1)));
  if (fitToPage && fitToHeight !== 0) escala = Math.min(escala, altoUtil / Math.max(y(ultRen + 1), ...imagenes.map(i => i.y1)));

  const paginas = [1]; // primer renglón de cada página
  for (let r = 1; r <= ultRen; r++) if ((y(r + 1) - y(paginas.at(-1))) * escala > altoUtil && r > paginas.at(-1)) paginas.push(r);
  paginas.slice(1).forEach(() => pdf.addPage());
  const enPagina = (r, xs, ys) => { // de coordenadas de la hoja a la página donde cae el renglón
    const i = paginas.findLastIndex(inicio => inicio <= r);
    pdf.setPage(i + 1);
    return [m.left * 72 + xs * escala, m.top * 72 + (ys - y(paginas[i])) * escala];
  };

  const regiones = {}; // celdas combinadas, por la celda principal
  (hoja.model.merges ?? []).forEach(rango => {
    const [a, b] = rango.split(':').map(direccion => hoja.getCell(direccion));
    regiones[a.address] = { c1: a.col, r1: a.row, c2: b.col, r2: b.row };
  });
  const celdas = [];
  for (let r = 1; r <= ultRen; r++) for (let c = 1; c <= ultCol; c++) {
    if (!anchoCol(c) || !altoRen(r)) continue;
    const celda = hoja.getCell(r, c);
    const zona = regiones[celda.master.address] ?? { c1: c, r1: r, c2: c, r2: r };
    const [x0, y0] = enPagina(zona.r1, x(zona.c1), y(zona.r1));
    const [x1, y1] = enPagina(zona.r1, x(zona.c2 + 1), y(zona.r2 + 1));
    celdas.push({ celda, r, c, zona, x0, y0, x1, y1, principal: celda.master === celda });
  }
  const color = (argb, porDefecto) => argb ? `#${argb.slice(-6)}` : porDefecto;

  // Primero rellenos, luego bordes encima y al final el texto
  for (const { celda, r, x0, y0, x1, y1, principal } of celdas) {
    const { type, pattern, fgColor } = celda.fill ?? {};
    if (!principal || type !== 'pattern' || pattern !== 'solid' || !fgColor?.argb) continue;
    enPagina(r, 0, 0);
    pdf.setFillColor(color(fgColor.argb)).rect(x0, y0, x1 - x0, y1 - y0, 'F');
  }
  const grosor = { thin: .5, hair: .25, medium: 1, thick: 1.5, double: 1.5 };
  for (const { celda, r, c, zona } of celdas) {
    const [cx0, cy0] = enPagina(r, x(c), y(r));
    const [cx1, cy1] = enPagina(r, x(c + 1), y(r + 1));
    const lados = { top: [r === zona.r1, cx0, cy0, cx1, cy0], bottom: [r === zona.r2, cx0, cy1, cx1, cy1], left: [c === zona.c1, cx0, cy0, cx0, cy1], right: [c === zona.c2, cx1, cy0, cx1, cy1] };
    for (const [lado, [orilla, ...linea]] of Object.entries(lados)) {
      const borde = celda.border?.[lado];
      if (!orilla || !borde?.style) continue;
      pdf.setLineWidth((grosor[borde.style] ?? .5) * escala).setDrawColor(color(borde.color?.argb, '#000000')).line(...linea);
    }
  }
  for (const { celda, r, x0, y0, x1, y1, principal } of celdas) {
    const texto = celda.value instanceof Date ? celda.value.toLocaleDateString('es-MX') : celda.text;
    if (!principal || !texto) continue;
    const { size = 11, bold, italic, color: tinta } = celda.font ?? {};
    const { horizontal, vertical = 'bottom', wrapText } = celda.alignment ?? {};
    const numero = typeof (celda.result ?? celda.value) === 'number';
    const alinear = { center: 'center', centerContinuous: 'center', right: 'right' }[horizontal ?? (numero ? 'right' : 'left')] ?? 'left';
    const margen = 2 * escala;
    enPagina(r, 0, 0);
    pdf.setFont('helvetica', bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal').setFontSize(size * escala).setTextColor(color(tinta?.argb, '#000000'));
    const lineas = wrapText ? pdf.splitTextToSize(texto, x1 - x0 - 2 * margen) : texto.split('\n');
    const alto = lineas.length * size * escala * 1.15;
    const ty = vertical === 'top' ? y0 + margen : vertical === 'middle' || vertical === 'center' ? (y0 + y1 - alto) / 2 : y1 - margen - alto;
    const tx = alinear === 'center' ? (x0 + x1) / 2 : alinear === 'right' ? x1 - margen : x0 + margen;
    pdf.text(lineas, tx, ty, { align: alinear, baseline: 'top', lineHeightFactor: 1.15 });
  }
  for (const { imagen, r, x0, y0, x1, y1 } of imagenes) {
    const [px, py] = enPagina(r, x0, y0);
    const datos = imagen.buffer ? new Uint8Array(imagen.buffer) : imagen.base64.replace(/^data:[^,]*,/, '');
    pdf.addImage(datos, imagen.extension.toUpperCase(), px, py, (x1 - x0) * escala, (y1 - y0) * escala);
  }
  return new File([pdf.output('blob')], archivo.name.replace(/\.xlsx$/i, '.pdf'), { type: 'application/pdf' });
}

async function descargarPdfIne() {
  const nombre = `${nombreIne.value.toUpperCase().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'INE'}.pdf`;
  const pdf = new jspdf.jsPDF({ unit: 'in', format: 'letter' }); // carta a 200 dpi: frente en (208, 200) px y reverso en (208, 1150) px
  pdf.addImage(ladosIne.frente.tarjeta, 'JPEG', 208 / 200, 200 / 200, ANCHO / 200, ALTO / 200);
  pdf.addImage(ladosIne.reverso.tarjeta, 'JPEG', 208 / 200, 1150 / 200, ANCHO / 200, ALTO / 200);
  const ine = pdf.output('blob');
  const elegidos = anexosElegidos();
  if (!elegidos.length) return descargarArchivo(ine, nombre);
  try {
    const extras = elegidos.map(clave => anexos[clave].escaneo ? pdfDeHoja(anexos[clave].escaneo) : anexos[clave].archivo);
    descargarArchivo(await juntarPdfs([ine, ...extras]), nombre);
    avisarIne('');
  } catch (error) {
    avisarIne(error.message, true);
  }
}

function limpiarIne() {
  document.querySelectorAll('#ine input[type="file"]').forEach(input => input.value = '');
  ladosIne = { frente: {}, reverso: {} };
  Object.keys(ladosIne).forEach(lado => {
    mostrarLado(lado, null);
    marcarCargando(lado, false);
  });
  anexos = { acuse: {}, carta: {} };
  Object.keys(anexos).forEach(mostrarAnexo);
  opcionesAnexo.forEach(boton => boton.setAttribute('aria-pressed', false));
  nombreIne.value = '';
  nombreEditado = false;
  avisarIne('');
  actualizarResumen();
}

function dibujarEsquinas() {
  lienzo.querySelectorAll('.esquina').forEach((marca, i) => {
    marca.style.left = `${esquinasEditor[i][0] * 100}%`;
    marca.style.top = `${esquinasEditor[i][1] * 100}%`;
  });
  lienzo.querySelector('polygon').setAttribute('points', esquinasEditor.join(' '));
}

async function abrirEditor(original, esquinas, aplicar) {
  alAplicar = aplicar;
  esquinasEditor = esquinas.map(punto => [...punto]);
  const imagen = lienzo.querySelector('img');
  imagen.src = escalar(original, 1000).toDataURL('image/jpeg', .9);
  await imagen.decode();
  lienzo.style.setProperty('--proporcion', imagen.naturalWidth / imagen.naturalHeight);
  dibujarEsquinas();
  editor.showModal();
}

function moverEsquina(event) {
  if (!event.buttons) return;
  const caja = lienzo.getBoundingClientRect();
  const punto = [(event.clientX - caja.left) / caja.width, (event.clientY - caja.top) / caja.height];
  if (event.type === 'pointerdown') {
    lienzo.setPointerCapture(event.pointerId);
    const distancias = esquinasEditor.map(([x, y]) => Math.hypot((x - punto[0]) * caja.width, (y - punto[1]) * caja.height));
    const i = distancias.indexOf(Math.min(...distancias));
    arrastre = { i, desfase: [esquinasEditor[i][0] - punto[0], esquinasEditor[i][1] - punto[1]] };
  }
  esquinasEditor[arrastre.i] = punto.map((valor, eje) => Math.min(1, Math.max(0, valor + arrastre.desfase[eje])));
  dibujarEsquinas();
}

function aplicarEsquinas() {
  editor.close();
  alAplicar(esquinasEditor);
}

function ajustarLado(event) {
  const lado = event.target.closest('.lado').dataset.lado;
  const { archivo, imagen, esquinas } = ladosIne[lado];
  abrirEditor(imagen, esquinas, nuevas => {
    const estado = ladosIne[lado] = { archivo, imagen, esquinas: nuevas };
    procesarLado(lado, estado);
    revisarIne();
  });
}

function ajustarAnexo(event) {
  const clave = event.target.closest('.anexo').dataset.anexo;
  const { archivo, foto, imagen, esquinas, cuartos } = anexos[clave];
  abrirEditor(imagen, esquinas, nuevas => {
    const estado = anexos[clave] = { archivo, foto, imagen, esquinas: nuevas, cuartos };
    mostrarAnexo(clave);
    procesarAnexo(clave, estado);
    actualizarResumen();
  });
}

function girarLado(event) {
  const lado = event.target.closest('.lado').dataset.lado;
  ladosIne[lado].tarjeta = girar(ladosIne[lado].tarjeta);
  mostrarLado(lado, ladosIne[lado]);
}

function girarAnexo(event) {
  const clave = event.target.closest('.anexo').dataset.anexo;
  const estado = anexos[clave];
  estado.cuartos = (estado.cuartos + Number(event.currentTarget.dataset.giro) + 4) % 4;
  estado.escaneo = girar(estado.plano, estado.cuartos);
  mostrarAnexo(clave);
}

// En PC se puede soltar el archivo sobre el recuadro
function soltarArchivo(event) {
  const zona = event.currentTarget;
  event.preventDefault();
  zona.classList.toggle('encima', event.type === 'dragover');
  if (event.type !== 'drop' || !event.dataTransfer.files.length) return;
  const input = zona.querySelector('input');
  input.files = event.dataTransfer.files;
  input.dispatchEvent(new Event('change'));
}

document.querySelector('[data-modo="ine"]').addEventListener('click', () => prepararIne().catch(() => {}));
Object.values(archivosIne).forEach(input => input.addEventListener('change', cambiarImagen));
document.querySelectorAll('.lado .ajustar').forEach(boton => boton.addEventListener('click', ajustarLado));
document.querySelectorAll('.anexo .ajustar').forEach(boton => boton.addEventListener('click', ajustarAnexo));
document.querySelectorAll('.lado .girar').forEach(boton => boton.addEventListener('click', girarLado));
document.querySelectorAll('.anexo .girar').forEach(boton => boton.addEventListener('click', girarAnexo));
document.querySelectorAll('.anexo input').forEach(input => input.addEventListener('change', cambiarAnexo));
document.querySelectorAll('#ine .carga').forEach(zona => ['dragover', 'dragleave', 'drop'].forEach(tipo => zona.addEventListener(tipo, soltarArchivo)));
nombreIne.addEventListener('input', () => nombreEditado = nombreIne.value !== '');
generarPdf.addEventListener('click', descargarPdfIne);
document.getElementById('limpiarIne').addEventListener('click', limpiarIne);
lienzo.addEventListener('pointerdown', moverEsquina);
lienzo.addEventListener('pointermove', moverEsquina);
document.getElementById('aplicarEsquinas').addEventListener('click', aplicarEsquinas);
document.getElementById('cancelarEsquinas').addEventListener('click', () => editor.close());
opcionesAnexo.forEach(boton => boton.addEventListener('click', elegirAnexo));
actualizarResumen();
