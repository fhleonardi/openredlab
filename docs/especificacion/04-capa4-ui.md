# CAPA 4 — `UI`: interfaz

> Pegá antes el documento **BASE**. Implementá **solamente esta capa**.
>
> **Ya existen las capas 1, 2 y 3**, cargadas antes que ésta: los objetos globales `Red`, `Motor` y `Escenarios`, con las firmas del §5 del BASE. **No recalcules nada que esas capas ya devuelvan.** En particular: el panel de cálculo pinta lo que devuelve `Red.desglose()`, el recorrido del ping pinta `resultado.pasos`, y el informe de verificación pinta lo que devuelve `Escenarios`. Esta capa dibuja; no piensa.

---

## Qué entregás

Un archivo `capa4-ui.js` con el objeto global `UI`, que implementa las firmas del §5 del BASE, más todo el CSS necesario inyectado desde el propio script (la capa 5 sólo va a incluir los cinco archivos y llamar a `UI.iniciar`).

---

## 1. Jerarquía visual — el lienzo manda

Esta aplicación se proyecta frente a un curso. La pantalla se reparte con ese criterio, no con el de mostrar todo a la vez.

- **El lienzo es el protagonista:** mínimo 55 % del ancho y 60 % del alto de la ventana en una pantalla de 1366 × 768.
- **Paleta izquierda:** ancho fijo de unos 180 px, colapsable a una columna de íconos.
- **Panel derecho de propiedades:** unos 320 px, colapsable.
- **Franja inferior: un solo panel con pestañas**, nunca varios paneles simultáneos. Pestañas: *Simulación*, *DHCP*, *Cálculo de subred*, *Ayuda*. Alto de unos 260 px, colapsable a una barra de 32 px. La pestaña activa por defecto es **Simulación**, no la calculadora.
- **Modo presentación:** un botón y la tecla `F` ocultan paleta y propiedades, dejan el lienzo a pantalla completa y agrandan los rótulos un 25 %.
  - *Decisión:* la franja inferior queda en una línea de estado y la vista se ajusta para que entre toda la topología. Los rótulos **no se achican con ese ajuste**: compensan el zoom y conservan su tamaño en pantalla (14 px como mínimo). Si dos se pisan, primero se achica el de más abajo hasta ese mínimo y sólo después se lo desplaza. Los nombres de los enlaces se ocultan, salvo los caídos.
- **Enlaces:** el color indica el estado y la forma el medio. Como verde y rojo se confunden con daltonismo, un enlace caído además se dibuja con guiones largos y su rótulo dice "(caído)"; por eso el wireless usa puntos redondos y no guiones.
- **Tamaños mínimos en el lienzo:** ícono 48 px, nombre 16 px, línea de IP/prefijo 14 px, grosor de enlace 3 px. Contraste de texto 4.5:1 como mínimo, en tema claro y oscuro.

**Errores de maquetación a evitar.** Son los que aparecen cuando esto se diseña como herramienta de red y no como herramienta de aula:

1. Cuatro paneles inferiores abiertos a la vez comprimiendo el lienzo.
2. Un cálculo de subred que es una calculadora independiente en lugar de estar atado al dispositivo seleccionado, y sin el binario en pantalla.
3. Cables que salen del cuerpo del ícono en vez de un puerto identificable.
4. Un botón global "Agregar dispositivo" compitiendo con la paleta, o un "Eliminar" global sin contexto.
5. El proceso DHCP dibujado como ilustración fija aparte, en vez de animado sobre la topología real.
6. Una consola que sólo sabe mostrar pings exitosos, sin lugar visible para el diagnóstico.

---

## 2. Paleta y colocación de dispositivos

Un ítem por tipo de dispositivo, con ícono SVG dibujado a mano —nada de imágenes externas— y el nombre debajo, bajo el título "Dispositivos". La paleta trae PC, Router, Firewall, Switch, Cámara, IoT, Punto de acceso e Internet; el router de 8 puertos y los switches de 24 y 48 se eligen con **Modelo**, en la pestaña Configuración del equipo ya colocado. En la pestaña Interfaces de un router o firewall, cada puerto tiene un selector de medio y un botón Quitar (deshabilitados si el puerto tiene cable), y al pie se agregan puertos nuevos, con el nombre del estilo del modelo. Al seleccionar un firewall, Propiedades abre en Filtrado. Más abajo, la herramienta de cable con su selector de tipo y la leyenda de los tres trazos.

**Dos formas de agregar un dispositivo, las dos obligatorias:**

- **Arrastrar y soltar** desde la paleta al lienzo, con vista previa semitransparente siguiendo al puntero. El dispositivo queda centrado donde se suelta.
- **Clic y colocar**: un clic en el ítem lo deja armado y resaltado; el siguiente clic en el lienzo lo coloca. `Esc` cancela.

La segunda forma no es un adorno. **La API de arrastre de HTML5 (`dragstart` / `dragover` / `drop`) no responde a eventos táctiles**, así que en una tablet o un celular la paleta quedaría inutilizable. Implementá el arrastre con **Pointer Events** (`pointerdown` / `pointermove` / `pointerup`), que cubre mouse, lápiz y touch con el mismo código.

Al soltar: nombre automático correlativo según el tipo (PC-1, PC-2, R1, SW1, CAM1, IOT1), interfaces por defecto según el §4 del BASE, posición ajustada a una grilla de 10 px, y desplazamiento automático si cae encima de otro dispositivo.

**Herramienta de cable:** se elige el tipo, se hace clic en un puerto libre del origen y luego en un puerto libre del destino. Mientras el cable está en curso, los puertos compatibles se resaltan y los incompatibles se atenúan; si se insiste sobre uno incompatible, se muestra `D03`. `Esc` cancela.

---

## 3. Lienzo y puertos

- SVG con zoom y paneo. Paneo con barra espaciadora + arrastre, con botón central del mouse, o arrastrando sobre el fondo vacío. **No dependas del clic derecho:** pisa el menú contextual del navegador.
- **Cada dispositivo dibuja sus puertos**, uno por interfaz, como pequeños cuadrados sobre su perímetro: contorno vacío si está libre, relleno si tiene cable, gris si la interfaz está deshabilitada. Al pasar el mouse, el puerto muestra su nombre (`g0/1`, `fa0/3`). **Los cables nacen y mueren en un puerto, nunca en el cuerpo del ícono**: un switch de ocho bocas tiene que verse que tiene ocho bocas.
- Bajo cada dispositivo, dos líneas: el nombre, y la IP con prefijo más el gateway cuando corresponda.
- Enlaces: verde si `up`, rojo si `down`. Trazo lleno para cobre, con brillo para fibra, punteado curvo para wireless.
- **Tooltip:** nombre, IP/prefijo y estado del dispositivo; para enlaces, tipo, velocidad, retardo, estado y —si es wireless— distancia actual contra máxima.

---

## 4. Panel derecho de propiedades

Pestañas: *Configuración*, *Interfaces*, *Rutas* (sólo router), *DHCP* (sólo router), *Estado*.

- **Configuración:** nombre, selector de interfaz, modo (estática / DHCP), dirección IP, máscara como lista desplegable de `/8` a `/30` mostrando decimal y prefijo juntos y sincronizada con el campo de IP, puerta de enlace predeterminada, DNS.
- **Interfaces:** una fila por interfaz con su medio, su enlace y un **conmutador de habilitada / deshabilitada**. Ese conmutador es el que produce `D01` y el que permite el experimento de romper la red a propósito: no puede faltar.
- **Rutas:** tabla editable de `{destino, máscara, siguiente salto}` con alta y baja, más la ruta por defecto.
- **Estado:** MAC, enlace conectado, tabla ARP, y las advertencias de `Motor.advertenciasDe` cuando el modo las permite.

Validá con `Red` mientras el usuario escribe: una máscara inválida o una IP mal formada se marcan en el acto.

---

## 5. El panel de cálculo de subred — el instrumento central

Este panel es la razón por la que este simulador existe y no alcanza con una calculadora online. **No es una calculadora suelta**: está atado al dispositivo seleccionado y se actualiza mientras se escribe.

**El binario en pantalla no es opcional.** Si el panel muestra dirección de red, broadcast y rango pero no muestra los 32 bits, el simulador no cumple su objetivo, por más completo que esté el resto.

Maqueta objetivo. Respetá el contenido y el orden; el estilo es libre:

```
┌─ Cálculo de subred — PC-01 ─────────────────────────────────┐
│                                                             │
│   IP        192.168.10.10        Prefijo  /24  ◄──●──►      │
│   Máscara   255.255.255.0                      /8 … /30     │
│                                                             │
│   IP        11000000.10101000.00001010│00001010             │
│             └──────── bits de red ────┤ bits de host        │
│   Máscara   11111111.11111111.11111111│00000000             │
│                                                             │
│   Dirección de red    192.168.10.0                          │
│   Broadcast           192.168.10.255                        │
│   Rango de hosts      192.168.10.1 – 192.168.10.254         │
│   Cantidad de hosts   254                                   │
│                                                             │
│   ─── ¿Tu gateway está en tu subred? ───────────────────    │
│   IP        192.168.10.10  AND  máscara  →  192.168.10.0    │
│   Gateway   192.168.10.1   AND  máscara  →  192.168.10.0    │
│   Coinciden: tu gateway pertenece a tu subred.              │
└─────────────────────────────────────────────────────────────┘
```

Todo esto ya viene calculado en `Red.desglose(ip, prefijo, gateway)`: usá `ipBinario`, `mascaraBinaria` y `cortePosicion` tal cual vienen. Los **bits de red y los de host van en colores distintos**, con la línea de corte marcada, y en fuente monoespaciada para que la máscara quede alineada carácter por carácter debajo de la IP. Al mover el prefijo, la línea se desplaza y los colores se reparten en vivo: **ese movimiento es la explicación**, así que tiene que ser inmediato.

---

## 6. Franja inferior

**Simulación** *(pestaña por defecto)*. Selectores de origen y destino, botón de ping, y la salida en dos mitades:

- A la izquierda, consola estilo terminal con el resultado, en el formato familiar de `ping` (`Respuesta desde 10.45.7.121: bytes=32 tiempo=1ms TTL=64`) y sus estadísticas finales.
- A la derecha, **el recorrido paso a paso**: un renglón por cada elemento de `resultado.pasos`, con su título, su detalle y una marca de correcto o fallido. **El paso que falló va resaltado.** Cuando el ping falla, debajo aparece el diagnóstico con su código, su explicación y su sugerencia, destacado visualmente.

Botones: copiar registro, exportar registro como texto, verificar. (El autotest vive en la capa 5, con un único botón en la franja.) **Verificar** hace lo que el escenario pida: el diseño VLSM si declara sectores (`Escenarios.verificarDesafio`, el botón dice "Verificar diseño VLSM" y se destaca), los objetivos de ping si los trae, o las dos cosas, en ese orden. En una red sin objetivos ni desafío, el botón dice "Verificar diseño" y revisa el diseño propio con `Escenarios.verificarDiseno`; el resultado deja cargar, opcionales, el bloque a repartir y los hosts de cada sector, que se guardan en `escenario.diseno`. El modo elegido en la barra no cuenta: el modo Desafío abre la pestaña Simulación, donde está el botón. Cada objetivo deja su línea en la consola, como un ping hecho a mano. El registro de eventos lleva marca de tiempo absoluta y relativa al inicio de la simulación (`+00:03.2`). Envolvé el acceso al portapapeles en `try/catch`: si falla, mostrá el texto en un `<textarea>` ya seleccionado.

**DHCP.** Configuración del rango, avisos de configuración (`Motor.avisosDhcp`) y tabla de concesiones otorgadas. La animación de los mensajes DORA ocurre **sobre los cables del lienzo**, rotulada, no como diagrama fijo dentro de la pestaña: la difusión avanza en ondas punteadas por el segmento (se detiene en los routers) y el camino al destino va en trazo firme; cliente en azul, servidor en violeta (el verde es el de los cables en up). Con movimiento reducido queda dibujado sólo el último mensaje. El resultado del pedido se guarda en el estado de la UI, así sobrevive a que el panel se vuelva a dibujar.

**Cálculo de subred.** El panel de la sección 5.

**Ayuda.** Conceptos clave y la lista de simplificaciones del §8 del BASE.

---

## 7. Animaciones

`UI.animarPing(resultado)` recorre `resultado.saltos` moviendo un punto a lo largo de cada enlace. Velocidad configurable (lenta, normal, rápida), **cancelable**, y nunca bloqueante: nada de `while` con espera activa. Si el ping falla, la animación se detiene en el salto donde falló y ese punto queda marcado.

Las peticiones ARP se animan por difusión hacia todos los equipos del segmento: ver eso *es* entender qué es un dominio de broadcast.

---

## 8. Controles generales

- Deshacer y rehacer con **Ctrl+Z / Ctrl+Y** (y `Cmd` en Mac), al menos para agregar y borrar dispositivos y enlaces.
- Atajos: `Supr` borra lo seleccionado, `Esc` cancela la herramienta de cable o la colocación en curso, `F` alterna el modo presentación.
- Barra superior del lienzo: deshacer, rehacer, alejar / porcentaje / acercar, ajustar a la ventana.
- Encabezado con las pestañas de modo: *Topología*, *Subredes*, *Desafío*, *Docente*. **Cambiar de pestaña cambia el modo, nunca la topología cargada.** Los avisos preventivos de la pestaña Estado (`Motor.advertenciasDe`) se apagan en modo docente y en cualquier laboratorio (una red con objetivos), sea cual sea el modo: encontrar las fallas plantadas es el ejercicio.
- Menú de topologías de ejemplo, tomado de `Escenarios.EJEMPLOS`, mostrando nombre y descripción.
- Importar arrastrando un archivo `.json` sobre el lienzo, y por selector de archivo.
- Autoguardado en `localStorage` cada 30 segundos y al cerrar la pestaña, envuelto en `try/catch`: si el navegador lo bloquea, la aplicación sigue andando y avisa una sola vez. Un lienzo vacío no se guarda, para no pisar lo anterior.
- Lo que abre el usuario —un ejemplo, un archivo importado o el trabajo recuperado— aparece **ajustado a la vista**, como con el botón Ajustar. La recarga interna que hace el Autotest para devolver la red no mueve la vista.
- Al abrir, el lienzo vacío dice cómo empezar y, si hay trabajo guardado, ofrece **Recuperar el trabajo anterior** o **Descartar**. No se carga solo: en una PC compartida del laboratorio, el siguiente no tiene por qué ver la red del anterior.
- Tema claro y oscuro con un conmutador.

---

## Formato de la respuesta

1. Tres o cuatro líneas: qué implementaste y qué decisiones de diseño tomaste.
2. El archivo `capa4-ui.js` completo, en un solo bloque, con el CSS incluido.
3. Si te faltó alguna función de `Red`, `Motor` o `Escenarios`, decilo acá en vez de improvisarla.

Código comentado en español, legibilidad sobre concisión. Sin `TODO`, sin funciones vacías, sin código elidido.
