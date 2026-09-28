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

  function fila(n, criterio, pasa, detalle) {
    return { n: n, criterio: criterio, pasa: !!pasa, detalle: detalle || "" };
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
    var nombre = "La topología complejo permite un ping exitoso de punta a punta";
    try {
      var ej = ejemploPorId("complejo");
      if (!ej) {
        return fila(2, nombre, false, "No se encontró el ejemplo de id complejo en Escenarios.EJEMPLOS.");
      }
      var estado = Motor.crearEstado(clonar(ej.topologia));
      var res = Motor.ping(estado, "pc-admin", "10.45.7.122");
      if (res.exito) {
        return fila(2, nombre, true, "Ping de pc-admin a 10.45.7.122 con exito true y " + res.saltos.length + " saltos.");
      }
      var cod = res.diagnostico ? res.diagnostico.codigo : "sin diagnóstico";
      return fila(2, nombre, false, "Se esperaba exito true y se obtuvo falla con código " + cod + ".");
    } catch (e) {
      return fila(2, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit03() {
    var nombre = "Cambiar la máscara de un PC de /27 a /28 rompe el ping al gateway con D09";
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
      var aclara = "Se partió de 10.45.7.94/27 (última del rango 65–94): con /27 el ping al servidor anda; con /28 cae. " +
        "El destino verificado es el servidor y no el propio gateway porque el Motor antepone el chequeo de máscaras " +
        "del segmento (D14) cuando se pinguea al gateway en forma directa; el D09 aparece contra destino externo. ";
      if (!sano.exito) {
        return fila(3, nombre, false, aclara + "El caso sano ya fallaba con " +
          (sano.diagnostico ? sano.diagnostico.codigo : "?") + "; revisar la topología base.");
      }
      if (!roto.exito && cod === "D09") {
        return fila(3, nombre, true, aclara + "Con /28 el ping falla con D09 como se esperaba.");
      }
      return fila(3, nombre, false, aclara + "Se esperaba falla D09 y se obtuvo " +
        (roto.exito ? "exito true" : "código " + cod) + ".");
    } catch (e) {
      return fila(3, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit04() {
    var nombre = "Deshabilitar una interfaz del router produce D01";
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
        return fila(4, nombre, true, "Se deshabilitó r1:g0/0 y el ping desde r1 a su propia 10.45.7.65 falla con D01.");
      }
      return fila(4, nombre, false, "Se esperaba falla D01 y se obtuvo " +
        (res.exito ? "exito true" : "código " + cod) + ".");
    } catch (e) {
      return fila(4, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit05() {
    var nombre = "Borrar una ruta de retorno produce D12, no D11";
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
        return fila(5, nombre, true, "Sin la ruta 10.45.7.64/27 en r2 la ida llega y la vuelta no: D12.");
      }
      return fila(5, nombre, false, "Se esperaba D12 (y distinto de D11) y se obtuvo " +
        (res.exito ? "exito true" : "código " + cod) + ".");
    } catch (e) {
      return fila(5, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit06() {
    var nombre = "Dos PC en el mismo switch con subredes distintas producen D15";
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
        return fila(6, nombre, true, "Mismo switch con 192.168.1.0/24 contra 192.168.2.0/24: D15, el switch no enruta.");
      }
      return fila(6, nombre, false, "Se esperaba D15 y se obtuvo " +
        (res.exito ? "exito true" : "código " + cod) + ".");
    } catch (e) {
      return fila(6, nombre, false, "Excepción: " + e.message);
    }
  }

  function crit07() {
    var nombre = "Red.desglose coincide con el cálculo hecho a mano";
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
      var fallas = [];
      Object.keys(esperado).forEach(function (k) {
        if (det[k] !== esperado[k]) {
          fallas.push(k + ": esperado " + esperado[k] + ", obtenido " + det[k]);
        }
      });
      if (!det.gateway || det.gateway.coinciden !== true) {
        fallas.push("gateway: se esperaba que 10.45.7.65 coincida con la subred");
      }
      if (fallas.length === 0) {
        return fila(7, nombre, true, "Desglose de 10.45.7.66/27 con red .64, broadcast .95, rango 65–94 y máscara .224.");
      }
      return fila(7, nombre, false, "Diferencias: " + fallas.join(" | "));
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
    var nombre = "DHCP entrega una dirección del rango configurado y devuelve los cuatro mensajes DORA";
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
        return fila(8, nombre, true, "Se otorgó " + res.ip + "/24 con mensajes " + tipos + ".");
      }
      return fila(8, nombre, false, "Se esperaba ip entre 192.168.1.50 y .60 con discover,offer,request,ack; se obtuvo ip " +
        res.ip + " y mensajes [" + tipos + "], exito " + res.exito + ".");
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
    var nombre = "El modo desafío detecta un solapamiento y una subred desalineada";
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
      var haySolape = texto.indexOf("solapa") >= 0;
      var hayAline = texto.indexOf("no arranca en un múltiplo") >= 0;
      if (informe.porSector.length === 5 && informe.resumen.errores > 0 && haySolape && hayAline) {
        return fila(12, nombre, true, "Cámaras con el router en 10.45.7.41/28: desalineada y solapada con el Wi-Fi; errores: " +
          informe.resumen.errores + ".");
      }
      return fila(12, nombre, false, "Se esperaba al menos un error de solape y uno de alineación; se obtuvo " +
        JSON.stringify(informe.resumen) + " y hallazgos " + texto + ".");
    } catch (e) {
      return fila(12, nombre, false, "Excepción: " + e.message);
    }
  }

  function dispositivoConIp() {
    try {
      var topo = UI.topologiaActual();
      var lista = topo.dispositivos || [];
      var i;
      for (i = 0; i < lista.length; i++) {
        var ifaces = lista[i].interfaces || [];
        for (var j = 0; j < ifaces.length; j++) {
          if (ifaces[j].ip && Red.esIpValida(String(ifaces[j].ip))) {
            return lista[i].id;
          }
        }
      }
      if (lista.length) {
        return lista[0].id;
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
        return fila(13, nombre, false, "No hay ningún dispositivo para seleccionar.");
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
      titulo.innerHTML = "<b>Autotest: " + salida.pasadas + "/" + salida.total + " criterios</b> " +
        "<span>(" + salida.fallos + " fallos primero)</span>";
      caja.appendChild(titulo);
      var lista = document.createElement("div");
      salida.resultados.forEach(function (r) {
        var div = document.createElement("div");
        div.style.border = "1px solid #c9d3dc";
        div.style.borderLeft = r.pasa ? "6px solid #1a7f37" : "6px solid #b42318";
        div.style.borderRadius = "6px";
        div.style.padding = "4px 8px";
        div.style.margin = "6px 0";
        var safeC = String(r.criterio).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        var safeD = String(r.detalle || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
        div.innerHTML = "<b>" + r.n + ". " + safeC + "</b> " + (r.pasa ? "pasa" : "falla") + "<br>" + safeD;
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

  function correr() {
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

    try {
      resultados.push(crit01());
      resultados.push(crit02());
      resultados.push(crit03());
      resultados.push(crit04());
      resultados.push(crit05());
      resultados.push(crit06());
      resultados.push(crit07());
      resultados.push(crit08());
      resultados.push(crit09());
      resultados.push(crit10());
      resultados.push(crit11());
      resultados.push(crit12());
      resultados.push(crit13());
      resultados.push(crit14());
      resultados.push(crit15());
      resultados.push(crit16());
    } finally {
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
      b.textContent = "Autotest completo";
      b.title = "Corre los 16 criterios de aceptación sin perder el trabajo cargado";
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
    var ej = ejemploPorId("complejo");
    var inicial = ej ? ej.topologia : Escenarios.EJEMPLOS[0].topologia;
    UI.iniciar(document.getElementById("app"), clonar(inicial));
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
