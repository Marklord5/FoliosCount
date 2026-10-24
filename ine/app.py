"""API que digitaliza la credencial INE (frente y reverso) en un PDF tamaño carta.

Requiere Python 3.10+ y Tesseract con los idiomas eng y spa
(macOS: brew install tesseract tesseract-lang · Debian: apt install tesseract-ocr tesseract-ocr-spa).

En local basta con ./iniciar.command (o doble clic en Finder): instala lo necesario la primera vez,
levanta el servidor y abre http://localhost:8000, que sirve la página y la API sin depender de nada externo.

    pip install -r requirements.txt
    INE_ORIGENES=https://tu-sitio.com uvicorn app:app --proxy-headers

Sin INE_ORIGENES solo acepta páginas servidas desde localhost (no file://).

También une varios PDF en uno (/unir), para anexar el acuse o la carta responsiva a la INE.

Todo se procesa en memoria: las imágenes y los PDF no se escriben a disco ni a los logs.
"""
import base64
import io
import json
import os
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener
from pypdf import PdfReader, PdfWriter
from rembg import new_session, remove
from starlette.formparsers import MultiPartParser

ANCHO, ALTO = 1284, 810  # 85.6 × 54 mm a 381 dpi
MAX_BYTES = 15 * 1024 * 1024
MAX_TOTAL = 4 * MAX_BYTES  # por petición: varios PDF al unir
FORMATOS = {'JPEG', 'PNG', 'HEIF'}
MRZ = ['-c', 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<']
SIN_ACENTOS = str.maketrans('ÁÉÍÓÚÜ', 'AEIOUU')
SESION = new_session('isnet-general-use')
CARAS = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

PAGINA = Path(__file__).resolve().parent.parent  # carpeta de index.html
ORIGENES = [origen for origen in os.environ.get('INE_ORIGENES', '').split(',') if origen]

if not {'eng', 'spa'} <= set(subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True).stdout.split()):
    raise RuntimeError('Falta Tesseract con eng y spa (brew install tesseract tesseract-lang · apt install tesseract-ocr-spa)')

register_heif_opener()
MultiPartParser.spool_max_size = MAX_TOTAL + 1024 * 1024  # los archivos nunca pasan por un temporal en disco

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def solo_https(request: Request, call_next):
    if request.url.scheme != 'https' and request.client.host not in ('127.0.0.1', '::1'):
        return JSONResponse({'detail': 'Solo se aceptan conexiones HTTPS'}, 403)
    if int(request.headers.get('content-length', 0)) > MultiPartParser.spool_max_size:
        return JSONResponse({'detail': 'Los archivos pesan más de 60 MB en total'}, 413)
    respuesta = await call_next(request)
    respuesta.headers['Strict-Transport-Security'] = 'max-age=31536000'
    respuesta.headers['Cache-Control'] = 'no-store'
    return respuesta


# Se registra después para quedar por fuera de solo_https y que sus errores también lleven cabeceras CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES,
    allow_origin_regex=None if ORIGENES else r'http://(localhost|127\.0\.0\.1)(:\d+)?',
    allow_methods=['POST'],
)


def abrir(archivo):
    datos = archivo.file.read(MAX_BYTES + 1)
    if len(datos) > MAX_BYTES:
        raise HTTPException(413, 'La imagen pesa más de 15 MB')
    try:
        imagen = Image.open(io.BytesIO(datos))
        if imagen.format not in FORMATOS:
            raise ValueError
        return np.array(ImageOps.exif_transpose(imagen).convert('RGB'))
    except Exception:
        raise HTTPException(415, 'Solo se aceptan imágenes JPG, PNG o HEIC')


def leer_esquinas(texto):
    try:
        return np.clip(np.float32(json.loads(texto)).reshape(4, 2), 0, 1)
    except Exception:
        raise HTTPException(422, 'Esquinas inválidas')


def reducir(img, lado=1000):
    escala = min(1, lado / max(img.shape[:2]))
    return cv2.resize(img, None, fx=escala, fy=escala, interpolation=cv2.INTER_AREA)


def detectar(img):
    """Esquinas de la tarjeta en fracciones del ancho y alto de la imagen."""
    mascara = remove(reducir(img), session=SESION, only_mask=True)
    mascara = cv2.morphologyEx((mascara > 127).astype(np.uint8), cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    contornos = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    contorno = max(contornos, key=cv2.contourArea, default=None)
    if contorno is None or not 0.1 < cv2.contourArea(contorno) / mascara.size < 0.9:
        return np.float32([[0, 0], [1, 0], [1, 1], [0, 1]])  # escaneo sin fondo: se usa la imagen completa

    casco = cv2.convexHull(contorno)
    perimetro = cv2.arcLength(casco, True)
    for epsilon in np.arange(0.01, 0.085, 0.01):
        puntos = cv2.approxPolyDP(casco, epsilon * perimetro, True)
        if len(puntos) == 4:
            break
    else:
        puntos = cv2.boxPoints(cv2.minAreaRect(casco))
    return np.float32(puntos.reshape(4, 2) / mascara.shape[::-1])


def ordenar(puntos):
    """Sup-izq, sup-der, inf-der, inf-izq."""
    centro = puntos.mean(0)
    puntos = puntos[np.argsort(np.arctan2(puntos[:, 1] - centro[1], puntos[:, 0] - centro[0]))]
    return np.roll(puntos, -np.argmin(puntos.sum(1)), axis=0)


def enderezar(img, esquinas):
    alto, ancho = img.shape[:2]
    puntos = ordenar(esquinas * [ancho, alto]).astype(np.float32)
    arriba, derecha, abajo, izquierda = np.linalg.norm(puntos - np.roll(puntos, -1, axis=0), axis=1)
    if derecha + izquierda > arriba + abajo:
        puntos = np.roll(puntos, -1, axis=0)  # tarjeta vertical: queda horizontal
    destino = np.float32([[0, 0], [ANCHO, 0], [ANCHO, ALTO], [0, ALTO]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(puntos, destino), (ANCHO, ALTO))


def ocr(img, idioma, opciones=()):
    png = cv2.imencode('.png', cv2.cvtColor(img, cv2.COLOR_RGB2GRAY))[1].tobytes()
    comando = ['tesseract', 'stdin', 'stdout', '-l', idioma, '--psm', '6', *opciones]
    return subprocess.run(comando, input=png, capture_output=True, check=True).stdout.decode()


def leer_mrz(tarjeta):
    """Líneas tipo pasaporte (MRZ) de la parte baja del reverso; vacío si no las hay."""
    lineas = [linea.replace(' ', '') for linea in ocr(tarjeta[int(ALTO * 0.6):], 'eng', MRZ).splitlines()]
    lineas = [linea for linea in lineas if '<' in linea]
    return lineas if sum(linea.count('<') for linea in lineas) >= 10 else []


def hay_cara(tarjeta):
    gris = cv2.cvtColor(tarjeta, cv2.COLOR_RGB2GRAY)
    return len(CARAS.detectMultiScale(gris, 1.1, 5, minSize=(100, 100))) > 0


def orientar(tarjeta):
    """Pone la tarjeta al derecho y devuelve sus líneas MRZ (solo el reverso las tiene)."""
    girada = cv2.rotate(tarjeta, cv2.ROTATE_180)
    for opcion in (tarjeta, girada):
        mrz = leer_mrz(opcion)
        if mrz:
            return opcion, mrz
    if not hay_cara(tarjeta) and hay_cara(girada):
        return girada, []
    return tarjeta, []


def es_reverso(lado):
    """El reverso tiene MRZ y códigos QR grandes."""
    return bool(lado['mrz']) or cv2.QRCodeDetector().detect(cv2.cvtColor(lado['tarjeta'], cv2.COLOR_RGB2GRAY))[0]


def normalizar(texto):
    return texto.upper().translate(SIN_ACENTOS)


def limpiar(linea):
    linea = re.sub(r'SEXO.*', '', normalizar(linea))
    return ' '.join(palabra for palabra in re.sub(r'[^A-ZÑ]', ' ', linea).split() if len(palabra) > 1)


def nombre_mrz(mrz):
    """APELLIDO1<APELLIDO2<<NOMBRE1<NOMBRE2 → APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2."""
    for linea in reversed(mrz):
        partes = re.match(r'([A-Z]+(?:<[A-Z]+)*)<<([A-Z]+(?:<[A-Z]+)*)', linea)
        if partes:
            return ' '.join(partes.groups()).replace('<', ' ')
    return ''


def leer_frente(tarjeta):
    """Texto del bloque NOMBRE, a la derecha de la foto."""
    return ocr(tarjeta[int(ALTO * 0.2):int(ALTO * 0.6), int(ANCHO * 0.28):int(ANCHO * 0.8)], 'spa')


def nombre_frente(texto):
    """Las 3 líneas bajo NOMBRE: apellido paterno, materno y nombres."""
    lineas = [limpiar(linea) for linea in texto.splitlines()]
    inicio = next((i + 1 for i, linea in enumerate(lineas) if 'NOMBRE' in linea), len(lineas))
    nombre = []
    for linea in lineas[inicio:]:
        if 'DOMICILIO' in linea or len(nombre) == 3:
            break
        if linea:
            nombre.append(linea)
    return ' '.join(nombre)


def con_enie(nombre, texto_frente):
    """La MRZ escribe la Ñ como N; se recupera de las palabras con Ñ del frente."""
    enies = {palabra.replace('Ñ', 'N'): palabra for palabra in limpiar(texto_frente).split() if 'Ñ' in palabra}
    return ' '.join(enies.get(palabra, palabra) for palabra in nombre.split())


def jpeg(img):
    return 'data:image/jpeg;base64,' + base64.b64encode(cv2.imencode('.jpg', cv2.cvtColor(img, cv2.COLOR_RGB2BGR))[1]).decode()


def pdf(frente, reverso):
    hoja = Image.new('RGB', (1700, 2200), 'white')  # carta a 200 dpi
    hoja.paste(Image.fromarray(frente), (208, 200))
    hoja.paste(Image.fromarray(reverso), (208, 1150))
    salida = io.BytesIO()
    hoja.save(salida, 'PDF', resolution=200)
    return base64.b64encode(salida.getvalue()).decode()


@app.get('/')
def pagina():
    return FileResponse(PAGINA / 'index.html')


@app.get('/logo.js')
def logo():
    return FileResponse(PAGINA / 'logo.js')


@app.post('/ine')
def ine(
    frente: UploadFile | None = File(None),
    reverso: UploadFile | None = File(None),
    esquinas_frente: str | None = Form(None),
    esquinas_reverso: str | None = Form(None),
):
    """Recibe frente y/o reverso (y opcionalmente las esquinas ajustadas a mano, en fracciones 0–1).
    Devuelve el recorte de cada lado, la foto original reducida, las esquinas, el nombre y, con ambos lados, el PDF."""
    lados = {}
    for lado, archivo, esquinas in (('frente', frente, esquinas_frente), ('reverso', reverso, esquinas_reverso)):
        if archivo:
            img = abrir(archivo)
            esquinas = leer_esquinas(esquinas) if esquinas else detectar(img)
            tarjeta, mrz = orientar(enderezar(img, esquinas))
            lados[lado] = {'img': img, 'esquinas': esquinas, 'tarjeta': tarjeta, 'mrz': mrz}
    if not lados:
        raise HTTPException(422, 'Sube al menos una imagen')

    intercambiadas = len(lados) == 2 and es_reverso(lados['frente']) and not es_reverso(lados['reverso'])
    if intercambiadas:
        lados['frente'], lados['reverso'] = lados['reverso'], lados['frente']

    mrz = next((lado['mrz'] for lado in lados.values() if lado['mrz']), [])
    texto_frente = leer_frente(lados['frente']['tarjeta']) if 'frente' in lados else ''
    respuesta = {
        'nombre': con_enie(nombre_mrz(mrz), texto_frente) or nombre_frente(texto_frente),
        'intercambiadas': intercambiadas,
    }
    for nombre, lado in lados.items():
        respuesta[nombre] = {'recorte': jpeg(lado['tarjeta']), 'original': jpeg(reducir(lado['img'])), 'esquinas': lado['esquinas'].tolist()}
    if len(lados) == 2:
        respuesta['pdf'] = pdf(lados['frente']['tarjeta'], lados['reverso']['tarjeta'])
    return respuesta


def leer_pdf(archivo):
    datos = archivo.file.read(MAX_BYTES + 1)
    if len(datos) > MAX_BYTES:
        raise HTTPException(413, f'{archivo.filename} pesa más de 15 MB')
    try:
        lector = PdfReader(io.BytesIO(datos))
        if lector.is_encrypted and not lector.decrypt(''):
            raise HTTPException(422, f'{archivo.filename} está protegido con contraseña')
        lector.pages[0]  # valida que se pueda leer
        return lector
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(415, f'{archivo.filename} no es un PDF válido')


@app.post('/unir')
def unir(archivos: list[UploadFile] = File(...)):
    """Une los PDF en el orden recibido y devuelve un solo PDF."""
    if len(archivos) < 2:
        raise HTTPException(422, 'Sube al menos dos PDF')
    documento = PdfWriter()
    for archivo in archivos:
        documento.append(leer_pdf(archivo))
    salida = io.BytesIO()
    documento.write(salida)
    return Response(salida.getvalue(), media_type='application/pdf')
