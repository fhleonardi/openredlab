# OpenRedLab — Guía para docentes

Esta guía explica cómo usar OpenRedLab en clase, qué mostrar en cada unidad del programa, cómo armar laboratorios de diagnóstico y desafíos de diseño VLSM, y cómo son los archivos de escenario. La guía para los alumnos está en [guia-rapida-alumno.md](guia-rapida-alumno.md).

## 1. Usarlo en clase

**Dónde abrirlo.** En https://fhleonardi.github.io/openredlab/, o descargando `index.html` y abriéndolo con doble clic: no necesita instalación ni internet, así que funciona igual en un laboratorio sin conexión o en la máquina virtual de la cátedra.

**Los cuatro modos** (barra de arriba):

| Modo | Qué cambia |
|---|---|
| **Topología** | El modo normal: armar, configurar y probar. |
| **Subredes** | Abre directamente la pestaña Cálculo de subred, para trabajar el binario y el «AND». |
| **Desafío** | Abre la pestaña Simulación, donde está *Verificar diseño VLSM*. |
| **Docente** | Oculta los avisos de configuración, suma la pestaña **Laboratorio** (fallas, objetivos y sectores) y muestra el botón **Exportar para el alumno**. |

**Para proyectar.** La tecla **F** (o *Presentación*) oculta la paleta y las propiedades, agranda los rótulos y deja la franja de abajo en una línea. *Tema oscuro* ayuda con algunos proyectores. Al abrir un ejemplo o un archivo, la red aparece entera en pantalla.

**Los ejemplos.** En **Ejemplos…** hay catorce redes listas:

| Para | Ejemplos |
|---|---|
| Direccionamiento y subnetting | *Básica*, *Dos subredes*, *Complejo turístico*, *Complejo roto (docente)* (con fallas y objetivos), *Desafío VLSM (complejo)* y *Router de 8 puertos* |
| Topologías y dispositivos | *Topología en estrella*, *Bus (medio compartido con un hub)*, *Malla entre tres routers* y *Dos LAN unidas por una WAN* |
| Internet, NAT y servicios | *Oficina con DNS propio*, *Dos ISP: peering y tránsito*, *Dos sitios por internet* y *Servidor publicado con redirección de puertos* |

La forma más rápida de mostrar una idea es hacer un ping, mostrar el recorrido paso a paso y romper algo a propósito (cambiar una máscara, borrar una ruta, cortar un cable) para que vean el diagnóstico.

**El Autotest.** El botón **Autotest** también sirve de demostración: recorre diecisiete situaciones típicas (máscara mal elegida, ruta de vuelta faltante, mismo switch con subredes distintas, puerto cerrado, firewall con y sin estado, dos sitios por internet, servidor publicado…) y explica qué debe pasar en cada una.

**Qué entregan los alumnos y cómo corregir.** La [guía del alumno](guia-rapida-alumno.md#qué-entregar) les pide capturas del recorrido, el registro de eventos (*Exportar registro*), su red corregida (*Exportar*, como `ApellidoNombre_lab.json`) y una línea por problema. Para corregir, abrí su `.json` con **Importar** (o arrastrándolo al lienzo) y apretá **Verificar**: en un laboratorio vas a ver qué objetivos cumple; en un desafío, el diseño sector por sector. El registro anota algunos eventos del simulador, como cambios de la red y resultados de pruebas, con hora; no es un historial completo. Conserva como máximo las últimas 400 entradas y, si descartó anteriores, el archivo exportado lo indica.

## 2. Qué mostrar en cada unidad

| Unidad | Tema | Ejemplo | Falla para un laboratorio |
|---|---|---|---|
| 7 | Topologías y alcance | *Estrella*, *Bus*, *Malla*, *Dos LAN unidas por una WAN* | Cable caído (D02) |
| 7 | Dispositivos y dominios | Cualquiera, con el selector **Dominios** | Cambiar un switch por un hub |
| 8 | Modelos de capas y encapsulamiento | *Dos subredes*, *Complejo turístico* | — (se trabaja con *Cómo viaja el paquete*) |
| 9 | Direccionamiento, subnetting y VLSM | *Complejo turístico*, *Desafío VLSM (complejo)* | Máscara incorrecta, gateway incorrecto, ruta faltante, IP duplicada |
| 9 | Direcciones privadas y NAT | *Oficina con DNS propio* | Sin NAT (D28) |
| 9 | DNS | *Oficina con DNS propio* | DNS incorrecto (D29), registro borrado (D25) |
| 9 | Proveedores e interconexión | *Dos ISP: peering y tránsito* | Cable de peering caído |
| 9 | Dos sitios por internet | *Dos sitios por internet* | Cable del borde caído (D34) |
| 9 | Redirección de puertos | *Servidor publicado con redirección de puertos* | Sin redirección (D31) |
| 10 | Puertos, TCP y UDP | *Oficina con DNS propio* | Servicio detenido (D31) |
| 10 | Análisis de tráfico | *Oficina con DNS propio*, con la pestaña **Captura** | — |
| 11 | Firewalls | *Complejo turístico*, *Servidor publicado…* | Regla agregada (D27) |
| 11 | Calidad de servicio | Cualquiera, con la pérdida y el jitter de un cable | — |

### Unidad 7: topologías y dispositivos de red

**Topologías y alcance.** Los ejemplos de estrella, bus, malla y LAN-WAN sirven para comparar: en la estrella, un cable cortado deja afuera a un solo equipo; en el bus (un hub) todos comparten el medio; en la malla cada red llega a las otras por un enlace directo (con rutas estáticas, si se corta uno hay que cambiar la ruta a mano: la redundancia la aprovecha un protocolo de ruteo dinámico, que el simulador no tiene); y la WAN une dos LAN lejanas. La tarjeta *Topologías y alcance* de la Ayuda lo resume.

**Dispositivos y dominios.** Con el selector **Dominios** del lienzo se cuentan los dominios de colisión y de broadcast de cualquier red. Pasar un switch a *Hub de 8 puertos* (Configuración → Modelo) y ver cómo cambia la cuenta es un buen ejercicio: «¿cuántos dominios de colisión y de broadcast hay?» se responde a mano y se comprueba en pantalla. El recorrido de un ping por un hub dice que la trama se repite por todos los puertos.

### Unidad 8: modelos de capas

Cada paso del recorrido indica su capa (OSI, y TCP/IP al pasar el mouse). Después de un ping, **Cómo viaja el paquete** muestra las tramas tramo por tramo: en cada router cambian las MAC y baja el TTL, mientras el paquete IP conserva su origen y su destino; los switches pasan la trama sin cambiarla. **Ver los encabezados** muestra el encapsulamiento (trama ⊃ paquete IP ⊃ mensaje ICMP). Una buena pregunta para la clase: «¿con qué TTL llega la respuesta, y por qué?». En Cálculo de subred aparece también la clase de la IP frente al prefijo CIDR.

### Unidad 9: direccionamiento IP, internet y DNS

**Direccionamiento y VLSM.** La pestaña **Cálculo de subred** muestra el «AND» en binario, igual que el cálculo a mano, y el modo **Desafío** lleva a la verificación de un diseño VLSM (sección 4).

**Direcciones privadas y NAT.** Una red con la nube Internet y un router de borde sin NAT da D28: el pedido llega, pero la respuesta no puede volver a una IP privada. Al marcar NAT en el puerto que va a internet, el recorrido muestra *Traducir la dirección de origen (NAT)* y las tramas, el cambio de IP en ese salto. Sirve para un laboratorio de una sola falla: «la oficina no sale a internet». Un firewall nuevo trae NAT en wan, como los equipos reales.

**DNS.** El ejemplo **Oficina con DNS propio** tiene un servidor con la zona `oficina.local`. Un ping a `intranet.oficina.local` muestra la respuesta autoritativa (y el CNAME); uno a `google.com`, la consulta recursiva al servidor y las iterativas a la raíz, a .com y al autoritativo; repetido, la respuesta desde la caché. Fallas útiles para un laboratorio: poner como DNS de una PC la IP del router (D29), quitarle el NAT al router de borde (el servidor no llega a la raíz: D30), o preguntarle `www.oficina.local` a 8.8.8.8 (la raíz no conoce .local: D25). Los registros se cargan en la pestaña **DNS** del servidor, y con **Consultar DNS** (en Simulación) se ven los MX y NS, que un ping no usa.

**Proveedores e interconexión.** El ejemplo **Dos ISP: peering y tránsito** tiene dos proveedores (AS 64501 y AS 64502) que intercambian el tráfico de sus clientes por un enlace de peering y compran tránsito a un proveedor mayor (AS 64500) para llegar al resto de internet. Un ping entre los dos clientes va por el peering; uno a google.com, por el tránsito (se ve en el recorrido y en la captura). Un buen ejercicio: cortar el cable de peering. Con rutas estáticas el tráfico entre clientes no se desvía solo; hay que cambiar la ruta hacia el tránsito a mano, que es lo que BGP haría automáticamente (el simulador no tiene ruteo dinámico).

**Dos sitios conectados por internet.** El ejemplo **Dos sitios por internet** tiene una PC en su casa, detrás de un router con NAT, y un servidor web con IP pública en la oficina, cada sitio con su nube. Todas las nubes son la misma internet: el ping y *Conectar* a 203.0.113.10 cruzan de una nube a la otra (paso «Cruzar internet hacia SRV-Web»), y el servidor ve la conexión desde la IP pública de la casa. Para un laboratorio: cortar el cable entre R-Oficina y su nube da D34 («internet no llega hasta ese equipo»), y quitar el NAT de R-Casa da D28. Que el servidor no vea la IP privada de la PC muestra para qué sirve el NAT. Las IP públicas que no son de ningún equipo del lienzo las sigue respondiendo la nube.

**Redirección de puertos (NAT de destino).** El ejemplo **Servidor publicado con redirección de puertos** es el de los dos sitios, pero SRV-Web tiene IP privada (192.168.50.10) y R-Oficina hace NAT. En su pestaña **NAT**, R-Oficina redirige el TCP 80 y el 443 de su IP pública (200.51.3.2) hacia el servidor. Desde PC-Casa, *Conectar* a 200.51.3.2:80 muestra el paso *Redirigir el puerto (NAT de destino)*, y las tramas muestran el puerto público afuera y el interno adentro. Comparado con **Dos sitios por internet** (el servidor con IP pública), deja ver para qué sirve cada forma de NAT. Para un laboratorio: la falla *Sin redirección* hace que el pedido lo reciba el router (D31), y con un firewall con política «bloquear», la regla que permite el tráfico tiene que apuntar a la IP interna del servidor, porque el filtro ve el destino ya redirigido.

### Unidad 10: transporte y análisis de tráfico

**Puertos, TCP y UDP.** En **Simulación → Conectar** se ve una conexión TCP completa (socket con puerto efímero, handshake, pedido y respuesta, cierre) o el intercambio UDP. El ejemplo de la oficina tiene HTTP en SRV-DNS: conectarse por SSH al mismo servidor da D31 («la red llega, el servicio no»), que separa bien un problema de red de uno de servicio. Conectarse a una IP pública donde no hay ningún servidor da D33: el SYN se reintenta sin respuesta, ni siquiera un RST. Sirve para contrastar «nadie contesta» con «contesta que no». Con NAT, el resultado muestra la IP:puerto con la que el servidor ve la conexión.

**Análisis de tráfico.** La pestaña **Captura** funciona como Wireshark: se inicia en un cable y se van sumando los paquetes de lo que se haga en Simulación. Un ejercicio completo en la oficina: capturar en el cable de PC-1 y conectarse por HTTP a `www.oficina.local` muestra, en orden, la consulta y la respuesta DNS, el handshake, el GET y su respuesta, y el cierre. Capturando en todos los cables y consultando un nombre de internet se ven las consultas iterativas del servidor a la raíz, al TLD y al autoritativo, y el NAT del borde. El filtro (`dns`, `tcp.port==80`, `ip.addr==…`) sirve para preguntas como «¿cuántos segmentos lleva una conexión HTTP?».

### Unidad 11: firewalls y calidad de servicio

**Firewalls.** En la pestaña **Filtrado** de un router o firewall, cada regla puede indicar protocolo, puerto de destino y por qué puerto entra el paquete, y al pie se elige la política por defecto. Un buen práctico: «denegar todo y permitir sólo HTTP hacia el servidor» (política bloquear + una regla permitir TCP 80). Con un firewall, la conexión funciona; con un router sin estado, la respuesta se bloquea (D27 en la vuelta): es la diferencia entre filtrado con y sin estado. Bloquear UDP 53 deja sin DNS (D26 con la regla como causa).

**Calidad de servicio.** Cada cable tiene latencia, jitter y pérdida (en sus propiedades). Mandando 10 o 50 pings se ven las tres medidas como en la consola real: el jitter hace variar los tiempos (el resultado informa mínimo, media, máximo y la variación) y la pérdida se lleva paquetes, a la ida y a la vuelta. Con 100 % de pérdida el camino existe pero no vuelve nada: D32, un problema de calidad y no de configuración.

## 3. Armar un laboratorio de diagnóstico

Un laboratorio es una red **sana** a la que se le plantan **fallas**, con **objetivos** que el alumno tiene que cumplir (por ejemplo, «la cámara llega al servidor»). Se arma en dos archivos: la versión **docente** (red sana + lista de fallas + objetivos), que guardás vos, y la versión del **alumno** (fallas aplicadas, sin la lista), que repartís. Todo se arma en pantalla, en la pestaña **Laboratorio** del modo Docente; no hace falta tocar el archivo.

**Paso a paso:**

1. **Partí de una red que funcione.** La más cómoda es el ejemplo **Complejo roto (docente)**, que ya trae tres fallas y dos objetivos como modelo. También podés armar una red propia; comprobá con varios pings que todo llegue.
2. **Pasá a modo Docente** y abrí la pestaña **Laboratorio**, abajo.
3. **Cargá las fallas** (sección *Fallas*): elegí el tipo en *+ Agregar falla…* y, a la derecha, el equipo, el puerto, el cable, la ruta, el registro o el servicio, de listas armadas con tu red. La red que ves **sigue sana**: las fallas se aplican recién al exportar para el alumno.
4. **Cargá los objetivos** (sección *Objetivos*): ping, conectar a un servicio o resolver un nombre; si se espera que funcione o que falle (y, si falla, por qué causa); y una descripción para el alumno.
5. **Verificá el laboratorio** (sección *Verificar*): cada objetivo aparece en dos columnas, **Sana** (tu solución) y **Alumno** (con las fallas aplicadas), y debajo qué objetivos rompe cada falla. Un buen laboratorio da todo ✓ en la sana y algún ✗ en la del alumno; si no, la sección te avisa (un objetivo que no se cumple en tu solución, una falla que no rompe nada, fallas sin objetivos).
6. **Cambiá el nombre de la red** (se usa para nombrar el archivo del alumno), **exportá la versión docente** con *Exportar* y guardala: es la solución.
7. **Apretá Exportar para el alumno.** Se descarga `<nombre-de-la-red>-ALUMNO.json`, con las fallas ya aplicadas y sin la lista. Repartí ese.

Si borrás o renombrás un equipo que una falla u objetivo usaba, el ítem queda marcado con ⚠ y la explicación («el equipo pc9 no está en la red»): corregilo o quitalo antes de exportar. Una falla que no cambiaría nada (quitar el NAT de un puerto que no lo tiene, un gateway igual al que ya está) también se marca. Todo se deshace con Ctrl+Z.

**Recomendaciones:**

- **Una falla, un síntoma claro.** Las fallas que mejor funcionan son las que el recorrido explica: máscara incorrecta (D09 o D14), puerta de enlace incorrecta (D09 o D10), ruta faltante (D11 a la ida, D12 a la vuelta), IP duplicada (D07), interfaz deshabilitada (D01), cable caído (D02).
- **Las fallas de servicios separan la red del servicio.** Sin NAT (D28), DNS incorrecto (D29), registro borrado (D25), servicio detenido (D31), sin redirección (D31 en el router) y regla agregada (D27): con varias de ellas, el ping llega y el servicio no. La tabla de la sección 2 sugiere una por tema.
- **Combiná fallas que se tapan entre sí** para el nivel avanzado: hasta que no se arregla la primera, la segunda no aparece.
- **Exigí la causa cuando importa.** Un objetivo que espera una falla puede indicar el código: «el huésped *no* tiene que llegar al servidor, y tiene que ser por una regla de filtrado (D27)». Si falla por otra razón, no se cumple.
- **Los laboratorios no avisan.** En una red con objetivos, el simulador no muestra los avisos de configuración en ningún modo: encontrar la falla es el ejercicio. En una red común, en cambio, la pestaña Estado de cada equipo avisa los errores que detecta.

**Laboratorios incluidos.** En [`escenarios/`](../escenarios/) están las versiones del alumno de tres laboratorios sobre el complejo turístico (un problema, tres problemas y «el problema invisible») y uno sobre la oficina con DNS propio («la oficina sin servicios»: dos fallas que producen tres síntomas distintos, D31, D30 y D28). Las versiones docentes no se publican, para que los alumnos no tengan las soluciones a mano; si sos docente y las necesitás, pedíselas al autor ([fhleonardi en GitHub](https://github.com/fhleonardi)).

## 4. Armar un desafío de diseño VLSM

En un desafío, el alumno recibe una red **sin direccionar**, un **bloque** para repartir y los **sectores** con la cantidad de hosts de cada uno. Diseña el VLSM, configura los equipos y verifica.

**Paso a paso:**

1. **Armá la red con tu solución**: direccionada y funcionando (o partí del ejemplo **Complejo turístico**).
2. En modo Docente, pestaña **Laboratorio**, sección **Desafío VLSM**: apretá **Armar desde la red** (un sector por cada puerto de router con lo que cuelga de él), poné un nombre a cada sector y los **hosts** que necesita, y cargá el **bloque a repartir**. Los equipos y puertos de cada sector se agregan o se sacan con las fichas.
3. En **Verificar**, tu solución tiene que cumplir el diseño VLSM.
4. **Exportá la versión docente** (es la solución) y después **Exportar para el alumno**: el archivo del alumno sale **sin direccionar** (se borran IP, máscaras, gateways, rutas, DHCP y DNS; la nube de Internet queda como está), con los sectores y el bloque.
5. Comprobá la versión del alumno: importala y apretá **Verificar diseño VLSM**; todos los sectores tienen que decir «Ningún equipo de este sector tiene IP todavía».

Un desafío puede llevar también objetivos (por ejemplo, «el huésped llega al servidor»): el alumno los cumple cuando termina de direccionar.

**Qué controla el verificador**, sector por sector, sin decir nunca cuál sería la dirección correcta:

- que todos los equipos y puertos del sector tengan IP, en la misma subred;
- que la subred esté dentro del bloque y no se solape con la de otro sector;
- que esté alineada (que arranque en un múltiplo de su tamaño, tomando la puerta de enlace como primera dirección);
- que el prefijo alcance para los hosts pedidos;
- que ningún equipo tenga la dirección de red o de broadcast;
- que la puerta de enlace de cada equipo esté en su subred y sea la del router del sector;
- como advertencia, no como error, que la subred no desperdicie más del 60 % de sus direcciones.

**Sin archivo de desafío.** Un alumno también puede verificar una red que armó por su cuenta: el botón **Verificar diseño** detecta los sectores solo (cada puerto de router con lo que cuelga de sus switches) y hace los mismos controles. Si en el resultado carga los hosts de cada sector y el bloque, se suman los de capacidad. Sirve para ejercicios de enunciado en papel: el alumno resuelve a mano, lo arma y lo comprueba.

## 5. Formato de los archivos

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
| `nat-faltante` | `dispositivo`, `interfaz` | Saca el NAT de ese puerto del router (D28). |
| `redireccion-faltante` | `dispositivo`, `protocolo`, `puerto` | Quita esa redirección de puertos del router: desde afuera, el pedido lo recibe el router (D31). |
| `dns-incorrecto` | `dispositivo`, `dns` | Cambia el servidor DNS del equipo (por ejemplo, la IP del router: D29). |
| `registro-dns-borrado` | `dispositivo`, `nombre`, `tipoRegistro` (opcional) | Borra ese registro del servidor DNS (D25). |
| `servicio-detenido` | `dispositivo`, `protocolo`, `puerto` | El servidor deja de atender ese puerto (D31); UDP 53 apaga su DNS. |
| `regla-agregada` | `dispositivo`, `regla`, `posicion` (opcional) | Agrega una regla de filtrado, por defecto en el primer lugar (D27). |

**Objetivos:**

| Campo | Valor |
|---|---|
| `tipo` | `"ping"`, `"conectar"` o `"resolver"`. |
| `origen` | `id` del equipo que hace el ping. |
| `destino` | IP (o nombre, como `google.com`) a la que se hace el ping. |
| `esperado` | `"exito"` si tiene que llegar, `"falla"` si no. |
| `codigo` | Opcional, con `"falla"`: el diagnóstico exigido (por ejemplo `"D27"`). |
| `descripcion` | Opcional: una frase para el alumno, que se muestra debajo del objetivo. |
| `protocolo`, `puerto` | Sólo en `conectar`: `"tcp"` o `"udp"` y el puerto (el `destino` puede ser una IP o un nombre). |
| `nombre`, `tipoRegistro`, `valor` | Sólo en `resolver`: el nombre, el tipo de registro (`A` si no se indica) y, opcional, el valor que tiene que dar. |

Por ejemplo, para exigir que la intranet responda y que un nombre de afuera se resuelva:

```json
{ "tipo": "conectar", "origen": "pc1", "destino": "www.oficina.local", "protocolo": "tcp", "puerto": 80, "esperado": "exito" },
{ "tipo": "resolver", "origen": "pc2", "nombre": "google.com", "esperado": "exito" }
```

### Campos de los equipos que usan las fallas

Las fallas de servicios cambian campos de los equipos. Se cargan desde la interfaz, pero en el archivo se ven así:

```json
{ "id": "r-oficina", "tipo": "router",
  "interfaces": [ { "id": "g0/1", "ip": "200.51.3.2", "prefijo": 30, "nat": true } ],
  "redirecciones": [ { "protocolo": "tcp", "puerto": 80, "ipInterna": "192.168.50.10", "puertoInterno": 80 } ],
  "reglas": [ { "accion": "permitir", "origen": "0.0.0.0/0", "destino": "192.168.50.10/32", "protocolo": "tcp", "puerto": 80, "entrada": "g0/1" } ],
  "politica": "bloquear" }
```

```json
{ "id": "srv-web", "tipo": "servidor",
  "servicios": { "escuchando": [ { "protocolo": "tcp", "puerto": 80, "nombre": "HTTP" } ],
                 "dns": { "zona": "oficina.local", "recursivo": true, "registros": [ { "nombre": "www.oficina.local", "tipo": "A", "valor": "192.168.10.53" } ] } } }
```

- `nat` va en el puerto del router que da a internet (la falla `nat-faltante` lo saca).
- `redirecciones` es del router y sólo se aplica a la IP de un puerto con NAT (`redireccion-faltante` saca una).
- `reglas` y `politica` son el filtrado (`regla-agregada` suma una).
- En el servidor, `servicios.escuchando` son los puertos abiertos (`servicio-detenido` saca uno) y `servicios.dns`, su zona: `zona`, `recursivo` y `registros` con `nombre`, `tipo`, `valor` y, en un MX, `prioridad` (`registro-dns-borrado` saca un registro).

(Los ejemplos están recortados: un equipo completo tiene también nombre, posición, gateway, DNS y el resto de sus puertos.)

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

---

*OpenRedLab es un proyecto de Francisco Leonardi con [Open Tecnología](https://opentecnologia.ar). Se publica con licencia MIT.*
