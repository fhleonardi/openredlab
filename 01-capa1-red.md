# CAPA 1 — `Red`: aritmética de direccionamiento

> Pegá antes el documento **BASE**. Implementá **solamente esta capa**. No escribas nada de interfaz, no toques el DOM, no adelantes las capas siguientes.

---

## Qué entregás

Un único archivo `capa1-red.js` con un objeto global `Red` que implementa **exactamente** las firmas del §5 del BASE, ni una más ni una menos, más su bloque de autopruebas.

Esta capa es la más importante del proyecto y la más corta. Un botón feo se ve a simple vista; un broadcast mal calculado no, y se propaga en silencio a todo lo demás. Por eso va sola, sin nada que la distraiga, y con pruebas propias.

---

## Reglas de implementación

- **Trabajá con enteros de 32 bits sin signo.** En JavaScript, los operadores bit a bit devuelven enteros con signo: `~mascara` y los desplazamientos pueden dar negativos. Normalizá siempre con `>>> 0`. Este es el error más frecuente de esta capa y el que arruina el cálculo del broadcast en prefijos cortos.
- Ninguna función lanza excepciones por entrada inválida: devuelven `null` o `false` según corresponda, documentado en un comentario.
- `Red.aBinario` devuelve siempre los cuatro octetos con **ocho bits cada uno**, ceros a la izquierda incluidos, separados por puntos.
- `Red.esMascaraValida` acepta sólo secuencias de unos contiguos seguidas de ceros. `255.255.255.100` es inválida (`01100100`: los unos no son contiguos y arranca en cero). `0.0.0.0` y `255.255.255.255` son válidas.
- `Red.cantidadHosts` devuelve `2^(32-prefijo) − 2`, y `0` para `/31` y `/32`. `primerHost` y `ultimoHost` devuelven `null` en esos casos.
- `Red.estaAlineada(red, prefijo)` verifica que la dirección sea múltiplo de su propio tamaño de bloque: `10.45.7.132` con `/28` es `false`, con `/30` es `true`. Esta función es la que después detecta el error clásico de VLSM.
- `Red.clasificar` distingue: `10.0.0.0/8`, `172.16.0.0/12` y `192.168.0.0/16` como `"privada"`; `127.0.0.0/8` como `"loopback"`; `169.254.0.0/16` como `"apipa"`; el resto de lo válido como `"publica"`. Atención al límite exacto del rango privado clase B: `172.15.x.x` y `172.32.x.x` son **públicas**.

---

## `Red.desglose(ip, prefijo, gateway)` — la función que alimenta el panel didáctico

Es la más importante de la capa, porque de ella depende que el simulador enseñe algo. Devuelve **todo lo que el panel de cálculo necesita ya calculado**, para que la capa 4 sólo tenga que pintarlo:

```js
{
  ip: "192.168.10.10",
  prefijo: 24,
  mascaraDecimal: "255.255.255.0",
  ipBinario: "11000000.10101000.00001010.00001010",
  mascaraBinaria: "11111111.11111111.11111111.00000000",
  bitsRed: 24,                    // cuántos bits de la izquierda son de red
  bitsHost: 8,
  cortePosicion: 26,              // índice del carácter donde va la línea de corte
                                  // en la cadena binaria (contando los puntos)
  direccionDeRed: "192.168.10.0",
  broadcast: "192.168.10.255",
  primerHost: "192.168.10.1",
  ultimoHost: "192.168.10.254",
  rangoTexto: "192.168.10.1 – 192.168.10.254",
  cantidadHosts: 254,
  ipEsAsignable: true,
  advertencia: null,              // o "Esta IP es la dirección de red de su subred"
  gateway: {                      // null si no se pasó gateway
    ip: "192.168.10.1",
    andIp: "192.168.10.0",
    andGateway: "192.168.10.0",
    coinciden: true,
    veredicto: "Tu gateway pertenece a tu subred."
  }
}
```

`cortePosicion` existe para que la capa 4 pueda dibujar la línea vertical entre los bits de red y los de host sin tener que recalcular nada: es el índice del carácter en `ipBinario` donde termina la porción de red, contando los puntos separadores. Verificalo con un caso de prefijo que no caiga en un límite de octeto, por ejemplo `/27`.

El veredicto del gateway va en texto llano, en una de estas dos formas exactas:
- `"Tu gateway pertenece a tu subred."`
- `"Tu gateway NO pertenece a tu subred."`

---

## `Red.autopruebas()`

Un bloque de al menos **35 aserciones** que se ejecuta llamando a la función y devuelve `{ total, pasadas, fallos }`. No usa ninguna biblioteca: una función `comparar(nombre, obtenido, esperado)` alcanza.

Casos que tienen que estar sí o sí, porque son los que se rompen:

| Caso | Esperado |
|---|---|
| `direccionDeRed("172.16.34.9", 20)` | `"172.16.32.0"` — el prefijo corta en el tercer octeto |
| `broadcast("172.16.34.9", 20)` | `"172.16.47.255"` |
| `cantidadHosts(20)` | `4094` |
| `broadcast("10.0.5.77", 16)` | `"10.0.255.255"` |
| `cantidadHosts(8)` | `16777214` — acá explota el signo si no normalizaste |
| `direccionDeRed("200.45.12.201", 27)` | `"200.45.12.192"` |
| `broadcast("200.45.12.201", 27)` | `"200.45.12.223"` |
| `esMascaraValida("255.255.255.100")` | `false` |
| `esMascaraValida("255.255.255.252")` | `true` |
| `mascaraAPrefijo("255.255.248.0")` | `21` |
| `esAsignable("172.16.5.95", 27)` | `false` — es el broadcast de `172.16.5.64/27` |
| `esAsignable("10.0.0.5", 30)` | `true` — la red es `10.0.0.4/30` |
| `mismaRed("192.168.1.50", "192.168.1.200", 26)` | `false` |
| `mismaRed("192.168.5.130", "192.168.5.129", 25)` | `true` |
| `estaAlineada("10.45.7.132", 28)` | `false` |
| `estaAlineada("10.45.7.144", 28)` | `true` |
| `estaAlineada("10.45.7.132", 30)` | `true` |
| `solapan("10.45.7.0", 26, "10.45.7.50", 27)` | `true` |
| `solapan("10.45.7.64", 27, "10.45.7.96", 28)` | `false` |
| `clasificar("172.15.3.1")` | `"publica"` |
| `clasificar("172.20.8.4")` | `"privada"` |
| `clasificar("169.254.10.3")` | `"apipa"` |
| `cantidadHosts(31)` | `0` |
| `primerHost("10.0.0.0", 31)` | `null` |
| `aBinario("10.0.45.200")` | `"00001010.00000000.00101101.11001000"` |

Completá hasta 35 con los casos que te parezcan necesarios para cubrir el resto de las funciones, incluido `desglose` con un prefijo que corte dentro de un octeto.

---

## Formato de la respuesta

1. Tres o cuatro líneas diciendo qué implementaste y qué decisiones tomaste.
2. El archivo `capa1-red.js` completo, en un solo bloque de código.
3. La salida esperada de `Red.autopruebas()` si todo está bien: `{ total: N, pasadas: N, fallos: [] }`.

Código comentado en español, con nombres de variables descriptivos. Este código lo va a leer un docente para explicarlo en clase y un alumno para modificarlo, así que priorizá legibilidad sobre concisión: preferible una función de diez líneas claras que una expresión de una línea que nadie entiende.
