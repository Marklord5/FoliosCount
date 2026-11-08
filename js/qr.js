const foliosQr = document.getElementById('foliosQr');
const formatos = document.getElementById('formatos');
const botonQr = document.getElementById('descargarQr');
const avisoQr = document.getElementById('avisoQr');
const PDF_POR_FILA = 10;
const PDF_POR_HOJA = 130;
const EXCEL_POR_FILA = 9;
const EXCEL_PIXELES = 2 / 2.54 * 96;

function leerFolios() {
  let folios;
  try { folios = JSON.parse(foliosQr.value); } catch {}
  if (!Array.isArray(folios)) folios = foliosQr.value.split('\n');
  return folios.map(folio => String(folio).trim()).filter(Boolean);
}

function contarFolios() {
  const cantidad = leerFolios().length;
  avisoQr.textContent = '';
  const formato = formatos.querySelector(':checked').value;
  botonQr.disabled = cantidad === 0;
  botonQr.querySelector('span').textContent = cantidad ? `Descargar ${formato} (${cantidad} QR)` : `Descargar ${formato}`;
}

function crearCodigos() {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

  try {
    return leerFolios().map(folio => {
      const codigo = qrcode(0, 'M');
      codigo.addData(folio);
      codigo.make();
      return { folio, codigo };
    });
  } catch {
    avisoQr.textContent = 'Hay un folio demasiado largo para un QR';
    return [];
  }
}

function dibujarTarjetaPdf(pdf, folio, codigo, x, y) {
  const color = document.getElementById('colorQr').value;
  const fondo = [1, 3, 5].map(i => Math.round(255 - (255 - parseInt(color.slice(i, i + 2), 16)) * 0.13));
  const modulos = codigo.getModuleCount();
  const lado = 1.3 / modulos;
  const traslape = 0.003;

  pdf.setDrawColor(color);
  pdf.setLineWidth(0.025);
  pdf.setFillColor(...fondo);
  pdf.roundedRect(x + 0.0125, y + 0.0125, 1.975, 1.975, 0.17, 0.17, 'FD');
  pdf.setFillColor('#FFFFFF');
  pdf.roundedRect(x + 0.27, y + 0.09, 1.46, 1.46, 0.1, 0.1, 'F');

  pdf.setFillColor(color);
  for (let fila = 0; fila < modulos; fila++) {
    for (let columna = 0; columna < modulos; columna++) {
      if (codigo.isDark(fila, columna)) pdf.rect(x + 0.35 + columna * lado, y + 0.17 + fila * lado, lado + traslape, lado + traslape, 'F');
    }
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(color);
  pdf.setFontSize(8);
  pdf.setFontSize(Math.min(8, 8 * 1.8 / pdf.getTextWidth(folio)));
  pdf.text(folio, x + 1, y + 1.775, { align: 'center', baseline: 'middle' });
}

function dibujarTarjetaPng(folio, codigo) {
  const color = document.getElementById('colorQr').value;
  const modulos = codigo.getModuleCount();
  const lado = Math.floor(312 / modulos);
  const orilla = Math.round((352 - lado * modulos) / 2);
  const lienzo = Object.assign(document.createElement('canvas'), { width: 480, height: 480 });
  const pincel = lienzo.getContext('2d');

  pincel.roundRect(3, 3, 474, 474, 40);
  pincel.fillStyle = '#FFFFFF';
  pincel.fill();
  pincel.fillStyle = `${color}22`;
  pincel.fill();
  pincel.strokeStyle = color;
  pincel.lineWidth = 6;
  pincel.stroke();

  pincel.beginPath();
  pincel.roundRect(64, 22, 352, 352, 24);
  pincel.fillStyle = '#FFFFFF';
  pincel.fill();

  pincel.fillStyle = color;
  for (let fila = 0; fila < modulos; fila++) {
    for (let columna = 0; columna < modulos; columna++) {
      if (codigo.isDark(fila, columna)) pincel.fillRect(64 + orilla + columna * lado, 22 + orilla + fila * lado, lado, lado);
    }
  }

  pincel.font = '800 68px system-ui, sans-serif';
  pincel.textAlign = 'center';
  pincel.textBaseline = 'middle';
  pincel.fillText(folio, 240, 426, 436);
  return lienzo.toDataURL();
}

function descargarQrPdf() {
  const codigos = crearCodigos();
  if (codigos.length === 0) return;

  const pdf = new jspdf.jsPDF({ unit: 'cm', format: 'letter', compress: true });
  codigos.forEach(({ folio, codigo }, i) => {
    const lugar = i % PDF_POR_HOJA;
    if (i > 0 && lugar === 0) pdf.addPage();
    dibujarTarjetaPdf(pdf, folio, codigo, 0.57 + (lugar % PDF_POR_FILA) * 2.05, 0.67 + Math.floor(lugar / PDF_POR_FILA) * 2.05);
  });
  pdf.save('QR.pdf');
}

async function descargarQrExcel() {
  const codigos = crearCodigos();
  if (codigos.length === 0) return;

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('QR', { pageSetup: {
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.25, bottom: 0.25, header: 0, footer: 0 },
  } });
  hoja.columns = Array(EXCEL_POR_FILA).fill({ width: 11.6 });

  codigos.forEach(({ folio, codigo }, i) => {
    const fila = Math.floor(i / EXCEL_POR_FILA);
    const columna = i % EXCEL_POR_FILA;
    hoja.getRow(fila + 1).height = 58;
    Object.assign(hoja.getCell(fila + 1, columna + 1), { value: folio, font: { color: { argb: 'FFFFFFFF' } } });
    hoja.addImage(libro.addImage({ base64: dibujarTarjetaPng(folio, codigo), extension: 'png' }), { tl: { col: columna, row: fila }, ext: { width: EXCEL_PIXELES, height: EXCEL_PIXELES } });
  });
  await descargarLibro(libro, 'QR');
}

function limpiarQr() {
  foliosQr.value = '';
  foliosQr.focus();
  contarFolios();
}

foliosQr.addEventListener('input', contarFolios);
formatos.addEventListener('change', contarFolios);
botonQr.addEventListener('click', () => formatos.querySelector(':checked').value === 'PDF' ? descargarQrPdf() : descargarQrExcel());
document.getElementById('limpiarQr').addEventListener('click', limpiarQr);
