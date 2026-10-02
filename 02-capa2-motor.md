# CAPA 2 — `Motor`: simulación y diagnóstico

> Pegá antes el documento **BASE**. Implementá **solamente esta capa**. No escribas nada de interfaz, no toques el DOM.
>
> **Ya existe la capa 1**, cargada antes que ésta, con el objeto global `Red` y todas las firmas del §5 del BASE. Usala: no reimplementes aritmética de direccionamiento. Si te falta una función de `Red`, usá las que hay y señalá el faltante al final.

---

## Qué entregás

Un archivo `capa2-motor.js` con el objeto global `Motor`, que implementa exactamente las firmas del §5 del BASE, más el catálogo completo D01–D17 y su bloque de autopruebas.

Esta capa es el corazón didáctico del simulador. **Lo que se enseña no es que el ping ande: es por qué no anda.** Un motor que devuelve `true` o `false` no sirve para nada acá.

---

## El algoritmo de envío — los once pasos

`Motor.ping(estado, idOrigen, destinoIp)` devuelve un array `pasos` con **un renglón por cada paso ejecutado**, en orden, con su resultado. Ese array es lo que la capa 4 va a pintar al costado de la consola, y es el contenido que el alumno tiene que leer. No lo resumas.

Para un origen `A` que quiere alcanzar la IP `D`:

1. ¿`A` está encendido y su interfaz habilitada? Si no → `D01`.
2. ¿La interfaz de `A` tiene un enlace y ese enlace está `up`? Si no → `D02`.
3. ¿`A` tiene IP y máscara válidas? Si no → `D04` o `D05`.
4. Calcular `redA = ipA AND máscaraA` y `redD = D AND máscaraA`. **El detalle del paso incluye las dos operaciones en binario**, tomadas de `Red.and()`.
5. Si `redA == redD` → entrega directa: resolver `D` por ARP dentro del segmento.
6. Si `redA != redD` → ¿hay gateway configurado? Si no → `D08`.
7. ¿El gateway pertenece a `redA`? Si no → `D09`. El detalle del paso muestra el mismo AND del paso 4 aplicado al gateway.
8. Averiguar la MAC de la puerta de enlace por ARP. Si nadie responde → `D10`.
9. En el router: buscar en la tabla de rutas la **coincidencia más específica** (prefijo más largo), y usar la ruta por defecto sólo si no hay otra. Si no hay ninguna → `D11`.
10. Repetir desde el paso 4 en cada salto, decrementando TTL.
11. Al llegar al destino, **verificar que el destino pueda responder**, repitiendo el algoritmo en sentido inverso. Si el eco llega pero la respuesta no encuentra camino de vuelta → `D12`.

El paso 11 no es un detalle: `D12` es el diagnóstico más instructivo de todo el catálogo, porque explica el caso en que "el ping falla" aunque la ida esté perfecta. Asegurate de que no se confunda con `D11`: si el router de ida no tiene ruta, es `D11`; si la ida funciona y falla la vuelta, es `D12`.

Cada elemento de `pasos` tiene la forma `{ n, titulo, detalle, ok }`, donde `titulo` es corto y en infinitivo (`"Decidir si el destino está en la misma red"`) y `detalle` puede ser multilínea e incluir binario: la primera línea es la cuenta y la última, la conclusión. Los textos nombran a los equipos por su nombre visible, nunca por su id, y no mencionan códigos D: el código va aparte, en el diagnóstico.

---

## Comportamiento de los dispositivos

**Switch L2.** Aprende la MAC de origen en el puerto de entrada y la guarda con marca de tiempo. Reenvía por el puerto de la MAC de destino; si no la conoce, inunda por todos los puertos excepto el de entrada. **El switch no mira direcciones IP**, y el paso correspondiente tiene que decirlo con esas palabras: es la confusión más frecuente del curso.

**Router.** Tabla de rutas con entradas `{destino, prefijo, siguienteSalto}` más ruta por defecto (`0.0.0.0/0`). Selección por prefijo más largo. `Motor.rutaElegida` expone esa decisión para que la interfaz pueda mostrarla.

**ARP.** Tabla por dispositivo con entradas que expiran. Las peticiones son de difusión: el resultado de `ping` debe permitir a la capa 4 animarlas hacia todos los equipos del segmento, porque ver eso *es* entender qué es un dominio de broadcast.

**DHCP.** `Motor.dhcpSolicitar` devuelve los cuatro mensajes DORA en orden, cada uno con origen y destino, para que la capa 4 los anime sobre la topología real. El servidor lleva registro de las concesiones otorgadas. Si el rango se agotó o no hay servidor → `D16`, y el cliente se autoasigna una dirección `169.254.x.x`.

**Wireless.** Modelo simple por distancia euclidiana entre las coordenadas `x`/`y` de los dos extremos en el lienzo. Más allá de un umbral configurable (por defecto 250 unidades), el enlace se considera caído → `D17`. Sin potencia ni interferencia. Exponé la distancia calculada para que el tooltip pueda mostrar actual contra máxima.

---

## El catálogo `Motor.CATALOGO`

Un objeto con las diecisiete entradas del §6 del BASE. Cada una:

```js
D09: {
  titulo: "La puerta de enlace está fuera de tu subred",
  explicacion: (ctx) => `El gateway ${ctx.gateway} no pertenece a ${ctx.red}/${ctx.prefijo}. ` +
                        `Con esa máscara, tu equipo no puede alcanzarlo.`,
  sugerencia: "Revisá la máscara del equipo o la dirección del gateway: uno de los dos está mal."
}
```

La explicación es una función que recibe el contexto del fallo y devuelve el texto ya armado con las direcciones concretas. Nada de mensajes genéricos: el alumno tiene que leer *sus* direcciones, no un ejemplo.

Escribí las explicaciones en el registro de un docente hablándole a un estudiante de segundo año: una o dos líneas, sin jerga innecesaria, diciendo qué pasó y no qué código de error es. La sugerencia siempre apunta a **qué revisar**, no a cuál es la respuesta.

---

## `Motor.advertenciasDe(estado, idDispositivo)`

Detecta `D06`, `D07`, `D09`, `D14` y `D15` **sin hacer ping**, mirando sólo la configuración actual. La interfaz las muestra mientras el alumno configura.

Devolvé también un campo booleano que indique si la advertencia debe suprimirse en modo docente; o más simple: que la función acepte un segundo parámetro `{ modoDocente: true }` y devuelva un array vacío en ese caso. **En modo docente estas advertencias van apagadas**: si la aplicación señala el problema apenas el alumno abre el panel, el laboratorio de diagnóstico pierde su razón de ser.

---

## `Motor.autopruebas()`

Al menos **20 aserciones** que construyan topologías mínimas en memoria y verifiquen el diagnóstico devuelto. Mismo formato que `Red.autopruebas()`. Casos obligatorios:

| Escenario armado | Diagnóstico esperado |
|---|---|
| PC con `eth0` deshabilitada haciendo ping a su gateway | `D01` |
| PC y gateway correctos pero con el enlace en `down` | `D02` |
| PC con IP `10.45.7.66/28` y gateway `10.45.7.65` | `D09` |
| PC sin gateway pingueando otra subred | `D08` |
| Dos PC en el mismo switch, `10.45.7.66/27` y `10.45.7.98/28` | `D15` |
| Dos PC en el mismo switch con `/24` y `/25` | `D14` |
| Router intermedio sin la ruta de vuelta, ida completa | `D12` |
| Router de ida sin ruta hacia la red destino | `D11` |
| PC configurada con `10.45.7.95/27` | `D06` |
| Dos equipos con la misma IP en el mismo segmento | `D07` |
| Ping válido de punta a punta entre dos subredes | `exito: true`, y `saltos.length` correcto |
| Router con ruta específica y ruta por defecto | `rutaElegida` devuelve la específica |
| DHCP con rango de dos direcciones, tercer cliente | `D16` |

La distinción `D11` contra `D12` es la que más cuesta implementar bien: probala en los dos sentidos.

---

## Formato de la respuesta

1. Tres o cuatro líneas: qué implementaste y qué decisiones tomaste.
2. El archivo `capa2-motor.js` completo, en un solo bloque.
3. La salida esperada de `Motor.autopruebas()`.
4. Si usaste alguna función de `Red` que no estaba en el contrato, o te faltó alguna, decilo acá.

Código comentado en español. Legibilidad sobre concisión: este motor se explica en clase.
