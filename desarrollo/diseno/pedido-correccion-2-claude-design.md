# Segunda ronda de correcciones al layout del Simulador de Redes

La versión corregida resolvió todo lo de contenido: los pasos, el eco, el TTL, la consola, el diagnóstico D09 y la topología de 12 equipos coinciden con el simulador real. El tema oscuro y el modo presentación con la franja reducida a una línea de estado se adoptan tal cual.

Lo que queda es de dibujo. Son siete puntos; los cinco primeros van antes de implementar.

## 1. Rótulos cruzados por cables (C1, C2, C3)

Varios cables pasan por encima del texto:
- la línea punteada de PC-Huéspedes atraviesa "10.45.7.10/26";
- el cable R1–SW-Admin pasa sobre "g0/0 10.45.7.65/27";
- el cable SW-Servidores–Servidor cruza el nombre "SW-Servidores".

Cada línea de rótulo lleva detrás un rectángulo del color de fondo del lienzo, con opacidad cercana al 90 %, unos 3 px de margen y el ancho real del texto. El rótulo se dibuja por encima de los cables, así el texto siempre se lee aunque un cable pase por detrás. En el tema oscuro, el rectángulo toma el fondo oscuro del lienzo.

## 2. La fibra es recta

En la leyenda, la curva es la forma del wireless ("punteado curvo"). La fibra R1–R2 está dibujada curva y además pasa rozando AP-Admin.

- Fibra: trazo recto, grueso, con brillo.
- Wireless: punteado y curvo, siempre saliendo del punto de acceso hacia cada cliente.
- Si la recta entre R1 y R2 cruza un equipo, se mueve el equipo, no se curva el cable.

## 3. Routers: todas sus direcciones, con el nombre de la interfaz

Hoy R1 muestra 2 de sus 4 direcciones (wlan0 y g0/0), y R2 muestra las dos que tiene. El criterio es uno solo para todos los routers: **todas las direcciones, una por línea, precedidas por el nombre de la interfaz**. Es justamente lo que se quiere enseñar: el router tiene una IP en cada red que conecta.

```
R1
g0/0  10.45.7.65/27
g0/1  10.45.7.97/28
fib0  10.45.7.129/30
wlan0 10.45.7.1/26
```

Monoespaciada, 14 px como mínimo, con el mismo fondo del punto 1. Los switches y el punto de acceso sin IP siguen diciendo "sin IP".

## 4. Topología en celular (B1)

- La fibra R1–R2 baja en línea recta por detrás de SW-Admin, y parece un cable de SW-Admin a R2. **Ningún enlace pasa por detrás de un equipo.** Hay que reubicar R2 o SW-Admin para que la fibra tenga camino libre.
- El encabezado dice "12 equipos" pero se ven 8. Hay dos opciones:
  - mostrar la topología completa con un zoom inicial que entre en pantalla, con los rótulos a 12 px como mínimo en celular;
  - dejarla desplazable con un indicador visible.
- La leyenda tapa el aviso "…más abajo · arrastrá para ver". La leyenda se colapsa a un botón "Leyenda", o el aviso se mueve arriba.

## 5. Selector de cable en celular (B4)

La fibra sigue naranja y punteada. Tiene que verse igual que en la leyenda: verde, trazo lleno grueso con brillo. Los tres tipos de cable se distinguen por la forma, nunca por el color, porque el color indica el estado del enlace.

## 6. La columna derecha no entra en 260 px (A4, C2)

Con el diagnóstico visible, la consola queda como una franja de la que solo se lee una línea cortada, y en A4 el botón "Ver los 6 pasos" se corta.

- Cuando hay un diagnóstico, la consola se colapsa a una sola línea ("consola · 2 líneas ▸") que se expande a pedido, o pasa a una pestaña.
- El diagnóstico se ve completo, sin desplazamiento.
- El recorrido puede desplazarse dentro de su caja, pero "Ver los 6 pasos" queda siempre visible.
- En el ping exitoso, la banda verde y la consola ya entran: no cambia.

## 7. Detalles menores

- **Escritorio a 100 %:** los íconos de PC-Huéspedes e IOT-Huéspedes quedan tapados por la barra de Deshacer / Rehacer / zoom. O la barra pasa a una franja propia sobre el lienzo, o la topología arranca con margen superior suficiente.
- **Selector del encabezado:** corta "Complejo turístico — 12 equip…". Ensanchar el selector o acortar el texto a "Complejo turístico".
- **Velocidad de animación:** el control aparece en A1 pero no en las demás pantallas de la franja. Tiene que estar siempre, en el mismo lugar.
- **Variante A3:** está marcada como descartada y se puede borrar del archivo.

## Sin cambios

Todo lo demás de esta versión queda aprobado: estructura de escritorio, tema oscuro, modo presentación, textos, pasos y diagnósticos, hojas inferiores del celular y panel de cálculo con el AND del gateway.
