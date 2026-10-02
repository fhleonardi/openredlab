/* capa3-escenarios.js — Capa 3: persistencia, ejemplos y verificación.
 *
 * Objeto global `Escenarios` con las firmas del §5 del BASE.
 * JavaScript vanilla, sin DOM, sin dependencias. Usa los objetos globales
 * `Red` (capa 1) y `Motor` (capa 2): acá no se recalcula nada de
 * direccionamiento ni se diagnostica nada a mano.
 *
 * Decisiones:
 * - `validarTopologia` devuelve todos los errores juntos, no sólo el primero,
 *   y cada mensaje nombra el id o campo problemático para que el docente
 *   pueda corregirlo a mano en el JSON.
 * - El juego de interfaces de cada dispositivo se valida contra la tabla
 *   del §4 del BASE de forma exacta (mismos ids y mismos medios): el
 *   hardware es fijo, como en un equipo real.
 * - `aplicarFallas` nunca muta el original: trabaja sobre una copia profunda.
 * - `exportarParaAlumno` aplica las fallas y elimina la clave `fallas`, de
 *   modo que el archivo del alumno es una red que simplemente viene mal
 *   configurada, sin nada que espiar.
 * - `verificarDesafio` lee los `requerimientos` del escenario (también
 *   acepta `sectores`) y deriva la subred de cada sector de las IP y
 *   máscaras que el alumno configuró en los equipos: verifica la respuesta
 *   del alumno, no lo que declara el enunciado.
 */

var Escenarios = (function () {
  "use strict";

  /* ---------------- Tablas fijas ---------------- */

  // Versiones de topología soportadas por esta capa.
  var VERSIONES_SOPORTADAS = [1];

  // Tipos de dispositivo reconocidos (§4 del BASE, más el punto de acceso).
  var TIPOS_VALIDOS = ["pc", "switch-l2", "router", "camara", "iot", "ap", "internet"];

  // Medios y tipos de enlace reconocidos.
  var MEDIOS_VALIDOS = ["ethernet", "fibra", "wireless"];

  // Juego de interfaces esperado por tipo: ids y medios exactos.
  var INTERFACES_ESPERADAS = {
    pc: [
      { id: "eth0", medio: "ethernet" },
      { id: "wlan0", medio: "wireless" }
    ],
    camara: [
      { id: "eth0", medio: "ethernet" },
      { id: "wlan0", medio: "wireless" }
    ],
    iot: [
      { id: "wlan0", medio: "wireless" }
    ],
    router: [
      { id: "g0/0", medio: "ethernet" },
      { id: "g0/1", medio: "ethernet" },
      { id: "fib0", medio: "fibra" },
      { id: "wlan0", medio: "wireless" }
    ],
    "switch-l2": [
      { id: "fa0/1", medio: "ethernet" },
      { id: "fa0/2", medio: "ethernet" },
      { id: "fa0/3", medio: "ethernet" },
      { id: "fa0/4", medio: "ethernet" },
      { id: "fa0/5", medio: "ethernet" },
      { id: "fa0/6", medio: "ethernet" },
      { id: "fa0/7", medio: "ethernet" },
      { id: "fa0/8", medio: "ethernet" },
      { id: "fib0", medio: "fibra" }
    ],
    // Internet: una nube con un solo puerto hacia el router o firewall de salida.
    internet: [
      { id: "eth0", medio: "ethernet" }
    ],
    // Punto de acceso: bridge de capa 2 entre el aire y el cable.
    ap: [
      { id: "wlan0", medio: "wireless" },
      { id: "eth0", medio: "ethernet" }
    ]
  };

  // Modelos de router. El estándar es el de la tabla del §4; el de 8
  // puertos replica un equipo de oficina (por ejemplo, un MikroTik): cada
  // puerto es una interfaz ruteada que puede tener su propia subred.
  var MODELOS_ROUTER = {
    "8-puertos": [
      { id: "ether1", medio: "ethernet" },
      { id: "ether2", medio: "ethernet" },
      { id: "ether3", medio: "ethernet" },
      { id: "ether4", medio: "ethernet" },
      { id: "ether5", medio: "ethernet" },
      { id: "ether6", medio: "ethernet" },
      { id: "ether7", medio: "ethernet" },
      { id: "ether8", medio: "ethernet" },
      { id: "sfp1", medio: "fibra" },
      { id: "wlan1", medio: "wireless" }
    ]
  };

  function interfacesEsperadas(dispositivo) {
    if (dispositivo.tipo === "router" && dispositivo.modelo && MODELOS_ROUTER[dispositivo.modelo]) {
      return MODELOS_ROUTER[dispositivo.modelo];
    }
    return INTERFACES_ESPERADAS[dispositivo.tipo] || [];
  }

  // Modo de radio efectivo de una interfaz wireless. Si no está declarado se
  // usa el valor inicial por tipo (ap en puntos de acceso y routers, cliente
  // en el resto), igual que hace el Motor.
  function modoEfectivo(topologia, idDispositivo, idInterfaz) {
    var dev = buscarDispositivo(topologia, idDispositivo);
    var iface = buscarInterfaz(dev, idInterfaz);
    if (!iface || iface.medio !== "wireless") {
      return null;
    }
    if (iface.modoRadio === "ap" || iface.modoRadio === "cliente" || iface.modoRadio === "bridge") {
      return iface.modoRadio;
    }
    if (dev && (dev.tipo === "ap" || dev.tipo === "router")) {
      return "ap";
    }
    return "cliente";
  }

  /* ---------------- Utilidades internas ---------------- */

  // Copia profunda por JSON: las topologías son sólo datos, sin funciones.
  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  var PALABRA_MEDIO = { ethernet: "de cobre", fibra: "de fibra", wireless: "inalámbrico" };

  function palabraMedio(medio) {
    return PALABRA_MEDIO[medio] || String(medio);
  }

  function esEnteroPrefijo(valor) {
    return typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 32;
  }

  function textoNoVacio(valor) {
    return typeof valor === "string" && valor.trim() !== "";
  }

  function buscarDispositivo(topologia, idDispositivo) {
    if (!topologia || !topologia.dispositivos) {
      return null;
    }
    for (var i = 0; i < topologia.dispositivos.length; i++) {
      if (topologia.dispositivos[i].id === idDispositivo) {
        return topologia.dispositivos[i];
      }
    }
    return null;
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

  function buscarEnlace(topologia, idEnlace) {
    if (!topologia || !topologia.enlaces) {
      return null;
    }
    for (var i = 0; i < topologia.enlaces.length; i++) {
      if (topologia.enlaces[i].id === idEnlace) {
        return topologia.enlaces[i];
      }
    }
    return null;
  }

  // Primera interfaz con IP válida: primero entre las habilitadas, si no
  // entre todas. Sirve para saber con qué dirección se presenta un equipo.
  function primeraIpDe(dispositivo) {
    if (!dispositivo || !dispositivo.interfaces) {
      return null;
    }
    var i;
    for (i = 0; i < dispositivo.interfaces.length; i++) {
      var a = dispositivo.interfaces[i];
      if (a.habilitada && textoNoVacio(a.ip) && Red.esIpValida(a.ip)) {
        return { interfaz: a, ip: a.ip.trim(), prefijo: a.prefijo };
      }
    }
    for (i = 0; i < dispositivo.interfaces.length; i++) {
      var b = dispositivo.interfaces[i];
      if (textoNoVacio(b.ip) && Red.esIpValida(b.ip)) {
        return { interfaz: b, ip: b.ip.trim(), prefijo: b.prefijo };
      }
    }
    return null;
  }

  /* ---------------- Validación e importación ---------------- */

  function validarTopologia(obj) {
    var errores = [];

    function anotar(campo, mensaje) {
      errores.push({ campo: campo, mensaje: mensaje });
    }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      anotar("topologia", "El archivo no tiene el formato de una red del simulador.");
      return { ok: false, errores: errores };
    }

    // Versión presente y soportada.
    if (obj.version === undefined || obj.version === null) {
      anotar("version", "El archivo no indica su versión: puede no ser un archivo del simulador.");
    } else if (VERSIONES_SOPORTADAS.indexOf(obj.version) < 0) {
      anotar("version", "El archivo es de una versión del simulador que esta no reconoce (versión " + JSON.stringify(obj.version) + ").");
    }

    // Sin mutar el objeto recibido: se trabaja sobre listas locales.
    var listaDispositivos = Array.isArray(obj.dispositivos) ? obj.dispositivos : null;
    var listaEnlaces = Array.isArray(obj.enlaces) ? obj.enlaces : null;
    if (!listaDispositivos) {
      anotar("dispositivos", "El archivo no trae la lista de equipos.");
      listaDispositivos = [];
    }
    if (!listaEnlaces) {
      anotar("enlaces", "El archivo no trae la lista de cables.");
      listaEnlaces = [];
    }

    // Ids de dispositivo únicos en toda la topología.
    var vistosDisp = {};
    var i;
    for (i = 0; i < listaDispositivos.length; i++) {
      var dev = listaDispositivos[i];
      var idDev = dev && dev.id;
      if (!textoNoVacio(idDev)) {
        anotar("dispositivos[" + i + "].id", "Hay un equipo sin identificador.");
        continue;
      }
      if (vistosDisp[idDev]) {
        anotar("dispositivos", "Hay dos equipos con el mismo identificador (\"" + idDev + "\").");
      } else {
        vistosDisp[idDev] = true;
      }
    }

    // Por dispositivo: tipo, interfaces, IPs y prefijos.
    for (i = 0; i < listaDispositivos.length; i++) {
      var d = listaDispositivos[i];
      if (!d || !textoNoVacio(d.id)) {
        continue;
      }
      var etiqueta = "dispositivos." + d.id;

      if (TIPOS_VALIDOS.indexOf(d.tipo) < 0) {
        anotar(etiqueta + ".tipo", "El equipo \"" + d.id + "\" es de un tipo que el simulador no conoce (" + JSON.stringify(d.tipo) + "). " +
          "Los tipos válidos son PC, router, switch, cámara, IoT, punto de acceso e internet.");
        continue;
      }
      if (typeof d.encendido !== "boolean") {
        anotar(etiqueta + ".encendido", "El equipo \"" + d.id + "\" no indica bien si está encendido (va true o false).");
      }
      if (typeof d.x !== "number" || !isFinite(d.x) || typeof d.y !== "number" || !isFinite(d.y)) {
        anotar(etiqueta, "El equipo \"" + d.id + "\" no tiene una posición válida en el lienzo (x e y tienen que ser números).");
      }

      if (!Array.isArray(d.interfaces)) {
        anotar(etiqueta + ".interfaces", "El equipo \"" + d.id + "\" no trae sus puertos.");
        continue;
      }

      // Ids de interfaz únicos dentro del dispositivo.
      var vistasIf = {};
      var j;
      for (j = 0; j < d.interfaces.length; j++) {
        var iface = d.interfaces[j];
        var idIf = iface && iface.id;
        if (!textoNoVacio(idIf)) {
          anotar(etiqueta + ".interfaces[" + j + "].id", "Un puerto del equipo \"" + d.id + "\" no tiene nombre.");
          continue;
        }
        if (vistasIf[idIf]) {
          anotar(etiqueta + ".interfaces", "El equipo \"" + d.id + "\" tiene dos puertos llamados \"" + idIf + "\".");
        } else {
          vistasIf[idIf] = true;
        }
      }

      // Juego de interfaces coherente con la tabla del §4 del BASE.
      if (d.modelo !== undefined && d.modelo !== null) {
        if (d.tipo !== "router") {
          anotar(etiqueta + ".modelo", "Solo los routers tienen modelo, y \"" + d.id + "\" es " + d.tipo + ".");
        } else if (!MODELOS_ROUTER[d.modelo]) {
          anotar(etiqueta + ".modelo", "El router \"" + d.id + "\" tiene un modelo que no existe: puede ser el estándar (sin modelo) o \"8-puertos\".");
        }
      }
      var esperadas = interfacesEsperadas(d);
      var nombresEsperados = esperadas.map(function (e) { return e.id; }).join(", ");
      if (d.interfaces.length !== esperadas.length) {
        anotar(etiqueta + ".interfaces", "El equipo \"" + d.id + "\" (" + d.tipo + ") no tiene los puertos esperados: " + nombresEsperados + ".");
      } else {
        for (j = 0; j < esperadas.length; j++) {
          var esp = esperadas[j];
          var real = buscarInterfaz(d, esp.id);
          if (!real) {
            anotar(etiqueta + ".interfaces", "Al equipo \"" + d.id + "\" le falta el puerto " + esp.id + " (tendría que tener " + nombresEsperados + ").");
          } else if (real.medio !== esp.medio) {
            anotar(etiqueta + ".interfaces." + esp.id, "El puerto " + esp.id + " del equipo \"" + d.id + "\" tendría que ser " + palabraMedio(esp.medio) + ".");
          }
        }
      }

      // IPs, prefijos y máscaras de cada interfaz.
      for (j = 0; j < d.interfaces.length; j++) {
        var f = d.interfaces[j];
        if (!f || !textoNoVacio(f.id)) {
          continue;
        }
        var campoBase = etiqueta + ".interfaces." + f.id;
        if (typeof f.habilitada !== "boolean") {
          anotar(campoBase + ".habilitada", "El puerto " + f.id + " del equipo \"" + d.id + "\" no indica bien si está habilitado (va true o false).");
        }
        if (f.ip !== undefined && f.ip !== null && String(f.ip).trim() !== "") {
          if (!Red.esIpValida(String(f.ip))) {
            anotar(campoBase + ".ip", "El puerto " + f.id + " del equipo \"" + d.id + "\" tiene una IP que no es válida (" + JSON.stringify(f.ip) + ").");
          }
        }
        if (!esEnteroPrefijo(f.prefijo)) {
          anotar(campoBase + ".prefijo", "El puerto " + f.id + " del equipo \"" + d.id + "\" tiene un prefijo inválido: tiene que ser un número entre 0 y 32.");
        } else {
          var mascaraDerivada = Red.prefijoAMascara(f.prefijo);
          if (mascaraDerivada === null || !Red.esMascaraValida(mascaraDerivada)) {
            anotar(campoBase + ".prefijo", "El puerto " + f.id + " del equipo \"" + d.id + "\" tiene una máscara inválida (prefijo " + f.prefijo + ").");
          }
        }
        if (f.mascara !== undefined && f.mascara !== null && String(f.mascara).trim() !== "") {
          if (!Red.esMascaraValida(String(f.mascara))) {
            anotar(campoBase + ".mascara", "El puerto " + f.id + " del equipo \"" + d.id + "\" tiene una máscara inválida: los unos no son contiguos.");
          }
        }
        if (f.medio !== undefined && MEDIOS_VALIDOS.indexOf(f.medio) < 0) {
          anotar(campoBase + ".medio", "El puerto " + f.id + " del equipo \"" + d.id + "\" es de un medio que no existe (" + JSON.stringify(f.medio) + "): puede ser ethernet, fibra o wireless.");
        }
        // El modo de radio sólo existe en interfaces wireless.
        if (f.modoRadio !== undefined && f.modoRadio !== null && String(f.modoRadio).trim() !== "") {
          if (f.medio !== "wireless") {
            anotar(campoBase + ".modoRadio", "El modo de radio solo se usa en puertos inalámbricos, y " + f.id + " del equipo \"" + d.id + "\" es " + palabraMedio(f.medio) + ".");
          } else if (["ap", "cliente", "bridge"].indexOf(f.modoRadio) < 0) {
            anotar(campoBase + ".modoRadio", "El puerto " + f.id + " del equipo \"" + d.id + "\" tiene un modo de radio que no existe: puede ser ap, cliente o bridge.");
          }
        }
      }

      // Puerta de enlace y DNS, cuando están presentes.
      if (d.gateway !== undefined && d.gateway !== null && String(d.gateway).trim() !== "") {
        if (!Red.esIpValida(String(d.gateway))) {
          anotar(etiqueta + ".gateway", "La puerta de enlace del equipo \"" + d.id + "\" no es una IP válida (" + JSON.stringify(d.gateway) + ").");
        }
      }
      if (d.dns !== undefined && d.dns !== null && String(d.dns).trim() !== "") {
        if (!Red.esIpValida(String(d.dns))) {
          anotar(etiqueta + ".dns", "El servidor DNS del equipo \"" + d.id + "\" no es una IP válida (" + JSON.stringify(d.dns) + ").");
        }
      }

      // Rutas de los routers.
      if (d.rutas !== undefined && d.rutas !== null) {
        if (!Array.isArray(d.rutas)) {
          anotar(etiqueta + ".rutas", "La tabla de rutas del router \"" + d.id + "\" no tiene el formato correcto (tiene que ser una lista).");
        } else {
          for (var r = 0; r < d.rutas.length; r++) {
            var ruta = d.rutas[r];
            var campoRuta = etiqueta + ".rutas[" + r + "]";
            if (!ruta || !Red.esIpValida(String(ruta.destino || ""))) {
              anotar(campoRuta, "Una ruta del router \"" + d.id + "\" tiene un destino que no es una IP válida.");
            }
            if (!ruta || !esEnteroPrefijo(ruta.prefijo)) {
              anotar(campoRuta, "Una ruta del router \"" + d.id + "\" tiene un prefijo inválido: tiene que ser un número entre 0 y 32.");
            }
            if (ruta && ruta.siguienteSalto !== undefined && ruta.siguienteSalto !== null && String(ruta.siguienteSalto).trim() !== "") {
              if (!Red.esIpValida(String(ruta.siguienteSalto))) {
                anotar(campoRuta, "Una ruta del router \"" + d.id + "\" tiene un siguiente salto que no es una IP válida (" + JSON.stringify(ruta.siguienteSalto) + ").");
              }
            }
          }
        }
      }

      // Reglas de filtrado de los routers: acción y dos redes en formato CIDR.
      if (d.reglas !== undefined && d.reglas !== null) {
        if (!Array.isArray(d.reglas)) {
          anotar(etiqueta + ".reglas", "Las reglas de filtrado del router \"" + d.id + "\" no tienen el formato correcto (tiene que ser una lista).");
        } else {
          if (d.reglas.length > 0 && d.tipo !== "router") {
            anotar(etiqueta + ".reglas", "Solo los routers tienen reglas de filtrado, y \"" + d.id + "\" es " + d.tipo + ".");
          }
          for (var g = 0; g < d.reglas.length; g++) {
            var regla = d.reglas[g];
            var campoRegla = etiqueta + ".reglas[" + g + "]";
            if (!regla || (regla.accion !== "bloquear" && regla.accion !== "permitir")) {
              anotar(campoRegla, "La regla " + (g + 1) + " de \"" + d.id + "\" tiene que decir si bloquea o permite.");
            }
            if (!regla || typeof regla.origen !== "string" || !parsearBloque(regla.origen)) {
              anotar(campoRegla, "La regla " + (g + 1) + " de \"" + d.id + "\" tiene un origen inválido: va una red como 10.45.7.0/26 (0.0.0.0/0 es cualquiera).");
            }
            if (!regla || typeof regla.destino !== "string" || !parsearBloque(regla.destino)) {
              anotar(campoRegla, "La regla " + (g + 1) + " de \"" + d.id + "\" tiene un destino inválido: va una red como 10.45.7.0/24 (0.0.0.0/0 es cualquiera).");
            }
          }
        }
      }

      // Servidor DHCP, cuando está configurado.
      if (d.dhcp !== undefined && d.dhcp !== null) {
        var cfg = d.dhcp;
        if (cfg.habilitado) {
          if (!Red.esIpValida(String(cfg.desde || "")) || !Red.esIpValida(String(cfg.hasta || ""))) {
            anotar(etiqueta + ".dhcp", "El rango del servidor DHCP de \"" + d.id + "\" no es válido: revisá las direcciones desde y hasta.");
          }
          if (!esEnteroPrefijo(cfg.prefijo)) {
            anotar(etiqueta + ".dhcp", "La máscara del servidor DHCP de \"" + d.id + "\" no es válida.");
          }
        }
      }
    }

    // Enlaces: extremos existentes, modos de radio compatibles, medios
    // compatibles y, salvo en puertos ap, sin reusar interfaces.
    var usoPuertos = {};
    var vistosEnlaces = {};
    for (i = 0; i < listaEnlaces.length; i++) {
      var e = listaEnlaces[i];
      var idE = (e && e.id) || ("enlaces[" + i + "]");
      if (!e || !textoNoVacio(e.id)) {
        anotar("enlaces[" + i + "].id", "Hay un cable sin identificador.");
      } else if (vistosEnlaces[e.id]) {
        anotar("enlaces", "Hay dos cables con el mismo identificador (\"" + e.id + "\").");
      } else {
        vistosEnlaces[e.id] = true;
      }
      if (!e || !e.a || !e.b) {
        anotar("enlaces." + idE, "El cable \"" + idE + "\" no tiene sus dos puntas.");
        continue;
      }
      var devA = buscarDispositivo(obj, e.a.dispositivo);
      var devB = buscarDispositivo(obj, e.b.dispositivo);
      var ifA = devA ? buscarInterfaz(devA, e.a.interfaz) : null;
      var ifB = devB ? buscarInterfaz(devB, e.b.interfaz) : null;
      if (!devA) {
        anotar("enlaces." + idE, "El cable \"" + idE + "\" va a un equipo que no existe (\"" + e.a.dispositivo + "\").");
      } else if (!ifA) {
        anotar("enlaces." + idE, "El cable \"" + idE + "\" va al puerto " + e.a.interfaz + " de \"" + e.a.dispositivo + "\", que no existe.");
      }
      if (!devB) {
        anotar("enlaces." + idE, "El cable \"" + idE + "\" va a un equipo que no existe (\"" + e.b.dispositivo + "\").");
      } else if (!ifB) {
        anotar("enlaces." + idE, "El cable \"" + idE + "\" va al puerto " + e.b.interfaz + " de \"" + e.b.dispositivo + "\", que no existe.");
      }

      // Uso acumulado por puerto: un puerto ap sostiene un enlace por cliente.
      var claves = [];
      if (devA && ifA) {
        claves.push(e.a.dispositivo + ":" + e.a.interfaz);
      }
      if (devB && ifB) {
        claves.push(e.b.dispositivo + ":" + e.b.interfaz);
      }
      for (var k = 0; k < claves.length; k++) {
        if (!usoPuertos[claves[k]]) {
          usoPuertos[claves[k]] = [];
        }
        usoPuertos[claves[k]].push(idE);
      }

      // Medios compatibles con el tipo del enlace.
      if (e.tipo !== undefined && MEDIOS_VALIDOS.indexOf(e.tipo) < 0) {
        anotar("enlaces." + idE, "El cable \"" + idE + "\" es de un tipo que no existe (" + JSON.stringify(e.tipo) + "): puede ser ethernet, fibra o wireless.");
      } else if (ifA && ifB) {
        if (e.tipo !== ifA.medio || e.tipo !== ifB.medio) {
          anotar("enlaces." + idE, (ifA.medio === ifB.medio
            ? "El cable \"" + idE + "\" es " + palabraMedio(e.tipo) + ", pero los dos puertos son " + palabraMedio(ifA.medio) +
              ": el tipo de cable tiene que coincidir con el de los puertos."
            : "El cable \"" + idE + "\" une un puerto " + palabraMedio(ifA.medio) + " con uno " + palabraMedio(ifB.medio) +
              ": cada puerto acepta un solo tipo de cable."));
        } else if (e.tipo === "wireless") {
          // Pares válidos: cliente contra ap, o bridge contra bridge.
          var modoA = modoEfectivo(obj, e.a.dispositivo, e.a.interfaz);
          var modoB = modoEfectivo(obj, e.b.dispositivo, e.b.interfaz);
          var parOk = (modoA === "ap" && modoB === "cliente") ||
            (modoA === "cliente" && modoB === "ap") ||
            (modoA === "bridge" && modoB === "bridge");
          if (!parOk) {
            anotar("enlaces." + idE, "El enlace inalámbrico \"" + idE + "\" une dos equipos en modos que no se entienden (" +
              modoA + " con " + modoB + "): solo funcionan cliente con ap, o bridge con bridge.");
          }
        }
      }
    }

    // Conteo por puerto: cobre y fibra admiten un solo enlace; un puerto
    // wireless en modo ap admite uno por cliente asociado.
    Object.keys(usoPuertos).forEach(function (clave) {
      var ids = usoPuertos[clave];
      if (ids.length < 2) {
        return;
      }
      var partes = clave.split(":");
      var devId = partes[0];
      var ifId = partes.slice(1).join(":");
      var dev = buscarDispositivo(obj, devId);
      var iface = buscarInterfaz(dev, ifId);
      var esAp = iface && iface.medio === "wireless" && modoEfectivo(obj, devId, ifId) === "ap";
      var todosWireless = ids.every(function (idL) {
        var enl = buscarEnlace(obj, idL);
        return enl && enl.tipo === "wireless";
      });
      if (!(esAp && todosWireless)) {
        anotar("enlaces." + ids[1], "El puerto " + clave.split(":").slice(1).join(":") + " de \"" + clave.split(":")[0] + "\" tiene dos cables (\"" + ids[0] + "\" y \"" + ids[1] + "\"): " +
          "un puerto de cobre o de fibra admite uno solo.");
      }
    });

    return { ok: errores.length === 0, errores: errores };
  }

  function exportar(topologia) {
    return JSON.stringify(topologia, null, 2);
  }

  function importar(texto) {
    var parsed = null;
    try {
      parsed = JSON.parse(texto);
    } catch (err) {
      return {
        ok: false,
        topologia: null,
        errores: [{ campo: "json", mensaje: "El archivo no es un JSON válido: " + (err && err.message ? err.message : "sintaxis rota") + "." }]
      };
    }
    var validacion = validarTopologia(parsed);
    if (!validacion.ok) {
      return { ok: false, topologia: null, errores: validacion.errores };
    }
    return { ok: true, topologia: parsed, errores: [] };
  }

  /* ---------------- Modo docente: fallas ---------------- */

  function fallaMascara(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev) {
      return;
    }
    var iface = buscarInterfaz(dev, falla.interfaz);
    if (!iface) {
      return;
    }
    iface.prefijo = falla.prefijo;
  }

  function fallaInterfaz(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev) {
      return;
    }
    var iface = buscarInterfaz(dev, falla.interfaz);
    if (!iface) {
      return;
    }
    iface.habilitada = false;
  }

  function fallaRuta(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev || !Array.isArray(dev.rutas)) {
      return;
    }
    dev.rutas = dev.rutas.filter(function (r) {
      if (!r) {
        return false;
      }
      // Coincidencia exacta, o misma red normalizada con igual prefijo.
      if (r.destino === falla.destino && r.prefijo === falla.prefijo) {
        return false;
      }
      try {
        var redR = Red.direccionDeRed(r.destino, r.prefijo);
        var redF = Red.direccionDeRed(falla.destino, falla.prefijo);
        if (redR !== null && redR === redF && r.prefijo === falla.prefijo) {
          return false;
        }
      } catch (err) {
        // Si Red falla con datos rotos, se conserva la ruta.
      }
      return true;
    });
  }

  function fallaIpDuplicada(copia, falla) {
    var fuente = buscarDispositivo(copia, falla.copiarDe);
    var destino = buscarDispositivo(copia, falla.dispositivo);
    if (!fuente || !destino) {
      return;
    }
    var ipFuente = primeraIpDe(fuente);
    if (!ipFuente) {
      return;
    }
    // Destino: la primera interfaz habilitada con IP, si no la primera con
    // IP, si no la eth0/wlan0 habilitada que corresponda.
    var elegida = null;
    var i;
    for (i = 0; i < destino.interfaces.length; i++) {
      var a = destino.interfaces[i];
      if (a.habilitada && textoNoVacio(a.ip)) {
        elegida = a;
        break;
      }
    }
    if (!elegida) {
      for (i = 0; i < destino.interfaces.length; i++) {
        if (textoNoVacio(destino.interfaces[i].ip)) {
          elegida = destino.interfaces[i];
          break;
        }
      }
    }
    if (!elegida) {
      for (i = 0; i < destino.interfaces.length; i++) {
        if (destino.interfaces[i].habilitada) {
          elegida = destino.interfaces[i];
          break;
        }
      }
    }
    if (!elegida) {
      return;
    }
    elegida.ip = ipFuente.ip;
    elegida.prefijo = ipFuente.prefijo;
  }

  function fallaGateway(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev) {
      return;
    }
    dev.gateway = falla.gateway;
  }

  function fallaEnlace(copia, falla) {
    var e = buscarEnlace(copia, falla.enlace);
    if (!e) {
      return;
    }
    e.estado = "down";
  }

  function aplicarFallas(topologia) {
    var copia = clonar(topologia);
    var fallas = (copia.escenario && copia.escenario.fallas) || [];
    for (var i = 0; i < fallas.length; i++) {
      var f = fallas[i];
      if (!f || !f.tipo) {
        continue;
      }
      if (f.tipo === "mascara-incorrecta") {
        fallaMascara(copia, f);
      } else if (f.tipo === "interfaz-deshabilitada") {
        fallaInterfaz(copia, f);
      } else if (f.tipo === "ruta-faltante") {
        fallaRuta(copia, f);
      } else if (f.tipo === "ip-duplicada") {
        fallaIpDuplicada(copia, f);
      } else if (f.tipo === "gateway-incorrecto") {
        fallaGateway(copia, f);
      } else if (f.tipo === "enlace-caido") {
        fallaEnlace(copia, f);
      }
    }
    return copia;
  }

  // Archivo del alumno: fallas ya aplicadas sobre las configuraciones y sin
  // la clave `fallas`. Conserva sólo los objetivos.
  function exportarParaAlumno(topologia) {
    var copia = aplicarFallas(topologia);
    if (copia.escenario && typeof copia.escenario === "object") {
      copia.escenario = { objetivos: copia.escenario.objetivos || [] };
    }
    return JSON.stringify(copia, null, 2);
  }

  /* ---------------- Objetivos ---------------- */

  function verificarObjetivos(estado, objetivos) {
    if (!Array.isArray(objetivos)) {
      return [];
    }
    var resultados = [];
    for (var i = 0; i < objetivos.length; i++) {
      var obj = objetivos[i];
      if (!obj || obj.tipo !== "ping") {
        resultados.push({ objetivo: obj, cumple: false, codigo: null });
        continue;
      }
      var res = Motor.ping(estado, obj.origen, obj.destino);
      var codigo = res.exito ? null : (res.diagnostico ? res.diagnostico.codigo : null);
      var cumple;
      if (obj.esperado === "falla") {
        // Un objetivo puede exigir la causa: fallar por otra razón no cumple.
        cumple = !res.exito && (!obj.codigo || codigo === obj.codigo);
      } else {
        cumple = !!res.exito;
      }
      resultados.push({
        objetivo: obj, cumple: cumple, codigo: codigo,
        titulo: res.exito || !res.diagnostico ? null : res.diagnostico.titulo
      });
    }
    return resultados;
  }

  /* ---------------- Modo desafío: verificación VLSM ---------------- */

  // Acepta "10.45.7.0/24" o un objeto con red y prefijo en varias formas.
  function parsearBloque(valor) {
    if (typeof valor === "string" && valor.indexOf("/") >= 0) {
      var partes = valor.split("/");
      var red = partes[0].trim();
      var pref = parseInt(partes[1], 10);
      if (Red.esIpValida(red) && esEnteroPrefijo(pref)) {
        return { red: Red.direccionDeRed(red, pref), prefijo: pref };
      }
      return null;
    }
    if (valor && typeof valor === "object") {
      var r = valor.red || valor.subred || valor.direccion || valor.network || valor.bloque || valor.base;
      var p = valor.prefijo;
      if (typeof r === "string" && r.indexOf("/") >= 0) {
        return parsearBloque(r);
      }
      if (typeof r === "string" && esEnteroPrefijo(p) && Red.esIpValida(r)) {
        return { red: Red.direccionDeRed(r, p), prefijo: p };
      }
    }
    return null;
  }

  function normalizarSectores(escenario) {
    if (Array.isArray(escenario)) {
      return escenario;
    }
    if (escenario && Array.isArray(escenario.requerimientos)) {
      return escenario.requerimientos;
    }
    if (escenario && Array.isArray(escenario.sectores)) {
      return escenario.sectores;
    }
    if (escenario && Array.isArray(escenario.sectors)) {
      return escenario.sectors;
    }
    return [];
  }

  function nombreSector(sector, indice) {
    return sector.nombre || sector.sector || ("Sector " + (indice + 1));
  }

  function hostsPedidos(sector) {
    var v = sector.hosts;
    if (v === undefined) {
      v = sector.hostsNecesarios;
    }
    if (v === undefined) {
      v = sector.hostsPedidos;
    }
    if (v === undefined) {
      v = sector.minHosts;
    }
    if (v === undefined) {
      v = sector.cantidadHosts;
    }
    if (v === undefined) {
      v = sector.equiposNecesarios;
    }
    return typeof v === "number" ? v : 0;
  }

  function equiposSector(sector) {
    var v = sector.dispositivos || sector.equipos || sector.ids || sector.equiposIds || sector.hostsLista;
    return Array.isArray(v) ? v : [];
  }

  /* Resuelve una entrada del sector: "pc-admin" (la primera interfaz
   * habilitada con IP) o "r1:g0/0" (esa interfaz). Devuelve la IP y el
   * prefijo que el alumno configuró, o null en ip si no hay dirección. */
  function resolverEntrada(topologia, entrada) {
    var texto = String(entrada);
    var corte = texto.indexOf(":");
    var idDisp = corte >= 0 ? texto.slice(0, corte) : texto;
    var idIf = corte >= 0 ? texto.slice(corte + 1) : null;
    var disp = buscarDispositivo(topologia, idDisp);
    if (!disp) {
      return { etiqueta: texto, error: "El desafío nombra al equipo \"" + idDisp + "\", que no está en la red." };
    }
    var iface = null;
    if (idIf !== null) {
      iface = buscarInterfaz(disp, idIf);
      if (!iface) {
        return { etiqueta: texto, error: "El desafío nombra el puerto " + idIf + " de " + (disp.nombre || disp.id) + ", que no existe." };
      }
    } else {
      var prim = primeraIpDe(disp);
      iface = prim ? prim.interfaz : null;
    }
    var conIp = !!iface && iface.habilitada !== false && textoNoVacio(iface.ip) &&
      Red.esIpValida(iface.ip.trim()) && esEnteroPrefijo(iface.prefijo);
    return {
      etiqueta: (disp.nombre || disp.id) + (idIf !== null ? ", puerto " + idIf : ""),
      dispositivo: disp,
      esInterfazDeclarada: idIf !== null,
      ip: conIp ? iface.ip.trim() : null,
      prefijo: conIp ? iface.prefijo : null
    };
  }

  /* El modo desafío verifica lo que el alumno configuró en los equipos, no
   * lo que declara el escenario: la subred de cada sector se deriva de las
   * IP y máscaras de sus interfaces. El informe dice qué está mal y por qué,
   * nunca cuál sería la dirección correcta. */
  function verificarDesafio(topologia, escenario, opciones) {
    var libre = !!(opciones && opciones.libre);
    var baseCruda = escenario ? (escenario.bloqueBase || escenario.bloque || escenario.base || escenario.redBase || escenario.cidr) : null;
    var base = parsearBloque(baseCruda);
    // Compatibilidad: el escenario puede traer red y prefijo sueltos arriba.
    if (!base && escenario && typeof escenario === "object") {
      base = parsearBloque({ red: escenario.red || escenario.subred, prefijo: escenario.prefijo });
    }
    var lista = normalizarSectores(escenario);
    var infos = [];
    var i;

    function hallazgo(info, nivel, mensaje) {
      info.hallazgos.push({ nivel: nivel, mensaje: mensaje });
    }

    for (i = 0; i < lista.length; i++) {
      var s = lista[i] || {};
      var info = {
        nombre: nombreSector(s, i),
        hosts: hostsPedidos(s),
        miembros: [],
        red: null,
        prefijo: null,
        hallazgos: []
      };
      var entradas = equiposSector(s);
      for (var e = 0; e < entradas.length; e++) {
        var m = resolverEntrada(topologia, entradas[e]);
        if (m.error) {
          hallazgo(info, "error", m.error);
          continue;
        }
        info.miembros.push(m);
      }
      var direccionados = info.miembros.filter(function (x) { return x.ip !== null; });
      if (direccionados.length === 0) {
        hallazgo(info, "error", "Ningún equipo de este sector tiene IP todavía.");
      } else {
        // 0. Un sector direccionado a medias no está resuelto: cada integrante
        // sin IP se nombra. El puerto del router es la puerta de enlace.
        info.miembros.forEach(function (m) {
          if (m.ip !== null) { return; }
          hallazgo(info, "error", m.esInterfazDeclarada && m.dispositivo.tipo === "router"
            ? m.etiqueta + " todavía no tiene IP: es la puerta de enlace del sector, y sin ella nadie sale de su red."
            : m.etiqueta + " todavía no tiene IP.");
        });
        info.red = Red.direccionDeRed(direccionados[0].ip, direccionados[0].prefijo);
        info.prefijo = direccionados[0].prefijo;
        // 1. Todos los equipos del sector en la misma subred.
        for (var k = 1; k < direccionados.length; k++) {
          var otro = direccionados[k];
          var redOtro = Red.direccionDeRed(otro.ip, otro.prefijo);
          if (redOtro !== info.red || otro.prefijo !== info.prefijo) {
            hallazgo(info, "error", "Los equipos del sector no están en la misma subred: " +
              direccionados[0].etiqueta + " está en " + info.red + "/" + info.prefijo + " y " +
              otro.etiqueta + " en " + redOtro + "/" + otro.prefijo + ".");
            break;
          }
        }
      }
      info.direccionados = direccionados;
      infos.push(info);
    }

    var inicioBase = null;
    var finBase = null;
    if (base) {
      inicioBase = Red.aNumero(base.red);
      var bcastBase = Red.broadcast(base.red, base.prefijo);
      finBase = bcastBase === null ? null : Red.aNumero(bcastBase);
    }

    for (i = 0; i < infos.length; i++) {
      var cur = infos[i];
      if (cur.red === null) {
        continue;
      }
      var etiquetaRed = cur.red + "/" + cur.prefijo;

      // 2. La subred cae dentro del bloque base.
      if (!base || inicioBase === null || finBase === null) {
        // En el diseño libre nadie fijó un bloque: no hay contra qué comparar.
        if (!libre) {
          hallazgo(cur, "error", "El desafío no indica el bloque de direcciones a repartir.");
        }
      } else {
        var ini = Red.aNumero(cur.red);
        var fin = Red.aNumero(Red.broadcast(cur.red, cur.prefijo));
        if (ini < inicioBase || fin > finBase) {
          hallazgo(cur, "error", "La subred " + etiquetaRed + " se sale del bloque asignado (" + base.red + "/" + base.prefijo + ").");
        }
      }

      // 3. Alineación. IP AND máscara siempre da una red alineada; lo que
      // revela el error es dónde el alumno hizo arrancar la subred. Por la
      // convención de la cátedra, el gateway (la interfaz del router del
      // sector) es la primera dirección asignable: la subred que el alumno
      // pensó arranca una dirección antes.
      // Si hay varios routers (un enlace entre dos), la referencia es el de
      // IP más baja: es el que ocupa la primera dirección asignable.
      var referencia = null;
      for (var r = 0; r < cur.direccionados.length; r++) {
        var cand = cur.direccionados[r];
        if (cand.esInterfazDeclarada && cand.dispositivo.tipo === "router" &&
            (!referencia || Red.aNumero(cand.ip) < Red.aNumero(referencia.ip))) {
          referencia = cand;
        }
      }
      if (referencia && cur.prefijo < 31) {
        var bloque = Red.tamanoBloque(cur.prefijo);
        var inicioPensado = Red.aNumero(referencia.ip) - 1;
        if (inicioPensado % bloque !== 0) {
          hallazgo(cur, "error", "La subred no está alineada: si la puerta de enlace " + referencia.ip + " (" +
            referencia.etiqueta + ") es la primera dirección asignable, la subred empezaría en " + Red.aTexto(inicioPensado) +
            ", que no es múltiplo de " + bloque + " (el tamaño de un bloque /" + cur.prefijo + ").");
        }
      }

      // 4. El prefijo alcanza para los hosts pedidos.
      var disponibles = Red.cantidadHosts(cur.prefijo);
      if (cur.prefijo === 31) {
        disponibles = 2;
      }
      if (cur.hosts > 0 && disponibles < cur.hosts) {
        hallazgo(cur, "error", "Una /" + cur.prefijo + " alcanza para " + disponibles +
          " equipos, y el sector necesita " + cur.hosts + ".");
      }

      // 5. Ninguna IP configurada es la de red ni la de broadcast.
      for (var d = 0; d < cur.direccionados.length; d++) {
        var md = cur.direccionados[d];
        if (md.prefijo < 31 && !Red.esAsignable(md.ip, md.prefijo)) {
          var rol = Red.esDireccionDeRed(md.ip, md.prefijo) ? "la dirección de red" : "la dirección de broadcast";
          hallazgo(cur, "error", md.etiqueta + " tiene " + md.ip + ", que es " + rol +
            " de su subred: no se puede asignar a un equipo.");
        }
      }
    }

    // 6. Ninguna subred se solapa con la de otro sector.
    for (i = 0; i < infos.length; i++) {
      for (var j = i + 1; j < infos.length; j++) {
        var a = infos[i];
        var b = infos[j];
        if (a.red === null || b.red === null) {
          continue;
        }
        if (Red.solapan(a.red, a.prefijo, b.red, b.prefijo)) {
          hallazgo(a, "error", "Se superpone con la subred de " + b.nombre + ", " + b.red + "/" + b.prefijo + ": comparten direcciones.");
          hallazgo(b, "error", "Se superpone con la subred de " + a.nombre + ", " + a.red + "/" + a.prefijo + ": comparten direcciones.");
        }
      }
    }

    for (i = 0; i < infos.length; i++) {
      var sec = infos[i];
      if (sec.red === null) {
        continue;
      }
      // 7. El gateway de cada equipo pertenece a su subred y, si el sector
      // declaró la interfaz de un router, coincide con su IP.
      var ipsRouter = sec.direccionados.filter(function (x) {
        return x.esInterfazDeclarada && x.dispositivo.tipo === "router";
      }).map(function (x) { return x.ip; });
      for (var q = 0; q < sec.direccionados.length; q++) {
        var eq = sec.direccionados[q];
        var tipo = eq.dispositivo.tipo;
        if (tipo === "router" || tipo === "switch-l2" || tipo === "ap") {
          continue;
        }
        var gw = eq.dispositivo.gateway;
        if (!textoNoVacio(gw)) {
          if (ipsRouter.length > 0) {
            hallazgo(sec, "error", eq.etiqueta + " no tiene puerta de enlace.");
          }
          continue;
        }
        gw = gw.trim();
        if (!Red.esIpValida(gw) || !Red.mismaRed(eq.ip, gw, eq.prefijo)) {
          hallazgo(sec, "error", "La puerta de enlace de " + eq.etiqueta + " (" + gw + ") está fuera de su subred.");
        } else if (ipsRouter.length > 0 && ipsRouter.indexOf(gw) < 0) {
          hallazgo(sec, "error", "La puerta de enlace de " + eq.etiqueta + " (" + gw + ") no es la IP del router de su sector.");
        }
      }

      // 8. Advertencia, no error, si el bloque desperdicia más del 60 %.
      var ofrecidos = sec.prefijo >= 31 ? 2 : Red.cantidadHosts(sec.prefijo);
      if (sec.hosts > 0 && ofrecidos >= sec.hosts && ofrecidos > 0) {
        var desperdicio = (ofrecidos - sec.hosts) / ofrecidos;
        if (desperdicio > 0.6) {
          hallazgo(sec, "advertencia", "La subred es más grande de lo necesario: el sector pide " + sec.hosts +
            " equipos y una /" + sec.prefijo + " tiene " + ofrecidos + " (se desperdicia el " +
            Math.round(desperdicio * 100) + " %).");
        }
      }
    }

    var errores = 0;
    var advertencias = 0;
    var porSector = infos.map(function (inf) {
      var cantErrores = inf.hallazgos.filter(function (h) { return h.nivel === "error"; }).length;
      var cantAvisos = inf.hallazgos.filter(function (h) { return h.nivel !== "error"; }).length;
      errores += cantErrores;
      advertencias += cantAvisos;
      return { sector: inf.nombre, ok: cantErrores === 0, hallazgos: inf.hallazgos };
    });

    return { resumen: { errores: errores, advertencias: advertencias }, porSector: porSector };
  }

  /* ---------------- Diseño libre ----------------
   * Una red armada sin enunciado también se puede verificar: cada dominio de
   * difusión que tiene equipos es un sector. Lo único que no se deduce de la
   * red es cuántos hosts pide cada sector y de qué bloque se reparte; el
   * alumno puede cargarlos en escenario.diseno = { bloqueBase, hosts: {id: n} }. */

  function esConmutadorEsc(d) {
    return !!d && (d.tipo === "switch-l2" || d.tipo === "ap");
  }

  function detectarSectores(topologia) {
    var estado = Motor.crearEstado(topologia);
    var visto = {};
    var sectores = [];
    (topologia.dispositivos || []).forEach(function (dev) {
      if (esConmutadorEsc(dev) || dev.tipo === "internet") { return; }
      (dev.interfaces || []).forEach(function (f) {
        var clave = dev.id + ":" + f.id;
        if (visto[clave] || f.habilitada === false) { return; }
        var conCable = (topologia.enlaces || []).some(function (e) {
          return (e.a.dispositivo === dev.id && e.a.interfaz === f.id) || (e.b.dispositivo === dev.id && e.b.interfaz === f.id);
        });
        if (!conCable) { return; }
        var claves = Motor.puertosDelSegmento(estado, dev.id, f.id);
        claves.forEach(function (k) { visto[k] = true; });
        var miembros = [], routers = [], conmutadores = [], tocaInternet = false;
        claves.forEach(function (k) {
          var corte = k.indexOf(":");
          var d = buscarDispositivo(topologia, k.slice(0, corte));
          if (!d) { return; }
          if (d.tipo === "internet") { tocaInternet = true; return; }
          if (esConmutadorEsc(d)) {
            if (conmutadores.indexOf(d) < 0) { conmutadores.push(d); }
            return;
          }
          miembros.push(k);
          if (d.tipo === "router") { routers.push({ d: d, puerto: k.slice(corte + 1), clave: k }); }
        });
        // El tramo hacia Internet es del proveedor, no del diseño del alumno.
        if (tocaInternet || miembros.length === 0) { return; }
        var nombre;
        if (routers.length >= 2 && routers.length === miembros.length && conmutadores.length === 0) {
          nombre = "Enlace " + routers.map(function (r) { return r.d.nombre || r.d.id; }).join(" — ");
        } else {
          nombre = routers.length
            ? routers.map(function (r) { return (r.d.nombre || r.d.id) + " " + r.puerto; }).join(" / ")
            : "Red de " + (buscarDispositivo(topologia, miembros[0].split(":")[0]).nombre || miembros[0]);
          if (conmutadores.length) { nombre += " · " + (conmutadores[0].nombre || conmutadores[0].id); }
        }
        var id = (routers.length ? routers.map(function (r) { return r.clave; }) : [miembros[0]]).sort().join("+");
        sectores.push({ id: id, sector: nombre, dispositivos: miembros });
      });
    });
    return sectores;
  }

  function verificarDiseno(topologia) {
    var diseno = (topologia.escenario && topologia.escenario.diseno) || {};
    var hosts = diseno.hosts || {};
    var sectores = detectarSectores(topologia);
    var informe = verificarDesafio(topologia, {
      bloqueBase: diseno.bloqueBase || null,
      requerimientos: sectores.map(function (s) {
        return { sector: s.sector, hosts: hosts[s.id] || 0, dispositivos: s.dispositivos };
      })
    }, { libre: true });
    informe.porSector.forEach(function (p, i) {
      p.id = sectores[i].id;
      p.hosts = hosts[sectores[i].id] || null;
    });
    informe.bloqueBase = diseno.bloqueBase || null;
    return informe;
  }

  /* ---------------- Constructores de ejemplos ----------------
   * Se arman con ayudantes para garantizar el juego exacto de interfaces
   * de la tabla del §4 del BASE. Las coordenadas dejan cerca sólo el par
   * inalámbrico (alcance 250); el resto es disposición de aula. */

  function interfaz(id, medio, ip, prefijo, habilitada) {
    return {
      id: id,
      nombre: id,
      medio: medio,
      habilitada: habilitada,
      modo: "estatico",
      ip: ip,
      prefijo: prefijo
    };
  }

  function armarPc(id, nombre, x, y, ipEth, prefEth, gateway) {
    return {
      id: id,
      tipo: "pc",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: [
        interfaz("eth0", "ethernet", ipEth, prefEth, ipEth !== null),
        interfaz("wlan0", "wireless", null, 24, false)
      ],
      gateway: gateway,
      dns: "8.8.8.8",
      rutas: [],
      dhcp: null
    };
  }

  function armarPcWifi(id, nombre, x, y, ipWifi, prefWifi, gateway) {
    return {
      id: id,
      tipo: "pc",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: [
        interfaz("eth0", "ethernet", null, 24, false),
        interfaz("wlan0", "wireless", ipWifi, prefWifi, true)
      ],
      gateway: gateway,
      dns: "8.8.8.8",
      rutas: [],
      dhcp: null
    };
  }

  function armarCamara(id, nombre, x, y, ip, prefijo, gateway) {
    return {
      id: id,
      tipo: "camara",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: [
        interfaz("eth0", "ethernet", ip, prefijo, true),
        interfaz("wlan0", "wireless", null, 24, false)
      ],
      gateway: gateway,
      dns: "8.8.8.8",
      rutas: [],
      dhcp: null
    };
  }

  function armarIot(id, nombre, x, y, ip, prefijo, gateway) {
    return {
      id: id,
      tipo: "iot",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: [
        interfaz("wlan0", "wireless", ip, prefijo, true)
      ],
      gateway: gateway,
      dns: "8.8.8.8",
      rutas: [],
      dhcp: null
    };
  }

  function armarSwitch(id, nombre, x, y) {
    var lista = [];
    for (var i = 1; i <= 8; i++) {
      lista.push(interfaz("fa0/" + i, "ethernet", null, 24, true));
    }
    lista.push(interfaz("fib0", "fibra", null, 24, true));
    return {
      id: id,
      tipo: "switch-l2",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: lista,
      gateway: null,
      dns: null,
      rutas: [],
      dhcp: null
    };
  }

  function armarRouter(id, nombre, x, y, g00, p00, g01, p01, fib, pFib, gateway, rutas) {
    return {
      id: id,
      tipo: "router",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: [
        interfaz("g0/0", "ethernet", g00, p00, g00 !== null),
        interfaz("g0/1", "ethernet", g01, p01, g01 !== null),
        interfaz("fib0", "fibra", fib, pFib, fib !== null),
        interfaz("wlan0", "wireless", null, 24, false)
      ],
      gateway: gateway,
      dns: null,
      rutas: rutas || [],
      dhcp: null
    };
  }

  function armarAp(id, nombre, x, y) {
    var celda = interfaz("wlan0", "wireless", null, 24, true);
    celda.modoRadio = "ap";
    return {
      id: id,
      tipo: "ap",
      nombre: nombre,
      x: x,
      y: y,
      encendido: true,
      interfaces: [
        celda,
        interfaz("eth0", "ethernet", null, 24, true)
      ],
      gateway: null,
      dns: null,
      rutas: [],
      dhcp: null
    };
  }

  function armarEnlace(id, aDev, aIf, bDev, bIf, tipo, extra) {
    extra = extra || {};
    return {
      id: id,
      a: { dispositivo: aDev, interfaz: aIf },
      b: { dispositivo: bDev, interfaz: bIf },
      tipo: tipo,
      estado: "up",
      velocidadMbps: extra.velocidadMbps !== undefined
        ? extra.velocidadMbps
        : (tipo === "fibra" ? 1000 : 100),
      retardoMs: extra.retardoMs !== undefined ? extra.retardoMs : 1
    };
  }

  function topologiaBasica() {
    return {
      version: 1,
      nombre: "Básica: dos PC y un switch",
      dispositivos: [
        armarPc("pc1", "PC-1", 120, 200, "192.168.1.10", 24, null),
        armarPc("pc2", "PC-2", 120, 340, "192.168.1.20", 24, null),
        armarSwitch("sw1", "SW1", 340, 270)
      ],
      enlaces: [
        armarEnlace("l1", "pc1", "eth0", "sw1", "fa0/1", "ethernet"),
        armarEnlace("l2", "pc2", "eth0", "sw1", "fa0/2", "ethernet")
      ],
      escenario: null
    };
  }

  function topologiaDosSubredes() {
    return {
      version: 1,
      nombre: "Dos subredes y un router",
      dispositivos: [
        armarPc("pc1", "PC-1", 100, 140, "192.168.1.10", 25, "192.168.1.1"),
        armarPc("pc2", "PC-2", 100, 280, "192.168.1.20", 25, "192.168.1.1"),
        armarSwitch("sw1", "SW1", 280, 210),
        armarRouter("r1", "R1", 470, 210, "192.168.1.1", 25, "192.168.1.129", 25, null, 24, null, []),
        armarSwitch("sw2", "SW2", 660, 210),
        armarPc("pc3", "PC-3", 840, 140, "192.168.1.140", 25, "192.168.1.129"),
        armarPc("pc4", "PC-4", 840, 280, "192.168.1.150", 25, "192.168.1.129")
      ],
      enlaces: [
        armarEnlace("l1", "pc1", "eth0", "sw1", "fa0/1", "ethernet"),
        armarEnlace("l2", "pc2", "eth0", "sw1", "fa0/2", "ethernet"),
        armarEnlace("l3", "r1", "g0/0", "sw1", "fa0/3", "ethernet"),
        armarEnlace("l4", "r1", "g0/1", "sw2", "fa0/1", "ethernet"),
        armarEnlace("l5", "pc3", "eth0", "sw2", "fa0/2", "ethernet"),
        armarEnlace("l6", "pc4", "eth0", "sw2", "fa0/3", "ethernet")
      ],
      escenario: null
    };
  }

  function topologiaComplejo() {
    // Coordenadas por franjas: Wi-Fi arriba (y 80), routers y fibra (y 250),
    // Administración y cámaras en el medio (y 430), AP y servidor abajo
    // (y 610). En una misma franja nadie queda a menos de 180 px.
    // Router inalámbrico: r1 sostiene la celda Wi-Fi de huéspedes (10.45.7.0/26).
    var r1 = armarRouter("r1", "R1", 290, 250, "10.45.7.65", 27, "10.45.7.97", 28, "10.45.7.129", 30, null,
      [{ destino: "10.45.7.120", prefijo: 29, siguienteSalto: "10.45.7.130" }]);
    r1.interfaces[3].modoRadio = "ap";
    r1.interfaces[3].habilitada = true;
    r1.interfaces[3].ip = "10.45.7.1";
    r1.interfaces[3].prefijo = 26;
    var pcWifi = armarPcWifi("pc-wifi", "PC-Huéspedes", 170, 80, "10.45.7.10", 26, "10.45.7.1");
    pcWifi.interfaces[1].modoRadio = "cliente";
    var iot1 = armarIot("iot1", "IOT-Huéspedes", 410, 80, "10.45.7.20", 26, "10.45.7.1");
    iot1.interfaces[0].modoRadio = "cliente";
    // Punto de acceso: extiende al aire la subred de Administración (/27),
    // no crea una subred nueva.
    var apAdmin = armarAp("ap-admin", "AP-Admin", 230, 610);
    var wifiMovil = interfaz("wlan0", "wireless", "10.45.7.67", 27, true);
    wifiMovil.modoRadio = "cliente";
    var pcMovil = {
      id: "pc-movil",
      tipo: "pc",
      nombre: "Notebook-Admin",
      x: 50,
      y: 610,
      encendido: true,
      interfaces: [
        interfaz("eth0", "ethernet", null, 24, false),
        wifiMovil
      ],
      gateway: "10.45.7.65",
      dns: "8.8.8.8",
      rutas: [],
      dhcp: null
    };
    var r2 = armarRouter("r2", "R2", 800, 250, "10.45.7.121", 29, null, 24, "10.45.7.130", 30, null,
      [
        { destino: "10.45.7.0", prefijo: 26, siguienteSalto: "10.45.7.129" },
        { destino: "10.45.7.64", prefijo: 27, siguienteSalto: "10.45.7.129" },
        { destino: "10.45.7.96", prefijo: 28, siguienteSalto: "10.45.7.129" }
      ]);
    var lWifiPc = armarEnlace("l-wifi-pc", "r1", "wlan0", "pc-wifi", "wlan0", "wireless",
      { velocidadMbps: 54, retardoMs: 3 });
    var lWifiIot = armarEnlace("l-wifi-iot", "r1", "wlan0", "iot1", "wlan0", "wireless",
      { velocidadMbps: 54, retardoMs: 3 });
    var lApNb = armarEnlace("l-ap-nb", "ap-admin", "wlan0", "pc-movil", "wlan0", "wireless",
      { velocidadMbps: 54, retardoMs: 3 });
    return {
      version: 1,
      nombre: "Complejo turístico con cinco sectores",
      dispositivos: [
        pcWifi,
        iot1,
        armarPc("pc-admin", "PC-Admin", 50, 430, "10.45.7.66", 27, "10.45.7.65"),
        armarSwitch("sw-admin", "SW-Admin", 230, 430),
        // Los routers no llevan gateway: cada uno reenvía por su propia tabla
        // de rutas, y así una ruta faltante se nota (D11 o D12).
        r1,
        armarCamara("cam1", "CAM-Entrada", 620, 430, "10.45.7.100", 28, "10.45.7.97"),
        armarSwitch("sw-cam", "SW-Cámaras", 430, 430),
        r2,
        armarSwitch("sw-srv", "SW-Servidores", 800, 430),
        armarPc("srv1", "Servidor", 800, 610, "10.45.7.122", 29, "10.45.7.121"),
        apAdmin,
        pcMovil
      ],
      enlaces: [
        lWifiPc,
        lWifiIot,
        armarEnlace("l-admin-pc", "pc-admin", "eth0", "sw-admin", "fa0/1", "ethernet"),
        armarEnlace("l-admin-r1", "r1", "g0/0", "sw-admin", "fa0/2", "ethernet"),
        armarEnlace("l-cam-pc", "cam1", "eth0", "sw-cam", "fa0/1", "ethernet"),
        armarEnlace("l-cam-r1", "r1", "g0/1", "sw-cam", "fa0/2", "ethernet"),
        armarEnlace("l-srv-pc", "srv1", "eth0", "sw-srv", "fa0/1", "ethernet"),
        armarEnlace("l-srv-r2", "r2", "g0/0", "sw-srv", "fa0/2", "ethernet"),
        armarEnlace("l-r1-r2", "r1", "fib0", "r2", "fib0", "fibra"),
        armarEnlace("l-ap-sw", "ap-admin", "eth0", "sw-admin", "fa0/3", "ethernet"),
        lApNb
      ],
      escenario: null
    };
  }

  function topologiaComplejoRoto() {
    var base = topologiaComplejo();
    base.nombre = "Complejo turístico roto (plantilla docente)";
    base.escenario = {
      modo: "docente",
      fallas: [
        { tipo: "gateway-incorrecto", dispositivo: "pc-admin", gateway: "10.45.7.200" },
        { tipo: "ruta-faltante", dispositivo: "r1", destino: "10.45.7.120", prefijo: 29 },
        { tipo: "enlace-caido", enlace: "l-srv-r2" }
      ],
      objetivos: [
        { tipo: "ping", origen: "pc-admin", destino: "10.45.7.122", esperado: "exito" },
        // Antes esperaba "falla" porque el gateway 10.45.7.1 no existía; con
        // la celda en r1 el camino anda y el laboratorio roto lo rompe igual
        // (falta la ruta en r1), así que el objetivo es que ande al reparar.
        { tipo: "ping", origen: "iot1", destino: "10.45.7.122", esperado: "exito" }
      ]
    };
    return base;
  }

  // El complejo sin direccionar: el alumno configura IP, máscaras, gateways
  // y rutas, y el modo desafío verifica su diseño VLSM.
  function topologiaDesafioComplejo() {
    var base = topologiaComplejo();
    base.nombre = "Desafío VLSM — Complejo turístico";
    base.dispositivos.forEach(function (d) {
      d.gateway = null;
      d.rutas = [];
      d.dhcp = null;
      d.interfaces.forEach(function (f) {
        f.ip = null;
        f.prefijo = 24;
      });
    });
    base.escenario = {
      modo: "desafio",
      bloqueBase: "10.45.7.0/24",
      requerimientos: [
        { sector: "Wi-Fi de huéspedes", hosts: 60, dispositivos: ["pc-wifi", "iot1", "r1:wlan0"] },
        { sector: "Administración", hosts: 25, dispositivos: ["pc-admin", "r1:g0/0"] },
        { sector: "Cámaras (CCTV)", hosts: 12, dispositivos: ["cam1", "r1:g0/1"] },
        { sector: "Servidores", hosts: 3, dispositivos: ["srv1", "r2:g0/0"] },
        { sector: "Enlace R1 — R2", hosts: 2, dispositivos: ["r1:fib0", "r2:fib0"] }
      ]
    };
    return base;
  }

  function topologiaRouter8() {
    var ifs = ["ether1", "ether2", "ether3", "ether4", "ether5", "ether6", "ether7", "ether8"].map(function (id) {
      return interfaz(id, "ethernet", null, 24, true);
    });
    ifs.push(interfaz("sfp1", "fibra", null, 24, true));
    var wlan = interfaz("wlan1", "wireless", null, 24, false);
    wlan.modoRadio = "ap";
    ifs.push(wlan);
    ifs[1].ip = "192.168.10.1";
    ifs[2].ip = "192.168.20.1";
    ifs[3].ip = "192.168.30.1";
    var router = {
      id: "r1", tipo: "router", modelo: "8-puertos", nombre: "R-Oficina",
      x: 400, y: 120, encendido: true, interfaces: ifs,
      gateway: null, dns: null, rutas: [], dhcp: null
    };
    return {
      version: 1,
      nombre: "Router de 8 puertos",
      dispositivos: [
        router,
        armarPc("pc-adm", "PC-Administración", 130, 330, "192.168.10.10", 24, "192.168.10.1"),
        armarPc("pc-ven", "PC-Ventas", 330, 330, "192.168.20.10", 24, "192.168.20.1"),
        armarSwitch("sw-aula", "SW-Aula", 590, 330),
        armarPc("pc-a1", "PC-Aula1", 500, 510, "192.168.30.11", 24, "192.168.30.1"),
        armarPc("pc-a2", "PC-Aula2", 700, 510, "192.168.30.12", 24, "192.168.30.1")
      ],
      enlaces: [
        armarEnlace("l-adm", "r1", "ether2", "pc-adm", "eth0", "ethernet"),
        armarEnlace("l-ven", "r1", "ether3", "pc-ven", "eth0", "ethernet"),
        armarEnlace("l-aula", "r1", "ether4", "sw-aula", "fa0/1", "ethernet"),
        armarEnlace("l-a1", "pc-a1", "eth0", "sw-aula", "fa0/2", "ethernet"),
        armarEnlace("l-a2", "pc-a2", "eth0", "sw-aula", "fa0/3", "ethernet")
      ],
      escenario: null
    };
  }

  var EJEMPLOS = [
    {
      id: "basica",
      nombre: "Básica",
      descripcion: "Dos PC y un switch. Para practicar direccionamiento básico.",
      topologia: topologiaBasica()
    },
    {
      id: "dos-subredes",
      nombre: "Dos subredes",
      descripcion: "Dos subredes y un router. Para ver el papel de la puerta de enlace.",
      topologia: topologiaDosSubredes()
    },
    {
      id: "complejo",
      nombre: "Complejo turístico",
      descripcion: "Complejo turístico con cinco sectores. Caso completo de VLSM.",
      topologia: topologiaComplejo()
    },
    {
      id: "complejo-roto",
      nombre: "Complejo roto (docente)",
      descripcion: "El complejo con tres fallas y dos objetivos. Plantilla para armar laboratorios de diagnóstico.",
      topologia: topologiaComplejoRoto()
    },
    {
      id: "desafio-complejo",
      nombre: "Desafío VLSM (complejo)",
      descripcion: "El complejo sin direccionar: diseñá el VLSM sobre 10.45.7.0/24 y verificalo en modo Desafío.",
      topologia: topologiaDesafioComplejo()
    },
    {
      id: "router-8",
      nombre: "Router de 8 puertos",
      descripcion: "Tres subredes colgadas de un mismo router, cada puerto con su propia red (como un MikroTik con los puertos fuera del bridge).",
      topologia: topologiaRouter8()
    }
  ];

  function ejemploPorId(id) {
    for (var i = 0; i < EJEMPLOS.length; i++) {
      if (EJEMPLOS[i].id === id) {
        return EJEMPLOS[i];
      }
    }
    return null;
  }

  /* ---------------- Autopruebas ---------------- */

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

    function contieneCodigo(errores, codigo) {
      for (var i = 0; i < errores.length; i++) {
        if (JSON.stringify(errores[i]).indexOf(codigo) >= 0) {
          return true;
        }
      }
      return false;
    }

    var basica = ejemploPorId("basica").topologia;
    var dosSubredes = ejemploPorId("dos-subredes").topologia;
    var complejo = ejemploPorId("complejo").topologia;
    var roto = ejemploPorId("complejo-roto").topologia;

    // Las cuatro topologías de ejemplo pasan la validación.
    comparar("valida basica", validarTopologia(basica).ok, true);
    comparar("valida dos-subredes", validarTopologia(dosSubredes).ok, true);
    comparar("valida complejo", validarTopologia(complejo).ok, true);
    comparar("valida complejo-roto", validarTopologia(roto).ok, true);

    // Ping dentro de la misma subred en las tres sanas.
    comparar("ping basica misma subred", Motor.ping(Motor.crearEstado(basica), "pc1", "192.168.1.20").exito, true);
    comparar("ping dos-subredes misma subred", Motor.ping(Motor.crearEstado(dosSubredes), "pc1", "192.168.1.20").exito, true);
    comparar("ping complejo wifi misma subred", Motor.ping(Motor.crearEstado(complejo), "pc-wifi", "10.45.7.20").exito, true);
    // Y el punta a punta de referencia: Administración al servidor.
    comparar("ping complejo admin a servidor", Motor.ping(Motor.crearEstado(complejo), "pc-admin", "10.45.7.122").exito, true);

    // Id duplicado: el mensaje nombra el id.
    (function () {
      var copia = clonar(basica);
      copia.dispositivos.push(clonar(copia.dispositivos[0]));
      var res = validarTopologia(copia);
      comparar("id duplicado no pasa", res.ok, false);
      comparar("id duplicado nombra el id", contieneCodigo(res.errores, "pc1"), true);
    })();

    // Una interfaz en dos enlaces.
    (function () {
      var copia = clonar(basica);
      copia.enlaces.push({
        id: "l-extra",
        a: { dispositivo: "pc1", interfaz: "eth0" },
        b: { dispositivo: "pc2", interfaz: "eth0" },
        tipo: "ethernet",
        estado: "up",
        velocidadMbps: 100,
        retardoMs: 1
      });
      comparar("interfaz en dos enlaces no pasa", validarTopologia(copia).ok, false);
    })();

    // Fibra entre dos interfaces ethernet.
    (function () {
      var copia = clonar(basica);
      copia.enlaces[0].tipo = "fibra";
      var res = validarTopologia(copia);
      comparar("fibra contra ethernet no pasa", res.ok, false);
      comparar("fibra contra ethernet habla de medios", contieneCodigo(res.errores, "tipo de cable"), true);
    })();

    // Importar sintaxis rota: sin excepción, con mensaje.
    (function () {
      var res = importar("{ esto no es json");
      comparar("importar roto ok false", res.ok, false);
      comparar("importar roto trae mensaje", res.errores.length > 0, true);
      comparar("importar roto topologia nula", res.topologia, null);
    })();

    // Exportar e importar el complejo reproduce el original.
    (function () {
      var texto = exportar(complejo);
      var res = importar(texto);
      comparar("roundtrip ok", res.ok, true);
      comparar("roundtrip equivalente", JSON.stringify(res.topologia), JSON.stringify(complejo));
    })();

    // Exportar para alumno: sin clave fallas y con fallas aplicadas.
    (function () {
      var textoAlumno = exportarParaAlumno(roto);
      comparar("alumno sin clave fallas", textoAlumno.indexOf("\"fallas\"") < 0, true);
      var parsed = JSON.parse(textoAlumno);
      var pcAdmin = buscarDispositivo(parsed, "pc-admin");
      comparar("alumno con gateway roto aplicado", pcAdmin.gateway, "10.45.7.200");
      comparar("alumno con enlace caido aplicado", buscarEnlace(parsed, "l-srv-r2").estado, "down");
      var r1 = buscarDispositivo(parsed, "r1");
      var quedaRuta = r1.rutas.some(function (r) { return r.destino === "10.45.7.120" && r.prefijo === 29; });
      comparar("alumno con ruta faltante aplicada", quedaRuta, false);
      comparar("alumno conserva objetivos", Array.isArray(parsed.escenario.objetivos) && parsed.escenario.objetivos.length === 2, true);
    })();

    // aplicarFallas no muta el original.
    (function () {
      var antes = JSON.stringify(roto);
      var aplicada = aplicarFallas(roto);
      comparar("aplicarFallas no muta", JSON.stringify(roto), antes);
      comparar("aplicarFallas sí cambia la copia", JSON.stringify(aplicada) === antes, false);
    })();

    // verificarObjetivos sobre el roto sin reparar: al menos uno no cumple, con código.
    (function () {
      var estadoRoto = Motor.crearEstado(aplicarFallas(roto));
      var res = verificarObjetivos(estadoRoto, roto.escenario.objetivos);
      comparar("objetivos roto orden y largo", res.length, 2);
      var algunoFalla = res.some(function (r) { return !r.cumple; });
      comparar("objetivos roto al menos uno no cumple", algunoFalla, true);
      var primero = res[0];
      comparar("objetivos roto primero no cumple", primero.cumple, false);
      comparar("objetivos roto primero con codigo", typeof primero.codigo === "string" && primero.codigo.length > 0, true);
    })();

    // Objetivos que exigen la causa de la falla, y validación de reglas.
    (function () {
      var t = JSON.parse(JSON.stringify(complejo));
      var r1 = buscarDispositivo(t, "r1");
      r1.reglas = [{ accion: "bloquear", origen: "10.45.7.0/26", destino: "10.45.7.96/27" }];
      var objetivos = [
        { tipo: "ping", origen: "pc-wifi", destino: "10.45.7.122", esperado: "falla", codigo: "D27" },
        { tipo: "ping", origen: "pc-wifi", destino: "10.45.7.122", esperado: "falla", codigo: "D11" },
        { tipo: "ping", origen: "pc-admin", destino: "10.45.7.122", esperado: "exito" }
      ];
      var res = verificarObjetivos(Motor.crearEstado(t), objetivos);
      comparar("objetivo con código: cumple con la causa pedida", res[0].cumple, true);
      comparar("objetivo con código: otra causa no cumple", res[1].cumple, false);
      comparar("objetivo con código: informa el título", typeof res[1].titulo === "string", true);
      comparar("objetivo de éxito con reglas cargadas", res[2].cumple, true);
      comparar("reglas válidas: la topología valida", validarTopologia(t).ok, true);
      r1.reglas.push({ accion: "tirar", origen: "10.45.7.0", destino: "cualquiera" });
      comparar("reglas inválidas: tres errores", validarTopologia(t).errores.filter(function (e) {
        return e.campo.indexOf(".reglas[1]") >= 0;
      }).length, 3);
    })();

    // verificarObjetivos sobre el complejo sano: todos cumplidos.
    (function () {
      var estadoSano = Motor.crearEstado(complejo);
      var res = verificarObjetivos(estadoSano, roto.escenario.objetivos);
      var todos = res.every(function (r) { return r.cumple; });
      comparar("objetivos sano todos cumplidos", todos, true);
    })();

    // Modo desafío: todas las pruebas trabajan sobre el complejo con los
    // equipos realmente direccionados. Una prueba sin equipos con IP no
    // prueba el modo desafío (así sobrevivió el defecto de la clave
    // requerimientos).
    function poner(topo, entrada, ip, prefijo, gateway) {
      var partes = entrada.split(":");
      var disp = buscarDispositivo(topo, partes[0]);
      var iface = partes[1] ? buscarInterfaz(disp, partes[1]) : disp.interfaces[0];
      iface.ip = ip;
      iface.prefijo = prefijo;
      iface.habilitada = ip !== null;
      if (gateway !== undefined) {
        disp.gateway = gateway;
      }
    }
    function disenoCorrecto() {
      var topo = topologiaDesafioComplejo();
      poner(topo, "r1:wlan0", "10.45.7.1", 26);
      poner(topo, "pc-wifi:wlan0", "10.45.7.10", 26, "10.45.7.1");
      poner(topo, "iot1:wlan0", "10.45.7.20", 26, "10.45.7.1");
      poner(topo, "r1:g0/0", "10.45.7.65", 27);
      poner(topo, "pc-admin:eth0", "10.45.7.66", 27, "10.45.7.65");
      poner(topo, "r1:g0/1", "10.45.7.97", 28);
      poner(topo, "cam1:eth0", "10.45.7.100", 28, "10.45.7.97");
      poner(topo, "r2:g0/0", "10.45.7.121", 29);
      poner(topo, "srv1:eth0", "10.45.7.122", 29, "10.45.7.121");
      poner(topo, "r1:fib0", "10.45.7.129", 30);
      poner(topo, "r2:fib0", "10.45.7.130", 30);
      return topo;
    }
    function informeDe(topo) {
      return verificarDesafio(topo, topo.escenario);
    }
    function sectorDe(informe, nombre) {
      for (var k = 0; k < informe.porSector.length; k++) {
        if (informe.porSector[k].sector === nombre) { return informe.porSector[k]; }
      }
      return null;
    }
    function dice(sector, texto) {
      return !!sector && JSON.stringify(sector.hallazgos).indexOf(texto) >= 0;
    }

    comparar("desafío ejemplo valida", validarTopologia(topologiaDesafioComplejo()).ok, true);

    (function () {
      var inf = informeDe(topologiaDesafioComplejo());
      comparar("desafío con requerimientos: un informe por sector", inf.porSector.length, 5);
      comparar("desafío sin direccionar: todos con error",
        inf.porSector.every(function (x) { return dice(x, "tiene IP todavía"); }), true);
    })();

    (function () {
      var inf = informeDe(disenoCorrecto());
      comparar("desafío diseño correcto sin errores", inf.resumen.errores, 0);
      comparar("desafío diseño correcto sin advertencias", inf.resumen.advertencias, 0);
    })();

    (function () {
      // El router de Cámaras en .41/28: la subred pensada arranca en .40.
      var topo = disenoCorrecto();
      poner(topo, "r1:g0/1", "10.45.7.41", 28);
      poner(topo, "cam1:eth0", "10.45.7.42", 28, "10.45.7.41");
      var cam = sectorDe(informeDe(topo), "Cámaras (CCTV)");
      comparar("desafío desalineada da error", cam.ok, false);
      comparar("desafío desalineada menciona el múltiplo", dice(cam, "no es múltiplo de 16"), true);
      comparar("desafío desalineada no da la respuesta", dice(cam, "10.45.7.32/28"), false);
    })();

    (function () {
      // Servidores en .104/29, adentro de Cámaras .96/28.
      var topo = disenoCorrecto();
      poner(topo, "r2:g0/0", "10.45.7.105", 29);
      poner(topo, "srv1:eth0", "10.45.7.106", 29, "10.45.7.105");
      var inf = informeDe(topo);
      comparar("desafío solape en Cámaras", dice(sectorDe(inf, "Cámaras (CCTV)"), "Se superpone"), true);
      comparar("desafío solape en Servidores", dice(sectorDe(inf, "Servidores"), "Se superpone"), true);
    })();

    (function () {
      var topo = disenoCorrecto();
      poner(topo, "r1:g0/0", "10.45.7.65", 28);
      poner(topo, "pc-admin:eth0", "10.45.7.66", 28, "10.45.7.65");
      comparar("desafío prefijo insuficiente",
        dice(sectorDe(informeDe(topo), "Administración"), "alcanza para 14 equipos"), true);
    })();

    (function () {
      var topo = disenoCorrecto();
      poner(topo, "pc-admin:eth0", "10.45.7.64", 27, "10.45.7.65");
      comparar("desafío IP no asignable",
        dice(sectorDe(informeDe(topo), "Administración"), "es la dirección de red"), true);
    })();

    (function () {
      var topo = disenoCorrecto();
      buscarDispositivo(topo, "pc-admin").gateway = "10.45.7.97";
      comparar("desafío gateway fuera de su subred",
        dice(sectorDe(informeDe(topo), "Administración"), "está fuera de su subred"), true);
    })();

    (function () {
      var topo = disenoCorrecto();
      poner(topo, "iot1:wlan0", "10.45.7.70", 26, "10.45.7.1");
      comparar("desafío sector inconsistente",
        dice(sectorDe(informeDe(topo), "Wi-Fi de huéspedes"), "no están en la misma subred"), true);
    })();

    (function () {
      var topo = disenoCorrecto();
      poner(topo, "srv1:eth0", null, 24, null);
      poner(topo, "r2:g0/0", null, 24);
      comparar("desafío sector sin direccionar",
        dice(sectorDe(informeDe(topo), "Servidores"), "tiene IP todavía"), true);
    })();

    (function () {
      // Administración a medias: la PC tiene IP y el puerto del router no.
      var topo = disenoCorrecto();
      poner(topo, "r1:g0/0", null, 24);
      var adm = sectorDe(informeDe(topo), "Administración");
      comparar("desafío sector a medias da error", adm.ok, false);
      comparar("desafío sector a medias nombra al router", dice(adm, "R1, puerto g0/0 todavía no tiene IP"), true);
    })();

    (function () {
      // Sólo el sector Wi-Fi, con un /24 entero para 60 hosts.
      var topo = disenoCorrecto();
      poner(topo, "r1:wlan0", "10.45.7.1", 24);
      poner(topo, "pc-wifi:wlan0", "10.45.7.10", 24, "10.45.7.1");
      poner(topo, "iot1:wlan0", "10.45.7.20", 24, "10.45.7.1");
      var soloWifi = { bloqueBase: "10.45.7.0/24", requerimientos: [topo.escenario.requerimientos[0]] };
      var inf = verificarDesafio(topo, soloWifi);
      comparar("desafío /24 para 60 hosts no es error", inf.resumen.errores, 0);
      comparar("desafío /24 para 60 hosts advierte", inf.resumen.advertencias, 1);
    })();

    // Diseño libre: los sectores salen de la red, sin enunciado.
    (function () {
      var inf = verificarDiseno(topologiaComplejo());
      comparar("diseño libre detecta los sectores del complejo",
        inf.porSector.map(function (x) { return x.sector; }),
        ["R1 wlan0", "R1 g0/0 · SW-Admin", "R1 g0/1 · SW-Cámaras", "Enlace R1 — R2", "R2 g0/0 · SW-Servidores"]);
      comparar("diseño libre del complejo sin errores", inf.resumen.errores, 0);
      comparar("diseño libre de una LAN sin router",
        verificarDiseno(topologiaBasica()).porSector.map(function (x) { return x.sector; }), ["Red de PC-1 · SW1"]);
    })();

    (function () {
      var topo = topologiaComplejo();
      poner(topo, "r1:g0/1", "10.45.7.41", 28);
      poner(topo, "cam1:eth0", "10.45.7.42", 28, "10.45.7.41");
      var cam = sectorDe(verificarDiseno(topo), "R1 g0/1 · SW-Cámaras");
      comparar("diseño libre marca la desalineada", dice(cam, "no es múltiplo de 16"), true);
    })();

    (function () {
      // En un enlace entre routers, la referencia es la IP más baja.
      var topo = topologiaComplejo();
      poner(topo, "r1:fib0", "10.45.7.130", 30);
      poner(topo, "r2:fib0", "10.45.7.129", 30);
      comparar("diseño libre: enlace con la IP baja en el segundo router",
        sectorDe(verificarDiseno(topo), "Enlace R1 — R2").ok, true);
    })();

    (function () {
      var topo = topologiaComplejo();
      comparar("diseño libre sin bloque no lo exige", dice(sectorDe(verificarDiseno(topo), "R1 wlan0"), "bloque"), false);
      topo.escenario = { diseno: { bloqueBase: "192.168.0.0/24", hosts: { "r1:g0/0": 40 } } };
      var inf = verificarDiseno(topo);
      comparar("diseño libre con bloque ajeno", dice(sectorDe(inf, "R1 wlan0"), "se sale del bloque"), true);
      comparar("diseño libre con hosts pedidos", dice(sectorDe(inf, "R1 g0/0 · SW-Admin"), "el sector necesita 40"), true);
    })();

    // Router de 8 puertos: valida, enruta entre puertos y rechaza modelos raros.
    (function () {
      var r8 = topologiaRouter8();
      comparar("router 8 puertos valida", validarTopologia(r8).ok, true);
      var est8 = Motor.crearEstado(r8);
      comparar("router 8 puertos enruta entre ether2 y ether4", Motor.ping(est8, "pc-adm", "192.168.30.12").exito, true);
      comparar("router 8 puertos enruta entre ether3 y ether2", Motor.ping(est8, "pc-ven", "192.168.10.10").exito, true);
      var raro = clonar(r8);
      buscarDispositivo(raro, "r1").modelo = "48-puertos";
      comparar("modelo de router desconocido no valida", validarTopologia(raro).ok, false);
      var pcModelo = clonar(r8);
      buscarDispositivo(pcModelo, "pc-adm").modelo = "8-puertos";
      comparar("modelo en una PC no valida", validarTopologia(pcModelo).ok, false);
      var conNube = clonar(r8);
      conNube.dispositivos.push({ id: "nube", tipo: "internet", nombre: "Internet", x: 400, y: -80, encendido: true,
        interfaces: [interfaz("eth0", "ethernet", "200.45.7.1", 30, true)], gateway: null, dns: null, rutas: [], dhcp: null });
      comparar("dispositivo internet valida", validarTopologia(conNube).ok, true);
      var faltante = clonar(r8);
      buscarDispositivo(faltante, "r1").interfaces.pop();
      comparar("router 8 puertos sin wlan1 no valida", validarTopologia(faltante).ok, false);
    })();

    // Modos de radio: la validación rechaza pares inválidos.
    (function () {
      var cliCli = clonar(complejo);
      buscarInterfaz(buscarDispositivo(cliCli, "r1"), "wlan0").modoRadio = "cliente";
      var resCli = validarTopologia(cliCli);
      comparar("cliente-cliente no pasa", resCli.ok, false);
      comparar("cliente-cliente habla de modos",
        resCli.errores.some(function (x) { return x.mensaje.indexOf("modos que no se entienden") >= 0; }), true);
      var apAp = clonar(complejo);
      buscarInterfaz(buscarDispositivo(apAp, "pc-wifi"), "wlan0").modoRadio = "ap";
      var resAp = validarTopologia(apAp);
      comparar("ap-ap no pasa", resAp.ok, false);
      var puente = clonar(complejo);
      buscarInterfaz(buscarDispositivo(puente, "r1"), "wlan0").modoRadio = "bridge";
      buscarInterfaz(buscarDispositivo(puente, "pc-wifi"), "wlan0").modoRadio = "bridge";
      // El puerto bridge de r1 sostiene dos enlaces: tampoco pasa.
      comparar("bridge con dos enlaces no pasa", validarTopologia(puente).ok, false);
    })();

    // La celda Wi-Fi del complejo en acción.
    (function () {
      function estadoComplejo(mutacion) {
        var copia = clonar(complejo);
        if (mutacion) {
          mutacion(copia);
        }
        return Motor.crearEstado(copia);
      }
      comparar("ping wifi al servidor",
        Motor.ping(estadoComplejo(), "pc-wifi", "10.45.7.122").exito, true);
      comparar("ping iot al servidor",
        Motor.ping(estadoComplejo(), "iot1", "10.45.7.122").exito, true);
      var vecina = Motor.ping(estadoComplejo(), "pc-wifi", "10.45.7.20");
      comparar("ping wifi a iot exito", vecina.exito, true);
      comparar("ping wifi a iot sin router", vecina.saltos.length, 2);
      comparar("ping wifi a iot no toca r1",
        vecina.saltos.some(function (s) { return s.dispositivo === "r1"; }), false);
      var movilAdmin = Motor.ping(estadoComplejo(), "pc-movil", "10.45.7.66");
      comparar("ping movil a admin exito", movilAdmin.exito, true);
      comparar("ping movil a admin sin router",
        movilAdmin.saltos.some(function (s) { return s.dispositivo === "r1" || s.dispositivo === "r2"; }), false);
      var movilSrv = Motor.ping(estadoComplejo(), "pc-movil", "10.45.7.122");
      comparar("ping movil al servidor exito", movilSrv.exito, true);
      comparar("ping movil al servidor pasa por r1",
        movilSrv.saltos.some(function (s) { return s.dispositivo === "r1"; }), true);
      comparar("ping movil al servidor pasa por r2",
        movilSrv.saltos.some(function (s) { return s.dispositivo === "r2"; }), true);
      var aire = Motor.ping(estadoComplejo(function (copia) {
        buscarInterfaz(buscarDispositivo(copia, "pc-movil"), "wlan0").ip = "10.45.7.10";
        buscarInterfaz(buscarDispositivo(copia, "pc-movil"), "wlan0").prefijo = 26;
      }), "pc-movil", "10.45.7.66");
      comparar("D15 en el aire", aire.diagnostico && aire.diagnostico.codigo, "D15");
      comparar("D15 en el aire menciona al AP",
        !!aire.diagnostico && aire.diagnostico.explicacion.indexOf("punto de acceso") >= 0, true);
      var sinCelda = Motor.ping(estadoComplejo(function (copia) {
        buscarInterfaz(buscarDispositivo(copia, "r1"), "wlan0").habilitada = false;
      }), "pc-wifi", "10.45.7.122");
      var codSin = sinCelda.diagnostico && sinCelda.diagnostico.codigo;
      comparar("sin celda D19 o D10", codSin === "D19" || codSin === "D10", true);
      comparar("sin celda nunca D02", codSin === "D02", false);
      var lejos = Motor.ping(estadoComplejo(function (copia) {
        var iot = buscarDispositivo(copia, "iot1");
        iot.x = 900;
        iot.y = 100;
      }), "iot1", "10.45.7.122");
      comparar("iot lejos D17", lejos.diagnostico && lejos.diagnostico.codigo, "D17");
      comparar("wifi sigue andando con iot lejos",
        Motor.ping(estadoComplejo(function (copia) {
          var iot = buscarDispositivo(copia, "iot1");
          iot.x = 900;
          iot.y = 100;
        }), "pc-wifi", "10.45.7.122").exito, true);
    })();

    return { total: total, pasadas: pasadas, fallos: fallos };
  }

  return {
    EJEMPLOS: EJEMPLOS,
    validarTopologia: validarTopologia,
    exportar: exportar,
    importar: importar,
    aplicarFallas: aplicarFallas,
    exportarParaAlumno: exportarParaAlumno,
    verificarObjetivos: verificarObjetivos,
    verificarDesafio: verificarDesafio,
    detectarSectores: detectarSectores,
    verificarDiseno: verificarDiseno,
    autopruebas: autopruebas
  };
})();
