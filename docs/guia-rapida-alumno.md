# OpenRedLab — Guía rápida para el alumno

*Sistemas Operativos y Redes · Unidades 7 a 11: topologías, modelos de capas, direccionamiento IP, transporte y servicios de red*

> **Para arrancar**
>
> Abrí **https://fhleonardi.github.io/openredlab/** en cualquier navegador. También podés descargar el archivo `index.html` y abrirlo con doble clic: no hay que instalar nada, no necesita internet y funciona igual en tu notebook, en la máquina virtual del laboratorio o en el celular. En el celular, los paneles se abren desde abajo con los botones **Agregar**, **Configurar** y **Ping**.
>
> Si el profesor te pasó un archivo `.json`, arrastralo encima del lienzo o abrilo con **Importar**.

## La pantalla

| Zona | Para qué sirve |
|---|---|
| **Barra de arriba** | Los cuatro modos (Topología, Subredes, Desafío, Docente), los ejemplos, importar y exportar, tema oscuro y modo presentación. |
| **Columna izquierda** | Los dispositivos que podés agregar y la herramienta de cable. Arrastrá un ítem al lienzo, o hacé clic en él y después donde lo querés poner. |
| **Lienzo (el centro)** | La red. Cada equipo muestra sus puertos como cuadraditos en el borde: los cables salen de ahí. Debajo de cada equipo ves su IP y su puerta de enlace (la línea «gw»); los routers muestran una IP por cada red que conectan. |
| **Panel derecho** | La configuración del equipo seleccionado, en pestañas (las de cada equipo están en la tabla de abajo). En routers y switches también elegís el **modelo**. |
| **Franja de abajo** | Cinco pestañas: **Simulación** (ping, consulta DNS y conexiones), **Captura**, **DHCP**, **Cálculo de subred** y **Ayuda**. Con la tecla **F** (modo presentación) queda reducida a una línea para proyectar. |

Las pestañas del panel derecho dependen del equipo:

| Equipo | Pestañas |
|---|---|
| **PC, cámara, IoT, switch, punto de acceso** | **Configuración** (IP, máscara, puerta de enlace y DNS), **Interfaces** (habilitar cada puerto y, en las inalámbricas, el modo de radio) y **Estado**. |
| **Servidor** | Las mismas, más **Servicios** (los puertos en los que escucha) y **DNS** (su zona y sus registros). |
| **Router y firewall** | Las mismas, más **Rutas**, **Filtrado** (las reglas), **NAT** (NAT de origen y redirecciones de puertos) y **DHCP**. |

## Lo primero que tenés que saber hacer

1. **Conectar dos equipos:** apretá *Conectar con un cable* en la columna izquierda, hacé clic en un puerto libre del primer equipo y después en un puerto libre del segundo. Si el puerto se atenúa, ese cable no va ahí.
2. **Configurar un equipo:** hacé clic sobre él y completá IP, máscara y puerta de enlace en el panel derecho.
3. **Probar:** en la pestaña **Simulación**, elegí el origen, escribí la IP de destino y apretá **Ping**.

En **Ejemplos…** (barra de arriba) hay redes armadas para mirar y romper: desde una red básica hasta dos sitios conectados por internet.

## Cuando el ping falla — que es lo importante

El simulador no te dice sólo que falló. A la izquierda tenés el **recorrido paso a paso**: cada cosa que el sistema operativo verifica antes de mandar el paquete, y cuál de esos pasos se rompió, con la cuenta que dio mal. A la derecha aparece el **diagnóstico**: un título (al lado, un código chico como D09, que podés buscar en la tabla de abajo), una explicación, una sugerencia y el botón *Ir a configurar*, que te lleva al equipo. *Ver los pasos* muestra el detalle completo.

Cada paso lleva su **capa** (por ejemplo «Capa 2 · Enlace»): pasá el mouse por encima para ver el nombre en el modelo TCP/IP y qué viaja en esa capa (bits, trama, paquete).

### Los diagnósticos más comunes

| Código | Qué pasó | Por dónde empezar |
|---|---|---|
| **D01** | El equipo está apagado o su interfaz está deshabilitada | Panel derecho, pestaña Interfaces |
| **D02** | No hay conexión física | Mirá el cable en el lienzo: rojo y cortado es caído |
| **D03** | El cable no corresponde a los puertos | Mirá el tipo de cada puerto (cobre, fibra o inalámbrico) y el del cable |
| **D04** | El equipo no tiene dirección IP | Panel derecho, pestaña Configuración |
| **D05** | La máscara no es válida | Panel derecho, pestaña Configuración: el campo de máscara |
| **D06** | Esa IP no se puede asignar a un equipo | Pestaña Cálculo de subred: el rango asignable |
| **D07** | Dos equipos tienen la misma IP | Comparalas en el lienzo |
| **D08** | Falta la puerta de enlace | Panel derecho, puerta de enlace |
| **D09** | La puerta de enlace está fuera de tu red | Pestaña Cálculo de subred: fijate en el «AND» |
| **D10** | La puerta de enlace no responde | Que esa IP sea la del router en tu red, y que el router esté conectado |
| **D11** | El router no sabe cómo llegar al destino | Pestaña Rutas del router |
| **D12** | La respuesta no puede volver | Rutas del router del **otro** lado |
| **D13** | El equipo de destino está apagado | Encendelo o habilitá su puerto |
| **D14** | Equipos de la misma red con máscaras distintas | Compará los prefijos: cada uno calcula una red diferente |
| **D15** | Están en el mismo switch, pero en subredes distintas | Ni un switch ni un punto de acceso enrutan: hace falta un router |
| **D16** | No se obtuvo una IP por DHCP | Pestaña DHCP del router de esa red: que esté habilitado y con direcciones libres |
| **D17** | El equipo está fuera del alcance inalámbrico | Acercalo a su punto de acceso |
| **D18** | Los modos de radio no son compatibles | Un cliente se asocia a un punto de acceso, no a otro cliente |
| **D19** | El equipo inalámbrico no está conectado a un punto de acceso | Que el AP esté encendido y con su radio en modo ap |
| **D20** | Nadie tiene esa IP en tu red | Que la IP de destino esté bien escrita y el equipo exista |
| **D21** | El destino es la dirección de broadcast | Hacé ping a la IP de un equipo concreto de esa red |
| **D22** | La ruta apunta a un router que no está al alcance | Pestaña Rutas del router: el siguiente salto de esa ruta |
| **D23** | El paquete quedó dando vueltas entre routers | La ruta hacia ese destino en cada router del recorrido |
| **D24** | El equipo no tiene servidor DNS | Panel derecho, Configuración: el campo DNS |
| **D25** | El nombre no existe | Cómo está escrito, y si el servidor DNS que preguntás conoce esa zona |
| **D26** | El servidor DNS no responde | Que la PC llegue a la IP de su servidor DNS (es un ping como cualquier otro) |
| **D27** | Una regla de filtrado bloqueó el paquete | Pestaña Filtrado del router o firewall: el orden de las reglas |
| **D28** | Falta NAT: la respuesta no puede volver de internet | Casilla NAT del puerto del router que va a internet |
| **D29** | Esa IP no es un servidor DNS | El DNS de la PC tiene que ser un servidor con DNS o un público como 8.8.8.8 |
| **D30** | El servidor DNS no llega a internet | La salida a internet del servidor: puerta de enlace, rutas y NAT |
| **D31** | Puerto cerrado: la red llega, pero nadie atiende ese servicio | Pestaña Servicios del servidor, y el puerto y protocolo elegidos |
| **D32** | Se perdieron todos los paquetes | La pérdida (%) de los cables del recorrido |
| **D33** | Nadie atiende en esa IP de internet | Que la IP de destino exista |
| **D34** | Internet no llega hasta ese equipo | La conexión del otro sitio con su nube: el cable, el router de borde y su IP en la red de la nube |

## La pestaña Cálculo de subred

Es la que más te conviene tener abierta mientras configurás. Seleccioná un equipo y vas a ver su dirección en binario, la **clase** de la IP (A, B o C, si es privada o pública, y qué máscara le daba el sistema de clases frente al prefijo CIDR que usás de verdad), con los bits de red en un color y los de host en otro, y la línea donde corta la máscara. Cambiás el prefijo y la línea se mueve: eso es exactamente lo que hace la máscara.

A la derecha está **«¿Tu puerta de enlace está en tu red?»**: muestra el «AND» de tu IP y el «AND» de tu puerta de enlace, uno debajo del otro. Si los dos resultados no son iguales, tu equipo no puede hablar con su propia puerta de enlace, y ahí está el problema. Ese cálculo es el mismo que hacés a mano en el TP.

## Cómo viaja el paquete

Después de un ping, el botón **Cómo viaja el paquete** cambia los pasos por las **tramas**: lo que viaja por el cable entre dos equipos que entienden IP (PC, routers, firewalls). Una línea por tramo, de ida y de vuelta. Fijate en tres cosas:

- **En cada router cambia la trama:** la MAC de origen y la de destino son las de ese tramo.
- **El paquete IP no cambia:** la IP de origen y la de destino son las mismas de punta a punta (salvo en un router con NAT: lo ves en la sección siguiente).
- **El TTL baja uno por router.** Sale con 64; si llega a 0, el paquete se descarta (D23).

Los switches y puntos de acceso aparecen como «pasa por… sin cambiar la trama»: trabajan con la MAC y no la modifican. **Ver los encabezados** muestra cada trama con lo que lleva adentro: la trama (MAC), el paquete IP (IP y TTL) y el mensaje ICMP del ping, con lo que cambió resaltado. Al pasar el mouse por una línea se resalta su cable en el lienzo.

## Internet y NAT

La nube **Internet** representa todas las direcciones públicas. Una IP privada (10.x, 172.16–31.x, 192.168.x) no viaja por internet: para salir y para que te encuentren desde afuera hace falta NAT.

**Salir a internet: NAT de origen.** El router que da a internet cambia la IP privada de origen por la IP pública de su puerto (paso *Traducir la dirección de origen (NAT)*) y, cuando vuelve la respuesta, la traduce al revés. En las tramas se ve: la línea del router a Internet dice «cambia: … IP». El NAT se activa con la casilla **NAT** del puerto que va a internet (pestaña Interfaces del router); un firewall nuevo ya lo trae en wan. Sin NAT, el pedido llega pero la respuesta no puede volver: **D28**.

**Entre dos sitios, el paquete cruza internet.** Si la IP pública de destino es de un equipo de otro sitio del lienzo, la nube no responde ella: le lleva el paquete a la nube de ese sitio, porque todas son la misma internet (paso *Cruzar internet hacia …*). En las tramas, ese tramo dice «por internet». En la realidad son muchos saltos entre routers de los proveedores, cada uno con su trama, que el simulador no dibuja. Si internet no puede llegar hasta ese equipo (su sitio no tiene nube, o está caído el cable o apagado el router del borde), el diagnóstico es **D34**. El ejemplo **Dos sitios por internet** lo tiene armado.

**Las demás IP públicas las contesta la nube.** Un ping a cualquier IP pública que no sea de un equipo del lienzo responde, como si ahí hubiera alguien. Pero si te conectás a un servicio en una IP donde no hay ningún servidor, nadie contesta, ni siquiera con un «no»: **D33**.

**Publicar un servidor: redirección de puertos (NAT de destino).** Un servidor con IP privada no se puede alcanzar desde afuera por su IP. Para publicarlo, en la pestaña **NAT** del router agregás una redirección: lo que llegue a la IP pública del router por, por ejemplo, TCP 80, va a la IP y el puerto del servidor. Desde afuera te conectás a la IP del router (paso *Redirigir el puerto (NAT de destino)*). En las tramas, afuera se ve el puerto público y adentro el del servidor, y la respuesta vuelve con el origen del router. Sin la redirección, el pedido lo recibe el router, que no da servicios: **D31**. El ejemplo **Servidor publicado con redirección de puertos** lo tiene armado.

## Puertos y conexiones (TCP y UDP)

Un **servicio** es un programa que escucha en un **puerto** de un servidor (pestaña **Servicios**: HTTP 80, HTTPS 443, SSH 22, FTP 21, SMTP 25 o uno propio). En **Simulación → Conectar** elegís el destino y el servicio y ves:

- el **socket**: tu IP y un puerto efímero (49152 o más) ↔ la IP y el puerto del servidor;
- en **TCP**, el **handshake de tres pasos** (SYN → SYN-ACK → ACK), el pedido y la respuesta, y el cierre (FIN), con los números de secuencia (`seq`) y de confirmación (`ack`);
- en **UDP**, sólo los datagramas: no hay conexión ni confirmación.

Si la red llega pero nadie atiende ese puerto, el resultado es **D31**: en TCP el servidor responde RST («acá no hay nadie»). Fijate en la diferencia con **D33**: ahí no contesta nadie y el SYN se reintenta hasta que se abandona.

Las reglas de **Filtrado** de un router o firewall pueden mirar el protocolo, el puerto y por dónde entra el paquete; lo que no coincide con ninguna lo decide la **política por defecto**. Si una regla te frena, el diagnóstico es **D27** y dice cuál.

## DNS: de un nombre a una IP

Cuando hacés ping a un nombre, primero se averigua su IP, y eso se ve en el recorrido (pasos de **Capa 7 · Aplicación**):

1. **Consulta recursiva:** tu PC le pregunta a su servidor DNS (el de Configuración) y le pide la respuesta final.
2. Si el nombre es de la **zona** de ese servidor (por ejemplo `oficina.local`), responde él, con autoridad.
3. Si no, el servidor hace **consultas iterativas**: le pregunta a la **raíz**, que lo deriva al servidor del **TLD** (.com), que lo deriva al **autoritativo** del dominio (google.com), que le da la IP.
4. El servidor guarda la respuesta en su **caché** por el TTL del registro: la segunda vez contesta sin preguntarle a nadie.

Para preguntar sin hacer ping, en **Simulación** elegí **Consultar DNS**: escribís el nombre y el tipo de registro y ves la respuesta como en `nslookup` (qué servidor respondió, si es autoritativa, si vino de la caché). **Vaciar caché** sirve para volver a ver la consulta a la raíz.

Un servidor se agrega desde la paleta (**Servidor**); en su pestaña **DNS** se cargan la zona y los registros: **A** (nombre → IP), **CNAME** (un nombre que es alias de otro), **MX** (el servidor de correo de un dominio) y **NS** (el servidor DNS de un dominio). El ejemplo **Oficina con DNS propio** trae todo armado. Los problemas de DNS tienen sus propios diagnósticos (D24 a D26, D29 y D30): están en la tabla de arriba.

## Captura: lo que pasa por un cable

En la pestaña **Captura** elegís un cable (o todos), apretás **Iniciar captura** y después hacés pings, consultas DNS o conexiones en Simulación. Cada paquete que pase por ese cable aparece numerado, como en Wireshark: origen, destino, protocolo e información (por ejemplo `49612 → 80 [SYN] Seq=1000`). Al tocar uno, ves sus capas: la trama (MAC), el paquete IP (IP y TTL), el segmento TCP o el datagrama UDP (puertos, indicadores) y los datos de la aplicación.

El **filtro** acepta palabras como `icmp`, `tcp`, `udp`, `dns` o `http`, y expresiones como `ip.addr==10.45.7.66`, `ip.src==…`, `ip.dst==…` o `tcp.port==80`, separadas por espacios (se tienen que cumplir todas). La captura guarda los últimos 500 paquetes y no muestra ARP ni DHCP.

## Hub, switch y router: los dominios

Un **hub** (en la Configuración del switch, modelo *Hub de 8 puertos*) repite cada trama por todos sus puertos: la reciben todos y sólo el destino la acepta. Un **switch** la manda sólo por el puerto del destino, gracias a su tabla MAC. Un **router** no deja pasar los broadcast de una red a otra.

El selector **Dominios** de la barra del lienzo pinta y cuenta los **dominios de colisión** (los equipos que comparten el medio: todo lo que cuelga de un hub, o una celda inalámbrica; cada puerto de switch es uno) y los **dominios de broadcast** (hasta dónde llega un broadcast: los corta el router).

## Wi-Fi: router inalámbrico y punto de acceso

Cada interfaz inalámbrica tiene un modo de radio, que elegís en la pestaña Interfaces del panel derecho. En modo **ap** sostiene la red Wi-Fi (la celda) y admite varios clientes; en modo **cliente** se asocia a un ap; en modo **bridge** une dos puntos a distancia. Dos clientes no se conectan entre sí: siempre hace falta un ap.

En el ejemplo *Complejo turístico* vas a ver los dos usos. **R1** es un router inalámbrico: su wlan0 en modo ap crea una subred nueva (10.45.7.0/26) para los huéspedes, y R1 enruta entre esa red y las demás. **AP-Admin** es un punto de acceso: cuelga del switch de Administración y extiende al aire una subred que ya existía (10.45.7.64/27). Un AP no enruta, igual que un switch.

El alcance es limitado: si alejás un cliente de su punto de acceso, el ping falla con D17.

## Calidad del enlace (QoS)

En las propiedades de un cable podés cargar su **latencia** (lo que tarda en cruzarlo), su **jitter** (cuánto varía ese tiempo) y su **pérdida** (el porcentaje de paquetes que no llegan). El ping manda 4 paquetes por defecto (podés elegir 1, 10 o 50) y, como el ping real, muestra cada respuesta o «Tiempo de espera agotado», los perdidos y el tiempo mínimo, medio y máximo. La pérdida se aplica cada vez que el paquete cruza el cable: a la ida y a la vuelta. Si no vuelve ninguno, el diagnóstico es **D32**.

## Verificar tu trabajo

En la pestaña Simulación, el botón de verificar cambia de nombre según la red abierta:

- **Verificar**, en un **laboratorio**: revisa si se cumplen los objetivos (por ejemplo, que la cámara llegue al servidor);
- **Verificar diseño VLSM**, en un **desafío**: revisa el diseño contra lo que pide el enunciado (subredes que se solapan o no están alineadas, si alcanzan las direcciones para los hosts pedidos y si las puertas de enlace están bien);
- **Verificar diseño**, en una **red que armaste vos**: el mismo control de diseño, por sector. Si cargás cuántos hosts necesita cada sector y el bloque a repartir, también revisa si alcanzan.

## Qué entregar

- Captura del recorrido paso a paso con el diagnóstico, por cada problema que hayas encontrado.
- El registro de eventos: botón **Exportar registro** en la pestaña Simulación. Anota algunos eventos del simulador con hora, pero no es un historial completo. Conserva como máximo las últimas 400 entradas; si se descartaron anteriores, el archivo lo indica.
- Tu topología corregida: botón **Exportar** de la barra de arriba. Nombrala `ApellidoNombre_lab.json`.
- Una línea por problema explicando qué estaba mal y cómo lo arreglaste. El código del diagnóstico no alcanza como explicación.

> **Dos advertencias**
>
> El simulador **no reemplaza el cálculo a mano**. Si diseñás el direccionamiento acá a fuerza de probar hasta que deje de fallar, en el parcial —que es en papel— no te va a servir de nada. Calculá primero, verificá después.
>
> En los laboratorios de diagnóstico, el simulador **no te avisa de los errores mientras configurás**: tenés que encontrarlos vos. Es a propósito.

---

*OpenRedLab es un proyecto de Francisco Leonardi con [Open Tecnología](https://opentecnologia.ar). Se publica con licencia MIT.*
