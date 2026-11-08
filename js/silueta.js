// Worker: corre IS-Net (separa la credencial del fondo) fuera de la página para que no se congele.
// Primer mensaje: { url, opciones } de la librería; después, cada mensaje es una foto y se responde su máscara.
let quitarFondo = null;

onmessage = async ({ data }) => {
  try {
    if (quitarFondo) return postMessage({ mascara: await quitarFondo(data) });
    const { preload, segmentForeground } = await import(data.url);
    await preload(data.opciones);
    quitarFondo = foto => segmentForeground(foto, data.opciones);
    postMessage({});
  } catch (falla) {
    postMessage({ error: String(falla?.message ?? falla) });
  }
};
