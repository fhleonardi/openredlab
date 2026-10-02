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

  /* ---------------- Catálogo D01–D17 ----------------
   * Cada entrada tiene título corto, explicación en lenguaje de aula
   * (función que recibe el contexto con las direcciones concretas) y
   * sugerencia de qué revisar, nunca la respuesta directa. */

  var CATALOGO = {
    D01: {
      titulo: "La interfaz está deshabilitada",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La interfaz " + (ctx.interfaz || "?") + " de " + (ctx.origen || "el equipo") +
          " está deshabilitada o el equipo está apagado. Así no puede mandar ni recibir nada.";
      },
      sugerencia: "Revisá que el equipo esté encendido y que la interfaz usada esté habilitada."
    },
    D02: {
      titulo: "El cable está desconectado o el enlace está caído",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La interfaz " + (ctx.interfaz || "?") + " de " + (ctx.origen || "el equipo") +
          " no tiene un enlace activo. Sin enlace no hay ni ARP ni ping que valga.";
      },
      sugerencia: "Revisá el cable, que el enlace esté en estado up y que la otra punta esté encendida."
    },
    D03: {
      titulo: "Los medios no son compatibles",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El enlace " + (ctx.enlace || "?") + " une medios distintos (" +
          (ctx.medioA || "?") + " con " + (ctx.medioB || "?") + "). " +
          "Fibra con ethernet, o wireless con cable, no se entienden.";
      },
      sugerencia: "Revisá que el tipo del enlace coincida con el medio de las dos interfaces."
    },
    D04: {
      titulo: "El equipo no tiene dirección IP",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La interfaz " + (ctx.interfaz || "?") + " de " + (ctx.origen || "el equipo") +
          " no tiene una dirección IP configurada. Sin IP de origen no se puede armar el paquete.";
      },
      sugerencia: "Configurale una IP estática o pedí una por DHCP."
    },
    D05: {
      titulo: "La máscara no es válida",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El prefijo " + (ctx.prefijo !== undefined && ctx.prefijo !== null ? ctx.prefijo : "?") +
          " de " + (ctx.origen || "el equipo") + " no es válido. Sin máscara no se puede calcular la red.";
      },
      sugerencia: "Revisá el prefijo: tiene que ser un número entero entre 0 y 32."
    },
    D06: {
      titulo: "Esa IP es la de red o la de broadcast",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La dirección " + (ctx.ip || "?") + " no se puede usar en un equipo: " +
          "es la " + (ctx.rol || "dirección reservada") + " de " + (ctx.red || "?") +
          "/" + (ctx.prefijo !== undefined ? ctx.prefijo : "?") + ".";
      },
      sugerencia: "Elegí una dirección del rango asignable, entre la primera y la última de la subred."
    },
    D07: {
      titulo: "Hay una IP duplicada en el segmento",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "La dirección " + (ctx.ip || "?") + " está configurada en " +
          (ctx.origen || "este equipo") + " y también en " + (ctx.otro || "otro equipo") +
          " del mismo segmento. El ARP responde dos veces y nada funciona bien.";
      },
      sugerencia: "Buscá qué otro equipo usa esa IP y cambiale la dirección a uno de los dos."
    },
    D08: {
      titulo: "El destino está en otra subred y no hay puerta de enlace",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El destino " + (ctx.destino || "?") + " queda en " + (ctx.redDestino || "otra red") +
          " y " + (ctx.origen || "tu equipo") + " no tiene puerta de enlace configurada. " +
          "Sin gateway sólo llega a su propia subred (" + (ctx.red || "?") + ").";
      },
      sugerencia: "Configurá la puerta de enlace predeterminada del equipo."
    },
    D09: {
      titulo: "La puerta de enlace está fuera de tu subred",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El gateway " + (ctx.gateway || "?") + " no pertenece a " +
          (ctx.red || "?") + "/" + (ctx.prefijo !== undefined ? ctx.prefijo : "?") +
          ". Con esa máscara, " + (ctx.equipo || "tu equipo") + " no puede alcanzarlo.";
      },
      sugerencia: "Revisá la máscara del equipo o la dirección del gateway: uno de los dos está mal."
    },
    D10: {
      titulo: "La puerta de enlace no responde ARP",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El gateway " + (ctx.gateway || "?") + " está configurado y en tu subred, " +
          "pero nadie responde a su ARP. Probablemente esté apagado o desconectado.";
      },
      sugerencia: "Fijate si el router está encendido, con la interfaz habilitada y el cable conectado."
    },
    D11: {
      titulo: "El router no sabe cómo llegar al destino",
      explicacion: function (ctx) {
        ctx = ctx || {};
        if (ctx.internet) {
          return (ctx.destino || "Esa dirección") + " es una dirección privada: internet no la enruta y descarta el paquete. " +
            "El destino tendría que estar dentro de tu red, y algún router no tiene ruta hacia él (o la IP está mal escrita).";
        }
        return "El router " + (ctx.router || "?") + " no tiene una ruta hacia " +
          (ctx.destino || "esa red") + ", ni siquiera una ruta por defecto. El paquete muere ahí.";
      },
      sugerencia: "Revisá la tabla de rutas del router: falta la red destino o la ruta por defecto."
    },
    D12: {
      titulo: "Falta la ruta de vuelta",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var extra = ctx.detalleVuelta ? " (" + ctx.detalleVuelta + ")" : "";
        return "El eco llegó a " + (ctx.destino || "destino") + ", pero la respuesta no encuentra " +
          "cómo volver a " + (ctx.origen || "origen") + extra + ". De ida todo andaba.";
      },
      sugerencia: "Revisá el gateway y las rutas del lado del destino: la vuelta también necesita camino."
    },
    D13: {
      titulo: "El destino está apagado o desconectado",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "Nadie respondió por " + (ctx.destino || "esa IP") + " en el segmento. " +
          "El equipo de destino está apagado, con la interfaz caída o simplemente no existe.";
      },
      sugerencia: "Verificá que el destino esté encendido, con la interfaz habilitada y el cable conectado."
    },
    D14: {
      titulo: "Hay máscaras distintas en el mismo segmento",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "En el mismo cable conviven " + (ctx.ipA || "?") + "/" +
          (ctx.prefijoA !== undefined ? ctx.prefijoA : "?") + " y " + (ctx.ipB || "?") + "/" +
          (ctx.prefijoB !== undefined ? ctx.prefijoB : "?") + ". " +
          "Cada uno calcula su red de forma distinta y se confunden.";
      },
      sugerencia: "Unificá la máscara en todos los equipos del segmento."
    },
    D15: {
      titulo: "Mismo switch, subredes distintas: el switch no enruta",
      tituloAire: "Mismo punto de acceso, subredes distintas: el AP no enruta",
      explicacion: function (ctx) {
        ctx = ctx || {};
        if (ctx.aire) {
          return "Los dos equipos cuelgan del mismo punto de acceso pero están en subredes distintas (" +
            (ctx.redA || "?") + " contra " + (ctx.redB || "?") +
            "). Un AP no enruta: es un puente entre el aire y el cable. Necesitan un router.";
        }
        return (ctx.origen || "Tu equipo") + " (" + (ctx.redA || "?") + ") y " +
          (ctx.destinoNombre || "el destino") + " (" + (ctx.redB || "?") +
          ") están en el mismo switch pero en subredes distintas. " +
          "El switch no mira direcciones IP y no puede pasar de una red a otra.";
      },
      sugerencia: "O ponelos en la misma subred, o pasá por un router que una las dos redes."
    },
    D16: {
      titulo: "DHCP no tiene qué ofrecer",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "No hay servidor DHCP alcanzable en el segmento" +
          (ctx.servidor ? " con direcciones libres (" + ctx.servidor + " agotado)" : "") +
          ". El equipo se autoasigna una 169.254.x.x y queda aislado.";
      },
      sugerencia: "Revisá que el servidor DHCP esté encendido en ese segmento y que su rango tenga libres."
    },
    D17: {
      titulo: "El destino está fuera del alcance inalámbrico",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "Los extremos están a " + (ctx.distancia !== undefined ? ctx.distancia : "?") +
          " unidades y el alcance es " + (ctx.umbral !== undefined ? ctx.umbral : "?") +
          ". Más allá del umbral, el enlace se considera caído.";
      },
      sugerencia: "Acercá los equipos o revisá que el enlace wireless corresponda al alcance del aula."
    },
    D18: {
      titulo: "Los modos de radio no se entienden",
      explicacion: function (ctx) {
        ctx = ctx || {};
        if (ctx.modoA === "cliente" && ctx.modoB === "cliente") {
          return (ctx.nombreA || "Un equipo") + " y " + (ctx.nombreB || "otro equipo") +
            " están los dos en modo cliente. Dos clientes no se asocian entre sí: hace falta un punto de acceso.";
        }
        if (ctx.modoA === "ap" && ctx.modoB === "ap") {
          return (ctx.nombreA || "Un equipo") + " y " + (ctx.nombreB || "otro equipo") +
            " están los dos en modo punto de acceso. Dos AP no se asocian entre sí: un cliente se asocia a un AP.";
        }
        return "El enlace " + (ctx.enlace || "?") + " une modos de radio incompatibles (" +
          (ctx.modoA || "?") + " con " + (ctx.modoB || "?") +
          "). Sólo valen cliente contra ap, o bridge contra bridge.";
      },
      sugerencia: "Un cliente sólo se asocia a un punto de acceso; para unir dos puntos usá modo bridge en ambos."
    },
    D19: {
      titulo: "El cliente no tiene punto de acceso",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return (ctx.origen || "El equipo") + " está en modo cliente pero no está asociado a ningún " +
          "punto de acceso" + (ctx.destino ? " hacia " + ctx.destino : "") +
          ". El AP está apagado, con la interfaz deshabilitada o fuera de alcance.";
      },
      sugerencia: "Revisá que haya un punto de acceso encendido en ese segmento, dentro del alcance, y que el enlace sea cliente contra ap."
    },
    D20: {
      titulo: "Nadie respondió al ARP del destino",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "Nadie respondió al ARP de " + (ctx.destino || "esa IP") + " en tu segmento. " +
          "O no hay ningún equipo con esa dirección, o el que la tiene está apagado o desconectado.";
      },
      sugerencia: "Confirmá que la IP de destino esté bien escrita y que algún equipo del segmento la tenga configurada, encendido y conectado."
    },
    D21: {
      titulo: "El destino es la dirección de broadcast",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return (ctx.destino || "Esa IP") + " es la dirección de broadcast de " +
          (ctx.red || "?") + "/" + (ctx.prefijo || "?") + ", no la de un equipo. " +
          "Este simulador no simula el ping a broadcast.";
      },
      sugerencia: "Pingueá la IP de un equipo concreto de la subred."
    },
    D22: {
      titulo: "El siguiente salto no es alcanzable",
      explicacion: function (ctx) {
        ctx = ctx || {};
        var inicio = (ctx.router || "El router") + " tiene una ruta hacia " + (ctx.red || "esa red") +
          " por " + (ctx.siguienteSalto || "?") + ", pero ";
        if (ctx.motivo === "sin-respuesta") {
          return inicio + "ningún router responde en esa dirección dentro de su segmento.";
        }
        return inicio + "esa dirección no pertenece a ninguna de sus redes conectadas.";
      },
      sugerencia: "Revisá el siguiente salto de esa ruta: tiene que ser la IP de un router vecino, en una red que este router tenga conectada."
    },
    D24: {
      titulo: "No hay servidor DNS configurado",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return (ctx.origen || "El equipo") + " no tiene servidor DNS configurado: no tiene a quién preguntarle qué IP corresponde a " +
          (ctx.nombre || "ese nombre") + ". Sin esa respuesta no puede armar el paquete.";
      },
      sugerencia: "Cargá un servidor DNS en la configuración del equipo (por ejemplo 8.8.8.8), o hacé el ping directamente a la IP."
    },
    D25: {
      titulo: "El nombre no existe",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El DNS respondió, pero no conoce " + (ctx.nombre || "ese nombre") + ". Puede estar mal escrito. " +
          "Este simulador conoce google.com, www.google.com, dns.google y one.one.one.one.";
      },
      sugerencia: "Revisá cómo escribiste el nombre."
    },
    D26: {
      titulo: "El servidor DNS no responde",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "Para traducir " + (ctx.nombre || "el nombre") + ", " + (ctx.origen || "el equipo") + " consulta al DNS " +
          (ctx.dns || "?") + ", pero esa consulta no llega" + (ctx.causa ? ": " + ctx.causa : "") + ".";
      },
      sugerencia: "Hacé ping a la IP del DNS para ver dónde se corta: el problema está en el camino hasta el DNS, no en el nombre."
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
      titulo: "Se agotó el TTL: bucle de enrutamiento",
      explicacion: function (ctx) {
        ctx = ctx || {};
        return "El paquete dio " + (ctx.saltos || "?") + " saltos sin llegar. Recorrido: " +
          (ctx.recorrido || "?") + "… Probablemente haya un bucle de enrutamiento entre esos routers.";
      },
      sugerencia: "Seguí la ruta hacia el destino en la tabla de cada router del recorrido: alguno devuelve el paquete hacia atrás."
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
    return {
      codigo: codigo,
      titulo: (ctx && ctx.aire && entrada.tituloAire) || entrada.titulo,
      explicacion: explicacion,
      sugerencia: entrada.sugerencia
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
    var visitados = {};
    var inicio = clavePuerto(idDispositivo, idInterfaz);
    visitados[inicio] = true;
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
        visitados[claveOtra] = true;
        var devVecino = buscarDispositivo(estado, otro.dispositivo);
        // Si el vecino es un conmutador encendido, el broadcast inunda todos
        // sus puertos: se agregan los equipos del otro lado de cada puerto.
        if (esConmutador(devVecino) && devVecino.encendido) {
          for (var i = 0; i < devVecino.interfaces.length; i++) {
            var puerto = devVecino.interfaces[i];
            var clavePuertoSw = clavePuerto(devVecino.id, puerto.id);
            if (!visitados[clavePuertoSw]) {
              visitados[clavePuertoSw] = true;
              cola.push(clavePuertoSw);
            }
          }
        } else {
          cola.push(claveOtra);
        }
      }
    }
    return Object.keys(visitados);
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
          explicacion: "\"" + String(destinoIp) + "\" no es una dirección IPv4: son cuatro números de 0 a 255 separados por puntos.",
          sugerencia: "Revisá lo que escribiste en el campo de destino."
        },
        respuestas: []
      };
    }

    var origen = buscarDispositivo(estado, idOrigen);
    if (!origen) {
      agregarPaso("Buscar el equipo de origen", "No existe ningún dispositivo con id " + idOrigen + ".", false);
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
      return fallar("D01", { origen: origen.id, interfaz: "?" },
        "Verificar que el origen esté encendido y su interfaz habilitada",
        origen.id + " no tiene interfaces.");
    }
    var ipOrigen = srcIface.ip;
    saltos.push({ dispositivo: origen.id, interfaz: srcIface.id });

    // Paso 1: encendido y habilitada.
    var encendidoOk = !!origen.encendido && !!srcIface.habilitada;
    agregarPaso(
      "Verificar que el origen esté encendido y su interfaz habilitada",
      origen.id + " encendido: " + (origen.encendido ? "sí" : "no") + ". " +
      "Interfaz " + srcIface.id + " habilitada: " + (srcIface.habilitada ? "sí" : "no") + ".",
      encendidoOk
    );
    if (!encendidoOk) {
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D01", { origen: origen.id, interfaz: srcIface.id }),
        respuestas: []
      };
    }

    // Paso 2: enlaces, medios, modos de radio y alcance wireless. Un puerto
    // en modo ap puede sostener varios enlaces (uno por cliente): alcanza con
    // que uno deje pasar la trama.
    var enlacesOrigen = enlacesDe(estado, origen.id, srcIface.id);
    if (enlacesOrigen.length === 0) {
      return fallar("D02", { origen: origen.id, interfaz: srcIface.id },
        "Verificar el enlace de la interfaz",
        "La interfaz " + srcIface.id + " de " + origen.id + " no está conectada a ningún enlace.");
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
            ctx: { enlace: candOrigen.id, medioA: compatOrigen.medioA, medioB: compatOrigen.medioB },
            titulo: "Verificar el enlace y los medios",
            detalle: "Enlace " + candOrigen.id + " tipo " + candOrigen.tipo +
              " entre medios " + compatOrigen.medioA + " y " + compatOrigen.medioB + "."
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
            titulo: "Verificar los modos de radio",
            detalle: "El enlace " + candOrigen.id + " une modos incompatibles (" +
              modosOrigen.mio + " con " + modosOrigen.ajeno + ")."
          };
        }
        continue;
      }
      var wlOrigen = chequeoWireless(estado, candOrigen);
      if (wlOrigen.aplica) {
        agregarPaso("Verificar el alcance inalámbrico",
          "Enlace " + candOrigen.id + ". Distancia actual: " + wlOrigen.distancia +
          " unidades. Alcance máximo: " + estado.umbralWireless + " unidades.", wlOrigen.enAlcance);
        if (!wlOrigen.enAlcance) {
          if (!problemaOrigen) {
            problemaOrigen = {
              codigo: "D17",
              ctx: { distancia: wlOrigen.distancia, umbral: estado.umbralWireless },
              titulo: "Verificar el alcance inalámbrico",
              detalle: "El enlace " + candOrigen.id + " quedó fuera de alcance."
            };
          }
          continue;
        }
      }
      if (candOrigen.estado !== "up") {
        if (!problemaOrigen) {
          problemaOrigen = {
            codigo: "D02",
            ctx: { origen: origen.id, interfaz: srcIface.id },
            titulo: "Verificar el enlace de la interfaz",
            detalle: "El enlace " + candOrigen.id + " está en estado down."
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
        ctx: { origen: origen.id, interfaz: srcIface.id },
        titulo: "Verificar el enlace de la interfaz",
        detalle: "Ningún enlace de " + srcIface.id + " deja pasar la trama."
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
    agregarPaso("Verificar el enlace de la interfaz",
      "Enlace " + enlaceUsable.id + " (" + enlaceUsable.tipo + ") en up, medios " +
      srcIface.medio +
      (srcIface.medio === "wireless" ? ", modo " + modoRadioDe(origen, srcIface) : "") + ".", true);

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
        return fallar("D19", { origen: origen.nombre || origen.id, destino: destinoIp },
          "Verificar la asociación al punto de acceso",
          "El enlace " + enlaceUsable.id + " está activo pero del otro lado no hay un punto de acceso usable.");
      }
    }

    // Paso 3: IP y máscara del origen.
    if (!ipOrigen || !Red.esIpValida(ipOrigen)) {
      return fallar("D04", { origen: origen.id, interfaz: srcIface.id },
        "Verificar IP y máscara del origen",
        "La interfaz " + srcIface.id + " no tiene una IP válida configurada.");
    }
    if (!prefijoValido(srcIface.prefijo)) {
      return fallar("D05", { origen: origen.id, interfaz: srcIface.id, prefijo: srcIface.prefijo },
        "Verificar IP y máscara del origen",
        "El prefijo de " + srcIface.id + " no es válido.");
    }
    var redOrigen = Red.direccionDeRed(ipOrigen, srcIface.prefijo);
    agregarPaso("Verificar IP y máscara del origen",
      origen.id + " usa " + ipOrigen + "/" + srcIface.prefijo +
      " (" + Red.prefijoAMascara(srcIface.prefijo) + "). Red: " + redOrigen + ".", true);

    // La IP de origen no puede ser red ni broadcast (D06).
    if (Red.esDireccionDeRed(ipOrigen, srcIface.prefijo) || Red.esBroadcast(ipOrigen, srcIface.prefijo)) {
      var rolOrigen = Red.esDireccionDeRed(ipOrigen, srcIface.prefijo)
        ? "dirección de red" : "dirección de broadcast";
      agregarPaso("Verificar que la IP sea asignable",
        ipOrigen + " es la " + rolOrigen + " de " + redOrigen + "/" + srcIface.prefijo + ".", false);
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
      agregarPaso("Verificar que la IP no esté duplicada",
        ipOrigen + " también está en " + duplicadoOrigen.dispositivo.id + ".", false);
      return {
        exito: false,
        pasos: pasos,
        saltos: saltos,
        diagnostico: diagnosticoDe("D07", {
          ip: ipOrigen, origen: origen.id, otro: duplicadoOrigen.dispositivo.id
        }),
        respuestas: []
      };
    }

    // D21: el broadcast de la propia subred no es un equipo.
    if (Red.esBroadcast(destinoIp, srcIface.prefijo) && Red.mismaRed(ipOrigen, destinoIp, srcIface.prefijo)) {
      agregarPaso("Verificar la dirección de destino",
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
        agregarPaso("Comparar subredes dentro del segmento",
          (aire15 ? "Mismo punto de acceso pero " : "Mismo switch pero ") +
          redA15 + "/" + srcIface.prefijo + " contra " +
          redB15 + "/" + prefD +
          (aire15 ? ". El AP no mira direcciones IP." : ". El switch no mira direcciones IP."), false);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D15", {
            origen: origen.id,
            destinoNombre: parDestinoMismoSegmento.dispositivo.id,
            redA: redA15 + "/" + srcIface.prefijo,
            redB: redB15 + "/" + prefD,
            aire: aire15
          }),
          respuestas: []
        };
      }
      if (srcIface.prefijo !== prefD || mismaConMia !== mismaConSuya) {
        agregarPaso("Comparar máscaras dentro del segmento",
          ipOrigen + "/" + srcIface.prefijo + " contra " + destinoIp + "/" + prefD +
          ": cada uno calcula su red de forma distinta.", false);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D14", {
            ipA: ipOrigen, prefijoA: srcIface.prefijo,
            ipB: destinoIp, prefijoB: prefD
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
        origen: origen.id,
        destino: nombreDestino,
        detalleVuelta: "la vuelta falla con " + (vuelta.diagnostico ? vuelta.diagnostico.codigo : "?")
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
        "El paquete llegó a " + (dispositivo.nombre || dispositivo.id) + ", que representa internet: " + destinoIp +
        " es una dirección pública y responde. Simplificación: no se simula NAT; la respuesta vuelve por el mismo enlace.", true);
      msTotal += 20;
      if (profundidad < 1) {
        var vueltaNube = ejecutarPing(estado, dispositivo.id, ipOrigen, { registrar: false, profundidad: profundidad + 1 });
        if (!vueltaNube.exito) {
          return {
            exito: false,
            pasos: pasos.concat(vueltaNube.pasos.map(function (pv) {
              return { n: pasos.length + pv.n, titulo: "Vuelta: " + pv.titulo, detalle: pv.detalle, ok: pv.ok };
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
          "Controlar el TTL",
          "El TTL llegó a 0 después de " + recorrido.length + " saltos: " + textoRecorrido + ".");
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
      var detalleAnd = "Origen: " + actualIp + "/" + actualIface.prefijo + " AND máscara = " + redA + "\n" +
        "Destino: " + destinoIp + " AND máscara de origen = " + redD + "\n" +
        "IP origen:      " + (andOrigen ? andOrigen.binarioIp : "?") + "\n" +
        "Máscara:        " + (andOrigen ? andOrigen.binarioMascara : "?") + "\n" +
        "Resultado:      " + (andOrigen ? andOrigen.binarioResultado : "?");
      var misma = redA !== null && redA === redD;
      agregarPaso("Comparar redes de origen y destino (" + actualId + ")",
        detalleAnd + "\n" + (misma ? "Misma red: entrega directa." : "Distinta red: hay que usar la puerta de enlace."),
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
          agregarPaso("Resolver el destino por ARP",
            "El ARP por " + destinoIp + " recibió respuestas de varios equipos.", false);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D07", {
              ip: destinoIp, origen: actualId, otro: respond[1].dispositivo.id
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
                fueraAlcance = { distancia: wlDu.distancia, umbral: estado.umbralWireless };
                break;
              }
            }
            if (fueraAlcance) {
              break;
            }
          }
          if (fueraAlcance) {
            agregarPaso("Resolver el destino por ARP",
              "Se preguntó por " + destinoIp + " pero su enlace inalámbrico quedó fuera de alcance.", false);
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
            agregarPaso("Resolver el destino por ARP",
              "Se preguntó por " + destinoIp + " y nadie respondió: " + apagado.dispositivo.id +
              (apagado.dispositivo.encendido
                ? " tiene la interfaz " + apagado.interfaz.id + " deshabilitada."
                : " está apagado."), false);
            return {
              exito: false,
              pasos: pasos,
              saltos: saltos,
              diagnostico: diagnosticoDe("D13", { destino: destinoIp }),
              respuestas: []
            };
          }
          agregarPaso("Resolver el destino por ARP",
            "Se preguntó por " + destinoIp + " en el segmento y nadie respondió.", false);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D20", { destino: destinoIp }),
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
        var textoSwitch = (conmutadores.length > 0 || hayAp)
          ? (hayAp
            ? "El punto de acceso no mira direcciones IP: aprendió la MAC de origen y " +
              "reenvía por la MAC de destino (o inunda la celda si no la conoce)."
            : "El switch no mira direcciones IP: aprendió la MAC de origen en el puerto de entrada y " +
              "reenvía por la MAC de destino (o inunda si no la conoce).")
          : "Entrega directa en el mismo enlace: el ARP resolvió " + destinoIp + ".";
        agregarPaso("Entrega directa por ARP", textoSwitch, true);
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
          agregarPaso("Verificar que el destino pueda responder",
            "Se repite el camino en sentido inverso, de " + destPar.dispositivo.id +
            " hacia " + ipOrigen + ".", true);
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
                  titulo: "Vuelta: " + p.titulo,
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
          agregarPaso("Verificar puerta de enlace configurada",
            actualId + " quiere llegar a " + redD + " pero no tiene puerta de enlace.", false);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D08", {
              origen: actualId, destino: destinoIp, red: redA, redDestino: redD
            }),
            respuestas: []
          };
        }
        agregarPaso("Verificar puerta de enlace configurada",
          actualId + " usa el gateway " + gw + " para salir de " + redA + ".", true);

        // Paso 7: el gateway tiene que pertenecer a la red del que envía.
        var redGw = Red.direccionDeRed(gw, actualIface.prefijo);
        var andGw = Red.and(gw, actualIface.prefijo);
        var detalleGw = "Gateway: " + gw + " AND máscara de origen = " + redGw + "\n" +
          "Red de origen: " + redA + "\n" +
          (andGw ? "Gateway binario:  " + andGw.binarioIp + "\nMáscara binaria:  " +
            andGw.binarioMascara + "\nResultado:      " + andGw.binarioResultado : "");
        if (redGw !== redA) {
          agregarPaso("Verificar que el gateway pertenezca a la subred", detalleGw, false);
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
        agregarPaso("Verificar que el gateway pertenezca a la subred", detalleGw, true);

        // Paso 8: ARP al gateway.
        var respGw = respondedoresArp(estado, actualId, actualIface.id, gw);
        if (respGw.length > 1) {
          agregarPaso("Resolver el gateway por ARP",
            "El ARP por " + gw + " recibió varias respuestas.", false);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D07", { ip: gw, origen: actualId, otro: respGw[1].dispositivo.id }),
            respuestas: []
          };
        }
        if (respGw.length === 0) {
          agregarPaso("Resolver el gateway por ARP",
            "Se preguntó por " + gw + " y nadie respondió.", false);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D10", { gateway: gw }),
            respuestas: []
          };
        }
        agregarArp(estado, actualId, gw, respGw[0].interfaz.mac, registrar);
        agregarPaso("Resolver el gateway por ARP",
          "El gateway " + gw + " respondió con su MAC.", true);
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
          agregarPaso("Llegar al gateway",
            "El equipo " + router.id + " respondió el ARP del gateway pero no es un router: " +
            "no sabe reenviar a otra red.", false);
          return {
            exito: false,
            pasos: pasos,
            saltos: saltos,
            diagnostico: diagnosticoDe("D11", { router: router.id, destino: destinoIp }),
            respuestas: []
          };
        }
      }

      // Paso 9: ruta más específica en el router.
      var ruta = rutaElegida(estado, router.id, destinoIp);
      if (!ruta) {
        agregarPaso("Buscar ruta en " + router.id,
          "Ninguna entrada cubre a " + destinoIp + " y no hay ruta por defecto.", false);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D11", { router: router.id, destino: destinoIp }),
          respuestas: []
        };
      }
      var textoRuta = ruta.directa
        ? "Red directamente conectada " + ruta.destino + "/" + ruta.prefijo + " por " + ruta.interfaz + "."
        : "Ruta " + ruta.destino + "/" + ruta.prefijo + " vía " +
          (ruta.siguienteSalto || "directa") + " (prefijo más largo).";
      agregarPaso("Buscar ruta en " + router.id, textoRuta, true);
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
          agregarPaso("Avanzar al siguiente salto",
            "La ruta vía " + ruta.siguienteSalto + " no se alcanza desde ninguna interfaz de " +
            router.id + ".", false);
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
        agregarPaso("Avanzar al siguiente salto",
          "La interfaz de salida de " + router.id + " está deshabilitada o apagada.", false);
        return {
          exito: false,
          pasos: pasos,
          saltos: saltos,
          diagnostico: diagnosticoDe("D01", { origen: router.id, interfaz: egreso ? egreso.id : "?" }),
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
              ctx: { enlace: candEg.id, medioA: compatEg.medioA, medioB: compatEg.medioB },
              detalle: "El enlace " + candEg.id + " une medios distintos (" +
                compatEg.medioA + " con " + compatEg.medioB + ")."
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
              detalle: "El enlace " + candEg.id + " une modos incompatibles (" +
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
              ctx: { distancia: wlEgreso.distancia, umbral: estado.umbralWireless },
              detalle: "El tramo wireless de " + router.id + " está fuera de alcance (" +
                wlEgreso.distancia + " > " + estado.umbralWireless + ")."
            };
          }
          continue;
        }
        if (candEg.estado !== "up") {
          if (!problemaEgreso) {
            problemaEgreso = {
              codigo: "D02",
              ctx: { origen: router.id, interfaz: egreso.id },
              detalle: "El enlace " + candEg.id + " de " + router.id + ":" + egreso.id + " está caído."
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
          ctx: { origen: router.id, interfaz: egreso.id },
          detalle: "El enlace de " + router.id + ":" + egreso.id + " está caído."
        };
        agregarPaso("Avanzar al siguiente salto", pe.detalle, false);
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
          agregarPaso("Resolver el siguiente salto",
            "No se pudo resolver un router vecino único para " + ruta.siguienteSalto + ".", false);
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
      agregarPaso("Avanzar al siguiente salto (TTL " + ttl + ")",
        "El paquete sale por " + router.id + ":" + egreso.id + ". Quedan " + (ttl - 1) +
        " saltos. Se repite desde comparar redes.", true);
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
    var titulo = "Resolver el nombre " + texto;
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
        pasos: [{ n: 1, titulo: titulo, detalle: "Se le pregunta al DNS " + dns + " y la consulta no llega" +
          (dc ? " (" + dc.codigo + " · " + dc.titulo + ")." : "."), ok: false }],
        saltos: consulta.saltos,
        diagnostico: diagnosticoDe("D26", { origen: nombreOrigen, nombre: texto, dns: dns, causa: dc ? dc.codigo + ", " + dc.titulo.toLowerCase() : "" }),
        respuestas: []
      };
    }
    var ip = NOMBRES_PUBLICOS[texto];
    if (!ip) {
      return {
        exito: false,
        pasos: [{ n: 1, titulo: titulo, detalle: "El DNS " + dns + " respondió que no conoce " + texto + ".", ok: false }],
        saltos: [salida], diagnostico: diagnosticoDe("D25", { nombre: texto }), respuestas: []
      };
    }
    var res = ejecutarPing(estado, idOrigen, ip, opciones);
    res.pasos = [{ n: 1, titulo: titulo, detalle: "El DNS " + dns + " respondió: " + texto + " es " + ip + ".", ok: true }]
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
          agregar("D07", { ip: iface.ip, origen: dev.id, otro: pares[j].dispositivo.id });
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
            origen: dev.id,
            destinoNombre: par.dispositivo.id,
            redA: red + "/" + iface.prefijo,
            redB: redPar + "/" + par.interfaz.prefijo,
            aire: iface.medio === "wireless" || par.interfaz.medio === "wireless"
          });
        } else if (iface.prefijo !== par.interfaz.prefijo || mismaMia !== mismaSuya) {
          agregar("D14", {
            ipA: iface.ip, prefijoA: iface.prefijo,
            ipB: par.interfaz.ip, prefijoB: par.interfaz.prefijo
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
        diagnostico: diagnosticoDe("D01", { origen: idDispositivo, interfaz: idInterfaz })
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
        diagnostico: diagnosticoDe("D01", { origen: idDispositivo, interfaz: idInterfaz })
      };
    }
    if (!cliente.encendido || !iface.habilitada) {
      return {
        exito: false,
        mensajes: [],
        ip: null,
        prefijo: null,
        gateway: null,
        diagnostico: diagnosticoDe("D01", { origen: idDispositivo, interfaz: idInterfaz })
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
        diagnostico: diagnosticoDe("D02", { origen: idDispositivo, interfaz: idInterfaz })
      };
    }

    // Servidores DHCP alcanzables en el mismo segmento.
    var candidatos = [];
    var claves = segmentoL2(estado, idDispositivo, idInterfaz);
    for (var i = 0; i < claves.length; i++) {
      var partes = claves[i].split(":");
      var dev = buscarDispositivo(estado, partes[0]);
      if (esRouter(dev) && dev.encendido && dev.dhcp && dev.dhcp.habilitado) {
        if (candidatos.indexOf(dev) < 0) {
          candidatos.push(dev);
        }
      }
    }
    var mensajes = [{ tipo: "discover", origen: idDispositivo, destino: "broadcast" }];
    if (candidatos.length === 0) {
      var apipa = apipaPara(idDispositivo, idInterfaz);
      iface.ip = apipa;
      iface.prefijo = 16;
      iface.modo = "dhcp";
      cliente.gateway = null;
      return {
        exito: false,
        mensajes: mensajes,
        ip: apipa,
        prefijo: 16,
        gateway: null,
        diagnostico: diagnosticoDe("D16", {})
      };
    }
    var servidor = candidatos[0];
    var cfg = servidor.dhcp;
    var desdeNum = ipANumeroSeguro(cfg.desde);
    var hastaNum = ipANumeroSeguro(cfg.hasta);
    if (desdeNum === null || hastaNum === null || desdeNum > hastaNum ||
        !prefijoValido(cfg.prefijo)) {
      var apipaMala = apipaPara(idDispositivo, idInterfaz);
      iface.ip = apipaMala;
      iface.prefijo = 16;
      iface.modo = "dhcp";
      cliente.gateway = null;
      return {
        exito: false,
        mensajes: mensajes,
        ip: apipaMala,
        prefijo: 16,
        gateway: null,
        diagnostico: diagnosticoDe("D16", { servidor: servidor.id })
      };
    }
    if (!estado.concesiones[servidor.id]) {
      estado.concesiones[servidor.id] = {};
    }
    var concesiones = estado.concesiones[servidor.id];
    // Marcar como ocupadas las IP estáticas del segmento que caigan en el rango.
    function ocupada(ipTexto) {
      if (concesiones[ipTexto]) {
        var c = concesiones[ipTexto];
        if (c.cliente === idDispositivo && c.interfaz === idInterfaz) {
          return false;
        }
        return true;
      }
      var duenos = configuradosConIp(estado, ipTexto);
      for (var d = 0; d < duenos.length; d++) {
        if (duenos[d].dispositivo.id === idDispositivo && duenos[d].interfaz.id === idInterfaz) {
          continue;
        }
        return true;
      }
      return false;
    }
    var elegida = null;
    for (var n = desdeNum; n <= hastaNum; n++) {
      var textoIp = numeroAIpSeguro(n);
      if (!ocupada(textoIp)) {
        elegida = textoIp;
        break;
      }
    }
    if (!elegida) {
      var apipaLlena = apipaPara(idDispositivo, idInterfaz);
      iface.ip = apipaLlena;
      iface.prefijo = 16;
      iface.modo = "dhcp";
      cliente.gateway = null;
      return {
        exito: false,
        mensajes: mensajes,
        ip: apipaLlena,
        prefijo: 16,
        gateway: null,
        diagnostico: diagnosticoDe("D16", { servidor: servidor.id })
      };
    }
    mensajes.push({ tipo: "offer", origen: servidor.id, destino: idDispositivo });
    mensajes.push({ tipo: "request", origen: idDispositivo, destino: servidor.id });
    mensajes.push({ tipo: "ack", origen: servidor.id, destino: idDispositivo });
    concesiones[elegida] = { cliente: idDispositivo, interfaz: idInterfaz, mac: iface.mac };
    iface.ip = elegida;
    iface.prefijo = cfg.prefijo;
    iface.modo = "dhcp";
    cliente.gateway = cfg.gateway || null;
    return {
      exito: true,
      mensajes: mensajes,
      ip: elegida,
      prefijo: cfg.prefijo,
      gateway: cfg.gateway || null,
      diagnostico: null
    };
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
        res.diagnostico && res.diagnostico.titulo.indexOf("el AP no enruta") >= 0, true);
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
      comparar("D09 nombra al equipo", res.diagnostico && res.diagnostico.explicacion.indexOf("PC-Aula no puede alcanzarlo") >= 0, true);
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
    rutaElegida: rutaElegida,
    tablaArp: tablaArp,
    tablaMac: tablaMac,
    CATALOGO: CATALOGO,
    UMBRAL_WIRELESS: UMBRAL_WIRELESS,
    umbralWireless: UMBRAL_WIRELESS,
    autopruebas: autopruebas
  };
})();
