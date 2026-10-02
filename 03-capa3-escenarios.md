# CAPA 3 — `Escenarios`: persistencia, ejemplos y verificación

> Pegá antes el documento **BASE**. Implementá **solamente esta capa**. Sin DOM.
>
> **Ya existen las capas 1 y 2**, cargadas antes que ésta: los objetos globales `Red` y `Motor`, con las firmas del §5 del BASE. Usalas.

---

## Qué entregás

Un archivo `capa3-escenarios.js` con el objeto global `Escenarios`, que implementa las firmas del §5 del BASE, las tres topologías de ejemplo, y su bloque de autopruebas.

---

## Validación e importación

`Escenarios.validarTopologia(obj)` revisa, y devuelve **todos** los errores encontrados, no sólo el primero:

- `version` presente y soportada.
- `id` de dispositivo únicos en toda la topología; `id` de interfaz únicos dentro de su dispositivo. El mensaje nombra el id duplicado.
- Tipo de dispositivo reconocido, y su juego de interfaces coherente con la tabla del §4 del BASE.
- Toda IP presente es sintácticamente válida y todo prefijo está entre 0 y 32.
- Toda máscara es válida (`Red.esMascaraValida`).
- Cada extremo de enlace apunta a un dispositivo y una interfaz que existen.
- Ninguna interfaz participa en dos enlaces.
- Los medios de los dos extremos son compatibles con el `tipo` del enlace.

`Escenarios.importar(texto)` primero parsea con `JSON.parse` dentro de un `try/catch` —un archivo con sintaxis rota devuelve `{ ok: false }` con un mensaje claro, **nunca lanza ni deja la aplicación colgada**— y después valida el esquema. La topología anterior queda intacta si la importación falla.

`Escenarios.exportar` devuelve JSON con sangría de dos espacios, legible para que un docente pueda editarlo a mano.

---

## Modo docente: los dos formatos de exportación

Éste es el punto crítico de la capa. **Si las fallas viajan en el archivo que recibe el alumno, el alumno las lee.** No hay clave, parámetro de URL ni ofuscación que arregle eso: el archivo es texto plano. La única protección real es no incluirlas.

Por eso hay dos exportaciones distintas:

- `Escenarios.exportar(topologia)` — **archivo del docente**. Conserva `escenario.fallas` y `escenario.objetivos`. Es el archivo de trabajo del profesor y no se distribuye.
- `Escenarios.exportarParaAlumno(topologia)` — **archivo del alumno**. Aplica las fallas sobre las configuraciones de los dispositivos, **elimina el array `fallas`** y conserva sólo `objetivos`. El resultado es una topología que simplemente viene mal configurada, igual que una red real: no hay nada que espiar.

`Escenarios.aplicarFallas(topologia)` devuelve una copia con las fallas aplicadas, sin mutar el original. Tipos de falla a soportar:

```jsonc
{ "tipo": "mascara-incorrecta",    "dispositivo": "pc2", "interfaz": "eth0", "prefijo": 28 }
{ "tipo": "interfaz-deshabilitada","dispositivo": "r1",  "interfaz": "g0/1" }
{ "tipo": "ruta-faltante",         "dispositivo": "r2",  "destino": "10.45.7.120", "prefijo": 29 }
{ "tipo": "ip-duplicada",          "dispositivo": "cam1","copiarDe": "pc1" }
{ "tipo": "gateway-incorrecto",    "dispositivo": "pc1", "gateway": "10.45.7.200" }
{ "tipo": "enlace-caido",          "enlace": "l3" }
```

`Escenarios.verificarObjetivos(estado, objetivos)` corre cada objetivo con `Motor.ping` y devuelve los resultados **en el mismo orden del JSON**, cada uno con `cumple` y, cuando falla, el `codigo` de diagnóstico que lo impide. **Nunca menciona las fallas plantadas**: el informe dice qué objetivo no se cumple, no qué se rompió.

```jsonc
"objetivos": [
  { "tipo": "ping", "origen": "pc1",  "destino": "10.45.7.121", "esperado": "exito" },
  { "tipo": "ping", "origen": "iot1", "destino": "10.45.7.121", "esperado": "falla" }
]
```

Un objetivo con `esperado: "falla"` se cumple cuando el ping efectivamente falla: sirve para pedir que algo quede aislado.

---

## Modo desafío: verificación de un diseño VLSM

`Escenarios.verificarDesafio(topologia, escenario)` recibe el bloque base y los requerimientos por sector, y devuelve un informe con **resumen global** primero y después **sector por sector**:

```js
{
  resumen: { errores: 2, advertencias: 1 },
  porSector: [
    { sector: "Wi-Fi de huéspedes", ok: false, hallazgos: [
        { nivel: "error", mensaje: "La subred no está alineada: … empezaría en 10.45.7.50, que no es múltiplo de 32 (el tamaño de un bloque /27)." },
        { nivel: "error", mensaje: "Se superpone con la subred de Administración, 10.45.7.64/27: comparten direcciones." }
    ]},
    { sector: "Servidores", ok: true, hallazgos: [] }
  ]
}
```

Comprobaciones, en este orden:

1. Cada subred cae dentro del bloque base asignado.
2. Ninguna subred se solapa con otra (`Red.solapan`).
3. Cada subred arranca en un múltiplo de su propio tamaño de bloque (`Red.estaAlineada`).
4. El prefijo alcanza para la cantidad de hosts pedida.
5. Cada equipo del sector tiene una IP dentro del rango asignable de su subred: ni la de red, ni la de broadcast.
6. El gateway declarado para el sector está dentro de esa subred.
7. **Advertencia, no error**, si el desperdicio supera el 60 % del bloque asignado.

El informe dice **qué está mal y por qué, sin dar la respuesta correcta**. "Empezaría en 10.45.7.50, que no es múltiplo de 32" enseña; "debería ser 10.45.7.64" resuelve el ejercicio por el alumno.

---

## `Escenarios.EJEMPLOS` — tres topologías

Cada una con `id`, `nombre`, `descripcion` corta para el menú, y `topologia` completa y coherente:

1. **`basica`** — "Dos PC y un switch. Para practicar direccionamiento básico." Una sola subred `192.168.1.0/24`, dos PC y un switch L2. Es la topología con la que se abre la primera clase.
2. **`dos-subredes`** — "Dos subredes y un router. Para ver el papel de la puerta de enlace." Dos switches, dos PC por lado, un router con dos interfaces. `192.168.1.0/25` y `192.168.1.128/25`.
3. **`complejo`** — "Complejo turístico con cinco sectores. Caso completo de VLSM." Exactamente la topología del §7 del BASE, con su direccionamiento resuelto.

Las tres tienen que pasar `validarTopologia` sin errores, y en las tres el ping entre equipos de la misma subred tiene que funcionar de entrada.

Incluí además un cuarto ejemplo, `complejo-roto`, que es `complejo` con un `escenario` de modo docente cargado con tres fallas y dos objetivos. Sirve de plantilla para que el profesor arme los suyos.

---

## `Escenarios.autopruebas()`

Al menos **15 aserciones**. Obligatorias:

| Caso | Esperado |
|---|---|
| `validarTopologia` sobre las cuatro topologías de ejemplo | sin errores |
| Topología con dos dispositivos de igual `id` | error que nombra el id |
| Topología con una interfaz en dos enlaces | error |
| Enlace de fibra entre dos interfaces ethernet | error de medios |
| `importar("{ esto no es json")` | `{ ok: false }` con mensaje, sin excepción |
| `exportar` y volver a `importar` la topología `complejo` | objeto equivalente al original |
| `exportarParaAlumno` sobre `complejo-roto` | el JSON resultante **no contiene la clave `fallas`** |
| `exportarParaAlumno` sobre `complejo-roto` | las configuraciones ya vienen con las fallas aplicadas |
| `aplicarFallas` | no muta la topología original |
| `verificarObjetivos` sobre `complejo-roto` sin reparar | al menos un objetivo no cumplido, con su código |
| `verificarObjetivos` sobre `complejo` sano | todos cumplidos |
| `verificarDesafio` con una subred desalineada | un hallazgo de nivel error mencionando la alineación |
| `verificarDesafio` con dos subredes solapadas | un hallazgo de error por solapamiento en ambos sectores |
| `verificarDesafio` con un diseño correcto | `resumen.errores === 0` |

---

## Formato de la respuesta

1. Tres o cuatro líneas: qué implementaste y qué decisiones tomaste.
2. El archivo `capa3-escenarios.js` completo, en un solo bloque.
3. La salida esperada de `Escenarios.autopruebas()`.
4. Si te faltó alguna función de `Red` o de `Motor`, decilo acá.

Código comentado en español, legibilidad sobre concisión.
