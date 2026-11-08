// Utilidades que usan varios modos

function descargarArchivo(datos, nombre) {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(datos);
  enlace.download = nombre;
  enlace.click();
}

async function juntarPdfs(archivos) {
  const unido = await PDFLib.PDFDocument.create();
  for (const archivo of archivos) {
    let documento;
    try {
      documento = await PDFLib.PDFDocument.load(await archivo.arrayBuffer(), { ignoreEncryption: true });
    } catch {
      throw new Error(`${archivo.name} no es un PDF válido`);
    }
    (await unido.copyPages(documento, documento.getPageIndices())).forEach(pagina => unido.addPage(pagina));
  }
  return new Blob([await unido.save()], { type: 'application/pdf' });
}

async function descargarLibro(libro, nombre) {
  descargarArchivo(new Blob([await libro.xlsx.writeBuffer()]), `${nombre}.xlsx`);
}
