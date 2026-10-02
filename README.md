# OpenRedLab

**Simulador de redes para aprender direccionamiento IP, subredes y diagnóstico.** Armás una red en el navegador, configurás direcciones, máscaras, puertas de enlace y rutas, y al hacer ping ves el recorrido del paquete paso a paso. Si falla, el simulador te dice en qué paso se cortó y por qué.

**Usalo online:** https://fhleonardi.github.io/openredlab/

No hace falta instalar nada: es un único archivo HTML, sin dependencias y sin conexión a internet. También podés descargar [`index.html`](index.html) y abrirlo con doble clic.

Para empezar, leé la [guía rápida para el alumno](docs/guia-rapida-alumno.md).

## Qué podés hacer

- **Armar la red** con PC, routers, firewalls, switches (8, 24 o 48 puertos), cámaras, dispositivos IoT, puntos de acceso y una nube Internet, unidos por cables de cobre, fibra o enlaces inalámbricos.
- **Hacer ping** entre equipos o a un nombre (google.com) y seguir el recorrido: la decisión con IP «AND» máscara, la puerta de enlace, ARP, las tablas de rutas de cada router y la vuelta de la respuesta.
- **Entender las fallas:** cada problema tiene un diagnóstico (D01 a D27) que explica qué pasó en lenguaje llano y sugiere qué revisar: máscara mal elegida, puerta de enlace fuera de la red, ruta de vuelta faltante, IP duplicada, cable caído, regla de filtrado, entre otros.
- **Calcular subredes** con el equipo seleccionado: IP y máscara en binario, red, broadcast, rango de hosts y si la puerta de enlace está en la red.
- **Ver DHCP** con los cuatro mensajes DORA animados sobre los cables.
- **Filtrar tráfico** con reglas en el router (que revisa cada paquete) o en un firewall (que recuerda las conversaciones y deja volver las respuestas).
- **Verificar un diseño VLSM**, el tuyo o el de un desafío del docente: subredes solapadas o desalineadas, capacidad para los hosts pedidos y puertas de enlace.
- **Resolver laboratorios de diagnóstico:** redes con fallas plantadas y objetivos que hay que cumplir.
- Exportar e importar la red como JSON, deshacer y rehacer, tema oscuro y modo presentación para el aula.

## Escenarios

En el selector **Ejemplos…** vienen redes listas: una básica, dos subredes, un complejo turístico completo, el mismo complejo con fallas, un desafío VLSM y un router de 8 puertos.

En [`escenarios/`](escenarios/) hay archivos para abrir con **Importar**:

| Archivo | Para qué |
|---|---|
| `lab1-ALUMNO.json` | Lab 1: un solo problema |
| `lab2-ALUMNO.json` | Lab 2: tres problemas |
| `lab3-ALUMNO.json` | Lab 3: el problema invisible |
| `desafio-complejo-termal.json` | Desafío VLSM: Complejo Termal Río Verde, sin direccionar |

Las versiones docentes de los laboratorios, con la red resuelta, no se publican. Un docente puede armar las suyas con el ejemplo **Complejo roto (docente)** como plantilla.

## Cómo está hecho

Cinco capas en JavaScript sin dependencias. Cada una tiene sus propias autopruebas y no conoce a las siguientes:

| Capa | Archivo | Qué hace |
|---|---|---|
| 1 | [`capa1-red.js`](capa1-red.js) | Aritmética de direcciones: máscaras, subredes, binario |
| 2 | [`capa2-motor.js`](capa2-motor.js) | El motor: ping paso a paso, ARP, rutas, DHCP, DNS, filtrado y diagnósticos |
| 3 | [`capa3-escenarios.js`](capa3-escenarios.js) | Validación, importar y exportar, ejemplos, laboratorios y verificación VLSM |
| 4 | [`capa4-ui.js`](capa4-ui.js) | La interfaz: lienzo, paleta, propiedades y paneles |
| 5 | [`capa5-autotest.js`](capa5-autotest.js) | Arranque y Autotest |

`index.html` se genera a partir de las cinco capas; no se edita a mano. Después de cambiar una capa:

```sh
python3 herramientas/ensamblar.py              # reescribe index.html
python3 herramientas/ensamblar.py --verificar  # comprueba que coincida con las capas
```

Las autopruebas de las capas 1 a 3 se corren desde la consola del navegador (`Red.autopruebas()`, `Motor.autopruebas()`, `Escenarios.autopruebas()`) o con `node`. El botón **Autotest** muestra los casos de redes; `Autotest.correr({ tecnico: true })` corre además los criterios de la interfaz y las pruebas internas.

La especificación con la que se construyó cada capa, los contratos entre ellas y el diseño de la interfaz están en [`docs/`](docs/).

## Simplificaciones

Es una herramienta para aprender, no un emulador: las rutas se cargan a mano (no hay OSPF, BGP ni RIP), no hay VLAN, NAT ni IPv6, el único tráfico es el ping y el wireless se modela por distancia. La pestaña **Ayuda** del simulador lista todas.

## Licencia

[MIT](LICENSE) © 2026 Francisco Leonardi
