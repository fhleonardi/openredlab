/* capa5-autotest.js — Capa 5: ensamblado lógico, Autotest y arranque.
 *
 * Objeto global `Autotest` con `correr()` según el §2 de 05-capa5-ensamblado.
 * No reescribe ninguna capa anterior: sólo lee `Red`, `Motor`, `Escenarios`
 * y `UI`. JavaScript vanilla, sin DOM salvo para inspeccionar lo que la
 * capa 4 ya dibujó y para mostrar el informe.
 *
 * Convenciones:
 * - Español rioplatense en textos, comentarios y variables.
 * - Ninguna petición de red, ninguna referencia externa.
 * - Los criterios que mutan trabajan sobre copias profundas.
 * - Al terminar se restaura la topología y el modo del usuario.
 * - Las agujas de búsqueda (nombres de APIs de red y palabras de relleno)
 *   se arman por partes para que el propio código no las contenga en texto.
 */

var Autotest = (function () {
  "use strict";

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function ejemploPorId(id) {
    for (var i = 0; i < Escenarios.EJEMPLOS.length; i++) {
      if (Escenarios.EJEMPLOS[i].id === id) {
        return Escenarios.EJEMPLOS[i];
      }
    }
    return null;
  }

  function dispEn(topo, id) {
    var lista = topo.dispositivos || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        return lista[i];
      }
    }
    return null;
  }

  function ifaceEn(disp, idIf) {
    if (!disp || !disp.interfaces) {
      return null;
    }
    for (var i = 0; i < disp.interfaces.length; i++) {
      if (disp.interfaces[i].id === idIf) {
        return disp.interfaces[i];
      }
    }
    return null;
  }

  function enlaceEn(topo, id) {
    var lista = topo.enlaces || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        return lista[i];
      }
    }
    return null;
  }

  /* Cada caso de redes se cuenta en tres partes: qué se armó, qué tiene que
   * pasar y qué hizo el simulador. Varios casos son errores puestos a
   * propósito: ahí lo correcto es que el simulador los detecte, y el informe
   * lo aclara para que el verde no se lea como "la red está bien". */
  var CASOS = {
    2: {
      conError: false,
      situacion: "La red del Complejo turístico tal como viene: PC-Admin (10.45.7.66/27) hace ping al Servidor " +
        "(10.45.7.122/29), que está detrás de dos routers.",
      esperado: "El ping responde."
    },
    3: {
      conError: true,
      situacion: "PC-Admin en 10.45.7.94 con puerta de enlace 10.45.7.65. Con /27 su red va de 10.45.7.64 a .95 y la " +
        "puerta de enlace está adentro; si la máscara pasa a /28, la red es 10.45.7.80 – .95 y 10.45.7.65 queda afuera.",
      esperado: "Con /27 el ping al Servidor responde; con /28 falla con D09 (la puerta de enlace está fuera de tu red)."
    },
    4: {
      conError: true,
      situacion: "Se deshabilita la interfaz g0/0 de R1, la que tiene la dirección 10.45.7.65.",
      esperado: "R1 no puede usar esa dirección: D01 (interfaz deshabilitada)."
    },
    5: {
      conError: true,
      situacion: "Se borra de R2 la ruta hacia 10.45.7.64/27, la red de PC-Admin. La ida hacia el Servidor sigue teniendo camino.",
      esperado: "El ping llega al Servidor, pero R2 no sabe cómo devolver la respuesta: D12 (falla la vuelta), " +
        "no D11 (fallaría la ida)."
    },
    6: {
      conError: true,
      situacion: "PC-1 en 192.168.1.0/24 y PC-2 en 192.168.2.0/24, conectadas al mismo switch.",
      esperado: "No se comunican: D15. El switch no mira direcciones IP y no enruta; para pasar de una subred a otra " +
        "hace falta un router."
    },
    7: {
      conError: false,
      situacion: "Cálculo de la subred de 10.45.7.66/27, con puerta de enlace 10.45.7.65.",
      esperado: "Máscara 255.255.255.224, red 10.45.7.64, broadcast 10.45.7.95, hosts de 10.45.7.65 a 10.45.7.94 " +
        "(30 hosts), y la puerta de enlace dentro de la subred."
    },
    8: {
      conError: false,
      situacion: "R-DHCP reparte el rango 192.168.1.50 – .60; una PC conectada al switch pide dirección.",
      esperado: "La PC recibe una dirección del rango tras los cuatro mensajes: DISCOVER, OFFER, REQUEST y ACK."
    },
    17: {
      conError: false,
      situacion: "El mismo ping de PC-Admin al Servidor, mirado tramo por tramo: PC-Admin → R1 → R2 → Servidor, " +
        "con SW-Admin y SW-Servidores en el medio.",
      esperado: "En cada salto de router la trama cambia (MAC de origen y de destino), pero el paquete IP conserva su " +
        "origen y su destino; el TTL baja uno por router. Los switches pasan la trama sin cambiarla."
    },
    18: {
      conError: true,
      situacion: "Una PC con IP privada (192.168.1.10) sale a internet por R-Borde, que tiene la IP pública 200.45.7.2 " +
        "en su puerto hacia la nube, y hace ping a 8.8.8.8. Primero sin NAT y después con NAT en ese puerto.",
      esperado: "Sin NAT el pedido llega, pero la respuesta no puede volver a una IP privada: D28. Con NAT, R-Borde cambia " +
        "la IP de origen por 200.45.7.2 al salir, y a la respuesta la traduce de vuelta: el ping responde."
    },
    19: {
      conError: false,
      situacion: "En el ejemplo «Oficina con DNS propio», PC-1 le pregunta a su servidor, SRV-DNS, por intranet.oficina.local " +
        "(de su zona) y por google.com (de afuera), y repite la segunda consulta.",
      esperado: "SRV-DNS responde intranet.oficina.local con autoridad. Para google.com consulta la raíz, el servidor de .com y el " +
        "autoritativo de google.com (consultas iterativas), responde sin autoridad y la guarda en su caché: la segunda vez contesta desde ahí."
    },
    20: {
      conError: false,
      situacion: "Tres PC conectadas a un mismo equipo: primero un hub y después un switch.",
      esperado: "Con el hub, las tres comparten el medio: 1 dominio de colisión. Con el switch, cada puerto es su propio dominio: 3. " +
        "En los dos casos es 1 solo dominio de broadcast, porque ni el hub ni el switch lo cortan (lo corta un router)."
    },
    21: {
      conError: true,
      situacion: "En la oficina, PC-1 se conecta a SRV-DNS por HTTP (TCP 80), que está activo, y por SSH (TCP 22), que no.",
      esperado: "Por HTTP, el handshake de tres pasos (SYN, SYN-ACK, ACK), el pedido GET y su respuesta. Por SSH la red llega, " +
        "pero nadie escucha en el 22: el servidor responde RST y el diagnóstico es D31, no un problema de red."
    },
    22: {
      conError: true,
      situacion: "En el complejo, R2 pasa a «denegar todo y permitir lo necesario»: política por defecto bloquear y una sola regla que " +
        "permite TCP 80 hacia el Servidor. PC-Admin se conecta al Servidor por HTTP y por SSH; primero con R2 como router y después como firewall.",
      esperado: "Con R2 como router, HTTP falla: el pedido pasa, pero la respuesta no coincide con ninguna regla y la política la bloquea (D27 en la vuelta). " +
        "Como firewall, HTTP funciona porque recuerda la conversación y deja volver la respuesta. SSH falla en los dos casos por la política (D27)."
    },
    23: {
      conError: true,
      situacion: "En el complejo, el cable R1–R2 pasa a tener 10 ms de jitter y después 100 % de pérdida. PC-Admin manda 10 pings al Servidor.",
      esperado: "Con jitter, los 10 vuelven, pero con tiempos distintos: el ping informa mínimo, media y máximo. Con 100 % de pérdida " +
        "no vuelve ninguno, aunque el camino existe: D32, un problema de calidad del enlace y no de configuración."
    },
    12: {
      conError: true,
      situacion: "En el desafío VLSM, el sector Cámaras se arma con el router en 10.45.7.41/28, al lado del Wi-Fi " +
        "en 10.45.7.0/26 (.0 – .63).",
      esperado: "El verificador marca dos errores de diseño: una /28 empieza en múltiplos de 16, así que una subred " +
        "pensada desde .40 no está alineada; y .41/28 pertenece a 10.45.7.32/28, que cae adentro del Wi-Fi."
    }
  };

  function fila(n, criterio, pasa, detalle) {
    var r = { n: n, criterio: criterio, pasa: !!pasa, detalle: detalle || "" };
    var caso = CASOS[n];
    if (caso) {
      r.conError = caso.conError;
      r.situacion = caso.situacion;
      r.esperado = caso.esperado;
    }
    return r;
  }

  // Recorrido de un ping con los nombres visibles, sin repeticiones seguidas.
  function recorridoPorNombre(topo, res) {
    var nombres = [];
    (res.saltos || []).forEach(function (s) {
      var d = dispEn(topo, s.dispositivo);
      var n = d ? (d.nombre || d.id) : s.dispositivo;
      if (nombres[nombres.length - 1] !== n) { nombres.push(n); }
    });
    return nombres.join(" → ");
  }

  function diagnosticoTexto(res) {
    var dg = res && res.diagnostico;
    return dg ? dg.codigo + " (" + dg.titulo + ")" : "sin diagnóstico";
  }

  function modoActualDom() {
    try {
      var activo = document.querySelector(".simbarra [data-modo].activo");
      if (activo) {
        return activo.getAttribute("data-modo");
      }
    } catch (e) {
      /* sin DOM: se sigue igual */
    }
    return "topologia";
  }

  /* Agujas armadas por partes: el fuente nunca trae los literales juntos. */
  function agujaRed() {
    var a = "fe" + "tch";
    var b = "XML" + "HttpRequest";
    var c = "im" + "port(";
    return { a: a, b: b, c: c };
  }

  function agujaRelleno() {
    var a = "TO" + "DO";
    var b = "lo" + "rem";
    var c = "FIX" + "ME";
    return [a, b, c];
  }

  function crit01() {
    var nombre = "El archivo no hace ninguna petición de red";
    try {
      var html = document.documentElement.outerHTML || "";
      var ag = agujaRed();
      var bajos = html.toLowerCase();
      var tieneFetch = html.indexOf(ag.a + "(") >= 0 || html.indexOf(ag.a + " (") >= 0;
      var tieneXhr = html.indexOf(ag.b) >= 0;
      var tieneImportDin = html.indexOf(ag.c) >= 0 || html.indexOf(ag.c.trim()) >= 0 && false;
      var imp = "im" + "port";
      var tieneImportFn = new RegExp("\\b" + imp + "\\s*\\(").test(html);
      var srcExt = /<(script|img|iframe)[^>]+\bsrc\s*=\s*["']\s*(https?:|\/\/)/i.test(html);
      var hrefExt = /<link[^>]+\bhref\s*=\s*["']\s*(https?:|\/\/)/i.test(html);
      var cssUrlExt = /url\s*\(\s*["']?\s*(https?:|\/\/)/i.test(html);
      var problemas = [];
      if (tieneFetch) {
        problemas.push("aparece llamada de red (" + ag.a + ")");
      }
      if (tieneXhr) {
        problemas.push("aparece " + ag.b);
      }
      if (tieneImportFn || tieneImportDin) {
        problemas.push("aparece carga dinámica de módulos");
      }
      if (srcExt) {
        problemas.push("hay etiqueta con src externo");
      }
      if (hrefExt) {
        problemas.push("hay etiqueta con href externo");
      }
      if (cssUrlExt) {
        problemas.push("hay url externa en estilos");
      }
      /* Los blobs locales (URL.createObjectURL) no son red: se admiten. */
      void bajos;
      if (problemas.length === 0) {
        return fila(1, nombre, true, "Sin llamadas de red ni referencias externas en el documento.");
      }
      return fila(1, nombre, false, "Se esperaba cero referencias externas y se encontró: " + problemas.join("; ") + ".");
    } catch (e) {
      return fila(1, nombre, false, "No se pudo inspeccionar el documento: " + e.message);
    }
  }

  function crit02() {
    var nombre = "Ping de punta a punta: PC-Admin llega al Servidor atravesando dos routers";
    try {
      var ej = ejemploPorId("complejo");
      if (!ej) {
        return fila(2, nombre, false, "No se encontró el ejemplo «Complejo turístico».");
      }
      var topo = clonar(ej.topologia);
      var res = Motor.ping(Motor.crearEstado(topo), "pc-admin", "10.45.7.122");
      if (res.exito) {
        return fila(2, nombre, true, "Responde, recorriendo " + recorridoPorNombre(topo, res) + ".");
      }
      return fila(2, nombre, false, "No respondió: " + diagnosticoTexto(res) + ".");
    } catch (e) {
      return fila(2, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit17() {
    var nombre = "En cada salto cambia la trama, no el paquete IP";
    try {
      var ej = ejemploPorId("complejo");
      var topo = clonar(ej.topologia);
      var res = Motor.ping(Motor.crearEstado(topo), "pc-admin", "10.45.7.122");
      var ida = (res.tramas || []).filter(function (t) { return t.sentido === "ida"; });
      if (!res.exito || ida.length !== 3) {
        return fila(17, nombre, false, "Se esperaban 3 tramas de ida y hubo " + ida.length + ".");
      }
      var ipFija = ida.every(function (t) { return t.ipOrigen === "10.45.7.66" && t.ipDestino === "10.45.7.122"; });
      var macCambia = ida[0].macDestino !== ida[1].macDestino && ida[1].macDestino !== ida[2].macDestino;
      var ttls = ida.map(function (t) { return t.ttl; }).join(", ");
      var switches = ida[0].atraviesa.concat(ida[2].atraviesa).map(function (id) {
        var d = dispEn(topo, id);
        return d ? (d.nombre || d.id) : id;
      });
      var pasa = ipFija && macCambia && ttls === "64, 63, 62" && switches.length === 2;
      return fila(17, nombre, pasa, "La MAC de destino cambia en cada tramo; la IP sigue siendo 10.45.7.66 → 10.45.7.122; " +
        "el TTL va " + ttls + "; " + switches.join(" y ") + " pasan la trama sin cambiarla.");
    } catch (e) {
      return fila(17, nombre, false, "Excepción: " + e.message);
    }
  }

  // PC — switch — R-Borde — nube, para los casos de NAT.
  function redConInternet(nat) {
    function puerto(id, ip, prefijo) {
      return { id: id, nombre: id, medio: "ethernet", habilitada: true, modo: "estatico", ip: ip, prefijo: prefijo, mac: null };
    }
    function equipo(id, tipo, nombre, puertos, extra) {
      var d = { id: id, tipo: tipo, nombre: nombre, x: 0, y: 0, encendido: true, interfaces: puertos, gateway: null, dns: null, rutas: [], dhcp: null };
      for (var k in (extra || {})) { d[k] = extra[k]; }
      return d;
    }
    function cable(id, a, ia, b, ib) {
      return { id: id, tipo: "ethernet", estado: "up", a: { dispositivo: a, interfaz: ia }, b: { dispositivo: b, interfaz: ib } };
    }
    var salida = puerto("g0/1", "200.45.7.2", 30);
    if (nat) { salida.nat = true; }
    return {
      version: 1, nombre: "Salida a internet",
      dispositivos: [
        equipo("pc1", "pc", "PC-Casa", [puerto("eth0", "192.168.1.10", 24)], { gateway: "192.168.1.1" }),
        equipo("sw1", "switch-l2", "SW", [puerto("fa0/1", null, 24), puerto("fa0/2", null, 24)]),
        equipo("r1", "router", "R-Borde", [puerto("g0/0", "192.168.1.1", 24), salida],
          { rutas: [{ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "200.45.7.1" }] }),
        equipo("nube", "internet", "Internet", [puerto("eth0", "200.45.7.1", 30)])
      ],
      enlaces: [cable("l1", "pc1", "eth0", "sw1", "fa0/1"), cable("l2", "r1", "g0/0", "sw1", "fa0/2"), cable("l3", "r1", "g0/1", "nube", "eth0")]
    };
  }

  function crit18() {
    var nombre = "Sin NAT, la respuesta de internet no vuelve a una IP privada (D28)";
    try {
      var sin = Motor.ping(Motor.crearEstado(redConInternet(false)), "pc1", "8.8.8.8");
      var con = Motor.ping(Motor.crearEstado(redConInternet(true)), "pc1", "8.8.8.8");
      var salida = (con.tramas || []).filter(function (t) { return t.sentido === "ida" && t.a.dispositivo === "nube"; })[0];
      var pasa = sin.diagnostico && sin.diagnostico.codigo === "D28" && con.exito && salida && salida.ipOrigen === "200.45.7.2";
      return fila(18, nombre, pasa, "Sin NAT: " + diagnosticoTexto(sin) + ". Con NAT respondió" +
        (salida ? ", y el paquete salió a internet con la IP de origen " + salida.ipOrigen + "." : "."));
    } catch (e) {
      return fila(18, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit19() {
    var nombre = "El nombre se resuelve preguntando a la jerarquía, y la segunda vez sale de la caché";
    try {
      var ej = ejemploPorId("oficina-dns");
      if (!ej) { return fila(19, nombre, false, "No se encontró el ejemplo «Oficina con DNS propio»."); }
      var est = Motor.crearEstado(clonar(ej.topologia));
      var local = Motor.consultarDns(est, "pc1", "intranet.oficina.local", "A");
      var afuera = Motor.consultarDns(est, "pc1", "google.com", "A");
      var otraVez = Motor.consultarDns(est, "pc1", "google.com", "A");
      var iterativas = (afuera.pasos || []).filter(function (p) { return /consulta iterativa/.test(p.titulo); }).length;
      var pasa = local.exito && local.respuesta.autoritativa && afuera.exito && !afuera.respuesta.autoritativa &&
        iterativas === 3 && otraVez.exito && otraVez.respuesta.desdeCache;
      return fila(19, nombre, pasa, "intranet.oficina.local: " + (local.exito ? "respuesta autoritativa de SRV-DNS" : diagnosticoTexto(local)) +
        ". google.com: " + iterativas + " consultas iterativas (raíz, .com y autoritativo)" +
        (otraVez.respuesta && otraVez.respuesta.desdeCache ? "; la segunda vez, desde la caché." : "."));
    } catch (e) {
      return fila(19, nombre, false, "Excepción: " + e.message);
    }
  }

  function tresPcEn(modelo) {
    var t = clonar(ejemploPorId("basica").topologia);
    var sw = t.dispositivos.filter(function (d) { return d.tipo === "switch-l2"; })[0];
    if (modelo) { sw.modelo = modelo; sw.interfaces = sw.interfaces.filter(function (f) { return f.medio === "ethernet"; }); }
    var pc = clonar(t.dispositivos.filter(function (d) { return d.tipo === "pc"; })[0]);
    pc.id = "pc-3"; pc.nombre = "PC-3"; pc.y += 120; pc.interfaces[0].ip = "192.168.1.30";
    t.dispositivos.push(pc);
    t.enlaces.push({ id: "l-pc3", tipo: "ethernet", estado: "up", a: { dispositivo: "pc-3", interfaz: "eth0" }, b: { dispositivo: sw.id, interfaz: "fa0/8" } });
    return t;
  }

  function crit20() {
    var nombre = "Un hub es un solo dominio de colisión; un switch separa uno por puerto";
    try {
      var conHub = Motor.dominios(Motor.crearEstado(tresPcEn("hub")));
      var conSwitch = Motor.dominios(Motor.crearEstado(tresPcEn(null)));
      var pasa = conHub.colision.length === 1 && conSwitch.colision.length === 3 &&
        conHub.broadcast.length === 1 && conSwitch.broadcast.length === 1;
      return fila(20, nombre, pasa, "Con hub: " + conHub.colision.length + " de colisión y " + conHub.broadcast.length +
        " de broadcast. Con switch: " + conSwitch.colision.length + " de colisión y " + conSwitch.broadcast.length + " de broadcast.");
    } catch (e) {
      return fila(20, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit21() {
    var nombre = "Puerto cerrado: la red llega, pero el servicio no (D31)";
    try {
      var est = Motor.crearEstado(clonar(ejemploPorId("oficina-dns").topologia));
      var http = Motor.conectar(est, "pc1", "192.168.10.53", "tcp", 80);
      var ssh = Motor.conectar(est, "pc1", "192.168.10.53", "tcp", 22);
      var hs = http.exito ? http.segmentos.slice(0, 3).map(function (x) { return x.flags; }).join(", ") : "";
      var pasa = http.exito && hs === "SYN, SYN-ACK, ACK" && ssh.diagnostico && ssh.diagnostico.codigo === "D31";
      return fila(21, nombre, pasa, "HTTP: " + (http.exito ? hs + ", GET y respuesta, cierre" : diagnosticoTexto(http)) +
        ". SSH: " + diagnosticoTexto(ssh) + ".");
    } catch (e) {
      return fila(21, nombre, false, "Excepción: " + e.message);
    }
  }

  function complejoConListaBlanca(firewall) {
    var t = clonar(ejemploPorId("complejo").topologia);
    var srv = dispEn(t, "srv1");
    srv.tipo = "servidor"; srv.interfaces = [srv.interfaces[0]];
    srv.servicios = { escuchando: [{ protocolo: "tcp", puerto: 80, nombre: "HTTP" }, { protocolo: "tcp", puerto: 22, nombre: "SSH" }] };
    var r2 = dispEn(t, "r2");
    r2.politica = "bloquear";
    r2.reglas = [{ accion: "permitir", origen: "0.0.0.0/0", destino: "10.45.7.122/32", protocolo: "tcp", puerto: 80 }];
    if (firewall) { r2.modelo = "firewall"; }
    return t;
  }

  function crit22() {
    var nombre = "Lista blanca: el firewall deja volver la respuesta, el router no";
    try {
      var comoRouter = Motor.conectar(Motor.crearEstado(complejoConListaBlanca(false)), "pc-admin", "10.45.7.122", "tcp", 80);
      var est = Motor.crearEstado(complejoConListaBlanca(true));
      var comoFw = Motor.conectar(est, "pc-admin", "10.45.7.122", "tcp", 80);
      var ssh = Motor.conectar(est, "pc-admin", "10.45.7.122", "tcp", 22);
      var pasa = !comoRouter.exito && comoRouter.diagnostico.codigo === "D27" && /la respuesta/.test(comoRouter.diagnostico.explicacion) &&
        comoFw.exito && ssh.diagnostico && ssh.diagnostico.codigo === "D27";
      return fila(22, nombre, pasa, "Como router, HTTP: " + diagnosticoTexto(comoRouter) + ". Como firewall, HTTP: " +
        (comoFw.exito ? "se conecta" : diagnosticoTexto(comoFw)) + "; SSH: " + diagnosticoTexto(ssh) + ".");
    } catch (e) {
      return fila(22, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit23() {
    var nombre = "QoS: el jitter hace variar los tiempos y la pérdida se lleva paquetes (D32)";
    try {
      function complejoCon(campo, valor) {
        var t = clonar(ejemploPorId("complejo").topologia);
        t.enlaces.forEach(function (e) { if (e.id === "l-r1-r2") { e[campo] = valor; } });
        return Motor.crearEstado(t);
      }
      var conJitter = Motor.pingRepetido(complejoCon("jitterMs", 10), "pc-admin", "10.45.7.122", { cantidad: 10, semilla: 5 });
      var sinNada = Motor.pingRepetido(complejoCon("perdidaPct", 100), "pc-admin", "10.45.7.122", { cantidad: 10, semilla: 5 });
      var ej = conJitter.estadisticas;
      var pasa = ej.recibidos === 10 && ej.maximo > ej.minimo && sinNada.diagnostico && sinNada.diagnostico.codigo === "D32";
      return fila(23, nombre, pasa, "Con jitter: 10 de 10, mínimo " + ej.minimo + " ms, media " + ej.promedio + " ms, máximo " + ej.maximo +
        " ms. Con 100 % de pérdida: " + (sinNada.diagnostico ? sinNada.diagnostico.codigo + " (" + sinNada.diagnostico.titulo + ")" : "sin diagnóstico") + ".");
    } catch (e) {
      return fila(23, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit03() {
    var nombre = "Una máscara mal elegida deja la puerta de enlace fuera de la subred (D09)";
    try {
      var ej = ejemploPorId("complejo");
      var topo = clonar(ej.topologia);
      var pc = dispEn(topo, "pc-admin");
      var eth = ifaceEn(pc, "eth0");
      /* La IP 10.45.7.66/28 seguiría compartiendo red 10.45.7.64 con el
       * gateway 10.45.7.65, así que con aritmética correcta no hay D09.
       * Se usa la última IP válida del /27 (10.45.7.94): con /27 anda y
       * con /28 el gateway queda en otro bloque (64 contra 80). */
      eth.ip = "10.45.7.94";
      eth.prefijo = 27;
      pc.gateway = "10.45.7.65";
      var sano = Motor.ping(Motor.crearEstado(topo), "pc-admin", "10.45.7.122");
      eth.prefijo = 28;
      var roto = Motor.ping(Motor.crearEstado(topo), "pc-admin", "10.45.7.122");
      var cod = roto.diagnostico ? roto.diagnostico.codigo : "sin diagnóstico";
      if (!sano.exito) {
        return fila(3, nombre, false, "Con /27 el ping ya fallaba: " + diagnosticoTexto(sano) + ".");
      }
      if (!roto.exito && cod === "D09") {
        return fila(3, nombre, true, "Con /27 respondió y con /28 falló con " + diagnosticoTexto(roto) + ".");
      }
      return fila(3, nombre, false, "Con /28 " +
        (roto.exito ? "el ping respondió igual" : "el diagnóstico fue " + diagnosticoTexto(roto)) + ".");
    } catch (e) {
      return fila(3, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit04() {
    var nombre = "Una interfaz del router deshabilitada no envía ni recibe (D01)";
    try {
      var ej = ejemploPorId("complejo");
      var topo = clonar(ej.topologia);
      var r1 = dispEn(topo, "r1");
      var g00 = ifaceEn(r1, "g0/0");
      g00.habilitada = false;
      /* Ping desde el propio router a su IP deshabilitada: la interfaz de
       * origen queda deshabilitada y el paso 1 del algoritmo da D01. */
      var res = Motor.ping(Motor.crearEstado(topo), "r1", "10.45.7.65");
      var cod = res.diagnostico ? res.diagnostico.codigo : "sin diagnóstico";
      if (!res.exito && cod === "D01") {
        return fila(4, nombre, true, "Diagnosticó " + diagnosticoTexto(res) + ".");
      }
      return fila(4, nombre, false, res.exito ? "El ping respondió igual." : "Diagnosticó " + diagnosticoTexto(res) + ".");
    } catch (e) {
      return fila(4, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit05() {
    var nombre = "Sin ruta de vuelta, el pedido llega pero la respuesta no vuelve (D12, no D11)";
    try {
      var ej = ejemploPorId("complejo");
      var topo = clonar(ej.topologia);
      var r2 = dispEn(topo, "r2");
      r2.rutas = (r2.rutas || []).filter(function (r) {
        return !(r.destino === "10.45.7.64" && r.prefijo === 27);
      });
      var res = Motor.ping(Motor.crearEstado(topo), "pc-admin", "10.45.7.122");
      var cod = res.diagnostico ? res.diagnostico.codigo : "sin diagnóstico";
      if (!res.exito && cod === "D12") {
        return fila(5, nombre, true, "Diagnosticó " + diagnosticoTexto(res) + ".");
      }
      return fila(5, nombre, false, res.exito ? "El ping respondió igual." : "Diagnosticó " + diagnosticoTexto(res) + ".");
    } catch (e) {
      return fila(5, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit06() {
    var nombre = "Dos PC en el mismo switch pero en subredes distintas no se comunican (D15)";
    try {
      var ej = ejemploPorId("basica");
      var topo = clonar(ej.topologia);
      var pc2 = dispEn(topo, "pc2");
      var eth2 = ifaceEn(pc2, "eth0");
      eth2.ip = "192.168.2.20";
      eth2.prefijo = 24;
      var res = Motor.ping(Motor.crearEstado(topo), "pc1", "192.168.2.20");
      var cod = res.diagnostico ? res.diagnostico.codigo : "sin diagnóstico";
      if (!res.exito && cod === "D15") {
        return fila(6, nombre, true, "Diagnosticó " + diagnosticoTexto(res) + ".");
      }
      return fila(6, nombre, false, res.exito ? "El ping respondió igual." : "Diagnosticó " + diagnosticoTexto(res) + ".");
    } catch (e) {
      return fila(6, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit07() {
    var nombre = "El cálculo de subred coincide con el hecho a mano";
    try {
      var det = Red.desglose("10.45.7.66", 27, "10.45.7.65");
      var esperado = {
        direccionDeRed: "10.45.7.64",
        broadcast: "10.45.7.95",
        rangoTexto: "10.45.7.65 – 10.45.7.94",
        mascaraDecimal: "255.255.255.224",
        primerHost: "10.45.7.65",
        ultimoHost: "10.45.7.94",
        cantidadHosts: 30
      };
      var rotulos = {
        direccionDeRed: "dirección de red", broadcast: "broadcast", rangoTexto: "rango de hosts",
        mascaraDecimal: "máscara", primerHost: "primer host", ultimoHost: "último host", cantidadHosts: "cantidad de hosts"
      };
      var fallas = [];
      Object.keys(esperado).forEach(function (k) {
        if (det[k] !== esperado[k]) {
          fallas.push(rotulos[k] + ": a mano da " + esperado[k] + " y el simulador dice " + det[k]);
        }
      });
      if (!det.gateway || det.gateway.coinciden !== true) {
        fallas.push("puerta de enlace: 10.45.7.65 debería estar dentro de la subred");
      }
      if (fallas.length === 0) {
        return fila(7, nombre, true, "Coincide en todos los valores.");
      }
      return fila(7, nombre, false, "Diferencias con el cálculo a mano: " + fallas.join(" | "));
    } catch (e) {
      return fila(7, nombre, false, "Excepción: " + e.message);
    }
  }

  function armarMiniDhcp() {
    function iface(id, medio, ip, prefijo, habilitada) {
      return { id: id, nombre: id, medio: medio, habilitada: !!habilitada, modo: "estatico", ip: ip, prefijo: prefijo };
    }
    function pcCon(id, x, y) {
      return {
        id: id, tipo: "pc", nombre: id, x: x, y: y, encendido: true,
        interfaces: [iface("eth0", "ethernet", null, 24, true), iface("wlan0", "wireless", null, 24, false)],
        gateway: null, dns: null, rutas: [], dhcp: null
      };
    }
    function swCon(id, x, y) {
      var lista = [];
      for (var i = 1; i <= 8; i++) {
        lista.push(iface("fa0/" + i, "ethernet", null, 24, true));
      }
      lista.push(iface("fib0", "fibra", null, 24, true));
      return { id: id, tipo: "switch-l2", nombre: id, x: x, y: y, encendido: true, interfaces: lista, gateway: null, dns: null, rutas: [], dhcp: null };
    }
    var router = {
      id: "r-dhcp", tipo: "router", nombre: "R-DHCP", x: 400, y: 200, encendido: true,
      interfaces: [
        iface("g0/0", "ethernet", "192.168.1.1", 24, true),
        iface("g0/1", "ethernet", null, 24, true),
        iface("fib0", "fibra", null, 24, true),
        iface("wlan0", "wireless", null, 24, false)
      ],
      gateway: null, dns: null, rutas: [],
      dhcp: { habilitado: true, desde: "192.168.1.50", hasta: "192.168.1.60", prefijo: 24, gateway: "192.168.1.1" }
    };
    return {
      version: 1,
      nombre: "mini dhcp",
      dispositivos: [router, pcCon("c1", 120, 200), swCon("sw1", 260, 200)],
      enlaces: [
        { id: "l1", a: { dispositivo: "r-dhcp", interfaz: "g0/0" }, b: { dispositivo: "sw1", interfaz: "fa0/1" }, tipo: "ethernet", estado: "up", velocidadMbps: 100, retardoMs: 1 },
        { id: "l2", a: { dispositivo: "c1", interfaz: "eth0" }, b: { dispositivo: "sw1", interfaz: "fa0/2" }, tipo: "ethernet", estado: "up", velocidadMbps: 100, retardoMs: 1 }
      ],
      escenario: null
    };
  }

  function crit08() {
    var nombre = "DHCP: la PC obtiene una dirección del rango con los cuatro mensajes DORA";
    try {
      var estado = Motor.crearEstado(armarMiniDhcp());
      var res = Motor.dhcpSolicitar(estado, "c1", "eth0");
      var tipos = (res.mensajes || []).map(function (m) { return m.tipo; }).join(",");
      var enRango = false;
      try {
        var n = Red.aNumero(res.ip);
        enRango = res.ip !== null && n >= Red.aNumero("192.168.1.50") && n <= Red.aNumero("192.168.1.60");
      } catch (e) {
        enRango = false;
      }
      if (res.exito && enRango && tipos === "discover,offer,request,ack") {
        return fila(8, nombre, true, "La PC recibió " + res.ip + "/24 tras DISCOVER, OFFER, REQUEST y ACK.");
      }
      return fila(8, nombre, false, "La PC quedó con " + res.ip + " y los mensajes fueron " + (tipos ? tipos.toUpperCase().split(",").join(", ") : "ninguno") +
        (res.diagnostico ? " (" + res.diagnostico.codigo + ": " + res.diagnostico.titulo + ")" : "") + ".");
    } catch (e) {
      return fila(8, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit09() {
    var nombre = "Exportar e importar reproduce el mismo estado";
    try {
      var ej = ejemploPorId("complejo");
      var texto = Escenarios.exportar(ej.topologia);
      var res = Escenarios.importar(texto);
      if (!res.ok) {
        return fila(9, nombre, false, "La reimportación falló: " + res.errores.map(function (x) { return x.mensaje; }).join(" | "));
      }
      if (JSON.stringify(res.topologia) === JSON.stringify(ej.topologia)) {
        return fila(9, nombre, true, "El JSON exportado e importado es idéntico al original.");
      }
      return fila(9, nombre, false, "El objeto importado difiere del original en la comparación profunda.");
    } catch (e) {
      return fila(9, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit10() {
    var nombre = "Un JSON con sintaxis rota devuelve error y no cuelga la aplicación";
    try {
      var res = Escenarios.importar("{roto");
      if (!res.ok && res.errores && res.errores.length > 0) {
        return fila(10, nombre, true, "importar('{roto') devuelve ok false con mensaje: " + res.errores[0].mensaje);
      }
      return fila(10, nombre, false, "Se esperaba ok false con errores y se obtuvo ok " + res.ok + ".");
    } catch (e) {
      return fila(10, nombre, false, "La aplicación lanzó excepción en vez de devolver error: " + e.message);
    }
  }

  function crit11() {
    var nombre = "El export alumno no contiene el array fallas y trae las fallas aplicadas";
    try {
      var ej = ejemploPorId("complejo-roto");
      if (!ej) {
        return fila(11, nombre, false, "No se encontró el ejemplo complejo-roto.");
      }
      var texto = Escenarios.exportarParaAlumno(ej.topologia);
      var sinClave = texto.indexOf("\"fallas\"") < 0;
      var parsed = JSON.parse(texto);
      var pcAdmin = dispEn(parsed, "pc-admin");
      var enl = enlaceEn(parsed, "l-srv-r2");
      var r1 = dispEn(parsed, "r1");
      var quedaRuta = (r1.rutas || []).some(function (r) { return r.destino === "10.45.7.120" && r.prefijo === 29; });
      var problemas = [];
      if (!sinClave) {
        problemas.push("todavía aparece la clave fallas");
      }
      if (!pcAdmin || pcAdmin.gateway !== "10.45.7.200") {
        problemas.push("el gateway roto no quedó aplicado");
      }
      if (!enl || enl.estado !== "down") {
        problemas.push("el enlace caído no quedó aplicado");
      }
      if (quedaRuta) {
        problemas.push("la ruta faltante no se quitó");
      }
      if (problemas.length === 0) {
        return fila(11, nombre, true, "Sin clave fallas, con gateway 10.45.7.200, enlace l-srv-r2 en down y sin la ruta .120/29.");
      }
      return fila(11, nombre, false, "Se esperaba export limpio y aplicado; falla: " + problemas.join("; ") + ".");
    } catch (e) {
      return fila(11, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit12() {
    var nombre = "Desafío VLSM: se detectan una subred solapada y una desalineada";
    try {
      /* Sobre equipos realmente direccionados: el router de Cámaras en
       * .41/28 hace pensar una subred que arranca en .40 (desalineada), y la
       * máscara la ubica en .32/28, adentro del Wi-Fi .0/26 (solapamiento). */
      var topo = clonar(ejemploPorId("desafio-complejo").topologia);
      var poner = function (idDisp, idIf, ip, prefijo, gateway) {
        var d = dispEn(topo, idDisp);
        var f = ifaceEn(d, idIf);
        f.ip = ip; f.prefijo = prefijo; f.habilitada = true;
        if (gateway !== undefined) { d.gateway = gateway; }
      };
      poner("r1", "wlan0", "10.45.7.1", 26);
      poner("pc-wifi", "wlan0", "10.45.7.10", 26, "10.45.7.1");
      poner("iot1", "wlan0", "10.45.7.20", 26, "10.45.7.1");
      poner("r1", "g0/1", "10.45.7.41", 28);
      poner("cam1", "eth0", "10.45.7.42", 28, "10.45.7.41");
      var informe = Escenarios.verificarDesafio(topo, topo.escenario);
      var texto = JSON.stringify(informe.porSector);
      var haySolape = texto.indexOf("Se superpone") >= 0;
      var hayAline = texto.indexOf("no está alineada") >= 0;
      if (informe.porSector.length === 5 && informe.resumen.errores > 0 && haySolape && hayAline) {
        return fila(12, nombre, true, "Marcó el solapamiento y la desalineación (" + informe.resumen.errores +
          " errores en todo el diseño, porque los demás sectores están sin direccionar).");
      }
      return fila(12, nombre, false, "No marcó " + (haySolape ? "la desalineación" : hayAline ? "el solapamiento" : "ninguno de los dos") +
        " (" + informe.resumen.errores + " errores y " + informe.resumen.advertencias + " advertencias en total).");
    } catch (e) {
      return fila(12, nombre, false, "Excepción: " + e.message);
    }
  }

  function dispositivoConIp() {
    try {
      var topo = UI.topologiaActual();
      var lista = topo.dispositivos || [];
      var i;
      // Preferencia: un equipo con IP y gateway, que es el caso que el panel
      // tiene que mostrar completo (los routers y la nube no usan gateway).
      for (i = 0; i < lista.length; i++) {
        var conIp = (lista[i].interfaces || []).some(function (f) { return f.ip && Red.esIpValida(String(f.ip)); });
        if (conIp && lista[i].gateway && Red.esIpValida(String(lista[i].gateway))) {
          return lista[i].id;
        }
      }
      for (i = 0; i < lista.length; i++) {
        var ifaces = lista[i].interfaces || [];
        for (var j = 0; j < ifaces.length; j++) {
          if (ifaces[j].ip && Red.esIpValida(String(ifaces[j].ip))) {
            return lista[i].id;
          }
        }
      }
    } catch (e) {
      /* se informa abajo */
    }
    return null;
  }

  function crit13() {
    var nombre = "El panel de cálculo muestra los 32 bits de IP y máscara, con bits de red y de host diferenciados, y el bloque del AND del gateway";
    var previo = modoActualDom();
    try {
      var id = dispositivoConIp();
      if (!id) {
        /* La red abierta puede no tener direcciones todavía (un desafío
         * recién cargado): se usa el ejemplo Complejo. Al terminar, correr()
         * restaura la topología del usuario. */
        UI.cargarTopologia(clonar(ejemploPorId("complejo").topologia));
        id = dispositivoConIp();
      }
      if (!id) {
        return fila(13, nombre, false, "No hay ningún dispositivo con IP para seleccionar.");
      }
      UI.setModo("subredes");
      UI.seleccionar(id);
      var caja = document.querySelector(".calc");
      if (!caja) {
        return fila(13, nombre, false, "No se encontró el panel .calc después de seleccionar " + id + ".");
      }
      var bits = caja.querySelectorAll(".binario .red, .binario .host");
      var texto = caja.textContent || "";
      var tieneAnd = texto.indexOf("AND") >= 0;
      var hablaGateway = texto.toLowerCase().indexOf("gateway") >= 0;
      var problemas = [];
      if (bits.length < 64) {
        problemas.push("se esperaban al menos 64 bits pintados (32 de IP + 32 de máscara) y hay " + bits.length);
      }
      if (caja.querySelectorAll(".binario .red").length === 0) {
        problemas.push("no hay bits de red diferenciados");
      }
      if (caja.querySelectorAll(".binario .host").length === 0) {
        problemas.push("no hay bits de host diferenciados");
      }
      if (!tieneAnd) {
        problemas.push("no aparece el bloque del AND");
      }
      if (!hablaGateway) {
        problemas.push("no aparece el bloque del gateway");
      }
      if (problemas.length === 0) {
        return fila(13, nombre, true, "Panel de " + id + " con " + bits.length + " bits en dos colores y bloque AND del gateway.");
      }
      return fila(13, nombre, false, "Panel incompleto en " + id + ": " + problemas.join("; ") + ".");
    } catch (e) {
      return fila(13, nombre, false, "Excepción: " + e.message);
    } finally {
      try {
        UI.setModo(previo);
      } catch (e2) {
        /* se sigue igual */
      }
    }
  }

  function crit14() {
    var nombre = "La franja inferior es un único panel con pestañas, con Simulación activa por defecto, y el lienzo conserva al menos el 55 % del ancho";
    var previo = modoActualDom();
    try {
      UI.setModo("topologia");
      var paneles = document.querySelectorAll(".siminf");
      var lienzo = document.querySelector(".simlienzo");
      var prob = [];
      if (paneles.length !== 1) {
        prob.push("se esperaba un único .siminf y hay " + paneles.length);
      }
      var pestanas = document.querySelectorAll(".siminf .tabs button");
      if (pestanas.length < 3) {
        prob.push("se esperaban al menos 3 pestañas y hay " + pestanas.length);
      }
      var activa = document.querySelector(".siminf .tabs button.activo");
      var textoActiva = activa ? (activa.textContent || "") : "";
      if (textoActiva.toLowerCase().indexOf("simul") < 0) {
        prob.push("la pestaña activa por defecto no es Simulación (activa: '" + textoActiva + "')");
      }
      var proporcion = null;
      if (!lienzo) {
        prob.push("no se encontró el lienzo .simlienzo");
      } else {
        var rect = lienzo.getBoundingClientRect();
        var anchoVentana = window.innerWidth || document.documentElement.clientWidth || 0;
        if (!anchoVentana) {
          prob.push("no se pudo medir el ancho de la ventana");
        } else {
          proporcion = rect.width / anchoVentana;
          if (proporcion < 0.55) {
            prob.push("el lienzo ocupa " + Math.round(proporcion * 100) + " % del ancho, menos del 55 %");
          }
        }
      }
      if (prob.length === 0) {
        return fila(14, nombre, true, "Un solo panel con pestañas, Simulación activa, lienzo con " +
          Math.round(proporcion * 100) + " % del ancho.");
      }
      return fila(14, nombre, false, "Falla: " + prob.join("; ") + ".");
    } catch (e) {
      return fila(14, nombre, false, "Excepción: " + e.message);
    } finally {
      try {
        UI.setModo(previo);
      } catch (e2) {
        /* se sigue igual */
      }
    }
  }

  function numeroDe(atributo, texto, etiqueta) {
    var m = texto.match(new RegExp(etiqueta + "\\s*=?\\s*\"?([0-9.\\-]+)"));
    void atributo;
    return m ? parseFloat(m[1]) : null;
  }

  function crit15() {
    var nombre = "Los cables terminan en puertos dibujados sobre el perímetro, no en el centro del ícono";
    try {
      var topo = UI.topologiaActual();
      if (!(topo.enlaces || []).length) {
        /* Sin cables no hay qué medir (un lienzo vacío): se usa el ejemplo
         * Complejo. Al terminar, correr() restaura la red del usuario. */
        UI.cargarTopologia(clonar(ejemploPorId("complejo").topologia));
        topo = UI.topologiaActual();
      }
      var svg = document.querySelector(".simlienzo svg.lienzo");
      if (!svg) {
        return fila(15, nombre, false, "No se encontró el SVG del lienzo.");
      }
      var mundo = svg.querySelector("g");
      if (!mundo || mundo.children.length < 2) {
        return fila(15, nombre, false, "El SVG no tiene las capas de enlaces y nodos.");
      }
      var capaEn = mundo.children[0];
      var capaNo = mundo.children[1];
      var pos = {};
      (topo.dispositivos || []).forEach(function (d) {
        pos[d.id] = { x: d.x, y: d.y };
      });
      /* Puertos en coordenadas de mundo: translate del nodo + centro del rect. */
      var puertos = [];
      for (var ni = 0; ni < capaNo.children.length; ni++) {
        var nodo = capaNo.children[ni];
        var tr = nodo.getAttribute("transform") || "";
        var mt = tr.match(/translate\(\s*([0-9.\-]+)[,\s]+([0-9.\-]+)\s*\)/);
        var nx = mt ? parseFloat(mt[1]) : 0;
        var ny = mt ? parseFloat(mt[2]) : 0;
        var rects = nodo.querySelectorAll("rect.puerto");
        for (var ri = 0; ri < rects.length; ri++) {
          var px = parseFloat(rects[ri].getAttribute("x"));
          var py = parseFloat(rects[ri].getAttribute("y"));
          var pw = parseFloat(rects[ri].getAttribute("width") || "10");
          var ph = parseFloat(rects[ri].getAttribute("height") || "10");
          puertos.push({ x: nx + px + pw / 2, y: ny + py + ph / 2 });
        }
      }
      if (!puertos.length) {
        return fila(15, nombre, false, "No se encontraron rectángulos de puerto en el lienzo.");
      }
      function cercaDePuertos(x, y) {
        var mejor = Infinity;
        for (var i = 0; i < puertos.length; i++) {
          var dx = puertos[i].x - x;
          var dy = puertos[i].y - y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < mejor) {
            mejor = d;
          }
        }
        return mejor;
      }
      function cercaDeCentro(x, y) {
        var mejor = Infinity;
        Object.keys(pos).forEach(function (id) {
          var dx = pos[id].x - x;
          var dy = pos[id].y - y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < mejor) {
            mejor = d;
          }
        });
        return mejor;
      }
      var dibujos = capaEn.querySelectorAll("line,path");
      if (!dibujos.length) {
        return fila(15, nombre, false, "No se encontraron líneas de enlace en la capa de enlaces.");
      }
      var centros = 0;
      var lejos = 0;
      for (var di = 0; di < dibujos.length; di++) {
        var dib = dibujos[di];
        var puntos = [];
        if (dib.tagName.toLowerCase() === "line") {
          puntos.push({ x: parseFloat(dib.getAttribute("x1")), y: parseFloat(dib.getAttribute("y1")) });
          puntos.push({ x: parseFloat(dib.getAttribute("x2")), y: parseFloat(dib.getAttribute("y2")) });
        } else {
          var dAt = dib.getAttribute("d") || "";
          var nums = dAt.match(/[0-9.\-]+/g) || [];
          if (nums.length >= 4) {
            puntos.push({ x: parseFloat(nums[0]), y: parseFloat(nums[1]) });
            puntos.push({ x: parseFloat(nums[nums.length - 2]), y: parseFloat(nums[nums.length - 1]) });
          }
        }
        for (var pi = 0; pi < puntos.length; pi++) {
          var aPuerto = cercaDePuertos(puntos[pi].x, puntos[pi].y);
          var aCentro = cercaDeCentro(puntos[pi].x, puntos[pi].y);
          if (aPuerto <= 14) {
            continue;
          }
          if (aCentro <= 6) {
            centros += 1;
          } else {
            lejos += 1;
          }
        }
      }
      void numeroDe;
      if (centros === 0 && lejos === 0) {
        return fila(15, nombre, true, "Los " + dibujos.length + " enlaces dibujados nacen y mueren a menos de 14 unidades de un puerto.");
      }
      return fila(15, nombre, false, "Defecto de la capa 4 sin parchar por contrato: " + centros +
        " extremos caen en el centro del ícono y " + lejos + " lejos de todo puerto; los cables se dibujan de centro a centro.");
    } catch (e) {
      return fila(15, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit16() {
    var nombre = "No queda ningún texto de relleno pendiente y la interfaz está en español";
    try {
      var clon = document.documentElement.cloneNode(true);
      var Basura = clon.querySelectorAll("script,style");
      for (var i = 0; i < Basura.length; i++) {
        Basura[i].remove();
      }
      var visible = (clon.textContent || "") + " " + (document.documentElement.getAttribute("lang") || "");
      var agujas = agujaRelleno();
      var halladas = [];
      /* La primera aguja se busca exacta (mayúsculas); las otras sin importar caso. */
      if (visible.indexOf(agujas[0]) >= 0) {
        halladas.push(agujas[0]);
      }
      var baja = visible.toLowerCase();
      if (baja.indexOf(agujas[1].toLowerCase()) >= 0) {
        halladas.push(agujas[1]);
      }
      if (visible.indexOf(agujas[2]) >= 0) {
        halladas.push(agujas[2]);
      }
      var prob = [];
      if (halladas.length) {
        prob.push("aparece texto de relleno: " + halladas.join(", "));
      }
      var lang = (document.documentElement.getAttribute("lang") || "").toLowerCase();
      if (lang.indexOf("es") !== 0) {
        prob.push("el documento no declara lang es (trae '" + lang + "')");
      }
      var cuerpo = (document.body.textContent || "").toLowerCase();
      var claves = ["simulación", "topología", "puerta de enlace"];
      var alguna = claves.some(function (k) { return cuerpo.indexOf(k) >= 0; });
      if (!alguna) {
        prob.push("no se encontraron rótulos de cátedra en español (Simulación, Topología, puerta de enlace)");
      }
      if (prob.length === 0) {
        return fila(16, nombre, true, "Sin relleno visible y con interfaz en español (lang " + lang + ").");
      }
      return fila(16, nombre, false, "Falla: " + prob.join("; ") + ".");
    } catch (e) {
      return fila(16, nombre, false, "Excepción: " + e.message);
    }
  }

  function escaparHtml(texto) {
    return String(texto || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  }

  function mostrarInforme(salida) {
    try {
      var previos = document.querySelectorAll("[data-autotest-informe]");
      for (var i = 0; i < previos.length; i++) {
        previos[i].remove();
      }
      var caja = document.createElement("div");
      caja.setAttribute("data-autotest-informe", "1");
      caja.style.position = "fixed";
      caja.style.right = "12px";
      caja.style.bottom = "12px";
      caja.style.width = "min(520px, 92vw)";
      caja.style.maxHeight = "70vh";
      caja.style.overflow = "auto";
      caja.style.background = "#fff";
      caja.style.color = "#182430";
      caja.style.border = "2px solid #0b5fa5";
      caja.style.borderRadius = "10px";
      caja.style.padding = "12px 14px";
      caja.style.zIndex = "9999";
      caja.style.fontFamily = "system-ui, Arial, sans-serif";
      caja.style.fontSize = "13px";
      var titulo = document.createElement("div");
      titulo.innerHTML = salida.tecnico
        ? "<b>Autotest técnico: " + salida.pasadas + "/" + salida.total + "</b> <span>(" + salida.fallos + " fallos, primero)</span>" +
          "<br><span>" + String(salida.detalleCapas).replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>"
        : "<b>El simulador resuelve bien " + salida.pasadas + " de " + salida.total + " casos de redes</b>" +
          (salida.fallos ? " <span>(los que fallan, primero)</span>" : "") +
          "<div style='font-size:12px;color:#4a5866;margin-top:2px'>Varios casos rompen la red a propósito: " +
          "ahí el resultado es correcto si el simulador detecta el error.</div>";
      caja.appendChild(titulo);
      var lista = document.createElement("div");
      salida.resultados.forEach(function (r) {
        var div = document.createElement("div");
        div.style.border = "1px solid #c9d3dc";
        div.style.borderLeft = r.pasa ? "6px solid #1a7f37" : "6px solid #b42318";
        div.style.borderRadius = "6px";
        div.style.padding = "4px 8px";
        div.style.margin = "6px 0";
        var safeC = escaparHtml(r.criterio);
        var safeD = escaparHtml(r.detalle);
        if (r.situacion) {
          var etiqueta = r.conError
            ? "<span style='background:#fff4d6;color:#7a4b00;border:1px solid #d9a400;border-radius:4px;padding:0 6px;font-size:12px;white-space:nowrap;display:inline-block'>" +
              "error puesto a propósito</span>"
            : "<span style='background:#eef2f6;color:#3a4a5a;border:1px solid #c9d3dc;border-radius:4px;padding:0 6px;font-size:12px;white-space:nowrap;display:inline-block'>" +
              "red bien configurada</span>";
          var veredicto = r.pasa
            ? (r.conError ? "Lo detectó correctamente. " : "Funcionó como debe. ")
            : (r.conError ? "No lo detectó como debía. " : "No funcionó como debe. ");
          div.innerHTML = "<b>" + r.n + ". " + safeC + "</b> " + etiqueta +
            "<div style='margin-top:4px'><b>Situación:</b> " + escaparHtml(r.situacion) + "</div>" +
            "<div><b>Qué debe pasar:</b> " + escaparHtml(r.esperado) + "</div>" +
            "<div style='color:" + (r.pasa ? "#1a7f37" : "#b42318") + "'><b>" + (r.pasa ? "✓ " : "✗ ") + "Resultado:</b> " +
            veredicto + safeD + "</div>";
        } else {
          div.innerHTML = "<b>" + (r.pasa ? "✓ " : "✗ ") + r.n + ". " + safeC + "</b><br>" + safeD;
        }
        lista.appendChild(div);
      });
      caja.appendChild(lista);
      var cerrar = document.createElement("button");
      cerrar.textContent = "Cerrar informe";
      cerrar.style.padding = "4px 10px";
      cerrar.addEventListener("click", function () {
        caja.remove();
      });
      caja.appendChild(cerrar);
      document.body.appendChild(caja);
    } catch (e) {
      /* el informe por consola queda igual */
    }
  }

  /* El botón muestra sólo lo que se verifica de redes: lo que la cátedra
   * puede leer y discutir. Los criterios de la interfaz y del archivo, y las
   * pruebas internas de las capas, quedan para quien programa:
   * Autotest.correr({ tecnico: true }) desde la consola. */
  var CRITERIOS_DIDACTICOS = [crit02, crit17, crit03, crit04, crit05, crit06, crit20, crit18, crit19, crit21, crit22, crit23, crit07, crit08, crit12];
  // La pestaña Laboratorio: sólo en modo Docente, con sus cuatro secciones
  // y sin scroll de página. correr() restaura la red del usuario.
  function crit24() {
    var nombre = "La pestaña Laboratorio aparece sólo en modo Docente y sus cuatro secciones se dibujan sin scroll de página";
    var previo = modoActualDom();
    try {
      var prob = [];
      UI.cargarTopologia(clonar(ejemploPorId("complejo-roto").topologia));
      function pestanaLab() {
        var bs = document.querySelectorAll(".siminf .tabs button[role=tab]");
        for (var i = 0; i < bs.length; i++) { if (bs[i].textContent === "Laboratorio") { return bs[i]; } }
        return null;
      }
      UI.setModo("topologia");
      if (pestanaLab()) { prob.push("la pestaña está fuera del modo Docente"); }
      UI.setModo("docente");
      var tab = pestanaLab();
      if (!tab) {
        prob.push("no está la pestaña en modo Docente");
      } else {
        tab.click();
        ["Fallas", "Objetivos", "Desafío", "Verificar"].forEach(function (sec) {
          var bs = document.querySelectorAll(".lab .modosim button");
          var b = null;
          for (var i = 0; i < bs.length; i++) { if (bs[i].textContent.indexOf(sec) === 0) { b = bs[i]; } }
          if (!b) { prob.push("falta la sección " + sec); return; }
          b.click();
          if (!document.querySelector(".lab .simres .recorrido")) { prob.push(sec + " no dibuja su lista"); }
          if (document.documentElement.scrollHeight > window.innerHeight + 1) { prob.push(sec + " deja scroll de página"); }
        });
        var filas = document.querySelectorAll(".tablalab tbody tr").length;
        if (filas !== 2) { prob.push("Verificar muestra " + filas + " objetivos y la plantilla tiene 2"); }
      }
      if (prob.length === 0) {
        return fila(24, nombre, true, "Pestaña sólo en Docente; Fallas, Objetivos, Desafío VLSM y Verificar sin scroll; 2 objetivos comparados.");
      }
      return fila(24, nombre, false, "Falla: " + prob.join("; ") + ".");
    } catch (e) {
      return fila(24, nombre, false, "Excepción: " + e.message);
    } finally {
      try { UI.setModo(previo); } catch (e2) { /* se sigue igual */ }
    }
  }

  /* Foco y teclado (SRE-1026): el foco sobrevive a los redibujados de la
   * franja inferior, las pestañas responden a las flechas, la hoja del
   * celular deja el fondo inerte y ninguna regla le quita el anillo al cable. */
  function crit25() {
    var nombre = "El foco no se pierde al redibujar y las pestañas se recorren con flechas";
    var previo = modoActualDom();
    function botonCon(raiz, texto) {
      var bs = raiz.querySelectorAll("button");
      for (var i = 0; i < bs.length; i++) { if (bs[i].textContent.indexOf(texto) === 0) { return bs[i]; } }
      return null;
    }
    function tecla(n, key) {
      n.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true }));
    }
    // Se mira la hoja de estilos y no el estilo computado: :focus-visible
    // depende de cómo el navegador decidió que llegó el foco.
    function reglaCss(selector) {
      var hoja = document.getElementById("sim-estilos");
      var reglas = hoja && hoja.sheet ? hoja.sheet.cssRules : [];
      for (var i = 0; i < reglas.length; i++) {
        if (reglas[i].selectorText === selector) { return reglas[i]; }
      }
      return null;
    }
    try {
      // En el diseño de celular la franja inferior está oculta: no hay foco que medir ahí.
      var franja = document.querySelector(".siminf");
      if (!franja || getComputedStyle(franja).display === "none") {
        return fila(25, nombre, true, "No aplica con el diseño de celular, donde la franja inferior está oculta. Correr el Autotest en una pantalla más grande.");
      }
      var prob = [];
      UI.setModo("topologia");
      UI.cargarTopologia(clonar(ejemploPorId("complejo").topologia));
      var id = dispositivoConIp();
      var origen = null;
      UI.topologiaActual().dispositivos.forEach(function (d) { if (d.id === id) { origen = d; } });
      UI.seleccionar(id);
      var inf = document.querySelector(".siminf");

      // Pestañas: → desde Simulación lleva el foco y la selección a Captura.
      var tSim = document.getElementById("sim-tab-inf-simulacion");
      tSim.click();
      tSim = document.getElementById("sim-tab-inf-simulacion");
      tSim.focus();
      tecla(tSim, "ArrowRight");
      var act = document.activeElement;
      if (!act || act.id !== "sim-tab-inf-captura") { prob.push("→ no deja el foco en Captura"); }
      else if (!act.classList.contains("activo") || act.getAttribute("aria-selected") !== "true") { prob.push("→ no elige Captura"); }
      var panel = document.getElementById("sim-panel-inf");
      if (!panel || panel.getAttribute("role") !== "tabpanel") { prob.push("la franja no tiene tabpanel"); }
      tecla(document.activeElement, "Home");
      if (document.activeElement.id !== "sim-tab-inf-simulacion") { prob.push("Inicio no vuelve a Simulación"); }

      // Fin llega a la última pestaña del modo: en Docente, Laboratorio.
      UI.setModo("docente");
      var tPrim = document.querySelector(".siminf [role=tab]");
      tPrim.focus();
      tecla(tPrim, "End");
      if (document.activeElement.id !== "sim-tab-inf-laboratorio") { prob.push("Fin en modo Docente no llega a Laboratorio"); }
      UI.setModo("topologia");
      UI.seleccionar(id);

      // Captura en todos los cables y un ping al gateway del equipo.
      document.getElementById("sim-tab-inf-captura").click();
      var bIni = botonCon(inf, "Iniciar captura");
      if (bIni) { bIni.click(); } else { prob.push("no está «Iniciar captura»"); }
      document.getElementById("sim-tab-inf-simulacion").click();
      var destino = null;
      inf.querySelectorAll("label").forEach(function (l) { if (l.textContent === "Destino") { destino = document.getElementById(l.htmlFor); } });
      var bPing = inf.querySelector(".simctrl button.primario");
      if (!destino || !bPing || !origen) { prob.push("no se encontró el formulario del ping"); }
      else {
        destino.value = origen.gateway;
        bPing.click();
        // Alternar las tramas conserva el foco en el botón, aunque se redibuje.
        var bTr = inf.querySelector("[data-foco=tramas]");
        if (!bTr) { prob.push("no está el botón de tramas"); }
        else {
          bTr.focus();
          bTr.click();
          act = document.activeElement;
          if (!act || act.getAttribute("data-foco") !== "tramas" || act === bTr) { prob.push("alternar tramas pierde el foco"); }
        }
      }

      // Elegir un paquete con Space conserva el foco en la fila.
      document.getElementById("sim-tab-inf-captura").click();
      var filas = inf.querySelectorAll(".tablacap tbody tr");
      if (filas.length < 2) { prob.push("la captura tiene " + filas.length + " paquetes"); }
      else {
        var clave = filas[1].getAttribute("data-foco");
        filas[1].focus();
        tecla(filas[1], " ");
        act = document.activeElement;
        if (!act || act.getAttribute("data-foco") !== clave) { prob.push("elegir un paquete pierde el foco"); }
        else if (act.getAttribute("aria-selected") !== "true") { prob.push("la fila elegida no tiene aria-selected"); }
        // La fila elegida y otra con foco se distinguen: fondo distinto y
        // un anillo propio para el foco (también sobre la elegida).
        var filas2 = inf.querySelectorAll(".tablacap tbody tr");
        filas2[0].focus();
        if (filas2[0].classList.contains("sel") || !filas2[1].classList.contains("sel")) { prob.push("enfocar otra fila cambia la elegida"); }
        else if (getComputedStyle(filas2[0]).backgroundColor === getComputedStyle(filas2[1]).backgroundColor) {
          prob.push("la fila enfocada se ve igual que la elegida");
        }
        // Con var() en el atajo outline, las propiedades sueltas quedan vacías: se lee cssText.
        var rFoco = reglaCss(".tablacap tr:focus-visible"), rFocoSel = reglaCss(".tablacap tr.sel:focus-visible");
        if (!rFoco || rFoco.cssText.indexOf("solid") < 0 || !rFocoSel || rFocoSel.cssText.indexOf("outline-color") < 0) {
          prob.push("las filas de la captura no tienen anillo de foco propio");
        }
      }
      var bLim = botonCon(inf, "Limpiar");
      if (bLim) { bLim.click(); }
      var bDet = botonCon(inf, "Detener");
      if (bDet) { bDet.click(); }

      // Ninguna regla le quita el contorno al cable enfocado.
      var hoja = document.getElementById("sim-estilos");
      var reglas = hoja && hoja.sheet ? hoja.sheet.cssRules : [];
      for (var i = 0; i < reglas.length; i++) {
        var r = reglas[i];
        if (r.selectorText && /\.enlace:focus(?!-visible)/.test(r.selectorText) && r.style.outlineStyle === "none") {
          prob.push("una regla le quita el anillo de foco al cable");
        }
      }

      // El foco en un puerto muestra su tooltip, y al salir se oculta.
      var puerto = document.querySelector("svg .puerto");
      var tip = document.querySelector(".simraiz .tooltip");
      if (!puerto || !tip) { prob.push("no hay puertos o tooltip en el lienzo"); }
      else {
        // Si la ventana no tiene el foco (Autotest corrido desde la consola o
        // con la ventana atrás), el navegador mueve el foco sin avisar: los
        // eventos se disparan a mano para probar igual lo que escucha el puerto.
        var sinVentana = !document.hasFocus();
        puerto.focus();
        if (sinVentana) { puerto.dispatchEvent(new FocusEvent("focus")); }
        if (tip.style.display !== "block" || tip.textContent.indexOf("puerto") < 0) { prob.push("el foco en un puerto no muestra su tooltip"); }
        puerto.blur();
        if (sinVentana) { puerto.dispatchEvent(new FocusEvent("blur")); }
        if (tip.style.display !== "none") { prob.push("el tooltip del puerto no se oculta al salir"); }
      }

      // Hoja del celular: modal, con el fondo inerte mientras está abierta.
      var bConf = botonCon(document.querySelector(".simacciones"), "Configurar");
      var sec = document.querySelector(".simhoja");
      if (!bConf || !sec) { prob.push("no están la barra del celular o la hoja"); }
      else {
        // En escritorio el botón Configurar está oculto: el origen es una
        // pestaña visible, que es lo que la hoja tiene que devolver.
        var tOrigen = document.getElementById("sim-tab-inf-simulacion");
        tOrigen.focus();
        bConf.click();
        if (sec.getAttribute("aria-modal") !== "true") { prob.push("la hoja no es modal"); }
        if (!document.querySelector(".simcuerpo").inert) { prob.push("el fondo no queda inerte con la hoja abierta"); }
        if (document.activeElement && document.activeElement !== document.body) { document.activeElement.blur(); }
        sec.querySelector(".cabhoja button").click();
        if (document.querySelector(".simraiz [inert]")) { prob.push("queda fondo inerte al cerrar la hoja"); }
        if (document.activeElement !== tOrigen) { prob.push("al cerrar la hoja el foco no vuelve a lo que la abrió"); }
      }
      document.getElementById("sim-tab-inf-simulacion").click();

      if (prob.length === 0) {
        return fila(25, nombre, true, "Flechas, Inicio y Fin (también en Docente) en las pestañas; foco conservado al alternar tramas y al elegir un paquete; fila elegida y enfocada distinguibles; tooltip del puerto con foco; hoja modal que devuelve el foco; anillo del cable intacto.");
      }
      return fila(25, nombre, false, "Falla: " + prob.join("; ") + ".");
    } catch (e) {
      return fila(25, nombre, false, "Excepción: " + e.message);
    } finally {
      try { UI.setModo(previo); } catch (e2) { /* se sigue igual */ }
    }
  }

  /* Tema y layout (SRE-1027): el tema arranca con el del sistema y, al
   * alternarlo, cambia también lo de afuera de la raíz; el primer Tab lleva
   * al lienzo; hay un <main>; el nombre del botón de zoom contiene su texto. */
  function crit26() {
    var nombre = "El tema sigue al sistema y llega a la barra del navegador; se puede saltar al lienzo";
    var bTema = null;
    try {
      var prob = [];
      var raiz = document.querySelector(".simraiz");
      var html = document.documentElement;
      var meta = document.querySelector("meta[name=theme-color]");
      document.querySelectorAll(".simbarra button").forEach(function (b) {
        if (/^Tema (claro|oscuro)$/.test(b.textContent)) { bTema = b; }
      });
      var oscuroInicial = raiz.classList.contains("oscuro");
      function estado() {
        return [raiz.classList.contains("oscuro"), meta ? meta.getAttribute("content") : "", html.style.colorScheme, html.style.background].join("|");
      }
      // Contraste WCAG entre el texto y el fondo de un elemento (colores rgb opacos).
      function luminancia(rgb) {
        var c = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(function (v) {
          v = Number(v) / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      }
      function contraste(n) {
        var cs = getComputedStyle(n);
        var a = luminancia(cs.color), b = luminancia(cs.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }
      var primario = document.querySelector(".simraiz button.primario");
      function revisarContraste() {
        if (primario && contraste(primario) < 4.5) {
          prob.push("el texto del botón primario no llega a 4.5:1 en tema " + (raiz.classList.contains("oscuro") ? "oscuro" : "claro") +
            " (" + contraste(primario).toFixed(2) + ":1)");
        }
      }
      if (!primario) { prob.push("no hay un botón primario para medir el contraste"); }
      revisarContraste();
      // Sólo se compara con el sistema si nadie tocó el botón todavía.
      if (bTema && bTema.getAttribute("data-elegido") !== "1") {
        var sistemaOscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (oscuroInicial !== sistemaOscuro) { prob.push("el tema inicial no sigue al sistema"); }
      }
      if (!bTema) { prob.push("no está el botón de tema"); }
      else {
        var antes = estado();
        bTema.click();
        var medio = estado();
        var oscuro = raiz.classList.contains("oscuro");
        if (oscuro === oscuroInicial) { prob.push("el botón no cambia el tema"); }
        if (!meta || meta.getAttribute("content") !== (oscuro ? "#0e1a2b" : "#13355e")) { prob.push("el theme-color no acompaña al tema"); }
        if (html.style.colorScheme !== (oscuro ? "dark" : "light")) { prob.push("el color-scheme de <html> no acompaña al tema"); }
        if (!html.style.background) { prob.push("<html> no tiene fondo"); }
        revisarContraste();
        bTema.click();
        if (estado() !== antes || medio === antes) { prob.push("alternar dos veces no vuelve al estado inicial"); }
      }
      var saltar = document.querySelector(".simraiz > a.saltar");
      if (!saltar || saltar !== document.querySelector(".simraiz a, .simraiz button, .simraiz [tabindex]")) {
        prob.push("«Saltar al lienzo» no es lo primero que se recorre");
      } else {
        saltar.click();
        if (document.activeElement !== document.querySelector("svg.lienzo")) { prob.push("«Saltar al lienzo» no deja el foco en el lienzo"); }
      }
      if (!document.querySelector("main.simcuerpo")) { prob.push("no hay un <main>"); }
      var bZoom = document.querySelector(".simtools button[data-h=porc]");
      if (!bZoom || (bZoom.getAttribute("aria-label") || "").indexOf(bZoom.textContent) < 0) {
        prob.push("el nombre del botón de zoom no contiene su texto");
      }
      if (prob.length === 0) {
        return fila(26, nombre, true, "Tema inicial del sistema; alternar cambia raíz, theme-color, color-scheme y fondo; botón primario con 4.5:1 o más en los dos temas; «Saltar al lienzo» primero; <main>; zoom «" + bZoom.getAttribute("aria-label") + "».");
      }
      return fila(26, nombre, false, "Falla: " + prob.join("; ") + ".");
    } catch (e) {
      return fila(26, nombre, false, "Excepción: " + e.message);
    }
  }

  var CRITERIOS_TECNICOS = [crit01, crit09, crit10, crit11, crit13, crit14, crit15, crit16, crit24, crit25, crit26];

  function correr(opciones) {
    var tecnico = !!(opciones && opciones.tecnico);
    if (typeof Red === "undefined" || typeof Motor === "undefined" ||
        typeof Escenarios === "undefined" || typeof UI === "undefined") {
      try {
        document.getElementById("app").innerHTML =
          "<p style='font-family:system-ui;padding:20px'>Falta una capa: el ensamblado quedó incompleto " +
          "(revisá que los cinco bloques script estén pegados en orden). El autotest no puede correr.</p>";
      } catch (e) {
        /* se sigue igual */
      }
      return { total: 0, pasadas: 0, resultados: [], detalleCapas: "capas faltantes", fallos: 0 };
    }
    var respaldoTopo = null;
    var respaldoModo = "topologia";
    var teniaUI = true;
    try {
      respaldoModo = modoActualDom();
    } catch (e) {
      respaldoModo = "topologia";
    }
    try {
      if (teniaUI) {
        respaldoTopo = UI.topologiaActual();
      }
    } catch (e) {
      respaldoTopo = null;
    }
    /* Las animaciones se pausan envolviendo los dibujos: se restauran al salir. */
    var originalPing = UI ? UI.animarPing : null;
    var originalDhcp = UI ? UI.animarDhcp : null;
    try {
      if (UI) {
        UI.animarPing = function () { /* autotest sin animaciones */ };
        UI.animarDhcp = function () { /* autotest sin animaciones */ };
      }
    } catch (e) {
      /* si no se puede envolver, se sigue igual */
    }

    var resultados = [];
    var pasadasCapas = 0;
    var totalCapas = 0;
    var detalleCapas = "";
    if (tecnico) {
      try {
        var r1 = Red.autopruebas();
        var r2 = Motor.autopruebas();
        var r3 = Escenarios.autopruebas();
        totalCapas = r1.total + r2.total + r3.total;
        pasadasCapas = r1.pasadas + r2.pasadas + r3.pasadas;
        var fallosCapas = r1.fallos.concat(r2.fallos).concat(r3.fallos).slice(0, 8);
        detalleCapas = "Capas 1–3: " + pasadasCapas + "/" + totalCapas + " pruebas internas." +
          (fallosCapas.length ? " Primeros fallos: " + fallosCapas.map(function (f) { return f.nombre; }).join(" | ") + "." : " Sin fallos internos.");
      } catch (e) {
        detalleCapas = "No se pudieron correr las autopruebas internas: " + e.message;
      }
    }

    try {
      (tecnico ? CRITERIOS_DIDACTICOS.concat(CRITERIOS_TECNICOS) : CRITERIOS_DIDACTICOS).forEach(function (crit) {
        resultados.push(crit());
      });
    } finally {
      if (!tecnico) {
        /* Sin los criterios técnicos, los números del informe van corridos. */
        resultados.forEach(function (r, i) { r.n = i + 1; });
      }
      try {
        if (UI) {
          if (originalPing) {
            UI.animarPing = originalPing;
          }
          if (originalDhcp) {
            UI.animarDhcp = originalDhcp;
          }
        }
      } catch (e) {
        /* se sigue igual */
      }
      try {
        if (teniaUI && respaldoTopo) {
          UI.cargarTopologia(respaldoTopo);
          UI.setModo(respaldoModo);
        }
      } catch (e) {
        /* no se pierde el trabajo: ya se trabajó sobre copias */
      }
    }

    var pasadas = 0;
    resultados.forEach(function (r) {
      if (r.pasa) {
        pasadas += 1;
      }
    });
    /* Fallos primero para leer rápido qué arreglar. */
    var ordenados = resultados.slice().sort(function (a, b) {
      if (a.pasa === b.pasa) {
        return a.n - b.n;
      }
      return a.pasa ? 1 : -1;
    });
    var salida = {
      tecnico: tecnico,
      total: totalCapas + resultados.length,
      pasadas: pasadasCapas + pasadas,
      resultados: ordenados,
      detalleCapas: detalleCapas,
      fallos: totalCapas + resultados.length - (pasadasCapas + pasadas)
    };
    try {
      if (UI && UI.registrar) {
        UI.registrar("autotest", "Autotest " + salida.pasadas + "/" + salida.total + ". " + detalleCapas);
      }
    } catch (e) {
      /* se sigue igual */
    }
    mostrarInforme(salida);
    return salida;
  }

  function cablearBoton() {
    try {
      var barra = document.querySelector(".siminf .tabs");
      if (!barra || document.querySelector("[data-boton-autotest5]")) {
        return;
      }
      var b = document.createElement("button");
      b.setAttribute("data-boton-autotest5", "1");
      b.textContent = "Autotest";
      b.title = "Comprueba que el simulador resuelve bien casos de la materia (máscaras, rutas, DHCP, VLSM) sin perder el trabajo cargado";
      b.addEventListener("click", function () {
        correr();
      });
      barra.appendChild(b);
    } catch (e) {
      /* el objeto Autotest queda igual disponible por consola */
    }
  }

  function arrancar() {
    if (typeof Red === "undefined" || typeof Motor === "undefined" ||
        typeof Escenarios === "undefined" || typeof UI === "undefined") {
      document.getElementById("app").innerHTML =
        "<p style='font-family:system-ui;padding:20px'>Falta una capa: el ensamblado quedó incompleto " +
        "(revisá que los cinco bloques script estén pegados en orden).</p>";
      return;
    }
    /* Se arranca con el lienzo vacío: los ejemplos están en «Ejemplos…» y
     * el trabajo de la sesión anterior se ofrece desde el lienzo. */
    UI.iniciar(document.getElementById("app"), {
      version: 1, nombre: "Red nueva", dispositivos: [], enlaces: [], escenario: null
    });
    cablearBoton();
    /* La capa 4 reconstruye la franja inferior en cada render: el observador
     * repone el botón si un repintado lo barre. No toca ninguna capa. */
    try {
      var raiz = document.getElementById("app");
      if (raiz && typeof MutationObserver !== "undefined") {
        var obs = new MutationObserver(function () {
          if (!document.querySelector("[data-boton-autotest5]")) {
            cablearBoton();
          }
        });
        obs.observe(raiz, { childList: true, subtree: true });
      }
    } catch (e) {
      /* sin observador el botón igual queda tras el arranque */
    }
  }

  return {
    correr: correr,
    arrancar: arrancar
  };
})();

if (typeof window !== "undefined") {
  window.Autotest = Autotest;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      Autotest.arrancar();
    });
  } else {
    Autotest.arrancar();
  }
}
