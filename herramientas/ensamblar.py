#!/usr/bin/env python3
"""Ensambla el archivo final (index.html) a partir de los cinco archivos de capa.

Uso:
    python3 herramientas/ensamblar.py              reescribe el archivo final
    python3 herramientas/ensamblar.py --verificar  sólo compara; sale con 1 si difiere

En los dos modos controla además que la versión de la app (VERSION_APP, en
capa3-escenarios.js) tenga su entrada al tope de CHANGELOG.md: cada PR que
toca una capa sube la versión y escribe qué cambió.

El archivo final es un derivado: cada bloque <script> contiene exactamente el
código de una capa. Los .js de capa son la fuente; nunca se edita el HTML a
mano. La herramienta usa sólo la biblioteca estándar de Python y no forma
parte del producto, que sigue siendo un único archivo sin dependencias.
"""
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# El archivo final se llama index.html para poder publicarlo como sitio.
HTML = os.path.join(RAIZ, "index.html")
NOMBRE = os.path.basename(HTML)
CAPAS = ["capa1-red.js", "capa2-motor.js", "capa3-escenarios.js", "capa4-ui.js", "capa5-autotest.js"]
CHANGELOG = os.path.join(RAIZ, "CHANGELOG.md")


def leer(ruta):
    with open(ruta, encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")


def ensamblar(html):
    """Reemplaza el contenido de cada bloque de capa. El bloque se reconoce
    por la primera línea de su archivo (el comentario de cabecera)."""
    for capa in CAPAS:
        codigo = leer(os.path.join(RAIZ, capa))
        primera = codigo.split("\n", 1)[0]
        marca = "<script>\n" + primera
        inicio = html.find(marca)
        if inicio < 0:
            raise SystemExit("No se encontró el bloque de " + capa + " en " + NOMBRE + " "
                             "(se busca por su primera línea: " + primera[:60] + ").")
        inicio += len("<script>\n")
        fin = html.index("</script>", inicio)
        html = html[:inicio] + codigo.rstrip("\n") + "\n\n" + html[fin:]
    return html


def problema_de_version():
    """Devuelve un mensaje si VERSION_APP no es la primera entrada del changelog; si no, None."""
    m = re.search(r'var VERSION_APP = "(\d+\.\d+\.\d+)";', leer(os.path.join(RAIZ, "capa3-escenarios.js")))
    if not m:
        return "No se encontró VERSION_APP en capa3-escenarios.js."
    version = m.group(1)
    if not os.path.exists(CHANGELOG):
        return "Falta CHANGELOG.md: la versión " + version + " no tiene su entrada."
    primera = re.search(r"^## (\d+\.\d+\.\d+)(?!\d)", leer(CHANGELOG), re.MULTILINE)
    if not primera:
        return "CHANGELOG.md no tiene ninguna entrada «## X.Y.Z»."
    if primera.group(1) != version:
        return ("La versión de la app (" + version + ") no tiene entrada en el changelog: la primera es la "
                + primera.group(1) + ". Agregá «## " + version + " — AAAA-MM-DD» al tope de CHANGELOG.md.")
    return None


def main():
    verificar = "--verificar" in sys.argv[1:]
    problema = problema_de_version()
    if problema:
        print(problema)
        return 1
    actual = leer(HTML)
    nuevo = ensamblar(actual)
    if verificar:
        if nuevo != actual:
            print(NOMBRE + " NO coincide con los archivos de capa. Corré: python3 herramientas/ensamblar.py")
            return 1
        print(NOMBRE + " coincide con las cinco capas.")
        return 0
    if nuevo == actual:
        print(NOMBRE + " ya estaba al día.")
        return 0
    with open(HTML, "w", encoding="utf-8", newline="") as f:
        f.write(nuevo)
    print(NOMBRE + " reensamblado a partir de las cinco capas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
