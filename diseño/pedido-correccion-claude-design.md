# Correcciones al layout del Simulador de Redes

El diseño "Simulador de Redes — Layout" (8 pantallas) va bien encaminado y la mayor parte se adopta tal cual. Pero algunas pantallas muestran resultados que el simulador no produce, y en un simulador para enseñar eso es un error de contenido, no de estilo. Abajo están los datos reales, sacados del motor, para reemplazar los inventados.

## Lo que se mantiene

- Diagnóstico con el código visible (D09), título, explicación que nombra al equipo y recuadro "Qué revisar".
- Paso fallido destacado, con el AND en monoespaciada.
- Estado de reposo con indicación ("Elegí un origen y un destino, y apretá Ping").
- En celular: hojas inferiores (Configurar, Resultado, Agregar), colocar tocando el lienzo, máscara como lista "/27 — 255.255.255.224", botón "Ir a configurar PC-Admin", punto de acceso en la paleta.
- Para la falla en escritorio queda **la variante B (A4, diagnóstico en columna)**. La A3 se descarta: el recuadro a lo ancho empuja el paso fallido fuera de la vista.

## 1. Ping exitoso (A2): recorrido real

PC-Admin → 10.45.7.122 en la topología `complejo` produce **12 pasos, no 18**:

| n | Título | Detalle |
|---|---|---|
| 1 | Verificar que el origen esté encendido y su interfaz habilitada | pc-admin encendido: sí. Interfaz eth0 habilitada: sí. |
| 2 | Verificar el enlace de la interfaz | Enlace l-admin-pc (ethernet) en up. |
| 3 | Verificar IP y máscara del origen | pc-admin usa 10.45.7.66/27 (255.255.255.224). Red: 10.45.7.64. |
| 4 | Comparar redes de origen y destino (pc-admin) | **Distinta red: hay que usar la puerta de enlace.** |
| 5 | Verificar puerta de enlace configurada | pc-admin usa el gateway 10.45.7.65. |
| 6 | Verificar que el gateway pertenezca a la subred | 10.45.7.65 AND máscara → 10.45.7.64 |
| 7 | Resolver el gateway por ARP | El gateway 10.45.7.65 respondió con su MAC. |
| 8 | Buscar ruta en R1 | Ruta 10.45.7.120/29 vía 10.45.7.130 (prefijo más largo). |
| 9 | Avanzar al siguiente salto (TTL 8) | El paquete sale por R1:fib0. Quedan 7 saltos. |
| 10 | Comparar redes de origen y destino (R2) | Misma red: entrega directa. |
| 11 | Entrega directa por ARP | El switch no mira direcciones IP: reenvía por la MAC de destino. |
| 12 | Verificar que el destino pueda responder | Se repite el camino en sentido inverso, de Servidor hacia 10.45.7.66. |

- El paso 4 del mockup dice "misma red, entrega directa". Es **distinta red**, y esa es justamente la decisión que la herramienta enseña.
- "14. Buscar ruta en R2" no existe: el servidor está en una red conectada a R2 y se entrega directo (pasos 10 y 11).
- El resumen colapsado puede mostrar 4, 8, 10 y 12, con el botón "Ver los 12 pasos".
- Contador: "12 de 12 verificaciones correctas".

## 2. Una sola respuesta, no cuatro

El simulador manda **un** eco. Reemplazar:

- Banda de éxito: "El eco volvió en 4 ms." (sin "4 de 4 respuestas" ni "de media").
- Ruta y TTL correctos: "PC-Admin → R1 → R2 → Servidor · 3 saltos · TTL 61".
- Consola:
  ```
  Respuesta desde 10.45.7.122: bytes=32 tiempo=4ms TTL=61
  Estadísticas: 1 enviados, 1 recibidos, 0 perdidos.
  ```

## 3. Falla (A4 y B3): sin "de N"

Cuando el ping falla, el simulador no sabe cuántos pasos habría tenido. Reemplazar "se detuvo en el paso 6 de 18" por **"se detuvo en el paso 6"**. Los pasos siguientes en gris pueden quedar, rotulados "no se llegó a verificar", pero sin total. "Ver los 18 pasos" pasa a "Ver los 6 pasos". Los pasos 1 a 6 del D09 ya coinciden con el motor.

## 4. Consola en español

Todo el texto va en español rioplatense (restricción del proyecto). "Pinging 10.45.7.122 from 10.45.7.66 ..." pasa a:

```
El ping de pc-admin a 10.45.7.122 falló.
D09 · La puerta de enlace está fuera de tu subred
```

## 5. Dónde se detuvo el paquete (B3)

D09 es una decisión que toma el propio equipo de origen: el paquete **nunca sale** de PC-Admin. El punto rojo va sobre PC-Admin ("el paquete no salió de acá"), no a mitad del cable. Criterio general: el marcador va en el dispositivo o en el enlace donde el motor cortó. Si el último salto registrado es el origen, el marcador va en el origen.

## 6. Topología real (B1, B3 y B4)

El celular muestra la topología anterior, con PC-Huéspedes cableado a SW-Admin y asociado directo a IOT. La actual tiene **12 equipos**:

| Equipo | Tipo | Dirección |
|---|---|---|
| PC-Huéspedes | pc, wlan0 en modo cliente | 10.45.7.10/26, gw 10.45.7.1 |
| IOT-Huéspedes | iot, wlan0 en modo cliente | 10.45.7.20/26, gw 10.45.7.1 |
| R1 | router inalámbrico | g0/0 .65/27, g0/1 .97/28, fib0 .129/30, wlan0 .1/26 (modo ap) |
| SW-Admin | switch | — |
| PC-Admin | pc | 10.45.7.66/27, gw 10.45.7.65 |
| AP-Admin | punto de acceso | — |
| Notebook-Admin | pc, wlan0 en modo cliente | 10.45.7.67/27, gw 10.45.7.65 |
| SW-Cámaras | switch | — |
| CAM-Entrada | cámara | 10.45.7.100/28, gw 10.45.7.97 |
| R2 | router | g0/0 .121/29, fib0 .130/30 |
| SW-Servidores | switch | — |
| Servidor | pc | 10.45.7.122/29, gw 10.45.7.121 |

Enlaces:
- Inalámbricos: R1 → PC-Huéspedes, R1 → IOT-Huéspedes, AP-Admin → Notebook-Admin. Salen del AP hacia cada cliente; no hay enlaces entre clientes.
- Cobre: PC-Admin, R1:g0/0 y AP-Admin a SW-Admin; CAM-Entrada y R1:g0/1 a SW-Cámaras; Servidor y R2:g0/0 a SW-Servidores.
- Fibra: R1:fib0 – R2:fib0.

El encabezado pasa a decir "12 equipos".

## 7. Reglas del lienzo que el mockup no respeta

- **Puertos:** cada cable termina en un marcador de puerto sobre el perímetro del ícono, nunca en el centro ni en el borde liso. Es un criterio de aceptación automático.
- **Rótulos completos:** "IOT-Huéspedes", no "IOT-Huésp.". En escritorio el rótulo tiene tres líneas cortas (nombre, IP/prefijo, "gw …") con fondo del color del lienzo. En celular el gateway puede omitirse, pero el nombre nunca se trunca.
- **Color del enlace.** Hoy el color indica el **estado** (verde activo, rojo caído) y la forma indica el **medio** (trazo lleno cobre, trazo grueso con brillo fibra, punteado curvo wireless). El mockup pinta la fibra de naranja y la dibuja punteada, parecida al Wi-Fi. Mantener color = estado y forma = medio, y no usar dos punteados. Una fibra caída tiene que poder verse roja.

## 8. Franja inferior en escritorio

- **Alto.** El mockup usa 340 px, y a 1366×768 eso deja al lienzo unos 300 px. Diseñar la franja para **260 px** como máximo. Si la variante B no entra, el recorrido puede desplazarse dentro de su caja; el diagnóstico nunca.
- **Botones estables.** Verificar, Copiar registro, Exportar registro y Autotest aparecen y desaparecen entre A1, A2 y A4. Tienen que estar siempre, en la misma posición; si no aplican, van deshabilitados.

## 9. Panel de cálculo en celular (B2)

Agregar el bloque del AND del gateway debajo de los binarios: IP AND máscara → red, y gateway AND máscara → red, con la comparación. Hoy solo dice "Tu gateway pertenece a tu subred". Ese bloque es un criterio de aceptación del panel.

## Falta diseñar

- Escritorio completo a 1366×768: lienzo, paleta y panel de propiedades con la franja inferior. El lienzo conserva al menos el 55 % del ancho.
- Tema oscuro.
- Modo presentación (F): sin paletas laterales y rótulos un 25 % más grandes.

El resultado se implementa en JavaScript vanilla y SVG, en un único HTML sin dependencias ni fuentes remotas. React y el CDN del mockup no pasan al producto: diseñá pensando en eso (sin animaciones que dependan de una librería).
