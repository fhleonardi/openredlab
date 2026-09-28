# PARCHES — correcciones sobre el simulador ya construido

> Dos parches independientes. **Cada uno se pide en su propio turno**, precedido del documento **BASE**.
>
> Regla común a los dos: **no regeneres el archivo entero.** Devolvé únicamente las funciones que cambian, con su nombre y su ubicación, para reemplazarlas a mano. Si una corrección obliga a tocar más de tres funciones, decilo antes de escribir código y esperá confirmación.

---

# PARCHE 1 — Modos de radio y punto de acceso

**Capas afectadas:** 2 (`Motor`) y 3 (`Escenarios`). **Cambia el contrato del §4 del BASE**: anotá los cambios, están marcados abajo.

## Qué está mal

La implementación trata un enlace inalámbrico igual que un cable: una interfaz sólo puede participar en un enlace. Eso vuelve imposible una celda con más de un cliente, y además borra una distinción que en equipamiento real existe y que hay que enseñar.

Evidencia concreta en la topología `complejo`:

- El único enlace inalámbrico va de `pc-wifi:wlan0` a `iot1:wlan0`: **dos clientes asociados entre sí**, algo que en la realidad no ocurre.
- La interfaz `r1:wlan0` quedó sin dirección IP.
- Los dos equipos tienen `gateway 10.45.7.1`, que **no existe en ningún dispositivo**.
- `Motor.ping('pc-wifi', '10.45.7.122')` devuelve `D10`: nadie responde al ARP del gateway.
- Al intentar agregar un segundo enlace sobre `pc-wifi:wlan0`, `validarTopologia` lo rechaza: *"La interfaz participa en dos enlaces"*.

## El modelo correcto: modo de radio por interfaz

Una interfaz inalámbrica tiene un **modo**, igual que en cualquier equipo real. El campo nuevo es `modoRadio` y sólo existe en interfaces de medio `wireless`:

| `modoRadio` | Qué hace | Enlaces que admite |
|---|---|---|
| `ap` | Sostiene la celda. Los clientes se asocian a él. **Es un bridge entre el aire y el cable: no enruta.** | varios (uno por cliente asociado) |
| `cliente` | Se asocia a un AP. | exactamente uno, y el otro extremo debe estar en modo `ap` |
| `bridge` | Enlace punto a punto con otro equipo en modo `bridge`, uniendo dos segmentos a distancia. | exactamente uno, y el otro extremo debe estar en modo `bridge` |

Con esto la regla de validación deja de ser una excepción arbitraria y pasa a ser una consecuencia del modo. Las interfaces de cobre y fibra siguen admitiendo **un solo enlace**, sin cambios.

**Un router con su `wlan0` en modo `ap` es un router inalámbrico**: no hace falta un caso especial para eso.

## Cambios al contrato del §4 del BASE

**1. Nuevo campo en las interfaces inalámbricas:**

```jsonc
{ "id": "wlan0", "nombre": "wlan0", "medio": "wireless",
  "modoRadio": "ap",          // ap | cliente | bridge  — sólo en medio wireless
  "habilitada": true, "modo": "estatico", "ip": "10.45.7.1", "prefijo": 26, "mac": "..." }
```

**2. Nuevo tipo de dispositivo `ap`** (punto de acceso), con su ícono propio en la paleta:

| Tipo | Interfaces | Nombres |
|---|---|---|
| `ap` | 1 wireless (modo `ap`) + 1 ethernet | `wlan0`, `eth0` |

El punto de acceso **es un dispositivo de capa 2**, igual que el switch: hace bridge entre `wlan0` y `eth0`, aprende MAC por los dos lados, y **no enruta ni tiene tabla de rutas**. Puede tener una IP de gestión opcional, que no cambia su comportamiento de reenvío.

**3. Modo de radio por defecto según el tipo de dispositivo**, al agregarlo al lienzo:

| Tipo | `wlan0` arranca en |
|---|---|
| `ap` | `ap` |
| `router` | `ap` |
| `pc`, `camara`, `iot` | `cliente` |

El modo `bridge` no es el valor inicial de nadie: se elige a mano cuando se quiere armar un enlace entre dos puntos.

## Qué cambiar en `Motor`

**Reenvío del punto de acceso.** Igual que el switch L2, con la salvedad de que uno de sus puertos es el aire y tiene varios asociados. Una trama que entra por `eth0` sale hacia los clientes de la celda; una que entra por el aire sale por `eth0` y hacia los demás asociados. El broadcast llega a todos. **El AP no mira direcciones IP**, y conviene que el paso correspondiente del recorrido lo diga con esas palabras.

**Celda en modo `ap` sobre un router.** La celda es un segmento más de ese router: enruta entre ella y el resto de sus interfaces, igual que con cualquier interfaz cableada.

**Modo `bridge`.** Los dos extremos son el mismo segmento de capa 2: la trama pasa transparente, sin decrementar TTL y sin pasar por ninguna tabla de rutas.

**Consecuencia didáctica que conviene dejar visible:** dos clientes asociados a la misma celda están en el mismo dominio de broadcast y se ven entre sí **sin pasar por el router**, exactamente igual que dos equipos en el mismo switch.

**`D17` pasa a evaluarse por enlace**, no por interfaz: cada cliente tiene su propia distancia al AP, y uno puede quedar fuera de alcance mientras los demás siguen asociados.

## Diagnósticos nuevos y uno a extender

| Código | Causa | Ejemplo de mensaje |
|---|---|---|
| `D18` | Modos de radio incompatibles en los extremos del enlace | "PC-Huéspedes e IOT-Huéspedes están los dos en modo cliente. Dos clientes no se asocian entre sí: hace falta un punto de acceso." |
| `D19` | Un equipo en modo cliente sin ningún AP asociado o en alcance | "IOT-Huéspedes está en modo cliente pero no está asociado a ningún punto de acceso." |

Y **extendé `D15`** para que cubra también el aire. Hoy dice que un switch no enruta; tiene que decir lo mismo de un AP:

> "Los dos equipos cuelgan del mismo punto de acceso pero están en subredes distintas. Un AP no enruta: es un puente entre el aire y el cable. Necesitan un router."

Ese es el mismo error que el del switch, repetido en otro medio. Verlo dos veces es lo que lo fija.

## Qué cambiar en la topología `complejo`

Quedan los dos roles inalámbricos juntos, que es lo que hace valioso el ejemplo:

**Router inalámbrico — crea una subred nueva.** `r1:wlan0` pasa a modo `ap` con dirección `10.45.7.1/26`, y los dos equipos del sector Wi-Fi se asocian a ella:

```jsonc
// r1:wlan0
{ "id":"wlan0", "medio":"wireless", "modoRadio":"ap", "habilitada":true,
  "modo":"estatico", "ip":"10.45.7.1", "prefijo":26 }

// pc-wifi:wlan0 e iot1:wlan0 quedan en modoRadio "cliente"
{ "id":"l-wifi-pc",  "a":{"dispositivo":"r1","interfaz":"wlan0"},
                     "b":{"dispositivo":"pc-wifi","interfaz":"wlan0"},
  "tipo":"wireless", "estado":"up", "velocidadMbps":54, "retardoMs":3 }
{ "id":"l-wifi-iot", "a":{"dispositivo":"r1","interfaz":"wlan0"},
                     "b":{"dispositivo":"iot1","interfaz":"wlan0"},
  "tipo":"wireless", "estado":"up", "velocidadMbps":54, "retardoMs":3 }
```

Eliminá el enlace `l-wifi` anterior. Ubicá `r1` a una distancia de los dos clientes que quede dentro del umbral de alcance.

**Punto de acceso — extiende una subred que ya existe.** Agregá un AP colgado del switch de Administración y una notebook asociada a él, con dirección **del mismo `/27` de Administración**:

```jsonc
{ "id":"ap-admin", "tipo":"ap", "nombre":"AP-Admin", "encendido":true,
  "interfaces":[ {"id":"wlan0","medio":"wireless","modoRadio":"ap","habilitada":true},
                 {"id":"eth0","medio":"ethernet","habilitada":true} ] }
{ "id":"pc-movil", "tipo":"pc", "nombre":"Notebook-Admin", "gateway":"10.45.7.65",
  "interfaces":[ {"id":"eth0","medio":"ethernet","habilitada":false},
                 {"id":"wlan0","medio":"wireless","modoRadio":"cliente","habilitada":true,
                  "modo":"estatico","ip":"10.45.7.67","prefijo":27} ] }

{ "id":"l-ap-sw",  "a":{"dispositivo":"ap-admin","interfaz":"eth0"},
                   "b":{"dispositivo":"sw-admin","interfaz":"fa0/3"},
  "tipo":"ethernet", "estado":"up", "velocidadMbps":100, "retardoMs":1 }
{ "id":"l-ap-nb",  "a":{"dispositivo":"ap-admin","interfaz":"wlan0"},
                   "b":{"dispositivo":"pc-movil","interfaz":"wlan0"},
  "tipo":"wireless", "estado":"up", "velocidadMbps":54, "retardoMs":3 }
```

La diferencia entre los dos casos es exactamente lo que se quiere enseñar: **el router inalámbrico crea una subred nueva; el punto de acceso extiende al aire una subred que ya existe.**

Verificá que `R2` tenga ruta de vuelta hacia `10.45.7.0/26`. Si falta, el ping de ida va a funcionar y la respuesta no, y el diagnóstico correcto pasa a ser `D12`.

Hacé el mismo ajuste en `complejo-roto` si comparte el bloque de enlaces.

## Qué NO cambiar

- La capa 1: no se toca nada.
- La regla de un solo enlace para cobre y fibra.
- Los tipos de falla soportados por `aplicarFallas`.
- Las firmas del §5 del BASE: ninguna cambia.
- El panel de cálculo de subred.

## Cómo se verifica

Agregá estas aserciones a `Motor.autopruebas()` y `Escenarios.autopruebas()`, y comprobá que las existentes sigan pasando:

| Comprobación | Esperado |
|---|---|
| `validarTopologia` sobre `complejo` con AP, notebook y los dos clientes del router | sin errores |
| Dos enlaces de cobre sobre la misma interfaz ethernet | sigue dando error |
| Enlace entre dos interfaces en modo `cliente` | error de validación, y `D18` al pinguear |
| Enlace entre dos interfaces en modo `ap` | error de validación |
| `ping('pc-wifi', '10.45.7.122')` | `exito: true` |
| `ping('iot1', '10.45.7.122')` | `exito: true` |
| `ping('pc-wifi', '10.45.7.20')` | `exito: true`, **sin saltos por el router** |
| `ping('pc-movil', '10.45.7.66')` | `exito: true`, **sin saltos por el router** (misma subred, a través del AP y el switch) |
| `ping('pc-movil', '10.45.7.122')` | `exito: true`, pasando por R1 y R2 |
| Cambiar la IP de `pc-movil` a `10.45.7.10/26` y pinguear a `pc-admin` | `D15` con el texto extendido del AP |
| Deshabilitar `r1:wlan0` y pinguear desde `pc-wifi` | `D19` o `D10`, nunca `D02` |
| Alejar `iot1` más allá del umbral | `D17` en ese cliente, y `pc-wifi` sigue alcanzando el servidor |

## Formato de la respuesta

1. Dos o tres líneas sobre qué cambiaste.
2. **Sólo las funciones modificadas**, cada una con su nombre y la capa donde va.
3. El bloque completo de la topología `complejo` actualizada.
4. Las entradas nuevas del catálogo (`D18`, `D19`) y el texto extendido de `D15`.
5. Las aserciones nuevas.
6. La lista de cambios al contrato del §4, para que los anote en el BASE.

---

# PARCHE 2 — Legibilidad del lienzo

**Capa afectada:** 4 (`UI`). Nada más.

## Qué está mal

Proyectado en un aula, los rótulos del lienzo son ilegibles. Tres defectos concretos, verificados en la topología `complejo` a 1366 × 768:

1. **Los nombres de dispositivos vecinos se superponen.** "PC-Huéspedes" e "IOT-Huéspedes" se pisan; abajo, sus líneas de IP también: `10.45.7.10/26 gw 10.45.7.1` y `10.45.7.20/26 gw 10.45.7.1` quedan encimadas y no se lee ninguna de las dos.
2. **Los cuadraditos de puerto se dibujan encima del nombre.** En los switches se lee `SW-□□□in` en lugar de `SW-Admin`, `SW-C□□□ras` en lugar de `SW-Cámaras`. Los marcadores de puerto del borde inferior caen sobre la etiqueta.
3. **Los equipos están demasiado juntos** en las coordenadas de la topología de ejemplo, lo que agrava lo anterior.

## Qué cambiar

**1. Orden de dibujado y reserva de espacio.** La etiqueta se dibuja **debajo de todos los puertos**, con separación vertical explícita: los puertos ocupan el perímetro del ícono, y el nombre arranca por debajo del borde inferior más el alto del marcador más unos 6 px. Ningún puerto puede caer sobre texto.

**2. Fondo de la etiqueta.** Cada línea lleva detrás un rectángulo del color de fondo del lienzo, con opacidad alta y unos 3 px de margen, dimensionado con el ancho real del texto. Si dos equipos quedan cerca, el texto del que está delante sigue leyéndose.

**3. Etiquetas más compactas.** La segunda línea dice hoy `10.45.7.10/26 gw 10.45.7.1`, larga y solapable. Partila en dos líneas cortas:

```
PC-Huéspedes
10.45.7.10/26
gw 10.45.7.1
```

Si el dispositivo no tiene IP, la segunda línea dice `sin IP` y no hay tercera.

**4. Detección de superposición.** Al terminar de dibujar, recorré las cajas de texto y, cuando dos se superponen, desplazá la etiqueta del dispositivo de más abajo, o reducí su tipografía un escalón sin bajar del mínimo de 14 px. Una pasada simple alcanza.

**5. Separación en la topología de ejemplo.** Reacomodá las coordenadas para que ningún par de dispositivos quede a menos de 180 px de distancia horizontal si están en la misma franja vertical. Mantené la lectura por sectores: el Wi-Fi arriba, Administración y cámaras en el medio, servidores y el enlace entre routers a la derecha. Si ya aplicaste el Parche 1, ubicá también el AP y la notebook.

**6. Paneles que se cortan.** La columna izquierda y el panel derecho se recortan cuando el contenido excede el alto disponible: el botón "Colapsar" de la paleta y el campo DNS del panel de configuración quedan fuera de vista. Dales `overflow-y: auto` con su propia barra de desplazamiento.

**7. Si ya aplicaste el Parche 1:** el ícono del punto de acceso va en la paleta, y el modo de radio de cada interfaz inalámbrica se elige desde la pestaña *Interfaces* del panel derecho. En el lienzo, el trazo punteado curvo del enlace inalámbrico sale del AP hacia cada cliente asociado.

## Qué NO cambiar

- La jerarquía de la §9.1: el lienzo conserva su 55 % de ancho mínimo, la franja inferior sigue siendo un solo panel con pestañas.
- El panel de cálculo de subred: quedó correcto y no se toca.
- Los puertos siguen dibujándose sobre el perímetro, con su estado visual y su nombre al pasar el mouse. El problema es dónde cae la etiqueta, no los puertos.
- Ninguna función de las capas 1, 2 o 3.

## Cómo se verifica

Abierto en 1366 × 768 con la topología `complejo` cargada:

| Comprobación | Esperado |
|---|---|
| Nombre de cada dispositivo | Legible completo, sin caracteres tapados por puertos |
| "PC-Huéspedes" e "IOT-Huéspedes" | Separados, las dos etiquetas legibles |
| Switches | Se lee `SW-Admin`, `SW-Cámaras`, `SW-Servidores` completos |
| Botón "Colapsar" de la paleta | Alcanzable, con desplazamiento si hace falta |
| Campo DNS del panel derecho | Alcanzable |
| Modo presentación (`F`) | Los rótulos crecen un 25 % y siguen sin superponerse |

## Formato de la respuesta

1. Dos o tres líneas sobre qué cambiaste.
2. **Sólo las funciones de `UI` modificadas**, con su nombre.
3. Las reglas CSS nuevas o modificadas, por separado.
4. El bloque de coordenadas actualizado de la topología `complejo`, si lo tocaste.
