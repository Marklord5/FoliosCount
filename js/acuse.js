const tipo = document.getElementById('tipo');
const pegado = document.getElementById('pegado');
const solicitante = document.getElementById('solicitante');
const area = document.getElementById('area');
const descargar = document.getElementById('descargar');
const FILA_PEGADA = /^(?:(?:des)?montaje\s*-\s*)?(.+?)[\s:,;|-]+(\d+)\D+(\d+)$/i;
const pegadoPorTipo = { MONTAJE: '', DESMONTAJE: '' };
let filasAcuse = [];

function tipoElegido() {
  return tipo.querySelector('[aria-pressed="true"]').textContent.toUpperCase();
}

function elegirTipo(event) {
  tipo.querySelectorAll('button').forEach(boton => boton.setAttribute('aria-pressed', boton === event.currentTarget));
  pegado.value = pegadoPorTipo[tipoElegido()];
  pegado.focus();
  leerPegado();
}

function leerPegado() {
  const ilegibles = [];
  filasAcuse = [];
  pegadoPorTipo[tipoElegido()] = pegado.value;

  for (const [seccion, texto] of Object.entries(pegadoPorTipo)) {
    for (const linea of texto.split('\n').map(linea => linea.trim()).filter(Boolean)) {
      const columnas = linea.split('\t');
      const sinColumnasExtra = columnas.length > 3 ? `${columnas[0]}\t${columnas.at(-2)}\t${columnas.at(-1)}` : linea;
      const [, nombre, a, b] = sinColumnasExtra.match(FILA_PEGADA) ?? [];
      if (Number(b) >= Number(a)) filasAcuse.push({ categoria: `${seccion} - ${nombre}`, inicial: Number(a), final: Number(b), total: b - a + 1 });
      else ilegibles.push(`${seccion}: ${linea}`);
    }
  }

  const problema = ilegibles.length ? `No pude leer:\n${ilegibles.join('\n')}` : '';

  document.getElementById('vista').tBodies[0].replaceChildren(...filasAcuse.map(fila => {
    const renglon = document.createElement('tr');
    Object.values(fila).forEach(valor => renglon.insertCell().textContent = valor);
    return renglon;
  }));
  document.getElementById('totalAcuse').textContent = filasAcuse.reduce((suma, fila) => suma + fila.total, 0);
  document.getElementById('aviso').textContent = problema;
  descargar.disabled = filasAcuse.length === 0 || problema !== '';
}

async function descargarAcuse() {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('ACUSE', { pageSetup: { fitToPage: true, fitToHeight: 0 } });
  const negrita = { bold: true };
  const centrado = { horizontal: 'center', vertical: 'middle' };
  const fino = { style: 'thin' };
  const grueso = { style: 'medium' };
  const escribir = (celda, valor, estilo) => Object.assign(hoja.getCell(celda), { value: valor, ...estilo });

  hoja.columns = [{ width: 54 }, { width: 19 }, { width: 15.5 }, { width: 12 }];
  [22, 34, 24].forEach((alto, i) => hoja.getRow(5 + i).height = alto);
  hoja.addImage(libro.addImage({ base64: LOGO, extension: 'jpeg' }), { tl: { col: 0, row: 3 }, ext: { width: 270, height: 127 } });

  hoja.mergeCells('B5:D5');
  hoja.mergeCells('B6:D6');
  escribir('B5', 'ACUSE DE RECIBIDO', { font: { bold: true, size: 16 }, alignment: centrado });
  escribir('B6', 'F1- 2026', { font: { bold: true, size: 16 }, alignment: centrado });

  escribir('A8', 'SOLICITANTE:', { font: negrita });
  escribir('B8', solicitante.value, { font: negrita });
  escribir('A9', 'ÁREA:', { font: negrita });
  escribir('B9', area.value, { font: negrita });
  escribir('A10', 'OBSERVACIONES:', { font: negrita });
  escribir('B10', document.getElementById('observaciones').value, { font: negrita });

  ['CATEGORIA', 'FOLIO INICIAL', 'FOLIO FINAL', 'TOTAL'].forEach((titulo, i) => escribir(`${'ABCD'[i]}12`, titulo, {
    font: negrita,
    alignment: centrado,
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9BC2E6' } },
    border: { top: grueso, bottom: grueso, left: grueso, right: grueso },
  }));

  filasAcuse.forEach(({ categoria, inicial, final, total }, i) => {
    const n = 13 + i;
    const renglon = hoja.getRow(n);
    renglon.height = 26;
    renglon.values = [categoria, inicial, final, { formula: `C${n}-B${n}+1`, result: total }];
    renglon.eachCell((celda, columna) => {
      celda.alignment = { horizontal: 'left', vertical: 'middle' };
      celda.border = {
        top: fino,
        bottom: i === filasAcuse.length - 1 ? grueso : fino,
        left: columna === 1 ? grueso : fino,
        right: columna === 4 ? grueso : fino,
      };
    });
  });

  const firma = 13 + filasAcuse.length + 4;
  escribir(`A${firma}`, `RECIBE:${'_'.repeat(33)}   FIRMA:${'_'.repeat(27)}`);
  escribir(`A${firma + 2}`, `FECHA:${'_'.repeat(34)}`);

  await descargarLibro(libro, `ACUSE F1-26 ${solicitante.value}`.trim());
}

function limpiarAcuse() {
  Object.keys(pegadoPorTipo).forEach(seccion => pegadoPorTipo[seccion] = '');
  document.querySelectorAll('#acuse :is(input, textarea)').forEach(campo => campo.value = '');
  pegado.focus();
  leerPegado();
}

tipo.querySelectorAll('button').forEach(boton => boton.addEventListener('click', elegirTipo));
pegado.addEventListener('input', leerPegado);
descargar.addEventListener('click', descargarAcuse);
document.getElementById('limpiarAcuse').addEventListener('click', limpiarAcuse);
leerPegado();
