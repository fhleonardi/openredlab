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

  // Saltos máximos antes de dar por terminado el ping (protección anti-bucles).
  var TTL_INICIAL = 8;

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
        return "El servidor DNS respondió que no conoce \"" + valor(ctx.nombre, "ese nombre") + "\": puede estar mal escrito. " +
          "Los nombres disponibles en el simulador son google.com, www.google.com, dns.google y one.one.one.one.";
      },
      sugerencia: "Revisá cómo escribiste el nombre."
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
        var regla = "una regla que bloquea el tráfico de " + (ctx.reglaOrigen || "?") + " hacia " + (ctx.reglaDestino || "?");
        if (ctx.enLaVuelta) {
          return "El paquete llegó a " + (ctx.destinoNombre || "destino") + ", pero la respuesta (de " +
            (ctx.ipOrigen || "?") + " hacia " + (ctx.ipDestino || "?") + ") pasa por " + (ctx.router || "un router") +
            ", que tiene " + regla + ", y la descarta. Este simulador revisa cada paquete por separado: " +
            "un firewall real recuerda las conexiones y puede dejar pasar la respuesta de una que ya permitió.";
        }
        return (ctx.router || "El router") + " tiene " + regla + ". El paquete de " + (ctx.ipOrigen || "?") +
          " hacia " + (ctx.ipDestino || "?") + " coincide con ella y el router lo descarta: " +
          "la ruta existe, pero una regla prohíbe que pase.";
      },
      sugerencia: "Si ese bloqueo es el que buscabas, el aislamiento funciona. Si no, revisá la pestaña Filtrado del router: las reglas se leen en orden y gana la primera que coincide."
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

  function reglaQueAplica(router, ipOrigen, ipDestino) {
    var reglas = Array.isArray(router.reglas) ? router.reglas : [];
    for (var i = 0; i < reglas.length; i++) {
      var regla = reglas[i];
      var o = regla && parsearCidr(regla.origen);
      var d = regla && parsearCidr(regla.destino);
      if (!o || !d) {
        continue;
      }
      if (Red.mismaRed(ipOrigen, o.red, o.prefijo) && Red.mismaRed(ipDestino, d.red, d.prefijo)) {
        return { indice: i, regla: regla, origen: o.red + "/" + o.prefijo, destino: d.red + "/" + d.prefijo };
      }
    }
    return null;
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
        aprenderMac(estado, dev.id, macOrigen, partes.slice(1).join(":"), registrar);
        if (tocados.indexOf(dev.id) < 0) {
          tocados.push(dev.id);
        }
      }
    }
    return tocados;
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
      if (esConmutador(dev)) {
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

  /* ---------------- Ping: el algoritmo de los once pasos ---------------- */

  function ejecutarPing(estado, idOrigen, destinoIp, opciones) {
    opciones = opciones || {};
    var registrar = opciones.registrar !== false;
    var profundidad = opciones.profundidad || 0;
    function nom(id) { return nombreDe(estado, id); }

    var pasos = [];
    var saltos = [];
    var respuestas = [];
    var contador = 0;

    function agregarPaso(titulo, detalle, ok) {
      contador += 1;
      pasos.push({ n: contador, titulo: titulo, detalle: detalle, ok: !!ok });
    }

    function fallar(codigo, ctx, tituloPaso, detallePaso) {
      if (tituloPaso) {
        agregarPaso(tituloPaso, detallePaso || "", false);
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
      agregarPaso("Buscar el equipo de origen", "No hay ningún equipo con el identificador " + idOrigen + ".", false);
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
        nom(origen.id) + " no tiene interfaces.");
    }
    var ipOrigen = srcIface.ip;
    saltos.push({ dispositivo: origen.id, interfaz: srcIface.id });

    // Paso 1: encendido y habilitada.
    var encendidoOk = !!origen.encendido && !!srcIface.habilitada;
    agregarPaso(
      "Revisar el equipo de origen",
      nom(origen.id) + (origen.encendido ? " está encendido" : " está apagado") + " y su puerto " + srcIface.id +
      (srcIface.habilitada ? " está habilitado." : " está deshabilitado."),
      encendidoOk
    );
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
        "El puerto " + srcIface.id + " de " + nom(origen.id) + " no tiene ningún cable conectado.");
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
          " (alcance máximo: " + estado.umbralWireless + " m).", wlOrigen.enAlcance);
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
      agregarPaso(po.titulo, po.detalle, false);
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
      " hacia " + nom(otraPunta(enlaceUsable, origen.id)) + ".", true);

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
          nom(origen.id) + " está enlazado con " + nom(otroCli.dispositivo) + ", pero ese punto de acceso no está disponible.");
      }
    }

    // Paso 3: IP y máscara del origen.
    if (!ipOrigen || !Red.esIpValida(ipOrigen)) {
      return fallar("D04", { origen: nom(origen.id), interfaz: srcIface.id },
        "Revisar la IP y la máscara",
        "El puerto " + srcIface.id + " de " + nom(origen.id) + " no tiene una IP configurada.");
    }
    if (!prefijoValido(srcIface.prefijo)) {
      return fallar("D05", { origen: nom(origen.id), interfaz: srcIface.id, prefijo: srcIface.prefijo },
        "Revisar la IP y la máscara",
        "La máscara de " + nom(origen.id) + " no es válida (prefijo " + srcIface.prefijo + ").");
    }
    var redOrigen = Red.direccionDeRed(ipOrigen, srcIface.prefijo);
    agregarPaso("Revisar la IP y la máscara",
      nom(origen.id) + " tiene " + ipOrigen + "/" + srcIface.prefijo +
      " (máscara " + Red.prefijoAMascara(srcIface.prefijo) + "): pertenece a la red " + redOrigen + ".", true);

    // La IP de origen no puede ser red ni broadcast (D06).
    if (Red.esDireccionDeRed(ipOrigen, srcIface.prefijo) || Red.esBroadcast(ipOrigen, srcIface.prefijo)) {
      var rolOrigen = Red.esDireccionDeRed(ipOrigen, srcIface.prefijo)
        ? "dirección de red" : "dirección de broadcast";
      agregarPaso("Comprobar que la IP se pueda asignar",
        ipOrigen + " es la " + rolOrigen + " de " + redOrigen + "/" + srcIface.prefijo + ": no puede usarla un equipo.", false);
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
        "La IP " + ipOrigen + " también la tiene " + nom(duplicadoOrigen.dispositivo.id) + ".", false);
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
        destinoIp + " es la dirección de broadcast de " + redOrigen + "/" + srcIface.prefijo + ".", false);
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
          redB15 + "/" + prefD + "): el " + aparato15 + " no puede pasar de una a otra.", false);
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
          ": con máscaras distintas, cada uno calcula una red diferente.", false);
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
    var msTotal = 0;
    var recorrido = [];
    var filtrados = {};

    // Reglas de filtrado de un router que el paquete atraviesa (no las del
    // equipo que lo genera). Cada router se revisa una sola vez por ping.
    function revisarFiltro(router) {
      if (router.id === origen.id || filtrados[router.id] || !Array.isArray(router.reglas) || router.reglas.length === 0) {
        return null;
      }
      filtrados[router.id] = true;
      var nombreRouter = router.nombre || router.id;
      var aplica = reglaQueAplica(router, ipOrigen, destinoIp);
      if (!aplica) {
        agregarPaso("Revisar las reglas de filtrado de " + nombreRouter,
          "Ninguna regla coincide con un paquete de " + ipOrigen + " hacia " + destinoIp + ": pasa.", true);
        return null;
      }
      if (aplica.regla.accion === "permitir") {
        agregarPaso("Revisar las reglas de filtrado de " + nombreRouter,
          "La regla " + (aplica.indice + 1) + " permite el tráfico de " + aplica.origen + " hacia " + aplica.destino + ": pasa.", true);
        return null;
      }
      agregarPaso("Revisar las reglas de filtrado de " + nombreRouter,
        "La regla " + (aplica.indice + 1) + " bloquea el tráfico de " + aplica.origen + " hacia " + aplica.destino +
        ", y el paquete de " + ipOrigen + " hacia " + destinoIp + " coincide: " + nombreRouter + " lo descarta.", false);
      var ctxFiltro = {
        router: nombreRouter, reglaOrigen: aplica.origen, reglaDestino: aplica.destino,
        ipOrigen: ipOrigen, ipDestino: destinoIp
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
          ", que es una dirección privada: internet no la enruta.", false);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D11", { router: dispositivo.nombre || dispositivo.id, destino: destinoIp, internet: true }),
          respuestas: []
        };
      }
      agregarPaso("Llegar a internet",
        "El paquete llegó a " + (dispositivo.nombre || dispositivo.id) + ": " + destinoIp + " es una dirección pública y responde. " +
        "(En una red real, el router de salida traduciría la dirección privada del origen por una pública: NAT. El simulador no lo hace.)", true);
      msTotal += 20;
      if (profundidad < 1) {
        var vueltaNube = ejecutarPing(estado, dispositivo.id, ipOrigen, { registrar: false, profundidad: profundidad + 1 });
        if (!vueltaNube.exito) {
          return {
            exito: false,
            pasos: pasos.concat(vueltaNube.pasos.map(function (pv) {
              return { n: pasos.length + pv.n, titulo: "Respuesta: " + pv.titulo, detalle: pv.detalle, ok: pv.ok };
            })),
            saltos: saltos,
            diagnostico: diagnosticoVuelta(vueltaNube, dispositivo.nombre || dispositivo.id),
            respuestas: []
          };
        }
      }
      respuestas.push({ ttl: Math.max(1, 64 - (saltos.length - 1)), ms: Math.max(1, Math.round(msTotal)) });
      return { exito: true, pasos: pasos, saltos: saltos, diagnostico: null, respuestas: respuestas };
    }

    while (true) {
      if (ttl <= 0) {
        var textoRecorrido = recorrido.join(" → ");
        return fallar("D23", { saltos: recorrido.length, recorrido: textoRecorrido },
          "Controlar el tiempo de vida (TTL)",
          "El TTL llegó a 0 después de pasar por " + recorrido.length + " routers: " + textoRecorrido + ".");
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
        true);

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
            nom(actualId) + " preguntó quién tiene " + destinoIp + " y respondieron varios equipos.", false);
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
              "El equipo con la IP " + destinoIp + " está fuera del alcance inalámbrico: no puede responder.", false);
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
                : " está apagado."), false);
            return {
              exito: false,
              pasos: pasos,
              saltos: saltos,
              diagnostico: diagnosticoDe("D13", { destino: destinoIp, destinoNombre: nom(apagado.dispositivo.id) }),
              respuestas: []
            };
          }
          agregarPaso("Averiguar la dirección MAC del destino (ARP)",
            nom(actualId) + " preguntó en su red quién tiene " + destinoIp + ", y nadie respondió.", false);
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
        var textoSwitch = nom(actualId) + " averigua la MAC de " + destinoIp + " (ARP) y " + ((conmutadores.length > 0 || hayAp)
          ? (hayAp
            ? "el punto de acceso le hace llegar la trama a " + nombreDestinoFinal + ": se guía por direcciones MAC, no por IP."
            : "el switch reenvía la trama por el puerto donde está " + nombreDestinoFinal + ": un switch se guía por direcciones MAC, no por IP.")
          : "el paquete llega directo a " + nombreDestinoFinal + " por el cable.");
        agregarPaso("Entregar el paquete al destino", textoSwitch, true);
        var enlacesFinal = enlacesDe(estado, actualId, actualIface.id);
        if (enlacesFinal.length > 0) {
          msTotal += (enlacesFinal[0].retardoMs || 0) + 1;
        } else {
          msTotal += 1;
        }
        if (destPar.dispositivo.id !== actualId || destPar.interfaz.id !== actualIface.id) {
          saltos.push({ dispositivo: destPar.dispositivo.id, interfaz: destPar.interfaz.id });
        }

        // Paso 11: la vuelta. Sin camino de retorno, el ping falla aunque la
        // ida haya sido perfecta: ese es el D12.
        if (profundidad < 1) {
          agregarPaso("Comprobar que la respuesta pueda volver",
            nombreDestinoFinal + " le responde a " + ipOrigen + ": la respuesta hace el camino inverso.", true);
          var vuelta = ejecutarPing(estado, destPar.dispositivo.id, actualIp === destinoIp && actualId === origen.id ? ipOrigen : ipOrigen, {
            registrar: false,
            profundidad: profundidad + 1
          });
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
                  ok: p.ok
                };
              })),
              saltos: saltos,
              diagnostico: diagnosticoVuelta(vuelta, destPar.dispositivo.nombre || destPar.dispositivo.id),
              respuestas: []
            };
          }
        }
        respuestas.push({ ttl: Math.max(1, 64 - (saltos.length - 1)), ms: Math.max(1, Math.round(msTotal)) });
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
            nom(actualId) + " no tiene puerta de enlace para salir de su red.", false);
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
          nom(actualId) + " usa la puerta de enlace " + gw + " para salir de su red (" + redA + ").", true);

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
          agregarPaso("Comprobar que la puerta de enlace esté en la red del equipo", detalleGw, false);
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
        agregarPaso("Comprobar que la puerta de enlace esté en la red del equipo", detalleGw, true);

        // Paso 8: ARP al gateway.
        var respGw = respondedoresArp(estado, actualId, actualIface.id, gw);
        if (respGw.length > 1) {
          agregarPaso("Averiguar la dirección MAC de la puerta de enlace (ARP)",
            nom(actualId) + " preguntó quién tiene " + gw + " y respondieron varios equipos.", false);
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
            nom(actualId) + " preguntó en su red quién tiene " + gw + ", y nadie respondió.", false);
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
          " responde con su dirección MAC.", true);
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
            "Quien responde por " + gw + " es " + nom(router.id) + ", que no es un router: no sabe reenviar paquetes a otra red.", false);
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
          "Ninguna ruta de " + nom(router.id) + " cubre a " + destinoIp + ", y no tiene ruta por defecto.", false);
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
      agregarPaso("Buscar ruta en " + nom(router.id), textoRuta, true);
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
            nom(router.id) + ".", false);
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
          nom(router.id) + " está apagado o su puerto de salida está deshabilitado.", false);
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
        agregarPaso("Reenviar el paquete", pe.detalle, false);
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
            nom(router.id) + " pregunta quién tiene " + ruta.siguienteSalto + ", y ningún router responde.", false);
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
      recorrido.push(router.nombre || router.id);
      saltos.push({ dispositivo: router.id, interfaz: egreso.id });
      if (siguienteDispositivo.id !== router.id) {
        saltos.push({ dispositivo: siguienteDispositivo.id, interfaz: siguienteInterfaz.id });
      }
      agregarPaso("Reenviar el paquete",
        nom(router.id) + " lo envía por " + egreso.id +
        (siguienteDispositivo.id !== router.id ? " hacia " + nom(siguienteDispositivo.id) : " a la red del destino") +
        ". El TTL baja de " + ttl + " a " + (ttl - 1) + ": cada router descuenta uno.", true);
      ttl -= 1;
      actualId = siguienteDispositivo.id;
      actualIface = siguienteInterfaz;
      actualIp = siguienteIp;
    }
  }

  /* ---------------- Nombres: una resolución DNS mínima ----------------
   * Si el destino es un nombre, el equipo consulta a su servidor DNS (la
   * consulta es un viaje de ida y vuelta hasta esa IP) y, si el nombre
   * existe, hace el ping a la IP que resultó. */

  var NOMBRES_PUBLICOS = {
    "google.com": "142.250.79.46",
    "www.google.com": "142.250.79.46",
    "dns.google": "8.8.8.8",
    "one.one.one.one": "1.1.1.1"
  };

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
    var nombreOrigen = origen.nombre || origen.id;
    var salida = { dispositivo: origen.id, interfaz: "" };
    var dns = origen.dns ? String(origen.dns).trim() : "";
    var titulo = "Averiguar la IP de " + texto + " (DNS)";
    if (!dns || !Red.esIpValida(dns)) {
      return {
        exito: false,
        pasos: [{ n: 1, titulo: titulo, detalle: nombreOrigen + " no tiene servidor DNS configurado.", ok: false }],
        saltos: [salida], diagnostico: diagnosticoDe("D24", { origen: nombreOrigen, nombre: texto }), respuestas: []
      };
    }
    var consulta = ejecutarPing(estado, idOrigen, dns, { registrar: false, profundidad: 0 });
    if (!consulta.exito) {
      var dc = consulta.diagnostico;
      return {
        exito: false,
        pasos: [{ n: 1, titulo: titulo, detalle: nombreOrigen + " le pregunta al servidor DNS " + dns + " y la consulta no llega" +
          (dc ? ": " + dc.titulo.charAt(0).toLowerCase() + dc.titulo.slice(1) + "." : "."), ok: false }],
        saltos: consulta.saltos,
        diagnostico: diagnosticoDe("D26", { origen: nombreOrigen, nombre: texto, dns: dns, causa: dc ? dc.explicacion : "" }),
        respuestas: []
      };
    }
    var ip = NOMBRES_PUBLICOS[texto];
    if (!ip) {
      return {
        exito: false,
        pasos: [{ n: 1, titulo: titulo, detalle: "El servidor DNS " + dns + " respondió que no conoce " + texto + ".", ok: false }],
        saltos: [salida], diagnostico: diagnosticoDe("D25", { nombre: texto }), respuestas: []
      };
    }
    var res = ejecutarPing(estado, idOrigen, ip, opciones);
    res.pasos = [{ n: 1, titulo: titulo, detalle: "El servidor DNS " + dns + " responde que " + texto + " es " + ip + ".", ok: true }]
      .concat(res.pasos.map(function (pn) { return { n: pn.n + 1, titulo: pn.titulo, detalle: pn.detalle, ok: pn.ok }; }));
    res.nombre = texto;
    res.ipResuelta = ip;
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
    function conInternet(rutasR1, dnsPc) {
      var pcN = fabPc("pc1", "192.168.1.10", 24, "192.168.1.1");
      pcN.dns = dnsPc;
      var nube = {
        id: "nube", tipo: "internet", nombre: "Internet", x: 300, y: 0, encendido: true,
        interfaces: [{ id: "eth0", nombre: "eth0", medio: "ethernet", habilitada: true, modo: "estatico", ip: "200.45.7.1", prefijo: 30, mac: "02:00:00:00:09:01" }],
        gateway: null, dns: null, rutas: [], dhcp: null
      };
      return fabTopo(
        [pcN, fabSwitch("sw1"), nube,
         fabRouter("r1", [{ id: "g0/0", ip: "192.168.1.1", prefijo: 24 }, { id: "g0/1", ip: "200.45.7.2", prefijo: 30 }], rutasR1)],
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
