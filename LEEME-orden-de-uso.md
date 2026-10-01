# Cómo usar estos documentos

## La regla

**Cada turno: documento BASE + un documento de capa. Nada más.** Nunca dos capas en el mismo pedido.

El BASE trae el contexto, el modelo de datos y —lo importante— la **API pública de las cinco capas**. Por eso la capa 4 puede llamar a `Red.desglose()` sin haber visto nunca el código de la capa 1: la firma está en el contrato. Eso es lo que evita el problema de ir pidiendo "agregá esto al archivo anterior", donde el modelo tiene que reescribir todo lo que no hizo él y se pierden cosas en silencio.

## El orden

| Turno | Pegás | Guardás la salida como |
|---|---|---|
| 1 | BASE + `01-capa1-red.md` | `capa1-red.js` |
| 2 | BASE + `02-capa2-motor.md` | `capa2-motor.js` |
| 3 | BASE + `03-capa3-escenarios.md` | `capa3-escenarios.js` |
| 4 | BASE + `04-capa4-ui.md` | `capa4-ui.js` |
| 5 | BASE + `05-capa5-ensamblado.md` | `index.html` |

Cada capa termina con su propia función de autopruebas. **Antes de pasar al turno siguiente, corré la del turno actual.** Es un archivo `.js` suelto: abrilo en la consola del navegador (o con `node`) y llamá a `Red.autopruebas()`. Si hay fallos, corregilos antes de seguir; si arrastrás un error de la capa 1 hasta la 4, encontrarlo después cuesta mucho más.

## Dónde conviene auditar

La **capa 1** es la que hay que mirar con lupa, y es la más barata de auditar porque son unas 400 líneas de funciones puras. Un botón feo se ve a simple vista; un broadcast mal calculado no, y se propaga a todo lo demás sin hacer ruido.

Si querés usar un segundo modelo para revisar, usalo ahí, y pedile algo concreto:

> Revisá estas funciones de aritmética de direccionamiento IP sin reescribirlas. Buscá errores de signo en las operaciones bit a bit, casos borde en /31 y /32, y prefijos que cortan dentro de un octeto. Para cada problema indicá: función afectada, causa, corrección concreta, y un caso de prueba que lo demuestre.

Para las capas 2 a 4 el autotest hace gratis casi todo ese trabajo, y de forma reproducible. Donde un segundo modelo sí aporta es en algo que ningún test puede juzgar: si los mensajes de diagnóstico D01–D17 están bien explicados para un alumno de segundo año. Eso conviene leerlo vos.

## Si una capa sale corta o mal

No le pidas al modelo que "arregle y devuelva todo de nuevo". Pedile **sólo la función que falla**, con su firma del contrato, y reemplazala a mano en el archivo. Las capas son independientes justamente para eso.

## Sobre los modelos

Los modelos gratuitos de OpenCode figuran como promoción por tiempo limitado, así que no armes el flujo alrededor de uno en particular. Antes de comprometerte con uno, hacé una prueba canario: dale la capa 1 a dos o tres candidatos con el mismo texto y compará las salidas contra la tabla de casos obligatorios del documento. Veinte minutos, y tenés datos en vez de un ranking.

La capa 1 es además el mejor termómetro posible: si un modelo no clava `cantidadHosts(8) === 16777214` ni `estaAlineada("10.45.7.132", 28) === false`, no le confíes el motor de simulación.

## Reensamblar el archivo final

El archivo final, `index.html`, es un derivado: cada bloque `<script>` lleva exactamente el código de una capa. **Nunca se edita el HTML a mano**: se corrige el `.js` de la capa y se reensambla.

```
python3 herramientas/ensamblar.py              # reescribe index.html
python3 herramientas/ensamblar.py --verificar  # sólo compara; sale con 1 si difiere
```

Corré `--verificar` antes de entregar el archivo o de commitear. Si una capa cambió y el HTML no, el Autotest del navegador sigue probando la versión vieja y el error pasa desapercibido: ya ocurrió una vez con la capa 4. La herramienta usa sólo la biblioteca estándar de Python y no forma parte del producto.
