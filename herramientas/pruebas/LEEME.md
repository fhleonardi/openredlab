# Pruebas del simulador

Scripts de verificación. Se corren desde la raíz del repo con Node (versión 22 o más nueva, por `fetch` y `WebSocket`). Las pruebas por CDP necesitan Google Chrome; si no está en la ruta habitual, indicarlo con la variable `CHROME_PATH`.

- `node herramientas/pruebas/correr.js`: autopruebas de las capas 1 a 3, en Node y sin UI (63 + 230 + 179 = 472). También sirve de módulo: `require('./correr.js')` devuelve `{Red, Motor, Escenarios}`.
- `node herramientas/pruebas/revisar.js [filtro]`: resume cada escenario de `escenarios/` (y de `escenarios-docente/`, si existe): validación, matriz de pings, objetivos, desafío, DHCP e ida y vuelta de exportar e importar. Sirve para detectar cambios de comportamiento comparando la salida con una línea base.
- `node herramientas/pruebas/diferencial.js [ref]`: compara el motor de una referencia de git (por defecto `main`) con el del disco: ping y Conectar TCP 80 desde cada equipo a cada IP de cada escenario. Lista cada caso que cambió.
- `node herramientas/pruebas/dos-sitios.js`: dos sitios unidos por internet (SRE-1031). La última línea, con el sitio B desconectado, tiene que dar Conectar en `false` con D34: el cruce por internet no llega al servidor.
- `node herramientas/pruebas/redireccion.js`: caso de SRE-1021, servidor publicado con una redirección de puertos en el router de borde.
- `node herramientas/pruebas/autotest-cdp.js [url] [carpeta-de-perfil]`: corre `Autotest.correr({tecnico:true})` en un Chrome headless propio. Sin argumentos usa el `index.html` del repo.
- `node herramientas/pruebas/verificar-registro.js`: comprueba en el navegador el aviso de registro truncado (más de 400 entradas).

## Regresión con revisar.js

La salida de `revisar.js` se guarda como línea base y se compara después de cada cambio:

    node herramientas/pruebas/revisar.js > base.txt
    # ... hacer el cambio ...
    node herramientas/pruebas/revisar.js > nuevo.txt && diff base.txt nuevo.txt

La línea base depende de qué escenarios hay en disco: si falta `escenarios-docente/`, la salida cambia. Guardar la base en el mismo equipo donde se compara.

## Autotest en el navegador

Abrir `index.html` y ejecutar `Autotest.correr({tecnico:true})` en la consola. Da 504/504: 472 pruebas internas de las capas 1 a 3 más 32 criterios.
