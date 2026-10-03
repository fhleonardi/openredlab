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

  // Versión de la app (semver). Cada PR que toca una capa la sube y suma su
  // entrada en CHANGELOG.md; el ensamblador controla que coincidan.
  var VERSION_APP = "1.2.0";

  // Versión del formato de archivo que escribe esta capa. Sube sólo si un
  // campo existente cambia o desaparece, y cada subida trae su migración.
  var VERSION_FORMATO = 1;

  // MIGRACIONES[n] lleva un archivo del formato n al n+1. Hoy hay uno solo.
  var MIGRACIONES = {};

  // Tipos de dispositivo reconocidos (§4 del BASE, más el punto de acceso).
  var TIPOS_VALIDOS = ["pc", "servidor", "switch-l2", "router", "camara", "iot", "ap", "internet"];

  // Medios y tipos de enlace reconocidos.
  var MEDIOS_VALIDOS = ["ethernet", "fibra", "wireless"];

  // Juego de interfaces esperado por tipo: ids y medios exactos.
  var INTERFACES_ESPERADAS = {
    // Un servidor se conecta por cable, como un equipo de sala de servidores.
    servidor: [
      { id: "eth0", medio: "ethernet" }
    ],
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
    ],
    // Firewall: un router con estado (deja volver las respuestas de lo que
    // permitió) y puertos con nombre de rol.
    firewall: [
      { id: "wan", medio: "ethernet" },
      { id: "lan1", medio: "ethernet" },
      { id: "lan2", medio: "ethernet" },
      { id: "lan3", medio: "ethernet" },
      { id: "dmz", medio: "ethernet" }
    ]
  };

  // Los routers y firewalls admiten cualquier juego de puertos, dentro de
  // este rango; el modelo sólo da el juego inicial y el estilo de nombres.
  var PUERTOS_ROUTER_MIN = 1;
  var PUERTOS_ROUTER_MAX = 16;

  // Switches de 24 y 48 puertos, además del estándar de 8.
  function puertosSwitch(n) {
    var lista = [];
    for (var i = 1; i <= n; i++) { lista.push({ id: "fa0/" + i, medio: "ethernet" }); }
    lista.push({ id: "fib0", medio: "fibra" });
    return lista;
  }
  // El hub repite todo por todos sus puertos: 8 de cobre, sin fibra.
  function puertosHub() {
    var lista = [];
    for (var i = 1; i <= 8; i++) { lista.push({ id: "fa0/" + i, medio: "ethernet" }); }
    return lista;
  }
  var MODELOS_SWITCH = { "24-puertos": puertosSwitch(24), "48-puertos": puertosSwitch(48), hub: puertosHub() };

  /* ---------------- Servidor DNS ----------------
   * servicios.dns = { zona, recursivo, registros: [{ nombre, tipo, valor,
   * prioridad?, ttl? }] }. El servidor es autoritativo de su zona: los
   * registros tienen que ser de esa zona. */
  var TIPOS_REGISTRO = ["A", "CNAME", "MX", "NS"];

  function esNombreDominio(texto) {
    return typeof texto === "string" &&
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(texto);
  }

  function dentroDeZona(nombre, zona) {
    return nombre === zona || nombre.slice(-(zona.length + 1)) === "." + zona;
  }

  // Puertos en escucha de un servidor: { protocolo, puerto, nombre }.
  function validarEscuchando(d, etiqueta, anotar) {
    var lista = d.servicios && d.servicios.escuchando;
    if (lista === undefined || lista === null) { return; }
    var campo = etiqueta + ".servicios.escuchando";
    if (d.tipo !== "servidor") {
      anotar(campo, "Sólo un servidor atiende servicios en puertos, y \"" + d.id + "\" es " + d.tipo + ".");
      return;
    }
    if (!Array.isArray(lista)) {
      anotar(campo, "Los servicios del servidor \"" + d.id + "\" tienen que ser una lista.");
      return;
    }
    var vistos = {};
    lista.forEach(function (x, i) {
      var c = campo + "[" + i + "]";
      var quien = "El servicio " + (i + 1) + " del servidor \"" + d.id + "\"";
      if (!x || (x.protocolo !== "tcp" && x.protocolo !== "udp")) {
        anotar(c + ".protocolo", quien + " tiene que ser tcp o udp.");
        return;
      }
      var n = Number(x.puerto);
      if (!(n >= 1 && n <= 65535) || Math.floor(n) !== n) {
        anotar(c + ".puerto", quien + " tiene el puerto " + JSON.stringify(x.puerto) + ": va de 1 a 65535.");
        return;
      }
      var clave = x.protocolo + n;
      if (vistos[clave]) {
        anotar(c + ".puerto", quien + " repite " + x.protocolo.toUpperCase() + " " + n + ": un puerto lo atiende un solo servicio.");
      }
      vistos[clave] = true;
    });
  }

  // Calidad del enlace: latencia, jitter y pérdida.
  function validarCalidad(e, anotar) {
    var campo = "enlaces." + e.id;
    if (e.retardoMs !== undefined && e.retardoMs !== null && !(Number(e.retardoMs) >= 0)) {
      anotar(campo + ".retardoMs", "La latencia del cable \"" + e.id + "\" tiene que ser un número de milisegundos (0 o más).");
    }
    if (e.jitterMs !== undefined && e.jitterMs !== null && !(Number(e.jitterMs) >= 0)) {
      anotar(campo + ".jitterMs", "El jitter del cable \"" + e.id + "\" tiene que ser un número de milisegundos (0 o más).");
    }
    if (e.perdidaPct !== undefined && e.perdidaPct !== null && !(Number(e.perdidaPct) >= 0 && Number(e.perdidaPct) <= 100)) {
      anotar(campo + ".perdidaPct", "La pérdida del cable \"" + e.id + "\" es un porcentaje: va de 0 a 100.");
    }
  }

  function validarServiciosDns(d, etiqueta, anotar) {
    validarEscuchando(d, etiqueta, anotar);
    var dns = d.servicios && d.servicios.dns;
    if (d.servicios === undefined || d.servicios === null || dns === undefined || dns === null) {
      return;
    }
    var campo = etiqueta + ".servicios.dns";
    if (d.tipo !== "servidor") {
      anotar(campo, "Sólo un servidor da el servicio de DNS, y \"" + d.id + "\" es " + d.tipo + ".");
      return;
    }
    if (!esNombreDominio(dns.zona)) {
      anotar(campo + ".zona", "La zona DNS del servidor \"" + d.id + "\" tiene que ser un nombre de dominio, por ejemplo oficina.local.");
    }
    if (dns.recursivo !== undefined && typeof dns.recursivo !== "boolean") {
      anotar(campo + ".recursivo", "El servidor \"" + d.id + "\" no indica bien si resuelve nombres de afuera (va true o false).");
    }
    if (!Array.isArray(dns.registros)) {
      anotar(campo + ".registros", "Los registros DNS del servidor \"" + d.id + "\" tienen que ser una lista.");
      return;
    }
    dns.registros.forEach(function (reg, i) {
      var c = campo + ".registros[" + i + "]";
      var quien = "El registro " + (i + 1) + " del servidor \"" + d.id + "\"";
      if (!reg || !esNombreDominio(reg.nombre)) {
        anotar(c + ".nombre", quien + " no tiene un nombre válido (por ejemplo www.oficina.local).");
        return;
      }
      if (esNombreDominio(dns.zona) && !dentroDeZona(reg.nombre, dns.zona)) {
        anotar(c + ".nombre", quien + " (" + reg.nombre + ") no pertenece a la zona " + dns.zona + ".");
      }
      if (TIPOS_REGISTRO.indexOf(reg.tipo) < 0) {
        anotar(c + ".tipo", quien + " tiene un tipo que no existe: puede ser " + TIPOS_REGISTRO.join(", ") + ".");
        return;
      }
      if (reg.tipo === "A" && !Red.esIpValida(String(reg.valor || ""))) {
        anotar(c + ".valor", quien + " es de tipo A: su valor tiene que ser una IP.");
      } else if (reg.tipo !== "A" && !esNombreDominio(reg.valor)) {
        anotar(c + ".valor", quien + " es de tipo " + reg.tipo + ": su valor tiene que ser un nombre, no una IP.");
      }
      if (reg.prioridad !== undefined && reg.prioridad !== null && (reg.tipo !== "MX" || !(Number(reg.prioridad) >= 0))) {
        anotar(c + ".prioridad", quien + ": la prioridad sólo va en un MX y es un número.");
      }
      if (reg.ttl !== undefined && reg.ttl !== null && !(Number(reg.ttl) > 0)) {
        anotar(c + ".ttl", quien + ": el TTL tiene que ser una cantidad de segundos mayor que cero.");
      }
    });
  }

  function interfacesEsperadas(dispositivo) {
    if (dispositivo.tipo === "router" && dispositivo.modelo && MODELOS_ROUTER[dispositivo.modelo]) {
      return MODELOS_ROUTER[dispositivo.modelo];
    }
    if (dispositivo.tipo === "switch-l2" && dispositivo.modelo && MODELOS_SWITCH[dispositivo.modelo]) {
      return MODELOS_SWITCH[dispositivo.modelo];
    }
    return INTERFACES_ESPERADAS[dispositivo.tipo] || [];
  }

  /* Estilo de nombres de los puertos de un router, según su modelo:
   * estándar g0/0, fib0, wlan0; tipo MikroTik ether1, sfp1, wlan1;
   * firewall wan, lan1, dmz…, sfp1, wlan1. */
  var ESTILOS_PUERTOS = {
    estandar: { ethernet: ["g0/", 0], fibra: ["fib", 0], wireless: ["wlan", 0] },
    "8-puertos": { ethernet: ["ether", 1], fibra: ["sfp", 1], wireless: ["wlan", 1] },
    firewall: { ethernet: ["lan", 1], fibra: ["sfp", 1], wireless: ["wlan", 1] }
  };

  function estiloDe(dispositivo) {
    return ESTILOS_PUERTOS[(dispositivo && dispositivo.modelo) || "estandar"] || ESTILOS_PUERTOS.estandar;
  }

  // Primer nombre libre para un puerto nuevo de ese medio.
  function nombrePuertoLibre(dispositivo, medio, ocupados) {
    var regla = estiloDe(dispositivo)[medio] || ["p", 1];
    var usados = {};
    (dispositivo.interfaces || []).forEach(function (f) { usados[f.id] = true; });
    (ocupados || []).forEach(function (id) { usados[id] = true; });
    for (var n = regla[1]; n < regla[1] + 100; n++) {
      if (!usados[regla[0] + n]) { return regla[0] + n; }
    }
    return null;
  }

  /* Cambia el modelo de un router (o de un switch) sobre la topología dada.
   * En un router, los puertos se renombran al estilo nuevo en el mismo
   * orden, conservando medio, IP y cables; también se actualizan las
   * referencias "equipo:puerto" del escenario. En un switch, el juego de
   * puertos pasa a ser el del modelo, y no se puede quitar uno con cable.
   * Devuelve { ok, error }. */
  function cambiarModelo(topologia, idDispositivo, modeloNuevo) {
    var d = buscarDispositivo(topologia, idDispositivo);
    if (!d) { return { ok: false, error: "No existe el equipo." }; }
    modeloNuevo = modeloNuevo || null;
    var conCable = function (idIf) {
      return (topologia.enlaces || []).some(function (e) {
        return (e.a.dispositivo === d.id && e.a.interfaz === idIf) || (e.b.dispositivo === d.id && e.b.interfaz === idIf);
      });
    };
    if (d.tipo === "switch-l2") {
      if (modeloNuevo && !MODELOS_SWITCH[modeloNuevo]) { return { ok: false, error: "Ese modelo de switch no existe." }; }
      var juego = modeloNuevo ? MODELOS_SWITCH[modeloNuevo] : INTERFACES_ESPERADAS["switch-l2"];
      var quedan = {};
      juego.forEach(function (p) { quedan[p.id] = true; });
      var conflicto = d.interfaces.filter(function (f) { return !quedan[f.id] && conCable(f.id); });
      if (conflicto.length) {
        return { ok: false, error: "Desconectá primero los cables de " + conflicto.map(function (f) { return f.id; }).join(", ") +
          ": esos puertos no existen en el modelo nuevo." };
      }
      var actuales = {};
      d.interfaces.forEach(function (f) { actuales[f.id] = f; });
      d.interfaces = juego.map(function (p) {
        return actuales[p.id] || { id: p.id, nombre: p.id, medio: p.medio, habilitada: true, modo: "estatico", ip: null, prefijo: 24, mac: null };
      });
      if (modeloNuevo) { d.modelo = modeloNuevo; } else { delete d.modelo; }
      return { ok: true };
    }
    if (d.tipo !== "router") { return { ok: false, error: "Sólo los routers y los switches tienen modelo." }; }
    if (modeloNuevo && !MODELOS_ROUTER[modeloNuevo]) { return { ok: false, error: "Ese modelo de router no existe." }; }
    if (modeloNuevo) { d.modelo = modeloNuevo; } else { delete d.modelo; }
    // Nombres nuevos, en orden y por medio. El firewall llama "wan" a su
    // primer puerto de cobre.
    var asignados = [];
    var cambios = {};
    var primerCobre = true;
    d.interfaces.forEach(function (f) {
      var nuevo;
      if (modeloNuevo === "firewall" && f.medio === "ethernet" && primerCobre) {
        nuevo = "wan";
      } else {
        nuevo = nombrePuertoLibre({ modelo: d.modelo, interfaces: [] }, f.medio, asignados.concat(["wan"]));
      }
      if (f.medio === "ethernet") { primerCobre = false; }
      asignados.push(nuevo);
      cambios[f.id] = nuevo;
    });
    d.interfaces.forEach(function (f) { f.id = cambios[f.id]; f.nombre = f.id; });
    (topologia.enlaces || []).forEach(function (e) {
      ["a", "b"].forEach(function (lado) {
        if (e[lado].dispositivo === d.id && cambios[e[lado].interfaz]) { e[lado].interfaz = cambios[e[lado].interfaz]; }
      });
    });
    renombrarEnEscenario(topologia.escenario, d.id, cambios);
    return { ok: true, cambios: cambios };
  }

  // Las referencias "equipo:puerto" del escenario siguen al puerto renombrado.
  function renombrarEnEscenario(escenario, idDispositivo, cambios) {
    if (!escenario || typeof escenario !== "object") { return; }
    function nueva(ref) {
      var texto = String(ref);
      var corte = texto.indexOf(":");
      if (corte < 0 || texto.slice(0, corte) !== idDispositivo) { return ref; }
      var puerto = texto.slice(corte + 1);
      return cambios[puerto] ? idDispositivo + ":" + cambios[puerto] : ref;
    }
    normalizarSectores(escenario).forEach(function (sec) {
      ["dispositivos", "equipos", "ids", "equiposIds", "hostsLista"].forEach(function (campo) {
        if (Array.isArray(sec[campo])) { sec[campo] = sec[campo].map(nueva); }
      });
    });
    if (escenario.diseno && escenario.diseno.hosts) {
      var hosts = {};
      Object.keys(escenario.diseno.hosts).forEach(function (clave) {
        hosts[clave.split("+").map(nueva).sort().join("+")] = escenario.diseno.hosts[clave];
      });
      escenario.diseno.hosts = hosts;
    }
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
    } else if (obj.version !== VERSION_FORMATO) {
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
        if (d.tipo !== "router" && d.tipo !== "switch-l2") {
          anotar(etiqueta + ".modelo", "Solo los routers y los switches tienen modelo, y \"" + d.id + "\" es " + d.tipo + ".");
        } else if (d.tipo === "router" && !MODELOS_ROUTER[d.modelo]) {
          anotar(etiqueta + ".modelo", "El router \"" + d.id + "\" tiene un modelo que no existe: puede ser el estándar (sin modelo), \"8-puertos\" o \"firewall\".");
        } else if (d.tipo === "switch-l2" && !MODELOS_SWITCH[d.modelo]) {
          anotar(etiqueta + ".modelo", "El switch \"" + d.id + "\" tiene un modelo que no existe: puede ser el estándar (sin modelo), \"24-puertos\", \"48-puertos\" o \"hub\".");
        }
      }
      var esperadas = interfacesEsperadas(d);
      var nombresEsperados = esperadas.map(function (e) { return e.id; }).join(", ");
      if (d.tipo === "router") {
        // Los routers y firewalls tienen puertos libres: sólo se controla la
        // cantidad (los nombres únicos y los medios se revisan aparte).
        if (d.interfaces.length < PUERTOS_ROUTER_MIN || d.interfaces.length > PUERTOS_ROUTER_MAX) {
          anotar(etiqueta + ".interfaces", "El router \"" + d.id + "\" tiene " + d.interfaces.length + " puertos: puede tener entre " +
            PUERTOS_ROUTER_MIN + " y " + PUERTOS_ROUTER_MAX + ".");
        }
      } else if (d.interfaces.length !== esperadas.length) {
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
        // NAT de salida: sólo en puertos de router o firewall.
        if (f.nat !== undefined && f.nat !== null) {
          if (typeof f.nat !== "boolean") {
            anotar(campoBase + ".nat", "El puerto " + f.id + " del equipo \"" + d.id + "\" no indica bien si hace NAT (va true o false).");
          } else if (f.nat && d.tipo !== "router") {
            anotar(campoBase + ".nat", "Sólo los routers y los firewalls hacen NAT, y \"" + d.id + "\" es " + d.tipo + ".");
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
      validarServiciosDns(d, etiqueta, anotar);

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
            if (regla && regla.protocolo && ["icmp", "tcp", "udp"].indexOf(regla.protocolo) < 0) {
              anotar(campoRegla + ".protocolo", "La regla " + (g + 1) + " de \"" + d.id + "\" tiene un protocolo que no existe: puede ser icmp, tcp o udp (o ninguno, para cualquiera).");
            }
            if (regla && regla.puerto !== undefined && regla.puerto !== null && regla.puerto !== "") {
              var np = Number(regla.puerto);
              if (regla.protocolo !== "tcp" && regla.protocolo !== "udp") {
                anotar(campoRegla + ".puerto", "La regla " + (g + 1) + " de \"" + d.id + "\" tiene un puerto, pero los puertos son de TCP o UDP: elegí uno de esos protocolos.");
              } else if (!(np >= 1 && np <= 65535) || Math.floor(np) !== np) {
                anotar(campoRegla + ".puerto", "La regla " + (g + 1) + " de \"" + d.id + "\" tiene un puerto inválido: va de 1 a 65535.");
              }
            }
            if (regla && regla.entrada && !buscarInterfaz(d, regla.entrada)) {
              anotar(campoRegla + ".entrada", "La regla " + (g + 1) + " de \"" + d.id + "\" dice que el paquete entra por " + regla.entrada + ", pero ese puerto no existe.");
            }
          }
        }
      }

      // Redirecciones de puertos (NAT de destino) de los routers.
      if (d.redirecciones !== undefined && d.redirecciones !== null) {
        if (!Array.isArray(d.redirecciones)) {
          anotar(etiqueta + ".redirecciones", "Las redirecciones de puertos de \"" + d.id + "\" no tienen el formato correcto (tiene que ser una lista).");
        } else {
          if (d.redirecciones.length > 0 && d.tipo !== "router") {
            anotar(etiqueta + ".redirecciones", "Sólo los routers y los firewalls redirigen puertos, y \"" + d.id + "\" es " + d.tipo + ".");
          }
          d.redirecciones.forEach(function (r, k) {
            var campoR = etiqueta + ".redirecciones[" + k + "]";
            var nro = "La redirección " + (k + 1) + " de \"" + d.id + "\"";
            function puertoOk(x) { var n = Number(x); return n >= 1 && n <= 65535 && Math.floor(n) === n; }
            if (!r || (r.protocolo !== "tcp" && r.protocolo !== "udp")) { anotar(campoR + ".protocolo", nro + " tiene que ser de TCP o de UDP."); }
            if (!r || !puertoOk(r.puerto)) { anotar(campoR + ".puerto", nro + " tiene un puerto público inválido: va de 1 a 65535."); }
            if (!r || typeof r.ipInterna !== "string" || !Red.esIpValida(r.ipInterna)) { anotar(campoR + ".ipInterna", nro + " no tiene una IP interna válida."); }
            if (!r || !puertoOk(r.puertoInterno)) { anotar(campoR + ".puertoInterno", nro + " tiene un puerto interno inválido: va de 1 a 65535."); }
          });
        }
      }

      if (d.politica !== undefined && d.politica !== null && d.politica !== "permitir" && d.politica !== "bloquear") {
        anotar(etiqueta + ".politica", "La política por defecto de \"" + d.id + "\" tiene que ser permitir o bloquear.");
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
      validarCalidad(e, anotar);
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

  // El archivo anota con qué versión de la app se hizo. Es informativo: la
  // validación no lo exige ni lo revisa.
  function conGenerador(topologia) {
    var copia = clonar(topologia);
    if (copia && typeof copia === "object" && !Array.isArray(copia)) {
      copia.generador = "OpenRedLab " + VERSION_APP;
    }
    return copia;
  }

  function exportar(topologia) {
    return JSON.stringify(conGenerador(topologia), null, 2);
  }

  // Lleva un archivo de su formato al formato `hasta`, salto por salto, sobre
  // un clon. Un formato que no es entero o un salto sin migración es un error.
  function migrarCon(obj, tabla, hasta) {
    if (!obj || typeof obj !== "object" || typeof obj.version !== "number" || obj.version % 1 !== 0) {
      return { ok: true, topologia: obj, errores: [] };
    }
    var copia = clonar(obj);
    while (copia.version < hasta) {
      var paso = tabla[copia.version];
      if (typeof paso !== "function") {
        return {
          ok: false,
          topologia: null,
          errores: [{ campo: "version", mensaje: "No hay cómo actualizar un archivo del formato " + copia.version + " al " + (copia.version + 1) + "." }]
        };
      }
      copia = paso(copia);
      copia.version += 1;
    }
    return { ok: true, topologia: copia, errores: [] };
  }

  function migrarTopologia(obj) {
    return migrarCon(obj, MIGRACIONES, VERSION_FORMATO);
  }

  // Un archivo de un formato más nuevo no se puede abrir: se dice con qué se hizo y qué hacer.
  function errorFormatoNuevo(obj) {
    var quien = (typeof obj.generador === "string" && obj.generador.trim()) ? obj.generador.trim() : "";
    var mensaje = quien
      ? "Este archivo se hizo con " + quien + ", más nuevo que este (" + VERSION_APP + "). Abrilo en la versión publicada del simulador."
      : "Este archivo es de un formato más nuevo (" + obj.version + ") que el de este simulador (" + VERSION_APP + ", formato " + VERSION_FORMATO + "). Abrilo en la versión publicada del simulador.";
    return { campo: "version", mensaje: mensaje };
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
    if (parsed && typeof parsed === "object" && typeof parsed.version === "number" && parsed.version > VERSION_FORMATO) {
      return { ok: false, topologia: null, errores: [errorFormatoNuevo(parsed)] };
    }
    var migrada = migrarTopologia(parsed);
    if (!migrada.ok) {
      return { ok: false, topologia: null, errores: migrada.errores };
    }
    var validacion = validarTopologia(migrada.topologia);
    if (!validacion.ok) {
      return { ok: false, topologia: null, errores: validacion.errores };
    }
    return { ok: true, topologia: migrada.topologia, errores: [] };
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

  // Fallas de servicios: NAT, DNS, puertos y filtrado.
  function fallaNat(copia, falla) {
    var iface = buscarInterfaz(buscarDispositivo(copia, falla.dispositivo), falla.interfaz);
    if (iface) { delete iface.nat; }
  }

  function fallaRedireccion(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev || !Array.isArray(dev.redirecciones)) { return; }
    dev.redirecciones = dev.redirecciones.filter(function (r) {
      return !(r && r.protocolo === falla.protocolo && Number(r.puerto) === Number(falla.puerto));
    });
  }

  function fallaDns(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (dev) { dev.dns = falla.dns || null; }
  }

  function fallaRegistroDns(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    var dns = dev && dev.servicios && dev.servicios.dns;
    if (!dns || !Array.isArray(dns.registros)) { return; }
    dns.registros = dns.registros.filter(function (x) {
      // tipoRegistro, porque «tipo» ya es el tipo de falla.
      return !(x.nombre === falla.nombre && (!falla.tipoRegistro || x.tipo === falla.tipoRegistro));
    });
  }

  function fallaServicio(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev || !dev.servicios) { return; }
    var puerto = Number(falla.puerto);
    if (falla.protocolo === "udp" && puerto === 53) { delete dev.servicios.dns; }
    if (Array.isArray(dev.servicios.escuchando)) {
      dev.servicios.escuchando = dev.servicios.escuchando.filter(function (x) {
        return !(x.protocolo === falla.protocolo && Number(x.puerto) === puerto);
      });
    }
  }

  function fallaRegla(copia, falla) {
    var dev = buscarDispositivo(copia, falla.dispositivo);
    if (!dev || dev.tipo !== "router" || !falla.regla) { return; }
    if (!Array.isArray(dev.reglas)) { dev.reglas = []; }
    var pos = typeof falla.posicion === "number" ? Math.max(0, Math.min(falla.posicion, dev.reglas.length)) : 0;
    dev.reglas.splice(pos, 0, clonar(falla.regla));
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
      } else if (f.tipo === "nat-faltante") {
        fallaNat(copia, f);
      } else if (f.tipo === "redireccion-faltante") {
        fallaRedireccion(copia, f);
      } else if (f.tipo === "dns-incorrecto") {
        fallaDns(copia, f);
      } else if (f.tipo === "registro-dns-borrado") {
        fallaRegistroDns(copia, f);
      } else if (f.tipo === "servicio-detenido") {
        fallaServicio(copia, f);
      } else if (f.tipo === "regla-agregada") {
        fallaRegla(copia, f);
      }
    }
    return copia;
  }

  // Archivo del alumno: fallas ya aplicadas sobre las configuraciones y sin
  // la clave `fallas`. Conserva los objetivos y, en un desafío, los sectores
  // y el bloque; en ese caso borra el direccionamiento, que es el ejercicio.
  function exportarParaAlumno(topologia) {
    var copia = aplicarFallas(topologia);
    if (copia.escenario && typeof copia.escenario === "object") {
      var esc = copia.escenario;
      var sectores = normalizarSectores(esc);
      copia.escenario = { objetivos: esc.objetivos || [] };
      if (sectores.length) {
        copia.escenario.modo = "desafio";
        if (bloqueDe(esc)) { copia.escenario.bloqueBase = bloqueDe(esc); }
        copia.escenario.requerimientos = clonar(sectores);
        vaciarDireccionamiento(copia);
      }
    }
    return JSON.stringify(conGenerador(copia), null, 2);
  }

  /* ---------------- Objetivos ---------------- */

  function verificarObjetivos(estado, objetivos) {
    if (!Array.isArray(objetivos)) {
      return [];
    }
    var resultados = [];
    for (var i = 0; i < objetivos.length; i++) {
      var obj = objetivos[i];
      // Tres tipos: ping, conectar (IP o nombre, protocolo y puerto) y
      // resolver (un nombre, con el valor esperado si se pide).
      var res = null;
      if (obj && obj.tipo === "ping") {
        res = Motor.ping(estado, obj.origen, obj.destino);
      } else if (obj && obj.tipo === "conectar" && Motor.conectar) {
        res = Motor.conectar(estado, obj.origen, obj.destino, obj.protocolo || "tcp", Number(obj.puerto));
      } else if (obj && obj.tipo === "resolver" && Motor.consultarDns) {
        res = Motor.consultarDns(estado, obj.origen, obj.nombre, obj.tipoRegistro || "A");
        if (res.exito && obj.valor && !res.respuesta.registros.some(function (x) { return x.valor === obj.valor; })) {
          res = { exito: false, diagnostico: { codigo: "VALOR", titulo: "El nombre se resolvió, pero a otro valor (" +
            res.respuesta.registros.map(function (x) { return x.valor; }).join(", ") + ")" } };
        }
      }
      if (!res) {
        resultados.push({ objetivo: obj, cumple: false, codigo: null });
        continue;
      }
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

  /* ---------------- Editores del modo Docente ----------------
   * Catálogo de fallas y objetivos para armar laboratorios en pantalla.
   * Cada campo tiene una clase: las de lista sacan sus opciones de la red
   * abierta (opcionesCampo), cada una con el parche que se aplica al ítem;
   * las de texto se normalizan con normalizarCampo. La interfaz dibuja los
   * campos sin saber nada de cada tipo. Una clave con punto ("regla.origen")
   * es un campo dentro de un objeto del ítem. */
  var CAMPO_EQUIPO = { clave: "dispositivo", etiqueta: "Equipo", clase: "dispositivo" };
  var TIPOS_FALLA = [
    { tipo: "mascara-incorrecta", nombre: "Máscara incorrecta", campos: [
      CAMPO_EQUIPO,
      { clave: "interfaz", etiqueta: "Puerto", clase: "interfaz", filtro: "conIp" },
      { clave: "prefijo", etiqueta: "Prefijo que queda", clase: "prefijo" }] },
    { tipo: "interfaz-deshabilitada", nombre: "Puerto deshabilitado", campos: [
      CAMPO_EQUIPO,
      { clave: "interfaz", etiqueta: "Puerto", clase: "interfaz" }] },
    { tipo: "ruta-faltante", nombre: "Ruta faltante", campos: [
      { clave: "dispositivo", etiqueta: "Router", clase: "dispositivo", filtro: "router" },
      { clave: "ruta", etiqueta: "Ruta que se borra", clase: "ruta" }] },
    { tipo: "ip-duplicada", nombre: "IP duplicada", campos: [
      { clave: "dispositivo", etiqueta: "Equipo que queda con la IP repetida", clase: "dispositivo", filtro: "host" },
      { clave: "copiarDe", etiqueta: "Copia la IP de", clase: "dispositivo", filtro: "conIp" }] },
    { tipo: "gateway-incorrecto", nombre: "Gateway incorrecto", campos: [
      { clave: "dispositivo", etiqueta: "Equipo", clase: "dispositivo", filtro: "host" },
      { clave: "gateway", etiqueta: "Gateway que queda", clase: "ip" }] },
    { tipo: "enlace-caido", nombre: "Cable caído", campos: [
      { clave: "enlace", etiqueta: "Cable", clase: "enlace" }] },
    { tipo: "nat-faltante", nombre: "Sin NAT", campos: [
      { clave: "dispositivo", etiqueta: "Router", clase: "dispositivo", filtro: "router" },
      { clave: "interfaz", etiqueta: "Puerto con NAT", clase: "interfaz", filtro: "nat" }] },
    { tipo: "redireccion-faltante", nombre: "Sin redirección", campos: [
      { clave: "dispositivo", etiqueta: "Router o firewall", clase: "dispositivo", filtro: "redireccion" },
      { clave: "redireccion", etiqueta: "Redirección que se borra", clase: "redireccion" }] },
    { tipo: "dns-incorrecto", nombre: "DNS incorrecto", campos: [
      { clave: "dispositivo", etiqueta: "Equipo", clase: "dispositivo", filtro: "host" },
      { clave: "dns", etiqueta: "DNS que queda (vacío: ninguno)", clase: "ipOpcional", opcional: true }] },
    { tipo: "registro-dns-borrado", nombre: "Registro DNS borrado", campos: [
      { clave: "dispositivo", etiqueta: "Servidor DNS", clase: "dispositivo", filtro: "dns" },
      { clave: "registro", etiqueta: "Registro que se borra", clase: "registro" }] },
    { tipo: "servicio-detenido", nombre: "Servicio detenido", campos: [
      { clave: "dispositivo", etiqueta: "Servidor", clase: "dispositivo", filtro: "servicios" },
      { clave: "servicio", etiqueta: "Servicio que se detiene", clase: "servicio" }] },
    { tipo: "regla-agregada", nombre: "Regla de filtrado agregada", campos: [
      { clave: "dispositivo", etiqueta: "Router o firewall", clase: "dispositivo", filtro: "router" },
      { clave: "regla.accion", etiqueta: "Acción", clase: "accion" },
      { clave: "regla.origen", etiqueta: "Red de origen", clase: "cidr" },
      { clave: "regla.destino", etiqueta: "Red de destino", clase: "cidr" },
      { clave: "regla.protocolo", etiqueta: "Protocolo", clase: "protocoloRegla", opcional: true },
      { clave: "regla.puerto", etiqueta: "Puerto de destino", clase: "puerto", opcional: true },
      { clave: "regla.entrada", etiqueta: "Entra por", clase: "interfaz", opcional: true },
      { clave: "posicion", etiqueta: "Lugar en la lista (0: primera)", clase: "numero", opcional: true }] }
  ];
  var CAMPOS_RESULTADO = [
    { clave: "esperado", etiqueta: "Se espera", clase: "esperado" },
    { clave: "codigo", etiqueta: "Por esta causa", clase: "codigo", opcional: true, soloSi: { clave: "esperado", valor: "falla" } },
    { clave: "descripcion", etiqueta: "Descripción para el alumno", clase: "texto", opcional: true }
  ];
  var CAMPO_ORIGEN = { clave: "origen", etiqueta: "Desde", clase: "dispositivo", filtro: "conIp" };
  var TIPOS_OBJETIVO = [
    { tipo: "ping", nombre: "Ping", campos: [CAMPO_ORIGEN,
      { clave: "destino", etiqueta: "Hacia (IP o nombre)", clase: "destino" }].concat(CAMPOS_RESULTADO) },
    { tipo: "conectar", nombre: "Conectar a un servicio", campos: [CAMPO_ORIGEN,
      { clave: "destino", etiqueta: "Hacia (IP o nombre)", clase: "destino" },
      { clave: "protocolo", etiqueta: "Protocolo", clase: "protocolo" },
      { clave: "puerto", etiqueta: "Puerto", clase: "puerto" }].concat(CAMPOS_RESULTADO) },
    { tipo: "resolver", nombre: "Resolver un nombre", campos: [CAMPO_ORIGEN,
      { clave: "nombre", etiqueta: "Nombre", clase: "nombre" },
      { clave: "tipoRegistro", etiqueta: "Tipo de registro", clase: "tipoRegistro", porDefecto: "A" },
      { clave: "valor", etiqueta: "Valor esperado (opcional)", clase: "texto", opcional: true }].concat(CAMPOS_RESULTADO) }
  ];
  // Las clases cuyo parche toca otras claves del ítem.
  var CLAVES_PARCHE = { ruta: ["destino", "prefijo"], registro: ["nombre"], servicio: ["protocolo", "puerto"], redireccion: ["protocolo", "puerto"] };
  // Clases cuyas opciones son una lista; el resto se escribe.
  var CLASES_LISTA = ["dispositivo", "interfaz", "enlace", "ruta", "registro", "servicio", "redireccion", "esperado", "codigo",
    "protocolo", "protocoloRegla", "tipoRegistro", "accion"];

  // «Puerto con NAT» → «puerto con NAT»: las siglas quedan como están.
  function minusculaInicial(texto) {
    return texto.charAt(0).toLowerCase() + texto.slice(1);
  }

  function tipoDe(catalogo, tipo) {
    for (var i = 0; i < catalogo.length; i++) { if (catalogo[i].tipo === tipo) { return catalogo[i]; } }
    return null;
  }

  function leerCampo(item, clave) {
    var partes = clave.split(".");
    var v = item;
    for (var i = 0; i < partes.length; i++) {
      if (!v || typeof v !== "object") { return undefined; }
      v = v[partes[i]];
    }
    return v;
  }

  // Un valor null o "" borra el campo (un campo opcional vacío no se guarda).
  function escribirCampo(item, clave, valor) {
    var partes = clave.split(".");
    var o = item;
    for (var i = 0; i < partes.length - 1; i++) {
      if (!o[partes[i]] || typeof o[partes[i]] !== "object") { o[partes[i]] = {}; }
      o = o[partes[i]];
    }
    var ultima = partes[partes.length - 1];
    if (valor === null || valor === undefined || valor === "") { delete o[ultima]; } else { o[ultima] = valor; }
  }

  function aplicarParche(item, parche) {
    Object.keys(parche).forEach(function (k) { escribirCampo(item, k, parche[k]); });
    return item;
  }

  function nombreDisp(topologia, id) {
    var d = buscarDispositivo(topologia, id);
    return d ? (d.nombre || d.id) : String(id);
  }

  function esHostEditor(d) {
    return d.tipo !== "router" && d.tipo !== "switch-l2" && d.tipo !== "ap" && d.tipo !== "internet";
  }

  function pasaFiltroEquipo(d, filtro) {
    if (!d || d.tipo === "internet") { return false; }
    if (filtro === "router") { return d.tipo === "router"; }
    if (filtro === "host") { return esHostEditor(d); }
    if (filtro === "conIp") { return d.tipo !== "switch-l2" && d.tipo !== "ap" && !!primeraIpDe(d); }
    if (filtro === "dns") { return !!(d.servicios && d.servicios.dns); }
    if (filtro === "servicios") { return serviciosDe(d).length > 0; }
    if (filtro === "redireccion") { return d.tipo === "router" && Array.isArray(d.redirecciones) && d.redirecciones.length > 0; }
    return true;
  }

  // Los servicios que se pueden detener: los que escucha y el DNS (UDP 53).
  function serviciosDe(d) {
    var lista = [];
    var s = d && d.servicios;
    if (!s) { return lista; }
    (Array.isArray(s.escuchando) ? s.escuchando : []).forEach(function (x) {
      lista.push({ protocolo: x.protocolo, puerto: Number(x.puerto), nombre: x.nombre || "" });
    });
    if (s.dns && !lista.some(function (x) { return x.protocolo === "udp" && x.puerto === 53; })) {
      lista.push({ protocolo: "udp", puerto: 53, nombre: "DNS" });
    }
    return lista;
  }

  function textoInterfaz(f) {
    var extra = [];
    if (textoNoVacio(f.ip)) { extra.push(f.ip + "/" + f.prefijo); }
    if (f.nat) { extra.push("NAT"); }
    if (f.habilitada === false) { extra.push("deshabilitado"); }
    return f.id + (extra.length ? " (" + extra.join(", ") + ")" : "");
  }

  // Opciones de un campo de lista: [{texto, parche, elegida}], o null si el
  // campo se escribe. Las que dependen del equipo usan item.dispositivo.
  function opcionesCampo(topologia, item, campo) {
    if (CLASES_LISTA.indexOf(campo.clase) < 0) { return null; }
    var lista = [];
    function op(texto, parche) { lista.push({ texto: texto, parche: parche }); }
    function simple(valor, texto) { var p = {}; p[campo.clave] = valor; op(texto, p); }
    var dev = buscarDispositivo(topologia, item.dispositivo);
    var c = campo.clase;
    if (c === "dispositivo") {
      // Los equipos finales primero: son el origen habitual de una prueba.
      var equipos = (topologia.dispositivos || []).filter(function (d) { return pasaFiltroEquipo(d, campo.filtro); });
      equipos.filter(esHostEditor).concat(equipos.filter(function (d) { return !esHostEditor(d); })).forEach(function (d) {
        simple(d.id, d.nombre || d.id);
      });
    } else if (c === "interfaz") {
      if (campo.opcional) { simple(null, "Cualquier puerto"); }
      ((dev && dev.interfaces) || []).forEach(function (f) {
        if (campo.filtro === "conIp" && !textoNoVacio(f.ip)) { return; }
        if (campo.filtro === "nat" && !f.nat) { return; }
        simple(f.id, textoInterfaz(f));
      });
    } else if (c === "enlace") {
      (topologia.enlaces || []).forEach(function (e) {
        simple(e.id, nombreDisp(topologia, e.a.dispositivo) + " (" + e.a.interfaz + ") — " +
          nombreDisp(topologia, e.b.dispositivo) + " (" + e.b.interfaz + ")");
      });
    } else if (c === "ruta") {
      ((dev && dev.rutas) || []).forEach(function (r) {
        if (!r) { return; }
        op(r.destino + "/" + r.prefijo + " por " + (r.siguienteSalto || "?"), { destino: r.destino, prefijo: r.prefijo });
      });
    } else if (c === "registro") {
      var regs = (dev && dev.servicios && dev.servicios.dns && dev.servicios.dns.registros) || [];
      regs.forEach(function (x) {
        op(x.nombre + " " + x.tipo + " " + x.valor, { nombre: x.nombre, tipoRegistro: x.tipo });
      });
    } else if (c === "servicio") {
      serviciosDe(dev).forEach(function (x) {
        op(x.protocolo.toUpperCase() + " " + x.puerto + (x.nombre ? " (" + x.nombre + ")" : ""), { protocolo: x.protocolo, puerto: x.puerto });
      });
    } else if (c === "redireccion") {
      ((dev && dev.redirecciones) || []).forEach(function (r) {
        if (!r) { return; }
        op(String(r.protocolo || "?").toUpperCase() + " " + r.puerto + " → " + r.ipInterna + ":" + r.puertoInterno, { protocolo: r.protocolo, puerto: r.puerto });
      });
    } else if (c === "esperado") {
      simple("exito", "Que funcione");
      simple("falla", "Que falle");
    } else if (c === "codigo") {
      simple(null, "Por cualquier causa");
      Object.keys(Motor.CATALOGO).sort().forEach(function (k) { simple(k, k + " — " + Motor.CATALOGO[k].titulo); });
    } else if (c === "protocolo") {
      simple("tcp", "TCP");
      simple("udp", "UDP");
    } else if (c === "protocoloRegla") {
      simple(null, "Cualquier protocolo");
      simple("icmp", "ICMP (ping)");
      simple("tcp", "TCP");
      simple("udp", "UDP");
    } else if (c === "tipoRegistro") {
      TIPOS_REGISTRO.forEach(function (t) { simple(t, t); });
    } else if (c === "accion") {
      simple("bloquear", "Bloquear");
      simple("permitir", "Permitir");
    }
    lista.forEach(function (o) {
      o.elegida = Object.keys(o.parche).every(function (k) {
        var actual = leerCampo(item, k);
        // Sin valor, un campo con valor por defecto vale eso (resolver: A).
        if ((actual === undefined || actual === null || actual === "") && campo.porDefecto !== undefined && k === campo.clave) {
          actual = campo.porDefecto;
        }
        var nuevo = o.parche[k];
        if (nuevo === null) { return actual === undefined || actual === null || actual === ""; }
        // Una falla de registro sin tipo borra el nombre con todos sus tipos.
        if (c === "registro" && k === "tipoRegistro" && (actual === undefined || actual === null)) { return true; }
        return String(actual) === String(nuevo);
      });
    });
    return lista;
  }

  // Valor de un campo que se escribe: {valor} o {error}.
  function normalizarCampo(campo, texto) {
    var t = String(texto === undefined || texto === null ? "" : texto).trim();
    if (t === "") {
      return campo.opcional ? { valor: null } : { error: "Falta: " + minusculaInicial(campo.etiqueta) + "." };
    }
    var c = campo.clase;
    if (c === "prefijo") {
      var p = Number(t.replace(/^\//, ""));
      return esEnteroPrefijo(p) ? { valor: p } : { error: "El prefijo va de 0 a 32." };
    }
    if (c === "ip" || c === "ipOpcional") {
      return Red.esIpValida(t) ? { valor: t } : { error: "«" + t + "» no es una IP (cuatro números de 0 a 255 separados por puntos)." };
    }
    if (c === "cidr") {
      var b = parsearBloque(t);
      return b ? { valor: t } : { error: "Escribí la red como red/prefijo, por ejemplo 10.45.7.0/26 (0.0.0.0/0 es cualquiera)." };
    }
    if (c === "puerto") {
      var n = Number(t);
      return Math.floor(n) === n && n >= 1 && n <= 65535 ? { valor: n } : { error: "El puerto va de 1 a 65535." };
    }
    if (c === "numero") {
      var k = Number(t);
      return Math.floor(k) === k && k >= 0 ? { valor: k } : { error: "Escribí un número entero, 0 o más." };
    }
    if (c === "nombre") {
      return esNombreDominio(t) ? { valor: t.toLowerCase() } : { error: "«" + t + "» no es un nombre de dominio (por ejemplo www.oficina.local)." };
    }
    return { valor: t };
  }

  // Completa los campos de lista vacíos o que ya no existen con la primera
  // opción; se usa al crear un ítem y al cambiar el equipo.
  function completarItem(topologia, item, catalogo) {
    var t = tipoDe(catalogo, item.tipo);
    if (!t) { return item; }
    t.campos.forEach(function (campo) {
      var ops = opcionesCampo(topologia, item, campo);
      if (!ops || !ops.length) { return; }
      if (ops.some(function (o) { return o.elegida; })) { return; }
      if (campo.opcional) { return; }
      aplicarParche(item, ops[0].parche);
    });
    return item;
  }

  var DEFECTOS = {
    "mascara-incorrecta": { prefijo: 30 },
    "regla-agregada": { regla: { accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0" } },
    ping: { esperado: "exito" },
    conectar: { protocolo: "tcp", puerto: 80, esperado: "exito" },
    resolver: { tipoRegistro: "A", esperado: "exito" }
  };

  function nuevaFalla(topologia, tipo) {
    return completarItem(topologia, aplicarParche({ tipo: tipo }, clonar(DEFECTOS[tipo] || {})), TIPOS_FALLA);
  }

  function nuevoObjetivo(topologia, tipo) {
    return completarItem(topologia, aplicarParche({ tipo: tipo }, clonar(DEFECTOS[tipo] || {})), TIPOS_OBJETIVO);
  }

  // Un renglón para la lista del editor.
  function textoFalla(topologia, f) {
    var t = tipoDe(TIPOS_FALLA, f && f.tipo);
    if (!t) { return "Falla de tipo desconocido (" + (f && f.tipo) + ")"; }
    var quien = f.dispositivo ? nombreDisp(topologia, f.dispositivo) : "";
    var e;
    var detalle = {
      "mascara-incorrecta": quien + " " + (f.interfaz || "?") + " queda en /" + f.prefijo,
      "interfaz-deshabilitada": quien + " " + (f.interfaz || "?"),
      "ruta-faltante": quien + " pierde la ruta a " + f.destino + "/" + f.prefijo,
      "ip-duplicada": quien + " toma la IP de " + nombreDisp(topologia, f.copiarDe),
      "gateway-incorrecto": quien + " con gateway " + (f.gateway || "?"),
      "enlace-caido": (e = buscarEnlace(topologia, f.enlace))
        ? nombreDisp(topologia, e.a.dispositivo) + " — " + nombreDisp(topologia, e.b.dispositivo) : String(f.enlace),
      "nat-faltante": quien + " " + (f.interfaz || "?"),
      "redireccion-faltante": quien + ": " + String(f.protocolo || "?").toUpperCase() + " " + f.puerto,
      "dns-incorrecto": quien + " con DNS " + (f.dns || "ninguno"),
      "registro-dns-borrado": quien + ": " + f.nombre + (f.tipoRegistro ? " " + f.tipoRegistro : ""),
      "servicio-detenido": quien + ": " + String(f.protocolo || "?").toUpperCase() + " " + f.puerto,
      "regla-agregada": quien + ": " + (f.regla ? (f.regla.accion === "permitir" ? "permitir " : "bloquear ") +
        (f.regla.protocolo ? f.regla.protocolo.toUpperCase() + (f.regla.puerto ? " " + f.regla.puerto : "") + " " : "") +
        f.regla.origen + " → " + f.regla.destino : "?")
    }[f.tipo];
    return t.nombre + " · " + detalle;
  }

  function textoObjetivo(topologia, o) {
    if (!o) { return "?"; }
    var desde = nombreDisp(topologia, o.origen);
    var hacia = o.destino || "?";
    var que = o.tipo === "conectar" ? desde + " → " + hacia + " " + String(o.protocolo || "tcp").toUpperCase() + " " + (o.puerto || "?")
      : (o.tipo === "resolver" ? desde + " resuelve " + (o.nombre || "?") + (o.valor ? " (" + o.valor + ")" : "")
        : desde + " → " + hacia);
    var espera = o.esperado === "falla" ? "que falle" + (o.codigo ? " (" + o.codigo + ")" : "") : "que funcione";
    var t = tipoDe(TIPOS_OBJETIVO, o.tipo);
    return (t ? t.nombre : "Objetivo") + " · " + que + " · " + espera;
  }

  // IP de la red para sugerir destinos: [{valor, texto}].
  function sugerenciasDestino(topologia) {
    var lista = [];
    (topologia.dispositivos || []).forEach(function (d) {
      (d.interfaces || []).forEach(function (f) {
        if (textoNoVacio(f.ip)) { lista.push({ valor: f.ip, texto: (d.nombre || d.id) + " " + f.id }); }
      });
      var regs = (d.servicios && d.servicios.dns && d.servicios.dns.registros) || [];
      regs.forEach(function (x) {
        if (x.tipo === "A" || x.tipo === "CNAME") { lista.push({ valor: x.nombre, texto: "nombre en " + (d.nombre || d.id) }); }
      });
    });
    return lista;
  }

  // Problemas de un ítem contra la red: lo que falta y lo que no existe.
  function problemasItem(topologia, item, catalogo, queEs) {
    var t = tipoDe(catalogo, item && item.tipo);
    if (!t) { return ["Tipo de " + queEs + " desconocido: «" + (item && item.tipo) + "»."]; }
    var problemas = [];
    var sinEquipo = false;
    t.campos.forEach(function (campo) {
      if (campo.soloSi && leerCampo(item, campo.soloSi.clave) !== campo.soloSi.valor) { return; }
      // Sin el equipo, sus puertos, rutas o registros no se pueden revisar.
      if (sinEquipo && ["interfaz", "ruta", "registro", "servicio", "redireccion"].indexOf(campo.clase) >= 0) { return; }
      var ops = opcionesCampo(topologia, item, campo);
      if (ops) {
        var claves = CLAVES_PARCHE[campo.clase] || [campo.clave];
        var vacio = claves.every(function (k) { var v = leerCampo(item, k); return v === undefined || v === null || v === ""; });
        if (vacio) {
          if (campo.opcional || campo.porDefecto !== undefined) { return; }
          problemas.push(ops.length ? "Falta: " + minusculaInicial(campo.etiqueta) + "."
            : minusculaInicial(campo.etiqueta).replace(/^./, function (x) { return x.toUpperCase(); }) + ": no hay ninguno para elegir" +
              (item.dispositivo ? " en " + nombreDisp(topologia, item.dispositivo) : "") + ".");
          return;
        }
        if (ops.some(function (o) { return o.elegida; })) { return; }
        problemas.push(problemaReferencia(topologia, item, campo));
        if (campo.clave === "dispositivo") { sinEquipo = true; }
        return;
      }
      var n = normalizarCampo(campo, leerCampo(item, campo.clave));
      if (n.error) { problemas.push(n.error); }
    });
    return problemas;
  }

  function problemaReferencia(topologia, item, campo) {
    var c = campo.clase;
    var valor = leerCampo(item, campo.clave);
    var quien = nombreDisp(topologia, item.dispositivo);
    if (c === "dispositivo") {
      var d = buscarDispositivo(topologia, valor);
      if (!d) { return "El equipo «" + valor + "» no está en la red."; }
      var que = { router: "un router", host: "una PC, un servidor u otro equipo final", conIp: "un equipo con IP",
        dns: "un servidor DNS", servicios: "un servidor con servicios", redireccion: "un router con redirecciones de puertos" }[campo.filtro] || "un equipo válido";
      return (d.nombre || d.id) + " no es " + que + ".";
    }
    if (c === "interfaz") {
      var dev = buscarDispositivo(topologia, item.dispositivo);
      var f = dev && buscarInterfaz(dev, valor);
      if (!f) { return "El puerto " + valor + " no existe en " + quien + "."; }
      if (campo.filtro === "nat") { return "El puerto " + valor + " de " + quien + " no tiene NAT: la falla no cambiaría nada."; }
      if (campo.filtro === "conIp") { return "El puerto " + valor + " de " + quien + " no tiene IP."; }
    }
    if (c === "enlace") { return "El cable «" + valor + "» no está en la red."; }
    if (c === "ruta") { return quien + " no tiene la ruta a " + item.destino + "/" + item.prefijo + ": la falla no cambiaría nada."; }
    if (c === "registro") { return quien + " no tiene el registro " + item.nombre + (item.tipoRegistro ? " " + item.tipoRegistro : "") + "."; }
    if (c === "servicio") { return quien + " no escucha en " + String(item.protocolo).toUpperCase() + " " + item.puerto + ": la falla no cambiaría nada."; }
    if (c === "redireccion") { return quien + " no redirige " + String(item.protocolo).toUpperCase() + " " + item.puerto + ": la falla no cambiaría nada."; }
    return campo.etiqueta + ": «" + valor + "» no es una opción válida.";
  }

  function bloqueDe(escenario) {
    return escenario ? (escenario.bloqueBase || escenario.bloque || escenario.base || escenario.redBase || escenario.cidr || null) : null;
  }

  function revisarEscenario(topologia) {
    var esc = (topologia && topologia.escenario) || {};
    var informe = { fallas: [], objetivos: [], sectores: [], bloque: null };
    // Un campo en null equivale a no tenerlo: «sin DNS» es lo mismo.
    function sinNulos(clave, valor) { return valor === null ? undefined : valor; }
    var redValida = validarTopologia(topologia).ok;
    (esc.fallas || []).forEach(function (f) {
      var p = problemasItem(topologia, f, TIPOS_FALLA, "falla");
      if (!p.length) {
        var sola = clonar(topologia);
        sola.escenario = { fallas: [f] };
        var antes = clonar(topologia);
        antes.escenario = sola.escenario;
        var aplicada = aplicarFallas(sola);
        // Una falla bien armada que no cambia nada (el puerto ya estaba
        // deshabilitado, el gateway ya era ése) no le plantea nada al alumno.
        if (JSON.stringify(aplicada, sinNulos) === JSON.stringify(antes, sinNulos)) {
          p.push("La falla no cambiaría nada en la red.");
        } else if (redValida) {
          // Y una que deja la red inválida da un archivo del alumno que no
          // se puede importar (por ejemplo, una regla ICMP con puerto).
          validarTopologia(aplicada).errores.forEach(function (e) {
            p.push("Con esta falla el archivo del alumno no se podría abrir: " + e.mensaje);
          });
        }
      }
      informe.fallas.push(p);
    });
    (esc.objetivos || []).forEach(function (o) {
      informe.objetivos.push(problemasItem(topologia, o, TIPOS_OBJETIVO, "objetivo"));
    });
    var sectores = normalizarSectores(esc);
    sectores.forEach(function (s, i) {
      var p = [];
      if (!textoNoVacio(s.sector || s.nombre)) { p.push("Falta el nombre del sector."); }
      if (!(hostsPedidos(s) > 0)) { p.push("Faltan los hosts que necesita " + nombreSector(s, i) + "."); }
      var miembros = equiposSector(s);
      if (!miembros.length) { p.push(nombreSector(s, i) + " no tiene equipos ni puertos."); }
      miembros.forEach(function (m) {
        var r = resolverEntrada(topologia, m);
        if (r.error) { p.push(r.error); }
      });
      informe.sectores.push(p);
    });
    var bloque = bloqueDe(esc);
    if (sectores.length && !bloque) { informe.bloque = "Falta el bloque a repartir (por ejemplo 10.45.7.0/24)."; }
    else if (bloque && !parsearBloque(bloque)) { informe.bloque = "El bloque «" + bloque + "» no es red/prefijo."; }
    return informe;
  }

  // La red sana (la solución) contra la del alumno (con las fallas).
  function compararLaboratorio(topologia) {
    var esc = (topologia && topologia.escenario) || {};
    var objetivos = esc.objetivos || [];
    var fallas = esc.fallas || [];
    // Cada objetivo por separado: uno mal cargado no arrastra a los demás.
    function verificar(topo) {
      var estado = null;
      try { estado = Motor.crearEstado(topo); } catch (e) { estado = null; }
      return objetivos.map(function (o) {
        try { if (estado) { return verificarObjetivos(estado, [o])[0]; } } catch (e) { /* abajo */ }
        return { objetivo: o, cumple: false, codigo: null, titulo: "No se pudo probar este objetivo" };
      });
    }
    var sana = verificar(topologia);
    var alumno = verificar(aplicarFallas(topologia));
    var porFalla = fallas.map(function (f) {
      var t = clonar(topologia);
      t.escenario = { fallas: [f], objetivos: objetivos };
      var r = verificar(aplicarFallas(t));
      var rotos = [];
      r.forEach(function (x, i) { if (sana[i].cumple && !x.cumple) { rotos.push(i); } });
      return rotos;
    });
    var advertencias = [];
    if (fallas.length && !objetivos.length) {
      advertencias.push("Hay fallas pero ningún objetivo: el alumno no tiene cómo saber qué tiene que andar.");
    }
    sana.forEach(function (x, i) {
      if (!x.cumple) { advertencias.push("El objetivo " + (i + 1) + " no se cumple en la red sana: revisá la solución o el objetivo."); }
    });
    if (fallas.length && objetivos.length && alumno.every(function (x) { return x.cumple; })) {
      advertencias.push("Con las fallas aplicadas se cumplen todos los objetivos: el alumno no tiene nada que arreglar.");
    }
    if (objetivos.length) {
      porFalla.forEach(function (rotos, k) {
        if (!rotos.length) { advertencias.push("La falla " + (k + 1) + " no rompe ningún objetivo: el alumno no la va a notar."); }
      });
    }
    var desafio = null;
    if (normalizarSectores(esc).length) {
      try {
        desafio = verificarDesafio(topologia, esc);
        if (desafio.resumen.errores) {
          advertencias.push("El diseño VLSM de la red sana tiene " + desafio.resumen.errores +
            (desafio.resumen.errores === 1 ? " error" : " errores") + ": la solución no cumple el desafío.");
        }
      } catch (e) { advertencias.push("No se pudo verificar el desafío: " + e.message); }
    }
    return {
      objetivos: objetivos.map(function (o, i) { return { objetivo: o, sana: sana[i], alumno: alumno[i] }; }),
      porFalla: porFalla,
      advertencias: advertencias,
      desafio: desafio
    };
  }

  // En un desafío el alumno direcciona la red: se borra lo que puso el docente.
  function vaciarDireccionamiento(topologia) {
    (topologia.dispositivos || []).forEach(function (d) {
      if (d.tipo === "internet") { return; }
      (d.interfaces || []).forEach(function (f) { f.ip = null; f.prefijo = 24; });
      d.gateway = null;
      d.dns = null;
      d.rutas = [];
      d.dhcp = null;
      if (Array.isArray(d.redirecciones)) { d.redirecciones = []; }
    });
    return topologia;
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

  /* ---------------- Topologías físicas y de alcance ----------------
   * Ejemplos para la unidad 7: estrella, bus (medio compartido con un hub),
   * malla entre routers, y dos LAN unidas por una WAN. */
  function routerConPuertos(id, nombre, x, y, puertos, rutas) {
    return {
      id: id, tipo: "router", nombre: nombre, x: x, y: y, encendido: true,
      interfaces: puertos.map(function (p) { return interfaz(p[0], p[1], p[2] || null, p[3] || 24, true); }),
      gateway: null, dns: null, rutas: rutas || [], dhcp: null
    };
  }

  function topologiaEstrella() {
    var pcs = [
      armarPc("pc1", "PC-1", 400, 60, "192.168.1.11", 24, null),
      armarPc("pc2", "PC-2", 680, 250, "192.168.1.12", 24, null),
      armarPc("pc3", "PC-3", 400, 450, "192.168.1.13", 24, null),
      armarPc("pc4", "PC-4", 120, 250, "192.168.1.14", 24, null)
    ];
    return {
      version: 1, nombre: "Topología en estrella",
      dispositivos: [armarSwitch("sw", "SW-Centro", 400, 250)].concat(pcs),
      enlaces: pcs.map(function (pc, i) { return armarEnlace("l" + (i + 1), pc.id, "eth0", "sw", "fa0/" + (i + 1), "ethernet"); }),
      escenario: null
    };
  }

  function topologiaBus() {
    var hub = armarSwitch("hub", "HUB-Bus", 400, 280);
    hub.modelo = "hub";
    hub.interfaces = hub.interfaces.filter(function (f) { return f.medio === "ethernet"; });
    var pcs = [
      armarPc("pc1", "PC-1", 130, 80, "192.168.2.11", 24, null),
      armarPc("pc2", "PC-2", 310, 80, "192.168.2.12", 24, null),
      armarPc("pc3", "PC-3", 490, 80, "192.168.2.13", 24, null),
      armarPc("pc4", "PC-4", 670, 80, "192.168.2.14", 24, null)
    ];
    return {
      version: 1, nombre: "Bus: medio compartido con un hub",
      dispositivos: [hub].concat(pcs),
      enlaces: pcs.map(function (pc, i) { return armarEnlace("l" + (i + 1), pc.id, "eth0", "hub", "fa0/" + (i + 1), "ethernet"); }),
      escenario: null
    };
  }

  function topologiaMalla() {
    // Tres routers unidos todos con todos: cada uno llega a los otros por
    // un enlace directo.
    var ra = routerConPuertos("ra", "R-A", 400, 170, [["g0/0", "ethernet", "192.168.10.1"], ["g0/1", "ethernet", "10.0.12.1", 30], ["g0/2", "ethernet", "10.0.13.1", 30]],
      [{ destino: "192.168.20.0", prefijo: 24, siguienteSalto: "10.0.12.2" }, { destino: "192.168.30.0", prefijo: 24, siguienteSalto: "10.0.13.2" }]);
    var rb = routerConPuertos("rb", "R-B", 200, 400, [["g0/0", "ethernet", "192.168.20.1"], ["g0/1", "ethernet", "10.0.12.2", 30], ["g0/2", "ethernet", "10.0.23.1", 30]],
      [{ destino: "192.168.10.0", prefijo: 24, siguienteSalto: "10.0.12.1" }, { destino: "192.168.30.0", prefijo: 24, siguienteSalto: "10.0.23.2" }]);
    var rc = routerConPuertos("rc", "R-C", 600, 400, [["g0/0", "ethernet", "192.168.30.1"], ["g0/1", "ethernet", "10.0.13.2", 30], ["g0/2", "ethernet", "10.0.23.2", 30]],
      [{ destino: "192.168.10.0", prefijo: 24, siguienteSalto: "10.0.13.1" }, { destino: "192.168.20.0", prefijo: 24, siguienteSalto: "10.0.23.1" }]);
    return {
      version: 1, nombre: "Malla entre tres routers",
      dispositivos: [ra, rb, rc,
        armarPc("pca", "PC-A", 400, 20, "192.168.10.10", 24, "192.168.10.1"),
        armarPc("pcb", "PC-B", 40, 520, "192.168.20.10", 24, "192.168.20.1"),
        armarPc("pcc", "PC-C", 760, 520, "192.168.30.10", 24, "192.168.30.1")],
      enlaces: [
        armarEnlace("l-ab", "ra", "g0/1", "rb", "g0/1", "ethernet"),
        armarEnlace("l-ac", "ra", "g0/2", "rc", "g0/1", "ethernet"),
        armarEnlace("l-bc", "rb", "g0/2", "rc", "g0/2", "ethernet"),
        armarEnlace("l-pca", "pca", "eth0", "ra", "g0/0", "ethernet"),
        armarEnlace("l-pcb", "pcb", "eth0", "rb", "g0/0", "ethernet"),
        armarEnlace("l-pcc", "pcc", "eth0", "rc", "g0/0", "ethernet")
      ],
      escenario: null
    };
  }

  function topologiaLanWan() {
    // Dos sedes (dos LAN) unidas por un enlace WAN de fibra entre routers.
    var rc = routerConPuertos("r-centro", "R-Centro", 240, 160, [["g0/0", "ethernet", "192.168.100.1"], ["fib0", "fibra", "10.255.0.1", 30]],
      [{ destino: "192.168.200.0", prefijo: 24, siguienteSalto: "10.255.0.2" }]);
    var rn = routerConPuertos("r-norte", "R-Norte", 700, 160, [["g0/0", "ethernet", "192.168.200.1"], ["fib0", "fibra", "10.255.0.2", 30]],
      [{ destino: "192.168.100.0", prefijo: 24, siguienteSalto: "10.255.0.1" }]);
    return {
      version: 1, nombre: "Dos LAN unidas por una WAN",
      dispositivos: [rc, rn,
        armarSwitch("sw-centro", "SW-Centro", 240, 310), armarSwitch("sw-norte", "SW-Norte", 700, 310),
        armarPc("pc-c1", "PC-Centro1", 100, 460, "192.168.100.11", 24, "192.168.100.1"),
        armarPc("pc-c2", "PC-Centro2", 360, 460, "192.168.100.12", 24, "192.168.100.1"),
        armarPc("pc-n1", "PC-Norte1", 580, 460, "192.168.200.11", 24, "192.168.200.1"),
        armarPc("pc-n2", "PC-Norte2", 840, 460, "192.168.200.12", 24, "192.168.200.1")],
      enlaces: [
        armarEnlace("l-wan", "r-centro", "fib0", "r-norte", "fib0", "fibra"),
        armarEnlace("l-rc", "r-centro", "g0/0", "sw-centro", "fa0/1", "ethernet"),
        armarEnlace("l-rn", "r-norte", "g0/0", "sw-norte", "fa0/1", "ethernet"),
        armarEnlace("l-c1", "pc-c1", "eth0", "sw-centro", "fa0/2", "ethernet"),
        armarEnlace("l-c2", "pc-c2", "eth0", "sw-centro", "fa0/3", "ethernet"),
        armarEnlace("l-n1", "pc-n1", "eth0", "sw-norte", "fa0/2", "ethernet"),
        armarEnlace("l-n2", "pc-n2", "eth0", "sw-norte", "fa0/3", "ethernet")
      ],
      escenario: null
    };
  }

  // Dos sitios por internet (SRE-1031): una casa con NAT y una oficina con
  // un servidor web de IP pública, cada uno con su nube. Todas las nubes son
  // la misma internet: el paquete cruza de una a la otra.
  function topologiaDosSitios() {
    var pc = armarPc("pc-casa", "PC-Casa", 120, 440, "192.168.0.10", 24, "192.168.0.1");
    var salidaCasa = interfaz("g0/1", "ethernet", "200.45.7.2", 30, true);
    salidaCasa.nat = true;
    var rCasa = routerConPuertos("r-casa", "R-Casa", 220, 270, [["g0/0", "ethernet", "192.168.0.1"]],
      [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }]);
    rCasa.interfaces.push(salidaCasa);
    var rOficina = routerConPuertos("r-oficina", "R-Oficina", 760, 270,
      [["g0/0", "ethernet", "203.0.113.1"], ["g0/1", "ethernet", "200.51.3.2", 30]],
      [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.51.3.1" }]);
    var web = {
      id: "srv-web", tipo: "servidor", nombre: "SRV-Web", x: 860, y: 440, encendido: true,
      interfaces: [interfaz("eth0", "ethernet", "203.0.113.10", 24, true)],
      gateway: "203.0.113.1", dns: null, rutas: [], dhcp: null,
      servicios: { escuchando: [{ protocolo: "tcp", puerto: 80, nombre: "HTTP" }, { protocolo: "tcp", puerto: 443, nombre: "HTTPS" }] }
    };
    function nube(id, nombre, x, ip) {
      return {
        id: id, tipo: "internet", nombre: nombre, x: x, y: 100, encendido: true,
        interfaces: [interfaz("eth0", "ethernet", ip, 30, true)],
        gateway: null, dns: null, rutas: [], dhcp: null
      };
    }
    return {
      version: 1, nombre: "Dos sitios por internet",
      dispositivos: [pc, rCasa, nube("internet-casa", "Internet (casa)", 360, "200.45.7.1"),
        nube("internet-oficina", "Internet (oficina)", 620, "200.51.3.1"), rOficina, web],
      enlaces: [
        armarEnlace("l-casa", "pc-casa", "eth0", "r-casa", "g0/0", "ethernet"),
        armarEnlace("l-casa-inet", "r-casa", "g0/1", "internet-casa", "eth0", "ethernet"),
        armarEnlace("l-ofi-inet", "r-oficina", "g0/1", "internet-oficina", "eth0", "ethernet"),
        armarEnlace("l-ofi", "r-oficina", "g0/0", "srv-web", "eth0", "ethernet")
      ],
      escenario: null
    };
  }

  // Servidor publicado (SRE-1021): los mismos dos sitios, pero SRV-Web
  // tiene IP privada y R-Oficina hace NAT. Para que la casa llegue al
  // servidor, R-Oficina redirige su TCP 80 y 443 hacia adentro.
  function topologiaServidorPublicado() {
    var t = topologiaDosSitios();
    t.nombre = "Servidor publicado con redirección de puertos";
    t.dispositivos.forEach(function (d) {
      if (d.id === "srv-web") { d.interfaces[0].ip = "192.168.50.10"; d.gateway = "192.168.50.1"; }
      if (d.id === "r-oficina") {
        d.interfaces[0].ip = "192.168.50.1";
        d.interfaces[1].nat = true;
        d.redirecciones = [
          { protocolo: "tcp", puerto: 80, ipInterna: "192.168.50.10", puertoInterno: 80 },
          { protocolo: "tcp", puerto: 443, ipInterna: "192.168.50.10", puertoInterno: 443 }
        ];
      }
    });
    return t;
  }

  // Dos ISP unidos por peering, que compran tránsito a un proveedor mayor.
  // Las rutas estáticas reflejan la política: al cliente del otro ISP por
  // el peering; al resto de internet, por el tránsito. Direcciones de
  // documentación (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).
  function topologiaIsp() {
    var transito = routerConPuertos("transito", "Tránsito (AS 64500)", 400, 180,
      [["g0/0", "ethernet", "192.0.2.6", 30], ["g0/1", "ethernet", "192.0.2.10", 30], ["g0/2", "ethernet", "192.0.2.13", 30]],
      [{ destino: "198.51.100.0", prefijo: 24, siguienteSalto: "192.0.2.5" },
       { destino: "203.0.113.0", prefijo: 24, siguienteSalto: "192.0.2.9" },
       { destino: "192.0.2.0", prefijo: 30, siguienteSalto: "192.0.2.5" },
       { destino: "0.0.0.0", prefijo: 0, siguienteSalto: "192.0.2.14" }]);
    var ispA = routerConPuertos("isp-a", "ISP-A (AS 64501)", 180, 340,
      [["g0/0", "ethernet", "198.51.100.1", 24], ["g0/1", "ethernet", "192.0.2.1", 30], ["g0/2", "ethernet", "192.0.2.5", 30]],
      [{ destino: "203.0.113.0", prefijo: 24, siguienteSalto: "192.0.2.2" },
       { destino: "0.0.0.0", prefijo: 0, siguienteSalto: "192.0.2.6" }]);
    var ispB = routerConPuertos("isp-b", "ISP-B (AS 64502)", 620, 340,
      [["g0/0", "ethernet", "203.0.113.1", 24], ["g0/1", "ethernet", "192.0.2.2", 30], ["g0/2", "ethernet", "192.0.2.9", 30]],
      [{ destino: "198.51.100.0", prefijo: 24, siguienteSalto: "192.0.2.1" },
       { destino: "0.0.0.0", prefijo: 0, siguienteSalto: "192.0.2.10" }]);
    var nube = {
      id: "nube", tipo: "internet", nombre: "Internet", x: 400, y: 30, encendido: true,
      interfaces: [interfaz("eth0", "ethernet", "192.0.2.14", 30, true)],
      gateway: null, dns: null, rutas: [], dhcp: null
    };
    var cliA = armarPc("cli-a", "Cliente-A", 180, 500, "198.51.100.10", 24, "198.51.100.1");
    var cliB = armarPc("cli-b", "Cliente-B", 620, 500, "203.0.113.10", 24, "203.0.113.1");
    return {
      version: 1, nombre: "Dos ISP: peering y tránsito",
      dispositivos: [nube, transito, ispA, ispB, cliA, cliB],
      enlaces: [
        armarEnlace("l-peering", "isp-a", "g0/1", "isp-b", "g0/1", "ethernet"),
        armarEnlace("l-transito-a", "isp-a", "g0/2", "transito", "g0/0", "ethernet"),
        armarEnlace("l-transito-b", "isp-b", "g0/2", "transito", "g0/1", "ethernet"),
        armarEnlace("l-internet", "transito", "g0/2", "nube", "eth0", "ethernet"),
        armarEnlace("l-cli-a", "cli-a", "eth0", "isp-a", "g0/0", "ethernet"),
        armarEnlace("l-cli-b", "cli-b", "eth0", "isp-b", "g0/0", "ethernet")
      ],
      escenario: null
    };
  }

  // Oficina con su propio servidor DNS (zona oficina.local), que además
  // resuelve los nombres de internet preguntándole a la jerarquía.
  function topologiaOficinaDns() {
    var pc1 = armarPc("pc1", "PC-1", 140, 440, "192.168.10.10", 24, "192.168.10.1");
    var pc2 = armarPc("pc2", "PC-2", 340, 440, "192.168.10.11", 24, "192.168.10.1");
    pc1.dns = "192.168.10.53";
    pc2.dns = "192.168.10.53";
    var srv = {
      id: "srv-dns", tipo: "servidor", nombre: "SRV-DNS", x: 540, y: 440, encendido: true,
      interfaces: [interfaz("eth0", "ethernet", "192.168.10.53", 24, true)],
      gateway: "192.168.10.1", dns: null, rutas: [], dhcp: null,
      servicios: { escuchando: [{ protocolo: "tcp", puerto: 80, nombre: "HTTP" }], dns: { zona: "oficina.local", recursivo: true, registros: [
        { nombre: "dns.oficina.local", tipo: "A", valor: "192.168.10.53" },
        { nombre: "oficina.local", tipo: "NS", valor: "dns.oficina.local" },
        { nombre: "www.oficina.local", tipo: "A", valor: "192.168.10.53" },
        { nombre: "intranet.oficina.local", tipo: "CNAME", valor: "www.oficina.local" },
        { nombre: "correo.oficina.local", tipo: "A", valor: "192.168.10.53" },
        { nombre: "oficina.local", tipo: "MX", valor: "correo.oficina.local", prioridad: 10 }
      ] } }
    };
    var salida = interfaz("g0/1", "ethernet", "200.45.7.2", 30, true);
    salida.nat = true;
    var router = {
      id: "r1", tipo: "router", nombre: "R-Borde", x: 340, y: 120, encendido: true,
      interfaces: [interfaz("g0/0", "ethernet", "192.168.10.1", 24, true), salida,
        interfaz("fib0", "fibra", null, 24, true), interfaz("wlan0", "wireless", null, 24, false)],
      gateway: null, dns: null, rutas: [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }], dhcp: null
    };
    var nube = {
      id: "nube", tipo: "internet", nombre: "Internet", x: 620, y: 120, encendido: true,
      interfaces: [interfaz("eth0", "ethernet", "200.45.7.1", 30, true)],
      gateway: null, dns: null, rutas: [], dhcp: null
    };
    return {
      version: 1,
      nombre: "Oficina con DNS propio",
      dispositivos: [router, nube, armarSwitch("sw1", "SW-Oficina", 340, 290), pc1, pc2, srv],
      enlaces: [
        armarEnlace("l-r1", "r1", "g0/0", "sw1", "fa0/1", "ethernet"),
        armarEnlace("l-nube", "r1", "g0/1", "nube", "eth0", "ethernet"),
        armarEnlace("l-pc1", "pc1", "eth0", "sw1", "fa0/2", "ethernet"),
        armarEnlace("l-pc2", "pc2", "eth0", "sw1", "fa0/3", "ethernet"),
        armarEnlace("l-srv", "srv-dns", "eth0", "sw1", "fa0/4", "ethernet")
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
    },
    {
      id: "oficina-dns",
      nombre: "Oficina con DNS propio",
      descripcion: "Un servidor DNS con la zona oficina.local, que también resuelve los nombres de internet consultando la jerarquía.",
      topologia: topologiaOficinaDns()
    },
    {
      id: "estrella",
      nombre: "Topología en estrella",
      descripcion: "Una LAN en estrella: cuatro PC conectadas a un switch central. Si se corta un cable, se cae sólo ese equipo.",
      topologia: topologiaEstrella()
    },
    {
      id: "bus-hub",
      nombre: "Bus (medio compartido con un hub)",
      descripcion: "Cuatro PC que comparten el medio a través de un hub, como en un bus: un solo dominio de colisión.",
      topologia: topologiaBus()
    },
    {
      id: "malla",
      nombre: "Malla entre tres routers",
      descripcion: "Tres routers unidos todos con todos, cada uno con su LAN: cada red llega a las otras por un enlace directo.",
      topologia: topologiaMalla()
    },
    {
      id: "lan-wan",
      nombre: "Dos LAN unidas por una WAN",
      descripcion: "Dos sedes, cada una con su LAN, unidas por un enlace WAN de fibra entre sus routers.",
      topologia: topologiaLanWan()
    },
    {
      id: "isp-peering",
      nombre: "Dos ISP: peering y tránsito",
      descripcion: "Dos proveedores (AS 64501 y 64502) intercambian el tráfico de sus clientes por peering y compran tránsito a un proveedor mayor para llegar al resto de internet.",
      topologia: topologiaIsp()
    },
    {
      id: "dos-sitios",
      nombre: "Dos sitios por internet",
      descripcion: "Una PC en su casa, detrás de un router con NAT, consulta un servidor web de la oficina por su IP pública. Cada sitio tiene su nube, pero todas son la misma internet: el paquete cruza de una a la otra.",
      topologia: topologiaDosSitios()
    },
    {
      id: "servidor-publicado",
      nombre: "Servidor publicado con redirección de puertos",
      descripcion: "El servidor web de la oficina tiene IP privada, detrás de un router con NAT. Para publicarlo, R-Oficina redirige lo que llega a su IP pública por TCP 80 y 443 hacia SRV-Web. Desde la casa se entra por la IP pública del router.",
      topologia: topologiaServidorPublicado()
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

    // Dos sitios por internet (SRE-1031): la casa llega al servidor de la
    // oficina cruzando de una nube a la otra.
    var dosSitios = ejemploPorId("dos-sitios").topologia;
    comparar("valida dos-sitios", validarTopologia(dosSitios).ok, true);
    var webOficina = Motor.conectar(Motor.crearEstado(clonar(dosSitios)), "pc-casa", "203.0.113.10", "tcp", 80);
    comparar("dos-sitios: la casa se conecta al servidor web de la oficina",
      [webOficina.exito, webOficina.tramas.some(function (t) { return t.medio === "internet"; })], [true, true]);

    // Servidor publicado (SRE-1021): se entra por la IP pública del router.
    var publicado = ejemploPorId("servidor-publicado").topologia;
    comparar("valida servidor-publicado", validarTopologia(publicado).ok, true);
    var porRedireccion = Motor.conectar(Motor.crearEstado(clonar(publicado)), "pc-casa", "200.51.3.2", "tcp", 80);
    comparar("servidor-publicado: la casa entra por la IP pública y la atiende SRV-Web",
      [porRedireccion.exito, porRedireccion.socket && porRedireccion.socket.redirigidoA], [true, "192.168.50.10:80"]);
    var sinRedir = clonar(publicado);
    sinRedir.escenario = { fallas: [{ tipo: "redireccion-faltante", dispositivo: "r-oficina", protocolo: "tcp", puerto: 80 }] };
    var conFallaRedir = Motor.conectar(Motor.crearEstado(aplicarFallas(sinRedir)), "pc-casa", "200.51.3.2", "tcp", 80);
    comparar("falla redireccion-faltante: el router no escucha en el 80 (D31)", conFallaRedir.diagnostico && conFallaRedir.diagnostico.codigo, "D31");
    comparar("falla redireccion-faltante: el 443 sigue redirigido",
      Motor.conectar(Motor.crearEstado(aplicarFallas(sinRedir)), "pc-casa", "200.51.3.2", "tcp", 443).exito, true);
    var ofiRedir = nuevaFalla(publicado, "redireccion-faltante");
    comparar("editor: la falla nueva elige el router con redirecciones y la primera",
      [ofiRedir.dispositivo, ofiRedir.protocolo, ofiRedir.puerto], ["r-oficina", "tcp", 80]);
    comparar("editor: una redirección que no existe se informa",
      problemasItem(publicado, { tipo: "redireccion-faltante", dispositivo: "r-oficina", protocolo: "udp", puerto: 53 }, TIPOS_FALLA, "falla"),
      ["R-Oficina no redirige UDP 53: la falla no cambiaría nada."]);
    var malas = clonar(publicado);
    malas.dispositivos.forEach(function (d) { if (d.id === "r-oficina") { d.redirecciones.push({ protocolo: "icmp", puerto: 0, ipInterna: "x", puertoInterno: 70000 }); } });
    comparar("redirecciones inválidas: cuatro errores",
      validarTopologia(malas).errores.filter(function (e) { return e.campo.indexOf(".redirecciones[2]") >= 0; }).length, 4);
    var desafioRedir = clonar(publicado);
    vaciarDireccionamiento(desafioRedir);
    comparar("desafío: se borran las redirecciones con el direccionamiento",
      desafioRedir.dispositivos.filter(function (d) { return d.id === "r-oficina"; })[0].redirecciones, []);

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
      // Vuelve igual, más la anotación de con qué versión se exportó.
      var esperado = clonar(complejo);
      esperado.generador = "OpenRedLab " + VERSION_APP;
      comparar("roundtrip equivalente", JSON.stringify(res.topologia), JSON.stringify(esperado));
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
      var ofi = topologiaOficinaDns();
      comparar("servidor DNS: el ejemplo valida", validarTopologia(ofi).ok, true);
      var resOfi = Motor.consultarDns(Motor.crearEstado(ofi), "pc1", "intranet.oficina.local", "A");
      comparar("servidor DNS: el ejemplo resuelve un nombre propio", resOfi.exito && resOfi.respuesta.registros[1].valor, "192.168.10.53");
      comparar("servidor DNS: el ejemplo resuelve google.com",
        Motor.ping(Motor.crearEstado(ofi), "pc1", "google.com").exito, true);
      function conRegistro(reg) {
        var t = clonar(ofi);
        buscarDispositivo(t, "srv-dns").servicios.dns.registros.push(reg);
        return validarTopologia(t).errores.map(function (e) { return e.mensaje; }).join(" | ");
      }
      comparar("registro A con un nombre no valida",
        /es de tipo A: su valor tiene que ser una IP/.test(conRegistro({ nombre: "web.oficina.local", tipo: "A", valor: "srv" })), true);
      comparar("registro fuera de la zona no valida",
        /no pertenece a la zona oficina\.local/.test(conRegistro({ nombre: "www.otra.local", tipo: "A", valor: "10.0.0.1" })), true);
      comparar("tipo de registro inexistente no valida",
        /puede ser A, CNAME, MX, NS/.test(conRegistro({ nombre: "txt.oficina.local", tipo: "TXT", valor: "hola" })), true);
      var conPuertos = clonar(ofi);
      buscarDispositivo(conPuertos, "srv-dns").servicios.escuchando.push({ protocolo: "tcp", puerto: 8080, nombre: "Intranet" });
      comparar("servicios: catálogo y puerto propio validan", validarTopologia(conPuertos).ok, true);
      buscarDispositivo(conPuertos, "srv-dns").servicios.escuchando.push({ protocolo: "tcp", puerto: 70000 });
      comparar("servicios: puerto fuera de rango no valida",
        validarTopologia(conPuertos).errores.some(function (e) { return /va de 1 a 65535/.test(e.mensaje); }), true);
      // Topologías de la unidad 7.
      ["estrella", "bus-hub", "malla", "lan-wan"].forEach(function (id) {
        comparar("topología " + id + " valida", validarTopologia(ejemploPorId(id).topologia).ok, true);
      });
      comparar("estrella: PC-1 llega a PC-3", Motor.ping(Motor.crearEstado(topologiaEstrella()), "pc1", "192.168.1.13").exito, true);
      var domBus = Motor.dominios(Motor.crearEstado(topologiaBus()));
      comparar("bus con hub: un dominio de colisión y uno de broadcast", [domBus.colision.length, domBus.broadcast.length], [1, 1]);
      var malla = Motor.ping(Motor.crearEstado(topologiaMalla()), "pcb", "192.168.30.10");
      comparar("malla: PC-B llega a PC-C por el enlace directo", [malla.exito, malla.tramas.filter(function (t) { return t.sentido === "ida"; }).length], [true, 3]);
      var wan = Motor.ping(Motor.crearEstado(topologiaLanWan()), "pc-c1", "192.168.200.12");
      comparar("LAN y WAN: una sede llega a la otra", wan.exito, true);
      comparar("LAN y WAN: tres dominios de broadcast", Motor.dominios(Motor.crearEstado(topologiaLanWan())).broadcast.length, 3);
      // Proveedores: peering entre clientes, tránsito hacia el resto.
      comparar("ISP: el ejemplo valida", validarTopologia(topologiaIsp()).ok, true);
      var entreClientes = Motor.ping(Motor.crearEstado(topologiaIsp()), "cli-a", "203.0.113.10");
      var porDonde = (entreClientes.tramas || []).filter(function (t) { return t.sentido === "ida"; }).map(function (t) { return t.a.dispositivo; });
      comparar("ISP: entre clientes, por el peering y sin pasar por el tránsito",
        [entreClientes.exito, porDonde.indexOf("isp-b") >= 0, porDonde.indexOf("transito") < 0], [true, true, true]);
      var aGoogle = Motor.ping(Motor.crearEstado(topologiaIsp()), "cli-a", "google.com");
      comparar("ISP: hacia el resto de internet, por el tránsito",
        [aGoogle.exito, (aGoogle.tramas || []).some(function (t) { return t.a.dispositivo === "transito"; })], [true, true]);
      var sinPeering = topologiaIsp();
      buscarEnlace(sinPeering, "l-peering").estado = "down";
      comparar("ISP: sin peering, las rutas estáticas no se desvían solas",
        Motor.ping(Motor.crearEstado(sinPeering), "cli-a", "203.0.113.10").exito, false);
      var dnsEnPc = clonar(ofi);
      buscarDispositivo(dnsEnPc, "pc1").servicios = { dns: { zona: "x.local", registros: [] } };
      var conReglas = clonar(ofi);
      var rb = buscarDispositivo(conReglas, "r1");
      rb.politica = "bloquear";
      rb.reglas = [{ accion: "permitir", origen: "0.0.0.0/0", destino: "192.168.10.53/32", protocolo: "tcp", puerto: 80, entrada: "g0/1" }];
      comparar("regla con protocolo, puerto y entrada valida", validarTopologia(conReglas).ok, true);
      rb.reglas.push({ accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0", protocolo: "icmp", puerto: 7, entrada: "eth9" });
      var errsR = validarTopologia(conReglas).errores.map(function (e) { return e.mensaje; }).join(" | ");
      comparar("regla con puerto en ICMP y entrada inexistente no valida", /los puertos son de TCP o UDP/.test(errsR) && /ese puerto no existe/.test(errsR), true);
      // Captura: las consultas iterativas salen con la IP de cada servidor.
      var iter = Motor.consultarDns(Motor.crearEstado(ofi), "pc1", "wikipedia.org", "A").tramas || [];
      comparar("captura: consultas iterativas a la raíz, a .org y al autoritativo",
        ["198.41.0.4", "199.19.56.1", "208.80.154.238"].every(function (ip) { return iter.some(function (t) { return t.ipDestino === ip && t.protocolo === "DNS"; }); }), true);
      // Fallas y objetivos de servicios sobre la oficina.
      function conFalla(falla) {
        var t = clonar(ofi);
        t.escenario = { fallas: [falla], objetivos: [] };
        return Motor.crearEstado(aplicarFallas(t));
      }
      comparar("falla nat-faltante da D28", Motor.ping(conFalla({ tipo: "nat-faltante", dispositivo: "r1", interfaz: "g0/1" }), "pc1", "8.8.8.8").diagnostico.codigo, "D28");
      comparar("falla dns-incorrecto da D29",
        Motor.consultarDns(conFalla({ tipo: "dns-incorrecto", dispositivo: "pc1", dns: "192.168.10.1" }), "pc1", "google.com", "A").diagnostico.codigo, "D29");
      comparar("falla registro-dns-borrado da D25",
        Motor.consultarDns(conFalla({ tipo: "registro-dns-borrado", dispositivo: "srv-dns", nombre: "www.oficina.local" }), "pc1", "www.oficina.local", "A").diagnostico.codigo, "D25");
      comparar("falla servicio-detenido da D31",
        Motor.conectar(conFalla({ tipo: "servicio-detenido", dispositivo: "srv-dns", protocolo: "tcp", puerto: 80 }), "pc1", "192.168.10.53", "tcp", 80).diagnostico.codigo, "D31");
      comparar("falla regla-agregada da D27",
        Motor.conectar(conFalla({ tipo: "regla-agregada", dispositivo: "r1", regla: { accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0", protocolo: "tcp", puerto: 443 } }),
          "pc1", "google.com", "tcp", 443).diagnostico.codigo, "D27");
      var objs = verificarObjetivos(Motor.crearEstado(ofi), [
        { tipo: "conectar", origen: "pc1", destino: "192.168.10.53", protocolo: "tcp", puerto: 80, esperado: "exito" },
        { tipo: "conectar", origen: "pc1", destino: "192.168.10.53", protocolo: "tcp", puerto: 22, esperado: "falla", codigo: "D31" },
        { tipo: "resolver", origen: "pc1", nombre: "intranet.oficina.local", valor: "192.168.10.53", esperado: "exito" },
        { tipo: "resolver", origen: "pc1", nombre: "intranet.oficina.local", valor: "10.0.0.1", esperado: "exito" }
      ]);
      comparar("objetivos conectar y resolver", objs.map(function (o) { return o.cumple; }), [true, true, true, false]);
      // Editores del modo Docente: opciones sacadas de la red.
      var detenido = nuevaFalla(ofi, "servicio-detenido");
      var opsServ = opcionesCampo(ofi, detenido, TIPOS_FALLA.filter(function (t) { return t.tipo === "servicio-detenido"; })[0].campos[1]);
      comparar("editor: servicios del servidor, con el DNS",
        [opsServ.map(function (o) { return o.texto; }), opsServ[0].parche], [["TCP 80 (HTTP)", "UDP 53 (DNS)"], { protocolo: "tcp", puerto: 80 }]);
      var sinRuta = nuevaFalla(ofi, "ruta-faltante");
      comparar("editor: la ruta faltante sale de las rutas del router", [sinRuta.dispositivo, sinRuta.destino, sinRuta.prefijo], ["r1", "0.0.0.0", 0]);
      comparar("editor: el origen de un objetivo es un equipo final", nuevoObjetivo(ofi, "ping").origen, "pc1");
      comparar("editor: campos de texto", [normalizarCampo({ clase: "puerto", etiqueta: "Puerto" }, "99999").error !== undefined,
        normalizarCampo({ clase: "cidr", etiqueta: "Red" }, "10.0.0.0/8").valor, normalizarCampo({ clase: "ip", etiqueta: "Gateway", opcional: false }, "").error],
        [true, "10.0.0.0/8", "Falta: gateway."]);
      // Revisión del escenario contra la red.
      var conRefRota = clonar(ofi);
      conRefRota.escenario = { fallas: [
        { tipo: "interfaz-deshabilitada", dispositivo: "pc9", interfaz: "eth0" },
        { tipo: "nat-faltante", dispositivo: "r1", interfaz: "g0/0" },
        { tipo: "gateway-incorrecto", dispositivo: "pc1", gateway: "192.168.10.1" }
      ], objetivos: [{ tipo: "conectar", origen: "pc1", destino: "192.168.10.53", protocolo: "tcp", puerto: 99999, esperado: "exito" }] };
      var rev = revisarEscenario(conRefRota);
      comparar("revisión: equipo borrado, puerto sin NAT, falla sin efecto, puerto inválido", [rev.fallas[0], rev.fallas[1][0], rev.fallas[2], rev.objetivos[0]], [
        ["El equipo «pc9» no está en la red."], "El puerto g0/0 de R-Borde no tiene NAT: la falla no cambiaría nada.",
        ["La falla no cambiaría nada en la red."], ["El puerto va de 1 a 65535."]]);
      var reglaRara = clonar(ofi);
      reglaRara.escenario = { fallas: [{ tipo: "regla-agregada", dispositivo: "r1",
        regla: { accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0", protocolo: "icmp", puerto: 80 } }] };
      comparar("revisión: una falla que deja la red inválida se marca",
        /no se podría abrir: .*los puertos son de TCP o UDP/.test(revisarEscenario(reglaRara).fallas[0].join(" ")), true);
      var sinDns = clonar(ofi);
      delete buscarDispositivo(sinDns, "pc1").dns;
      sinDns.escenario = { fallas: [{ tipo: "dns-incorrecto", dispositivo: "pc1" }] };
      comparar("revisión: quitar un DNS que no había no cambia nada", revisarEscenario(sinDns).fallas[0], ["La falla no cambiaría nada en la red."]);
      var sinTipo = clonar(ofi);
      sinTipo.escenario = { objetivos: [{ tipo: "resolver", origen: "pc1", nombre: "google.com", esperado: "exito" }] };
      comparar("revisión: resolver sin tipo de registro usa A", revisarEscenario(sinTipo).objetivos[0], []);
      var sinNat = topologiaComplejo();
      sinNat.escenario = { fallas: [nuevaFalla(sinNat, "nat-faltante")] };
      comparar("revisión: sin puertos con NAT para elegir", revisarEscenario(sinNat).fallas[0], ["Puerto con NAT: no hay ninguno para elegir en R1."]);
      var plantilla = topologiaComplejoRoto();
      comparar("revisión: la plantilla del complejo no tiene problemas",
        JSON.stringify(revisarEscenario(plantilla)), JSON.stringify({ fallas: [[], [], []], objetivos: [[], []], sectores: [], bloque: null }));
      // La red sana contra la del alumno.
      var cmp = compararLaboratorio(plantilla);
      comparar("comparar: en la sana se cumple todo, en la del alumno nada, sin advertencias",
        [cmp.objetivos.map(function (x) { return [x.sana.cumple, x.alumno.cumple]; }), cmp.advertencias], [[[true, false], [true, false]], []]);
      var cableSuelto = topologiaComplejoRoto();
      cableSuelto.escenario.fallas = [{ tipo: "enlace-caido", enlace: "l-cam-pc" }];
      comparar("comparar: el cable de la cámara existe y la revisión no lo marca", revisarEscenario(cableSuelto).fallas[0], []);
      comparar("comparar: una falla que no rompe ningún objetivo se advierte",
        compararLaboratorio(cableSuelto).advertencias.indexOf("La falla 1 no rompe ningún objetivo: el alumno no la va a notar.") >= 0, true);
      // Exportar un desafío: sectores y bloque, sin direccionamiento.
      var desafio = topologiaComplejo();
      desafio.escenario = clonar(topologiaDesafioComplejo().escenario);
      var paraAlumno = JSON.parse(exportarParaAlumno(desafio));
      comparar("exportar desafío: conserva sectores y bloque, sin IP en los equipos",
        [paraAlumno.escenario.modo, paraAlumno.escenario.bloqueBase, paraAlumno.escenario.requerimientos.length,
          paraAlumno.dispositivos.filter(function (d) { return d.tipo !== "internet" && d.interfaces.some(function (f) { return f.ip; }); }).length],
        ["desafio", "10.45.7.0/24", 5, 0]);
      var conCalidad = clonar(ofi);
      conCalidad.enlaces[0].jitterMs = 3; conCalidad.enlaces[0].perdidaPct = 5;
      comparar("calidad del enlace válida", validarTopologia(conCalidad).ok, true);
      conCalidad.enlaces[0].perdidaPct = 150;
      comparar("pérdida mayor a 100 % no valida",
        validarTopologia(conCalidad).errores.some(function (e) { return /va de 0 a 100/.test(e.mensaje); }), true);
      comparar("servicio DNS en una PC no valida",
        validarTopologia(dnsEnPc).errores.some(function (e) { return /Sólo un servidor da el servicio de DNS/.test(e.mensaje); }), true);
      buscarDispositivo(conNube, "r1").interfaces[0].nat = true;
      comparar("NAT en un puerto de router valida", validarTopologia(conNube).ok, true);
      var natPc = clonar(r8);
      buscarDispositivo(natPc, "pc-adm").interfaces[0].nat = true;
      comparar("NAT en una PC no valida", validarTopologia(natPc).errores.some(function (e) { return /Sólo los routers y los firewalls hacen NAT/.test(e.mensaje); }), true);
      buscarDispositivo(natPc, "pc-adm").interfaces[0].nat = "si";
      comparar("NAT que no es booleano no valida", validarTopologia(natPc).ok, false);
      var faltante = clonar(r8);
      buscarDispositivo(faltante, "r1").interfaces.pop();
      comparar("router con puertos a gusto valida", validarTopologia(faltante).ok, true);
      var demasiados = clonar(r8);
      for (var extra = 1; extra <= 7; extra++) {
        buscarDispositivo(demasiados, "r1").interfaces.push(interfaz("ether" + (8 + extra), "ethernet", null, 24, true));
      }
      comparar("router con 17 puertos no valida", validarTopologia(demasiados).ok, false);
    })();

    // Modelos y nombres de puertos: el modelo da el estilo de nombres.
    (function () {
      var topo = topologiaComplejo();
      var r1 = buscarDispositivo(topo, "r1");
      comparar("puerto nuevo de fibra en el router estándar", nombrePuertoLibre(r1, "fibra"), "fib1");
      comparar("puerto nuevo de cobre en el router de 8 puertos",
        nombrePuertoLibre(buscarDispositivo(topologiaRouter8(), "r1"), "ethernet"), "ether9");
      var cambio = cambiarModelo(topo, "r1", "8-puertos");
      comparar("cambiar a 8 puertos renombra en orden", r1.interfaces.map(function (f) { return f.id; }),
        ["ether1", "ether2", "sfp1", "wlan1"]);
      comparar("cambiar a 8 puertos conserva la IP", r1.interfaces[0].ip, "10.45.7.65");
      comparar("cambiar a 8 puertos sigue los cables", cambio.ok && topo.enlaces.some(function (e) {
        return (e.a.dispositivo === "r1" && e.a.interfaz === "ether1") || (e.b.dispositivo === "r1" && e.b.interfaz === "ether1");
      }), true);
      comparar("cambiar de modelo no rompe el ping",
        Motor.ping(Motor.crearEstado(topo), "pc-admin", "10.45.7.122").exito, true);
      comparar("cambiar de modelo deja una topología válida", validarTopologia(topo).ok, true);
      cambiarModelo(topo, "r1", "firewall");
      comparar("el firewall llama wan a su primer cobre", r1.interfaces.map(function (f) { return f.id; }),
        ["wan", "lan1", "sfp1", "wlan1"]);
      comparar("puerto nuevo de cobre en el firewall", nombrePuertoLibre(r1, "ethernet"), "lan2");
    })();

    (function () {
      var topo = topologiaDesafioComplejo();
      cambiarModelo(topo, "r1", "8-puertos");
      var adm = normalizarSectores(topo.escenario).filter(function (x) { return x.sector === "Administración"; })[0];
      comparar("cambiar de modelo actualiza los sectores del desafío", adm.dispositivos.indexOf("r1:ether1") >= 0, true);
    })();

    (function () {
      var topo = topologiaComplejo();
      var conHub = clonar(topo);
      comparar("switch a hub sigue los cables y valida", cambiarModelo(conHub, "sw-admin", "hub").ok &&
        validarTopologia(conHub).ok && buscarDispositivo(conHub, "sw-admin").interfaces.length, 8);
      comparar("switch a 24 puertos", cambiarModelo(topo, "sw-admin", "24-puertos").ok &&
        buscarDispositivo(topo, "sw-admin").interfaces.length, 25);
      comparar("switch de 24 puertos valida", validarTopologia(topo).ok, true);
      topo.enlaces.push({ id: "l-x", a: { dispositivo: "sw-admin", interfaz: "fa0/20" }, b: { dispositivo: "cam1", interfaz: "wlan0" },
        tipo: "ethernet", estado: "up", velocidadMbps: 100, retardoMs: 1 });
      comparar("no se achica un switch con cables en los puertos que sobran", cambiarModelo(topo, "sw-admin", null).ok, false);
      var raro = topologiaComplejo();
      buscarDispositivo(raro, "sw-admin").modelo = "12-puertos";
      comparar("modelo de switch desconocido no valida", validarTopologia(raro).ok, false);
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

    // Versionado: cadena de migraciones con un formato de ensayo 2, formato del
    // futuro, y el generador al exportar.
    (function () {
      var ensayo = { 1: function (t) { t.dispositivos = t.dispositivos.map(function (d) { var c = clonar(d); c.etiquetaEnsayo = d.id; return c; }); return t; } };
      var original = clonar(basica);
      var m = migrarCon(original, ensayo, 2);
      comparar("versionado: la migración de ensayo llega al formato 2", [m.ok, m.topologia && m.topologia.version], [true, 2]);
      comparar("versionado: la migración aplica el paso", m.topologia.dispositivos[0].etiquetaEnsayo, original.dispositivos[0].id);
      comparar("versionado: la migración no toca el original", [original.version, original.dispositivos[0].etiquetaEnsayo], [1, undefined]);
      var hueco = migrarCon(clonar(basica), {}, 3);
      comparar("versionado: un salto sin migración es un error", [hueco.ok, hueco.errores.length && hueco.errores[0].campo], [false, "version"]);
      comparar("versionado: el formato actual no necesita migración", migrarTopologia(clonar(basica)).topologia, basica);

      var futuro = clonar(basica);
      futuro.version = VERSION_FORMATO + 1;
      futuro.generador = "OpenRedLab 9.0.0";
      var rf = importar(JSON.stringify(futuro));
      comparar("versionado: un formato del futuro se rechaza nombrando quién lo hizo",
        [rf.ok, rf.errores.length === 1 && rf.errores[0].mensaje.indexOf("OpenRedLab 9.0.0, más nuevo que este") >= 0], [false, true]);
      delete futuro.generador;
      var rf2 = importar(JSON.stringify(futuro));
      comparar("versionado: sin generador, el mensaje nombra el formato",
        [rf2.ok, rf2.errores[0].mensaje.indexOf("formato más nuevo (" + (VERSION_FORMATO + 1) + ")") >= 0], [false, true]);

      var exp = JSON.parse(exportar(basica));
      comparar("versionado: el archivo exportado anota versión y generador", [exp.version, exp.generador], [VERSION_FORMATO, "OpenRedLab " + VERSION_APP]);
      comparar("versionado: exportar no modifica la red", basica.generador, undefined);
      var viejo = clonar(basica);
      viejo.generador = "OpenRedLab 0.9.0";
      comparar("versionado: un generador viejo se reemplaza", JSON.parse(exportar(viejo)).generador, "OpenRedLab " + VERSION_APP);
      var vuelta = importar(exportar(basica));
      comparar("versionado: ida y vuelta", [vuelta.ok, exportar(vuelta.topologia) === exportar(basica)], [true, true]);
      comparar("versionado: exportar para el alumno también anota el generador",
        JSON.parse(exportarParaAlumno(basica)).generador, "OpenRedLab " + VERSION_APP);
      comparar("versionado: VERSION_APP es semver", /^\d+\.\d+\.\d+$/.test(VERSION_APP), true);
    })();

    return { total: total, pasadas: pasadas, fallos: fallos };
  }

  return {
    VERSION_APP: VERSION_APP,
    VERSION_FORMATO: VERSION_FORMATO,
    EJEMPLOS: EJEMPLOS,
    validarTopologia: validarTopologia,
    migrarTopologia: migrarTopologia,
    exportar: exportar,
    importar: importar,
    aplicarFallas: aplicarFallas,
    exportarParaAlumno: exportarParaAlumno,
    verificarObjetivos: verificarObjetivos,
    verificarDesafio: verificarDesafio,
    nombrePuertoLibre: nombrePuertoLibre,
    cambiarModelo: cambiarModelo,
    PUERTOS_ROUTER_MAX: PUERTOS_ROUTER_MAX,
    detectarSectores: detectarSectores,
    TIPOS_FALLA: TIPOS_FALLA,
    TIPOS_OBJETIVO: TIPOS_OBJETIVO,
    opcionesCampo: opcionesCampo,
    normalizarCampo: normalizarCampo,
    leerCampo: leerCampo,
    escribirCampo: escribirCampo,
    aplicarParche: aplicarParche,
    completarItem: completarItem,
    nuevaFalla: nuevaFalla,
    nuevoObjetivo: nuevoObjetivo,
    textoFalla: textoFalla,
    textoObjetivo: textoObjetivo,
    sugerenciasDestino: sugerenciasDestino,
    revisarEscenario: revisarEscenario,
    compararLaboratorio: compararLaboratorio,
    verificarDiseno: verificarDiseno,
    autopruebas: autopruebas
  };
})();
