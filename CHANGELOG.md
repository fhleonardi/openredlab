# Cambios

Cada versión de OpenRedLab tiene su entrada, de la más nueva a la más vieja. La versión se ve en la pestaña **Ayuda** del simulador.

Los números siguen la forma MAYOR.MENOR.PARCHE:

- **MAYOR:** cambia el formato de los archivos de red, o un laboratorio hecho con la versión anterior hay que rehacerlo.
- **MENOR:** algo nuevo para usar en clase, como un tema de la materia, un tipo de falla, una pestaña o un ejemplo.
- **PARCHE:** arreglos.

Los archivos de red llevan el número de su formato (`version`) y la versión del simulador que los exportó (`generador`). Un archivo de un formato anterior se actualiza solo al abrirlo.

## 1.0.3 — 2026-10-03

- **Conectar ya no da éxito con un servidor al que el paquete no llega.** Antes, un servidor con IP pública detrás de otra nube de Internet «atendía» la conexión aunque estuviera desenchufado, porque la nube contesta el ping a cualquier IP pública. Ahora atiende sólo el equipo al que llegó el paquete, y un objetivo «conectar» de un laboratorio ya no puede dar «cumple» con el servidor desconectado.
- **Diagnóstico nuevo D33, «Nadie atiende en esa IP de internet».** Al conectarse a una IP pública donde no hay ningún servidor, el SYN se reintenta sin respuesta, ni siquiera un RST, y la conexión se abandona por tiempo agotado. Antes daba D31 (puerto cerrado), como si ahí hubiera un equipo. Si la IP es de un equipo de otro sitio del lienzo, el diagnóstico lo explica: la nube de Internet todavía no reenvía hacia otros sitios.
- **DNS:** un servidor DNS de otro sitio ya no contesta una consulta que terminó en la nube. Da D29 y explica por qué.
- **smtp.google.com** atiende SMTP (TCP 25).
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
