# OpenRedLab — Guía rápida para el alumno

*Sistemas Operativos y Redes · Unidad 9: direccionamiento IP y subnetting*

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
| **Panel derecho** | La configuración del equipo seleccionado: IP, máscara y puerta de enlace; en la pestaña Interfaces, habilitar o deshabilitar cada puerto y, en las inalámbricas, el modo de radio (ap, cliente o bridge). En routers y switches también elegís el **modelo**. |
| **Franja de abajo** | Cuatro pestañas: Simulación (el ping), DHCP, Cálculo de subred y Ayuda. Con la tecla **F** (modo presentación) queda reducida a una línea para proyectar. |

## Lo primero que tenés que saber hacer

1. **Conectar dos equipos:** apretá *Conectar con un cable* en la columna izquierda, hacé clic en un puerto libre del primer equipo y después en un puerto libre del segundo. Si el puerto se atenúa, ese cable no va ahí.
2. **Configurar un equipo:** hacé clic sobre él y completá IP, máscara y puerta de enlace en el panel derecho.
3. **Probar:** en la pestaña **Simulación**, elegí el origen, escribí la IP de destino y apretá **Ping**.

## Cuando el ping falla — que es lo importante

El simulador no te dice sólo que falló. A la izquierda tenés el **recorrido paso a paso**: cada cosa que el sistema operativo verifica antes de mandar el paquete, y cuál de esos pasos se rompió, con la cuenta que dio mal. A la derecha aparece el **diagnóstico**: un título (al lado, un código chico como D09, que podés buscar en la tabla de abajo), una explicación, una sugerencia y el botón *Ir a configurar*, que te lleva al equipo. *Ver los pasos* muestra el detalle completo.

Los que más te van a aparecer:

| Código | Qué pasó | Por dónde empezar |
|---|---|---|
| **D01** | El equipo está apagado o su interfaz está deshabilitada | Panel derecho, pestaña Interfaces |
| **D02** | No hay conexión física | Mirá el cable en el lienzo: rojo y cortado es caído |
| **D07** | Dos equipos tienen la misma IP | Comparalas en el lienzo |
| **D08** | Falta la puerta de enlace | Panel derecho, puerta de enlace |
| **D09** | La puerta de enlace está fuera de tu red | Pestaña Cálculo de subred: fijate en el «AND» |
| **D11** | El router no sabe cómo llegar al destino | Pestaña Rutas del router |
| **D12** | La respuesta no puede volver | Rutas del router del **otro** lado |
| **D15** | Están en el mismo switch, pero en subredes distintas | Ni un switch ni un punto de acceso enrutan: hace falta un router |
| **D17** | El equipo está fuera del alcance inalámbrico | Acercalo a su punto de acceso |
| **D18** | Los modos de radio no son compatibles | Un cliente se asocia a un punto de acceso, no a otro cliente |
| **D19** | El equipo inalámbrico no está conectado a un punto de acceso | Que el AP esté encendido y con su radio en modo ap |
| **D20** | Nadie tiene esa IP en tu red | Que la IP de destino esté bien escrita y el equipo exista |
| **D23** | El paquete quedó dando vueltas entre routers | La ruta hacia ese destino en cada router del recorrido |
| **D27** | Una regla de filtrado bloqueó el paquete | Pestaña Filtrado del router o firewall: el orden de las reglas |

## La pestaña Cálculo de subred

Es la que más te conviene tener abierta mientras configurás. Seleccioná un equipo y vas a ver su dirección en binario, con los bits de red en un color y los de host en otro, y la línea donde corta la máscara. Cambiás el prefijo y la línea se mueve: eso es exactamente lo que hace la máscara.

A la derecha está **«¿Tu puerta de enlace (gateway) está en tu red?»**: muestra el «AND» de tu IP y el «AND» de tu puerta de enlace, uno debajo del otro. Si los dos resultados no son iguales, tu equipo no puede hablar con su propia puerta de enlace, y ahí está el problema. Ese cálculo es el mismo que hacés a mano en el TP.

## Verificar tu trabajo

El botón **Verificar** de la pestaña Simulación revisa lo que corresponda a la red abierta:

- en un **laboratorio**, si se cumplen los objetivos (por ejemplo, que la cámara llegue al servidor);
- en un **desafío VLSM**, el diseño contra lo que pide el enunciado: subredes que se solapan o no están alineadas, si alcanzan las direcciones para los hosts pedidos y si las puertas de enlace están bien;
- en una **red que armaste vos**, el mismo control de diseño, por sector. Si cargás cuántos hosts necesita cada sector y el bloque a repartir, también revisa si alcanzan.

## Wi-Fi: router inalámbrico y punto de acceso

Cada interfaz inalámbrica tiene un modo de radio, que elegís en la pestaña Interfaces del panel derecho. En modo **ap** sostiene la red Wi-Fi (la celda) y admite varios clientes; en modo **cliente** se asocia a un ap; en modo **bridge** une dos puntos a distancia. Dos clientes no se conectan entre sí: siempre hace falta un ap.

En el ejemplo *Complejo turístico* vas a ver los dos usos. **R1** es un router inalámbrico: su wlan0 en modo ap crea una subred nueva (10.45.7.0/26) para los huéspedes, y R1 enruta entre esa red y las demás. **AP-Admin** es un punto de acceso: cuelga del switch de Administración y extiende al aire una subred que ya existía (10.45.7.64/27). Un AP no enruta, igual que un switch.

El alcance es limitado: si alejás un cliente de su punto de acceso, el ping falla con D17.

## Qué entregar

- Captura del recorrido paso a paso con el diagnóstico, por cada problema que hayas encontrado.
- El registro de eventos: botón **Exportar registro** en la pestaña Simulación.
- Tu topología corregida: botón **Exportar** de la barra de arriba. Nombrala `ApellidoNombre_lab.json`.
- Una línea por problema explicando qué estaba mal y cómo lo arreglaste. El código del diagnóstico no alcanza como explicación.

> **Dos advertencias**
>
> El simulador **no reemplaza el cálculo a mano**. Si diseñás el direccionamiento acá a fuerza de probar hasta que deje de fallar, en el parcial —que es en papel— no te va a servir de nada. Calculá primero, verificá después.
>
> En los laboratorios de diagnóstico, el simulador **no te avisa de los errores mientras configurás**: tenés que encontrarlos vos. Es a propósito.
