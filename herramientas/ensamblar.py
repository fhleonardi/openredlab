#!/usr/bin/env python3
"""Ensambla simulador.html a partir de los cinco archivos de capa.

Uso:
    python3 herramientas/ensamblar.py              reescribe simulador.html
    python3 herramientas/ensamblar.py --verificar  sólo compara; sale con 1 si difiere

simulador.html es un derivado: cada bloque <script> contiene exactamente el
código de una capa. Los .js de capa son la fuente; nunca se edita el HTML a
mano. La herramienta usa sólo la biblioteca estándar de Python y no forma
parte del producto, que sigue siendo un único archivo sin dependencias.
"""
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(RAIZ, "simulador.html")
CAPAS = ["capa1-red.js", "capa2-motor.js", "capa3-escenarios.js", "capa4-ui.js", "capa5-autotest.js"]


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
            raise SystemExit("No se encontró el bloque de " + capa + " en simulador.html "
                             "(se busca por su primera línea: " + primera[:60] + ").")
        inicio += len("<script>\n")
        fin = html.index("</script>", inicio)
        html = html[:inicio] + codigo.rstrip("\n") + "\n\n" + html[fin:]
    return html


def main():
    verificar = "--verificar" in sys.argv[1:]
    actual = leer(HTML)
    nuevo = ensamblar(actual)
    if verificar:
        if nuevo != actual:
            print("simulador.html NO coincide con los archivos de capa. Corré: python3 herramientas/ensamblar.py")
            return 1
        print("simulador.html coincide con las cinco capas.")
        return 0
    if nuevo == actual:
        print("simulador.html ya estaba al día.")
        return 0
    with open(HTML, "w", encoding="utf-8", newline="") as f:
        f.write(nuevo)
    print("simulador.html reensamblado a partir de las cinco capas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
