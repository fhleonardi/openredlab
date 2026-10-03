/* capa2-motor.js — Capa 2: simulación y diagnóstico.
 *
 * Objeto global `Motor` con las firmas del §5 del BASE.
 * JavaScript vanilla, sin DOM, sin dependencias. Usa el objeto global `Red`
 * de la capa 1 para toda la aritmética de direccionamiento: acá no se
 * calcula ninguna máscara, red ni broadcast a mano.
 *
 * Idea central: lo que se enseña no es que el ping ande, sino por qué no anda.
 * Por eso `ping` devuelve los pasos ejecutados uno por uno y un diagnóstico
 * del catálogo D01–D17 con las direcciones concretas del caso.
 */

var Motor = (function () {
  "use strict";

  // Alcance máximo del enlace inalámbrico, en las mismas unidades que las
  // coordenadas x/y del lienzo. Es configurable: la capa 4 puede leerlo para
  // el tooltip y la prueba puede ajustarlo. Por defecto 250.
  var UMBRAL_WIRELESS = 250;

  // Tiempo de vida de las entradas ARP y MAC, en milisegundos.
  var VIDA_ARP_MS = 300000;
  var VIDA_MAC_MS = 300000;

  // TTL con el que sale cada paquete, como en un equipo real. Cada router le
  // resta uno; al llegar a 0 se descarta (y eso corta los bucles de rutas).
  var TTL_INICIAL = 64;

  // Las capas en las que ocurre cada paso del ping, en los dos modelos que
  // usa la materia: OSI y TCP/IP de cinco capas (como Stallings).
  var CAPAS = {
    1: { osi: "Física", tcpip: "Física", pdu: "bits" },
    2: { osi: "Enlace", tcpip: "Acceso a la red", pdu: "trama" },
    3: { osi: "Red", tcpip: "Internet", pdu: "paquete" },
    4: { osi: "Transporte", tcpip: "Transporte", pdu: "segmento" },
    7: { osi: "Aplicación", tcpip: "Aplicación", pdu: "mensaje" }
  };

  /* ---------------- Catálogo de diagnósticos ----------------
   * Cada entrada tiene un título corto, una explicación en lenguaje de aula
   * (qué pasó y por qué impide el ping, con los nombres visibles de los
   * equipos y las direcciones concretas) y una sugerencia de dónde mirar,
   * nunca la respuesta directa. La sugerencia puede depender del contexto. */

  function valor(dato, porDefecto) {
    return dato === undefined || dato === null || dato === "" ? porDefecto : dato;
  }

  var CATALOGO = {
    D01: {
      titulo: "El equipo está apagado o su interfaz está deshabilitada",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var puerto = ctx.interfaz && ctx.interfaz !== "?" ? "su puerto " + ctx.interfaz + " está deshabilitado" : "su interfaz está deshabilitada";
        return valor(ctx.origen, "El equipo") + " no puede enviar ni recibir nada: está apagado o " + puerto + ".";
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        return "Encendé el equipo y habilitá " + (ctx.interfaz && ctx.interfaz !== "?" ? ctx.interfaz : "la interfaz") +
          " en la pestaña Interfaces.";
      }
    },
    D02: {
      titulo: "No hay conexión física",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El puerto " + valor(ctx.interfaz, "?") + " de " + valor(ctx.origen, "el equipo") +
          " no tiene un cable conectado, o el cable está marcado como caído. Sin conexión física no sale ningún paquete.";
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        return "Conectá un cable a " + valor(ctx.interfaz, "ese puerto") +
          " o, si ya hay uno, seleccionalo y ponelo en estado activo.";
      }
    },
    D03: {
      titulo: "El cable no corresponde a los puertos",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.cable, "Ese cable") + valor(ctx.tipoCable, "") + ", pero une un puerto " +
          valor(ctx.medioA, "?") + " con uno " + valor(ctx.medioB, "?") +
          ". Cada puerto acepta un solo tipo de cable: de cobre, de fibra o inalámbrico.";
      },
      sugerencia: "Usá un cable del mismo tipo que los dos puertos, o conectalo a otro puerto."
    },
    D04: {
      titulo: "El equipo no tiene dirección IP",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El puerto " + valor(ctx.interfaz, "?") + " de " + valor(ctx.origen, "el equipo") +
          " no tiene dirección IP: sin una IP de origen no se puede armar el paquete.";
      },
      sugerencia: "Configurá una IP en la pestaña Configuración, o elegí el modo DHCP."
    },
    D05: {
      titulo: "La máscara no es válida",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La máscara configurada en " + valor(ctx.origen, "el equipo") + " no es válida (prefijo " +
          valor(ctx.prefijo, "?") + "), así que no se puede calcular a qué red pertenece.";
      },
      sugerencia: "Corregí la máscara en la pestaña Configuración: el prefijo va de 0 a 32."
    },
    D06: {
      titulo: "Esa IP no se puede asignar a un equipo",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var red = valor(ctx.red, "?") + "/" + valor(ctx.prefijo, "?");
        if (ctx.rol === "dirección de broadcast") {
          return valor(ctx.ip, "Esa IP") + " es la dirección de broadcast de " + red +
            ": se usa para hablarles a todos los equipos de la red a la vez.";
        }
        return valor(ctx.ip, "Esa IP") + " es la dirección de red de " + red + ": identifica a la red entera, no a un equipo.";
      },
      sugerencia: "Calculá el rango asignable en la pestaña Cálculo de subred y elegí una dirección dentro de él."
    },
    D07: {
      titulo: "Dos equipos tienen la misma IP",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.ip, "Esa IP") + " está configurada en " + valor(ctx.origen, "este equipo") + " y en " +
          valor(ctx.otro, "otro equipo") + ", que están en la misma red. Cuando alguien pregunta quién tiene esa IP (ARP) " +
          "responden los dos, y los paquetes llegan a cualquiera.";
      },
      sugerencia: "Cambiale la IP a uno de los dos equipos."
    },
    D08: {
      titulo: "Falta la puerta de enlace",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.destino, "El destino") + " está en otra red y " + valor(ctx.origen, "tu equipo") +
          " no tiene puerta de enlace: sin ella solo puede comunicarse con su propia red (" + valor(ctx.red, "?") + ").";
      },
      sugerencia: "Configurá la puerta de enlace predeterminada: es la IP del router en tu red."
    },
    D09: {
      titulo: "La puerta de enlace está fuera de tu red",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La puerta de enlace " + valor(ctx.gateway, "?") + " no pertenece a la red de " + valor(ctx.equipo, "tu equipo") +
          " (" + valor(ctx.red, "?") + "/" + valor(ctx.prefijo, "?") + "): con esa máscara, el equipo no la puede alcanzar.";
      },
      sugerencia: "Revisá la máscara del equipo o la dirección de la puerta de enlace: una de las dos está mal. " +
        "La pestaña Cálculo de subred muestra el AND de las dos."
    },
    D10: {
      titulo: "La puerta de enlace no responde",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La puerta de enlace " + valor(ctx.gateway, "?") + " está en la red correcta, pero cuando " +
          valor(ctx.origen, "el equipo") + " pregunta quién tiene esa IP (ARP), nadie responde. " +
          "El router puede no tener esa IP, o estar apagado o desconectado.";
      },
      sugerencia: "Verificá que el router tenga esa IP en el puerto conectado a tu red, y que esté encendido y cableado."
    },
    D11: {
      titulo: "El router no sabe cómo llegar al destino",
      explicacion: function (ctx) {
        ctx = ctx || {};
        if (ctx.internet) {
          return valor(ctx.destino, "Esa dirección") + " es una dirección privada: internet no la enruta y descarta el paquete. " +
            "El destino tendría que estar dentro de tu red, y algún router no tiene ruta hacia él (o la IP está mal escrita).";
        }
        if (ctx.noRouter) {
          return "Quien responde por la puerta de enlace es " + valor(ctx.router, "otro equipo") +
            ", que no es un router: no sabe reenviar paquetes a otra red.";
        }
        return valor(ctx.router, "El router") + " no tiene ninguna ruta que lleve a " + valor(ctx.destino, "ese destino") +
          ", ni una ruta por defecto, así que descarta el paquete.";
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        if (ctx.internet) { return "Revisá la IP de destino y las rutas de tus routers hacia esa red."; }
        if (ctx.noRouter) { return "Revisá la puerta de enlace del equipo: tiene que ser la IP del router de su red."; }
        return "Agregá en la tabla de rutas de " + valor(ctx.router, "ese router") +
          " una ruta hacia la red de destino, o una ruta por defecto.";
      }
    },
    D12: {
      titulo: "La respuesta no puede volver",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El paquete llegó a " + valor(ctx.destino, "destino") + ", pero la respuesta no encuentra el camino de regreso a " +
          valor(ctx.origen, "origen") + "." + (ctx.causa ? " En la vuelta: " + ctx.causa : "");
      },
      sugerencia: "Revisá la puerta de enlace del destino y las rutas de los routers en sentido contrario: la vuelta necesita su propio camino."
    },
    D13: {
      titulo: "El equipo de destino está apagado",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return (ctx.destinoNombre ? ctx.destinoNombre + " tiene la IP " + valor(ctx.destino, "?") : "El equipo con la IP " + valor(ctx.destino, "?")) +
          ", pero está apagado o su interfaz está deshabilitada, así que no responde.";
      },
      sugerencia: "Encendé el equipo de destino y habilitá su interfaz."
    },
    D14: {
      titulo: "Equipos de la misma red con máscaras distintas",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var a = (ctx.nombreA ? ctx.nombreA + " (" : "") + valor(ctx.ipA, "?") + "/" + valor(ctx.prefijoA, "?") + (ctx.nombreA ? ")" : "");
        var b = (ctx.nombreB ? ctx.nombreB + " (" : "") + valor(ctx.ipB, "?") + "/" + valor(ctx.prefijoB, "?") + (ctx.nombreB ? ")" : "");
        return a + " y " + b + " están conectados a la misma red física, pero con máscaras distintas cada uno calcula " +
          "una red diferente y no coinciden en quién está en su red.";
      },
      sugerencia: "Usá la misma máscara en todos los equipos de esa red."
    },
    D15: {
      titulo: "Están en el mismo switch, pero en subredes distintas",
      tituloAire: "Están en el mismo punto de acceso, pero en subredes distintas",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var aparato = ctx.aire ? "punto de acceso" : "switch";
        return valor(ctx.origen, "Tu equipo") + " (" + valor(ctx.redA, "?") + ") y " + valor(ctx.destinoNombre, "el destino") +
          " (" + valor(ctx.redB, "?") + ") están conectados al mismo " + aparato + ", pero en subredes diferentes. Un " + aparato +
          " no mira las direcciones IP, así que no puede pasar paquetes de una subred a otra: para eso hace falta un router.";
      },
      sugerencia: "Poné los dos equipos en la misma subred, o conectalos a través de un router."
    },
    D16: {
      titulo: "No se obtuvo una IP por DHCP",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return (ctx.motivo
          ? ctx.motivo
          : ctx.servidor
          ? "El servidor DHCP de " + ctx.servidor + " no tiene direcciones libres para ofrecer."
          : "Ningún servidor DHCP respondió en la red.") +
          " El equipo se asigna solo una dirección 169.254.x.x (APIPA) y no puede comunicarse con nadie.";
      },
      sugerencia: "Verificá que el router de esa red tenga el servidor DHCP habilitado y con direcciones libres en su rango."
    },
    D17: {
      titulo: "El equipo está fuera del alcance inalámbrico",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var quien = ctx.nombreA && ctx.nombreB
          ? ctx.nombreA + " está a " + valor(ctx.distancia, "?") + " m de " + ctx.nombreB
          : "Los dos equipos están a " + valor(ctx.distancia, "?") + " m";
        return quien + " y el alcance máximo es de " + valor(ctx.umbral, "?") + " m: la señal no llega.";
      },
      sugerencia: "Acercá el equipo al punto de acceso (arrastralo en el lienzo)."
    },
    D18: {
      titulo: "Los modos de radio no son compatibles",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var a = valor(ctx.nombreA, "Un equipo");
        var b = valor(ctx.nombreB, "otro equipo");
        if (ctx.modoA === "cliente" && ctx.modoB === "cliente") {
          return a + " y " + b + " están los dos en modo cliente, y dos clientes no se conectan entre sí: hace falta un punto de acceso.";
        }
        if (ctx.modoA === "ap" && ctx.modoB === "ap") {
          return a + " y " + b + " están los dos en modo punto de acceso, y dos puntos de acceso no se conectan entre sí: " +
            "un cliente se conecta a un punto de acceso.";
        }
        return "El enlace inalámbrico entre " + a + " y " + b + " une modos que no se entienden (" + valor(ctx.modoA, "?") +
          " con " + valor(ctx.modoB, "?") + "): solo funcionan cliente con ap, o bridge con bridge.";
      },
      sugerencia: "Poné uno de los dos en modo ap o, para unirlos punto a punto, los dos en modo bridge (pestaña Interfaces)."
    },
    D19: {
      titulo: "El equipo inalámbrico no está conectado a un punto de acceso",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.origen, "El equipo") + " es un cliente inalámbrico, pero el punto de acceso con el que está enlazado" +
          (ctx.ap ? " (" + ctx.ap + ")" : "") + " está apagado, tiene la interfaz deshabilitada o no está en modo ap.";
      },
      sugerencia: "Revisá que el punto de acceso esté encendido, con wlan0 habilitada y en modo ap."
    },
    D20: {
      titulo: "Nadie tiene esa IP en tu red",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.origen, "El equipo") + " preguntó en su red quién tiene la IP " + valor(ctx.destino, "?") +
          " (ARP) y nadie respondió: ningún equipo la tiene configurada, o el que la tiene está desconectado.";
      },
      sugerencia: "Revisá que la IP de destino esté bien escrita y que ese equipo esté conectado a la misma red."
    },
    D21: {
      titulo: "El destino es la dirección de broadcast",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.destino, "Esa IP") + " es la dirección de broadcast de la red " + valor(ctx.red, "?") + "/" +
          valor(ctx.prefijo, "?") + ": sirve para hablarles a todos los equipos a la vez, no identifica a uno. " +
          "En este simulador no se puede hacer ping a un broadcast.";
      },
      sugerencia: "Hacé ping a la IP de un equipo."
    },
    D22: {
      titulo: "La ruta apunta a un router que no está al alcance",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var router = valor(ctx.router, "El router");
        var inicio = router + " tiene una ruta hacia " + valor(ctx.red, "esa red") + " que manda los paquetes a " +
          valor(ctx.siguienteSalto, "?") + ", pero ";
        if (ctx.motivo === "sin-respuesta") {
          return inicio + "ningún router responde en esa dirección, así que no puede entregárselos.";
        }
        return inicio + "esa dirección no está en ninguna red conectada a " + router + ", así que no puede entregárselos.";
      },
      sugerencia: "Corregí el siguiente salto de esa ruta: tiene que ser la IP de un router vecino, en una red conectada directamente al router."
    },
    D24: {
      titulo: "El equipo no tiene servidor DNS",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "Para hacer ping a " + valor(ctx.nombre, "ese nombre") + " primero hay que averiguar su IP, y eso se le pregunta " +
          "a un servidor DNS. " + valor(ctx.origen, "El equipo") + " no tiene ninguno configurado.";
      },
      sugerencia: "Cargá un servidor DNS en la pestaña Configuración (por ejemplo 8.8.8.8), o hacé el ping directamente a una IP."
    },
    D25: {
      titulo: "El nombre no existe",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var nombre = "\"" + valor(ctx.nombre, "ese nombre") + "\"";
        if (ctx.noRecursivo) {
          return valor(ctx.quien, "El servidor DNS") + " sólo responde por su zona (" + valor(ctx.zona, "?") + ") y no busca nombres de afuera: " +
            "no puede resolver " + nombre + ".";
        }
        if (ctx.zona) {
          return valor(ctx.quien, "El servidor DNS") + " es el servidor de la zona " + ctx.zona + " y responde que " + nombre +
            " no existe en ella: puede estar mal escrito o faltar el registro.";
        }
        if (ctx.tld) {
          return "La raíz del DNS responde que ." + ctx.tld + " no existe en internet, así que " + nombre + " no se puede resolver afuera. " +
            "Los nombres como ." + ctx.tld + " sólo los conoce un servidor DNS propio de la red.";
        }
        return valor(ctx.quien, "El servidor DNS") + " responde que " + nombre + " no existe: puede estar mal escrito.";
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        if (ctx.noRecursivo) { return "Marcá «Resolver nombres de afuera» en el servidor, o usá otro servidor DNS para los nombres de internet."; }
        if (ctx.zona) { return "Revisá el nombre, o agregá el registro en la pestaña DNS del servidor de " + ctx.zona + "."; }
        if (ctx.tld) { return "Para un nombre de la red interna, configurá como DNS el servidor propio que tiene esa zona."; }
        return "Revisá cómo escribiste el nombre.";
      }
    },
    D26: {
      titulo: "El servidor DNS no responde",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "Para averiguar la IP de " + valor(ctx.nombre, "ese nombre") + ", " + valor(ctx.origen, "el equipo") +
          " le pregunta al servidor DNS " + valor(ctx.dns, "?") + ", pero la consulta no llega." +
          (ctx.causa ? " " + ctx.causa : "");
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        return "Hacé ping a " + valor(ctx.dns, "la IP del servidor DNS") + " para ver dónde se corta el camino: el problema no está en el nombre.";
      }
    },
    D27: {
      titulo: "Una regla de filtrado bloqueó el paquete",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var regla = ctx.porDefecto
          ? "ninguna regla que permita ese paquete, y su política por defecto es bloquear"
          : "una regla que bloquea " + (ctx.reglaTexto || ("el tráfico de " + (ctx.reglaOrigen || "?") + " hacia " + (ctx.reglaDestino || "?")));
        if (ctx.enLaVuelta) {
          return "El paquete llegó a " + (ctx.destinoNombre || "destino") + ", pero la respuesta (de " +
            (ctx.ipOrigen || "?") + " hacia " + (ctx.ipDestino || "?") + ") pasa por " + (ctx.router || "un router") +
            (ctx.porDefecto ? ", que no tiene ninguna regla que la permita y bloquea por defecto, así que la descarta. "
              : ", que tiene " + regla + ", y la descarta. ") + (ctx.esFirewall
              // Un firewall sólo recuerda lo que vio pasar: si la ida fue por
              // otro camino (rutas asimétricas), la respuesta le es nueva.
              ? (ctx.router || "Ese equipo") + " es un firewall, pero el pedido no pasó por él a la ida: la respuesta vuelve " +
                "por otro camino, así que no conoce esa conversación y le aplica su regla."
              : "Un router revisa cada paquete por separado: un firewall, en cambio, recuerda las conversaciones y deja " +
                "volver la respuesta de una que ya permitió.");
        }
        if (ctx.porDefecto) {
          return (ctx.router || "El router") + " no tiene ninguna regla que permita " + (ctx.paqueteTexto || "ese paquete") +
            ", y su política por defecto es bloquear: lo que no está permitido, se descarta.";
        }
        return (ctx.router || "El router") + " tiene " + regla + ". " +
          (ctx.paqueteTexto ? ctx.paqueteTexto.charAt(0).toUpperCase() + ctx.paqueteTexto.slice(1) : "El paquete de " + (ctx.ipOrigen || "?") + " hacia " + (ctx.ipDestino || "?")) +
          " coincide con ella y " + (ctx.esFirewall ? "el firewall" : "el router") + " lo descarta: la ruta existe, pero una regla prohíbe que pase.";
      },
      sugerencia: "Si ese bloqueo es el que buscabas, el aislamiento funciona. Si no, revisá la pestaña Filtrado del router: las reglas se leen en orden, gana la primera que coincide (origen, destino, protocolo, puerto y por dónde entra) y, si ninguna coincide, decide la política por defecto."
    },
    D28: {
      titulo: "Falta NAT: la respuesta no puede volver de internet",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return (ctx.aviso
          ? "Lo que salga a internet por este router sale con una IP de origen privada, como " + valor(ctx.ip, "?") + ". " +
            "Internet no enruta direcciones privadas, así que las respuestas no van a tener cómo volver. "
          : "El pedido llegó a internet, pero salió con la IP de origen " + valor(ctx.ip, "?") + ", que es privada. " +
            "Internet no enruta direcciones privadas, así que la respuesta de " + valor(ctx.destino, "?") + " no tiene cómo volver. ") +
          (ctx.router
            ? ctx.router + " tendría que cambiar esa IP por la pública de su puerto " + valor(ctx.puerto, "?") + " antes de mandarla a internet: eso es NAT."
            : "Hace falta un router con NAT entre la red privada e internet, que cambie la IP privada por una pública.");
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        return ctx.router
          ? "Seleccioná " + ctx.router + ", pestaña Interfaces, y marcá NAT en el puerto " + valor(ctx.puerto, "?") + ", el que va a internet."
          : "Conectá la red a internet a través de un router (o firewall) con NAT en su puerto hacia internet.";
      }
    },
    D29: {
      titulo: "Esa IP no es un servidor DNS",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.origen, "El equipo") + " le pregunta por " + valor(ctx.nombre, "el nombre") + " a " + valor(ctx.dns, "?") +
          (ctx.equipo ? " (" + ctx.equipo + ")" : "") + ". Esa IP responde, pero no da el servicio de DNS: nadie contesta la consulta. " +
          "En una red hogareña el router suele reenviar el DNS; acá ese papel lo cumple un servidor.";
      },
      sugerencia: "En Configuración, poné como DNS la IP de un servidor con el servicio DNS, o un DNS público como 8.8.8.8."
    },
    D30: {
      titulo: "El servidor DNS no llega a internet",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return valor(ctx.servidor, "El servidor DNS") + " no tiene " + valor(ctx.nombre, "ese nombre") + " en su zona y, para resolverlo, " +
          "tiene que preguntarle a la raíz del DNS en internet. Esa consulta no llega." + (ctx.causa ? " " + ctx.causa : "");
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        return "Revisá la salida a internet de " + valor(ctx.servidor, "el servidor") + ": su puerta de enlace, las rutas y el NAT del router de borde.";
      }
    },
    D31: {
      titulo: "Puerto cerrado: la red llega, pero nadie atiende ese servicio",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var prot = String(ctx.protocolo || "tcp").toUpperCase();
        return "El paquete llega a " + valor(ctx.equipo, "el equipo") + " (la red funciona: un ping respondería), pero ningún programa escucha en " +
          prot + " " + valor(ctx.puerto, "?") + ". " + (prot === "TCP"
            ? "Por eso contesta el pedido de conexión (SYN) con un RST: «acá no hay nadie»."
            : "Por eso contesta con un mensaje ICMP de «puerto inalcanzable».");
      },
      sugerencia: function (ctx) {
        ctx = ctx || {};
        return "Revisá el puerto y el protocolo, o activá ese servicio en la pestaña Servicios de " + valor(ctx.equipo, "el servidor") + ".";
      }
    },
    D23: {
      titulo: "El paquete quedó dando vueltas entre routers",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El paquete pasó por " + valor(ctx.saltos, "?") + " routers sin llegar: " + valor(ctx.recorrido, "?") +
          "… Los routers se lo van pasando sin que ninguno lo entregue. Cada router le descuenta 1 al TTL " +
          "(el «tiempo de vida» del paquete) y, cuando llega a 0, el paquete se descarta.";
      },
      sugerencia: "Revisá la ruta hacia ese destino en la tabla de cada router del recorrido: al menos uno manda el paquete hacia atrás."
    }
  };

  function diagnosticoDe(codigo, ctx) {
    var entrada = CATALOGO[codigo];
    if (!entrada) {
      return null;
    }
    var explicacion;
    try {
      explicacion = entrada.explicacion(ctx || {});
    } catch (e) {
      explicacion = "";
    }
    var sugerencia = entrada.sugerencia;
    if (typeof sugerencia === "function") {
      try {
        sugerencia = sugerencia(ctx || {});
      } catch (e) {
        sugerencia = "";
      }
    }
    return {
      codigo: codigo,
      titulo: (ctx && ctx.aire && entrada.tituloAire) || entrada.titulo,
      explicacion: explicacion,
      sugerencia: sugerencia
    };
  }

  /* ---------------- Utilidades internas ---------------- */

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function clavePuerto(idDispositivo, idInterfaz) {
    return idDispositivo + ":" + idInterfaz;
  }

  // MAC determinística a partir del id del dispositivo y el índice de la
  // interfaz, para que el mismo JSON produzca siempre las mismas MAC.
  function macDeterministica(idDispositivo, indice) {
    var base = 0;
    var texto = String(idDispositivo);
    for (var i = 0; i < texto.length; i++) {
      base = (base * 31 + texto.charCodeAt(i)) >>> 0;
    }
    base = (base + indice * 137) >>> 0;
    function dos(valor) {
      var h = (valor & 255).toString(16);
      return h.length < 2 ? "0" + h : h;
    }
    return "02:00:" + dos(base >>> 24) + ":" + dos(base >>> 16) + ":" + dos(base >>> 8) + ":" + dos(base);
  }

  function buscarDispositivo(estado, idDispositivo) {
    return estado.porDispositivo[idDispositivo] || null;
  }

  // Lo que lee el alumno usa el nombre visible del equipo, no su id.
  function nombreDe(estado, idDispositivo) {
    var d = buscarDispositivo(estado, idDispositivo);
    return d ? (d.nombre || d.id) : String(idDispositivo);
  }

  var PALABRA_MEDIO = { ethernet: "de cobre", fibra: "de fibra", wireless: "inalámbrico" };

  function palabraMedio(medio) {
    return PALABRA_MEDIO[medio] || String(medio);
  }

  function mayuscula(texto) {
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function cableEntre(estado, enlace) {
    return (enlace.tipo === "wireless" ? "el enlace inalámbrico entre " : "el cable entre ") +
      nombreDe(estado, enlace.a.dispositivo) + " y " + nombreDe(estado, enlace.b.dispositivo);
  }

  function otraPunta(enlace, idDispositivo) {
    return enlace.a.dispositivo === idDispositivo ? enlace.b.dispositivo : enlace.a.dispositivo;
  }

  function buscarInterfaz(dispositivo, idInterfaz) {
    if (!dispositivo || !dispositivo.interfaces) {
      return null;
    }
    for (var i = 0; i < dispositivo.interfaces.length; i++) {
      if (dispositivo.interfaces[i].id === idInterfaz) {
        return dispositivo.interfaces[i];
      }
    }
    return null;
  }

  function buscarInterfazPorIp(dispositivo, ip) {
    if (!dispositivo || !dispositivo.interfaces) {
      return null;
    }
    for (var i = 0; i < dispositivo.interfaces.length; i++) {
      if (dispositivo.interfaces[i].ip === ip) {
        return dispositivo.interfaces[i];
      }
    }
    return null;
  }

  // Conmutador de capa 2: el switch y el punto de acceso. Ambos hacen bridge
  // sin mirar direcciones IP; el AP lo hace entre el aire y el cable.
  function esConmutador(dispositivo) {
    return !!dispositivo && (dispositivo.tipo === "switch-l2" || dispositivo.tipo === "ap");
  }

  // Un hub es un conmutador que no aprende MAC: repite cada trama por todos
  // sus puertos.
  function esHub(dispositivo) {
    return !!dispositivo && dispositivo.tipo === "switch-l2" && dispositivo.modelo === "hub";
  }

  // Modo de radio efectivo de una interfaz wireless. Si no está declarado se
  // usa el valor inicial por tipo: ap en puntos de acceso y routers, cliente
  // en el resto. En cobre y fibra no hay modo de radio.
  function modoRadioDe(dispositivo, interfaz) {
    if (!interfaz || interfaz.medio !== "wireless") {
      return null;
    }
    if (interfaz.modoRadio === "ap" || interfaz.modoRadio === "cliente" || interfaz.modoRadio === "bridge") {
      return interfaz.modoRadio;
    }
    if (dispositivo && (dispositivo.tipo === "ap" || dispositivo.tipo === "router")) {
      return "ap";
    }
    return "cliente";
  }

  // Enlaces que cuelgan de un puerto. Un puerto ap sostiene uno por cliente;
  // el resto admite un solo enlace.
  function enlacesDe(estado, idDispositivo, idInterfaz) {
    var valor = estado.enlacePorPuerto[clavePuerto(idDispositivo, idInterfaz)];
    if (!valor) {
      return [];
    }
    return Array.isArray(valor) ? valor : [valor];
  }

  // Pares de modos válidos en un enlace wireless: cliente contra ap, o
  // bridge contra bridge. En cobre y fibra no hay modos que comparar.
  function modosEnlaceOk(estado, enlace) {
    if (!enlace || enlace.tipo !== "wireless") {
      return true;
    }
    var aD = buscarDispositivo(estado, enlace.a.dispositivo);
    var bD = buscarDispositivo(estado, enlace.b.dispositivo);
    var aI = buscarInterfaz(aD, enlace.a.interfaz);
    var bI = buscarInterfaz(bD, enlace.b.interfaz);
    if (!aI || !bI) {
      return false;
    }
    var ma = modoRadioDe(aD, aI);
    var mb = modoRadioDe(bD, bI);
    return (ma === "ap" && mb === "cliente") ||
      (ma === "cliente" && mb === "ap") ||
      (ma === "bridge" && mb === "bridge");
  }

  function modoEnlaceDe(estado, enlace, idDispositivo, idInterfaz) {
    var dev = buscarDispositivo(estado, idDispositivo);
    var otro = (enlace.a.dispositivo === idDispositivo && enlace.a.interfaz === idInterfaz)
      ? enlace.b
      : enlace.a;
    var devOtro = buscarDispositivo(estado, otro.dispositivo);
    return {
      mio: modoRadioDe(dev, buscarInterfaz(dev, idInterfaz)),
      ajeno: modoRadioDe(devOtro, buscarInterfaz(devOtro, otro.interfaz)),
      otroDispositivo: otro.dispositivo
    };
  }

  // Condición para que una trama atraviese un enlace: en up, medios
  // compatibles, modos compatibles y, en el aire, dentro del alcance.
  function tramaPasa(estado, enlace) {
    if (!enlace || enlace.estado !== "up") {
      return false;
    }
    var dispositivoA = buscarDispositivo(estado, enlace.a.dispositivo);
    var dispositivoB = buscarDispositivo(estado, enlace.b.dispositivo);
    var interfazA = buscarInterfaz(dispositivoA, enlace.a.interfaz);
    var interfazB = buscarInterfaz(dispositivoB, enlace.b.interfaz);
    if (!dispositivoA || !dispositivoB || !interfazA || !interfazB ||
        !dispositivoA.encendido || !dispositivoB.encendido ||
        !interfazA.habilitada || !interfazB.habilitada) {
      return false;
    }
    if (!mediosCompatibles(estado, enlace).ok) {
      return false;
    }
    if (!modosEnlaceOk(estado, enlace)) {
      return false;
    }
    var wl = chequeoWireless(estado, enlace);
    if (wl.aplica && !wl.enAlcance) {
      return false;
    }
    return true;
  }

  // El firewall es un router con estado: recuerda las conversaciones que
  // dejó pasar y deja volver sus respuestas sin revisar las reglas.
  function esFirewall(dispositivo) {
    return !!dispositivo && dispositivo.tipo === "router" && dispositivo.modelo === "firewall";
  }

  function esRouter(dispositivo) {
    return !!dispositivo && (dispositivo.tipo === "router" || dispositivo.tipo === "internet");
  }

  // La nube "internet" representa todas las direcciones públicas: es dueña
  // de cualquier destino público que no esté en sus propias redes.
  // Filtrado mínimo y sin estado: cada regla tiene una acción (bloquear o
  // permitir) y dos redes en formato CIDR. Las reglas se leen en orden, gana
  // la primera que coincide con origen y destino del paquete, y lo que no
  // coincide con ninguna pasa.
  function parsearCidr(texto) {
    var partes = String(texto === undefined || texto === null ? "" : texto).trim().split("/");
    if (partes.length !== 2 || !/^\d{1,2}$/.test(partes[1])) {
      return null;
    }
    var prefijo = parseInt(partes[1], 10);
    if (!Red.esIpValida(partes[0]) || prefijo < 0 || prefijo > 32) {
      return null;
    }
    return { red: Red.direccionDeRed(partes[0], prefijo), prefijo: prefijo };
  }

  // La primera regla que coincide con el paquete: origen, destino y, si la
  // regla los dice, protocolo, puerto de destino y puerto de entrada.
  function reglaQueAplica(router, ipOrigen, ipDestino, paquete, entrada) {
    paquete = paquete || { protocolo: "icmp" };
    var reglas = Array.isArray(router.reglas) ? router.reglas : [];
    for (var i = 0; i < reglas.length; i++) {
      var regla = reglas[i];
      var o = regla && parsearCidr(regla.origen);
      var d = regla && parsearCidr(regla.destino);
      if (!o || !d) {
        continue;
      }
      if (regla.protocolo && regla.protocolo !== paquete.protocolo) { continue; }
      if (regla.puerto && Number(regla.puerto) !== Number(paquete.puertoDestino)) { continue; }
      if (regla.entrada && regla.entrada !== entrada) { continue; }
      if (Red.mismaRed(ipOrigen, o.red, o.prefijo) && Red.mismaRed(ipDestino, d.red, d.prefijo)) {
        return { indice: i, regla: regla, origen: o.red + "/" + o.prefijo, destino: d.red + "/" + d.prefijo };
      }
    }
    return null;
  }

  function textoRegla(regla, origen, destino) {
    var que = regla.protocolo ? regla.protocolo.toUpperCase() + (regla.puerto ? " " + regla.puerto : "") : "el tráfico";
    return que + " de " + (origen || regla.origen) + " hacia " + (destino || regla.destino) +
      (regla.entrada ? " que entra por " + regla.entrada : "");
  }

  function textoPaquete(paquete, ipOrigen, ipDestino) {
    paquete = paquete || { protocolo: "icmp" };
    if (paquete.protocolo === "icmp") { return "el paquete ICMP (ping) de " + ipOrigen + " hacia " + ipDestino; }
    return "el paquete " + paquete.protocolo.toUpperCase() + " de " + ipOrigen + ":" + paquete.puertoOrigen + " hacia " + ipDestino + ":" + paquete.puertoDestino;
  }

  function invertirPaquete(paquete) {
    if (!paquete || paquete.protocolo === "icmp") { return { protocolo: "icmp" }; }
    return { protocolo: paquete.protocolo, puertoOrigen: paquete.puertoDestino, puertoDestino: paquete.puertoOrigen };
  }

  function esInternet(dispositivo) {
    return !!dispositivo && dispositivo.tipo === "internet";
  }

  function destinoEnInternet(dispositivo, ip) {
    if (!esInternet(dispositivo) || Red.clasificar(ip) !== "publica") { return false; }
    return !(dispositivo.interfaces || []).some(function (f) {
      return f.habilitada && f.ip && Red.esIpValida(f.ip) && prefijoValido(f.prefijo) && Red.mismaRed(f.ip, ip, f.prefijo);
    });
  }

  function prefijoValido(prefijo) {
    return typeof prefijo === "number" && Math.floor(prefijo) === prefijo && prefijo >= 0 && prefijo <= 32;
  }

  function distanciaEuclidiana(a, b) {
    var dx = (a.x || 0) - (b.x || 0);
    var dy = (a.y || 0) - (b.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function mediosCompatibles(estado, enlace) {
    var a = buscarInterfaz(buscarDispositivo(estado, enlace.a.dispositivo), enlace.a.interfaz);
    var b = buscarInterfaz(buscarDispositivo(estado, enlace.b.dispositivo), enlace.b.interfaz);
    if (!a || !b) {
      return { ok: false, medioA: a ? a.medio : "?", medioB: b ? b.medio : "?" };
    }
    var ok = enlace.tipo === a.medio && enlace.tipo === b.medio;
    return { ok: ok, medioA: a.medio, medioB: b.medio };
  }

  // Chequea el tramo wireless por distancia. Devuelve {aplica, enAlcance, distancia}.
  function chequeoWireless(estado, enlace) {
    if (!enlace || enlace.tipo !== "wireless") {
      return { aplica: false, enAlcance: true, distancia: null };
    }
    var a = buscarDispositivo(estado, enlace.a.dispositivo);
    var b = buscarDispositivo(estado, enlace.b.dispositivo);
    if (!a || !b) {
      return { aplica: true, enAlcance: false, distancia: null };
    }
    var d = distanciaEuclidiana(a, b);
    return { aplica: true, enAlcance: d <= estado.umbralWireless, distancia: Math.round(d) };
  }

  function vecinoDe(estado, idDispositivo, idInterfaz) {
    var enlaces = enlacesDe(estado, idDispositivo, idInterfaz);
    if (!enlaces.length) {
      return null;
    }
    var enlace = enlaces[0];
    var otroExtremo = enlace.a.dispositivo === idDispositivo && enlace.a.interfaz === idInterfaz
      ? enlace.b
      : enlace.a;
    return {
      dispositivo: buscarDispositivo(estado, otroExtremo.dispositivo),
      interfaz: buscarInterfaz(buscarDispositivo(estado, otroExtremo.dispositivo), otroExtremo.interfaz),
      enlace: enlace
    };
  }

  // Dominio de broadcast (segmento L2) visto desde un puerto: se atraviesan
  // los conmutadores encendidos (switch y punto de acceso) y el abanico de
  // enlaces de un puerto en modo ap; los hosts y routers son borde, salvo
  // por ese abanico dentro de su propio puerto ap. Un enlace wireless sólo
  // se cruza en up, con medios y modos compatibles y dentro del alcance:
  // cada cliente tiene su propia distancia al AP.
  function segmentoL2(estado, idDispositivo, idInterfaz) {
    return Object.keys(recorrerSegmento(estado, idDispositivo, idInterfaz));
  }

  // Mismo recorrido que segmentoL2, pero cada puerto alcanzado recuerda de
  // qué puerto vino y por qué enlace (null en el salto interno de un
  // conmutador, de un puerto suyo a otro). Sirve para dibujar la difusión y
  // para reconstruir el camino de una trama dentro del segmento.
  function recorrerSegmento(estado, idDispositivo, idInterfaz) {
    var visitados = {};
    var inicio = clavePuerto(idDispositivo, idInterfaz);
    visitados[inicio] = { desde: null, enlace: null };
    var cola = [inicio];
    while (cola.length > 0) {
      var actual = cola.shift();
      var partes = actual.split(":");
      var devId = partes[0];
      var ifId = partes.slice(1).join(":");
      var enlaces = enlacesDe(estado, devId, ifId);
      for (var li = 0; li < enlaces.length; li++) {
        var enlace = enlaces[li];
        if (!tramaPasa(estado, enlace)) {
          continue;
        }
        var otro = enlace.a.dispositivo === devId && enlace.a.interfaz === ifId ? enlace.b : enlace.a;
        var claveOtra = clavePuerto(otro.dispositivo, otro.interfaz);
        if (visitados[claveOtra]) {
          continue;
        }
        visitados[claveOtra] = { desde: actual, enlace: enlace.id };
        var devVecino = buscarDispositivo(estado, otro.dispositivo);
        // Si el vecino es un conmutador encendido, el broadcast inunda todos
        // sus puertos: se agregan los equipos del otro lado de cada puerto.
        if (esConmutador(devVecino) && devVecino.encendido) {
          for (var i = 0; i < devVecino.interfaces.length; i++) {
            var puerto = devVecino.interfaces[i];
            var clavePuertoSw = clavePuerto(devVecino.id, puerto.id);
            if (!visitados[clavePuertoSw]) {
              visitados[clavePuertoSw] = { desde: claveOtra, enlace: null };
              cola.push(clavePuertoSw);
            }
          }
        } else {
          cola.push(claveOtra);
        }
      }
    }
    return visitados;
  }

  // Ids de los enlaces que recorre una difusión salida de ese puerto.
  function enlacesDelSegmento(estado, idDispositivo, idInterfaz) {
    var visitados = recorrerSegmento(estado, idDispositivo, idInterfaz);
    var ids = [];
    var claves = Object.keys(visitados);
    for (var i = 0; i < claves.length; i++) {
      var e = visitados[claves[i]].enlace;
      if (e && ids.indexOf(e) < 0) {
        ids.push(e);
      }
    }
    return ids;
  }

  // Ids de los enlaces, en orden, que cruza una trama del puerto A al puerto
  // B dentro del mismo segmento. Lista vacía si B no se alcanza.
  function caminoL2(estado, idA, ifA, idB, ifB) {
    var visitados = recorrerSegmento(estado, idA, ifA);
    var clave = clavePuerto(idB, ifB);
    if (!visitados[clave]) {
      return [];
    }
    var camino = [];
    while (clave) {
      var paso = visitados[clave];
      if (paso.enlace) {
        camino.unshift(paso.enlace);
      }
      clave = paso.desde;
    }
    return camino;
  }

  // Todos los equipos con IP en el mismo segmento que el puerto dado.
  function paresEnSegmento(estado, idDispositivo, idInterfaz) {
    var claves = segmentoL2(estado, idDispositivo, idInterfaz);
    var pares = [];
    for (var i = 0; i < claves.length; i++) {
      var partes = claves[i].split(":");
      var devId = partes[0];
      var ifId = partes.slice(1).join(":");
      if (devId === idDispositivo && ifId === idInterfaz) {
        continue;
      }
      var dev = buscarDispositivo(estado, devId);
      if (!dev || esConmutador(dev)) {
        continue;
      }
      var iface = buscarInterfaz(dev, ifId);
      if (!iface || !iface.ip) {
        continue;
      }
      pares.push({ dispositivo: dev, interfaz: iface });
    }
    return pares;
  }

  function enMismoSegmento(estado, idA, ifA, idB, ifB) {
    var claves = segmentoL2(estado, idA, ifA);
    for (var i = 0; i < claves.length; i++) {
      if (claves[i] === clavePuerto(idB, ifB)) {
        return true;
      }
    }
    return false;
  }

  // Dueños configurados de una IP (hayan o no respondido ARP).
  function configuradosConIp(estado, ip) {
    var lista = [];
    var ids = Object.keys(estado.porDispositivo);
    for (var i = 0; i < ids.length; i++) {
      var dev = estado.porDispositivo[ids[i]];
      for (var j = 0; j < dev.interfaces.length; j++) {
        var iface = dev.interfaces[j];
        if (iface.ip === ip) {
          lista.push({ dispositivo: dev, interfaz: iface });
        }
      }
    }
    return lista;
  }

  // Quiénes responderían un ARP por esa IP vistos desde el puerto solicitante.
  function respondedoresArp(estado, idSolicitante, ifSolicitante, ipBuscada) {
    var duenos = configuradosConIp(estado, ipBuscada);
    var vivos = [];
    for (var i = 0; i < duenos.length; i++) {
      var dev = duenos[i].dispositivo;
      var iface = duenos[i].interfaz;
      if (!dev.encendido || !iface.habilitada) {
        continue;
      }
      if (!enMismoSegmento(estado, idSolicitante, ifSolicitante, dev.id, iface.id)) {
        continue;
      }
      // El dueño responde si alguno de los enlaces de su puerto deja pasar la
      // trama (en un puerto ap alcanza con que uno de sus clientes lo alcance).
      var enlacesDuenio = enlacesDe(estado, dev.id, iface.id);
      var alcanza = false;
      for (var li = 0; li < enlacesDuenio.length; li++) {
        if (tramaPasa(estado, enlacesDuenio[li])) {
          alcanza = true;
          break;
        }
      }
      if (!alcanza) {
        continue;
      }
      vivos.push(duenos[i]);
    }
    return vivos;
  }

  function aprenderMac(estado, idSwitch, mac, puerto, registrar) {
    if (!registrar) {
      return;
    }
    if (!estado.mac[idSwitch]) {
      estado.mac[idSwitch] = [];
    }
    var tabla = estado.mac[idSwitch];
    for (var i = 0; i < tabla.length; i++) {
      if (tabla[i].mac === mac) {
        tabla[i].puerto = puerto;
        tabla[i].vence = estado.ahora + VIDA_MAC_MS;
        return;
      }
    }
    tabla.push({ mac: mac, puerto: puerto, vence: estado.ahora + VIDA_MAC_MS });
  }

  function agregarArp(estado, idDispositivo, ip, mac, registrar) {
    if (!registrar) {
      return;
    }
    if (!estado.arp[idDispositivo]) {
      estado.arp[idDispositivo] = [];
    }
    var tabla = estado.arp[idDispositivo];
    for (var i = 0; i < tabla.length; i++) {
      if (tabla[i].ip === ip) {
        tabla[i].mac = mac;
        tabla[i].vence = estado.ahora + VIDA_ARP_MS;
        return;
      }
    }
    tabla.push({ ip: ip, mac: mac, vence: estado.ahora + VIDA_ARP_MS });
  }

  // ¿El segmento atraviesa una celda wireless? Basta con que uno de sus
  // puertos en modo ap tenga enlaces: el abanico en el aire pasó por ahí.
  function segmentoUsaAp(estado, idDispositivo, idInterfaz) {
    var claves = segmentoL2(estado, idDispositivo, idInterfaz);
    for (var i = 0; i < claves.length; i++) {
      var partes = claves[i].split(":");
      var dev = buscarDispositivo(estado, partes[0]);
      var iface = buscarInterfaz(dev, partes.slice(1).join(":"));
      if (iface && iface.medio === "wireless" && modoRadioDe(dev, iface) === "ap" &&
          enlacesDe(estado, dev.id, iface.id).length > 0) {
        return true;
      }
    }
    return false;
  }

  // Registra el aprendizaje de los conmutadores del segmento: cada uno
  // aprende la MAC de origen en el puerto de entrada, sea de cable o del aire.
  function aprenderEnConmutadores(estado, idOrigen, ifOrigen, macOrigen, registrar) {
    var tocados = [];
    var claves = segmentoL2(estado, idOrigen, ifOrigen);
    for (var i = 0; i < claves.length; i++) {
      var partes = claves[i].split(":");
      var dev = buscarDispositivo(estado, partes[0]);
      if (esConmutador(dev) && dev.encendido) {
        if (!esHub(dev)) { aprenderMac(estado, dev.id, macOrigen, partes.slice(1).join(":"), registrar); }
        if (tocados.indexOf(dev.id) < 0) {
          tocados.push(dev.id);
        }
      }
    }
    return tocados;
  }

  /* ---------------- Dominios de colisión y de broadcast ----------------
   * Unión de conjuntos sobre los enlaces. Colisión: comparten el medio los
   * enlaces de un mismo hub y los de una misma celda inalámbrica (un puerto
   * en modo ap). Broadcast: llega a todo lo unido por switches, hubs y
   * puntos de acceso; los routers y los equipos finales lo cortan. */
  function dominios(estado) {
    var enlaces = (estado.topologia && estado.topologia.enlaces) || [];
    var padre = {};
    enlaces.forEach(function (e) { padre[e.id] = e.id; });
    function raiz(x) { while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; } return x; }
    function unir(ids) { for (var i = 1; i < ids.length; i++) { padre[raiz(ids[i])] = raiz(ids[0]); } }
    function idsDe(dev, iface) { return enlacesDe(estado, dev.id, iface.id).map(function (e) { return e.id; }); }
    function grupos() {
      var porRaiz = {};
      var orden = [];
      enlaces.forEach(function (e) {
        var r = raiz(e.id);
        if (!porRaiz[r]) { porRaiz[r] = { enlaces: [], dispositivos: [] }; orden.push(r); }
        porRaiz[r].enlaces.push(e.id);
        [e.a.dispositivo, e.b.dispositivo].forEach(function (d) {
          if (porRaiz[r].dispositivos.indexOf(d) < 0) { porRaiz[r].dispositivos.push(d); }
        });
      });
      return orden.map(function (r) { return porRaiz[r]; });
    }
    var devs = Object.keys(estado.porDispositivo).map(function (id) { return estado.porDispositivo[id]; });
    devs.forEach(function (dev) {
      if (esHub(dev)) {
        var todos = [];
        dev.interfaces.forEach(function (f) { todos = todos.concat(idsDe(dev, f)); });
        unir(todos);
      }
      dev.interfaces.forEach(function (f) {
        if (f.medio === "wireless" && modoRadioDe(dev, f) === "ap") { unir(idsDe(dev, f)); }
      });
    });
    var colision = grupos();
    enlaces.forEach(function (e) { padre[e.id] = e.id; });
    devs.forEach(function (dev) {
      if (esConmutador(dev)) {
        var todos = [];
        dev.interfaces.forEach(function (f) { todos = todos.concat(idsDe(dev, f)); });
        unir(todos);
      } else {
        dev.interfaces.forEach(function (f) { unir(idsDe(dev, f)); });
      }
    });
    return { colision: colision, broadcast: grupos() };
  }

  /* ---------------- Estado ---------------- */

  function crearEstado(topologia) {
    var copia = clonar(topologia);
    var estado = {
      topologia: copia,
      porDispositivo: {},
      enlacePorPuerto: {},
      arp: {},
      mac: {},
      concesiones: {},
      ahora: Date.now(),
      umbralWireless: UMBRAL_WIRELESS
    };
    for (var i = 0; i < copia.dispositivos.length; i++) {
      var dev = copia.dispositivos[i];
      estado.porDispositivo[dev.id] = dev;
      for (var j = 0; j < dev.interfaces.length; j++) {
        if (!dev.interfaces[j].mac) {
          dev.interfaces[j].mac = macDeterministica(dev.id, j);
        }
      }
      estado.arp[dev.id] = [];
      if (esConmutador(dev) && !esHub(dev)) {
        estado.mac[dev.id] = [];
      }
    }
    for (var k = 0; k < (copia.enlaces || []).length; k++) {
      var enlace = copia.enlaces[k];
      var claveA = clavePuerto(enlace.a.dispositivo, enlace.a.interfaz);
      var claveB = clavePuerto(enlace.b.dispositivo, enlace.b.interfaz);
      if (!estado.enlacePorPuerto[claveA]) {
        estado.enlacePorPuerto[claveA] = [];
      }
      if (!estado.enlacePorPuerto[claveB]) {
        estado.enlacePorPuerto[claveB] = [];
      }
      estado.enlacePorPuerto[claveA].push(enlace);
      estado.enlacePorPuerto[claveB].push(enlace);
    }
    reconstruirConcesiones(estado);
    return estado;
  }

  /* ---------------- Rutas ---------------- */

  function rutaElegida(estado, idRouter, destinoIp) {
    if (!Red.esIpValida(destinoIp)) {
      return null;
    }
    var router = buscarDispositivo(estado, idRouter);
    if (!router || !esRouter(router) || !router.encendido) {
      return null;
    }
    var candidatas = [];
    var conectadas = [];
    var i;
    for (i = 0; i < router.interfaces.length; i++) {
      var iface = router.interfaces[i];
      if (!iface.habilitada || !iface.ip || !Red.esIpValida(iface.ip) || !prefijoValido(iface.prefijo)) {
        continue;
      }
      conectadas.push(iface);
      var red = Red.direccionDeRed(iface.ip, iface.prefijo);
      if (red === null) {
        continue;
      }
      candidatas.push({
        destino: red,
        prefijo: iface.prefijo,
        siguienteSalto: null,
        directa: true,
        interfaz: iface.id
      });
    }
    var rutas = router.rutas || [];
    for (i = 0; i < rutas.length; i++) {
      var r = rutas[i];
      if (!r || !Red.esIpValida(r.destino) || !prefijoValido(r.prefijo)) {
        continue;
      }
      var redRuta = Red.direccionDeRed(r.destino, r.prefijo);
      if (redRuta === null) {
        continue;
      }
      candidatas.push({
        destino: redRuta,
        prefijo: r.prefijo,
        siguienteSalto: r.siguienteSalto || null,
        directa: false
      });
    }
    var mejor = null;
    for (i = 0; i < candidatas.length; i++) {
      var c = candidatas[i];
      var redDest = Red.direccionDeRed(destinoIp, c.prefijo);
      if (redDest === null || redDest !== c.destino) {
        continue;
      }
      if (mejor === null || c.prefijo > mejor.prefijo) {
        mejor = c;
      }
    }
    // El campo gateway del router es el último recurso: sólo se usa si
    // ninguna entrada de la tabla coincide (una 0.0.0.0/0 explícita le gana)
    // y si el gateway cae en alguna de sus redes conectadas.
    if (!mejor && router.gateway && Red.esIpValida(router.gateway)) {
      for (i = 0; i < conectadas.length; i++) {
        if (Red.mismaRed(conectadas[i].ip, router.gateway, conectadas[i].prefijo)) {
          mejor = { destino: "0.0.0.0", prefijo: 0, siguienteSalto: router.gateway, directa: false, porGateway: true };
          break;
        }
      }
    }
    if (!mejor && esInternet(router)) {
      for (i = 0; i < conectadas.length && !mejor; i++) {
        var enlacesNube = enlacesDe(estado, router.id, conectadas[i].id);
        for (var en = 0; en < enlacesNube.length && !mejor; en++) {
          var lado = (enlacesNube[en].a.dispositivo === router.id && enlacesNube[en].a.interfaz === conectadas[i].id)
            ? enlacesNube[en].b : enlacesNube[en].a;
          var vecinoIf = buscarInterfaz(buscarDispositivo(estado, lado.dispositivo), lado.interfaz);
          if (vecinoIf && vecinoIf.ip && Red.esIpValida(vecinoIf.ip) && Red.mismaRed(conectadas[i].ip, vecinoIf.ip, conectadas[i].prefijo)) {
            mejor = { destino: "0.0.0.0", prefijo: 0, siguienteSalto: vecinoIf.ip, directa: false };
          }
        }
      }
    }
    if (!mejor) {
      return null;
    }
    return {
      destino: mejor.destino,
      prefijo: mejor.prefijo,
      siguienteSalto: mejor.siguienteSalto,
      directa: !!mejor.directa,
      interfaz: mejor.interfaz || null
    };
  }

  // Elige con qué interfaz origina un equipo, mirando el destino si se conoce.
  function elegirInterfazOrigen(estado, dispositivo, destinoIp) {
    if (!dispositivo || !dispositivo.interfaces || dispositivo.interfaces.length === 0) {
      return null;
    }
    if (destinoIp && Red.esIpValida(destinoIp)) {
      // Si una interfaz ya tiene esa IP (ping a sí mismo o a un router), usarla.
      var propia = buscarInterfazPorIp(dispositivo, destinoIp);
      if (propia) {
        return propia;
      }
      if (esRouter(dispositivo)) {
        var ruta = rutaElegida(estado, dispositivo.id, destinoIp);
        if (ruta && ruta.directa && ruta.interfaz) {
          var ifaceDirecta = buscarInterfaz(dispositivo, ruta.interfaz);
          if (ifaceDirecta) {
            return ifaceDirecta;
          }
        }
        if (ruta && ruta.siguienteSalto) {
          for (var i = 0; i < dispositivo.interfaces.length; i++) {
            var cand = dispositivo.interfaces[i];
            if (!cand.habilitada || !cand.ip || !prefijoValido(cand.prefijo)) {
              continue;
            }
            if (Red.mismaRed(cand.ip, ruta.siguienteSalto, cand.prefijo)) {
              return cand;
            }
          }
        }
      }
    }
    // Caso común: primera habilitada con IP; si ninguna tiene IP, la primera
    // habilitada; si ninguna está habilitada, la primera a secas (para que el
    // diagnóstico D01 pueda nombrarla).
    var primeraHabilitada = null;
    for (var j = 0; j < dispositivo.interfaces.length; j++) {
      var iface = dispositivo.interfaces[j];
      if (iface.habilitada && !primeraHabilitada) {
        primeraHabilitada = iface;
      }
      if (iface.habilitada && iface.ip && Red.esIpValida(iface.ip)) {
        return iface;
      }
    }
    return primeraHabilitada || dispositivo.interfaces[0];
  }

  /* ---------------- Tramas: lo que viaja en cada tramo ----------------
   * Entre dos equipos de capa 3, la trama cruza switches y puntos de acceso
   * sin que cambie. Se informan esos equipos, en orden, y el medio del
   * primer enlace (el del puerto que transmite). */
  function tramoL2(estado, idA, ifA, idB, ifB) {
    var visitados = recorrerSegmento(estado, idA, ifA);
    var clave = clavePuerto(idB, ifB);
    var atraviesa = [];
    var enlaces = [];
    var primerEnlace = null;
    if (!visitados[clave]) {
      return { atraviesa: atraviesa, medio: null, enlaces: enlaces };
    }
    while (clave) {
      var paso = visitados[clave];
      var dev = clave.split(":")[0];
      if (dev !== idA && dev !== idB && atraviesa[0] !== dev) {
        atraviesa.unshift(dev);
      }
      if (paso.enlace) {
        primerEnlace = paso.enlace;
        enlaces.unshift(paso.enlace);
      }
      clave = paso.desde;
    }
    // Un puerto ap puede tener varios enlaces: vale el que usó la trama.
    var propios = enlacesDe(estado, idA, ifA);
    var enlace = propios[0] || null;
    for (var i = 0; i < propios.length; i++) {
      if (propios[i].id === primerEnlace) {
        enlace = propios[i];
        break;
      }
    }
    return { atraviesa: atraviesa, medio: enlace ? enlace.tipo : null, enlaces: enlaces };
  }

  // Las tramas de una respuesta llegan del ping de vuelta como si fueran de
  // ida: se marcan como vuelta y llevan el echo reply.
  function tramasDeVuelta(res) {
    return ((res && res.tramas) || []).map(function (t) {
      var copia = {};
      for (var k in t) { copia[k] = t[k]; }
      copia.sentido = "vuelta";
      if (!copia.protocolo || copia.protocolo === "ICMP") {
        copia.mensaje = "ICMP echo reply";
        copia.info = "Echo (ping) reply";
      }
      return copia;
    });
  }

  // Las tramas de un camino ya recorrido, con otro contenido: un segmento
  // TCP, una consulta DNS. Viajan por los mismos cables, con las mismas
  // MAC e IP (y el mismo NAT).
  function tramasCon(base, campos) {
    return (base || []).map(function (t) {
      var copia = {};
      for (var k in t) { copia[k] = t[k]; }
      for (var c in campos) { copia[c] = campos[c]; }
      return copia;
    });
  }

  function idaDe(res) { return ((res && res.tramas) || []).filter(function (t) { return t.sentido === "ida"; }); }
  function vueltaDe(res) { return ((res && res.tramas) || []).filter(function (t) { return t.sentido === "vuelta"; }); }

  // TTL con el que llega la respuesta: el de la última trama de vuelta. Sin
  // vuelta recorrida (ping a sí mismo), la cuenta de antes.
  function ttlDeRespuesta(vueltas, saltos) {
    return vueltas.length ? vueltas[vueltas.length - 1].ttl : Math.max(1, TTL_INICIAL - (saltos.length - 1));
  }

  /* ---------------- Ping: el algoritmo de los once pasos ---------------- */

  // Cada resultado lleva las tramas que el paquete llegó a recorrer, aunque
  // el ping falle a mitad de camino.
  function ejecutarPing(estado, idOrigen, destinoIp, opciones) {
    var tramas = [];
    var res = recorrerPing(estado, idOrigen, destinoIp, opciones, tramas);
    res.tramas = tramas;
    return res;
  }

  function recorrerPing(estado, idOrigen, destinoIp, opciones, tramas) {
    opciones = opciones || {};
    var registrar = opciones.registrar !== false;
    var profundidad = opciones.profundidad || 0;
    // Firewalls que dejaron pasar la ida: en la vuelta, la respuesta pasa.
    var conexionIda = {};
    var respuestaDe = opciones.respuestaDe || null;
    var porEstado = opciones.porEstado || null;
    function nom(id) { return nombreDe(estado, id); }

    var pasos = [];
    var saltos = [];
    var respuestas = [];
    var contador = 0;

    // capa: 1 física, 2 enlace, 3 red, 7 aplicación; null en las
    // validaciones de configuración que no son de ninguna capa.
    function agregarPaso(titulo, detalle, ok, capa) {
      contador += 1;
      pasos.push({ n: contador, titulo: titulo, detalle: detalle, ok: !!ok, capa: capa === undefined ? null : capa });
    }

    // Una trama por tramo entre equipos de capa 3: las MAC son las de las
    // interfaces de los extremos; las IP, las del paquete, que no cambian.
    function anotarTrama(idDe, ifDe, idA, ifA, ttlTrama) {
      llegoPor[idA] = ifA.id;
      var tramo = tramoL2(estado, idDe, ifDe.id, idA, ifA.id);
      tramas.push({
        sentido: "ida",
        de: { dispositivo: idDe, interfaz: ifDe.id },
        a: { dispositivo: idA, interfaz: ifA.id },
        medio: tramo.medio,
        macOrigen: ifDe.mac || null,
        macDestino: ifA.mac || null,
        ipOrigen: ipOrigen,
        ipDestino: destinoIp,
        ttl: ttlTrama,
        mensaje: paquete.protocolo === "icmp" ? "ICMP echo request"
          : paquete.protocolo.toUpperCase() + " " + paquete.puertoOrigen + " → " + paquete.puertoDestino,
        protocolo: paquete.protocolo.toUpperCase(),
        puertoOrigen: paquete.puertoOrigen || null,
        puertoDestino: paquete.puertoDestino || null,
        info: paquete.protocolo === "icmp" ? "Echo (ping) request" : paquete.puertoOrigen + " → " + paquete.puertoDestino,
        atraviesa: tramo.atraviesa,
        enlaces: tramo.enlaces
      });
    }

    function fallar(codigo, ctx, tituloPaso, detallePaso, capa) {
      if (tituloPaso) {
        agregarPaso(tituloPaso, detallePaso || "", false, capa);
      }
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe(codigo, ctx || {}),
        respuestas: []
      };
    }

    // Un destino mal escrito es un error de tipeo, no un problema de la red:
    // no se recorre ningún paso ni se usa un código D.
    if (!Red.esIpValida(destinoIp)) {
      return {
        exito: false,
        pasos: [],
        saltos: [],
        diagnostico: {
          codigo: "ENTRADA",
          titulo: "La dirección de destino no es válida",
          explicacion: "\"" + String(destinoIp) + "\" no es una dirección IP ni un nombre válido. Una IP tiene cuatro " +
            "números del 0 al 255 separados por puntos, por ejemplo 10.45.7.122.",
          sugerencia: "Revisá lo que escribiste en el campo Destino."
        },
        respuestas: []
      };
    }

    var origen = buscarDispositivo(estado, idOrigen);
    if (!origen) {
      agregarPaso("Buscar el equipo de origen", "No hay ningún equipo con el identificador " + idOrigen + ".", false, null);
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D01", { origen: idOrigen, interfaz: "?" }),
        respuestas: []
      };
    }

    var srcIface = elegirInterfazOrigen(estado, origen, destinoIp);
    if (!srcIface) {
      return fallar("D01", { origen: nom(origen.id), interfaz: "?" },
        "Revisar el equipo de origen",
        nom(origen.id) + " no tiene interfaces.", null);
    }
    var ipOrigen = srcIface.ip;
    // NAT: la IP de origen del paquete puede cambiar en el router de salida.
    // traduccion queda anotada para reconocer la respuesta; natInverso es la
    // que trae el ping de vuelta para deshacerla al llegar a ese router.
    var traduccion = null;
    var natInverso = opciones.natInverso || null;
    // Protocolo y puertos del paquete (ICMP en un ping) y el puerto por el
    // que entró a cada equipo: los usan las reglas de filtrado.
    var paquete = opciones.paquete || { protocolo: "icmp" };
    var llegoPor = {};
    var ultimoRouter = null;
    saltos.push({ dispositivo: origen.id, interfaz: srcIface.id });

    // Paso 1: encendido y habilitada.
    var encendidoOk = !!origen.encendido && !!srcIface.habilitada;
    agregarPaso(
      "Revisar el equipo de origen",
      nom(origen.id) + (origen.encendido ? " está encendido" : " está apagado") + " y su puerto " + srcIface.id +
      (srcIface.habilitada ? " está habilitado." : " está deshabilitado."),
      encendidoOk
    , 1);
    if (!encendidoOk) {
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D01", { origen: nom(origen.id), interfaz: srcIface.id }),
        respuestas: []
      };
    }

    // Paso 2: enlaces, medios, modos de radio y alcance wireless. Un puerto
    // en modo ap puede sostener varios enlaces (uno por cliente): alcanza con
    // que uno deje pasar la trama.
    var enlacesOrigen = enlacesDe(estado, origen.id, srcIface.id);
    if (enlacesOrigen.length === 0) {
      return fallar("D02", { origen: nom(origen.id), interfaz: srcIface.id },
        "Revisar la conexión física",
        "El puerto " + srcIface.id + " de " + nom(origen.id) + " no tiene ningún cable conectado.", 1);
    }
    var enlaceUsable = null;
    var problemaOrigen = null;
    for (var loi = 0; loi < enlacesOrigen.length; loi++) {
      var candOrigen = enlacesOrigen[loi];
      var compatOrigen = mediosCompatibles(estado, candOrigen);
      if (!compatOrigen.ok) {
        if (!problemaOrigen) {
          problemaOrigen = {
            codigo: "D03",
            ctx: {
              cable: mayuscula(cableEntre(estado, candOrigen)), tipoCable: " es " + palabraMedio(candOrigen.tipo),
              medioA: palabraMedio(compatOrigen.medioA), medioB: palabraMedio(compatOrigen.medioB)
            },
            titulo: "Revisar el tipo de cable",
            detalle: mayuscula(cableEntre(estado, candOrigen)) + " es " + palabraMedio(candOrigen.tipo) + " y une un puerto " +
              palabraMedio(compatOrigen.medioA) + " con uno " + palabraMedio(compatOrigen.medioB) + "."
          };
        }
        continue;
      }
      if (candOrigen.tipo === "wireless" && !modosEnlaceOk(estado, candOrigen)) {
        if (!problemaOrigen) {
          var modosOrigen = modoEnlaceDe(estado, candOrigen, origen.id, srcIface.id);
          var otroOrigen = buscarDispositivo(estado, modosOrigen.otroDispositivo);
          problemaOrigen = {
            codigo: "D18",
            ctx: {
              enlace: candOrigen.id,
              modoA: modosOrigen.mio, modoB: modosOrigen.ajeno,
              nombreA: origen.nombre || origen.id,
              nombreB: (otroOrigen && (otroOrigen.nombre || otroOrigen.id)) || modosOrigen.otroDispositivo
            },
            titulo: "Revisar los modos de radio",
            detalle: mayuscula(cableEntre(estado, candOrigen)) + " une modos de radio que no se entienden (" +
              modosOrigen.mio + " con " + modosOrigen.ajeno + ")."
          };
        }
        continue;
      }
      var wlOrigen = chequeoWireless(estado, candOrigen);
      if (wlOrigen.aplica) {
        agregarPaso("Revisar el alcance inalámbrico",
          nom(origen.id) + " está a " + wlOrigen.distancia + " m de " + nom(otraPunta(candOrigen, origen.id)) +
          " (alcance máximo: " + estado.umbralWireless + " m).", wlOrigen.enAlcance, 1);
        if (!wlOrigen.enAlcance) {
          if (!problemaOrigen) {
            problemaOrigen = {
              codigo: "D17",
              ctx: {
                distancia: wlOrigen.distancia, umbral: estado.umbralWireless,
                nombreA: nom(origen.id), nombreB: nom(otraPunta(candOrigen, origen.id))
              },
              titulo: "Revisar el alcance inalámbrico",
              detalle: nom(origen.id) + " quedó fuera del alcance de " + nom(otraPunta(candOrigen, origen.id)) + "."
            };
          }
          continue;
        }
      }
      if (candOrigen.estado !== "up") {
        if (!problemaOrigen) {
          problemaOrigen = {
            codigo: "D02",
            ctx: { origen: nom(origen.id), interfaz: srcIface.id },
            titulo: "Revisar la conexión física",
            detalle: mayuscula(cableEntre(estado, candOrigen)) + " está marcado como caído."
          };
        }
        continue;
      }
      enlaceUsable = candOrigen;
      break;
    }
    if (!enlaceUsable) {
      var po = problemaOrigen || {
        codigo: "D02",
        ctx: { origen: nom(origen.id), interfaz: srcIface.id },
        titulo: "Revisar la conexión física",
        detalle: "Ningún cable del puerto " + srcIface.id + " está activo."
      };
      agregarPaso(po.titulo, po.detalle, false, 1);
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe(po.codigo, po.ctx),
        respuestas: []
      };
    }
    agregarPaso("Revisar la conexión física",
      "El puerto " + srcIface.id + " tiene " +
      (srcIface.medio === "wireless"
        ? "un enlace inalámbrico activo (modo " + modoRadioDe(origen, srcIface) + ")"
        : "un cable " + palabraMedio(enlaceUsable.tipo) + " activo") +
      " hacia " + nom(otraPunta(enlaceUsable, origen.id)) + ".", true, 1);

    // Un cliente sólo transmite si del otro lado hay un punto de acceso
    // usable: encendido, habilitado y dentro del alcance.
    if (srcIface.medio === "wireless" && modoRadioDe(origen, srcIface) === "cliente") {
      var otroCli = enlaceUsable.a.dispositivo === origen.id && enlaceUsable.a.interfaz === srcIface.id
        ? enlaceUsable.b
        : enlaceUsable.a;
      var devAp = buscarDispositivo(estado, otroCli.dispositivo);
      var ifAp = buscarInterfaz(devAp, otroCli.interfaz);
      var apOk = !!devAp && !!devAp.encendido && !!ifAp && !!ifAp.habilitada &&
        modoRadioDe(devAp, ifAp) === "ap";
      if (!apOk) {
        return fallar("D19", { origen: nom(origen.id), destino: destinoIp, ap: devAp ? nom(devAp.id) : null },
          "Revisar la conexión al punto de acceso",
          nom(origen.id) + " está enlazado con " + nom(otroCli.dispositivo) + ", pero ese punto de acceso no está disponible.", 2);
      }
    }

    // Paso 3: IP y máscara del origen.
    if (!ipOrigen || !Red.esIpValida(ipOrigen)) {
      return fallar("D04", { origen: nom(origen.id), interfaz: srcIface.id },
        "Revisar la IP y la máscara",
        "El puerto " + srcIface.id + " de " + nom(origen.id) + " no tiene una IP configurada.", 3);
    }
    if (!prefijoValido(srcIface.prefijo)) {
      return fallar("D05", { origen: nom(origen.id), interfaz: srcIface.id, prefijo: srcIface.prefijo },
        "Revisar la IP y la máscara",
        "La máscara de " + nom(origen.id) + " no es válida (prefijo " + srcIface.prefijo + ").", 3);
    }
    var redOrigen = Red.direccionDeRed(ipOrigen, srcIface.prefijo);
    agregarPaso("Revisar la IP y la máscara",
      nom(origen.id) + " tiene " + ipOrigen + "/" + srcIface.prefijo +
      " (máscara " + Red.prefijoAMascara(srcIface.prefijo) + "): pertenece a la red " + redOrigen + ".", true, 3);

    // La IP de origen no puede ser red ni broadcast (D06).
    if (Red.esDireccionDeRed(ipOrigen, srcIface.prefijo) || Red.esBroadcast(ipOrigen, srcIface.prefijo)) {
      var rolOrigen = Red.esDireccionDeRed(ipOrigen, srcIface.prefijo)
        ? "dirección de red" : "dirección de broadcast";
      agregarPaso("Comprobar que la IP se pueda asignar",
        ipOrigen + " es la " + rolOrigen + " de " + redOrigen + "/" + srcIface.prefijo + ": no puede usarla un equipo.", false, 3);
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D06", {
          ip: ipOrigen, red: redOrigen, prefijo: srcIface.prefijo, rol: rolOrigen
        }),
        respuestas: []
      };
    }

    // IP duplicada en el propio segmento (D07).
    var duenosOrigen = configuradosConIp(estado, ipOrigen).filter(function (e) {
      return !(e.dispositivo.id === origen.id && e.interfaz.id === srcIface.id);
    });
    var duplicadoOrigen = null;
    for (var di = 0; di < duenosOrigen.length; di++) {
      var cand = duenosOrigen[di];
      if (!cand.interfaz.habilitada) {
        continue;
      }
      if (enMismoSegmento(estado, origen.id, srcIface.id, cand.dispositivo.id, cand.interfaz.id)) {
        duplicadoOrigen = cand;
        break;
      }
    }
    if (duplicadoOrigen) {
      agregarPaso("Comprobar que la IP no esté repetida",
        "La IP " + ipOrigen + " también la tiene " + nom(duplicadoOrigen.dispositivo.id) + ".", false, 3);
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D07", {
          ip: ipOrigen, origen: nom(origen.id), otro: nom(duplicadoOrigen.dispositivo.id)
        }),
        respuestas: []
      };
    }

    // D21: el broadcast de la propia subred no es un equipo.
    if (Red.esBroadcast(destinoIp, srcIface.prefijo) && Red.mismaRed(ipOrigen, destinoIp, srcIface.prefijo)) {
      agregarPaso("Revisar la dirección de destino",
        destinoIp + " es la dirección de broadcast de " + redOrigen + "/" + srcIface.prefijo + ".", false, 3);
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D21", { destino: destinoIp, red: redOrigen, prefijo: srcIface.prefijo }),
        respuestas: []
      };
    }

    // Chequeo preventivo de máscaras y subredes cuando el destino existe en
    // el mismo segmento: distingue D14 (máscaras distintas) de D15 (el switch
    // no enruta). Va antes del gateway para que el diagnóstico sea el útil.
    var duenosDestino = configuradosConIp(estado, destinoIp);
    var parDestinoMismoSegmento = null;
    for (var qi = 0; qi < duenosDestino.length; qi++) {
      var dD = duenosDestino[qi];
      if (dD.dispositivo.id === origen.id && dD.interfaz.id === srcIface.id) {
        continue;
      }
      if (enMismoSegmento(estado, origen.id, srcIface.id, dD.dispositivo.id, dD.interfaz.id)) {
        parDestinoMismoSegmento = dD;
        break;
      }
    }
    if (parDestinoMismoSegmento && prefijoValido(parDestinoMismoSegmento.interfaz.prefijo) &&
        Red.esIpValida(parDestinoMismoSegmento.interfaz.ip)) {
      var prefD = parDestinoMismoSegmento.interfaz.prefijo;
      var mismaConMia = Red.mismaRed(ipOrigen, destinoIp, srcIface.prefijo);
      var mismaConSuya = Red.mismaRed(ipOrigen, destinoIp, prefD);
      if (!mismaConMia && !mismaConSuya) {
        var redA15 = Red.direccionDeRed(ipOrigen, srcIface.prefijo);
        var redB15 = Red.direccionDeRed(destinoIp, prefD);
        var aire15 = srcIface.medio === "wireless" ||
          parDestinoMismoSegmento.interfaz.medio === "wireless";
        var aparato15 = aire15 ? "punto de acceso" : "switch";
        agregarPaso("Comparar las subredes de los dos equipos",
          "Están en el mismo " + aparato15 + ", pero en redes distintas (" + redA15 + "/" + srcIface.prefijo + " y " +
          redB15 + "/" + prefD + "): el " + aparato15 + " no puede pasar de una a otra.", false, 3);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D15", {
            origen: nom(origen.id),
            destinoNombre: nom(parDestinoMismoSegmento.dispositivo.id),
            redA: redA15 + "/" + srcIface.prefijo,
            redB: redB15 + "/" + prefD,
            aire: aire15
          }),
          respuestas: []
        };
      }
      if (srcIface.prefijo !== prefD || mismaConMia !== mismaConSuya) {
        agregarPaso("Comparar las máscaras de los dos equipos",
          nom(origen.id) + " usa /" + srcIface.prefijo + " y " + nom(parDestinoMismoSegmento.dispositivo.id) + " usa /" + prefD +
          ": con máscaras distintas, cada uno calcula una red diferente.", false, 3);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D14", {
            ipA: ipOrigen, prefijoA: srcIface.prefijo, nombreA: nom(origen.id),
            ipB: destinoIp, prefijoB: prefD, nombreB: nom(parDestinoMismoSegmento.dispositivo.id)
          }),
          respuestas: []
        };
      }
    }

    // Bucle de reenvío: en cada salto se repite desde el paso 4.
    var actualId = origen.id;
    var actualIface = srcIface;
    var actualIp = ipOrigen;
    var ttl = TTL_INICIAL;
    // La respuesta de internet sale de la IP que se pingueó, no de la nube:
    // cambia el origen del paquete, no la interfaz con la que decide.
    if (opciones.ipRespuesta) { ipOrigen = opciones.ipRespuesta; }
    var msTotal = 0;
    var recorrido = [];
    var filtrados = {};

    // Reglas de filtrado de un router que el paquete atraviesa (no las del
    // equipo que lo genera). Cada router se revisa una sola vez por ping.
    function revisarFiltro(router) {
      if (router.id === origen.id || filtrados[router.id]) {
        return null;
      }
      var nombreRouter = router.nombre || router.id;
      if (respuestaDe && respuestaDe[router.id]) {
        filtrados[router.id] = true;
        if (porEstado && porEstado.indexOf(nombreRouter) < 0) { porEstado.push(nombreRouter); }
        agregarPaso("Revisar las reglas de filtrado de " + nombreRouter,
          nombreRouter + " es un firewall y recuerda la conversación: es la respuesta de un paquete que ya dejó pasar, " +
          "así que pasa sin revisar las reglas.", true, 3);
        return null;
      }
      if (esFirewall(router)) { conexionIda[router.id] = true; }
      var bloqueaPorDefecto = router.politica === "bloquear";
      if ((!Array.isArray(router.reglas) || router.reglas.length === 0) && !bloqueaPorDefecto) {
        return null;
      }
      filtrados[router.id] = true;
      var entrada = llegoPor[router.id] || null;
      var descPaquete = textoPaquete(paquete, ipOrigen, destinoIp) + (entrada ? ", que entra por " + entrada : "");
      var aplica = reglaQueAplica(router, ipOrigen, destinoIp, paquete, entrada);
      if (!aplica && !bloqueaPorDefecto) {
        agregarPaso("Revisar las reglas de filtrado de " + nombreRouter,
          "Ninguna regla coincide con " + descPaquete + ": pasa (la política por defecto es permitir).", true, 3);
        return null;
      }
      if (aplica && aplica.regla.accion === "permitir") {
        agregarPaso("Revisar las reglas de filtrado de " + nombreRouter,
          "La regla " + (aplica.indice + 1) + " permite " + textoRegla(aplica.regla, aplica.origen, aplica.destino) + ": pasa.", true, 3);
        return null;
      }
      delete conexionIda[router.id];
      agregarPaso("Revisar las reglas de filtrado de " + nombreRouter, aplica
        ? "La regla " + (aplica.indice + 1) + " bloquea " + textoRegla(aplica.regla, aplica.origen, aplica.destino) +
          ", y " + descPaquete + " coincide: " + nombreRouter + " lo descarta."
        : "Ninguna regla permite " + descPaquete + ", y la política por defecto es bloquear: " + nombreRouter + " lo descarta.", false, 3);
      var ctxFiltro = {
        router: nombreRouter, reglaOrigen: aplica ? aplica.origen : null, reglaDestino: aplica ? aplica.destino : null,
        reglaTexto: aplica ? textoRegla(aplica.regla, aplica.origen, aplica.destino) : null, porDefecto: !aplica,
        paqueteTexto: descPaquete, ipOrigen: ipOrigen, ipDestino: destinoIp, esFirewall: esFirewall(router)
      };
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D27", ctxFiltro),
        filtro: ctxFiltro,
        respuestas: []
      };
    }

    // Una vuelta bloqueada por una regla se informa como D27, no como D12:
    // el alumno tiene que saber que fue un filtro y no una ruta faltante.
    function diagnosticoVuelta(vuelta, nombreDestino) {
      if (vuelta.filtro) {
        var ctxVuelta = {};
        for (var k in vuelta.filtro) { ctxVuelta[k] = vuelta.filtro[k]; }
        ctxVuelta.enLaVuelta = true;
        ctxVuelta.destinoNombre = nombreDestino;
        return diagnosticoDe("D27", ctxVuelta);
      }
      return diagnosticoDe("D12", {
        origen: nom(origen.id),
        destino: nombreDestino,
        causa: vuelta.diagnostico ? vuelta.diagnostico.explicacion : ""
      });
    }

    // Llegada a la nube Internet. Con destino público, responde ahí; con un
    // destino privado que no es de sus redes, lo descarta (internet no enruta
    // direcciones privadas). Desde la propia nube (la vuelta) no se revisa:
    // la respuesta vuelve por su vecino, que es la simplificación del NAT.
    // interfazLlegada se pasa cuando la nube se alcanza como gateway de un
    // equipo y todavía no figura en los saltos.
    function revisarNube(dispositivo, interfazLlegada) {
      if (!esInternet(dispositivo) || dispositivo.id === origen.id) { return null; }
      var propia = (dispositivo.interfaces || []).some(function (f) {
        return f.habilitada && f.ip && Red.esIpValida(f.ip) && prefijoValido(f.prefijo) && Red.mismaRed(f.ip, destinoIp, f.prefijo);
      });
      if (propia) { return null; }
      if (interfazLlegada) { saltos.push({ dispositivo: dispositivo.id, interfaz: interfazLlegada }); }
      if (!destinoEnInternet(dispositivo, destinoIp)) {
        agregarPaso("Llegar a internet",
          "El paquete llegó a " + (dispositivo.nombre || dispositivo.id) + " con destino " + destinoIp +
          ", que es una dirección privada: internet no la enruta.", false, 3);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D11", { router: dispositivo.nombre || dispositivo.id, destino: destinoIp, internet: true }),
          respuestas: []
        };
      }
      var nombreNube = dispositivo.nombre || dispositivo.id;
      if (Red.clasificar(ipOrigen) !== "publica") {
        agregarPaso("Llegar a internet",
          "El paquete llegó a " + nombreNube + ": " + destinoIp + " es una dirección pública y recibe el pedido.", true, 3);
        agregarPaso("Comprobar que la respuesta pueda volver",
          destinoIp + " le respondería a " + ipOrigen + ", que es una dirección privada: internet no la enruta y la respuesta no vuelve." +
          (ultimoRouter ? " " + nom(ultimoRouter.id) + " la mandó sin traducir: falta NAT en su puerto " + ultimoRouter.puerto + "." : ""), false, 3);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D28", {
            ip: ipOrigen, destino: destinoIp,
            router: ultimoRouter ? nom(ultimoRouter.id) : null, puerto: ultimoRouter ? ultimoRouter.puerto : null
          }),
          respuestas: []
        };
      }
      agregarPaso("Llegar a internet",
        "El paquete llegó a " + nombreNube + ": " + destinoIp + " es una dirección pública y responde a " + ipOrigen +
        (traduccion ? ", la IP pública de " + nom(traduccion.router) + "." : "."), true, 3);
      msTotal += 20;
      var tramasNube = null;
      if (profundidad < 1) {
        var vueltaNube = ejecutarPing(estado, dispositivo.id, ipOrigen, {
          registrar: false, profundidad: profundidad + 1, respuestaDe: conexionIda,
          ipRespuesta: destinoIp, natInverso: traduccion, paquete: invertirPaquete(paquete)
        });
        var tramasNube = tramasDeVuelta(vueltaNube);
        Array.prototype.push.apply(tramas, tramasNube);
        if (!vueltaNube.exito) {
          return {
            exito: false,
            pasos: pasos.concat(vueltaNube.pasos.map(function (pv) {
              return { n: pasos.length + pv.n, titulo: "Respuesta: " + pv.titulo, detalle: pv.detalle, ok: pv.ok, capa: pv.capa };
            })),
            saltos: saltos,
            diagnostico: diagnosticoVuelta(vueltaNube, dispositivo.nombre || dispositivo.id),
            respuestas: []
          };
        }
      }
      respuestas.push({ ttl: ttlDeRespuesta(tramasNube || [], saltos), ms: Math.max(1, Math.round(msTotal)) });
      return { exito: true, pasos: pasos, saltos: saltos, diagnostico: null, respuestas: respuestas };
    }

    // Cuando un router ya reenvió el paquete por una red conectada, la
    // entrega siguiente es suya y el TTL ya se descontó.
    var reenvioPropio = false;

    while (true) {
      if (ttl <= 0) {
        // Con 64 routers no se listan todos: alcanza con ver que se repiten.
        var textoRecorrido = recorrido.slice(0, 4).join(" → ");
        return fallar("D23", { saltos: recorrido.length, recorrido: textoRecorrido },
          "Controlar el tiempo de vida (TTL)",
          "El TTL llegó a 0 después de pasar por " + recorrido.length + " routers: " + textoRecorrido + "…", 3);
      }
      var dispActual = buscarDispositivo(estado, actualId);
      var enNube = revisarNube(dispActual, null);
      if (enNube) { return enNube; }
      if (esRouter(dispActual) && actualId !== origen.id) {
        var rutaActual = rutaElegida(estado, actualId, destinoIp);
        if (rutaActual && rutaActual.directa && rutaActual.interfaz) {
          var interfazRutaActual = buscarInterfaz(dispActual, rutaActual.interfaz);
          if (interfazRutaActual) {
            actualIface = interfazRutaActual;
            actualIp = interfazRutaActual.ip;
          }
        }
      }
      var andOrigen = Red.and(actualIp, actualIface.prefijo);
      var andDestino = Red.and(destinoIp, actualIface.prefijo);
      var redA = andOrigen ? andOrigen.resultado : Red.direccionDeRed(actualIp, actualIface.prefijo);
      var redD = andDestino ? andDestino.resultado : Red.direccionDeRed(destinoIp, actualIface.prefijo);
      var detalleAnd = nom(actualId) + " aplica su máscara a las dos direcciones: su IP " + actualIp + " AND máscara = " + redA +
        "; la IP de destino " + destinoIp + " AND máscara = " + redD + ".\n" +
        "IP de origen:     " + (andOrigen ? andOrigen.binarioIp : "?") + "\n" +
        "Máscara:          " + (andOrigen ? andOrigen.binarioMascara : "?") + "\n" +
        "Resultado:        " + (andOrigen ? andOrigen.binarioResultado : "?");
      var misma = redA !== null && redA === redD;
      agregarPaso("Decidir si el destino está en la misma red (" + nom(actualId) + ")",
        detalleAnd + "\n" + (misma
          ? "Son iguales: el destino está en la misma red y el paquete se entrega directo."
          : (esRouter(dispActual)
            ? "Son distintas: el destino está en otra red, así que " + nom(actualId) + " busca una ruta."
            : "Son distintas: el destino está en otra red, así que el paquete va a la puerta de enlace.")),
        true, 3);

      if (misma) {
        if (esRouter(dispActual)) {
          var filtroEntrega = revisarFiltro(dispActual);
          if (filtroEntrega) { return filtroEntrega; }
        }
        // Paso 5: entrega directa por ARP dentro del segmento.
        var respond = respondedoresArp(estado, actualId, actualIface.id, destinoIp);
        var todosDuenos = configuradosConIp(estado, destinoIp);
        if (respond.length > 1) {
          agregarPaso("Averiguar la dirección MAC del destino (ARP)",
            nom(actualId) + " preguntó quién tiene " + destinoIp + " y respondieron varios equipos.", false, 2);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D07", {
              ip: destinoIp, origen: nom(actualId), otro: nom(respond[1].dispositivo.id)
            }),
            respuestas: []
          };
        }
        if (respond.length === 0) {
          // ¿El dueño existe pero su enlace inalámbrico quedó fuera de alcance?
          // En ese caso el diagnóstico útil es D17, no D13.
          var fueraAlcance = null;
          for (var oi = 0; oi < todosDuenos.length; oi++) {
            var du = todosDuenos[oi];
            if (du.dispositivo.id === actualId && du.interfaz.id === actualIface.id) {
              continue;
            }
            var enlacesDu = enlacesDe(estado, du.dispositivo.id, du.interfaz.id);
            for (var oij = 0; oij < enlacesDu.length; oij++) {
              var eDu = enlacesDu[oij];
              if (!eDu || eDu.estado !== "up" || !mediosCompatibles(estado, eDu).ok ||
                  !modosEnlaceOk(estado, eDu)) {
                continue;
              }
              var wlDu = chequeoWireless(estado, eDu);
              if (wlDu.aplica && !wlDu.enAlcance) {
                fueraAlcance = {
                  distancia: wlDu.distancia, umbral: estado.umbralWireless,
                  nombreA: nom(du.dispositivo.id), nombreB: nom(otraPunta(eDu, du.dispositivo.id))
                };
                break;
              }
            }
            if (fueraAlcance) {
              break;
            }
          }
          if (fueraAlcance) {
            agregarPaso("Averiguar la dirección MAC del destino (ARP)",
              "El equipo con la IP " + destinoIp + " está fuera del alcance inalámbrico: no puede responder.", false, 2);
            return {
              exito: false,
              pasos: pasos,
              saltos: saltos,
              diagnostico: diagnosticoDe("D17", fueraAlcance),
              respuestas: []
            };
          }
          // D13 sólo cuando el simulador lo sabe: hay un equipo con esa IP y
          // está apagado o con la interfaz deshabilitada. Lo demás es D20.
          var apagado = null;
          for (var ai = 0; ai < todosDuenos.length; ai++) {
            var dAp = todosDuenos[ai];
            if (dAp.dispositivo.id === actualId && dAp.interfaz.id === actualIface.id) {
              continue;
            }
            if (!dAp.dispositivo.encendido || !dAp.interfaz.habilitada) {
              apagado = dAp;
              break;
            }
          }
          if (apagado) {
            agregarPaso("Averiguar la dirección MAC del destino (ARP)",
              nom(actualId) + " preguntó quién tiene " + destinoIp + " y nadie respondió: " + nom(apagado.dispositivo.id) +
              (apagado.dispositivo.encendido
                ? " tiene el puerto " + apagado.interfaz.id + " deshabilitado."
                : " está apagado."), false, 2);
            return {
              exito: false,
              pasos: pasos,
              saltos: saltos,
              diagnostico: diagnosticoDe("D13", { destino: destinoIp, destinoNombre: nom(apagado.dispositivo.id) }),
              respuestas: []
            };
          }
          agregarPaso("Averiguar la dirección MAC del destino (ARP)",
            nom(actualId) + " preguntó en su red quién tiene " + destinoIp + ", y nadie respondió.", false, 2);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D20", { destino: destinoIp, origen: nom(actualId) }),
            respuestas: []
          };
        }
        var destPar = respond[0];
        agregarArp(estado, actualId, destinoIp, destPar.interfaz.mac, registrar);
        agregarArp(estado, destPar.dispositivo.id, actualIp, actualIface.mac, registrar);
        var conmutadores = aprenderEnConmutadores(estado, actualId, actualIface.id, actualIface.mac, registrar);
        aprenderEnConmutadores(estado, destPar.dispositivo.id, destPar.interfaz.id, destPar.interfaz.mac, registrar);
        var hayAp = false;
        for (var ci = 0; ci < conmutadores.length; ci++) {
          var devToc = buscarDispositivo(estado, conmutadores[ci]);
          if (devToc && devToc.tipo === "ap") {
            hayAp = true;
            break;
          }
        }
        if (!hayAp) {
          hayAp = segmentoUsaAp(estado, actualId, actualIface.id);
        }
        var nombreDestinoFinal = nom(destPar.dispositivo.id);
        var textoTtl = "";
        if (esRouter(dispActual) && actualId !== origen.id && !reenvioPropio) {
          textoTtl = " El TTL baja de " + ttl + " a " + (ttl - 1) + ": cada router descuenta uno.";
          ttl -= 1;
        }
        if (destPar.dispositivo.id !== actualId) {
          anotarTrama(actualId, actualIface, destPar.dispositivo.id, destPar.interfaz, ttl);
        }
        var hubsCruzados = tramoL2(estado, actualId, actualIface.id, destPar.dispositivo.id, destPar.interfaz.id).atraviesa
          .filter(function (id) { return esHub(buscarDispositivo(estado, id)); });
        var textoSwitch = nom(actualId) + " averigua la MAC de " + destinoIp + " (ARP) y " + ((conmutadores.length > 0 || hayAp)
          ? (hubsCruzados.length
            ? "el hub " + hubsCruzados.map(nom).join(" y el hub ") + " repite la trama por todos sus puertos: la reciben todos los equipos " +
              "conectados y sólo " + nombreDestinoFinal + " la acepta, porque la MAC de destino es la suya."
            : hayAp
            ? "el punto de acceso le hace llegar la trama a " + nombreDestinoFinal + ": se guía por direcciones MAC, no por IP."
            : "el switch reenvía la trama por el puerto donde está " + nombreDestinoFinal + ": un switch se guía por direcciones MAC, no por IP.")
          : "el paquete llega directo a " + nombreDestinoFinal + " por el cable.");
        agregarPaso("Entregar el paquete al destino", textoSwitch + textoTtl, true, 2);
        var enlacesFinal = enlacesDe(estado, actualId, actualIface.id);
        if (enlacesFinal.length > 0) {
          msTotal += (enlacesFinal[0].retardoMs || 0) + 1;
        } else {
          msTotal += 1;
        }
        if (destPar.dispositivo.id !== actualId || destPar.interfaz.id !== actualIface.id) {
          saltos.push({ dispositivo: destPar.dispositivo.id, interfaz: destPar.interfaz.id });
        }

        // La respuesta llegó a la IP pública de un router con NAT: la
        // traduce de vuelta a la IP privada y sigue desde ahí.
        if (natInverso && destPar.dispositivo.id === natInverso.router && destinoIp === natInverso.ipPublica) {
          agregarPaso("Deshacer la traducción (NAT)",
            "La respuesta llega a " + destinoIp + ": " + nombreDestinoFinal + " recuerda la traducción, la cambia por " +
            natInverso.ipPrivada + " y la reenvía.", true, 3);
          destinoIp = natInverso.ipPrivada;
          natInverso = null;
          actualId = destPar.dispositivo.id;
          actualIface = destPar.interfaz;
          actualIp = destPar.interfaz.ip;
          reenvioPropio = false;
          continue;
        }

        // Paso 11: la vuelta. Sin camino de retorno, el ping falla aunque la
        // ida haya sido perfecta: ese es el D12.
        var tramasVuelta = null;
        if (profundidad < 1) {
          agregarPaso("Comprobar que la respuesta pueda volver",
            nombreDestinoFinal + " le responde a " + ipOrigen + ": la respuesta hace el camino inverso.", true, 3);
          var firewallsConEstado = [];
          var vuelta = ejecutarPing(estado, destPar.dispositivo.id, actualIp === destinoIp && actualId === origen.id ? ipOrigen : ipOrigen, {
            registrar: false,
            profundidad: profundidad + 1,
            respuestaDe: conexionIda,
            porEstado: firewallsConEstado,
            natInverso: traduccion,
            paquete: invertirPaquete(paquete)
          });
          var tramasVuelta = tramasDeVuelta(vuelta);
          Array.prototype.push.apply(tramas, tramasVuelta);
          if (vuelta.exito && firewallsConEstado.length) {
            agregarPaso("Dejar volver la respuesta por el firewall",
              firewallsConEstado.join(" y ") + (firewallsConEstado.length > 1 ? " son firewalls y recuerdan" : " es un firewall y recuerda") +
              " la conversación: la respuesta pasa sin revisar las reglas, porque responde a un paquete que ya dejó pasar.", true, 3);
          }
          // Si el destino es el mismo equipo que el origen (ping a sí mismo),
          // la vuelta siempre existe.
          var esAPropiaIp = false;
          var propias = configuradosConIp(estado, ipOrigen);
          for (var pi = 0; pi < propias.length; pi++) {
            if (propias[pi].dispositivo.id === destPar.dispositivo.id) {
              esAPropiaIp = true;
              break;
            }
          }
          if (!esAPropiaIp && !vuelta.exito) {
            return {
              exito: false,
              pasos: pasos.concat(vuelta.pasos.map(function (p) {
                return {
                  n: pasos.length + p.n,
                  titulo: "Respuesta: " + p.titulo,
                  detalle: p.detalle,
                  ok: p.ok,
                  capa: p.capa
                };
              })),
              saltos: saltos,
              diagnostico: diagnosticoVuelta(vuelta, destPar.dispositivo.nombre || destPar.dispositivo.id),
              respuestas: []
            };
          }
        }
        respuestas.push({ ttl: ttlDeRespuesta(tramasVuelta || [], saltos), ms: Math.max(1, Math.round(msTotal)) });
        return { exito: true, pasos: pasos, saltos: saltos, diagnostico: null, respuestas: respuestas };
      }

      // Distinta red: pasos 6 a 9. Un router consulta su propia tabla de
      // rutas (que incluye su campo gateway como último recurso); un host le
      // pasa el paquete a su puerta de enlace.
      var router;
      if (esRouter(dispActual)) {
        router = dispActual;
      } else {
        var gw = dispActual.gateway;
        if (!gw || !Red.esIpValida(gw)) {
          agregarPaso("Buscar la puerta de enlace",
            nom(actualId) + " no tiene puerta de enlace para salir de su red.", false, 3);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D08", {
              origen: nom(actualId), destino: destinoIp, red: redA + "/" + actualIface.prefijo, redDestino: redD
            }),
            respuestas: []
          };
        }
        agregarPaso("Buscar la puerta de enlace",
          nom(actualId) + " usa la puerta de enlace " + gw + " para salir de su red (" + redA + ").", true, 3);

        // Paso 7: el gateway tiene que pertenecer a la red del que envía.
        var redGw = Red.direccionDeRed(gw, actualIface.prefijo);
        var andGw = Red.and(gw, actualIface.prefijo);
        var detalleGw = "La puerta de enlace " + gw + " AND la máscara de " + nom(actualId) + " = " + redGw + ".\n" +
          (andGw ? "Puerta de enlace: " + andGw.binarioIp + "\nMáscara:          " +
            andGw.binarioMascara + "\nResultado:        " + andGw.binarioResultado + "\n" : "") +
          (redGw === redA
            ? "Es la misma red de " + nom(actualId) + " (" + redA + "): la puede alcanzar."
            : "Es distinta de la red de " + nom(actualId) + " (" + redA + "): está fuera de su red.");
        if (redGw !== redA) {
          agregarPaso("Comprobar que la puerta de enlace esté en la red del equipo", detalleGw, false, 3);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D09", {
              gateway: gw, red: redA, prefijo: actualIface.prefijo,
              equipo: dispActual.nombre || dispActual.id
            }),
            respuestas: []
          };
        }
        agregarPaso("Comprobar que la puerta de enlace esté en la red del equipo", detalleGw, true, 3);

        // Paso 8: ARP al gateway.
        var respGw = respondedoresArp(estado, actualId, actualIface.id, gw);
        if (respGw.length > 1) {
          agregarPaso("Averiguar la dirección MAC de la puerta de enlace (ARP)",
            nom(actualId) + " preguntó quién tiene " + gw + " y respondieron varios equipos.", false, 2);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D07", { ip: gw, origen: nom(respGw[0].dispositivo.id), otro: nom(respGw[1].dispositivo.id) }),
            respuestas: []
          };
        }
        if (respGw.length === 0) {
          agregarPaso("Averiguar la dirección MAC de la puerta de enlace (ARP)",
            nom(actualId) + " preguntó en su red quién tiene " + gw + ", y nadie respondió.", false, 2);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D10", { gateway: gw, origen: nom(actualId) }),
            respuestas: []
          };
        }
        agregarArp(estado, actualId, gw, respGw[0].interfaz.mac, registrar);
        agregarPaso("Averiguar la dirección MAC de la puerta de enlace (ARP)",
          nom(actualId) + " pregunta en su red quién tiene " + gw + ", y " + nom(respGw[0].dispositivo.id) +
          " responde con su dirección MAC.", true, 2);
        anotarTrama(actualId, actualIface, respGw[0].dispositivo.id, respGw[0].interfaz, ttl);
        var enlacesUsados = enlacesDe(estado, actualId, actualIface.id);
        if (enlacesUsados.length > 0) {
          msTotal += (enlacesUsados[0].retardoMs || 0) + 1;
        } else {
          msTotal += 1;
        }

        // El gateway tiene que ser un router (o al menos el equipo que responde).
        router = respGw[0].dispositivo;
        var gatewayNube = revisarNube(router, respGw[0].interfaz.id);
        if (gatewayNube) { return gatewayNube; }
        if (!esRouter(router)) {
          agregarPaso("Entregar el paquete a la puerta de enlace",
            "Quien responde por " + gw + " es " + nom(router.id) + ", que no es un router: no sabe reenviar paquetes a otra red.", false, 3);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D11", { router: nom(router.id), destino: destinoIp, noRouter: true }),
            respuestas: []
          };
        }
      }

      // Paso 9: ruta más específica en el router.
      var ruta = rutaElegida(estado, router.id, destinoIp);
      if (!ruta) {
        agregarPaso("Buscar ruta en " + nom(router.id),
          "Ninguna ruta de " + nom(router.id) + " cubre a " + destinoIp + ", y no tiene ruta por defecto.", false, 3);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D11", { router: nom(router.id), destino: destinoIp }),
          respuestas: []
        };
      }
      var textoRuta = ruta.directa
        ? "El destino está en una red conectada directamente a " + nom(router.id) + " (" + ruta.destino + "/" + ruta.prefijo +
          ", puerto " + ruta.interfaz + ")."
        : (ruta.prefijo === 0
          ? "No hay una ruta específica: " + nom(router.id) + " usa la ruta por defecto, por " + (ruta.siguienteSalto || "su interfaz") + "."
          : nom(router.id) + " elige la ruta hacia " + ruta.destino + "/" + ruta.prefijo + " por " + (ruta.siguienteSalto || "su interfaz") +
            ": es la más específica que coincide con el destino (prefijo más largo).");
      agregarPaso("Buscar ruta en " + nom(router.id), textoRuta, true, 3);
      var filtroRuta = revisarFiltro(router);
      if (filtroRuta) { return filtroRuta; }

      // Paso 10: avanzar al siguiente salto.
      var egreso = null;
      if (ruta.directa && ruta.interfaz) {
        egreso = buscarInterfaz(router, ruta.interfaz);
      } else if (ruta.siguienteSalto) {
        for (var ei = 0; ei < router.interfaces.length; ei++) {
          var eCand = router.interfaces[ei];
          if (!eCand.habilitada || !eCand.ip || !prefijoValido(eCand.prefijo)) {
            continue;
          }
          if (Red.mismaRed(eCand.ip, ruta.siguienteSalto, eCand.prefijo)) {
            egreso = eCand;
            break;
          }
        }
        if (!egreso) {
          agregarPaso("Reenviar el paquete",
            "La ruta manda los paquetes a " + ruta.siguienteSalto + ", pero esa dirección no está en ninguna red conectada a " +
            nom(router.id) + ".", false, 3);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D22", {
              router: router.nombre || router.id,
              red: ruta.destino + "/" + ruta.prefijo,
              siguienteSalto: ruta.siguienteSalto
            }),
            respuestas: []
          };
        }
      } else {
        egreso = elegirInterfazOrigen(estado, router, destinoIp);
      }
      if (!router.encendido || !egreso || !egreso.habilitada) {
        agregarPaso("Reenviar el paquete",
          nom(router.id) + " está apagado o su puerto de salida está deshabilitado.", false, 1);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D01", { origen: nom(router.id), interfaz: egreso ? egreso.id : "?" }),
          respuestas: []
        };
      }
      // La salida también puede ser un puerto ap con varios enlaces: alcanza
      // con que uno deje pasar la trama.
      var enlacesEgreso = enlacesDe(estado, router.id, egreso.id);
      var egresoUsable = null;
      var problemaEgreso = null;
      for (var loi = 0; loi < enlacesEgreso.length; loi++) {
        var candEg = enlacesEgreso[loi];
        var compatEg = mediosCompatibles(estado, candEg);
        if (!compatEg.ok) {
          if (!problemaEgreso) {
            problemaEgreso = {
              codigo: "D03",
              ctx: {
                cable: mayuscula(cableEntre(estado, candEg)), tipoCable: " es " + palabraMedio(candEg.tipo),
                medioA: palabraMedio(compatEg.medioA), medioB: palabraMedio(compatEg.medioB)
              },
              detalle: mayuscula(cableEntre(estado, candEg)) + " es " + palabraMedio(candEg.tipo) + " y une un puerto " +
                palabraMedio(compatEg.medioA) + " con uno " + palabraMedio(compatEg.medioB) + "."
            };
          }
          continue;
        }
        if (candEg.tipo === "wireless" && !modosEnlaceOk(estado, candEg)) {
          if (!problemaEgreso) {
            var modosEg = modoEnlaceDe(estado, candEg, router.id, egreso.id);
            var otroEg = buscarDispositivo(estado, modosEg.otroDispositivo);
            problemaEgreso = {
              codigo: "D18",
              ctx: {
                enlace: candEg.id,
                modoA: modosEg.mio, modoB: modosEg.ajeno,
                nombreA: router.nombre || router.id,
                nombreB: (otroEg && (otroEg.nombre || otroEg.id)) || modosEg.otroDispositivo
              },
              detalle: mayuscula(cableEntre(estado, candEg)) + " une modos de radio que no se entienden (" +
                modosEg.mio + " con " + modosEg.ajeno + ")."
            };
          }
          continue;
        }
        var wlEgreso = chequeoWireless(estado, candEg);
        if (wlEgreso.aplica && !wlEgreso.enAlcance) {
          if (!problemaEgreso) {
            problemaEgreso = {
              codigo: "D17",
              ctx: {
                distancia: wlEgreso.distancia, umbral: estado.umbralWireless,
                nombreA: nom(router.id), nombreB: nom(otraPunta(candEg, router.id))
              },
              detalle: nom(router.id) + " está a " + wlEgreso.distancia + " m de " + nom(otraPunta(candEg, router.id)) +
                " y el alcance máximo es de " + estado.umbralWireless + " m."
            };
          }
          continue;
        }
        if (candEg.estado !== "up") {
          if (!problemaEgreso) {
            problemaEgreso = {
              codigo: "D02",
              ctx: { origen: nom(router.id), interfaz: egreso.id },
              detalle: mayuscula(cableEntre(estado, candEg)) + " está marcado como caído."
            };
          }
          continue;
        }
        egresoUsable = candEg;
        break;
      }
      if (!egresoUsable) {
        var pe = problemaEgreso || {
          codigo: "D02",
          ctx: { origen: nom(router.id), interfaz: egreso.id },
          detalle: "El puerto " + egreso.id + " de " + nom(router.id) + " no tiene un cable activo."
        };
        agregarPaso("Reenviar el paquete", pe.detalle, false, 1);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe(pe.codigo, pe.ctx),
          respuestas: []
        };
      }
      var siguienteDispositivo = router;
      var siguienteInterfaz = egreso;
      var siguienteIp = egreso.ip;
      if (!ruta.directa && ruta.siguienteSalto) {
        var vecinos = respondedoresArp(estado, router.id, egreso.id, ruta.siguienteSalto)
          .filter(function (vecino) { return vecino.dispositivo.id !== router.id; });
        if (vecinos.length !== 1 || !esRouter(vecinos[0].dispositivo)) {
          agregarPaso("Averiguar la dirección MAC del siguiente router (ARP)",
            nom(router.id) + " pregunta quién tiene " + ruta.siguienteSalto + ", y ningún router responde.", false, 2);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D22", {
              router: router.nombre || router.id,
              red: ruta.destino + "/" + ruta.prefijo,
              siguienteSalto: ruta.siguienteSalto,
              motivo: "sin-respuesta"
            }),
            respuestas: []
          };
        }
        siguienteDispositivo = vecinos[0].dispositivo;
        siguienteInterfaz = vecinos[0].interfaz;
        siguienteIp = vecinos[0].interfaz.ip;
        agregarArp(estado, router.id, ruta.siguienteSalto, vecinos[0].interfaz.mac, registrar);
        agregarArp(estado, vecinos[0].dispositivo.id, egreso.ip, egreso.mac, registrar);
      }
      // NAT de salida: con el filtrado ya hecho (las reglas ven la IP
      // privada), el router cambia el origen privado por la IP del puerto.
      if (egreso.nat && egreso.ip && Red.esIpValida(egreso.ip) && Red.clasificar(ipOrigen) !== "publica" && ipOrigen !== egreso.ip) {
        agregarPaso("Traducir la dirección de origen (NAT)",
          nom(router.id) + " cambia la IP de origen " + ipOrigen + " por la de su puerto " + egreso.id + ", " + egreso.ip +
          ", y anota la traducción para reconocer la respuesta.", true, 3);
        traduccion = { router: router.id, ipPublica: egreso.ip, ipPrivada: ipOrigen };
        ipOrigen = egreso.ip;
      }
      ultimoRouter = { id: router.id, puerto: egreso.id };
      recorrido.push(router.nombre || router.id);
      saltos.push({ dispositivo: router.id, interfaz: egreso.id });
      if (siguienteDispositivo.id !== router.id) {
        saltos.push({ dispositivo: siguienteDispositivo.id, interfaz: siguienteInterfaz.id });
      }
      agregarPaso("Reenviar el paquete",
        nom(router.id) + " lo envía por " + egreso.id +
        (siguienteDispositivo.id !== router.id ? " hacia " + nom(siguienteDispositivo.id) : " a la red del destino") +
        ". El TTL baja de " + ttl + " a " + (ttl - 1) + ": cada router descuenta uno.", true, 3);
      ttl -= 1;
      reenvioPropio = siguienteDispositivo.id === router.id;
      if (!reenvioPropio) {
        anotarTrama(router.id, egreso, siguienteDispositivo.id, siguienteInterfaz, ttl);
      }
      actualId = siguienteDispositivo.id;
      actualIface = siguienteInterfaz;
      actualIp = siguienteIp;
    }
  }

  /* ---------------- Nombres: una resolución DNS mínima ----------------
   * Si el destino es un nombre, el equipo consulta a su servidor DNS (la
   * consulta es un viaje de ida y vuelta hasta esa IP) y, si el nombre
   * existe, hace el ping a la IP que resultó. */

  /* ---------------- DNS: jerarquía pública, servidores y caché ----------------
   * La nube trae la jerarquía armada: la raíz, los servidores de cada TLD y
   * los autoritativos de algunas zonas. Las IP de la raíz, de .com y de
   * ns1.google.com son las reales; las demás, ilustrativas. */
  var TIPOS_REGISTRO = ["A", "CNAME", "MX", "NS"];
  var TTL_DNS = 300;
  var JERARQUIA = {
    raiz: { nombre: "a.root-servers.net", ip: "198.41.0.4" },
    tld: {
      com: { nombre: "a.gtld-servers.net", ip: "192.5.6.30" },
      net: { nombre: "a.gtld-servers.net", ip: "192.5.6.30" },
      org: { nombre: "a0.org.afilias-nst.info", ip: "199.19.56.1" },
      ar: { nombre: "a.dns.ar", ip: "200.108.145.50" },
      google: { nombre: "ns-tld1.charlestonroadregistry.com", ip: "216.239.32.105" },
      one: { nombre: "a.nic.one", ip: "37.209.192.12" }
    },
    zonas: {
      "google.com": { ns: "ns1.google.com", ip: "216.239.32.10", registros: [
        { nombre: "google.com", tipo: "A", valor: "142.250.79.46" },
        { nombre: "www.google.com", tipo: "CNAME", valor: "google.com" },
        { nombre: "google.com", tipo: "MX", valor: "smtp.google.com", prioridad: 10 },
        { nombre: "smtp.google.com", tipo: "A", valor: "142.250.0.27" },
        { nombre: "google.com", tipo: "NS", valor: "ns1.google.com" }
      ] },
      "dns.google": { ns: "ns1.zdns.google", ip: "216.239.32.114", registros: [
        { nombre: "dns.google", tipo: "A", valor: "8.8.8.8" },
        { nombre: "dns.google", tipo: "NS", valor: "ns1.zdns.google" }
      ] },
      "one.one": { ns: "ns1.cloudflare.com", ip: "173.245.58.51", registros: [
        { nombre: "one.one.one.one", tipo: "A", valor: "1.1.1.1" },
        { nombre: "one.one", tipo: "NS", valor: "ns1.cloudflare.com" }
      ] },
      "wikipedia.org": { ns: "ns0.wikimedia.org", ip: "208.80.154.238", registros: [
        { nombre: "wikipedia.org", tipo: "A", valor: "208.80.154.224" },
        { nombre: "www.wikipedia.org", tipo: "CNAME", valor: "wikipedia.org" },
        { nombre: "wikipedia.org", tipo: "NS", valor: "ns0.wikimedia.org" }
      ] }
    }
  };
  var RESOLVERS_PUBLICOS = { "8.8.8.8": "Google Public DNS", "1.1.1.1": "Cloudflare" };

  function dentroDeZona(nombre, zona) {
    return nombre === zona || nombre.slice(-(zona.length + 1)) === "." + zona;
  }

  // Los registros que contestan nombre/tipo, siguiendo los CNAME dentro de
  // la misma lista. Devuelve null si el nombre no tiene ningún registro.
  function buscarRegistros(registros, nombre, tipo) {
    var cadena = [];
    var actual = nombre;
    for (var vueltas = 0; vueltas < 5; vueltas++) {
      var delNombre = registros.filter(function (x) { return x.nombre === actual; });
      if (!delNombre.length) { return cadena.length ? { registros: cadena, pendiente: actual } : null; }
      var directos = delNombre.filter(function (x) { return x.tipo === tipo; });
      if (directos.length) { return { registros: cadena.concat(directos), pendiente: null }; }
      var alias = delNombre.filter(function (x) { return x.tipo === "CNAME"; })[0];
      if (!alias) { return { registros: cadena, pendiente: null }; }
      cadena.push(alias);
      actual = alias.valor;
    }
    return { registros: cadena, pendiente: null };
  }

  function textoRegistro(x) {
    return x.nombre + " " + x.tipo + " " + (x.prioridad !== undefined && x.prioridad !== null ? x.prioridad + " " : "") + x.valor;
  }

  function zonaPublicaDe(nombre) {
    var mejor = null;
    Object.keys(JERARQUIA.zonas).forEach(function (z) {
      if (dentroDeZona(nombre, z) && (!mejor || z.length > mejor.length)) { mejor = z; }
    });
    return mejor;
  }

  // Consultas iterativas por la jerarquía, desde quien resuelve. agregar
  // suma un paso de capa 7; devuelve { registros } o { fallo: {ctx} }.
  function iterarJerarquia(nombre, tipo, quien, agregar, profundidad) {
    var etiquetas = nombre.split(".");
    var tld = etiquetas[etiquetas.length - 1];
    var datosTld = JERARQUIA.tld[tld];
    var raiz = JERARQUIA.raiz;
    if (!datosTld) {
      agregar("Preguntar a la raíz (consulta iterativa)", quien + " le pregunta a " + raiz.nombre + " (" + raiz.ip + "), un servidor raíz, por " +
        nombre + ". La raíz responde que ." + tld + " no existe en internet.", false, raiz.ip);
      return { fallo: { tld: tld } };
    }
    agregar("Preguntar a la raíz (consulta iterativa)", quien + " le pregunta a " + raiz.nombre + " (" + raiz.ip + "), un servidor raíz, por " +
      nombre + ". La raíz no sabe la respuesta, pero sabe quién atiende ." + tld + ": " + datosTld.nombre + " (" + datosTld.ip + ").", true, raiz.ip);
    var zona = zonaPublicaDe(nombre);
    if (!zona) {
      agregar("Preguntar al servidor de ." + tld + " (consulta iterativa)", quien + " le pregunta a " + datosTld.nombre + " por " + nombre +
        ", y responde que ese nombre no está registrado en ." + tld + ".", false, datosTld.ip);
      return { fallo: { quien: datosTld.nombre + ", el servidor de ." + tld } };
    }
    var auth = JERARQUIA.zonas[zona];
    agregar("Preguntar al servidor de ." + tld + " (consulta iterativa)", quien + " le pregunta a " + datosTld.nombre + " por " + nombre +
      ". Tampoco sabe la respuesta, pero sabe cuál es el servidor autoritativo de " + zona + ": " + auth.ns + " (" + auth.ip + ").", true, datosTld.ip);
    var hallado = buscarRegistros(auth.registros, nombre, tipo);
    if (!hallado || (!hallado.registros.length && !hallado.pendiente)) {
      agregar("Preguntar al autoritativo de " + zona + " (consulta iterativa)", quien + " le pregunta a " + auth.ns +
        ", el servidor autoritativo de " + zona + ", y responde que " + nombre + " no tiene registros " + tipo + ".", false, auth.ip);
      return { fallo: { quien: auth.ns, zona: zona } };
    }
    agregar("Preguntar al autoritativo de " + zona + " (consulta iterativa)", quien + " le pregunta a " + auth.ns +
      ", el servidor autoritativo de " + zona + ", que responde: " + hallado.registros.map(textoRegistro).join("; ") + ".", true, auth.ip);
    if (hallado.pendiente && (profundidad || 0) < 3) {
      // El CNAME apunta a otra zona: se resuelve el nombre nuevo.
      var resto = iterarJerarquia(hallado.pendiente, tipo, quien, agregar, (profundidad || 0) + 1);
      if (resto.fallo) { return resto; }
      return { registros: hallado.registros.concat(resto.registros) };
    }
    return { registros: hallado.registros };
  }

  function ttlDe(registros) {
    var minimo = null;
    registros.forEach(function (x) {
      var t = Number(x.ttl) > 0 ? Number(x.ttl) : TTL_DNS;
      if (minimo === null || t < minimo) { minimo = t; }
    });
    return minimo === null ? TTL_DNS : minimo;
  }

  function vaciarCacheDns(estado, idResolver) {
    if (!estado.cacheDns) { return; }
    if (idResolver) { delete estado.cacheDns[idResolver]; } else { estado.cacheDns = {}; }
  }

  /* Resolución completa de un nombre desde un equipo. La consulta del
   * cliente a su servidor es recursiva (pide la respuesta final); las del
   * servidor a la jerarquía son iterativas (cada una lo deriva a otra). */
  function resolverNombre(estado, idCliente, nombre, tipo) {
    var pasos = [];
    function agregar(titulo, detalle, ok) {
      pasos.push({ n: pasos.length + 1, titulo: titulo, detalle: detalle, ok: !!ok, capa: 7 });
    }
    var tramasDns = [];
    var viaje = null;
    var consultaInfo = "Consulta estándar " + tipo + " " + nombre;
    function dnsUdp(po, pd, info, datos) {
      return { protocolo: "DNS", puertoOrigen: po, puertoDestino: pd, info: info, mensaje: "DNS " + info, datos: datos || null };
    }
    function fallar(codigo, ctx, saltos) {
      // Si el servidor recibió la consulta, contesta con el error.
      if (viaje && viaje.exito && codigo !== "D29") {
        Array.prototype.push.apply(tramasDns, tramasCon(vueltaDe(viaje), dnsUdp(53, puertoDns, "Respuesta estándar: " + nombre + " no existe")));
      }
      return { exito: false, pasos: pasos, respuesta: null, diagnostico: diagnosticoDe(codigo, ctx), saltos: saltos || [], tramas: tramasDns };
    }
    var cliente = buscarDispositivo(estado, idCliente);
    var nombreCliente = cliente ? (cliente.nombre || cliente.id) : idCliente;
    var titulo = "Consultar al servidor DNS (consulta recursiva)";
    var dnsIp = cliente && cliente.dns ? String(cliente.dns).trim() : "";
    if (!dnsIp || !Red.esIpValida(dnsIp)) {
      agregar(titulo, nombreCliente + " necesita la IP de " + nombre + ", pero no tiene servidor DNS configurado.", false);
      return fallar("D24", { origen: nombreCliente, nombre: nombre });
    }
    var puertoDns = puertoEfimero(dnsIp, 53);
    viaje = ejecutarPing(estado, idCliente, dnsIp, { registrar: false, profundidad: 0,
      paquete: { protocolo: "udp", puertoOrigen: puertoDns, puertoDestino: 53 } });
    Array.prototype.push.apply(tramasDns, tramasCon(idaDe(viaje), dnsUdp(puertoDns, 53, consultaInfo)));
    if (!viaje.exito) {
      var dc = viaje.diagnostico;
      agregar(titulo, nombreCliente + " le pregunta al servidor DNS " + dnsIp + " por " + nombre + " y la consulta no llega" +
        (dc ? ": " + dc.titulo.charAt(0).toLowerCase() + dc.titulo.slice(1) + "." : "."), false);
      return fallar("D26", { origen: nombreCliente, nombre: nombre, dns: dnsIp, causa: dc ? dc.explicacion : "" }, viaje.saltos);
    }
    // ¿Quién atiende en esa IP?
    var duenos = configuradosConIp(estado, dnsIp).filter(function (e) { return e.interfaz.habilitada; });
    var servidor = duenos.length ? duenos[0].dispositivo : null;
    var servicio = servidor && servidor.tipo === "servidor" && servidor.servicios && servidor.servicios.dns;
    var publico = !servidor && RESOLVERS_PUBLICOS[dnsIp];
    if (!servicio && !publico) {
      agregar(titulo, nombreCliente + " le pregunta a " + dnsIp + " por " + nombre + ". La IP responde, pero ahí no hay un servidor DNS.", false);
      return fallar("D29", { origen: nombreCliente, nombre: nombre, dns: dnsIp, equipo: servidor ? (servidor.nombre || servidor.id) : null });
    }
    var quien = servicio ? (servidor.nombre || servidor.id) : dnsIp + " (" + publico + ")";
    agregar(titulo, nombreCliente + " le pregunta a su servidor DNS, " + quien + ", por " + nombre + " (tipo " + tipo + "). " +
      "Es una consulta recursiva: le pide la respuesta final.", true);

    function responder(registros, autoritativa, desdeCache) {
      var textoResp = registros.map(function (x) { return x.tipo + " " + x.valor; }).join(", ");
      Array.prototype.push.apply(tramasDns, tramasCon(vueltaDe(viaje),
        dnsUdp(53, puertoDns, "Respuesta estándar " + tipo + " " + nombre + ": " + textoResp, textoResp)));
      return {
        exito: true, pasos: pasos, diagnostico: null, saltos: viaje.saltos, tramas: tramasDns,
        respuesta: { registros: registros, servidor: quien, autoritativa: autoritativa, desdeCache: desdeCache }
      };
    }

    // Servidor propio: autoritativo de su zona.
    if (servicio) {
      var zona = String(servicio.zona || "");
      if (zona && dentroDeZona(nombre, zona)) {
        var propio = buscarRegistros(servicio.registros || [], nombre, tipo);
        if (!propio || !propio.registros.length) {
          agregar("Buscar en la zona " + zona, quien + " es el servidor de la zona " + zona + " y no tiene registros " + tipo + " para " + nombre + ".", false);
          return fallar("D25", { nombre: nombre, quien: quien, zona: zona });
        }
        agregar("Responder con autoridad (zona " + zona + ")", quien + " es el servidor de la zona " + zona + " y tiene el registro: " +
          propio.registros.map(textoRegistro).join("; ") + ".", true);
        return responder(propio.registros, true, false);
      }
      if (servicio.recursivo === false) {
        agregar("Buscar afuera de la zona", quien + " sólo responde por " + (zona || "su zona") + ": no busca " + nombre + " en internet.", false);
        return fallar("D25", { nombre: nombre, quien: quien, zona: zona || "?", noRecursivo: true });
      }
    }

    // Caché del resolver.
    estado.cacheDns = estado.cacheDns || {};
    var claveResolver = servicio ? servidor.id : dnsIp;
    var cache = estado.cacheDns[claveResolver] || (estado.cacheDns[claveResolver] = {});
    var ahora = estado.ahora || Date.now();
    var guardado = cache[nombre + "|" + tipo];
    if (guardado && guardado.vence > ahora) {
      var quedan = Math.max(1, Math.round((guardado.vence - ahora) / 1000));
      agregar("Responder desde la caché", quien + " ya resolvió " + nombre + " hace poco: lo tiene en su caché (le quedan " + quedan +
        " s). Responde sin preguntarle a nadie: " + guardado.registros.map(textoRegistro).join("; ") + ".", true);
      return responder(guardado.registros, false, true);
    }

    // Un servidor propio necesita llegar a internet para recursar.
    var aRaiz = null;
    if (servicio) {
      aRaiz = ejecutarPing(estado, servidor.id, JERARQUIA.raiz.ip, { registrar: false, profundidad: 0,
        paquete: { protocolo: "udp", puertoOrigen: puertoEfimero(JERARQUIA.raiz.ip, 53), puertoDestino: 53 } });
      if (!aRaiz.exito) {
        var dr = aRaiz.diagnostico;
        agregar("Preguntar a la raíz (consulta iterativa)", quien + " no tiene " + nombre + " en su zona y le quiere preguntar a la raíz (" +
          JERARQUIA.raiz.ip + "), pero la consulta no llega" + (dr ? ": " + dr.titulo.charAt(0).toLowerCase() + dr.titulo.slice(1) + "." : "."), false);
        return fallar("D30", { servidor: quien, nombre: nombre, causa: dr ? dr.explicacion : "" });
      }
    }
    var pasosAntes = pasos.length;
    var ipsIterativas = [];
    var resultado = iterarJerarquia(nombre, tipo, quien, function (t, d, ok, ipServidor) {
      ipsIterativas.push(ipServidor);
      agregar(t, d, ok);
    }, 0);
    // Las consultas iterativas del servidor propio salen por su camino a
    // internet: una pregunta y su respuesta por cada servidor consultado.
    if (servicio && aRaiz && aRaiz.exito) {
      pasos.slice(pasosAntes).forEach(function (p, k) {
        var aQuien = p.titulo.replace(" (consulta iterativa)", "").replace("Preguntar ", "");
        var ipServ = ipsIterativas[k] || JERARQUIA.raiz.ip;
        var po = puertoEfimero(ipServ, 53);
        // El camino es el mismo hasta internet; cambia la IP del servidor.
        var consulta = dnsUdp(po, 53, consultaInfo + " (" + aQuien + ")");
        consulta.ipDestino = ipServ;
        var resp = dnsUdp(53, po, "Respuesta " + aQuien.replace(/^a la /, "de la ").replace(/^al /, "del ") + (p.ok ? "" : ": no existe"));
        resp.ipOrigen = ipServ;
        Array.prototype.push.apply(tramasDns, tramasCon(idaDe(aRaiz), consulta));
        Array.prototype.push.apply(tramasDns, tramasCon(vueltaDe(aRaiz), resp));
      });
    }
    if (resultado.fallo) {
      var ctxFallo = resultado.fallo;
      ctxFallo.nombre = nombre;
      return fallar("D25", ctxFallo);
    }
    cache[nombre + "|" + tipo] = { registros: resultado.registros, vence: ahora + ttlDe(resultado.registros) * 1000 };
    agregar("Responder al cliente", quien + " le contesta a " + nombreCliente + " (respuesta no autoritativa: la obtuvo de otros servidores) " +
      "y la guarda en su caché por " + ttlDe(resultado.registros) + " s.", true);
    return responder(resultado.registros, false, false);
  }

  /* ---------------- Servicios, puertos y conexiones ----------------
   * Un servidor escucha en puertos (servicios.escuchando, más DNS en 53/UDP).
   * Una conexión TCP se abre con el handshake de tres pasos, lleva un
   * pedido y su respuesta, y se cierra con FIN; UDP manda datagramas sin
   * conexión. */
  var SERVICIOS_CONOCIDOS = [
    { id: "http", nombre: "HTTP", protocolo: "tcp", puerto: 80, pedido: "GET / HTTP/1.1", respuesta: "HTTP/1.1 200 OK (la página)" },
    { id: "https", nombre: "HTTPS", protocolo: "tcp", puerto: 443, pedido: "datos cifrados (TLS)", respuesta: "datos cifrados (TLS): no se ve el contenido" },
    { id: "ssh", nombre: "SSH", protocolo: "tcp", puerto: 22, pedido: "SSH-2.0-cliente", respuesta: "SSH-2.0-OpenSSH (pide usuario y clave)" },
    { id: "ftp", nombre: "FTP", protocolo: "tcp", puerto: 21, pedido: "USER alumno", respuesta: "220 Servicio FTP listo" },
    { id: "smtp", nombre: "SMTP", protocolo: "tcp", puerto: 25, pedido: "HELO cliente", respuesta: "220 ESMTP listo" },
    { id: "dns", nombre: "DNS", protocolo: "udp", puerto: 53, pedido: "consulta DNS", respuesta: "respuesta DNS" }
  ];
  var SERVICIOS_INTERNET = {
    "142.250.79.46": [["tcp", 80], ["tcp", 443]],
    "208.80.154.224": [["tcp", 80], ["tcp", 443]],
    "8.8.8.8": [["udp", 53], ["tcp", 53], ["tcp", 443]],
    "1.1.1.1": [["udp", 53], ["tcp", 53], ["tcp", 443]]
  };

  function servicioConocido(protocolo, puerto) {
    return SERVICIOS_CONOCIDOS.filter(function (x) { return x.protocolo === protocolo && x.puerto === puerto; })[0] || null;
  }

  // ¿Quién atiende protocolo/puerto en esa IP? Devuelve el nombre del
  // servicio o null si el puerto está cerrado.
  function quienEscucha(estado, ip, protocolo, puerto) {
    var duenos = configuradosConIp(estado, ip).filter(function (e) { return e.interfaz.habilitada; });
    var dev = duenos.length ? duenos[0].dispositivo : null;
    if (!dev) {
      var publicos = SERVICIOS_INTERNET[ip] || [];
      return publicos.some(function (p) { return p[0] === protocolo && p[1] === puerto; })
        ? (servicioConocido(protocolo, puerto) || { nombre: protocolo.toUpperCase() + " " + puerto }).nombre : null;
    }
    if (dev.tipo !== "servidor" || !dev.servicios) { return null; }
    if (dev.servicios.dns && protocolo === "udp" && puerto === 53) { return "DNS"; }
    var propio = (dev.servicios.escuchando || []).filter(function (x) { return x.protocolo === protocolo && Number(x.puerto) === puerto; })[0];
    if (!propio) { return null; }
    return propio.nombre || (servicioConocido(protocolo, puerto) || { nombre: protocolo.toUpperCase() + " " + puerto }).nombre;
  }

  function puertoEfimero(ip, puerto) {
    var suma = String(ip).split(".").reduce(function (a, b) { return a + Number(b); }, 0);
    return 49152 + ((suma + puerto) % 16000);
  }

  function conectar(estado, idCliente, destino, protocolo, puerto, opciones) {
    opciones = opciones || {};
    estado.ahora = opciones.ahora || Date.now();
    protocolo = protocolo === "udp" ? "udp" : "tcp";
    puerto = Number(puerto);
    var pasos = [];
    var segmentos = [];
    function agregar(titulo, detalle, ok, capa) { pasos.push({ n: pasos.length + 1, titulo: titulo, detalle: detalle, ok: !!ok, capa: capa }); }
    function fallo(diag) { return { exito: false, pasos: pasos, segmentos: segmentos, socket: null, diagnostico: diag, tramas: tramasDeSegmentos() }; }
    var red = null;
    // Cada segmento viaja por el camino de la red: los del cliente por la
    // ida, los del servidor por la vuelta.
    function tramasDeSegmentos() {
      var lista = tramasConexion.slice();
      segmentos.forEach(function (x) {
        var base = x.de === "cliente" ? idaDe(red) : vueltaDe(red);
        var nombreProt = x.datos && protocolo === "tcp" ? ((servicioConocido("tcp", puerto) || {}).nombre || "TCP") : protocolo.toUpperCase();
        var info = x.puertoOrigen + " → " + x.puertoDestino + (x.flags ? " [" + x.flags.replace("-", ", ") + "]" : "") +
          (protocolo === "tcp" ? " Seq=" + x.seq + (x.ack ? " Ack=" + x.ack : "") : "") + (x.datos ? " «" + x.datos + "»" : "");
        Array.prototype.push.apply(lista, tramasCon(base, {
          protocolo: nombreProt, puertoOrigen: x.puertoOrigen, puertoDestino: x.puertoDestino,
          flags: x.flags || null, seq: x.seq, ack: x.ack, datos: x.datos, info: info, mensaje: protocolo.toUpperCase() + " " + info
        }));
      });
      return lista;
    }
    var cliente = buscarDispositivo(estado, idCliente);
    var nombreCliente = cliente ? (cliente.nombre || cliente.id) : idCliente;
    if (!(puerto >= 1 && puerto <= 65535)) {
      return fallo({ codigo: "ENTRADA", titulo: "El puerto no es válido", explicacion: "Un puerto va de 1 a 65535.", sugerencia: "Revisá el número de puerto." });
    }
    var texto = String(destino === undefined || destino === null ? "" : destino).trim().toLowerCase();
    var ip = texto;
    var tramasConexion = [];
    if (!Red.esIpValida(texto)) {
      if (!pareceNombre(texto)) {
        return fallo({ codigo: "ENTRADA", titulo: "El destino no es válido", explicacion: "\"" + texto + "\" no es una IP ni un nombre.", sugerencia: "Escribí una IP o un nombre como www.google.com." });
      }
      var resuelto = resolverNombre(estado, idCliente, texto, "A");
      Array.prototype.push.apply(pasos, resuelto.pasos);
      Array.prototype.push.apply(tramasConexion, resuelto.tramas || []);
      if (!resuelto.exito) { return fallo(resuelto.diagnostico); }
      var as = resuelto.respuesta.registros.filter(function (x) { return x.tipo === "A"; });
      ip = as[as.length - 1].valor;
    }
    // La red tiene que llegar, de ida y de vuelta: lo dice el ping.
    var salida = cliente ? elegirInterfazOrigen(estado, cliente, ip) : null;
    var efimero = puertoEfimero((salida && salida.ip) || "0.0.0.0", puerto);
    red = ejecutarPing(estado, idCliente, ip, { registrar: false, profundidad: 0,
      paquete: { protocolo: protocolo, puertoOrigen: efimero, puertoDestino: puerto } });
    var destinoNombre = (configuradosConIp(estado, ip)[0] || {}).dispositivo;
    var nombreDestino = destinoNombre ? (destinoNombre.nombre || destinoNombre.id) : ip;
    if (!red.exito) {
      agregar("Comprobar que la red llega a " + ip, "Antes de conectarse, el paquete tiene que poder ir y volver; " +
        (red.diagnostico ? red.diagnostico.titulo.charAt(0).toLowerCase() + red.diagnostico.titulo.slice(1) + "." : "no llega."), false, 3);
      return fallo(red.diagnostico);
    }
    var ida = (red.tramas || []).filter(function (t) { return t.sentido === "ida"; });
    var ipCliente = ida.length ? ida[0].ipOrigen : null;
    var ipVista = ida.length ? ida[ida.length - 1].ipOrigen : ipCliente;
    agregar("Comprobar que la red llega a " + ip, "La red llega a " + nombreDestino + " (" + ip + ") y vuelve: el resto es de las capas de arriba." +
      (ipVista && ipVista !== ipCliente ? " Por el NAT, el servidor va a ver la conexión desde " + ipVista + "." : ""), true, 3);
    var socket = { cliente: ipCliente + ":" + efimero, servidor: ip + ":" + puerto, vistoPorServidor: (ipVista || ipCliente) + ":" + efimero, protocolo: protocolo };
    function seg(deCliente, flags, seq, ack, datos) {
      segmentos.push({
        n: segmentos.length + 1, de: deCliente ? "cliente" : "servidor", protocolo: protocolo,
        puertoOrigen: deCliente ? efimero : puerto, puertoDestino: deCliente ? puerto : efimero,
        flags: flags, seq: seq, ack: ack, datos: datos || null
      });
    }
    var servicio = quienEscucha(estado, ip, protocolo, puerto);
    var info = servicioConocido(protocolo, puerto);
    var etiqueta = protocolo.toUpperCase() + " " + puerto;
    if (protocolo === "tcp") {
      seg(true, "SYN", 1000, 0);
      agregar("Abrir la conexión (SYN)", nombreCliente + " elige el puerto efímero " + efimero + " y manda un SYN a " + ip + ":" + puerto +
        " (seq=1000): «quiero conectarme».", true, 4);
      if (!servicio) {
        seg(false, "RST-ACK", 0, 1001);
        agregar("Recibir la respuesta al SYN", nombreDestino + " no tiene ningún programa escuchando en " + etiqueta + ": responde RST («acá no hay nadie») y la conexión no se abre.", false, 4);
        return fallo(diagnosticoDe("D31", { equipo: nombreDestino, puerto: puerto, protocolo: protocolo }));
      }
      seg(false, "SYN-ACK", 5000, 1001);
      agregar("Aceptar la conexión (SYN-ACK)", servicio + " escucha en " + etiqueta + " de " + nombreDestino + ": responde SYN-ACK (seq=5000, ack=1001): «acepto, y espero tu byte 1001».", true, 4);
      seg(true, "ACK", 1001, 5001);
      agregar("Confirmar (ACK)", nombreCliente + " confirma con un ACK (ack=5001). Handshake de tres pasos completo: la conexión está establecida. " +
        "Socket: " + socket.cliente + " ↔ " + socket.servidor + ".", true, 4);
      var pedido = info ? info.pedido : "datos";
      var respuesta = info ? info.respuesta : "respuesta del servicio";
      seg(true, "PSH-ACK", 1001, 5001, pedido);
      agregar("Enviar el pedido (" + servicio + ")", nombreCliente + " manda «" + pedido + "» (" + pedido.length + " bytes, seq=1001).", true, 7);
      seg(false, "PSH-ACK", 5001, 1001 + pedido.length, respuesta);
      agregar("Recibir la respuesta", servicio + " responde «" + respuesta + "», y con ack=" + (1001 + pedido.length) + " confirma que recibió todo el pedido.", true, 7);
      var seqC = 1001 + pedido.length, seqS = 5001 + respuesta.length;
      seg(true, "FIN-ACK", seqC, seqS);
      seg(false, "FIN-ACK", seqS, seqC + 1);
      seg(true, "ACK", seqC + 1, seqS + 1);
      agregar("Cerrar la conexión (FIN)", "Los dos lados se mandan FIN y lo confirman: la conexión se cierra y el puerto " + efimero + " queda libre.", true, 4);
    } else {
      var datos = info ? info.pedido : "datos";
      seg(true, "", null, null, datos);
      agregar("Enviar el datagrama (UDP)", nombreCliente + " manda un datagrama a " + ip + ":" + puerto + " desde el puerto " + efimero +
        ". UDP no establece conexión ni confirma la entrega: si se pierde, la aplicación tiene que darse cuenta.", true, 4);
      if (!servicio) {
        agregar("Recibir la respuesta", nombreDestino + " no tiene ningún programa escuchando en " + etiqueta + ": responde con un ICMP de «puerto inalcanzable».", false, 4);
        return fallo(diagnosticoDe("D31", { equipo: nombreDestino, puerto: puerto, protocolo: protocolo }));
      }
      var resp = info ? info.respuesta : "respuesta";
      seg(false, "", null, null, resp);
      agregar("Recibir la respuesta", servicio + " responde con otro datagrama («" + resp + "»).", true, 7);
    }
    return { exito: true, pasos: pasos, segmentos: segmentos, socket: socket, diagnostico: null, servicio: servicio, tramas: tramasDeSegmentos() };
  }

  // Herramienta tipo nslookup.
  function consultarDns(estado, idCliente, nombre, tipo, opciones) {
    opciones = opciones || {};
    estado.ahora = opciones.ahora || Date.now();
    var texto = String(nombre === undefined || nombre === null ? "" : nombre).trim().toLowerCase().replace(/\.$/, "");
    var t = TIPOS_REGISTRO.indexOf(tipo) >= 0 ? tipo : "A";
    if (!pareceNombre(texto)) {
      return {
        exito: false, pasos: [], respuesta: null, saltos: [],
        diagnostico: {
          codigo: "ENTRADA", titulo: "El nombre no es válido",
          explicacion: "\"" + texto + "\" no es un nombre de dominio: tiene que tener partes separadas por puntos, como www.google.com.",
          sugerencia: "Revisá lo que escribiste."
        }
      };
    }
    return resolverNombre(estado, idCliente, texto, t);
  }

  function pareceNombre(texto) {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(texto) && /[a-z]/.test(texto);
  }

  function pingConNombre(estado, idOrigen, destino, opciones) {
    var texto = String(destino === undefined || destino === null ? "" : destino).trim().toLowerCase();
    if (Red.esIpValida(texto) || !pareceNombre(texto)) {
      return ejecutarPing(estado, idOrigen, Red.esIpValida(texto) ? texto : destino, opciones);
    }
    var origen = buscarDispositivo(estado, idOrigen);
    if (!origen) { return ejecutarPing(estado, idOrigen, texto, opciones); }
    var resuelto = resolverNombre(estado, idOrigen, texto, "A");
    if (!resuelto.exito) {
      return {
        exito: false, pasos: resuelto.pasos, saltos: resuelto.saltos && resuelto.saltos.length ? resuelto.saltos : [{ dispositivo: origen.id, interfaz: "" }],
        diagnostico: resuelto.diagnostico, respuestas: [], tramas: [], tramasPrevias: resuelto.tramas || []
      };
    }
    var as = resuelto.respuesta.registros.filter(function (x) { return x.tipo === "A"; });
    var ip = as.length ? as[as.length - 1].valor : null;
    var res = ejecutarPing(estado, idOrigen, ip, opciones);
    var previos = resuelto.pasos.length;
    res.pasos = resuelto.pasos.concat(res.pasos.map(function (pn) {
      return { n: pn.n + previos, titulo: pn.titulo, detalle: pn.detalle, ok: pn.ok, capa: pn.capa };
    }));
    res.nombre = texto;
    res.ipResuelta = ip;
    res.tramasPrevias = resuelto.tramas || [];
    return res;
  }

  function ping(estado, idOrigen, destinoIp) {
    estado.ahora = Date.now();
    return pingConNombre(estado, idOrigen, destinoIp, { registrar: true, profundidad: 0 });
  }

  function diagnosticar(estado, idOrigen, destinoIp) {
    var resultado = pingConNombre(estado, idOrigen, destinoIp, { registrar: false, profundidad: 0 });
    return resultado.diagnostico;
  }

  /* ---------------- Advertencias al configurar ---------------- */

  function advertenciasDe(estado, idDispositivo, opciones) {
    if (opciones === true || (opciones && opciones.modoDocente)) {
      return [];
    }
    var dev = buscarDispositivo(estado, idDispositivo);
    if (!dev) {
      return [];
    }
    var avisos = [];
    var vistos = {};
    function agregar(codigo, ctx) {
      if (vistos[codigo]) {
        return;
      }
      vistos[codigo] = true;
      var d = diagnosticoDe(codigo, ctx);
      avisos.push({
        codigo: d.codigo,
        titulo: d.titulo,
        explicacion: d.explicacion,
        sugerencia: d.sugerencia
      });
    }
    var i, j;
    for (i = 0; i < dev.interfaces.length; i++) {
      var iface = dev.interfaces[i];
      if (!iface.habilitada || !iface.ip || !Red.esIpValida(iface.ip)) {
        continue;
      }
      if (!prefijoValido(iface.prefijo)) {
        continue;
      }
      var red = Red.direccionDeRed(iface.ip, iface.prefijo);
      // D06: red o broadcast.
      if (Red.esDireccionDeRed(iface.ip, iface.prefijo) || Red.esBroadcast(iface.ip, iface.prefijo)) {
        agregar("D06", {
          ip: iface.ip,
          red: red,
          prefijo: iface.prefijo,
          rol: Red.esDireccionDeRed(iface.ip, iface.prefijo) ? "dirección de red" : "dirección de broadcast"
        });
      }
      // D07: duplicada en el mismo segmento.
      var pares = paresEnSegmento(estado, dev.id, iface.id);
      for (j = 0; j < pares.length; j++) {
        if (pares[j].interfaz.ip === iface.ip) {
          agregar("D07", { ip: iface.ip, origen: dev.nombre || dev.id, otro: nombreDe(estado, pares[j].dispositivo.id) });
          break;
        }
      }
      // D09: gateway fuera de la subred de todas las interfaces.
      if (dev.gateway && Red.esIpValida(dev.gateway)) {
        var gwEnAlguna = false;
        for (var k = 0; k < dev.interfaces.length; k++) {
          var otra = dev.interfaces[k];
          if (!otra.habilitada || !otra.ip || !prefijoValido(otra.prefijo)) {
            continue;
          }
          if (Red.mismaRed(otra.ip, dev.gateway, otra.prefijo)) {
            gwEnAlguna = true;
            break;
          }
        }
        if (!gwEnAlguna) {
          agregar("D09", { gateway: dev.gateway, red: red, prefijo: iface.prefijo, equipo: dev.nombre || dev.id });
        }
      }
      // D14 y D15 contra los pares del segmento.
      for (j = 0; j < pares.length; j++) {
        var par = pares[j];
        if (!prefijoValido(par.interfaz.prefijo) || !Red.esIpValida(par.interfaz.ip)) {
          continue;
        }
        var mismaMia = Red.mismaRed(iface.ip, par.interfaz.ip, iface.prefijo);
        var mismaSuya = Red.mismaRed(iface.ip, par.interfaz.ip, par.interfaz.prefijo);
        if (!mismaMia && !mismaSuya) {
          var redPar = Red.direccionDeRed(par.interfaz.ip, par.interfaz.prefijo);
          agregar("D15", {
            origen: dev.nombre || dev.id,
            destinoNombre: nombreDe(estado, par.dispositivo.id),
            redA: red + "/" + iface.prefijo,
            redB: redPar + "/" + par.interfaz.prefijo,
            aire: iface.medio === "wireless" || par.interfaz.medio === "wireless"
          });
        } else if (iface.prefijo !== par.interfaz.prefijo || mismaMia !== mismaSuya) {
          agregar("D14", {
            ipA: iface.ip, prefijoA: iface.prefijo, nombreA: dev.nombre || dev.id,
            ipB: par.interfaz.ip, prefijoB: par.interfaz.prefijo, nombreB: nombreDe(estado, par.dispositivo.id)
          });
        }
      }
    }
    // Router de borde: un puerto hacia la nube sin NAT, con redes privadas
    // detrás, deja sin respuesta todo lo que salga a internet (D28).
    if (esRouter(dev)) {
      var privada = null;
      dev.interfaces.forEach(function (f) {
        if (!privada && f.habilitada && f.ip && Red.esIpValida(f.ip) && Red.clasificar(f.ip) === "privada") { privada = f.ip; }
      });
      dev.interfaces.forEach(function (f) {
        if (!privada || f.nat || !f.habilitada) { return; }
        var haciaNube = enlacesDe(estado, dev.id, f.id).some(function (e) {
          var otro = e.a.dispositivo === dev.id && e.a.interfaz === f.id ? e.b : e.a;
          return esInternet(buscarDispositivo(estado, otro.dispositivo));
        });
        if (haciaNube) {
          agregar("D28", { ip: privada, destino: "internet", router: dev.nombre || dev.id, puerto: f.id, aviso: true });
        }
      });
    }
    return avisos;
  }

  /* ---------------- DHCP ---------------- */

  function ipANumeroSeguro(ip) {
    return Red.aNumero(ip);
  }

  function numeroAIpSeguro(n) {
    return Red.aTexto(n >>> 0);
  }

  function apipaPara(idDispositivo, idInterfaz) {
    var base = 0;
    var texto = String(idDispositivo) + ":" + String(idInterfaz);
    for (var i = 0; i < texto.length; i++) {
      base = (base * 33 + texto.charCodeAt(i)) >>> 0;
    }
    var x = 1 + (base % 200);
    var y = 1 + ((base >>> 8) % 250);
    return "169.254." + x + "." + y;
  }

  function dhcpSolicitar(estado, idDispositivo, idInterfaz) {
    var cliente = buscarDispositivo(estado, idDispositivo);
    if (!cliente) {
      return {
        exito: false,
        mensajes: [],
        ip: null,
        prefijo: null,
        gateway: null,
        diagnostico: diagnosticoDe("D01", { origen: nombreDe(estado, idDispositivo), interfaz: idInterfaz })
      };
    }
    var iface = buscarInterfaz(cliente, idInterfaz);
    if (!iface) {
      return {
        exito: false,
        mensajes: [],
        ip: null,
        prefijo: null,
        gateway: null,
        diagnostico: diagnosticoDe("D01", { origen: nombreDe(estado, idDispositivo), interfaz: idInterfaz })
      };
    }
    if (!cliente.encendido || !iface.habilitada) {
      return {
        exito: false,
        mensajes: [],
        ip: null,
        prefijo: null,
        gateway: null,
        diagnostico: diagnosticoDe("D01", { origen: nombreDe(estado, idDispositivo), interfaz: idInterfaz })
      };
    }
    var enlacesCliente = enlacesDe(estado, idDispositivo, idInterfaz);
    var enlaceCliente = null;
    for (var lic = 0; lic < enlacesCliente.length; lic++) {
      if (enlacesCliente[lic] && enlacesCliente[lic].estado === "up") {
        enlaceCliente = enlacesCliente[lic];
        break;
      }
    }
    if (!enlaceCliente) {
      return {
        exito: false,
        mensajes: [{ tipo: "discover", origen: idDispositivo, destino: "broadcast" }],
        ip: null,
        prefijo: null,
        gateway: null,
        diagnostico: diagnosticoDe("D02", { origen: nombreDe(estado, idDispositivo), interfaz: idInterfaz })
      };
    }

    // DISCOVER: difusión por todo el segmento del cliente. Cada router con
    // DHCP habilitado que la recibe responde sólo si su rango pertenece a la
    // red de la interfaz por la que le llegó.
    var inundadosCliente = enlacesDelSegmento(estado, idDispositivo, idInterfaz);
    var mensajes = [{
      tipo: "discover", origen: idDispositivo, destino: "broadcast",
      difusion: true, enlaces: [], inundados: inundadosCliente
    }];
    var servidores = [];
    var vistos = [];
    var motivos = [];
    var llenos = [];
    var claves = segmentoL2(estado, idDispositivo, idInterfaz);
    for (var i = 0; i < claves.length; i++) {
      var partes = claves[i].split(":");
      var dev = buscarDispositivo(estado, partes[0]);
      if (!esRouter(dev) || !dev.encendido || !dev.dhcp || !dev.dhcp.habilitado) {
        continue;
      }
      if (vistos.indexOf(dev.id) >= 0) {
        continue;
      }
      var ifServidor = buscarInterfaz(dev, partes.slice(1).join(":"));
      if (!ifServidor || !ifServidor.habilitada) {
        continue;
      }
      vistos.push(dev.id);
      var chequeo = poolAtiende(estado, dev, ifServidor);
      if (!chequeo.ok) {
        motivos.push(chequeo.motivo);
        continue;
      }
      var ipOfrecida = ipLibreEnPool(estado, dev, chequeo.rango, idDispositivo, idInterfaz, iface.ip);
      if (!ipOfrecida) {
        llenos.push(nombreDe(estado, dev.id));
        continue;
      }
      servidores.push({ dispositivo: dev, interfaz: ifServidor, ip: ipOfrecida });
    }

    if (servidores.length === 0) {
      var apipa = apipaPara(idDispositivo, idInterfaz);
      liberarConcesiones(estado, idDispositivo, idInterfaz);
      iface.ip = apipa;
      iface.prefijo = 16;
      iface.modo = "dhcp";
      cliente.gateway = null;
      var ctx = llenos.length ? { servidor: llenos[0] } : (motivos.length ? { motivo: motivos.join(" ") } : {});
      return {
        exito: false,
        mensajes: mensajes,
        ip: apipa,
        prefijo: 16,
        gateway: null,
        servidor: null,
        avisos: [],
        diagnostico: diagnosticoDe("D16", ctx)
      };
    }

    // OFFER: cada servidor que puede ofrece una dirección. El cliente pidió
    // las respuestas en difusión (todavía no tiene IP), así que también
    // inundan el segmento; el camino marcado es el que llega al cliente.
    for (var s = 0; s < servidores.length; s++) {
      var srv = servidores[s];
      mensajes.push({
        tipo: "offer", origen: srv.dispositivo.id, destino: idDispositivo,
        difusion: true, ip: srv.ip,
        enlaces: caminoL2(estado, srv.dispositivo.id, srv.interfaz.id, idDispositivo, idInterfaz),
        inundados: enlacesDelSegmento(estado, srv.dispositivo.id, srv.interfaz.id)
      });
    }

    // REQUEST: el cliente acepta la primera oferta y lo anuncia en difusión,
    // nombrando al servidor elegido para que los demás retiren la suya.
    var elegido = servidores[0];
    var cfg = elegido.dispositivo.dhcp;
    mensajes.push({
      tipo: "request", origen: idDispositivo, destino: "broadcast",
      difusion: true, ip: elegido.ip, servidor: elegido.dispositivo.id,
      enlaces: caminoL2(estado, idDispositivo, idInterfaz, elegido.dispositivo.id, elegido.interfaz.id),
      inundados: inundadosCliente
    });
    // ACK: el servidor elegido confirma la concesión.
    mensajes.push({
      tipo: "ack", origen: elegido.dispositivo.id, destino: idDispositivo,
      difusion: true, ip: elegido.ip,
      enlaces: caminoL2(estado, elegido.dispositivo.id, elegido.interfaz.id, idDispositivo, idInterfaz),
      inundados: enlacesDelSegmento(estado, elegido.dispositivo.id, elegido.interfaz.id)
    });

    liberarConcesiones(estado, idDispositivo, idInterfaz);
    if (!estado.concesiones[elegido.dispositivo.id]) {
      estado.concesiones[elegido.dispositivo.id] = {};
    }
    estado.concesiones[elegido.dispositivo.id][elegido.ip] = { cliente: idDispositivo, interfaz: idInterfaz, mac: iface.mac };
    iface.ip = elegido.ip;
    iface.prefijo = cfg.prefijo;
    iface.modo = "dhcp";
    cliente.gateway = cfg.gateway || null;
    return {
      exito: true,
      mensajes: mensajes,
      ip: elegido.ip,
      prefijo: cfg.prefijo,
      gateway: cfg.gateway || null,
      servidor: elegido.dispositivo.id,
      avisos: avisosPool(estado, elegido.dispositivo, elegido.interfaz),
      diagnostico: null
    };
  }

  // Rango de un servidor en números, o null si está mal cargado.
  function rangoDhcp(cfg) {
    var desde = ipANumeroSeguro(cfg.desde);
    var hasta = ipANumeroSeguro(cfg.hasta);
    if (desde === null || hasta === null || desde > hasta || !prefijoValido(cfg.prefijo)) {
      return null;
    }
    return { desde: desde, hasta: hasta };
  }

  // Un router atiende DHCP por una interfaz sólo si su rango está bien
  // cargado y pertenece a la red de esa interfaz.
  function poolAtiende(estado, router, iface) {
    var cfg = router.dhcp;
    var nombre = nombreDe(estado, router.id);
    var rango = rangoDhcp(cfg);
    if (!rango) {
      return {
        ok: false,
        motivo: nombre + " tiene el servidor DHCP habilitado, pero su rango (" + valor(cfg.desde, "?") + " – " +
          valor(cfg.hasta, "?") + " /" + valor(cfg.prefijo, "?") + ") está mal cargado."
      };
    }
    if (!iface.ip || !prefijoValido(iface.prefijo)) {
      return {
        ok: false,
        motivo: nombre + " tiene el servidor DHCP habilitado, pero su interfaz " + iface.id +
          " no tiene dirección IP: no sabe qué red atiende por ahí."
      };
    }
    if (!Red.mismaRed(cfg.desde, iface.ip, iface.prefijo) || !Red.mismaRed(cfg.hasta, iface.ip, iface.prefijo)) {
      return {
        ok: false,
        motivo: nombre + " tiene el servidor DHCP habilitado, pero su rango (" + cfg.desde + " – " + cfg.hasta +
          ") no pertenece a la red de su interfaz " + iface.id + " (" + Red.direccionDeRed(iface.ip, iface.prefijo) +
          "/" + iface.prefijo + "), así que no responde en esta red."
      };
    }
    return { ok: true, rango: rango };
  }

  // Primera dirección libre del rango. Si el cliente ya tiene una del rango
  // que nadie más usa (una renovación), se le ofrece la misma.
  function ipLibreEnPool(estado, router, rango, idCliente, idIfCliente, ipActual) {
    var concesiones = estado.concesiones[router.id] || {};
    function ocupada(ipTexto) {
      var c = concesiones[ipTexto];
      if (c && !(c.cliente === idCliente && c.interfaz === idIfCliente)) {
        return true;
      }
      var duenos = configuradosConIp(estado, ipTexto);
      for (var d = 0; d < duenos.length; d++) {
        if (duenos[d].dispositivo.id === idCliente && duenos[d].interfaz.id === idIfCliente) {
          continue;
        }
        return true;
      }
      return false;
    }
    var actual = ipActual ? ipANumeroSeguro(ipActual) : null;
    if (actual !== null && actual >= rango.desde && actual <= rango.hasta && !ocupada(ipActual)) {
      return ipActual;
    }
    for (var n = rango.desde; n <= rango.hasta; n++) {
      var textoIp = numeroAIpSeguro(n);
      if (!ocupada(textoIp)) {
        return textoIp;
      }
    }
    return null;
  }

  // Un cliente tiene a lo sumo una concesión por interfaz: al pedir de nuevo
  // se suelta la anterior, sea del servidor que sea.
  function liberarConcesiones(estado, idCliente, idIfCliente) {
    var routers = Object.keys(estado.concesiones);
    for (var r = 0; r < routers.length; r++) {
      var tabla = estado.concesiones[routers[r]];
      var ips = Object.keys(tabla);
      for (var k = 0; k < ips.length; k++) {
        if (tabla[ips[k]].cliente === idCliente && tabla[ips[k]].interfaz === idIfCliente) {
          delete tabla[ips[k]];
        }
      }
    }
  }

  // Lo que un servidor real entregaría igual, pero deja al cliente mal
  // configurado: se avisa sin cortar el DORA.
  function avisosPool(estado, router, iface) {
    var cfg = router.dhcp;
    var nombre = nombreDe(estado, router.id);
    var avisos = [];
    var red = Red.direccionDeRed(cfg.desde, cfg.prefijo) + "/" + cfg.prefijo;
    if (!cfg.gateway) {
      avisos.push(nombre + " no entrega puerta de enlace: el equipo sólo podrá hablar dentro de su red.");
    } else if (!Red.mismaRed(cfg.gateway, cfg.desde, cfg.prefijo)) {
      avisos.push("La puerta de enlace " + cfg.gateway + " que entrega " + nombre + " no está en la red " + red +
        ": el equipo no podrá salir de su red.");
    }
    if (iface && prefijoValido(iface.prefijo) && iface.prefijo !== cfg.prefijo) {
      avisos.push(nombre + " entrega el prefijo /" + cfg.prefijo + ", pero la red de su interfaz " + iface.id +
        " es /" + iface.prefijo + ".");
    }
    return avisos;
  }

  // Las concesiones se deducen de la topología: cada interfaz en modo DHCP
  // con una dirección que un servidor de su segmento atiende tiene concesión
  // de ese servidor. Así sobreviven a reconstruir el estado y a exportar.
  function reconstruirConcesiones(estado) {
    var ids = Object.keys(estado.porDispositivo);
    for (var i = 0; i < ids.length; i++) {
      var dev = estado.porDispositivo[ids[i]];
      if (esRouter(dev) || esConmutador(dev)) {
        continue;
      }
      for (var j = 0; j < dev.interfaces.length; j++) {
        var iface = dev.interfaces[j];
        if (iface.modo !== "dhcp" || !iface.ip || Red.clasificar(iface.ip) === "apipa") {
          continue;
        }
        var n = ipANumeroSeguro(iface.ip);
        var claves = segmentoL2(estado, dev.id, iface.id);
        for (var k = 0; k < claves.length; k++) {
          var partes = claves[k].split(":");
          var router = buscarDispositivo(estado, partes[0]);
          if (!esRouter(router) || !router.dhcp || !router.dhcp.habilitado) {
            continue;
          }
          var chequeo = poolAtiende(estado, router, buscarInterfaz(router, partes.slice(1).join(":")) || {});
          if (!chequeo.ok || n === null || n < chequeo.rango.desde || n > chequeo.rango.hasta) {
            continue;
          }
          if (!estado.concesiones[router.id]) {
            estado.concesiones[router.id] = {};
          }
          if (!estado.concesiones[router.id][iface.ip]) {
            estado.concesiones[router.id][iface.ip] = { cliente: dev.id, interfaz: iface.id, mac: iface.mac };
          }
          break;
        }
      }
    }
  }

  // Avisos de configuración de un servidor DHCP, para mostrarlos en su panel
  // antes de que algún cliente pida: el rango tiene que caer en la red de
  // alguna de sus interfaces, y lo que entrega tiene que tener sentido.
  function avisosServidorDhcp(estado, idRouter) {
    var router = buscarDispositivo(estado, idRouter);
    if (!router || !router.dhcp || !router.dhcp.habilitado) {
      return [];
    }
    for (var i = 0; i < router.interfaces.length; i++) {
      var chequeo = poolAtiende(estado, router, router.interfaces[i]);
      if (chequeo.ok) {
        return avisosPool(estado, router, router.interfaces[i]);
      }
      if (!rangoDhcp(router.dhcp)) {
        return [chequeo.motivo];
      }
    }
    return [nombreDe(estado, idRouter) + " tiene el servidor DHCP habilitado, pero su rango (" + router.dhcp.desde +
      " – " + router.dhcp.hasta + ") no pertenece a la red de ninguna de sus interfaces: no va a responder a nadie."];
  }

  /* ---------------- Tablas ---------------- */

  function tablaArp(estado, idDispositivo) {
    var tabla = estado.arp[idDispositivo] || [];
    var copia = [];
    for (var i = 0; i < tabla.length; i++) {
      if (tabla[i].vence >= estado.ahora) {
        copia.push({ ip: tabla[i].ip, mac: tabla[i].mac, vence: tabla[i].vence });
      }
    }
    return copia;
  }

  function tablaMac(estado, idSwitch) {
    var tabla = estado.mac[idSwitch] || [];
    var copia = [];
    for (var i = 0; i < tabla.length; i++) {
      if (tabla[i].vence >= estado.ahora) {
        copia.push({ mac: tabla[i].mac, puerto: tabla[i].puerto, vence: tabla[i].vence });
      }
    }
    return copia;
  }

  /* ---------------- Autopruebas ----------------
   * Topologías mínimas en memoria. Cada una arma lo justo para aislar un
   * diagnóstico, sin depender de los ejemplos de la capa 3. */

  function fabPc(id, ip, prefijo, gateway, extra) {
    extra = extra || {};
    return {
      id: id,
      tipo: "pc",
      nombre: id,
      x: extra.x !== undefined ? extra.x : 100,
      y: extra.y !== undefined ? extra.y : 100,
      encendido: extra.encendido !== undefined ? extra.encendido : true,
      interfaces: [
        {
          id: "eth0",
          nombre: "eth0",
          medio: "ethernet",
          habilitada: extra.habilitada !== undefined ? extra.habilitada : true,
          modo: extra.modo || "estatico",
          ip: ip !== undefined ? ip : null,
          prefijo: prefijo !== undefined ? prefijo : 24,
          mac: "02:00:00:00:01:" + id.slice(-2).padStart(2, "0")
        },
        {
          id: "wlan0",
          nombre: "wlan0",
          medio: "wireless",
          habilitada: false,
          modo: "estatico",
          ip: null,
          prefijo: 24,
          mac: "02:00:00:00:02:" + id.slice(-2).padStart(2, "0")
        }
      ],
      gateway: gateway !== undefined ? gateway : null,
      dns: "8.8.8.8",
      rutas: [],
      dhcp: null
    };
  }

  function fabSwitch(id, extra) {
    extra = extra || {};
    var interfaces = [];
    for (var i = 1; i <= 8; i++) {
      interfaces.push({
        id: "fa0/" + i,
        nombre: "fa0/" + i,
        medio: "ethernet",
        habilitada: true,
        modo: "estatico",
        ip: null,
        prefijo: 24,
        mac: "02:00:00:00:03:0" + i
      });
    }
    interfaces.push({
      id: "fib0", nombre: "fib0", medio: "fibra", habilitada: true,
      modo: "estatico", ip: null, prefijo: 24, mac: "02:00:00:00:03:09"
    });
    return {
      id: id, tipo: "switch-l2", nombre: id,
      x: extra.x !== undefined ? extra.x : 200,
      y: extra.y !== undefined ? extra.y : 200,
      encendido: extra.encendido !== undefined ? extra.encendido : true,
      interfaces: interfaces,
      gateway: null, dns: null, rutas: [], dhcp: null
    };
  }

  // Punto de acceso: bridge de capa 2 entre el aire (wlan0, modo ap) y el
  // cable (eth0). No enruta; la IP es sólo de gestión y puede ser nula.
  function fabAp(id, ipGestion, extra) {
    extra = extra || {};
    return {
      id: id, tipo: "ap", nombre: id,
      x: extra.x !== undefined ? extra.x : 200,
      y: extra.y !== undefined ? extra.y : 200,
      encendido: extra.encendido !== undefined ? extra.encendido : true,
      interfaces: [
        {
          id: "wlan0", nombre: "wlan0", medio: "wireless", modoRadio: "ap",
          habilitada: true, modo: "estatico",
          ip: ipGestion || null, prefijo: 24,
          mac: "02:00:00:00:05:01"
        },
        {
          id: "eth0", nombre: "eth0", medio: "ethernet", modoRadio: null,
          habilitada: true, modo: "estatico",
          ip: null, prefijo: 24,
          mac: "02:00:00:00:05:02"
        }
      ],
      gateway: null, dns: null, rutas: [], dhcp: null
    };
  }

  function fabRouter(id, bocas, rutas, extra) {
    extra = extra || {};
    // bocas: [{id, ip, prefijo, medio, modoRadio, habilitada}]
    var interfaces = [];
    for (var i = 0; i < bocas.length; i++) {
      interfaces.push({
        id: bocas[i].id,
        nombre: bocas[i].id,
        medio: bocas[i].medio || "ethernet",
        modoRadio: bocas[i].modoRadio || null,
        habilitada: bocas[i].habilitada !== undefined ? bocas[i].habilitada : true,
        modo: "estatico",
        ip: bocas[i].ip || null,
        prefijo: bocas[i].prefijo !== undefined ? bocas[i].prefijo : 24,
        mac: "02:00:00:00:04:0" + (i + 1)
      });
    }
    return {
      id: id, tipo: "router", nombre: id,
      x: extra.x !== undefined ? extra.x : 300,
      y: extra.y !== undefined ? extra.y : 200,
      encendido: extra.encendido !== undefined ? extra.encendido : true,
      interfaces: interfaces,
      gateway: null, dns: null,
      rutas: rutas || [],
      dhcp: extra.dhcp || null
    };
  }

  function fabEnlace(id, aDev, aIf, bDev, bIf, extra) {
    extra = extra || {};
    return {
      id: id,
      a: { dispositivo: aDev, interfaz: aIf },
      b: { dispositivo: bDev, interfaz: bIf },
      tipo: extra.tipo || "ethernet",
      estado: extra.estado || "up",
      velocidadMbps: 100,
      retardoMs: 1
    };
  }

  function fabTopo(dispositivos, enlaces) {
    return {
      version: 1,
      nombre: "prueba",
      dispositivos: dispositivos,
      enlaces: enlaces,
      escenario: null
    };
  }

  function autopruebas() {
    var total = 0;
    var pasadas = 0;
    var fallos = [];

    function comparar(nombre, obtenido, esperado) {
      total += 1;
      var a = JSON.stringify(obtenido);
      var b = JSON.stringify(esperado);
      if (a === b) {
        pasadas += 1;
      } else {
        fallos.push({ nombre: nombre, esperado: esperado, obtenido: obtenido });
      }
    }

    // 1. D01: interfaz deshabilitada.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, "192.168.1.1", { habilitada: false }),
         fabPc("pc2", "192.168.1.20", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D01 interfaz deshabilitada", ping(est, "pc1", "192.168.1.1").diagnostico.codigo, "D01");
    })();

    // 2. D02: enlace en down.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, "192.168.1.1"),
         fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }], []),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1", { estado: "down" }),
         fabEnlace("l2", "r1", "g0/0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D02 enlace caido", ping(est, "pc1", "192.168.1.1").diagnostico.codigo, "D02");
    })();

    // 3. D03: medios incompatibles (fibra contra ethernet).
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1", { tipo: "fibra" })]);
      var est = crearEstado(topo);
      comparar("D03 medios incompatibles", ping(est, "pc1", "192.168.1.20").diagnostico.codigo, "D03");
    })();

    // 4. D04: sin IP.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", null, 24, null),
         fabPc("pc2", "192.168.1.20", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D04 sin IP", ping(est, "pc1", "192.168.1.20").diagnostico.codigo, "D04");
    })();

    // 5. D05: prefijo inválido.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 33, null),
         fabPc("pc2", "192.168.1.20", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D05 mascara invalida", ping(est, "pc1", "192.168.1.20").diagnostico.codigo, "D05");
    })();

    // 6. D06: broadcast .95/27.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "10.45.7.95", 27, "10.45.7.65"),
         fabPc("pc2", "10.45.7.66", 27, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D06 broadcast", ping(est, "pc1", "10.45.7.66").diagnostico.codigo, "D06");
    })();

    // 7. D07: misma IP en el mismo segmento.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabPc("pc2", "192.168.1.10", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D07 duplicada", ping(est, "pc1", "192.168.1.10").diagnostico.codigo, "D07");
    })();

    // 8. D08: sin gateway a otra subred.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")]);
      var est = crearEstado(topo);
      comparar("D08 sin gateway", ping(est, "pc1", "192.168.2.10").diagnostico.codigo, "D08");
    })();

    // 9. D09: gateway fuera de la subred. La tabla pedía 10.45.7.66/28 con
    // gateway 10.45.7.65, pero con aritmética correcta ambos caen en
    // 10.45.7.64/28 y no hay D09 (ver nota al final). Se prueba la intención
    // didáctica con una IP que sí queda fuera: 10.45.7.98/28 vs 10.45.7.65.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "10.45.7.98", 28, "10.45.7.65"),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")]);
      var est = crearEstado(topo);
      comparar("D09 gateway fuera de subred", ping(est, "pc1", "8.8.8.8").diagnostico.codigo, "D09");
    })();

    // 10. D10: gateway sin ARP.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, "192.168.1.99"),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")]);
      var est = crearEstado(topo);
      comparar("D10 gateway sin ARP", ping(est, "pc1", "8.8.8.8").diagnostico.codigo, "D10");
    })();

    // 11. D11: router de ida sin ruta.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, "192.168.1.1"),
         fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }], []),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "r1", "g0/0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      var res = ping(est, "pc1", "10.99.99.1");
      comparar("D11 sin ruta", res.diagnostico.codigo, "D11");
    })();

    // 12. D12: ida completa, falta la vuelta (pc2 sin gateway).
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, "192.168.1.1"),
         fabRouter("r1", [
           { id: "g0/0", ip: "192.168.1.1", prefijo: 24 },
           { id: "g0/1", ip: "192.168.2.1", prefijo: 24 }
         ], []),
         fabPc("pc2", "192.168.2.10", 24, null),
         fabSwitch("sw1"), fabSwitch("sw2")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "r1", "g0/0", "sw1", "fa0/2"),
         fabEnlace("l3", "r1", "g0/1", "sw2", "fa0/1"),
         fabEnlace("l4", "pc2", "eth0", "sw2", "fa0/2")]);
      var est = crearEstado(topo);
      var res = ping(est, "pc1", "192.168.2.10");
      comparar("D12 falta retorno", res.diagnostico.codigo, "D12");
      comparar("D12 no es D11", res.diagnostico.codigo === "D11", false);
    })();

    // 13. D13: destino apagado.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabPc("pc2", "192.168.1.20", 24, null, { encendido: false }),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D13 destino apagado", ping(est, "pc1", "192.168.1.20").diagnostico.codigo, "D13");
    })();

    // 14. D14: /24 contra /25 en el mismo switch.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabPc("pc2", "192.168.1.130", 25, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D14 mascaras distintas", ping(est, "pc1", "192.168.1.130").diagnostico.codigo, "D14");
    })();

    // 15. D15: mismo switch, subredes distintas.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "10.45.7.66", 27, null),
         fabPc("pc2", "10.45.7.98", 28, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      comparar("D15 switch no enruta", ping(est, "pc1", "10.45.7.98").diagnostico.codigo, "D15");
    })();

    // 16. D17: wireless fuera de alcance, en un enlace punto a punto en modo
    // bridge (dos clientes no se asocian: eso ahora es D18).
    (function () {
      var pc1 = fabPc("pc1", null, 24, null, { x: 0, y: 0 });
      pc1.interfaces[0].habilitada = false;
      pc1.interfaces[0].ip = null;
      pc1.interfaces[1].habilitada = true;
      pc1.interfaces[1].modoRadio = "bridge";
      pc1.interfaces[1].ip = "10.0.0.1";
      pc1.interfaces[1].prefijo = 24;
      var pc2 = fabPc("pc2", null, 24, null, { x: 1000, y: 0 });
      pc2.interfaces[0].habilitada = false;
      pc2.interfaces[0].ip = null;
      pc2.interfaces[1].habilitada = true;
      pc2.interfaces[1].modoRadio = "bridge";
      pc2.interfaces[1].ip = "10.0.0.2";
      pc2.interfaces[1].prefijo = 24;
      var topo = fabTopo([pc1, pc2],
        [fabEnlace("l1", "pc1", "wlan0", "pc2", "wlan0", { tipo: "wireless" })]);
      var est = crearEstado(topo);
      comparar("D17 fuera de alcance", ping(est, "pc1", "10.0.0.2").diagnostico.codigo, "D17");
    })();

    // 17. Ping válido de punta a punta entre dos subredes.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 25, "192.168.1.1"),
         fabRouter("r1", [
           { id: "g0/0", ip: "192.168.1.1", prefijo: 25 },
           { id: "g0/1", ip: "192.168.1.129", prefijo: 25 }
         ], []),
         fabPc("pc2", "192.168.1.130", 25, "192.168.1.129"),
         fabSwitch("sw1"), fabSwitch("sw2")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "r1", "g0/0", "sw1", "fa0/2"),
         fabEnlace("l3", "r1", "g0/1", "sw2", "fa0/1"),
         fabEnlace("l4", "pc2", "eth0", "sw2", "fa0/2")]);
      var est = crearEstado(topo);
      var res = ping(est, "pc1", "192.168.1.130");
      comparar("ping valido exito", res.exito, true);
      comparar("ping valido diagnostico nulo", res.diagnostico, null);
      comparar("ping valido saltos", res.saltos.length, 3);
    })();

    // 18. rutaElegida prefiere la específica sobre la por defecto.
    (function () {
      var topo = fabTopo(
        [fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }],
          [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "192.168.1.254" },
           { destino: "10.0.0.0", prefijo: 16, siguienteSalto: "192.168.1.2" }])],
        []);
      var est = crearEstado(topo);
      var ruta = rutaElegida(est, "r1", "10.0.5.1");
      comparar("rutaElegida especifica", ruta && ruta.destino + "/" + ruta.prefijo, "10.0.0.0/16");
    })();

    // 19. DHCP: rango de dos direcciones, el tercer cliente falla con D16.
    (function () {
      function armar() {
        var r = fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }], [], {
          dhcp: { habilitado: true, desde: "192.168.1.10", hasta: "192.168.1.11", prefijo: 24, gateway: "192.168.1.1" }
        });
        var c1 = fabPc("c1", null, 24, null, { modo: "dhcp" });
        var c2 = fabPc("c2", null, 24, null, { modo: "dhcp" });
        var c3 = fabPc("c3", null, 24, null, { modo: "dhcp" });
        var sw = fabSwitch("sw1");
        return fabTopo([r, c1, c2, c3, sw],
          [fabEnlace("l1", "r1", "g0/0", "sw1", "fa0/1"),
           fabEnlace("l2", "c1", "eth0", "sw1", "fa0/2"),
           fabEnlace("l3", "c2", "eth0", "sw1", "fa0/3"),
           fabEnlace("l4", "c3", "eth0", "sw1", "fa0/4")]);
      }
      var est = crearEstado(armar());
      var r1 = dhcpSolicitar(est, "c1", "eth0");
      var r2 = dhcpSolicitar(est, "c2", "eth0");
      var r3 = dhcpSolicitar(est, "c3", "eth0");
      comparar("DHCP primero ok", r1.exito, true);
      comparar("DHCP segundo ok", r2.exito, true);
      comparar("DHCP tercero D16", r3.diagnostico && r3.diagnostico.codigo, "D16");
      comparar("DHCP tercero APIPA", Red.clasificar(r3.ip), "apipa");
    })();

    // 20. DHCP exitoso: IP del rango y cuatro mensajes DORA.
    (function () {
      var r = fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }], [], {
        dhcp: { habilitado: true, desde: "192.168.1.50", hasta: "192.168.1.60", prefijo: 24, gateway: "192.168.1.1" }
      });
      var c1 = fabPc("c1", null, 24, null, { modo: "dhcp" });
      var sw = fabSwitch("sw1");
      var est = crearEstado(fabTopo([r, c1, sw],
        [fabEnlace("l1", "r1", "g0/0", "sw1", "fa0/1"),
         fabEnlace("l2", "c1", "eth0", "sw1", "fa0/2")]));
      var res = dhcpSolicitar(est, "c1", "eth0");
      comparar("DHCP entrega en rango", res.ip, "192.168.1.50");
      comparar("DHCP cuatro mensajes",
        res.mensajes.map(function (m) { return m.tipo; }),
        ["discover", "offer", "request", "ack"]);
      comparar("DHCP servidor elegido", res.servidor, "r1");
      comparar("DHCP sin avisos", res.avisos, []);
    })();

    // 20b. DHCP sobre los cables: la difusión se queda en el segmento y el
    // OFFER recorre router → switch → PC. La concesión sobrevive a
    // reconstruir el estado y una renovación conserva la dirección.
    (function () {
      var r = fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }, { id: "g0/1", ip: "10.0.0.1", prefijo: 30 }], [], {
        dhcp: { habilitado: true, desde: "192.168.1.50", hasta: "192.168.1.60", prefijo: 24, gateway: "192.168.1.1" }
      });
      var r2 = fabRouter("r2", [{ id: "g0/0", ip: "10.0.0.2", prefijo: 30 }], []);
      var c1 = fabPc("c1", null, 24, null, { modo: "dhcp" });
      var c2 = fabPc("c2", "192.168.1.50", 24, "192.168.1.1");
      var sw = fabSwitch("sw1");
      var topo = fabTopo([r, r2, c1, c2, sw],
        [fabEnlace("l1", "r1", "g0/0", "sw1", "fa0/1"),
         fabEnlace("l2", "c1", "eth0", "sw1", "fa0/2"),
         fabEnlace("l3", "c2", "eth0", "sw1", "fa0/3"),
         fabEnlace("l9", "r1", "g0/1", "r2", "g0/0")]);
      var est = crearEstado(topo);
      var res = dhcpSolicitar(est, "c1", "eth0");
      var porTipo = {};
      res.mensajes.forEach(function (m) { porTipo[m.tipo] = m; });
      comparar("DHCP salta la IP estática ocupada", res.ip, "192.168.1.51");
      comparar("DHCP discover es difusión", porTipo.discover.difusion, true);
      comparar("DHCP discover inunda el segmento", porTipo.discover.inundados.slice().sort(), ["l1", "l2", "l3"]);
      comparar("DHCP offer sigue los cables", porTipo.offer.enlaces, ["l1", "l2"]);
      comparar("DHCP offer lleva la IP", porTipo.offer.ip, "192.168.1.51");
      comparar("DHCP request en difusión nombra al servidor",
        [porTipo.request.destino, porTipo.request.servidor, porTipo.request.enlaces], ["broadcast", "r1", ["l2", "l1"]]);
      comparar("DHCP concesión registrada", est.concesiones.r1["192.168.1.51"].cliente, "c1");
      var est2 = crearEstado(est.topologia);
      comparar("DHCP concesión reconstruida", est2.concesiones.r1 && est2.concesiones.r1["192.168.1.51"] &&
        est2.concesiones.r1["192.168.1.51"].cliente, "c1");
      var otra = dhcpSolicitar(est2, "c1", "eth0");
      comparar("DHCP renovación conserva la IP", otra.ip, "192.168.1.51");
      est2.topologia.dispositivos.forEach(function (d) {
        if (d.id === "c1") { d.interfaces[0].modo = "estatico"; }
      });
      comparar("DHCP estática libera la concesión", Object.keys(crearEstado(est2.topologia).concesiones.r1 || {}), []);
    })();

    // 20c. Rango de otra red: el router no responde y el D16 dice por qué.
    // Gateway fuera de la red del rango: se entrega igual, con aviso.
    (function () {
      function armar(dhcp) {
        var r = fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }], [], { dhcp: dhcp });
        var c1 = fabPc("c1", null, 24, null, { modo: "dhcp" });
        return crearEstado(fabTopo([r, c1], [fabEnlace("l1", "r1", "g0/0", "c1", "eth0")]));
      }
      var est = armar({ habilitado: true, desde: "192.168.2.10", hasta: "192.168.2.20", prefijo: 24, gateway: "192.168.2.1" });
      var res = dhcpSolicitar(est, "c1", "eth0");
      comparar("DHCP rango ajeno D16", res.diagnostico && res.diagnostico.codigo, "D16");
      comparar("DHCP rango ajeno explica", /no pertenece a la red/.test(res.diagnostico.explicacion), true);
      comparar("DHCP rango ajeno sólo discover", res.mensajes.map(function (m) { return m.tipo; }), ["discover"]);
      comparar("DHCP rango ajeno aviso del servidor", avisosServidorDhcp(est, "r1").length > 0, true);
      var est2 = armar({ habilitado: true, desde: "192.168.1.10", hasta: "192.168.1.20", prefijo: 24, gateway: "192.168.5.1" });
      var res2 = dhcpSolicitar(est2, "c1", "eth0");
      comparar("DHCP gateway ajeno igual entrega", res2.exito, true);
      comparar("DHCP gateway ajeno avisa", /no está en la red/.test((res2.avisos || []).join(" ")), true);
    })();

    // 20d. Dos servidores en el mismo segmento: dos OFFER, el cliente acepta
    // el primero y el ACK viene sólo de ése.
    (function () {
      var dhcpA = { habilitado: true, desde: "192.168.1.50", hasta: "192.168.1.60", prefijo: 24, gateway: "192.168.1.1" };
      var dhcpB = { habilitado: true, desde: "192.168.1.100", hasta: "192.168.1.110", prefijo: 24, gateway: "192.168.1.2" };
      var ra = fabRouter("ra", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }], [], { dhcp: dhcpA });
      var rb = fabRouter("rb", [{ id: "g0/0", ip: "192.168.1.2", prefijo: 24 }], [], { dhcp: dhcpB });
      var c1 = fabPc("c1", null, 24, null, { modo: "dhcp" });
      var sw = fabSwitch("sw1");
      var est = crearEstado(fabTopo([c1, sw, ra, rb],
        [fabEnlace("l1", "c1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "ra", "g0/0", "sw1", "fa0/2"),
         fabEnlace("l3", "rb", "g0/0", "sw1", "fa0/3")]));
      var res = dhcpSolicitar(est, "c1", "eth0");
      comparar("DHCP dos ofertas", res.mensajes.map(function (m) { return m.tipo + ":" + m.origen; }),
        ["discover:c1", "offer:ra", "offer:rb", "request:c1", "ack:ra"]);
      comparar("DHCP acepta la primera", [res.servidor, res.ip, res.gateway], ["ra", "192.168.1.50", "192.168.1.1"]);
    })();

    // 21. advertenciasDe detecta D06 y se apaga en modo docente.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "10.45.7.95", 27, "10.45.7.65"),
         fabPc("pc2", "10.45.7.66", 27, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      var avisos = advertenciasDe(est, "pc1");
      var codigos = avisos.map(function (a) { return a.codigo; });
      comparar("advertencia D06 presente", codigos.indexOf("D06") >= 0, true);
      comparar("modo docente apaga avisos", advertenciasDe(est, "pc1", { modoDocente: true }), []);
    })();

    // 22. diagnosticar coincide con ping sin animar.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")]);
      var est = crearEstado(topo);
      var d = diagnosticar(est, "pc1", "192.168.2.10");
      comparar("diagnosticar D08", d && d.codigo, "D08");
    })();

    // 23. Tras un ping exitoso, la tabla ARP aprendió.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabPc("pc2", "192.168.1.20", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      var est = crearEstado(topo);
      ping(est, "pc1", "192.168.1.20");
      var arp = tablaArp(est, "pc1");
      var ips = arp.map(function (e) { return e.ip; });
      comparar("ARP aprendida", ips.indexOf("192.168.1.20") >= 0, true);
    })();

    // Celda de prueba para los modos de radio: un router con wlan0 en modo
    // ap y dos clientes asociados a menos de 250 unidades.
    function armarCelda(extraR1) {
      var r1 = fabRouter("r1",
        [{ id: "wlan0", ip: "10.0.0.1", prefijo: 26, medio: "wireless", modoRadio: "ap" }],
        [], extraR1 || { x: 150, y: 150 });
      var c1 = fabPc("c1", null, 24, null, { x: 90, y: 90 });
      c1.interfaces[0].habilitada = false;
      c1.interfaces[1].habilitada = true;
      c1.interfaces[1].modoRadio = "cliente";
      c1.interfaces[1].ip = "10.0.0.10";
      c1.interfaces[1].prefijo = 26;
      var c2 = fabPc("c2", null, 24, null, { x: 210, y: 90 });
      c2.interfaces[0].habilitada = false;
      c2.interfaces[1].habilitada = true;
      c2.interfaces[1].modoRadio = "cliente";
      c2.interfaces[1].ip = "10.0.0.20";
      c2.interfaces[1].prefijo = 26;
      return fabTopo([r1, c1, c2],
        [fabEnlace("l1", "r1", "wlan0", "c1", "wlan0", { tipo: "wireless" }),
         fabEnlace("l2", "r1", "wlan0", "c2", "wlan0", { tipo: "wireless" })]);
    }

    // 24. D18: dos clientes asociados entre sí no se entienden.
    (function () {
      var c1 = fabPc("c1", null, 24, null, { x: 0, y: 0 });
      c1.interfaces[0].habilitada = false;
      c1.interfaces[1].habilitada = true;
      c1.interfaces[1].modoRadio = "cliente";
      c1.interfaces[1].ip = "10.0.0.1";
      var c2 = fabPc("c2", null, 24, null, { x: 100, y: 0 });
      c2.interfaces[0].habilitada = false;
      c2.interfaces[1].habilitada = true;
      c2.interfaces[1].modoRadio = "cliente";
      c2.interfaces[1].ip = "10.0.0.2";
      var est = crearEstado(fabTopo([c1, c2],
        [fabEnlace("l1", "c1", "wlan0", "c2", "wlan0", { tipo: "wireless" })]));
      var res = ping(est, "c1", "10.0.0.2");
      comparar("D18 cliente contra cliente", res.diagnostico && res.diagnostico.codigo, "D18");
    })();

    // 25. D19: cliente asociado a un AP deshabilitado.
    (function () {
      var topo = armarCelda();
      for (var i = 0; i < topo.dispositivos.length; i++) {
        if (topo.dispositivos[i].id === "r1") {
          topo.dispositivos[i].interfaces[0].habilitada = false;
        }
      }
      var res = ping(crearEstado(topo), "c1", "10.0.0.20");
      comparar("D19 sin punto de acceso", res.diagnostico && res.diagnostico.codigo, "D19");
      comparar("D19 nunca es D02", res.diagnostico && res.diagnostico.codigo === "D02", false);
    })();

    // 26. Dos clientes de la misma celda se ven sin pasar por el router.
    (function () {
      var est = crearEstado(armarCelda());
      var res = ping(est, "c1", "10.0.0.20");
      comparar("celda mismo segmento exito", res.exito, true);
      comparar("celda sin saltos por el router", res.saltos.length, 2);
      var tocaRouter = res.saltos.some(function (s) { return s.dispositivo === "r1"; });
      comparar("celda el router no reenvía", tocaRouter, false);
      var texto = res.pasos.map(function (p) { return p.titulo + " " + p.detalle; }).join(" ");
      comparar("celda el paso nombra al AP", texto.indexOf("punto de acceso") >= 0, true);
    })();

    // 27. Bridge contra bridge en alcance: la trama pasa transparente.
    (function () {
      var pc1 = fabPc("pc1", null, 24, null, { x: 0, y: 0 });
      pc1.interfaces[0].habilitada = false;
      pc1.interfaces[1].habilitada = true;
      pc1.interfaces[1].modoRadio = "bridge";
      pc1.interfaces[1].ip = "10.0.0.1";
      var pc2 = fabPc("pc2", null, 24, null, { x: 100, y: 0 });
      pc2.interfaces[0].habilitada = false;
      pc2.interfaces[1].habilitada = true;
      pc2.interfaces[1].modoRadio = "bridge";
      pc2.interfaces[1].ip = "10.0.0.2";
      var est = crearEstado(fabTopo([pc1, pc2],
        [fabEnlace("l1", "pc1", "wlan0", "pc2", "wlan0", { tipo: "wireless" })]));
      comparar("bridge en alcance anda", ping(est, "pc1", "10.0.0.2").exito, true);
    })();

    // 28. D15 en el aire: misma celda, subredes distintas, con texto de AP.
    (function () {
      var topo = armarCelda();
      for (var i = 0; i < topo.dispositivos.length; i++) {
        if (topo.dispositivos[i].id === "c2") {
          topo.dispositivos[i].interfaces[1].ip = "10.0.1.5";
          topo.dispositivos[i].interfaces[1].prefijo = 24;
        }
      }
      var res = ping(crearEstado(topo), "c1", "10.0.1.5");
      comparar("D15 en el aire", res.diagnostico && res.diagnostico.codigo, "D15");
      comparar("D15 menciona al AP",
        res.diagnostico && res.diagnostico.explicacion.indexOf("punto de acceso") >= 0, true);
      comparar("D15 en el aire titula por el AP",
        res.diagnostico && res.diagnostico.titulo.indexOf("punto de acceso") >= 0, true);
    })();

    // Dos routers unidos punto a punto: pc1 — sw1 — r1 === r2 — sw2 — pc2.
    function dosRouters(rutasR1, rutasR2) {
      return fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, "192.168.1.1"),
         fabPc("pc2", "192.168.2.10", 24, "192.168.2.1"),
         fabRouter("r1", [
           { id: "g0/0", ip: "192.168.1.1", prefijo: 24 },
           { id: "g0/1", ip: "10.0.0.1", prefijo: 30 }
         ], rutasR1),
         fabRouter("r2", [
           { id: "g0/0", ip: "10.0.0.2", prefijo: 30 },
           { id: "g0/1", ip: "192.168.2.1", prefijo: 24 }
         ], rutasR2),
         fabSwitch("sw1"), fabSwitch("sw2")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "r1", "g0/0", "sw1", "fa0/2"),
         fabEnlace("l3", "r1", "g0/1", "r2", "g0/0"),
         fabEnlace("l4", "r2", "g0/1", "sw2", "fa0/1"),
         fabEnlace("l5", "pc2", "eth0", "sw2", "fa0/2")]);
    }
    function routerDe(topo, id) {
      for (var k = 0; k < topo.dispositivos.length; k++) {
        if (topo.dispositivos[k].id === id) { return topo.dispositivos[k]; }
      }
      return null;
    }

    // 29. El campo gateway del router funciona como ruta por defecto.
    (function () {
      var topo = dosRouters([], []);
      routerDe(topo, "r1").gateway = "10.0.0.2";
      routerDe(topo, "r2").gateway = "10.0.0.1";
      comparar("gateway de router como ruta por defecto",
        ping(crearEstado(topo), "pc1", "192.168.2.10").exito, true);
    })();

    // 30. Un gateway fuera de toda red conectada no sirve: D11.
    (function () {
      var topo = dosRouters([], []);
      routerDe(topo, "r1").gateway = "172.16.0.1";
      routerDe(topo, "r2").gateway = "10.0.0.1";
      comparar("gateway de router inalcanzable da D11",
        ping(crearEstado(topo), "pc1", "192.168.2.10").diagnostico.codigo, "D11");
    })();

    // 31. Una 0.0.0.0/0 explícita le gana al campo gateway.
    (function () {
      var topo = dosRouters([{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "10.0.0.2" }],
        [{ destino: "192.168.1.0", prefijo: 24, siguienteSalto: "10.0.0.1" }]);
      routerDe(topo, "r1").gateway = "192.168.1.99";
      var est = crearEstado(topo);
      var r = rutaElegida(est, "r1", "192.168.2.10");
      comparar("ruta por defecto explícita le gana al gateway", r && r.siguienteSalto, "10.0.0.2");
      comparar("ruta por defecto explícita llega", ping(est, "pc1", "192.168.2.10").exito, true);
    })();

    // 32. D21: ping al broadcast de la propia subred.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "10.45.7.66", 27, "10.45.7.65"), fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")]);
      comparar("D21 ping a broadcast",
        ping(crearEstado(topo), "pc1", "10.45.7.95").diagnostico.codigo, "D21");
    })();

    // 33. D20: IP libre de la propia subred. D13 sólo si el equipo existe.
    (function () {
      var topo = fabTopo(
        [fabPc("pc1", "192.168.1.10", 24, null),
         fabPc("pc2", "192.168.1.20", 24, null),
         fabSwitch("sw1")],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "pc2", "eth0", "sw1", "fa0/2")]);
      comparar("D20 IP libre, no D13",
        ping(crearEstado(topo), "pc1", "192.168.1.77").diagnostico.codigo, "D20");
      routerDe(topo, "pc2").interfaces[0].habilitada = false;
      comparar("D13 interfaz del destino deshabilitada",
        ping(crearEstado(topo), "pc1", "192.168.1.20").diagnostico.codigo, "D13");
    })();

    // 34. D22: la ruta existe pero el siguiente salto no es alcanzable.
    (function () {
      var topo = dosRouters([{ destino: "192.168.2.0", prefijo: 24, siguienteSalto: "10.99.99.99" }], []);
      var res = ping(crearEstado(topo), "pc1", "192.168.2.10");
      comparar("D22 siguiente salto fuera de las redes conectadas", res.diagnostico.codigo, "D22");
      comparar("D22 menciona el siguiente salto",
        res.diagnostico.explicacion.indexOf("10.99.99.99") >= 0, true);
    })();

    // 35. D23: bucle de enrutamiento entre r1 y r2.
    (function () {
      var topo = dosRouters([{ destino: "192.168.9.0", prefijo: 24, siguienteSalto: "10.0.0.2" }],
        [{ destino: "192.168.9.0", prefijo: 24, siguienteSalto: "10.0.0.1" }]);
      var res = ping(crearEstado(topo), "pc1", "192.168.9.5");
      comparar("D23 TTL agotado por bucle", res.diagnostico.codigo, "D23");
      comparar("D23 nombra los dos routers",
        res.diagnostico.explicacion.indexOf("r1 → r2 → r1") >= 0, true);
    })();

    // 37. D09 nombra al equipo que no alcanza su gateway.
    (function () {
      var pc = fabPc("pc1", "192.168.1.10", 24, "192.168.2.1");
      pc.nombre = "PC-Aula";
      var topo = fabTopo([pc, fabSwitch("sw1")], [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")]);
      var res = ping(crearEstado(topo), "pc1", "10.9.9.9");
      comparar("D09 nombra al equipo", res.diagnostico && res.diagnostico.explicacion.indexOf("la red de PC-Aula") >= 0, true);
    })();

    // 38 a 42. Internet y nombres: pc — sw — r1 — nube.
    // r1 sale a internet con NAT en g0/1, salvo que se pida lo contrario.
    function conInternet(rutasR1, dnsPc, sinNat) {
      var pcN = fabPc("pc1", "192.168.1.10", 24, "192.168.1.1");
      pcN.dns = dnsPc;
      var nube = {
        id: "nube", tipo: "internet", nombre: "Internet", x: 300, y: 0, encendido: true,
        interfaces: [{ id: "eth0", nombre: "eth0", medio: "ethernet", habilitada: true, modo: "estatico", ip: "200.45.7.1", prefijo: 30, mac: "02:00:00:00:09:01" }],
        gateway: null, dns: null, rutas: [], dhcp: null
      };
      var r1N = fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }, { id: "g0/1", ip: "200.45.7.2", prefijo: 30 }], rutasR1);
      if (!sinNat) { r1N.interfaces[1].nat = true; }
      return fabTopo(
        [pcN, fabSwitch("sw1"), nube, r1N],
        [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1"),
         fabEnlace("l2", "r1", "g0/0", "sw1", "fa0/2"),
         fabEnlace("l3", "r1", "g0/1", "nube", "eth0")]);
    }
    (function () {
      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      var rIp = ping(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "8.8.8.8");
      comparar("internet responde una IP pública", rIp.exito, true);
      var rNombre = ping(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "google.com");
      comparar("ping a google.com resuelve y llega", rNombre.exito && rNombre.ipResuelta, "142.250.79.46");
      comparar("sin DNS configurado da D24",
        ping(crearEstado(conInternet(porDefecto, null)), "pc1", "google.com").diagnostico.codigo, "D24");
      comparar("nombre desconocido da D25",
        ping(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "noexiste.example").diagnostico.codigo, "D25");
      var rSinRuta = ping(crearEstado(conInternet([], "8.8.8.8")), "pc1", "google.com");
      comparar("router sin salida a internet: el DNS no responde (D26)", rSinRuta.diagnostico.codigo, "D26");
    })();

    // 43. Una PC con la nube como gateway directo llega a internet.
    (function () {
      var pcD = fabPc("pc1", "200.45.7.2", 30, "200.45.7.1");
      pcD.dns = "8.8.8.8";
      var nubeD = {
        id: "nube", tipo: "internet", nombre: "Internet", x: 300, y: 0, encendido: true,
        interfaces: [{ id: "eth0", nombre: "eth0", medio: "ethernet", habilitada: true, modo: "estatico", ip: "200.45.7.1", prefijo: 30, mac: "02:00:00:00:09:01" }],
        gateway: null, dns: null, rutas: [], dhcp: null
      };
      var topoD = fabTopo([pcD, nubeD], [fabEnlace("l1", "pc1", "eth0", "nube", "eth0")]);
      comparar("nube como gateway directo: ping a IP pública", ping(crearEstado(topoD), "pc1", "8.8.8.8").exito, true);
      comparar("nube como gateway directo: ping a google.com", ping(crearEstado(topoD), "pc1", "google.com").exito, true);
    })();

    // 44. Una IP privada que no existe no es un bucle: internet la descarta.
    (function () {
      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      var rPriv = ping(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "10.9.9.9");
      comparar("IP privada inexistente: D11 en internet, no D23", rPriv.diagnostico.codigo, "D11");
      comparar("D11 de internet explica la dirección privada",
        rPriv.diagnostico.explicacion.indexOf("dirección privada") >= 0, true);
    })();

    // 45. Reglas de filtrado: huéspedes — r1 — servidores, y r1 — r2 — srv2.
    function conFiltro(reglasR1, reglasR2) {
      var r1 = fabRouter("r1", [
        { id: "g0/0", ip: "10.0.1.1", prefijo: 24 },
        { id: "g0/1", ip: "10.0.2.1", prefijo: 24 },
        { id: "g0/2", ip: "10.0.9.1", prefijo: 30 }
      ], [{ destino: "10.0.3.0", prefijo: 24, siguienteSalto: "10.0.9.2" }]);
      r1.reglas = reglasR1 || [];
      var r2 = fabRouter("r2", [
        { id: "g0/0", ip: "10.0.9.2", prefijo: 30 },
        { id: "g0/1", ip: "10.0.3.1", prefijo: 24 }
      ], [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "10.0.9.1" }]);
      r2.reglas = reglasR2 || [];
      return fabTopo(
        [fabPc("h1", "10.0.1.10", 24, "10.0.1.1"), fabPc("s1", "10.0.2.10", 24, "10.0.2.1"),
         fabPc("t3", "10.0.3.10", 24, "10.0.3.1"), r1, r2],
        [fabEnlace("l1", "h1", "eth0", "r1", "g0/0"), fabEnlace("l2", "s1", "eth0", "r1", "g0/1"),
         fabEnlace("l3", "r1", "g0/2", "r2", "g0/0"), fabEnlace("l4", "t3", "eth0", "r2", "g0/1")]);
    }
    (function () {
      var bloqueo = [{ accion: "bloquear", origen: "10.0.1.0/24", destino: "10.0.0.0/16" }];
      var rIda = ping(crearEstado(conFiltro(bloqueo)), "h1", "10.0.2.10");
      comparar("filtro: el huésped no llega al servidor (D27)", rIda.diagnostico && rIda.diagnostico.codigo, "D27");
      comparar("D27 nombra la regla", rIda.diagnostico.explicacion.indexOf("10.0.1.0/24 hacia 10.0.0.0/16") >= 0, true);
      comparar("filtro: el paso de reglas figura en el recorrido",
        rIda.pasos.some(function (p) { return p.titulo === "Revisar las reglas de filtrado de r1" && !p.ok; }), true);
      var rVuelta = ping(crearEstado(conFiltro(bloqueo)), "s1", "10.0.1.10");
      comparar("filtro: la respuesta bloqueada es D27, no D12", rVuelta.diagnostico && rVuelta.diagnostico.codigo, "D27");
      comparar("D27 de la vuelta lo explica", rVuelta.diagnostico.explicacion.indexOf("la respuesta") >= 0, true);
      comparar("filtro: lo que no coincide pasa", ping(crearEstado(conFiltro(bloqueo)), "s1", "10.0.3.10").exito, true);
      var conExcepcion = [{ accion: "permitir", origen: "10.0.1.0/24", destino: "10.0.2.0/24" }].concat(bloqueo);
      comparar("filtro: gana la primera regla que coincide", ping(crearEstado(conFiltro(conExcepcion)), "h1", "10.0.2.10").exito, true);
      var rLejos = ping(crearEstado(conFiltro([], [{ accion: "bloquear", origen: "10.0.1.0/24", destino: "10.0.3.0/24" }])), "h1", "10.0.3.10");
      comparar("filtro: un router intermedio con entrega directa también filtra", rLejos.diagnostico && rLejos.diagnostico.codigo, "D27");
      var desdeRouter = conFiltro([{ accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0" }]);
      comparar("filtro: no se aplica al tráfico que genera el propio router",
        ping(crearEstado(desdeRouter), "r1", "10.0.2.10").exito, true);
      comparar("filtro: sin reglas todo pasa", ping(crearEstado(conFiltro()), "h1", "10.0.2.10").exito, true);
    })();

    // Firewall con estado: la respuesta de lo que dejó pasar vuelve aunque
    // una regla la bloquearía; lo que la regla frena a la ida, sigue frenado.
    (function () {
      var bloqueo = [{ accion: "bloquear", origen: "10.0.1.0/24", destino: "10.0.0.0/16" }];
      function conFirewall() {
        var topo = conFiltro(bloqueo);
        topo.dispositivos.forEach(function (d) { if (d.id === "r1") { d.modelo = "firewall"; } });
        return topo;
      }
      var resp = ping(crearEstado(conFirewall()), "s1", "10.0.1.10");
      comparar("firewall: deja volver la respuesta", resp.exito, true);
      comparar("firewall: el recorrido lo explica", (resp.pasos || []).some(function (p) {
        return /recuerda la conversación/.test(p.detalle || p.texto || p.descripcion || JSON.stringify(p));
      }) || JSON.stringify(resp).indexOf("recuerda la conversación") >= 0, true);
      comparar("firewall: lo que la regla frena a la ida sigue frenado",
        ping(crearEstado(conFirewall()), "h1", "10.0.2.10").diagnostico.codigo, "D27");
      comparar("router sin estado: la misma respuesta se bloquea",
        ping(crearEstado(conFiltro(bloqueo)), "s1", "10.0.1.10").diagnostico.codigo, "D27");
    })();

    // Rutas asimétricas: la ida va directo de r1 a r2 y la vuelta pasa por un
    // firewall que no vio el pedido. No conoce la conversación y aplica su regla.
    (function () {
      var r1 = fabRouter("r1", [
        { id: "g0/0", ip: "10.0.1.1", prefijo: 24 },
        { id: "g0/1", ip: "10.0.12.1", prefijo: 30 },
        { id: "g0/2", ip: "10.0.13.1", prefijo: 30 }
      ], [{ destino: "10.0.2.0", prefijo: 24, siguienteSalto: "10.0.12.2" }]);
      var r2 = fabRouter("r2", [
        { id: "g0/0", ip: "10.0.2.1", prefijo: 24 },
        { id: "g0/1", ip: "10.0.12.2", prefijo: 30 },
        { id: "g0/2", ip: "10.0.23.2", prefijo: 30 }
      ], [{ destino: "10.0.1.0", prefijo: 24, siguienteSalto: "10.0.23.1" }]);
      var fw = fabRouter("fw", [
        { id: "lan1", ip: "10.0.13.2", prefijo: 30 },
        { id: "wan", ip: "10.0.23.1", prefijo: 30 }
      ], [{ destino: "10.0.1.0", prefijo: 24, siguienteSalto: "10.0.13.1" },
          { destino: "10.0.2.0", prefijo: 24, siguienteSalto: "10.0.23.2" }]);
      fw.modelo = "firewall";
      fw.reglas = [{ accion: "bloquear", origen: "10.0.2.0/24", destino: "10.0.1.0/24" }];
      var topo = fabTopo(
        [fabPc("h1", "10.0.1.10", 24, "10.0.1.1"), fabPc("h2", "10.0.2.10", 24, "10.0.2.1"), r1, r2, fw],
        [fabEnlace("l1", "h1", "eth0", "r1", "g0/0"), fabEnlace("l2", "h2", "eth0", "r2", "g0/0"),
         fabEnlace("l3", "r1", "g0/1", "r2", "g0/1"), fabEnlace("l4", "r1", "g0/2", "fw", "lan1"),
         fabEnlace("l5", "fw", "wan", "r2", "g0/2")]);
      var res = ping(crearEstado(topo), "h1", "10.0.2.10");
      comparar("asimétrico: la respuesta la frena el firewall (D27)", res.diagnostico && res.diagnostico.codigo, "D27");
      comparar("asimétrico: el D27 explica que el firewall no vio la ida",
        /no pasó por él a la ida/.test(res.diagnostico.explicacion), true);
      comparar("asimétrico: no dice que el firewall deja volver la respuesta",
        /deja volver la respuesta/.test(res.diagnostico.explicacion), false);
    })();

    // Capas y tramas: pc1 — sw1 — r1 === r2 — sw2 — pc2.
    (function () {
      var rutas1 = [{ destino: "192.168.2.0", prefijo: 24, siguienteSalto: "10.0.0.2" }];
      var rutas2 = [{ destino: "192.168.1.0", prefijo: 24, siguienteSalto: "10.0.0.1" }];
      var topo = dosRouters(rutas1, rutas2);
      var est = crearEstado(topo);
      var res = ping(est, "pc1", "192.168.2.10");
      var ida = res.tramas.filter(function (t) { return t.sentido === "ida"; });
      var vuelta = res.tramas.filter(function (t) { return t.sentido === "vuelta"; });
      comparar("tramas: tres de ida y tres de vuelta", [ida.length, vuelta.length], [3, 3]);
      var macR1 = buscarInterfaz(buscarDispositivo(est, "r1"), "g0/0").mac;
      comparar("tramas: la primera va a la MAC de r1", [ida[0].de.dispositivo, ida[0].macDestino], ["pc1", macR1]);
      comparar("tramas: la primera cruza sw1 sin cambiar", ida[0].atraviesa, ["sw1"]);
      comparar("tramas: con los cables que cruza, en orden", ida[0].enlaces, ["l1", "l2"]);
      comparar("tramas: la última de ida termina en pc2", ida[2].a.dispositivo, "pc2");
      comparar("tramas: la IP no cambia en la ida", ida.every(function (t) {
        return t.ipOrigen === "192.168.1.10" && t.ipDestino === "192.168.2.10" && t.mensaje === "ICMP echo request";
      }), true);
      comparar("tramas: en cada salto las MAC son las de ese tramo", [ida[1].macOrigen, ida[1].macDestino], [
        buscarInterfaz(buscarDispositivo(est, "r1"), "g0/1").mac, buscarInterfaz(buscarDispositivo(est, "r2"), "g0/0").mac]);
      comparar("tramas: el TTL baja uno por router", ida.map(function (t) { return t.ttl; }), [64, 63, 62]);
      comparar("tramas: la vuelta invierte las IP", [vuelta[0].ipOrigen, vuelta[0].mensaje], ["192.168.2.10", "ICMP echo reply"]);
      comparar("TTL: r1 lo baja de 64 a 63", res.pasos.some(function (p) { return /de 64 a 63/.test(p.detalle); }), true);
      comparar("TTL: la respuesta llega con 62", res.respuestas[0].ttl, 62);
      comparar("capas: ARP es capa 2", res.pasos.filter(function (p) { return /ARP/.test(p.titulo); })
        .every(function (p) { return p.capa === 2; }), true);
      comparar("capas: la conexión física es capa 1", res.pasos[1].capa, 1);
      comparar("capas: buscar ruta es capa 3", res.pasos.filter(function (p) { return /^Buscar ruta/.test(p.titulo); })
        .every(function (p) { return p.capa === 3; }), true);
      comparar("capas: la tabla de capas", CAPAS[2], { osi: "Enlace", tcpip: "Acceso a la red", pdu: "trama" });

      var sinVuelta = ping(crearEstado(dosRouters(rutas1, [])), "pc1", "192.168.2.10");
      comparar("capas: los pasos de una vuelta fallida conservan la capa", sinVuelta.pasos.filter(function (p) {
        return /^Respuesta: /.test(p.titulo);
      }).every(function (p) { return p.capa !== undefined; }), true);
      comparar("tramas: la vuelta fallida llega hasta donde llegó",
        sinVuelta.tramas.filter(function (t) { return t.sentido === "vuelta"; }).length, 1);

      var bucle = ping(crearEstado(dosRouters([{ destino: "192.168.9.0", prefijo: 24, siguienteSalto: "10.0.0.2" }],
        [{ destino: "192.168.9.0", prefijo: 24, siguienteSalto: "10.0.0.1" }])), "pc1", "192.168.9.5");
      comparar("D23: el detalle no lista los 64 routers", bucle.diagnostico.explicacion.length < 300, true);

      var pcMal = fabPc("pc1", "192.168.1.10", 24, "192.168.2.1");
      var d09 = ping(crearEstado(fabTopo([pcMal, fabSwitch("sw1")], [fabEnlace("l1", "pc1", "eth0", "sw1", "fa0/1")])), "pc1", "10.9.9.9");
      comparar("tramas: un D09 no llega a salir", [d09.diagnostico.codigo, d09.tramas.length], ["D09", 0]);
      comparar("tramas: un destino mal escrito tampoco", ping(est, "pc1", "1.2.3").tramas.length, 0);
    })();
    (function () {
      var topo = conFiltro([{ accion: "bloquear", origen: "10.0.1.0/24", destino: "10.0.0.0/16" }]);
      topo.dispositivos.forEach(function (d) { if (d.id === "r1") { d.modelo = "firewall"; } });
      var res = ping(crearEstado(topo), "h1", "10.0.2.10");
      comparar("tramas: el bloqueo corta en el firewall",
        res.tramas.map(function (t) { return t.sentido + ":" + t.a.dispositivo; }), ["ida:r1"]);
      var porNombre = ping(crearEstado(conInternet([{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }], "8.8.8.8")), "pc1", "google.com");
      comparar("capas: la consulta DNS es capa 7 y el ping empieza en la 1", [porNombre.pasos[0].capa,
        porNombre.pasos.filter(function (p) { return p.capa !== 7; })[0].capa], [7, 1]);
      comparar("tramas: el ping a internet sale y vuelve",
        porNombre.tramas.map(function (t) { return t.sentido + ":" + t.a.dispositivo; }), ["ida:r1", "ida:nube", "vuelta:r1", "vuelta:pc1"]);
    })();

    // NAT de salida: pc1 (192.168.1.10) — r1 (g0/1 200.45.7.2) — nube.
    (function () {
      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      var con = ping(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "8.8.8.8");
      comparar("NAT: con NAT responde", con.exito, true);
      comparar("NAT: el paso de traducción figura", con.pasos.some(function (p) {
        return p.titulo === "Traducir la dirección de origen (NAT)" && p.capa === 3 && /192\.168\.1\.10 por la de su puerto g0\/1, 200\.45\.7\.2/.test(p.detalle);
      }), true);
      comparar("NAT: las tramas de ida cambian la IP de origen en r1",
        con.tramas.filter(function (t) { return t.sentido === "ida"; }).map(function (t) { return t.ipOrigen; }), ["192.168.1.10", "200.45.7.2"]);
      var vueltas = con.tramas.filter(function (t) { return t.sentido === "vuelta"; });
      comparar("NAT: la respuesta sale de 8.8.8.8 hacia la IP pública y vuelve a la privada",
        vueltas.map(function (t) { return t.ipOrigen + ">" + t.ipDestino; }), ["8.8.8.8>200.45.7.2", "8.8.8.8>192.168.1.10"]);
      comparar("NAT: la respuesta llega con TTL 63", con.respuestas[0].ttl, 63);

      var sin = ping(crearEstado(conInternet(porDefecto, "8.8.8.8", true)), "pc1", "8.8.8.8");
      comparar("NAT: sin NAT da D28", sin.diagnostico && sin.diagnostico.codigo, "D28");
      comparar("D28 nombra la IP privada y el router", /192\.168\.1\.10/.test(sin.diagnostico.explicacion) && /r1/.test(sin.diagnostico.explicacion), true);
      comparar("D28 sugiere el puerto", /g0\/1/.test(sin.diagnostico.sugerencia), true);
      var sinNombre = ping(crearEstado(conInternet(porDefecto, "8.8.8.8", true)), "pc1", "google.com");
      comparar("NAT: sin NAT, el ping por nombre da D26 por falta de NAT",
        [sinNombre.diagnostico.codigo, /privada/.test(sinNombre.diagnostico.explicacion)], ["D26", true]);
      var est = crearEstado(conInternet(porDefecto, "8.8.8.8", true));
      comparar("NAT: advertencia en el router de borde sin NAT", advertenciasDe(est, "r1").some(function (a) { return a.codigo === "D28"; }), true);
      comparar("NAT: sin advertencia con NAT",
        advertenciasDe(crearEstado(conInternet(porDefecto, "8.8.8.8")), "r1").some(function (a) { return a.codigo === "D28"; }), false);

      var publica = conInternet(porDefecto, "8.8.8.8");
      publica.dispositivos.forEach(function (d) {
        if (d.id === "pc1") { d.interfaces[0].ip = "190.10.10.10"; d.gateway = "190.10.10.1"; }
        if (d.id === "r1") { d.interfaces[0].ip = "190.10.10.1"; }
      });
      var rPub = ping(crearEstado(publica), "pc1", "8.8.8.8");
      comparar("NAT: un origen público no se traduce",
        [rPub.exito, rPub.pasos.some(function (p) { return /NAT/.test(p.titulo); })], [true, false]);

      var fw = conInternet(porDefecto, "8.8.8.8");
      fw.dispositivos.forEach(function (d) {
        if (d.id === "r1") { d.modelo = "firewall"; d.reglas = [{ accion: "bloquear", origen: "0.0.0.0/0", destino: "192.168.1.0/24" }]; }
      });
      var rFw = ping(crearEstado(fw), "pc1", "8.8.8.8");
      comparar("NAT: un firewall con NAT deja volver la respuesta y la traduce",
        [rFw.exito, rFw.pasos.some(function (p) { return p.titulo === "Traducir la dirección de origen (NAT)"; })], [true, true]);
    })();

    // DNS: pc1 y un servidor de la zona oficina.local detrás de r1 (con NAT).
    (function () {
      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      function oficina(opc) {
        opc = opc || {};
        var topo = conInternet(porDefecto, opc.dnsPc || "192.168.1.53", opc.sinNat);
        var srv = fabPc("srv", "192.168.1.53", 24, "192.168.1.1");
        srv.tipo = "servidor";
        srv.interfaces = [srv.interfaces[0]];
        srv.servicios = { dns: { zona: "oficina.local", recursivo: opc.recursivo !== false, registros: [
          { nombre: "www.oficina.local", tipo: "A", valor: "192.168.1.53" },
          { nombre: "intranet.oficina.local", tipo: "CNAME", valor: "www.oficina.local" },
          { nombre: "oficina.local", tipo: "MX", valor: "correo.oficina.local", prioridad: 10 },
          { nombre: "correo.oficina.local", tipo: "A", valor: "192.168.1.53" }
        ] } };
        topo.dispositivos.push(srv);
        topo.enlaces.push(fabEnlace("l9", "srv", "eth0", "sw1", "fa0/3"));
        return topo;
      }
      function titulos(res) { return res.pasos.map(function (p) { return p.titulo; }).join(" | "); }
      var est = crearEstado(oficina());
      var www = consultarDns(est, "pc1", "www.oficina.local", "A");
      comparar("DNS: el servidor propio responde con autoridad",
        [www.exito, www.respuesta.autoritativa, www.respuesta.registros.map(function (x) { return x.valor; })], [true, true, ["192.168.1.53"]]);
      comparar("DNS: sin pasar por la raíz", /raíz/.test(titulos(www)), false);
      comparar("DNS: la consulta al servidor es recursiva", /consulta recursiva/.test(www.pasos[0].titulo) && www.pasos[0].capa === 7, true);
      var alias = consultarDns(est, "pc1", "intranet.oficina.local", "A");
      comparar("DNS: el CNAME trae la cadena", alias.respuesta.registros.map(function (x) { return x.tipo; }), ["CNAME", "A"]);
      var mx = consultarDns(est, "pc1", "oficina.local", "MX");
      comparar("DNS: MX con prioridad", [mx.respuesta.registros[0].valor, mx.respuesta.registros[0].prioridad], ["correo.oficina.local", 10]);
      var falta = consultarDns(est, "pc1", "fotos.oficina.local", "A");
      comparar("DNS: un nombre que no está en la zona da D25 sin salir",
        [falta.diagnostico.codigo, /oficina\.local/.test(falta.diagnostico.explicacion), /raíz/.test(titulos(falta))], ["D25", true, false]);

      var t0 = 1000000;
      var g1 = consultarDns(est, "pc1", "google.com", "A", { ahora: t0 });
      comparar("DNS: google.com por jerarquía", [g1.exito, g1.respuesta.registros[0].valor, g1.respuesta.autoritativa], [true, "142.250.79.46", false]);
      comparar("DNS: pasos raíz, .com y autoritativo, iterativos",
        ["Preguntar a la raíz (consulta iterativa)", "Preguntar al servidor de .com (consulta iterativa)", "Preguntar al autoritativo de google.com (consulta iterativa)"]
          .every(function (t) { return titulos(g1).indexOf(t) >= 0; }), true);
      comparar("DNS: respuesta no autoritativa", /respuesta no autoritativa/.test(g1.pasos[g1.pasos.length - 1].detalle), true);
      var g2 = consultarDns(est, "pc1", "google.com", "A", { ahora: t0 + 60000 });
      comparar("DNS: la segunda vez sale de la caché", [g2.respuesta.desdeCache, /raíz/.test(titulos(g2)), /le quedan 240 s/.test(titulos(g2) + g2.pasos.map(function (p) { return p.detalle; }).join(" "))],
        [true, false, true]);
      var g3 = consultarDns(est, "pc1", "google.com", "A", { ahora: t0 + 301000 });
      comparar("DNS: vencido el TTL, vuelve a preguntar", [g3.respuesta.desdeCache, /raíz/.test(titulos(g3))], [false, true]);
      vaciarCacheDns(est);
      comparar("DNS: vaciar la caché", consultarDns(est, "pc1", "google.com", "A", { ahora: t0 + 302000 }).respuesta.desdeCache, false);
      var ns = consultarDns(est, "pc1", "google.com", "NS");
      comparar("DNS: NS de google.com", ns.respuesta.registros[0].valor, "ns1.google.com");
      var wwwG = consultarDns(est, "pc1", "www.google.com", "A");
      comparar("DNS: www.google.com es un CNAME", wwwG.respuesta.registros.map(function (x) { return x.tipo; }), ["CNAME", "A"]);

      var afuera = consultarDns(crearEstado(oficina({ dnsPc: "8.8.8.8" })), "pc1", "www.oficina.local", "A");
      comparar("DNS: un nombre .local preguntado a 8.8.8.8 da D25 de la raíz",
        [afuera.diagnostico.codigo, /\.local no existe/.test(afuera.diagnostico.explicacion)], ["D25", true]);
      var publico = consultarDns(crearEstado(oficina({ dnsPc: "8.8.8.8" })), "pc1", "google.com", "A");
      comparar("DNS: 8.8.8.8 resuelve por jerarquía", [publico.exito, publico.respuesta.servidor], [true, "8.8.8.8 (Google Public DNS)"]);
      var noDns = consultarDns(crearEstado(oficina({ dnsPc: "192.168.1.1" })), "pc1", "google.com", "A");
      comparar("DNS: el router no es servidor DNS (D29)", [noDns.diagnostico.codigo, /router suele reenviar/.test(noDns.diagnostico.explicacion)], ["D29", true]);
      var sinSalida = consultarDns(crearEstado(oficina({ sinNat: true })), "pc1", "google.com", "A");
      comparar("DNS: el servidor sin salida a internet da D30", sinSalida.diagnostico.codigo, "D30");
      comparar("DNS: sin salida, los nombres propios igual responden",
        consultarDns(crearEstado(oficina({ sinNat: true })), "pc1", "www.oficina.local", "A").exito, true);
      var noRec = consultarDns(crearEstado(oficina({ recursivo: false })), "pc1", "google.com", "A");
      comparar("DNS: un servidor no recursivo no busca afuera", [noRec.diagnostico.codigo, /no busca nombres de afuera/.test(noRec.diagnostico.explicacion)], ["D25", true]);
      var pingNombre = ping(crearEstado(oficina()), "pc1", "intranet.oficina.local");
      comparar("DNS: ping a un nombre propio", [pingNombre.exito, pingNombre.ipResuelta], [true, "192.168.1.53"]);
      comparar("DNS: tipos de registro", TIPOS_REGISTRO, ["A", "CNAME", "MX", "NS"]);
    })();

    // Hub y dominios: pc1 — sw1 — r1 === r2 — sw2 — pc2.
    (function () {
      var rutas1 = [{ destino: "192.168.2.0", prefijo: 24, siguienteSalto: "10.0.0.2" }];
      var rutas2 = [{ destino: "192.168.1.0", prefijo: 24, siguienteSalto: "10.0.0.1" }];
      var conSwitch = dominios(crearEstado(dosRouters(rutas1, rutas2)));
      comparar("dominios con switches: 5 de colisión y 3 de broadcast", [conSwitch.colision.length, conSwitch.broadcast.length], [5, 3]);
      var topoHub = dosRouters(rutas1, rutas2);
      routerDe(topoHub, "sw1").modelo = "hub";
      var conHub = dominios(crearEstado(topoHub));
      comparar("dominios con un hub: 4 de colisión y 3 de broadcast", [conHub.colision.length, conHub.broadcast.length], [4, 3]);
      comparar("el hub junta sus cables en un dominio de colisión",
        conHub.colision.some(function (d) { return d.enlaces.join(",") === "l1,l2"; }), true);
      var est = crearEstado(topoHub);
      var res = ping(est, "pc1", "192.168.2.10");
      comparar("ping a través de un hub", res.exito, true);
      var pc2Local = fabPc("pc3", "192.168.1.20", 24, "192.168.1.1");
      topoHub.dispositivos.push(pc2Local);
      topoHub.enlaces.push(fabEnlace("l6", "pc3", "eth0", "sw1", "fa0/3"));
      var local = ping(crearEstado(topoHub), "pc1", "192.168.1.20");
      comparar("el hub repite la trama por todos sus puertos",
        local.pasos.some(function (p) { return /repite la trama por todos sus puertos/.test(p.detalle); }), true);
      comparar("un hub no tiene tabla MAC", est.mac.sw1, undefined);
    })();

    // Conexiones TCP y UDP.
    (function () {
      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      var topo = conInternet(porDefecto, "192.168.1.53");
      var srv = fabPc("srv", "192.168.1.53", 24, "192.168.1.1");
      srv.tipo = "servidor";
      srv.interfaces = [srv.interfaces[0]];
      srv.servicios = { escuchando: [{ protocolo: "tcp", puerto: 80, nombre: "HTTP" }],
        dns: { zona: "oficina.local", recursivo: true, registros: [{ nombre: "www.oficina.local", tipo: "A", valor: "192.168.1.53" }] } };
      topo.dispositivos.push(srv);
      topo.enlaces.push(fabEnlace("l9", "srv", "eth0", "sw1", "fa0/3"));
      var http = conectar(crearEstado(topo), "pc1", "192.168.1.53", "tcp", 80);
      comparar("TCP: conexión HTTP establecida", http.exito, true);
      comparar("TCP: handshake de tres pasos", http.segmentos.slice(0, 3).map(function (x) { return x.flags; }), ["SYN", "SYN-ACK", "ACK"]);
      comparar("TCP: el ack del SYN-ACK es el seq del SYN más 1", http.segmentos[1].ack, http.segmentos[0].seq + 1);
      comparar("TCP: el pedido HTTP", http.segmentos[3].datos, "GET / HTTP/1.1");
      comparar("TCP: ocho segmentos con el cierre", http.segmentos.map(function (x) { return x.flags; }),
        ["SYN", "SYN-ACK", "ACK", "PSH-ACK", "PSH-ACK", "FIN-ACK", "FIN-ACK", "ACK"]);
      comparar("TCP: puerto efímero", http.segmentos[0].puertoOrigen >= 49152 && http.segmentos[0].puertoDestino === 80, true);
      comparar("TCP: pasos de capa 4 y 7", http.pasos.some(function (p) { return p.capa === 4; }) && http.pasos.some(function (p) { return p.capa === 7; }), true);
      var nombre = conectar(crearEstado(topo), "pc1", "www.oficina.local", "tcp", 80);
      comparar("TCP: se conecta a un nombre resolviéndolo antes", [nombre.exito, nombre.pasos[0].capa], [true, 7]);
      var cerrado = conectar(crearEstado(topo), "pc1", "192.168.1.53", "tcp", 22);
      comparar("TCP: puerto cerrado da D31 con SYN y RST",
        [cerrado.diagnostico.codigo, cerrado.segmentos.map(function (x) { return x.flags; })], ["D31", ["SYN", "RST-ACK"]]);
      var dnsUdp = conectar(crearEstado(topo), "pc1", "192.168.1.53", "udp", 53);
      comparar("UDP: DNS sin handshake, dos datagramas", [dnsUdp.exito, dnsUdp.segmentos.length, dnsUdp.segmentos[0].flags], [true, 2, ""]);
      var udpCerrado = conectar(crearEstado(topo), "pc1", "192.168.1.53", "udp", 69);
      comparar("UDP: puerto cerrado da D31 por ICMP", [udpCerrado.diagnostico.codigo, /ICMP/.test(udpCerrado.diagnostico.explicacion)], ["D31", true]);
      var google = conectar(crearEstado(topo), "pc1", "google.com", "tcp", 443);
      comparar("TCP: HTTPS a google.com con NAT",
        [google.exito, google.socket.cliente.split(":")[0], google.socket.vistoPorServidor.split(":")[0]], [true, "192.168.1.10", "200.45.7.2"]);
      comparar("TCP: el router no escucha en el 80 (D31)", conectar(crearEstado(topo), "pc1", "192.168.1.1", "tcp", 80).diagnostico.codigo, "D31");
      var sinRuta = conInternet([], "192.168.1.53");
      comparar("TCP: si la red no llega, el diagnóstico es el de la red",
        conectar(crearEstado(sinRuta), "pc1", "8.8.8.8", "tcp", 443).diagnostico.codigo, "D11");
    })();

    // Filtrado por protocolo, puerto, entrada y política por defecto.
    (function () {
      function conServidor(reglas, opc) {
        var topo = conFiltro(reglas);
        topo.dispositivos.forEach(function (d) {
          if (d.id === "s1") {
            d.tipo = "servidor"; d.interfaces = [d.interfaces[0]];
            d.servicios = { escuchando: [{ protocolo: "tcp", puerto: 80 }, { protocolo: "tcp", puerto: 22 }] };
          }
          if (d.id === "r1" && opc && opc.firewall) { d.modelo = "firewall"; }
          if (d.id === "r1" && opc && opc.politica) { d.politica = opc.politica; }
        });
        return topo;
      }
      var sinSsh = conServidor([{ accion: "bloquear", origen: "10.0.1.0/24", destino: "0.0.0.0/0", protocolo: "tcp", puerto: 22 }]);
      var ssh = conectar(crearEstado(sinSsh), "h1", "10.0.2.10", "tcp", 22);
      comparar("filtro por puerto: SSH bloqueado (D27)", [ssh.diagnostico.codigo, /TCP 22/.test(ssh.diagnostico.explicacion)], ["D27", true]);
      comparar("filtro por puerto: HTTP pasa", conectar(crearEstado(sinSsh), "h1", "10.0.2.10", "tcp", 80).exito, true);
      comparar("filtro por puerto: el ping pasa", ping(crearEstado(sinSsh), "h1", "10.0.2.10").exito, true);

      var porEntrada = conServidor([{ accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0", entrada: "g0/0" }]);
      var entra = ping(crearEstado(porEntrada), "h1", "10.0.2.10");
      comparar("filtro por entrada: lo que entra por g0/0 se bloquea", [entra.diagnostico.codigo, /entra por g0\/0/.test(entra.diagnostico.explicacion)], ["D27", true]);
      comparar("filtro por entrada: lo que entra por g0/1 pasa", ping(crearEstado(porEntrada), "s1", "10.0.3.10").exito, true);

      var lista = [{ accion: "permitir", origen: "0.0.0.0/0", destino: "10.0.2.10/32", protocolo: "tcp", puerto: 80 }];
      var fw = conServidor(lista, { firewall: true, politica: "bloquear" });
      comparar("lista blanca en un firewall: HTTP pasa y la respuesta vuelve", conectar(crearEstado(fw), "h1", "10.0.2.10", "tcp", 80).exito, true);
      var sshFw = conectar(crearEstado(fw), "h1", "10.0.2.10", "tcp", 22);
      comparar("lista blanca: SSH lo frena la política por defecto",
        [sshFw.diagnostico.codigo, /política por defecto es bloquear/.test(sshFw.diagnostico.explicacion)], ["D27", true]);
      comparar("lista blanca: el ping también", ping(crearEstado(fw), "h1", "10.0.2.10").diagnostico.codigo, "D27");
      var rt = conServidor(lista, { politica: "bloquear" });
      var httpRt = conectar(crearEstado(rt), "h1", "10.0.2.10", "tcp", 80);
      comparar("lista blanca en un router: la respuesta no vuelve",
        [httpRt.diagnostico.codigo, /la respuesta/.test(httpRt.diagnostico.explicacion), /bloquea por defecto/.test(httpRt.diagnostico.explicacion)], ["D27", true, true]);

      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      var sinDns = conInternet(porDefecto, "8.8.8.8");
      sinDns.dispositivos.forEach(function (d) {
        if (d.id === "r1") { d.reglas = [{ accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0", protocolo: "udp", puerto: 53 }]; }
      });
      var nombreBloqueado = ping(crearEstado(sinDns), "pc1", "google.com");
      comparar("filtro de UDP 53: el DNS no llega (D26 por la regla)",
        [nombreBloqueado.diagnostico.codigo, /UDP 53/.test(nombreBloqueado.diagnostico.explicacion)], ["D26", true]);
      comparar("filtro de UDP 53: el ping a una IP sigue andando", ping(crearEstado(sinDns), "pc1", "8.8.8.8").exito, true);
    })();

    // Tramas para la captura: DNS, TCP y el ping con su protocolo.
    (function () {
      var porDefecto = [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }];
      var est = crearEstado(conInternet(porDefecto, "8.8.8.8"));
      var p = ping(est, "pc1", "8.8.8.8");
      comparar("captura: las tramas del ping son ICMP", p.tramas.every(function (t) { return t.protocolo === "ICMP"; }), true);
      var g = ping(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "google.com");
      comparar("captura: el ping a un nombre trae la consulta y la respuesta DNS aparte",
        [g.tramasPrevias.length > 0, g.tramasPrevias.every(function (t) { return t.protocolo === "DNS"; }),
          g.tramasPrevias[0].puertoDestino, /Consulta estándar A google.com/.test(g.tramasPrevias[0].info)], [true, true, 53, true]);
      var c = conectar(crearEstado(conInternet(porDefecto, "8.8.8.8")), "pc1", "8.8.8.8", "tcp", 443);
      var tcp = c.tramas.filter(function (t) { return t.protocolo !== "DNS"; });
      comparar("captura: cada segmento TCP viaja por el camino de la red",
        [tcp.length, tcp[0].flags, tcp[0].puertoDestino, /\[SYN\] Seq=1000/.test(tcp[0].info)], [8 * 2, "SYN", 443, true]);
      comparar("captura: la respuesta del servidor va por la vuelta con los puertos invertidos",
        [tcp[2].sentido, tcp[2].puertoOrigen], ["vuelta", 443]);
    })();

    // 36. Un destino mal escrito no es un diagnóstico de red.
    (function () {
      var topo = fabTopo([fabPc("pc-admin", "10.45.7.66", 27, "10.45.7.65")], []);
      var res = ping(crearEstado(topo), "pc-admin", "10.45.7.1000");
      comparar("destino inválido da ENTRADA", res.diagnostico.codigo, "ENTRADA");
      comparar("destino inválido sin pasos", res.pasos.length, 0);
    })();

    return { total: total, pasadas: pasadas, fallos: fallos };
  }

  return {
    crearEstado: crearEstado,
    ping: ping,
    diagnosticar: diagnosticar,
    advertenciasDe: advertenciasDe,
    dhcpSolicitar: dhcpSolicitar,
    avisosDhcp: avisosServidorDhcp,
    esFirewall: esFirewall,
    CAPAS: CAPAS,
    SERVICIOS_CONOCIDOS: SERVICIOS_CONOCIDOS,
    conectar: conectar,
    dominios: dominios,
    esHub: esHub,
    TIPOS_REGISTRO: TIPOS_REGISTRO,
    JERARQUIA_DNS: JERARQUIA,
    consultarDns: consultarDns,
    vaciarCacheDns: vaciarCacheDns,
    // Puertos ("equipo:interfaz") del mismo dominio de difusión que el dado.
    puertosDelSegmento: segmentoL2,
    rutaElegida: rutaElegida,
    tablaArp: tablaArp,
    tablaMac: tablaMac,
    CATALOGO: CATALOGO,
    UMBRAL_WIRELESS: UMBRAL_WIRELESS,
    umbralWireless: UMBRAL_WIRELESS,
    autopruebas: autopruebas
  };
})();
