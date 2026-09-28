# PARCHES — correcciones sobre el simulador ya construido

> Dos parches independientes. **Cada uno se pide en su propio turno**, precedido del documento **BASE**.
>
> Regla común a los dos: **no regeneres el archivo entero.** Devolvé únicamente las funciones que cambian, con su nombre y su ubicación, para reemplazarlas a mano. Si una corrección obliga a tocar más de tres funciones, decilo antes de escribir código y esperá confirmación.

---

# PARCHE 1 — El medio inalámbrico es compartido, no punto a punto

**Capas afectadas:** 2 (`Motor`) y 3 (`Escenarios`). También cambia una regla del contrato: anotala.

## Qué está mal

La implementación actual trata un enlace inalámbrico igual que un cable: **una interfaz sólo puede participar en un enlace**. Eso vuelve imposible un segmento Wi-Fi con más de un cliente, que es justamente lo que hay en la topología de ejemplo.

Evidencia concreta en la topología `complejo`:

- El único enlace inalámbrico va de `pc-wifi:wlan0` a `iot1:wlan0`, directo entre dos clientes.
- La interfaz `r1:wlan0` quedó sin dirección IP.
- Los dos equipos del sector tienen `gateway 10.45.7.1`, que **no existe en ningún dispositivo de la topología**.
- Resultado: `Motor.ping('pc-wifi', '10.45.7.122')` devuelve `D10` — "nadie responde al ARP del gateway".
- Al intentar agregar un segundo enlace sobre `pc-wifi:wlan0` para conectarlo al router, `Escenarios.validarTopologia` lo rechaza: *"La interfaz pc-wifi:wlan0 participa en dos enlaces"*.

La regla es correcta para cobre y fibra, y equivocada para radio. Un enlace inalámbrico **es** un medio compartido: eso no es una simplificación que convenga hacer, es el concepto que hay que enseñar.

## Qué cambiar

**1. La regla de validación, sólo para wireless.** Una interfaz de medio `ethernet` o `fibra` sigue admitiendo un único enlace. Una interfaz de medio `wireless` admite **varios enlaces simultáneos**: cada uno representa un cliente asociado a esa celda. El mensaje de error de las otras dos se mantiene tal cual.

**2. El reenvío en `Motor`.** Cuando una trama sale por una interfaz inalámbrica, alcanza **a todos los dispositivos enlazados a esa interfaz**, no a uno solo. En la práctica, una interfaz wireless con N enlaces se comporta como un segmento de difusión: el ARP llega a todos los asociados, y el reenvío unicast va al que tenga la MAC de destino.

Esto tiene una consecuencia didáctica que conviene que quede visible: dos clientes asociados a la misma celda están **en el mismo dominio de broadcast**, así que se ven entre sí sin pasar por el router, exactamente como dos equipos en el mismo switch. Si podés, decilo en el `detalle` del paso correspondiente del recorrido.

**3. `D17` pasa a evaluarse por enlace**, no por interfaz: cada cliente tiene su propia distancia al equipo que sostiene la celda, y uno puede quedar fuera de alcance mientras los demás siguen asociados.

**4. La topología `complejo` de `Escenarios.EJEMPLOS`.** Reemplazá el enlace `l-wifi` por dos enlaces inalámbricos que salgan de la misma interfaz del router:

```jsonc
// r1:wlan0 pasa a tener dirección — es el gateway del sector Wi-Fi
{ "id": "wlan0", "nombre": "wlan0", "medio": "wireless", "habilitada": true,
  "modo": "estatico", "ip": "10.45.7.1", "prefijo": 26, "mac": "<la que ya tenía>" }

// y dos enlaces sobre esa misma interfaz
{ "id": "l-wifi-pc",  "a": {"dispositivo":"r1","interfaz":"wlan0"},
                      "b": {"dispositivo":"pc-wifi","interfaz":"wlan0"},
  "tipo": "wireless", "estado": "up", "velocidadMbps": 54, "retardoMs": 3 }
{ "id": "l-wifi-iot", "a": {"dispositivo":"r1","interfaz":"wlan0"},
                      "b": {"dispositivo":"iot1","interfaz":"wlan0"},
  "tipo": "wireless", "estado": "up", "velocidadMbps": 54, "retardoMs": 3 }
```

Ubicá `r1` a una distancia de `pc-wifi` e `iot1` que quede dentro del umbral de alcance, y verificá que `R2` tenga ruta de vuelta hacia `10.45.7.0/26`: si falta, el ping de ida va a funcionar y la respuesta no va a volver, y el diagnóstico correcto pasa a ser `D12`.

Hacé el mismo ajuste en la topología `complejo-roto` si comparte el bloque de enlaces.

## Qué NO cambiar

- La aritmética de la capa 1: no se toca nada.
- El resto del catálogo de diagnósticos.
- La regla de un solo enlace para cobre y fibra.
- Los tipos de falla soportados por `aplicarFallas`.
- Las firmas del §5 del BASE: ninguna cambia.

## Cómo se verifica

Agregá estas aserciones a `Escenarios.autopruebas()` y a `Motor.autopruebas()`, y comprobá que las existentes sigan pasando:

| Comprobación | Esperado |
|---|---|
| `validarTopologia` sobre `complejo` con los dos enlaces inalámbricos sobre `r1:wlan0` | sin errores |
| Dos enlaces de cobre sobre la misma interfaz ethernet | sigue dando error |
| `Motor.ping('pc-wifi', '10.45.7.122')` | `exito: true` |
| `Motor.ping('iot1', '10.45.7.122')` | `exito: true` |
| `Motor.ping('pc-wifi', '10.45.7.20')` (al IoT, misma celda) | `exito: true`, sin pasar por el router |
| Deshabilitar `r1:wlan0` y pinguear desde `pc-wifi` | `D10`, no `D02` |
| Alejar `iot1` más allá del umbral y pinguear desde `pc-wifi` al IoT | `D17`, y `pc-wifi` sigue alcanzando el servidor |

## Formato de la respuesta

1. Dos o tres líneas sobre qué cambiaste.
2. **Sólo las funciones modificadas**, cada una con su nombre y en qué capa va, listas para reemplazar.
3. El bloque completo de la topología `complejo` actualizada.
4. Las aserciones nuevas.
5. Si algún cambio toca una firma del contrato, decilo explícitamente.

---

# PARCHE 2 — Legibilidad del lienzo

**Capa afectada:** 4 (`UI`). Nada más.

## Qué está mal

Proyectado en un aula, los rótulos del lienzo son ilegibles. Tres defectos concretos, verificados en la topología `complejo` a 1366 × 768:

1. **Los nombres de dispositivos vecinos se superponen.** "PC-Huéspedes" y "IOT-Huéspedes" se pisan; abajo, sus líneas de IP también: `10.45.7.10/26 gw 10.45.7.1` y `10.45.7.20/26 gw 10.45.7.1` quedan encimadas y no se lee ninguna de las dos.
2. **Los cuadraditos de puerto se dibujan encima del nombre.** En los switches se lee `SW-□□□in` en lugar de `SW-Admin`, `SW-C□□□ras` en lugar de `SW-Cámaras`. Los marcadores de puerto del borde inferior caen sobre la etiqueta.
3. **Los equipos están demasiado juntos** en las coordenadas de la topología de ejemplo, lo que agrava los dos problemas anteriores.

## Qué cambiar

**1. Orden de dibujado y reserva de espacio.** La etiqueta de cada dispositivo se dibuja **debajo de todos sus puertos**, con una separación vertical explícita: los puertos ocupan el perímetro del ícono, y el nombre arranca por debajo del borde inferior más el alto del marcador de puerto más unos 6 px. Ningún puerto puede caer sobre texto.

**2. Fondo de la etiqueta.** Cada línea de rótulo lleva detrás un rectángulo del color de fondo del lienzo, con opacidad alta y unos 3 px de margen. Así, si dos equipos quedan cerca, el texto del que está delante sigue leyéndose en vez de mezclarse. El rectángulo se dimensiona con el ancho real del texto.

**3. Etiquetas más compactas.** La segunda línea hoy dice `10.45.7.10/26 gw 10.45.7.1`, que es larga y se solapa con la del vecino. Partila en dos líneas cortas:

```
PC-Huéspedes
10.45.7.10/26
gw 10.45.7.1
```

Si el dispositivo no tiene IP, la segunda línea dice `sin IP` y no hay tercera.

**4. Detección de superposición.** Al terminar de dibujar, recorré las cajas de texto y, cuando dos se superponen, desplazá la etiqueta del dispositivo de más abajo lo necesario para separarlas, o reducí su tipografía un escalón sin bajar del mínimo de 14 px. Basta con una pasada simple: no hace falta un algoritmo de posicionamiento sofisticado.

**5. Separación en la topología de ejemplo.** Reacomodá las coordenadas `x` e `y` de `complejo` para que ningún par de dispositivos quede a menos de 180 px de distancia horizontal si están en la misma franja vertical. Mantené la lectura por sectores: el Wi-Fi arriba, Administración y cámaras en el medio, servidores y el enlace entre routers a la derecha.

**6. Paneles que se cortan.** La columna izquierda y el panel derecho se recortan cuando el contenido excede el alto disponible: el botón "Colapsar" de la paleta y el campo DNS del panel de configuración quedan fuera de vista. Dales `overflow-y: auto` con su propia barra de desplazamiento.

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
2. **Sólo las funciones de `UI` modificadas**, con su nombre, listas para reemplazar.
3. Las reglas CSS nuevas o modificadas, por separado.
4. El bloque de coordenadas actualizado de la topología `complejo`, si lo tocaste.
