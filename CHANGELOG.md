# Cambios

Cada versión de OpenRedLab tiene su entrada, de la más nueva a la más vieja. La versión se ve en la pestaña **Ayuda** del simulador.

Los números siguen la forma MAYOR.MENOR.PARCHE:

- **MAYOR:** cambia el formato de los archivos de red, o un laboratorio hecho con la versión anterior hay que rehacerlo.
- **MENOR:** algo nuevo para usar en clase, como un tema de la materia, un tipo de falla, una pestaña o un ejemplo.
- **PARCHE:** arreglos.

Los archivos de red llevan el número de su formato (`version`) y la versión del simulador que los exportó (`generador`). Un archivo de un formato anterior se actualiza solo al abrirlo.

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
