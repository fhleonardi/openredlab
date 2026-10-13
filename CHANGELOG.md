# Cambios

Cada versión de OpenRedLab tiene su entrada, de la más nueva a la más vieja. La versión se ve en la pestaña **Ayuda** del simulador.

Los números siguen la forma MAYOR.MENOR.PARCHE:

- **MAYOR:** cambia el formato de los archivos de red, o un laboratorio hecho con la versión anterior hay que rehacerlo.
- **MENOR:** algo nuevo para usar en clase, como un tema de la materia, un tipo de falla, una pestaña o un ejemplo.
- **PARCHE:** arreglos.

Los archivos de red llevan el número de su formato (`version`) y la versión del simulador que los exportó (`generador`). Un archivo de un formato anterior se actualiza solo al abrirlo.

## 1.8.0 — 2026-10-13

- **Resolver nombres reales de internet, a pedido.** Hasta ahora el DNS simulado sólo conocía cuatro nombres de internet (google.com, wikipedia.org, dns.google y one.one.one.one). En la franja de Simulación hay un interruptor **«Resolver nombres reales (requiere internet)»**, apagado al abrir. Prendido, un nombre que la simulación no conoce (por ejemplo example.com) se consulta de verdad a Cloudflare por DNS sobre HTTPS, y el ping, Consultar DNS (A, CNAME, MX y NS) y Conectar lo usan. El recorrido dice cuál es la respuesta real y de dónde viene. El ping y la conexión siguen simulados, hacia la IP real: los navegadores no mandan ICMP.
- **Qué sale a la red.** Sólo el nombre que escribís, y sólo si prendiste el interruptor, la simulación no lo conocía y es un nombre público válido (no una IP, ni `.local`, `.lan`, `.home` u otros nombres de redes privadas). Hasta 10 consultas por minuto, de a una, con 5 segundos de tiempo máximo y sin credenciales ni datos de la página. Se apaga al recargar o al abrir otra red. La página tiene una política de seguridad que sólo la deja conectarse a `cloudflare-dns.com`, y lo que vuelve se valida antes de usarse (se descartan las IP privadas, lo que no tiene forma de nombre o dirección y lo que no corresponde al nombre pedido). Un nombre que existe pero no tiene registros del tipo pedido se distingue de uno que no existe.
- **Con un error, la consola vuelve a verse.** Cuando un ping, una consulta o una conexión fallaba, el resultado quedaba en dos columnas y la consola se escondía debajo de la tarjeta roja, fuera de la vista. Ahora la consola tiene su propia columna también con un error, igual que con un resultado correcto.
- **La franja de abajo es más alta.** Simulación, Captura, DHCP y las demás pestañas tienen más lugar (el 38 % de la ventana, entre 290 y 480 px, en vez de 260 px fijos). Si hace falta más lienzo, el botón «Colapsar» la deja en una línea.
- **Sin conexión, todo sigue igual.** Si no hay internet o el servicio no responde, la herramienta avisa y queda el DNS simulado de siempre.

## 1.7.0 — 2026-10-13

- **Fallas en vivo: cortar un cable o apagar un equipo con un clic.** En la paleta, debajo de «Conectar con un cable», hay una sección **Fallas en vivo** con **Cortar cable**, **Apagar equipo** y **Restaurar todo**. Con una herramienta activa, un clic en un cable (o en un equipo) lo cae y otro clic lo restaura; Esc o un clic en el fondo del lienzo sale. Las propiedades de un cable o equipo fallado en vivo lo avisan y traen un botón para restaurarlo. El cable cortado se ve rojo y punteado con ⚡ y el equipo apagado, atenuado con ⚡. Después se repite el ping, la consulta DNS, la conexión o el DORA para ver el efecto, con el diagnóstico de siempre («el cable… está marcado como caído»).
- **No cambian el diseño.** Una falla en vivo vale sólo para lo que se simula: no entra en Deshacer, ni en la sesión guardada, ni en lo que se exporta, y «Verificar diseño» sigue juzgando el diseño. Si algo ya está caído o apagado en el diseño, la herramienta avisa que ya lo está. Al abrir otra red se limpian. Cada falla y cada recuperación se anota en la consola con la hora, y la paleta dice qué está fallado ahora.

## 1.6.0 — 2026-10-13

- **Consultar DNS y Conectar también se ven viajar.** Cada consulta y cada conexión recorre el lienzo trama por trama, igual que el ping, con los mismos botones (pausar, repetir y velocidad) y con el salto al hacer clic en una trama. En DNS se ve la consulta recursiva y las tres consultas iterativas (raíz, TLD y autoritativo) con sus respuestas. En TCP cada fase tiene su color: apertura (SYN, SYN-ACK y ACK), datos (pedido y respuesta) y cierre (FIN), y un rechazo (RST, o un «no existe» de DNS) sale en rojo con una ✗ en el equipo que lo dio. Debajo de los botones, una leyenda dice qué significa cada color.
- **El DORA de DHCP se puede controlar.** La animación de la pestaña DHCP tiene ahora Pausar, Repetir y velocidad. Un clic en uno de los cuatro mensajes (Discover, Offer, Request, Ack) salta a ese mensaje, y el que se está mostrando queda resaltado en la lista.

## 1.5.1 — 2026-10-13

- **Iconos de equipos más modernos.** Cada equipo se dibuja ahora dentro de un recuadro redondeado con el color de su tipo y un glifo de trazo parejo. PC, servidor, firewall, internet, cámara, punto de acceso e IoT usan iconos de Tabler Icons (licencia MIT, detallada en `AVISOS.md`). El router, el switch y el hub mantienen sus símbolos clásicos de diagrama de redes, redibujados con el mismo estilo.

## 1.5.0 — 2026-10-13

- **El ping se ve viajar por la topología.** Al hacer un ping, un paquete recorre el lienzo trama por trama, pasando por los equipos intermedios: azul para el pedido (request) y verde para la respuesta (reply). Si el ping se corta, el paquete llega hasta donde pudo, queda en rojo y marca con una cruz el equipo donde paró.

- **Se puede pausar, repetir y cambiar la velocidad.** Debajo del recorrido hay botones para pausar o reanudar, repetir la animación y elegir la velocidad (×0.5, ×1, ×2, ×4). En «Cómo viaja el paquete», un clic en una trama salta a ese tramo de la animación, y la trama que se está mostrando queda resaltada.

## 1.4.0 — 2026-10-05

- **El router puede reenviar el DNS, como en una red hogareña.** En la configuración de un router hay una casilla «Reenviar consultas DNS a su servidor DNS». Con ella activada, las PC que usan la IP del router como DNS reciben la respuesta que el router consigue con su propio DNS, y el recorrido muestra el reenvío. Sin la casilla, el diagnóstico D29 sigue diciendo que la IP no es un servidor DNS, y su sugerencia menciona la opción.

## 1.3.0 — 2026-10-05

- **DNS inverso.** Un servidor puede tener una zona inversa (por ejemplo `1.168.192.in-addr.arpa`) con registros PTR, y Consultar DNS acepta una IP con tipo PTR: el simulador la convierte en su nombre `in-addr.arpa` y muestra el paso.
- **Una IP pública no inventa su nombre.** Si la IP no está en una zona inversa del lienzo, el diagnóstico dice que el simulador no tiene el árbol público de `in-addr.arpa` (D35). No dice que el nombre no existe.

## 1.2.5 — 2026-10-05

- **«Puerta de enlace» en todo el simulador.** Los textos que decían «gateway» (la ayuda de laboratorio, la lista de lo que se borra al exportar para el alumno y el panel de cálculo) ahora dicen «puerta de enlace».
- **La Ayuda aclara la escala.** Al lado de la distancia máxima del wireless se indica que la escala del dibujo es aproximada.

## 1.2.4 — 2026-10-05

- **Modos de radio con el mismo criterio en todo el simulador.** Donde antes decía «no se entienden», ahora dice «no combinan» y dice qué combinación falta: el diagnóstico del ping, el paso del recorrido y el aviso al importar usan el mismo texto.
- **Entrada de destino con un solo título.** Un destino que no es una IP ni un nombre válido se titula «La dirección de destino no es válida», igual que en el ping.
- **Falla de internet más precisa.** El diagnóstico de un servidor sin servicio en internet aclara que el «SYN» es el pedido de conexión.

## 1.2.3 — 2026-10-05

- **Mensajes de archivos más claros.** Si un equipo es de un tipo que no existe, el mensaje ahora incluye «servidor» en la lista de tipos válidos.
- **Enlaces inalámbricos con modos incompatibles.** El mensaje dice qué falta según el caso: dos clientes necesitan un punto de acceso; dos puntos de acceso se unen en bridge.

## 1.2.2 — 2026-10-04

- **El registro avisa cuando se truncó.** Conserva hasta 400 entradas; al copiarlo o exportarlo, una marca indica cuántas entradas anteriores se descartaron.
- La documentación aclara que el registro contiene eventos seleccionados y no es un historial completo.

## 1.2.1 — 2026-10-03

- **La consola tiene su propia columna.** Cuando el ping, la consulta DNS o la conexión salen bien, el panel de abajo muestra tres columnas: el recorrido, el resultado y la consola. Antes la consola quedaba debajo del resultado y, con una conexión TCP, no se veía. Si algo falla, la consola sigue plegada debajo del diagnóstico.

## 1.2.0 — 2026-10-03

- **Redirección de puertos (NAT de destino).** Un router o firewall puede publicar un servidor con IP privada. Lo que llega a la IP de su puerto con NAT por un protocolo y un puerto (por ejemplo TCP 80) se reenvía a un equipo de adentro, en el puerto que se elija. En el recorrido aparece el paso «Redirigir el puerto (NAT de destino)». En las tramas y en la captura se ve el puerto público afuera y el interno adentro, y la respuesta vuelve con el origen público del router. El ping a esa IP lo sigue respondiendo el router.
- **Pestaña NAT** en routers y firewalls: muestra qué puertos hacen NAT de origen y permite agregar y quitar redirecciones.
- **Falla nueva para laboratorios: «Sin redirección».** Quita una redirección. Desde afuera, el pedido lo recibe el router, que no da servicios: D31.
- **Ejemplo nuevo: Servidor publicado con redirección de puertos.** Es el de los dos sitios, pero con el servidor de la oficina en una IP privada.
- En un desafío, el archivo del alumno sale sin redirecciones, igual que sin el resto del direccionamiento.

## 1.1.0 — 2026-10-03

- **Internet une sitios.** Si la IP pública de destino es de un equipo del lienzo, la nube de Internet ya no responde ella: le lleva el paquete hasta el sitio de ese equipo. Cada sitio puede tener su propia nube, pero todas son la misma internet, y el paquete cruza de una a la otra. En el recorrido aparece el paso «Cruzar internet hacia …». En *Cómo viaja el paquete* y en la captura, el tramo de una nube a la otra figura «por internet». La animación pasa de una nube a la otra. La respuesta vuelve por el mismo camino, y el NAT la traduce al llegar.
- **Diagnóstico nuevo D34, «Internet no llega hasta ese equipo».** Aparece cuando la IP es de un equipo del lienzo pero su sitio no está conectado a ninguna nube, o está caído el cable o apagado el router entre la nube y el sitio. Falla el ping, y también cualquier conexión.
- **Ejemplo nuevo: Dos sitios por internet.** Una PC en su casa, detrás de un router con NAT, consulta un servidor web de la oficina por su IP pública.
- Las demás IP públicas las sigue respondiendo la nube (y al conectarse a una IP sin servicio, D33).

## 1.0.3 — 2026-10-03

- **Conectar ya no da éxito con un servidor al que el paquete no llega.** Antes, un servidor con IP pública detrás de otra nube de Internet «atendía» la conexión aunque estuviera desenchufado, porque la nube contesta el ping a cualquier IP pública. Ahora atiende sólo el equipo al que llegó el paquete, y un objetivo «conectar» de un laboratorio ya no puede dar «cumple» con el servidor desconectado.
- **Diagnóstico nuevo D33, «Nadie atiende en esa IP de internet».** Al conectarse a una IP pública donde no hay ningún servidor, el SYN se reintenta sin respuesta, ni siquiera un RST, y la conexión se abandona por tiempo agotado. Antes daba D31 (puerto cerrado), como si ahí hubiera un equipo. Si la IP es de un equipo de otro sitio del lienzo, el diagnóstico lo explica: la nube de Internet todavía no reenvía hacia otros sitios.
- **DNS:** un servidor DNS de otro sitio ya no contesta una consulta que terminó en la nube. Da D29 y explica por qué.
- **smtp.google.com** atiende SMTP (TCP 25), y los servidores de la jerarquía DNS (raíz, TLD y autoritativos) atienden en el 53.
- Con dos sitios que usan la misma IP privada, atiende el equipo de la propia red.

## 1.0.2 — 2026-10-03

- **Captura:** guarda los últimos 500 paquetes. La numeración sigue, y la pestaña avisa «se muestran los últimos 500». En una clase larga ya no se pone lenta.
- **Textos de ejemplo:** los de los campos terminan en «…», para que no se confundan con un valor cargado.
- **Títulos:** reparten mejor sus líneas.
- **Movimiento reducido:** con esa opción del sistema, la interfaz no anima transiciones.

## 1.0.1 — 2026-10-03

- Crédito de Open Tecnología, junto a la versión en la pestaña Ayuda, con un enlace a opentecnologia.ar.

## 1.0.0 — 2026-10-03

Primera versión numerada: todo lo que el simulador ya hace.

**Armar y configurar la red**
- PC, servidores, routers (estándar o tipo MikroTik), firewalls, switches de 8, 24 o 48 puertos, hubs, cámaras, IoT, puntos de acceso y una nube Internet. Se conectan por cobre, fibra o inalámbrico.
- Direccionamiento estático o por DHCP, rutas a mano, NAT de salida y reglas de filtrado por red, protocolo, puerto y puerto de entrada.
- Servidores con servicios TCP y UDP, y un DNS propio con su zona (A, CNAME, MX y NS).

**Ver cómo viaja el paquete**
- Ping paso a paso: la decisión con IP «AND» máscara, la puerta de enlace, ARP, las tablas de rutas y la vuelta.
- Capas OSI y TCP/IP en cada paso, y las tramas de cada tramo con su encapsulamiento.
- *Conectar* muestra el socket, el handshake de TCP, el pedido y la respuesta, y el cierre.
- *Consultar DNS* muestra la resolución recursiva e iterativa por la jerarquía, como `nslookup`.
- Captura por cable, al estilo Wireshark, con filtro y detalle por capas.
- Calidad del enlace (latencia, jitter y pérdida) y ping de varios paquetes con estadísticas.
- Dominios de colisión y de broadcast pintados sobre el lienzo.
- Diagnósticos D01 a D32, que explican cada falla en lenguaje de la materia.

**Para la clase**
- Cálculo de subred en binario y verificación de diseños VLSM.
- Animación de DHCP (DORA).
- Ejemplos de topologías (estrella, bus, malla, WAN, dos ISP con peering y tránsito).
- Laboratorios de diagnóstico con fallas y objetivos. En modo Docente, la pestaña *Laboratorio* los arma en pantalla, y *Exportar para el alumno* genera la versión que se reparte.
- Modo presentación, tema claro y oscuro, deshacer y rehacer, y autoguardado.

**Accesibilidad y celular**
- Se usa entero con el teclado: el foco no se pierde, las pestañas se recorren con flechas y el primer Tab lleva al lienzo.
- El tema arranca como el del sistema, con buen contraste en los dos.
- Diseño de celular en vertical y en horizontal, con la barra Agregar, Configurar y Ping siempre a la vista.
