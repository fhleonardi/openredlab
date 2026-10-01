# BASE — Simulador de redes para el aula

> **Este documento se pega siempre, al principio de cada pedido**, seguido del documento de la capa que toca. Solo. Nunca pidas dos capas en el mismo turno.
>
> Materia: Sistemas Operativos y Redes — Tecnicatura Superior en Análisis y Desarrollo de Software, 2.º año. Unidad 9: direccionamiento IP, máscaras y subnetting.

---

## 1. Qué estamos construyendo

Un **simulador de redes para usar en clase**, inspirado en Cisco Packet Tracer pero mucho más chico y con otro foco: no reproducir protocolos con fidelidad, sino **hacer visible por qué una red no funciona**.

Objetivo pedagógico — que un estudiante de segundo año pueda:

1. Configurar IP, máscara y gateway y comprobar el efecto de cada decisión.
2. Entender que el sistema operativo decide a dónde mandar un paquete comparando `IP AND máscara` de origen y destino.
3. Diagnosticar una red rota identificando la causa concreta, no sólo constatando que el ping falla.
4. Diseñar un esquema de subnetting con VLSM y validarlo contra una topología.

**Criterio rector:** ante cualquier disyuntiva entre realismo técnico y claridad didáctica, gana la claridad. Pero nunca al precio de enseñar algo falso: si se simplifica, la aplicación lo dice en pantalla.

---

## 2. Arquitectura: cinco capas que se concatenan

El producto final es **un único archivo `.html` autocontenido**, pero no se genera de una vez. Se construye en cinco capas independientes que después se pegan una debajo de la otra dentro del mismo archivo:

| Capa | Archivo | Expone | Depende de |
|---|---|---|---|
| 1 | `capa1-red.js` | `Red` | nada |
| 2 | `capa2-motor.js` | `Motor` | `Red` |
| 3 | `capa3-escenarios.js` | `Escenarios` | `Red`, `Motor` |
| 4 | `capa4-ui.js` | `UI` | las tres anteriores |
| 5 | `simulador.html` | ensamblado + `Autotest` | todas |

**Cada capa se genera en su propio turno y nunca reescribe el código de otra.** Por eso los contratos de §4 son obligatorios: una capa llama a la anterior sin haber visto su implementación. Si te falta una función que creés que debería existir, **no la inventes en tu capa**: usá las del contrato y señalá el faltante al final de tu respuesta.

Las capas 1, 2 y 3 son JavaScript puro sin DOM: no tocan `document`, no dibujan nada, no dependen del navegador. Eso las hace auditables y testeables por separado.

---

## 3. Restricciones no negociables

- **Sin dependencias externas de ningún tipo**: ni npm, ni build, ni frameworks, ni CDN, ni fuentes remotas, ni imágenes externas. El archivo final abre con doble clic, sin servidor y sin conexión, y no hace ninguna petición de red.
- **JavaScript vanilla.** Para el lienzo, SVG (no `<canvas>`).
- **Idioma: español rioplatense** en todo — interfaz, mensajes, comentarios del código, nombres de variables. Terminología de cátedra: "máscara de subred", "dirección de red", "broadcast", "puerta de enlace predeterminada", "tabla de rutas". Sin emojis.
- Debe funcionar igual proyectado en un aula, dentro de una VM Ubuntu sin conexión, y en el navegador de un celular. Mouse y touch.
- **Rendimiento objetivo:** fluido con 20 dispositivos y 40 enlaces. No optimices para más.
- Toda API del navegador que pueda fallar (`localStorage`, portapapeles) va envuelta en `try/catch` con alternativa funcional.
- **Nunca entregues código elidido, `TODO`, funciones vacías ni "el resto es análogo".** Si no entra, recortá funcionalidad y decilo al final.

---

## 4. Modelo de datos — el contrato de la topología

Todas las capas operan sobre este objeto. El JSON exportado es exactamente este objeto serializado.

```jsonc
{
  "version": 1,
  "nombre": "Topología de ejemplo",
  "dispositivos": [
    {
      "id": "pc1",
      "tipo": "pc",                    // pc | switch-l2 | router | camara | iot | ap
      "nombre": "PC-Admin",
      "x": 160, "y": 240,
      "encendido": true,
      "interfaces": [
        {
          "id": "eth0",
          "nombre": "eth0",
          "medio": "ethernet",         // ethernet | fibra | wireless
          // "modoRadio": "cliente",   // ap | cliente | bridge — sólo en medio wireless
          "habilitada": true,
          "modo": "estatico",          // estatico | dhcp
          "ip": "10.45.7.66",
          "prefijo": 27,               // FUENTE DE VERDAD; la máscara decimal se deriva
          "mac": "02:00:00:00:01:01"
        }
      ],
      "gateway": "10.45.7.65",         // en un router: ruta por defecto de último recurso
      "dns": "8.8.8.8",
      "rutas": [],                     // sólo router: [{destino, prefijo, siguienteSalto}]
      "dhcp": null                     // sólo router: {habilitado, desde, hasta, prefijo, gateway}
    }
  ],
  "enlaces": [
    {
      "id": "l1",
      "a": { "dispositivo": "pc1", "interfaz": "eth0" },
      "b": { "dispositivo": "sw1", "interfaz": "fa0/1" },
      "tipo": "ethernet",              // ethernet | fibra | wireless
      "estado": "up",                  // up | down
      "velocidadMbps": 100,
      "retardoMs": 1
    }
  ],
  "escenario": null                    // ver capa 3
}
```

Reglas:

- **El prefijo CIDR es la fuente de verdad.** La máscara decimal siempre se deriva de él.
- Los `id` de dispositivos son únicos en toda la topología; los `id` de interfaces, únicos dentro de su dispositivo.
- Las MAC se generan de forma **determinística** a partir del id del dispositivo y del índice de la interfaz, para que un mismo JSON produzca siempre las mismas MAC: la pantalla del docente y la del alumno tienen que coincidir.
- Un enlace sólo existe entre interfaces de medios compatibles. Las de cobre y fibra admiten **un solo enlace**. Las inalámbricas dependen de su `modoRadio`:

| `modoRadio` | Qué hace | Enlaces que admite |
|---|---|---|
| `ap` | Sostiene la celda. Es un puente entre el aire y el cable: **no enruta**. | varios, uno por cliente asociado |
| `cliente` | Se asocia a un AP. | exactamente uno, contra un `ap` |
| `bridge` | Enlace punto a punto que une dos segmentos a distancia. | exactamente uno, contra otro `bridge` |

  Un router con su `wlan0` en modo `ap` es un router inalámbrico: la celda es una red más del router. El alcance inalámbrico (D17) se evalúa por enlace.
- **Gateway de un router.** Cada router reenvía por su propia tabla de rutas (prefijo más largo). Si ninguna entrada coincide y el campo `gateway` tiene una dirección que cae en alguna de sus redes conectadas, se usa como ruta por defecto. Una ruta `0.0.0.0/0` explícita le gana.

**Interfaces por defecto según el tipo de dispositivo**, creadas automáticamente al agregarlo:

| Tipo | Interfaces | Nombres |
|---|---|---|
| `pc` | 1 ethernet + 1 wireless (deshabilitada de fábrica) | `eth0`, `wlan0` |
| `router` | 2 ethernet + 1 fibra + 1 wireless | `g0/0`, `g0/1`, `fib0`, `wlan0` |
| `switch-l2` | 8 ethernet + 1 fibra | `fa0/1` … `fa0/8`, `fib0` |
| `camara` | 1 ethernet + 1 wireless | `eth0`, `wlan0` |
| `iot` | 1 wireless | `wlan0` |
| `ap` | 1 wireless (modo `ap`) + 1 ethernet | `wlan0`, `eth0` |

**Modo de radio inicial** de la `wlan0` al agregar el equipo: `ap` en `ap` y `router`; `cliente` en `pc`, `camara` e `iot`. El modo `bridge` no es el valor inicial de nadie: se elige a mano. El punto de acceso es un dispositivo de capa 2, como el switch: hace puente entre `wlan0` y `eth0` y no tiene tabla de rutas.

El usuario habilita y deshabilita interfaces, pero no las agrega ni las quita: el hardware es fijo, como en un equipo real.

---

## 5. Contratos de las capas — API pública

Estas firmas son **obligatorias y no se cambian**. Una capa posterior las invoca sin haber visto el código de la anterior.

### Capa 1 — `Red` (aritmética de direccionamiento, sin DOM)

```js
Red.esIpValida(texto)              // -> boolean
Red.aNumero(ip)                    // "192.168.10.10" -> 3232238090
Red.aTexto(numero)                 // 3232238090 -> "192.168.10.10"
Red.aBinario(ip)                   // -> "11000000.10101000.00001010.00001010"
Red.prefijoAMascara(prefijo)       // 24 -> "255.255.255.0"
Red.mascaraAPrefijo(mascara)       // "255.255.255.0" -> 24 ; null si es inválida
Red.esMascaraValida(mascara)       // -> boolean (unos contiguos)
Red.tamanoBloque(prefijo)          // 27 -> 32
Red.direccionDeRed(ip, prefijo)    // -> "10.45.7.64"
Red.broadcast(ip, prefijo)         // -> "10.45.7.95"
Red.primerHost(ip, prefijo)        // null si prefijo >= 31
Red.ultimoHost(ip, prefijo)        // null si prefijo >= 31
Red.cantidadHosts(prefijo)         // 27 -> 30 ; 0 si prefijo >= 31
Red.rangoTexto(ip, prefijo)        // -> "10.45.7.65 – 10.45.7.94"
Red.mismaRed(ipA, ipB, prefijo)    // -> boolean
Red.esDireccionDeRed(ip, prefijo)  // -> boolean
Red.esBroadcast(ip, prefijo)       // -> boolean
Red.esAsignable(ip, prefijo)       // -> boolean (ni red ni broadcast)
Red.estaAlineada(red, prefijo)     // ¿arranca en múltiplo de su bloque?
Red.solapan(redA, prefA, redB, prefB)          // -> boolean
Red.clasificar(ip)                 // -> "broadcast-limitado" | "esta-red" | "loopback" | "apipa" | "privada"
                                   //    | "cgnat" | "multicast" | "reservada" | "publica" | "invalida"
                                   //    evaluados en ese orden (255.255.255.255 cae dentro de 240.0.0.0/4)
Red.and(ip, prefijo)               // -> { resultado, binarioIp, binarioMascara, binarioResultado }
Red.desglose(ip, prefijo, gateway) // -> objeto completo para el panel de cálculo (ver capa 1)
Red.autopruebas()                  // -> { total, pasadas, fallos: [{ nombre, esperado, obtenido }] }
```

### Capa 2 — `Motor` (simulación, sin DOM)

```js
Motor.crearEstado(topologia)       // -> estado con índices ARP, MAC y concesiones DHCP
Motor.ping(estado, idOrigen, destinoIp)
// -> {
//      exito: boolean,
//      pasos: [{ n, titulo, detalle, ok }],        // los 11 pasos del algoritmo
//      saltos: [{ dispositivo, interfaz }],
//      diagnostico: { codigo, titulo, explicacion, sugerencia } | null,
//      respuestas: [{ ttl, ms }]
//    }
Motor.diagnosticar(estado, idOrigen, destinoIp)  // mismo objeto diagnostico, sin animar
Motor.advertenciasDe(estado, idDispositivo)      // -> [{ codigo, titulo, explicacion, sugerencia }]
Motor.dhcpSolicitar(estado, idDispositivo, idInterfaz)
// -> { exito, mensajes: [{ tipo:"discover"|"offer"|"request"|"ack", origen, destino }],
//      ip, prefijo, gateway, diagnostico|null }
Motor.rutaElegida(estado, idRouter, destinoIp)   // -> ruta ganadora por prefijo más largo | null
Motor.tablaArp(estado, idDispositivo)            // -> [{ ip, mac, vence }]
Motor.tablaMac(estado, idSwitch)                 // -> [{ mac, puerto, vence }]
Motor.CATALOGO                                   // { D01: {titulo, explicacion, sugerencia}, … D23 }
// Un destino que no es una IPv4 válida no es un diagnóstico de red: Motor.ping devuelve
// exito: false, pasos: [] y diagnostico { codigo: "ENTRADA", titulo, explicacion, sugerencia }.
Motor.autopruebas()                              // mismo formato que Red.autopruebas()
```

### Capa 3 — `Escenarios` (persistencia, ejemplos, verificación; sin DOM)

```js
Escenarios.EJEMPLOS                 // [{ id, nombre, descripcion, topologia }]
Escenarios.validarTopologia(obj)    // -> { ok, errores: [{ campo, mensaje }] }
Escenarios.exportar(topologia)      // -> string JSON con sangría
Escenarios.importar(texto)          // -> { ok, topologia|null, errores: [...] }
Escenarios.aplicarFallas(topologia) // -> copia con escenario.fallas aplicadas
Escenarios.exportarParaAlumno(topologia)  // fallas aplicadas + array fallas eliminado
Escenarios.verificarObjetivos(estado, objetivos)
// -> [{ objetivo, cumple, codigo|null }]  en el mismo orden del JSON
Escenarios.verificarDesafio(topologia, escenario)
// -> { resumen: { errores, advertencias }, porSector: [{ sector, ok, hallazgos: [...] }] }
Escenarios.autopruebas()
```

### Capa 4 — `UI` (todo el DOM vive acá)

```js
UI.iniciar(contenedor, topologiaInicial)
UI.cargarTopologia(topologia)
UI.topologiaActual()               // -> objeto topología con las posiciones actuales
UI.seleccionar(idDispositivo)
UI.animarPing(resultadoPing)       // consume la salida de Motor.ping
UI.animarDhcp(resultadoDhcp)       // consume la salida de Motor.dhcpSolicitar
UI.setModo(modo)                   // "topologia" | "subredes" | "desafio" | "docente"
UI.registrar(codigo, texto)        // agrega una línea al registro de eventos
```

### Capa 5 — `Autotest`

```js
Autotest.correr()   // -> { total, pasadas, resultados: [{ n, criterio, pasa, detalle }] }
```

---

## 6. Catálogo de diagnósticos D01–D23

Lo implementa la capa 2 en `Motor.CATALOGO` y lo usan todas las demás. Cada entrada tiene **título corto, explicación de una o dos líneas en lenguaje de aula, y sugerencia concreta de qué revisar**.

| Código | Causa |
|---|---|
| D01 | Interfaz administrativamente deshabilitada |
| D02 | Enlace caído o cable desconectado |
| D03 | Medios incompatibles (fibra a puerto ethernet, wireless sin radio) |
| D04 | Sin dirección IP configurada |
| D05 | Máscara inválida (unos no contiguos) |
| D06 | La IP asignada es la dirección de red o la de broadcast de su subred |
| D07 | IP duplicada en el mismo segmento |
| D08 | Destino en otra subred y sin puerta de enlace configurada |
| D09 | La puerta de enlace queda fuera de la subred del host |
| D10 | La puerta de enlace no responde ARP |
| D11 | El router no tiene ruta hacia la red destino ni ruta por defecto |
| D12 | Falta la ruta de retorno: el eco llega pero la respuesta no vuelve |
| D13 | Destino apagado o con la interfaz deshabilitada (sólo cuando existe un equipo con esa IP) |
| D14 | Máscaras distintas en el mismo segmento |
| D15 | Mismo switch, subredes distintas: un switch no enruta |
| D16 | DHCP sin servidor o sin direcciones libres |
| D17 | Fuera del alcance del enlace inalámbrico |
| D18 | Modos inalámbricos incompatibles (por ejemplo, cliente contra cliente) |
| D19 | Punto de acceso apagado o con la interfaz inalámbrica caída |
| D20 | Entrega directa y nadie responde el ARP (no hay equipo con esa IP, o está desconectado) |
| D21 | El destino es la dirección de broadcast de la subred del origen |
| D22 | Hay ruta, pero el siguiente salto no es alcanzable |
| D23 | Se agotó el TTL: bucle de enrutamiento (la explicación incluye el recorrido real) |

`D06`, `D07`, `D09`, `D14` y `D15` se detectan **también al momento de configurar**, vía `Motor.advertenciasDe`, sin necesidad de hacer ping.

> **Salvedad importante:** esas advertencias preventivas quedan **desactivadas en modo docente**. Si la aplicación señala el problema apenas el alumno abre el panel, el laboratorio de diagnóstico pierde su sentido: el objetivo es que el alumno lo descubra.

---

## 7. Topología de ejemplo de referencia

La usan la capa 3 (como ejemplo cargable) y la capa 5 (como sujeto del autotest). Bloque base `10.45.7.0/24`:

| Sector | Dispositivos | Subred | Prefijo | Gateway |
|---|---|---|---|---|
| Wi-Fi de huéspedes | 1 PC + 1 IoT asociados al AP wireless de R1 | `10.45.7.0` | /26 | `10.45.7.1` |
| Administración | 1 PC sobre switch L2, ethernet | `10.45.7.64` | /27 | `10.45.7.65` |
| Cámaras | 1 cámara IP sobre switch L2 | `10.45.7.96` | /28 | `10.45.7.97` |
| Servidores | 1 PC (haciendo de servidor) sobre switch L2 | `10.45.7.120` | /29 | `10.45.7.121` |
| Enlace R1 ↔ R2 | fibra | `10.45.7.128` | /30 | — |

Convención: el gateway es siempre la **primera dirección asignable** de cada subred. Al menos un router con dos interfaces, un switch L2, y los tres tipos de enlace en uso.

### 7.2 Escenario de desafío VLSM

El modo desafío verifica **lo que el alumno configuró en los equipos**, no lo que declara el enunciado:

```jsonc
"escenario": {
  "modo": "desafio",
  "bloqueBase": "10.45.7.0/24",
  "requerimientos": [
    { "sector": "Wi-Fi de huéspedes", "hosts": 60, "dispositivos": ["pc-wifi", "iot1", "r1:wlan0"] },
    { "sector": "Enlace R1 — R2",     "hosts": 2,  "dispositivos": ["r1:fib0", "r2:fib0"] }
  ]
}
```

- Cada entrada de `dispositivos` es un equipo (`"pc-wifi"`, que aporta su primera interfaz habilitada con IP) o una interfaz (`"r1:wlan0"`). La segunda forma es necesaria para los routers, que pertenecen a varios sectores, y para los enlaces punto a punto.
- La subred del sector es IP AND máscara de la primera entrada con dirección. Como esa cuenta siempre da una red alineada, la alineación se evalúa sobre la subred que el alumno pensó: la interfaz del router del sector es, por convención, la primera dirección asignable.
- El informe dice qué está mal y por qué, nunca cuál sería la dirección correcta.

---

## 8. Fuera de alcance

No se implementa, y la aplicación lo aclara en su ayuda: STP y prevención de bucles, enrutamiento dinámico (OSPF, BGP, RIP), VLANs y switch L3, NAT, HTTP, fragmentación, IPv6, control de flujo y ventana TCP, cifrado y TLS, QoS real, 802.1X, y cálculo de radiofrecuencia. El modelo inalámbrico es una abstracción por distancia.
