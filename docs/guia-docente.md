# OpenRedLab — Guía para docentes

Esta guía explica cómo usar OpenRedLab en clase, cómo armar laboratorios de diagnóstico y desafíos de diseño VLSM, y cómo son los archivos de escenario. La guía para los alumnos está en [guia-rapida-alumno.md](guia-rapida-alumno.md).

## 1. Usarlo en clase

**Dónde abrirlo.** En https://fhleonardi.github.io/openredlab/, o descargando `index.html` y abriéndolo con doble clic: no necesita instalación ni internet, así que funciona igual en un laboratorio sin conexión o en la máquina virtual de la cátedra.

**Los cuatro modos** (barra de arriba):

| Modo | Qué cambia |
|---|---|
| **Topología** | El modo normal: armar, configurar y probar. |
| **Subredes** | Abre directamente la pestaña Cálculo de subred, para trabajar el binario y el «AND». |
| **Desafío** | Abre la pestaña Simulación, donde está *Verificar diseño VLSM*. |
| **Docente** | Oculta los avisos de configuración y muestra el botón **Exportar para el alumno**. |

**Para proyectar.** La tecla **F** (o *Presentación*) oculta la paleta y las propiedades, agranda los rótulos y deja la franja de abajo en una línea. *Tema oscuro* ayuda con algunos proyectores. Al abrir un ejemplo o un archivo, la red aparece entera en pantalla.

**Para mostrar ideas.** En **Ejemplos…** hay redes listas: una básica, dos subredes con router, un complejo turístico completo, el mismo complejo con fallas, un desafío VLSM y un router de 8 puertos. Hacé un ping, mostrá el recorrido paso a paso y rompé algo a propósito (cambiá una máscara, borrá una ruta) para que vean el diagnóstico. El botón **Autotest** también sirve de demostración: recorre nueve situaciones típicas (máscara mal elegida, ruta de vuelta faltante, mismo switch con subredes distintas…) y explica qué debe pasar en cada una.

**Para la unidad de modelos de capas.** Cada paso del recorrido indica su capa (OSI, y TCP/IP al pasar el mouse). Después de un ping, **Cómo viaja el paquete** muestra las tramas tramo por tramo: en cada router cambian las MAC y baja el TTL, mientras el paquete IP conserva su origen y su destino; los switches pasan la trama sin cambiarla. **Ver los encabezados** muestra el encapsulamiento (trama ⊃ paquete IP ⊃ mensaje ICMP). Una buena pregunta para la clase: «¿con qué TTL llega la respuesta, y por qué?». En Cálculo de subred aparece también la clase de la IP frente al prefijo CIDR.

**Qué entregan los alumnos y cómo corregir.** La [guía del alumno](guia-rapida-alumno.md#qué-entregar) les pide capturas del recorrido, el registro de eventos (*Exportar registro*), su red corregida (*Exportar*, como `ApellidoNombre_lab.json`) y una línea por problema. Para corregir, abrí su `.json` con **Importar** (o arrastrándolo al lienzo) y apretá **Verificar**: en un laboratorio vas a ver qué objetivos cumple; en un desafío, el diseño sector por sector. El registro tiene la hora de cada acción, así que muestra cómo llegó a la solución.

## 2. Armar un laboratorio de diagnóstico

Un laboratorio es una red **sana** a la que se le plantan **fallas**, con **objetivos** que el alumno tiene que cumplir (por ejemplo, «la cámara llega al servidor»). Se arma en dos archivos: la versión **docente** (red sana + lista de fallas + objetivos), que guardás vos, y la versión del **alumno** (fallas aplicadas, sin la lista), que repartís.

> Hoy las fallas y los objetivos se cargan editando el archivo `.json` con un editor de texto. Está previsto agregar editores en pantalla para hacerlo sin tocar el archivo.

**Paso a paso:**

1. **Partí de una red que funcione.** La más cómoda es el ejemplo **Complejo roto (docente)**, que ya trae tres fallas y dos objetivos como modelo. También podés armar una red propia; comprobá con varios pings que todo llegue.
2. **Exportala** con el botón *Exportar*. Vas a obtener `topologia.json`.
3. **Editá el archivo**: en la sección `"escenario"`, escribí las fallas y los objetivos (el formato está en la [sección 4](#4-formato-de-los-archivos)). Cambiá también el `"nombre"` de la red: se usa para nombrar el archivo del alumno.
4. **Importalo** y apretá **Verificar**. Con la red sana, **todos los objetivos se tienen que cumplir**: si alguno falla, el problema es de la red de partida, no de las fallas.
5. **Pasá a modo Docente** y apretá **Exportar para el alumno**. Se descarga `<nombre-de-la-red>-ALUMNO.json`, con las fallas ya aplicadas y sin la lista.
6. **Comprobá la versión del alumno:** importala y apretá Verificar. Ahora los objetivos tienen que **fallar**, cada uno con el diagnóstico que esperabas.
7. **Repartí el archivo del alumno** y guardá el docente: es la solución.

**Recomendaciones:**

- **Una falla, un síntoma claro.** Las fallas que mejor funcionan son las que el recorrido explica: máscara incorrecta (D09 o D14), puerta de enlace incorrecta (D09 o D10), ruta faltante (D11 a la ida, D12 a la vuelta), IP duplicada (D07), interfaz deshabilitada (D01), cable caído (D02).
- **Combiná fallas que se tapan entre sí** para el nivel avanzado: hasta que no se arregla la primera, la segunda no aparece.
- **Exigí la causa cuando importa.** Un objetivo que espera una falla puede indicar el código: «el huésped *no* tiene que llegar al servidor, y tiene que ser por una regla de filtrado (D27)». Si falla por otra razón, no se cumple.
- **Los laboratorios no avisan.** En una red con objetivos, el simulador no muestra los avisos de configuración en ningún modo: encontrar la falla es el ejercicio. En una red común, en cambio, la pestaña Estado de cada equipo avisa los errores que detecta.

**Laboratorios incluidos.** En [`escenarios/`](../escenarios/) están las versiones del alumno de tres laboratorios sobre el complejo turístico: un problema, tres problemas y «el problema invisible». Las versiones docentes no se publican, para que los alumnos no tengan las soluciones a mano; si sos docente y las necesitás, pedíselas al autor ([fhleonardi en GitHub](https://github.com/fhleonardi)).

## 3. Armar un desafío de diseño VLSM

En un desafío, el alumno recibe una red **sin direccionar**, un **bloque** para repartir y los **sectores** con la cantidad de hosts de cada uno. Diseña el VLSM, configura los equipos y verifica.

**Paso a paso:**

1. Armá la red (o usá el ejemplo **Desafío VLSM (complejo)** como modelo) y **dejá los equipos sin IP**.
2. Exportala y, en `"escenario"`, escribí `"modo": "desafio"`, el `"bloqueBase"` y los `"requerimientos"`: un sector por red, con su nombre, los hosts que necesita y los equipos y puertos de router que le pertenecen (formato en la [sección 4](#4-formato-de-los-archivos)).
3. Importala y apretá **Verificar diseño VLSM**: con la red vacía, todos los sectores tienen que decir «Ningún equipo de este sector tiene IP todavía».
4. Repartí ese mismo archivo. Un desafío no lleva soluciones adentro.

**Qué controla el verificador**, sector por sector, sin decir nunca cuál sería la dirección correcta:

- que todos los equipos y puertos del sector tengan IP, en la misma subred;
- que la subred esté dentro del bloque y no se solape con la de otro sector;
- que esté alineada (que arranque en un múltiplo de su tamaño, tomando la puerta de enlace como primera dirección);
- que el prefijo alcance para los hosts pedidos;
- que ningún equipo tenga la dirección de red o de broadcast;
- que la puerta de enlace de cada equipo esté en su subred y sea la del router del sector;
- como advertencia, no como error, que la subred no desperdicie más del 60 % de sus direcciones.

**Sin archivo de desafío.** Un alumno también puede verificar una red que armó por su cuenta: el botón **Verificar diseño** detecta los sectores solo (cada puerto de router con lo que cuelga de sus switches) y hace los mismos controles. Si en el resultado carga los hosts de cada sector y el bloque, se suman los de capacidad. Sirve para ejercicios de enunciado en papel: el alumno resuelve a mano, lo arma y lo comprueba.

## 4. Formato de los archivos

Un escenario es el mismo `.json` que produce *Exportar*: la red (`dispositivos` y `enlaces`) más un objeto `"escenario"`. Las fallas, los objetivos y los sectores se refieren a los equipos por su **`id`** (no por el nombre que se ve en pantalla) y a los puertos por su nombre (`g0/0`, `eth0`, `ether2`…). Los `id` están en el mismo archivo exportado, en cada dispositivo y cada enlace.

### Laboratorio

```json
"escenario": {
  "modo": "docente",
  "fallas": [
    { "tipo": "gateway-incorrecto", "dispositivo": "pc-admin", "gateway": "10.45.7.200" },
    { "tipo": "ruta-faltante", "dispositivo": "r1", "destino": "10.45.7.120", "prefijo": 29 },
    { "tipo": "enlace-caido", "enlace": "l-srv-r2" }
  ],
  "objetivos": [
    { "tipo": "ping", "origen": "pc-admin", "destino": "10.45.7.122", "esperado": "exito" },
    { "tipo": "ping", "origen": "iot1", "destino": "10.45.7.122", "esperado": "exito" }
  ]
}
```

Es el escenario del ejemplo *Complejo roto*. Un objetivo también puede esperar una falla y exigir su causa, como en la práctica del Complejo Termal, donde los huéspedes tienen que quedar aislados por una regla del router:

```json
{ "tipo": "ping", "origen": "celular", "destino": "10.45.7.122", "esperado": "falla", "codigo": "D27",
  "descripcion": "Un huésped no tiene que llegar al servidor de reservas: lo frena una regla en R-Central, no la subred." }
```

**Fallas** (se aplican en orden al exportar para el alumno):

| `tipo` | Campos | Qué hace |
|---|---|---|
| `mascara-incorrecta` | `dispositivo`, `interfaz`, `prefijo` | Cambia el prefijo de ese puerto. |
| `gateway-incorrecto` | `dispositivo`, `gateway` | Cambia la puerta de enlace del equipo. |
| `ruta-faltante` | `dispositivo`, `destino`, `prefijo` | Borra esa ruta del router. |
| `ip-duplicada` | `dispositivo`, `copiarDe` | Le pone al equipo la IP de otro. |
| `interfaz-deshabilitada` | `dispositivo`, `interfaz` | Deshabilita ese puerto. |
| `enlace-caido` | `enlace` | Marca ese cable como caído. |

**Objetivos:**

| Campo | Valor |
|---|---|
| `tipo` | Siempre `"ping"`. |
| `origen` | `id` del equipo que hace el ping. |
| `destino` | IP (o nombre, como `google.com`) a la que se hace el ping. |
| `esperado` | `"exito"` si tiene que llegar, `"falla"` si no. |
| `codigo` | Opcional, con `"falla"`: el diagnóstico exigido (por ejemplo `"D27"`). |
| `descripcion` | Opcional: una frase para el alumno, que se muestra debajo del objetivo. |

### Desafío VLSM

```json
"escenario": {
  "modo": "desafio",
  "bloqueBase": "10.45.7.0/24",
  "requerimientos": [
    { "sector": "Wi-Fi de huéspedes", "hosts": 60, "dispositivos": ["pc-wifi", "iot1", "r1:wlan0"] },
    { "sector": "Administración", "hosts": 25, "dispositivos": ["pc-admin", "r1:g0/0"] },
    { "sector": "Enlace R1 — R2", "hosts": 2, "dispositivos": ["r1:fib0", "r2:fib0"] }
  ]
}
```

En `dispositivos`, un equipo se nombra por su `id` (se toma su primera interfaz con IP) y un puerto de router como `"id:puerto"`. Incluí siempre el puerto del router de cada sector: es la puerta de enlace, y el verificador lo usa como referencia para la alineación.
