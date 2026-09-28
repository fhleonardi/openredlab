# CAPA 5 — Ensamblado y autotest

> Pegá antes el documento **BASE**. Esta es la última capa.
>
> **Ya existen las capas 1 a 4**: `capa1-red.js`, `capa2-motor.js`, `capa3-escenarios.js` y `capa4-ui.js`, con los objetos globales `Red`, `Motor`, `Escenarios` y `UI`. Esta capa **no reescribe ninguna de ellas**.

---

## Qué entregás

Dos cosas:

1. **`simulador.html`** — el archivo final, autocontenido, que incluye las cuatro capas y arranca la aplicación.
2. **`Autotest`** — el objeto que corre los criterios de aceptación y muestra el informe.

---

## 1. El archivo final

Estructura exacta:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Simulador de Redes — Sistemas Operativos y Redes, Unidad 9</title>
  <style> /* sólo el reset mínimo; el resto del CSS lo inyecta la capa 4 */ </style>
</head>
<body>
  <div id="app"></div>

  <script> /* ——— capa1-red.js, pegada tal cual ——— */ </script>
  <script> /* ——— capa2-motor.js, pegada tal cual ——— */ </script>
  <script> /* ——— capa3-escenarios.js, pegada tal cual ——— */ </script>
  <script> /* ——— capa4-ui.js, pegada tal cual ——— */ </script>
  <script> /* ——— capa5: Autotest y arranque ——— */ </script>
</body>
</html>
```

Reglas del ensamblado:

- **Las cuatro capas se pegan sin tocarlas.** No las reescribas, no las "mejores", no las reordenes por dentro. Si una capa tiene un error, decilo al final en vez de parchearla acá por tu cuenta.
- El orden de los `<script>` importa: cada capa depende de las anteriores.
- Ninguna referencia externa: ni CDN, ni fuentes remotas, ni imágenes. El archivo abre con doble clic, sin servidor y sin conexión, y **no hace ninguna petición de red**.
- El arranque carga la topología `complejo` de `Escenarios.EJEMPLOS` y llama a `UI.iniciar(document.getElementById('app'), topologia)`.

Si el archivo completo no entra en una sola respuesta, **no lo entregues cortado**: devolvé únicamente el bloque de la capa 5 más instrucciones precisas de dónde pegar cada archivo, y decilo desde el principio.

---

## 2. `Autotest.correr()`

Un botón en la franja inferior ejecuta `Autotest.correr()` y muestra el informe en pantalla: cuántos criterios pasan, cuáles fallan y con qué detalle. Corre **en pocos segundos y sin animaciones** — desactivá las animaciones durante el autotest y restauralas al terminar.

Empieza por encadenar las autopruebas de las capas: `Red.autopruebas()`, `Motor.autopruebas()` y `Escenarios.autopruebas()`, sumando sus resultados al informe. Después, estos dieciséis criterios:

| # | Criterio | Cómo se verifica |
|---|---|---|
| 1 | El archivo no hace ninguna petición de red | No hay `fetch`, `XMLHttpRequest`, `import()` ni etiquetas `src`/`href` externas en el documento |
| 2 | La topología `complejo` permite un ping exitoso de punta a punta | `Motor.ping` de la PC de Administración al servidor devuelve `exito: true` |
| 3 | Cambiar la máscara de un PC de `/27` a `/28` rompe el ping al gateway con `D09` | Mutar la topología en memoria y verificar el código |
| 4 | Deshabilitar una interfaz del router produce `D01` | Ídem |
| 5 | Borrar una ruta de retorno produce `D12`, no `D11` | Ídem, y comprobar que el código no sea `D11` |
| 6 | Dos PC en el mismo switch con subredes distintas producen `D15` | Ídem |
| 7 | `Red.desglose` coincide con el cálculo hecho a mano | Comparar contra valores literales de la topología de referencia |
| 8 | DHCP entrega una dirección del rango configurado y devuelve los cuatro mensajes DORA | `Motor.dhcpSolicitar` |
| 9 | Exportar e importar reproduce el mismo estado | `Escenarios.exportar` → `importar` → comparación profunda |
| 10 | Un JSON con sintaxis rota devuelve error y no cuelga la aplicación | `Escenarios.importar("{roto")` |
| 11 | El export "alumno" no contiene el array `fallas` y trae las fallas aplicadas | `Escenarios.exportarParaAlumno` sobre `complejo-roto` |
| 12 | El modo desafío detecta un solapamiento y una subred desalineada | `Escenarios.verificarDesafio` con un diseño defectuoso armado a propósito |
| 13 | El panel de cálculo muestra los 32 bits de IP y máscara, con bits de red y de host diferenciados, y el bloque del `AND` del gateway | Inspeccionar el DOM del panel después de seleccionar un dispositivo |
| 14 | La franja inferior es un único panel con pestañas, con *Simulación* activa por defecto, y el lienzo conserva al menos el 55 % del ancho | Medir `getBoundingClientRect` del lienzo contra el ancho de la ventana |
| 15 | Los cables terminan en puertos dibujados sobre el perímetro, no en el centro del ícono | Verificar que los extremos de cada `<line>`/`<path>` de enlace coincidan con las coordenadas de un puerto |
| 16 | No queda ningún `TODO` ni texto de relleno, y la interfaz está en español | Buscar `TODO`, `lorem`, `FIXME` en el documento |

Cada resultado: `{ n, criterio, pasa, detalle }`. Los criterios que fallan se muestran primero, en rojo, con el detalle de qué se esperaba y qué se obtuvo.

Los criterios que mutan la topología trabajan sobre **una copia**, y al terminar el autotest se restaura la topología que el usuario tenía cargada. Nadie debería perder su trabajo por apretar el botón.

---

## 3. Verificación final antes de responder

Recorré esta lista vos mismo antes de entregar:

- Las cuatro capas están pegadas completas, sin recortes ni elipsis.
- No hay ninguna referencia externa en todo el archivo.
- `Autotest.correr()` existe, está cableado a un botón visible y no rompe el estado del usuario.
- El archivo abre y muestra la topología `complejo` sin errores en la consola del navegador.
- Todo el texto visible está en español.

---

## Formato de la respuesta

1. Tres o cuatro líneas: qué ensamblaste y si detectaste algún problema en las capas anteriores.
2. El bloque de la capa 5 (`Autotest` y arranque), completo.
3. El `simulador.html` final, completo, si entra; si no entra, la instrucción exacta de armado.
4. La salida esperada de `Autotest.correr()` con todo funcionando.
5. Una lista de lo que quedó fuera respecto de la especificación, y por qué.
