# OpenRedLab

**Simulador de redes para aprender direccionamiento IP, subredes y diagnóstico.** Armás una red en el navegador, configurás direcciones, máscaras, puertas de enlace y rutas, y al hacer ping ves el recorrido del paquete paso a paso. Si falla, el simulador te dice en qué paso se cortó y por qué.

**Usalo online:** https://fhleonardi.github.io/openredlab/

No hace falta instalar nada: es un único archivo HTML, sin dependencias y sin conexión a internet. También podés descargar [`index.html`](index.html) y abrirlo con doble clic. Tu trabajo se guarda solo en el navegador: la próxima vez que lo abras, te ofrece recuperarlo.

**Guías:** [para el alumno](docs/guia-rapida-alumno.md) · [para docentes](docs/guia-docente.md), que explica cómo usarlo en clase y cómo armar laboratorios y desafíos.

## Qué podés hacer

- **Armar la red** con PC, routers, firewalls, switches, cámaras, dispositivos IoT, puntos de acceso y una nube Internet, unidos por cables de cobre, fibra o enlaces inalámbricos.
- **Elegir el equipo como en la realidad:** un router estándar (g0/0, fib0…) o tipo MikroTik (ether1, sfp1…), un firewall (wan, lan, dmz), switches de 8, 24 o 48 puertos. En routers y firewalls podés agregar o quitar puertos y elegir el medio de cada uno.
- **Hacer ping** entre equipos o a un nombre (google.com) y seguir el recorrido: la decisión con IP «AND» máscara, la puerta de enlace, ARP, las tablas de rutas de cada router y la vuelta de la respuesta.
- **Ver las capas y el encapsulamiento:** cada paso del recorrido dice en qué capa ocurre (modelos OSI y TCP/IP), y *Cómo viaja el paquete* muestra las tramas de cada tramo: cambian las MAC en cada router, el paquete IP conserva su origen y su destino y el TTL baja uno por router.
- **Entender las fallas:** cada problema tiene un diagnóstico (D01 a D27) que explica qué pasó en lenguaje llano y sugiere qué revisar: máscara mal elegida, puerta de enlace fuera de la red, ruta de vuelta faltante, IP duplicada, cable caído, regla de filtrado, entre otros.
- **Calcular subredes** con el equipo seleccionado: IP y máscara en binario, clase de la IP (y si es privada o pública), red, broadcast, rango de hosts y si la puerta de enlace está en la red.
- **Ver DHCP** con los cuatro mensajes DORA animados sobre los cables.
- **Filtrar tráfico** con reglas en el router, que revisa cada paquete, o en un firewall, que recuerda las conversaciones y deja volver las respuestas.
- **Verificar un diseño VLSM:** el de un desafío del docente o uno propio. En una red armada por vos, el simulador detecta los sectores solo y revisa subredes solapadas o desalineadas y puertas de enlace; si cargás los hosts de cada sector y el bloque, también revisa si alcanzan.
- **Resolver laboratorios de diagnóstico:** redes con fallas plantadas y objetivos que hay que cumplir. En un laboratorio el simulador no avisa las fallas mientras configurás: encontrarlas es el ejercicio.
- Exportar e importar la red como JSON, deshacer y rehacer, tema oscuro y modo presentación para el aula.

## Escenarios

En el selector **Ejemplos…** vienen redes listas: una básica, dos subredes, un complejo turístico completo, el mismo complejo con fallas, un desafío VLSM y un router de 8 puertos.

En [`escenarios/`](escenarios/) hay archivos para abrir con **Importar** o arrastrándolos al lienzo:

| Archivo | Para qué |
|---|---|
| `lab1-ALUMNO.json` | Lab 1: un solo problema |
| `lab2-ALUMNO.json` | Lab 2: tres problemas |
| `lab3-ALUMNO.json` | Lab 3: el problema invisible |
| `desafio-complejo-termal.json` | Desafío VLSM: Complejo Termal Río Verde, sin direccionar |

## Para docentes

- La [guía para docentes](docs/guia-docente.md) explica el uso en clase, cómo armar laboratorios y desafíos, y el formato de los archivos.
- En modo **Docente**, el botón **Exportar para el alumno** genera la versión que se reparte: la red con las fallas aplicadas y sin la lista de fallas.
- Las versiones docentes de los laboratorios incluidos, con la red resuelta, no se publican para que los alumnos no tengan las soluciones a mano. Si las necesitás, pedíselas al autor. Para armar las tuyas, el ejemplo **Complejo roto (docente)** sirve de plantilla.

## Cómo está hecho

Cinco capas en JavaScript sin dependencias. Cada una tiene sus propias autopruebas y no conoce a las siguientes:

| Capa | Archivo | Qué hace |
|---|---|---|
| 1 | [`capa1-red.js`](capa1-red.js) | Aritmética de direcciones: máscaras, subredes, binario |
| 2 | [`capa2-motor.js`](capa2-motor.js) | El motor: ping paso a paso, ARP, rutas, DHCP, DNS, filtrado y diagnósticos |
| 3 | [`capa3-escenarios.js`](capa3-escenarios.js) | Validación, importar y exportar, ejemplos, laboratorios, modelos de equipos y verificación VLSM |
| 4 | [`capa4-ui.js`](capa4-ui.js) | La interfaz: lienzo, paleta, propiedades y paneles |
| 5 | [`capa5-autotest.js`](capa5-autotest.js) | Arranque y Autotest |

`index.html` se genera a partir de las cinco capas; no se edita a mano. Después de cambiar una capa:

```sh
python3 herramientas/ensamblar.py              # reescribe index.html
python3 herramientas/ensamblar.py --verificar  # comprueba que coincida con las capas
```

Para probar, abrí `index.html` en el navegador. El botón **Autotest** muestra los casos de redes; en la consola, `Autotest.correr({ tecnico: true })` corre además los criterios de la interfaz y las autopruebas de las capas 1 a 3 (también disponibles por separado: `Red.autopruebas()`, `Motor.autopruebas()`, `Escenarios.autopruebas()`).

**Carpetas del repositorio:**

| Carpeta | Contenido |
|---|---|
| raíz | `index.html` y las cinco capas |
| [`docs/`](docs/) | Las guías para alumnos y docentes |
| [`escenarios/`](escenarios/) | Laboratorios y desafíos para importar |
| [`herramientas/`](herramientas/) | El ensamblador de `index.html` |

## Simplificaciones

Es una herramienta para aprender, no un emulador: las rutas se cargan a mano (no hay OSPF, BGP ni RIP), no hay VLAN, NAT ni IPv6, el único tráfico es el ping, DHCP reparte un rango por router y sin relay, y el wireless se modela por distancia. La pestaña **Ayuda** del simulador lista todas.

## Reportar un problema

Si algo no funciona como esperabas o un diagnóstico explica mal lo que pasó, abrí un [issue](https://github.com/fhleonardi/openredlab/issues) con la red exportada (*Exportar*) y los pasos para reproducirlo.

## Licencia

[MIT](LICENSE) © 2026 Francisco Leonardi
