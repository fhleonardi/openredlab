/* capa4-ui.js — Capa 4: interfaz del simulador de redes para el aula.
 *
 * Objeto global `UI` con las firmas del §5 del BASE. Dibuja; no piensa:
 * todo cálculo viene de `Red`, todo diagnóstico de `Motor` y toda
 * persistencia o verificación de `Escenarios`.
 *
 * Decisiones de diseño:
 * - Un solo archivo que inyecta su propio CSS, sin dependencias ni CDN.
 * - Lienzo SVG con zoom y paneo; paleta con Pointer Events (sirve para
 *   mouse y touch) con las dos formas de colocación: arrastrar y clic-poner.
 * - Los cables nacen y mueren en puertos visibles, uno por interfaz.
 * - El panel de cálculo pinta `Red.desglose()` tal cual viene, con el
 *   binario en dos colores y la línea de corte en vivo.
 * - `animarPing` y `animarDhcp` animan sobre la topología real, con
 *   velocidad configurable y cancelación, sin bloquear (`requestAnimationFrame`).
 */

var UI = (function () {
  "use strict";

  /* ---------------- Estado interno ---------------- */

  // La barra de zoom ocupa la franja superior del lienzo: la vista arranca
  // corrida hacia abajo para que no tape los equipos de arriba.
  var MARGEN_VISTA = 48;

  var S = {
    raiz: null,
    svg: null,
    capaMundo: null,
    capaEnlaces: null,
    capaNodos: null,
    capaAnim: null,
    topologia: null,
    estado: null,
    seleccionado: null,
    modo: "topologia",
    pestañaInf: "simulacion",
    pestañaProps: "config",
    herramientaCable: null,
    cableTipo: "ethernet",
    cableOrigen: null,
    colocando: null,
    vista: { x: 0, y: MARGEN_VISTA, k: 1 },
    deshacer: [],
    rehacer: [],
    presentacion: false,
    tema: "claro",
    velocidad: "normal",
    animToken: 0,
    inicioMs: Date.now(),
    registro: [],
    avisoGuardado: false,
    interfazEditada: {},
    contadores: { pc: 0, router: 0, "switch-l2": 0, camara: 0, iot: 0 },
    abajo: null,
    ultimo: null,
    ultimaVerif: null,
    dhcpSel: null,
    ultimoDhcp: null,
    panelRes: "ping",
    verTodos: false,
    consolaAbierta: false,
    lineasConsola: [],
    presExpandida: false,
    origenElegido: null,
    anuncio: null,
    hoja: null,
    moviendoExtremo: null,
    lineaTemporal: null
  };

  var TIPOS = [
    { tipo: "pc", etiqueta: "PC" },
    { tipo: "router", etiqueta: "Router" },
    { tipo: "router-8", etiqueta: "Router 8 puertos" },
    { tipo: "switch-l2", etiqueta: "Switch" },
    { tipo: "camara", etiqueta: "Cámara" },
    { tipo: "iot", etiqueta: "IoT" },
    { tipo: "ap", etiqueta: "Punto de acceso" },
    { tipo: "internet", etiqueta: "Internet" }
  ];

  var PREFIJOS_NOMBRES = { pc: "PC-", router: "R", "switch-l2": "SW", camara: "CAM", iot: "IOT", ap: "AP-", internet: "Internet-" };

  /* ---------------- Utilidades ---------------- */

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function escapar(texto) {
    return String(texto === undefined || texto === null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buscarDisp(id) {
    var lista = S.topologia.dispositivos || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) { return lista[i]; }
    }
    return null;
  }

  function buscarIface(disp, idIf) {
    if (!disp || !disp.interfaces) { return null; }
    for (var i = 0; i < disp.interfaces.length; i++) {
      if (disp.interfaces[i].id === idIf) { return disp.interfaces[i]; }
    }
    return null;
  }

  function buscarEnlace(id) {
    var lista = S.topologia.enlaces || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) { return lista[i]; }
    }
    return null;
  }

  function enlaceEnPuerto(idDisp, idIf) {
    var lista = S.topologia.enlaces || [];
    for (var i = 0; i < lista.length; i++) {
      var e = lista[i];
      if ((e.a.dispositivo === idDisp && e.a.interfaz === idIf) ||
          (e.b.dispositivo === idDisp && e.b.interfaz === idIf)) {
        return e;
      }
    }
    return null;
  }

  function puertoAdmiteMultiplesEnlaces(disp, iface) {
    if (!disp || !iface || iface.medio !== "wireless") { return false; }
    var modo = iface.modoRadio || ((disp.tipo === "ap" || disp.tipo === "router") ? "ap" : "cliente");
    return modo === "ap";
  }

  function primeraIp(disp) {
    if (!disp || !disp.interfaces) { return null; }
    var i;
    for (i = 0; i < disp.interfaces.length; i++) {
      var a = disp.interfaces[i];
      if (a.habilitada && a.ip && Red.esIpValida(String(a.ip))) { return a; }
    }
    for (i = 0; i < disp.interfaces.length; i++) {
      var b = disp.interfaces[i];
      if (b.ip && Red.esIpValida(String(b.ip))) { return b; }
    }
    return null;
  }

  /* Rótulo bajo el ícono, en líneas cortas para que no se pisen entre
   * vecinos: la IP en una y el gateway en otra. Sin IP, no hay tercera. */
  function lineasResumen(disp) {
    // Un router tiene una IP en cada red que conecta: se muestran todas,
    // con el nombre de su interfaz.
    if (disp && disp.tipo === "router") {
      var todas = (disp.interfaces || []).filter(function (f) {
        return f.ip && Red.esIpValida(String(f.ip));
      }).map(function (f) { return f.id + " " + f.ip + "/" + f.prefijo; });
      return todas.length ? todas : ["sin IP"];
    }
    var prim = primeraIp(disp);
    if (!prim) { return ["sin IP"]; }
    var lineas = [prim.ip + "/" + prim.prefijo];
    if (disp.gateway) { lineas.push("gw " + disp.gateway); }
    return lineas;
  }

  var NOMBRES_TIPO = { pc: "PC", router: "router", "router-8": "router de 8 puertos", internet: "internet", "switch-l2": "switch", camara: "cámara", iot: "IoT", ap: "punto de acceso" };

  // Clave de paleta e ícono: el tipo, salvo el router de 8 puertos, que es
  // tipo "router" con modelo "8-puertos".
  function claveDe(d) {
    return d && d.tipo === "router" && d.modelo === "8-puertos" ? "router-8" : (d ? d.tipo : "");
  }

  function equipoDeClave(clave) {
    return clave === "router-8" ? { tipo: "router", modelo: "8-puertos" } : { tipo: clave, modelo: null };
  }
  function nombreTipo(tipo) { return NOMBRES_TIPO[tipo] || tipo; }

  function momentoRel() {
    var ms = Date.now() - S.inicioMs;
    var seg = Math.floor(ms / 1000);
    var dec = Math.floor((ms % 1000) / 100);
    var hh = String(Math.floor(seg / 3600)).padStart(2, "0");
    var mm = String(Math.floor((seg % 3600) / 60)).padStart(2, "0");
    var ss = String(seg % 60).padStart(2, "0");
    return "+" + hh + ":" + mm + ":" + ss + "." + dec;
  }

  var FORMATO_HORA = null;
  try {
    FORMATO_HORA = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  } catch (e) { FORMATO_HORA = null; }

  function momentoAbs() {
    var d = new Date();
    if (FORMATO_HORA) { return FORMATO_HORA.format(d); }
    return String(d.getHours()).padStart(2, "0") + ":" +
      String(d.getMinutes()).padStart(2, "0") + ":" +
      String(d.getSeconds()).padStart(2, "0");
  }

  /* Interfaces por defecto según §4 del BASE. El hardware es fijo. */
  function interfacesPorDefecto(tipo) {
    function iface(id, medio, habilitada) {
      return {
        id: id, nombre: id, medio: medio,
        habilitada: !!habilitada, modo: "estatico",
        ip: null, prefijo: 24, mac: null
      };
    }
    if (tipo === "pc") {
      return [iface("eth0", "ethernet", true), iface("wlan0", "wireless", false)];
    }
    if (tipo === "camara") {
      return [iface("eth0", "ethernet", true), iface("wlan0", "wireless", false)];
    }
    if (tipo === "iot") {
      return [iface("wlan0", "wireless", true)];
    }
    if (tipo === "ap") {
      var celda = iface("wlan0", "wireless", true);
      celda.modoRadio = "ap";
      return [celda, iface("eth0", "ethernet", true)];
    }
    if (tipo === "router") {
      return [iface("g0/0", "ethernet", true), iface("g0/1", "ethernet", true),
        iface("fib0", "fibra", true), iface("wlan0", "wireless", false)];
    }
    if (tipo === "internet") {
      return [iface("eth0", "ethernet", true)];
    }
    if (tipo === "router-8") {
      // Como un equipo de oficina tipo MikroTik: cada puerto es ruteado y
      // puede tener su propia subred.
      var puertos = [];
      for (var k = 1; k <= 8; k++) { puertos.push(iface("ether" + k, "ethernet", true)); }
      puertos.push(iface("sfp1", "fibra", true));
      var radio = iface("wlan1", "wireless", false);
      radio.modoRadio = "ap";
      puertos.push(radio);
      return puertos;
    }
    var lista = [];
    for (var i = 1; i <= 8; i++) { lista.push(iface("fa0/" + i, "ethernet", true)); }
    lista.push(iface("fib0", "fibra", true));
    return lista;
  }

  function nombreAutomatico(tipo) {
    S.contadores[tipo] = (S.contadores[tipo] || 0) + 1;
    return (PREFIJOS_NOMBRES[tipo] || "EQ") + S.contadores[tipo];
  }

  function idUnico(base) {
    var id = base;
    var n = 1;
    while (buscarDisp(id)) { n += 1; id = base + "-" + n; }
    return id;
  }

  function reconstruirEstado() {
    try {
      S.estado = Motor.crearEstado(S.topologia);
    } catch (e) {
      S.estado = null;
    }
  }

  /* ---------------- CSS inyectado ---------------- */

  var CSS = [
    ".simraiz{font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;display:flex;flex-direction:column;width:100%;max-width:100vw;height:100%;min-height:520px;overflow:hidden;background:var(--sim-fondo);color:var(--sim-texto);color-scheme:light;--sim-fondo:#f7f9fb;--sim-texto:#14181f;--sim-tenue:#5a6472;--sim-panel:#ffffff;--sim-borde:#c9d1dc;--sim-acento:#1a5fb4;--sim-ok:#1e7a34;--sim-okfondo:#e7f4ea;--sim-mal:#b3261e;--sim-malfondo:#fbeae8;--sim-aviso:#8a5a00;--sim-cabecera:#13355e;}",
    ".simraiz.oscuro{color-scheme:dark;--sim-fondo:#12171e;--sim-texto:#e8eef4;--sim-tenue:#9aa5b4;--sim-panel:#1b232d;--sim-borde:#3a4a5a;--sim-acento:#5aa9e6;--sim-ok:#4cc38a;--sim-okfondo:#15301f;--sim-mal:#f0726a;--sim-malfondo:#3a1a1a;--sim-aviso:#e0a63c;--sim-cabecera:#0e1a2b;}",
    ".simraiz button,.simraiz select,.simraiz input{font:inherit;font-size:13px;color:var(--sim-texto);background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:6px;touch-action:manipulation;}",
    ".simraiz button{padding:4px 10px;cursor:pointer;}",
    ".simraiz button:hover:not(:disabled),.simraiz select:hover{border-color:var(--sim-acento);}",
    ".simraiz button:disabled{opacity:.45;cursor:not-allowed;}",
    ".simraiz button:focus-visible,.simraiz select:focus-visible,.simraiz input:focus-visible,svg .nodo:focus-visible,svg .puerto:focus-visible,svg .enlace:focus-visible,svg.lienzo:focus-visible{outline:3px solid var(--sim-acento);outline-offset:2px;}",
    ".simraiz button.primario{background:var(--sim-acento);border-color:var(--sim-acento);color:#fff;font-weight:600;padding:6px 22px;}",
    ".simraiz button.activo{background:var(--sim-acento);color:#fff;border-color:var(--sim-acento);}",
    ".oculto-visual{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}",
    ".simbarra{display:flex;gap:8px;align-items:center;padding:6px 12px;background:var(--sim-cabecera);color:#fff;flex-wrap:wrap;}",
    ".simbarra h1{font-size:16px;margin:0 8px 0 0;font-weight:700;color:#fff;}",
    ".simbarra .modos{display:flex;gap:4px;}",
    ".simbarra button,.simbarra select{background:transparent;color:#fff;border-color:rgba(255,255,255,.28);}",
    ".simbarra select option{color:#14181f;background:#fff;}",
    ".simbarra select{max-width:260px;min-width:0;}",
    ".simbarra button.activo{background:#fff;color:var(--sim-cabecera);border-color:#fff;}",
    ".simbarra .espacio{flex:1;}",
    ".simbarra .enpres{display:none;font-size:13px;opacity:.85;}",
    ".simcuerpo{flex:1;display:flex;min-height:0;}",
    ".simpaleta{width:200px;flex:0 0 200px;background:var(--sim-panel);border-right:1px solid var(--sim-borde);padding:8px;overflow:auto;box-sizing:border-box;}",
    ".simpaleta.colapsada{width:60px;flex-basis:60px;}",
    ".simpaleta.colapsada .etiqueta,.simpaleta.colapsada .titulopal,.simpaleta.colapsada .leyenda,.simpaleta.colapsada select,.simpaleta.colapsada label{display:none;}",
    ".simpaleta h2{font-size:12px;letter-spacing:.02em;color:var(--sim-tenue);margin:4px 0 8px;}",
    ".palitem{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;margin-bottom:6px;text-align:left;cursor:grab;user-select:none;}",
    ".simraiz .palitem{touch-action:none;}",
    ".palitem.armado{outline:2px solid var(--sim-acento);outline-offset:1px;}",
    ".palitem svg{width:28px;height:28px;flex:0 0 28px;}",
    ".palgrid{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:4px;margin-bottom:4px;}",
    ".palgrid .palitem{gap:4px;padding:3px 5px;margin:0;}",
    ".palcab{display:flex;align-items:center;justify-content:space-between;gap:4px;margin:2px 0 6px;}",
    ".palcab h2{margin:0;}",
    ".palcab button{font-size:11px;padding:1px 6px;}",
    ".palgrid .palitem svg{width:20px;height:20px;flex-basis:20px;}",
    ".palgrid .palitem .etiqueta{font-size:11.5px;line-height:1.15;overflow-wrap:normal;}",
    ".simpaleta.colapsada .palgrid .palitem{justify-content:center;}",
    ".simpaleta.colapsada .palgrid{grid-template-columns:1fr;}",
    ".palitem .etiqueta{font-size:13px;line-height:1.15;overflow-wrap:anywhere;}",
    ".simraiz .sololector{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}",
    ".simpaleta label{display:block;font-size:12px;color:var(--sim-tenue);margin:4px 0 2px;}",
    ".simpaleta select,.simpaleta .herramienta{width:100%;box-sizing:border-box;margin-bottom:6px;}",
    ".simpaleta .herramienta{font-size:12px;padding:4px 6px;}",
    ".simpaleta .leyenda{font-size:11px;color:var(--sim-tenue);line-height:1.4;margin:2px 0 6px;}",
    ".simpaleta .palgrid + h2{margin-top:8px;}",
    ".simlienzo{flex:1;position:relative;min-width:0;background:var(--sim-fondo);}",
    ".simlienzo svg.lienzo{width:100%;height:100%;display:block;touch-action:none;}",
    ".simtools{position:absolute;top:8px;left:8px;display:flex;gap:4px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:8px;padding:4px;}",
    ".simtools button{padding:2px 8px;}",
    ".leyenda-lienzo{display:none;position:absolute;right:12px;bottom:12px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.6;}",
    ".leyenda-lienzo .tenue{color:var(--sim-tenue);font-size:12px;}",
    ".simprop{width:295px;max-width:100%;flex:0 0 295px;background:var(--sim-panel);border-left:1px solid var(--sim-borde);overflow:auto;padding:10px;box-sizing:border-box;}",
    ".simprop.colapsado{display:none;}",
    ".simprop h2{font-size:17px;margin:10px 0 4px;}",
    ".simprop h2 small{font-size:12px;font-weight:400;color:var(--sim-tenue);}",
    ".simprop .tabs,.siminf .tabs{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:8px;}",
    ".simprop label{display:block;font-size:12px;color:var(--sim-tenue);margin:8px 0 3px;}",
    ".simprop input,.simprop select,.siminf input,.siminf select{padding:5px 8px;box-sizing:border-box;}",
    ".simprop input:not([type=checkbox]),.simprop select{width:100%;}",
    ".simprop label.enlinea{display:flex;align-items:center;gap:8px;color:var(--sim-texto);font-size:13px;}",
    ".simprop input.invalido,.siminf input.invalido{border-color:var(--sim-mal);outline:2px solid var(--sim-mal);}",
    ".simprop .borrar{margin-top:14px;}",
    ".filaif{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;padding:6px 0;border-bottom:1px dotted var(--sim-borde);}",
    ".filaif .datos{flex:1;min-width:0;}",
    ".filaif label{margin:0;}",
    ".filaif select{width:auto;}",
    ".siminf{height:260px;flex:0 0 260px;background:var(--sim-panel);border-top:1px solid var(--sim-borde);padding:6px 12px 8px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;}",
    ".siminf.colapsado{height:44px;flex-basis:44px;}",
    ".siminf.compacta{height:44px;flex-basis:44px;}",
    ".siminf .tabs button[role=tab]{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;padding:6px 10px;font-size:14px;color:var(--sim-tenue);}",
    ".siminf .tabs button[role=tab].activo{color:var(--sim-acento);border-bottom-color:var(--sim-acento);background:transparent;font-weight:600;}",
    ".siminf .tabs .espacio{flex:1;}",
    ".siminf .tabs label{font-size:12px;color:var(--sim-tenue);}",
    ".siminf .cuerpoinf{flex:1;min-height:0;overflow:auto;}",
    ".recorrido .nota{margin:2px 0 4px;font-size:12px;color:var(--sim-tenue);}",
    ".recorrido .sectores{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:4px 8px;align-items:start;}",
    ".recorrido .sectores > div{margin:0;}",
    ".dora{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px;margin-bottom:4px;}",
    ".dora .paso{margin:0;}",
    ".titulodhcp{margin:0 0 6px;}",
    ".recorrido .requisito{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px;flex-wrap:wrap;}",
    ".recorrido .requisito .nota{margin:0;}",
    ".recorrido .requisito input{width:150px;}",
    ".recorrido input.hosts{width:64px;margin-left:6px;}",
    ".recorrido .tenue{color:var(--sim-tenue);font-size:12px;}",
    ".ayuda{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;padding:2px 0;font-size:12px;line-height:1.35;}",
    ".ayuda section{background:var(--sim-fondo);border:1px solid var(--sim-borde);border-radius:10px;padding:6px 10px;min-width:0;}",
    ".ayuda h3{margin:0 0 3px;font-size:12.5px;color:var(--sim-acento);}",
    ".ayuda ul,.ayuda ol{margin:0;padding-left:18px;}",
    ".ayuda li{margin:0;}",
    ".ayuda .teclas{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;align-items:baseline;}",
    ".ayuda .teclas span:nth-child(odd){white-space:nowrap;}",
    ".ayuda kbd{font-family:ui-monospace,Consolas,monospace;font-size:11px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-bottom-width:2px;border-radius:4px;padding:0 4px;}",
    ".siminf .cuerpoinf.sim{display:flex;flex-direction:column;overflow:hidden;}",
    ".simctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}",
    ".simctrl label{font-size:12px;color:var(--sim-tenue);}",
    ".simctrl .flecha{color:var(--sim-tenue);}",
    ".simctrl input{width:170px;font-family:ui-monospace,Consolas,monospace;}",
    ".simctrl .espacio{flex:1;}",
    ".simres{display:flex;gap:12px;flex:1;min-height:0;}",
    ".simres .recorrido{flex:3;min-width:0;border:1px solid var(--sim-borde);border-radius:8px;display:flex;flex-direction:column;min-height:0;}",
    ".simres .lado{flex:2;min-width:0;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;}",
    ".recorrido .cab{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;color:var(--sim-tenue);padding:4px 10px;border-bottom:1px solid var(--sim-borde);}",
    ".recorrido .cab .ok{color:var(--sim-ok);font-weight:400;}",
    ".recorrido .cab .mal{color:var(--sim-mal);font-weight:400;}",
    ".recorrido .pasos{flex:1;min-height:0;overflow:auto;padding:4px 10px;}",
    ".recorrido .pie{display:flex;align-items:center;gap:8px;padding:4px 10px 6px;font-size:12px;color:var(--sim-tenue);font-style:italic;}",
    ".linpaso{font-size:13px;padding:2px 0;}",
    ".linpaso .marca{color:var(--sim-ok);margin-right:4px;}",
    ".linpaso.pendiente{color:var(--sim-tenue);}",
    ".pasofallo{border:1px solid var(--sim-mal);background:var(--sim-malfondo);border-radius:6px;padding:6px 8px;margin:4px 0;font-size:13px;}",
    ".pasofallo .marca{color:var(--sim-mal);margin-right:4px;}",
    ".pasofallo pre{margin:4px 0 0;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre-wrap;}",
    ".banda-ok{border:1px solid var(--sim-ok);border-left:6px solid var(--sim-ok);background:var(--sim-okfondo);border-radius:8px;padding:8px 12px;}",
    ".banda-ok b{font-size:16px;color:var(--sim-ok);}",
    ".banda-ok .ruta{font-family:ui-monospace,Consolas,monospace;font-size:13px;margin-top:2px;}",
    ".diagnostico{border:1px solid var(--sim-mal);border-left:6px solid var(--sim-mal);background:var(--sim-malfondo);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.45;flex:0 0 auto;}",
    ".diagnostico .cod{display:inline-block;color:var(--sim-tenue);border:1px solid var(--sim-borde);font-family:ui-monospace,Consolas,monospace;font-size:11px;border-radius:4px;padding:0 5px;margin-left:8px;vertical-align:middle;}",
    ".diagnostico .tit{font-weight:700;font-size:15px;color:var(--sim-mal);}",
    ".diagnostico .rev{border-top:1px solid var(--sim-borde);margin-top:6px;padding-top:6px;}",
    ".advertencia{border:1px solid var(--sim-aviso);border-radius:8px;padding:6px;margin:6px 0;font-size:12px;}",
    ".consola{background:#0d1117;color:#d6f0d6;font-family:ui-monospace,Consolas,monospace;font-size:12px;border-radius:8px;padding:8px;flex:1;min-height:0;overflow:auto;white-space:pre-wrap;margin:0;}",
    ".consola .error{color:#ff8a80;}",
    ".consolabtn{text-align:left;font-family:ui-monospace,Consolas,monospace;font-size:12px;}",
    ".lienzovacio{position:absolute;left:50%;top:45%;transform:translate(-50%,-50%);width:min(440px,80%);text-align:center;color:var(--sim-tenue);font-size:14px;line-height:1.45;pointer-events:none;}",
    ".lienzovacio b{display:block;color:var(--sim-texto);font-size:17px;margin-bottom:4px;}",
    ".lienzovacio .recuperar{pointer-events:auto;margin-top:14px;padding:10px 12px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:10px;color:var(--sim-texto);}",
    ".lienzovacio .recuperar div{display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap;}",
    ".vacio{text-align:center;color:var(--sim-tenue);font-size:13px;padding:14px 20px;}",
    ".vacio b{display:block;color:var(--sim-texto);font-size:16px;margin-bottom:4px;}",
    ".estadopres{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--sim-tenue);}",
    ".estadopres .espacio{flex:1;}",
    ".paso{border:1px solid var(--sim-borde);border-radius:6px;padding:4px 8px;margin-bottom:4px;font-size:12px;}",
    ".paso.ok{border-left:6px solid var(--sim-ok);}",
    ".paso.mal{border-left:6px solid var(--sim-mal);background:var(--sim-malfondo);}",
    ".binario{font-family:ui-monospace,Consolas,monospace;font-size:14px;letter-spacing:1px;}",
    ".binario .red{color:var(--sim-acento);font-weight:bold;}",
    ".binario .host{color:var(--sim-aviso);font-weight:bold;}",
    ".binario .corte{border-left:2px solid var(--sim-mal);}",
    ".calc{font-size:12.5px;line-height:1.4;}",
    ".calc .grid{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;}",
    ".calc .cab{margin:0 0 6px;}",
    ".calc .cab .tenue{color:var(--sim-tenue);font-size:12px;}",
    ".calc .tarjetas{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:8px;}",
    ".calc section{background:var(--sim-fondo);border:1px solid var(--sim-borde);border-radius:10px;padding:6px 10px;min-width:0;}",
    ".calc h3{margin:0 0 3px;font-size:12.5px;color:var(--sim-acento);}",
    ".calc .bits{margin:4px 0 0;white-space:nowrap;overflow-x:auto;}",
    ".calc .veredicto{margin-top:3px;font-weight:600;}",
    "svg .nodo,svg .enlace,svg .asa{cursor:pointer;}",
    "svg .asa:focus-visible{outline:3px solid var(--sim-acento);outline-offset:2px;}",
    "svg .enlace:focus{outline:none;}",
    "svg .puerto{cursor:pointer;stroke:#333;stroke-width:1;}",
    "svg text{font-family:system-ui,Arial,sans-serif;}",
    "svg .etiqueta text.mono{font-family:ui-monospace,Consolas,monospace;}",
    "svg .fondoetq{fill:var(--sim-fondo);fill-opacity:.9;}",
    ".simraiz.presentacion .simpaleta,.simraiz.presentacion .simprop,.simraiz.presentacion .simbarra .modos,.simraiz.presentacion .simbarra select,.simraiz.presentacion .simbarra .enedicion{display:none;}",
    ".simraiz.presentacion .simbarra .enpres{display:inline;}",
    ".simraiz.presentacion .leyenda-lienzo{display:block;}",
    ".tooltip{position:absolute;pointer-events:none;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:6px;padding:6px 8px;font-size:12px;max-width:260px;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:5;}",
    ".menucel,.simacciones,.simhoja,.pista{display:none;}",
    ".simacciones{gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:var(--sim-panel);border-top:1px solid var(--sim-borde);}",
    ".simacciones button{flex:1;padding:10px 4px;font-size:15px;}",
    ".simhoja{position:fixed;left:0;right:0;bottom:0;max-height:80vh;background:var(--sim-panel);border-radius:16px 16px 0 0;box-shadow:0 -4px 20px rgba(0,0,0,.22);z-index:20;flex-direction:column;overscroll-behavior:contain;}",
    ".simhoja .tirador{width:40px;height:4px;border-radius:2px;background:var(--sim-borde);margin:8px auto 0;flex:0 0 auto;}",
    ".simhoja .cabhoja{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--sim-borde);flex:0 0 auto;}",
    ".simhoja .cabhoja h2{flex:1;margin:0;font-size:18px;}",
    ".simhoja .cabhoja button{min-width:44px;min-height:44px;font-size:18px;}",
    ".simhoja .cuerpohoja{overflow:auto;padding:10px 14px calc(16px + env(safe-area-inset-bottom));overscroll-behavior:contain;}",
    ".gridagregar{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}",
    ".gridagregar button{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 4px;font-size:13px;}",
    ".gridagregar svg{width:34px;height:34px;}",
    ".simhoja h3{font-size:12px;color:var(--sim-tenue);margin:4px 0 8px;}",
    ".simaviso{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:var(--sim-acento);color:#fff;border-radius:10px;padding:6px 12px;font-size:13px;z-index:6;pointer-events:none;max-width:90%;text-align:center;}",
    ".pista{position:absolute;left:10px;bottom:10px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:8px;padding:6px 10px;font-size:13px;color:var(--sim-tenue);}",
    ".diagnostico .irconfig{margin-top:8px;border-color:var(--sim-mal);color:var(--sim-mal);}",
    "@media (max-width:900px){.simpaleta{width:140px;flex-basis:140px;}.palgrid{grid-template-columns:1fr;}.simprop{width:240px;flex-basis:240px;}.simbarra{gap:5px;padding:5px 6px;}.simbarra button{padding:4px 7px;}}",
    "@media (max-width:640px){" +
      ".simraiz{min-height:0;}" +
      ".simbarra{flex-wrap:nowrap;padding:8px 10px;gap:8px;}" +
      ".simbarra h1{font-size:16px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;}" +
      ".simbarra .menucel{display:inline-block;min-width:44px;min-height:40px;font-size:18px;}" +
      ".simbarra>*:not(h1):not(.menucel){display:none;}" +
      ".simbarra.menuabierto{flex-wrap:wrap;}" +
      ".simbarra.menuabierto>.modos{display:flex;width:100%;flex-wrap:wrap;}" +
      ".simbarra.menuabierto>select,.simbarra.menuabierto>button:not(.menucel){display:block;width:100%;max-width:none;padding:8px;}" +
      ".simcuerpo{flex:1;min-height:0;}" +
      ".simpaleta,.simprop,.siminf{display:none;}" +
      ".simacciones{display:flex;}" +
      ".simhoja:not([hidden]){display:flex;}" +
      ".pista:not([hidden]){display:block;}" +
      ".simhoja .simprop{display:block;width:auto;flex:none;border:0;padding:0;overflow:visible;}" +
      ".simhoja .siminf{display:flex;height:auto;min-height:0;flex:none;border:0;padding:0;overflow:visible;}" +
      ".simhoja .siminf .cuerpoinf,.simhoja .siminf .cuerpoinf.sim{overflow:visible;}" +
      ".simhoja .siminf .tabs .espacio{display:none;}" +
      ".simhoja .simres{flex-direction:column;}" +
      ".simhoja .simres>*{width:100%;box-sizing:border-box;}" +
      ".simhoja .consola{max-height:160px;}" +
      ".simhoja .simprop>h2{display:none;}" +
      ".simhoja .simres .lado{order:-1;}" +
      ".simhoja .siminf .tabs>button{display:none;}" +
      ".simctrl input{width:100%;}" +
      ".simctrl .espacio{display:none;}" +
      ".banda-ok .ruta,.linpaso,.recorrido .cab{overflow-wrap:anywhere;flex-wrap:wrap;}" +
      ".simtools{flex-wrap:wrap;max-width:calc(100% - 16px);}" +
      ".simraiz input,.simraiz select{font-size:16px;}" +
    "}",
    "@media (prefers-reduced-motion:reduce){.simraiz *{scroll-behavior:auto;}}",
    ".fantasma{position:fixed;pointer-events:none;opacity:.6;z-index:99;background:var(--sim-panel);border:1px dashed var(--sim-acento);border-radius:8px;padding:4px 8px;font-size:12px;}"
  ].join("\n");

  function inyectarCss() {
    if (document.getElementById("sim-estilos")) { return; }
    var el = document.createElement("style");
    el.id = "sim-estilos";
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /* ---------------- Iconos SVG dibujados a mano ---------------- */

  function icono(tipo) {
    if (tipo === "internet") {
      return "<path d='M-14 9 C-23 9 -23 -3 -14 -3 C-14 -12 -2 -15 3 -8 C8 -14 19 -10 17 -1 C25 0 24 9 16 9 Z' " +
        "fill='#dbe9f7' stroke='#1a5fb4' stroke-width='2' stroke-linejoin='round'/>";
    }
    if (tipo === "router-8") {
      return "<rect x='-26' y='-11' width='52' height='22' rx='4' fill='#f6d186' stroke='#8a5a00' stroke-width='2'/>" +
        "<path d='M-9 -5 L9 5 M-9 5 L9 -5' stroke='#8a5a00' stroke-width='2'/>" +
        "<circle cx='0' cy='0' r='2.5' fill='#8a5a00'/>";
    }
    if (tipo === "pc") {
      return "<rect x='-16' y='-12' width='32' height='22' rx='2' fill='#9fc5e8' stroke='#0b5fa5' stroke-width='2'/>" +
        "<rect x='-12' y='-8' width='24' height='12' fill='#e8f2fa'/>" +
        "<rect x='-8' y='12' width='16' height='3' fill='#0b5fa5'/>";
    }
    if (tipo === "router") {
      return "<circle cx='0' cy='0' r='17' fill='#f6d186' stroke='#8a5a00' stroke-width='2'/>" +
        "<path d='M-10 -6 L10 6 M-10 6 L10 -6' stroke='#8a5a00' stroke-width='2'/>" +
        "<circle cx='0' cy='0' r='3' fill='#8a5a00'/>";
    }
    if (tipo === "switch-l2") {
      return "<rect x='-20' y='-10' width='40' height='20' rx='4' fill='#b6d7a8' stroke='#1a7f37' stroke-width='2'/>" +
        "<circle cx='-12' cy='0' r='2' fill='#1a7f37'/><circle cx='-4' cy='0' r='2' fill='#1a7f37'/>" +
        "<circle cx='4' cy='0' r='2' fill='#1a7f37'/><circle cx='12' cy='0' r='2' fill='#1a7f37'/>";
    }
    if (tipo === "camara") {
      return "<rect x='-14' y='-8' width='24' height='14' rx='3' fill='#d5a6bd' stroke='#6a1b3a' stroke-width='2'/>" +
        "<circle cx='-2' cy='-1' r='4' fill='#6a1b3a'/><rect x='10' y='-3' width='8' height='4' fill='#6a1b3a'/>";
    }
    if (tipo === "ap") {
      return "<rect x='-9' y='2' width='18' height='9' rx='2' fill='#e0ecf7' stroke='#0b5fa5' stroke-width='2'/>" +
        "<circle cx='0' cy='6.5' r='2.4' fill='#0b5fa5'/>" +
        "<path d='M-7 -2 A9 9 0 0 1 7 -2' fill='none' stroke='#0b5fa5' stroke-width='2' stroke-linecap='round'/>" +
        "<path d='M-11 -6 A13 13 0 0 1 11 -6' fill='none' stroke='#0b5fa5' stroke-width='2' stroke-linecap='round'/>" +
        "<path d='M-15 -10 A17 17 0 0 1 15 -10' fill='none' stroke='#0b5fa5' stroke-width='2' stroke-linecap='round'/>";
    }
    return "<rect x='-10' y='-12' width='20' height='24' rx='6' fill='#c9daf8' stroke='#0b5fa5' stroke-width='2'/>" +
      "<circle cx='0' cy='-4' r='3' fill='#0b5fa5'/><rect x='-5' y='3' width='10' height='5' fill='#0b5fa5'/>";
  }

  /* ---------------- Construcción del DOM ---------------- */

  function el(tag, clase, html) {
    var n = document.createElement(tag);
    if (clase) { n.className = clase; }
    if (html !== undefined) { n.innerHTML = html; }
    return n;
  }

  function boton(texto, clase) {
    var b = document.createElement("button");
    b.type = "button";
    if (clase) { b.className = clase; }
    b.textContent = texto;
    return b;
  }

  // Ids únicos para asociar cada <label> con su control.
  var contadorCampos = 0;
  function idCampo(base) {
    contadorCampos += 1;
    return "sim-" + base + "-" + contadorCampos;
  }

  function etiqueta(texto, control) {
    var lab = document.createElement("label");
    lab.textContent = texto;
    if (!control.id) { control.id = idCampo("campo"); }
    lab.htmlFor = control.id;
    return lab;
  }

  // Los campos de direcciones: teclado numérico con punto en el celular y sin
  // autocompletado ni corrector, que en una IP sólo estorban.
  function campoDireccion(input, nombre) {
    input.setAttribute("inputmode", "decimal");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    if (nombre) { input.name = nombre; }
  }

  function movimientoReducido() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  function anunciar(texto) {
    if (S.anuncio) {
      S.anuncio.textContent = "";
      S.anuncio.textContent = texto;
    }
  }

  function iniciar(contenedor, topologiaInicial) {
    inyectarCss();
    S.raiz = (typeof contenedor === "string") ? document.querySelector(contenedor) : contenedor;
    if (!S.raiz) { throw new Error("UI.iniciar: contenedor no encontrado"); }
    S.raiz.innerHTML = "";
    S.raiz.classList.add("simraiz");
    S.inicioMs = Date.now();

    var barra = el("div", "simbarra");
    var bMenu = boton("☰", "menucel");
    bMenu.setAttribute("aria-label", "Menú");
    bMenu.setAttribute("aria-expanded", "false");
    bMenu.addEventListener("click", function () {
      var abierto = barra.classList.toggle("menuabierto");
      bMenu.setAttribute("aria-expanded", String(abierto));
    });
    barra.appendChild(bMenu);
    barra.appendChild(el("h1", "", "Simulador de Redes"));
    S.barra = barra;
    var modos = el("div", "modos");
    modos.setAttribute("role", "group");
    modos.setAttribute("aria-label", "Modo de trabajo");
    [["topologia", "Topología"], ["subredes", "Subredes"], ["desafio", "Desafío"], ["docente", "Docente"]].forEach(function (par) {
      var b = boton(par[1], par[0] === S.modo ? "activo" : "");
      b.setAttribute("data-modo", par[0]);
      b.setAttribute("aria-pressed", String(par[0] === S.modo));
      b.addEventListener("click", function () { setModo(par[0]); });
      modos.appendChild(b);
    });
    barra.appendChild(modos);
    var selEjemplo = document.createElement("select");
    selEjemplo.setAttribute("aria-label", "Topologías de ejemplo");
    selEjemplo.innerHTML = "<option value=''>Ejemplos…</option>";
    Escenarios.EJEMPLOS.forEach(function (e) {
      var op = document.createElement("option");
      op.value = e.id; op.textContent = e.nombre + " — " + e.descripcion;
      selEjemplo.appendChild(op);
    });
    selEjemplo.addEventListener("change", function () {
      if (!selEjemplo.value) { return; }
      var ej = null;
      for (var i = 0; i < Escenarios.EJEMPLOS.length; i++) {
        if (Escenarios.EJEMPLOS[i].id === selEjemplo.value) { ej = Escenarios.EJEMPLOS[i]; }
      }
      if (ej) { empujarHistorial(); cargarTopologia(clonar(ej.topologia)); registrar("ejemplo", "Se cargó el ejemplo " + ej.nombre); }
      selEjemplo.value = "";
    });
    barra.appendChild(selEjemplo);
    barra.appendChild(el("span", "espacio"));
    barra.appendChild(el("span", "enpres", "Modo presentación"));
    var bImp = boton("Importar", "enedicion");
    bImp.addEventListener("click", importarPorArchivo);
    var bExp = boton("Exportar", "enedicion");
    bExp.addEventListener("click", exportarActual);
    var bTema = boton("Tema oscuro", "enedicion");
    bTema.setAttribute("aria-pressed", "false");
    bTema.addEventListener("click", alternarTema);
    S.botonTema = bTema;
    var bPres = boton("Presentación (F)");
    bPres.setAttribute("aria-pressed", "false");
    bPres.addEventListener("click", alternarPresentacion);
    S.botonPres = bPres;
    barra.appendChild(bImp); barra.appendChild(bExp);
    barra.appendChild(bTema); barra.appendChild(bPres);
    S.raiz.appendChild(barra);

    var cuerpo = el("div", "simcuerpo");
    var pal = el("div", "simpaleta");
    pal.setAttribute("aria-label", "Paleta de dispositivos");
    var cab = el("div", "palcab");
    cab.appendChild(el("h2", "titulopal", "Dispositivos"));
    pal.appendChild(cab);
    var grilla = el("div", "palgrid");
    TIPOS.forEach(function (t) {
      var item = boton("", "palitem");
      item.setAttribute("data-tipo", t.tipo);
      item.innerHTML = "<svg viewBox='-24 -20 48 40' aria-hidden='true' focusable='false'>" + icono(t.tipo) + "</svg>" +
        "<span class='etiqueta'>" + escapar(t.etiqueta) + "</span>";
      item.setAttribute("aria-label", "Agregar " + t.etiqueta);
      item.addEventListener("pointerdown", function (ev) { arrastrePaleta(ev, t.tipo, item); });
      item.addEventListener("click", function (ev) {
        // Desde el teclado (detail 0) el equipo se coloca en el centro de la
        // vista: no hace falta puntero para agregar un dispositivo.
        if (ev.detail === 0) { colocarEnCentro(t.tipo); return; }
        armarColocacion(t.tipo, item);
      });
      grilla.appendChild(item);
    });
    pal.appendChild(grilla);
    pal.appendChild(el("h2", "titulopal", "Cable"));
    var selCable = document.createElement("select");
    selCable.id = idCampo("tipo-cable");
    selCable.innerHTML = "<option value='ethernet'>ethernet (cobre)</option><option value='fibra'>fibra</option><option value='wireless'>wireless</option>";
    selCable.addEventListener("change", function () { S.cableTipo = selCable.value; S.herramientaCable = true; renderLienzo(); });
    S.selectCable = selCable;
    // El título "Cable" ya lo nombra a la vista; el rótulo queda para lectores de pantalla.
    var labCable = etiqueta("Tipo de cable", selCable);
    labCable.className = "sololector";
    pal.appendChild(labCable);
    pal.appendChild(selCable);
    var bCable = boton("Conectar con un cable", "herramienta");
    bCable.title = "Hacé clic en dos puertos para unirlos (Esc cancela)";
    bCable.setAttribute("aria-pressed", "false");
    bCable.addEventListener("click", function () {
      S.herramientaCable = !S.herramientaCable; S.cableOrigen = null;
      bCable.classList.toggle("activo", S.herramientaCable);
      bCable.setAttribute("aria-pressed", String(S.herramientaCable));
      registrar("cable", S.herramientaCable ? "Herramienta de cable activada (" + S.cableTipo + ")." : "Herramienta de cable desactivada.");
      renderLienzo();
    });
    pal.appendChild(bCable);
    pal.appendChild(el("p", "leyenda", "Trazo lleno: cobre · grueso con brillo: fibra · puntos en curva: wireless.<br>Verde: activo · rojo y cortado: caído."));
    var bCol = boton("Colapsar");
    bCol.setAttribute("aria-expanded", "true");
    bCol.addEventListener("click", function () {
      var colapsada = pal.classList.toggle("colapsada");
      // Colapsada mide 60 px: "Expandir" no entra, va el símbolo con su nombre accesible.
      bCol.textContent = colapsada ? "»" : "Colapsar";
      bCol.title = colapsada ? "Expandir la paleta" : "";
      bCol.setAttribute("aria-label", colapsada ? "Expandir la paleta" : "Colapsar la paleta");
      bCol.setAttribute("aria-expanded", String(!colapsada));
    });
    cab.appendChild(bCol);
    cuerpo.appendChild(pal);
    S.paleta = pal;

    var zona = el("div", "simlienzo");
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "lienzo");
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("role", "application");
    svg.setAttribute("aria-label", "Lienzo de la topología. Flechas: desplazar. Más y menos: zoom. Tab recorre equipos y enlaces.");
    var mundo = document.createElementNS(svgNS, "g");
    var cEn = document.createElementNS(svgNS, "g");
    var cNo = document.createElementNS(svgNS, "g");
    var cAn = document.createElementNS(svgNS, "g");
    var cAs = document.createElementNS(svgNS, "g");
    mundo.appendChild(cEn); mundo.appendChild(cNo); mundo.appendChild(cAn); mundo.appendChild(cAs);
    svg.appendChild(mundo);
    zona.appendChild(svg);
    var tools = el("div", "simtools");
    [["deshacer", "Deshacer"], ["rehacer", "Rehacer"], ["menos", "−"], ["porc", "100%"], ["mas", "+"], ["ajustar", "Ajustar"]].forEach(function (par) {
      var b = boton(par[1]);
      b.setAttribute("data-h", par[0]);
      b.setAttribute("aria-label", par[0] === "menos" ? "Alejar" : par[0] === "mas" ? "Acercar" : par[0] === "porc" ? "Restablecer zoom" : par[1]);
      b.addEventListener("click", function () { accionLienzo(par[0]); });
      tools.appendChild(b);
    });
    zona.appendChild(tools);
    zona.appendChild(el("div", "leyenda-lienzo",
      "<div><svg width='26' height='8' aria-hidden='true'><line x1='1' y1='4' x2='25' y2='4' stroke='#1e7a34' stroke-width='3'/></svg> cobre</div>" +
      "<div><svg width='26' height='10' aria-hidden='true'><line x1='1' y1='5' x2='25' y2='5' stroke='#1e7a34' stroke-width='7' opacity='.3'/><line x1='1' y1='5' x2='25' y2='5' stroke='#1e7a34' stroke-width='4'/></svg> fibra</div>" +
      "<div><svg width='26' height='8' aria-hidden='true'><line x1='1' y1='4' x2='25' y2='4' stroke='#1e7a34' stroke-width='3' stroke-dasharray='1 6' stroke-linecap='round'/></svg> wireless</div>" +
      "<div><svg width='26' height='8' aria-hidden='true'><line x1='1' y1='4' x2='25' y2='4' stroke='#b42318' stroke-width='3' stroke-dasharray='8 5'/></svg> caído</div>" +
      "<div class='tenue'>verde activo · rojo y cortado caído</div>"));
    var pista = el("div", "pista", "Tocá un equipo para configurarlo");
    zona.appendChild(pista);
    S.pista = pista;
    var vacio = el("div", "lienzovacio");
    vacio.hidden = true;
    zona.appendChild(vacio);
    S.lienzoVacio = vacio;
    var aviso = el("div", "simaviso");
    aviso.hidden = true;
    zona.appendChild(aviso);
    S.aviso = aviso;
    var tip = el("div", "tooltip");
    tip.style.display = "none";
    zona.appendChild(tip);
    S.tooltip = tip;
    cuerpo.appendChild(zona);
    S.svg = svg; S.capaMundo = mundo; S.capaEnlaces = cEn; S.capaNodos = cNo; S.capaAnim = cAn; S.capaAsas = cAs;

    var prop = el("div", "simprop");
    cuerpo.appendChild(prop);
    S.prop = prop;
    S.raiz.appendChild(cuerpo);

    var inf = el("div", "siminf");
    inf.setAttribute("aria-label", "Simulación y resultados");
    S.raiz.appendChild(inf);
    S.inf = inf;
    S.cuerpo = cuerpo;
    var acciones = el("div", "simacciones");
    var bAgregar = boton("+ Agregar");
    bAgregar.addEventListener("click", function () {
      if (S.colocando || S.herramientaCable) { cancelarHerramientas(); return; }
      abrirHoja("agregar");
    });
    var bConfig = boton("Configurar");
    bConfig.addEventListener("click", function () { abrirHoja("configurar"); });
    var bPingCel = boton("Ping", "primario");
    bPingCel.addEventListener("click", function () { abrirHoja("ping"); });
    acciones.appendChild(bAgregar); acciones.appendChild(bConfig); acciones.appendChild(bPingCel);
    S.raiz.appendChild(acciones);
    S.botonAgregar = bAgregar;
    var hoja = el("section", "simhoja");
    hoja.hidden = true;
    hoja.setAttribute("role", "dialog");
    hoja.setAttribute("aria-labelledby", "sim-titulo-hoja");
    hoja.innerHTML = "<div class='tirador' aria-hidden='true'></div>";
    var cabHoja = el("div", "cabhoja");
    var tituloHoja = el("h2", "");
    tituloHoja.id = "sim-titulo-hoja";
    var bCerrar = boton("✕");
    bCerrar.setAttribute("aria-label", "Cerrar");
    bCerrar.addEventListener("click", cerrarHoja);
    cabHoja.appendChild(tituloHoja); cabHoja.appendChild(bCerrar);
    var cuerpoHoja = el("div", "cuerpohoja");
    hoja.appendChild(cabHoja); hoja.appendChild(cuerpoHoja);
    S.raiz.appendChild(hoja);
    S.hojaEl = hoja; S.hojaTitulo = tituloHoja; S.hojaCuerpo = cuerpoHoja; S.hojaCerrar = bCerrar;
    try {
      var mq = window.matchMedia("(max-width:640px)");
      var alCambiar = function () { if (!mq.matches) { cerrarHoja(); } };
      if (mq.addEventListener) { mq.addEventListener("change", alCambiar); } else if (mq.addListener) { mq.addListener(alCambiar); }
    } catch (e) { /* sin matchMedia: no hay hojas */ }

    var anuncio = el("div", "oculto-visual");
    anuncio.setAttribute("role", "status");
    anuncio.setAttribute("aria-live", "polite");
    S.raiz.appendChild(anuncio);
    S.anuncio = anuncio;

    cablearLienzo(zona, svg);
    document.addEventListener("keydown", atajos);

    var inicial = topologiaInicial ? clonar(topologiaInicial) : clonar(Escenarios.EJEMPLOS[0].topologia);
    S.topologia = inicial;
    reconstruirEstado();
    recontarNombres();
    aplicarVista();
    autoguardar();
    renderTodo();
    registrar("inicio", "Simulador listo. Pestaña activa: Simulación.");
  }

  function recontarNombres() {
    S.contadores = { pc: 0, router: 0, "switch-l2": 0, camara: 0, iot: 0 };
    (S.topologia.dispositivos || []).forEach(function (d) {
      var pre = PREFIJOS_NOMBRES[d.tipo] || "";
      if (pre && d.nombre && d.nombre.indexOf(pre) === 0) {
        var n = parseInt(d.nombre.slice(pre.length), 10);
        if (!isNaN(n) && n > (S.contadores[d.tipo] || 0)) { S.contadores[d.tipo] = n; }
      }
    });
  }

  /* ---------------- Lienzo: zoom, paneo, dibujo ---------------- */

  function escalaRotulos() {
    return S.presentacion ? Math.max(1, 1 / S.vista.k) : 1;
  }

  function aplicarVista() {
    S.capaMundo.setAttribute("transform",
      "translate(" + S.vista.x + " " + S.vista.y + ") scale(" + S.vista.k + ")");
  }

  function accionLienzo(cual) {
    if (cual === "deshacer") { deshacer(); return; }
    if (cual === "rehacer") { rehacer(); return; }
    if (cual === "mas") { S.vista.k = Math.min(3, S.vista.k * 1.2); }
    if (cual === "menos") { S.vista.k = Math.max(0.3, S.vista.k / 1.2); }
    if (cual === "porc") { S.vista.k = 1; S.vista.x = 0; S.vista.y = MARGEN_VISTA; }
    if (cual === "ajustar") { ajustarVista(); }
    aplicarVista();
    if (S.presentacion) { renderLienzo(); }
  }

  function ajustarVista() {
    var lista = S.topologia.dispositivos || [];
    if (!lista.length) { S.vista = { x: 0, y: 0, k: 1 }; return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    lista.forEach(function (d) {
      minX = Math.min(minX, d.x); minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x); maxY = Math.max(maxY, d.y);
    });
    // Márgenes que cubren íconos y rótulos: los rótulos cuelgan debajo del
    // equipo y son más anchos que el ícono.
    minX -= S.presentacion ? 130 : 100; maxX += S.presentacion ? 130 : 100; minY -= 50;
    maxY += S.presentacion ? 210 : 130;
    var rect = S.svg.getBoundingClientRect();
    var altoUtil = Math.max(100, rect.height - MARGEN_VISTA);
    var w = Math.max(200, maxX - minX);
    var h = Math.max(200, maxY - minY);
    var k = Math.min(rect.width / w, altoUtil / h, 1.5);
    S.vista.k = Math.max(0.3, k);
    S.vista.x = rect.width / 2 - ((minX + maxX) / 2) * S.vista.k;
    S.vista.y = MARGEN_VISTA + altoUtil / 2 - ((minY + maxY) / 2) * S.vista.k;
    aplicarVista();
  }

  function aMundo(ev) {
    var rect = S.svg.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - S.vista.x) / S.vista.k,
      y: (ev.clientY - rect.top - S.vista.y) / S.vista.k
    };
  }

  // Cómo se reparten los puertos en el perímetro: cuántos van arriba y el
  // ancho de cada fila. El router de 8 puertos imita a un MikroTik: ether1
  // (la WAN) arriba y el resto en una tira abajo, más ancha que el ícono.
  function disposicionPuertos(disp, total) {
    if (disp && disp.tipo === "router" && disp.modelo === "8-puertos" && total > 1) {
      return { arriba: 1, anchoArriba: 12, anchoAbajo: 12 * (total - 1) };
    }
    return { arriba: Math.ceil(total / 2), anchoArriba: 56, anchoAbajo: 56 };
  }

  function posicionPuerto(disp, indice, total) {
    var h = 52;
    if (total === 1) { return { x: disp.x, y: disp.y + (disp.tipo === "internet" ? h / 2 : -h / 2) }; }
    var dp = disposicionPuertos(disp, total);
    if (indice < dp.arriba) {
      return { x: disp.x - dp.anchoArriba / 2 + (indice + 0.5) * (dp.anchoArriba / dp.arriba), y: disp.y - h / 2 };
    }
    var j = indice - dp.arriba;
    var abajo = total - dp.arriba;
    return { x: disp.x - dp.anchoAbajo / 2 + (j + 0.5) * (dp.anchoAbajo / abajo), y: disp.y + h / 2 };
  }

  function colorEnlace(e) { return e.estado === "up" ? "#1a7f37" : "#b42318"; }

  /* Centro del puerto de una interfaz, en coordenadas de mundo: el mismo
   * punto donde se dibuja el rectángulo del puerto sobre cada nodo. Si la
   * interfaz no existe, se vuelve al centro del equipo para no perder el cable. */
  function puntoPuerto(disp, idIf) {
    var lista = disp.interfaces || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === idIf) {
        return posicionPuerto(disp, i, lista.length);
      }
    }
    return { x: disp.x, y: disp.y };
  }

  function renderLienzo() {
    actualizarLienzoVacio();
    var svgNS = "http://www.w3.org/2000/svg";
    while (S.capaEnlaces.firstChild) { S.capaEnlaces.removeChild(S.capaEnlaces.firstChild); }
    while (S.capaNodos.firstChild) { S.capaNodos.removeChild(S.capaNodos.firstChild); }
    var porId = {};
    (S.topologia.dispositivos || []).forEach(function (d) { porId[d.id] = d; });

    (S.topologia.enlaces || []).forEach(function (e) {
      var a = porId[e.a.dispositivo], b = porId[e.b.dispositivo];
      if (!a || !b) { return; }
      var g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "enlace");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", mayus(cableTexto(e)) + ", " + palabraCable(e.tipo) + ", " + (e.estado === "up" ? "activo" : "caído") +
        ", del " + puertoTexto(e.a.dispositivo, e.a.interfaz).replace(/^el /, "") +
        " al " + puertoTexto(e.b.dispositivo, e.b.interfaz).replace(/^el /, ""));
      var pa = puntoPuerto(a, e.a.interfaz);
      var pb = puntoPuerto(b, e.b.interfaz);
      var x1 = pa.x, y1 = pa.y, x2 = pb.x, y2 = pb.y;
      var dib;
      if (e.tipo === "wireless") {
        dib = document.createElementNS(svgNS, "path");
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 30;
        dib.setAttribute("d", "M" + x1 + " " + y1 + " Q" + mx + " " + my + " " + x2 + " " + y2);
        dib.setAttribute("fill", "none");
        // Wireless: puntos redondos. Los guiones largos quedan para "caído".
        dib.setAttribute("stroke-dasharray", "1 7");
        dib.setAttribute("stroke-linecap", "round");
      } else {
        dib = document.createElementNS(svgNS, "line");
        dib.setAttribute("x1", x1); dib.setAttribute("y1", y1);
        dib.setAttribute("x2", x2); dib.setAttribute("y2", y2);
      }
      dib.setAttribute("stroke", colorEnlace(e));
      dib.setAttribute("stroke-width", e.tipo === "fibra" ? 5 : 3);
      var brillo = null;
      if (e.tipo === "fibra") {
        // La fibra se distingue por la forma: trazo grueso con un brillo
        // debajo. El color queda para el estado del enlace.
        brillo = document.createElementNS(svgNS, "line");
        brillo.setAttribute("x1", x1); brillo.setAttribute("y1", y1);
        brillo.setAttribute("x2", x2); brillo.setAttribute("y2", y2);
        brillo.setAttribute("stroke", colorEnlace(e));
        brillo.setAttribute("stroke-width", 11);
        brillo.setAttribute("stroke-linecap", "round");
        brillo.setAttribute("opacity", "0.25");
        g.appendChild(brillo);
        dib.setAttribute("stroke-linecap", "round");
      }
      // El estado no depende sólo del color (verde y rojo se confunden con
      // daltonismo): un enlace caído además se dibuja con guiones largos.
      if (e.estado !== "up" && e.tipo !== "wireless") {
        dib.setAttribute("stroke-dasharray", "12 8");
        dib.setAttribute("stroke-linecap", "butt");
        if (brillo) { brillo.setAttribute("stroke-dasharray", "12 8"); brillo.setAttribute("stroke-linecap", "butt"); }
      }
      if (S.enlaceSel === e.id) { dib.setAttribute("stroke-width", e.tipo === "fibra" ? 7 : 5); }
      g.appendChild(dib);
      var mid = document.createElementNS(svgNS, "text");
      mid.setAttribute("x", (x1 + x2) / 2 + 6); mid.setAttribute("y", (y1 + y2) / 2 - 6);
      mid.setAttribute("font-size", S.presentacion ? String(Math.round(15 * escalaRotulos())) : "12");
      mid.setAttribute("fill", colorEnlace(e));
      mid.textContent = e.id + (e.estado === "down" ? " (caído)" : "");
      // Al proyectar, los nombres de enlace sólo estorban: quedan los caídos.
      if (!S.presentacion || e.estado === "down") { g.appendChild(mid); }
      g.addEventListener("pointerenter", function (ev) { mostrarTipEnlace(ev, e); });
      g.addEventListener("pointerleave", ocultarTip);
      if (S.moviendoExtremo && S.moviendoExtremo.enlace === e.id) { g.setAttribute("opacity", "0.35"); }
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (S.moviendoExtremo) { return; }
        seleccionarEnlace(e.id);
        if (esCelular()) { abrirHoja("configurar"); }
      });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); seleccionarEnlace(e.id); }
      });
      S.capaEnlaces.appendChild(g);
    });

    var etiquetas = [];
    (S.topologia.dispositivos || []).forEach(function (d) {
      var g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "nodo");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("data-id", d.id);
      g.setAttribute("aria-label", (d.nombre || d.id) + ", " + nombreTipo(claveDe(d)) + ", " + lineasResumen(d).join(", ") +
        (d.encendido ? "" : ", apagado") + ". Flechas: mover.");
      g.setAttribute("transform", "translate(" + d.x + " " + d.y + ")");
      var halo = null;
      if (S.seleccionado === d.id) {
        halo = document.createElementNS(svgNS, "rect");
        halo.setAttribute("x", -34); halo.setAttribute("y", -32);
        halo.setAttribute("width", 68); halo.setAttribute("height", 64);
        halo.setAttribute("rx", 10);
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", "#0b5fa5");
        halo.setAttribute("stroke-width", 2);
        halo.setAttribute("stroke-dasharray", "5 3");
        g.appendChild(halo);
      }
      var cuerpo = document.createElementNS(svgNS, "g");
      cuerpo.innerHTML = icono(claveDe(d));
      if (!d.encendido) { cuerpo.setAttribute("opacity", "0.4"); }
      g.appendChild(cuerpo);

      (d.interfaces || []).forEach(function (iface, idx) {
        var p = posicionPuerto({ x: 0, y: 0, tipo: d.tipo, modelo: d.modelo }, idx, d.interfaces.length);
        var c = document.createElementNS(svgNS, "rect");
        c.setAttribute("x", p.x - 5); c.setAttribute("y", p.y - 5);
        c.setAttribute("width", 10); c.setAttribute("height", 10);
        c.setAttribute("class", "puerto");
        c.setAttribute("tabindex", "0");
        c.setAttribute("role", "button");
        c.setAttribute("aria-label", d.id + ":" + iface.id + (iface.habilitada ? "" : ", deshabilitada"));
        var ocupado = !!enlaceEnPuerto(d.id, iface.id);
        var comparte = puertoAdmiteMultiplesEnlaces(d, iface);
        c.setAttribute("fill", !iface.habilitada ? "#999" : (ocupado ? "#0b5fa5" : "#fff"));
        var tit = document.createElementNS(svgNS, "title");
        tit.textContent = iface.id + " (" + iface.medio + ")" + (!iface.habilitada ? " deshabilitada" : (ocupado ? (comparte ? " AP activo" : " ocupada") : " libre"));
        c.appendChild(tit);
        if (S.herramientaCable || S.cableOrigen) {
          var comp = !S.cableOrigen || (iface.medio === S.cableTipo && (!ocupado || comparte) && iface.id !== undefined);
          c.setAttribute("opacity", comp ? "1" : "0.3");
          c.setAttribute("stroke-width", comp ? "2" : "1");
        } else if (S.moviendoExtremo) {
          var em = buscarEnlace(S.moviendoExtremo.enlace);
          var sirve = !!em && !motivoPuertoInvalido(em, S.moviendoExtremo.lado, d, iface);
          c.setAttribute("opacity", sirve ? "1" : "0.3");
          c.setAttribute("stroke-width", sirve ? "2" : "1");
        }
        c.addEventListener("pointerenter", function (ev) {
          mostrarTipPuerto(ev, d, iface);
        });
        c.addEventListener("pointerleave", ocultarTip);
        c.addEventListener("click", function (ev) {
          ev.stopPropagation();
          clicPuerto(d, iface);
        });
        c.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); clicPuerto(d, iface); }
        });
        // Con la herramienta de cable activa, cada puerto suma un área de
        // toque invisible más grande (10 px es poco para un dedo). Mide 28 px
        // de alto y lo que deje la separación con los vecinos, para no
        // pisarlos. Fuera del modo cable no existe: taparía el ícono.
        if (S.herramientaCable || S.cableOrigen || S.moviendoExtremo) {
          var dpT = disposicionPuertos(d, d.interfaces.length);
          var arribaT = idx < dpT.arriba;
          var enLado = arribaT ? dpT.arriba : d.interfaces.length - dpT.arriba;
          var anchoToque = Math.max(10, Math.min(28, (arribaT ? dpT.anchoArriba : dpT.anchoAbajo) / Math.max(1, enLado)));
          var toque = document.createElementNS(svgNS, "rect");
          toque.setAttribute("x", p.x - anchoToque / 2); toque.setAttribute("y", p.y - 14);
          toque.setAttribute("width", anchoToque); toque.setAttribute("height", 28);
          toque.setAttribute("fill", "transparent");
          toque.setAttribute("class", "toque");
          toque.setAttribute("aria-hidden", "true");
          toque.addEventListener("click", function (ev) {
            ev.stopPropagation();
            clicPuerto(d, iface);
          });
          g.appendChild(toque);
        }
        g.appendChild(c);
      });

      // La etiqueta va después de los puertos: queda por encima en el orden
      // de dibujado y arranca debajo del borde inferior de los marcadores.
      var etq = crearEtiqueta(g, d);
      etq.halo = halo;
      etiquetas.push(etq);

      g.addEventListener("pointerenter", function (ev) { mostrarTipNodo(ev, d); });
      g.addEventListener("pointerleave", ocultarTip);
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (S.colocando || S.herramientaCable || S.moviendoExtremo) { return; }
        seleccionar(d.id);
        if (esCelular()) { abrirHoja("configurar"); }
      });
      g.addEventListener("keydown", function (ev) {
        if (ev.target !== g) { return; }
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); seleccionar(d.id); enfocarNodo(d.id); return; }
        if (moverConTeclado(d, ev)) { ev.preventDefault(); ev.stopPropagation(); }
      });
      g.addEventListener("pointerdown", function (ev) { arrastreNodo(ev, d, g); });
      S.capaNodos.appendChild(g);
    });
    resolverSolapes(etiquetas);
    dibujarAsas();
    aplicarVista();
    actualizarCelular();
  }

  /* ---------------- Etiquetas del lienzo ---------------- */

  // Los puertos ocupan el perímetro del ícono (±26 px) con marcadores de
  // 10 px: la etiqueta arranca 6 px por debajo del borde del marcador.
  var ETIQUETA_TOP = 26 + 5 + 6;
  var ETIQUETA_MIN = 14;

  function crearEtiqueta(g, d) {
    var svgNS = "http://www.w3.org/2000/svg";
    var grupo = document.createElementNS(svgNS, "g");
    grupo.setAttribute("class", "etiqueta");
    // Modo presentación: todo el rótulo crece un 25 %.
    var escala = (S.presentacion ? 1.25 : 1) * escalaRotulos();
    var textos = [d.nombre || d.id].concat(lineasResumen(d));
    var lineas = textos.map(function (t, i) {
      var fondo = document.createElementNS(svgNS, "rect");
      fondo.setAttribute("class", "fondoetq");
      fondo.setAttribute("rx", 3);
      var txt = document.createElementNS(svgNS, "text");
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("fill", "currentColor");
      if (i === 0) { txt.setAttribute("font-weight", "600"); } else { txt.setAttribute("class", "mono"); }
      txt.textContent = t;
      grupo.appendChild(fondo);
      grupo.appendChild(txt);
      return { fondo: fondo, texto: txt, tam: Math.round((i === 0 ? 16 : 14) * escala * 10) / 10 };
    });
    g.appendChild(grupo);
    return { d: d, grupo: grupo, lineas: lineas, dy: 0, caja: null, minimo: ETIQUETA_MIN * escalaRotulos(), paso: 2 * escalaRotulos() };
  }

  // El armado de un rótulo va en tres tiempos para no alternar lecturas y
  // escrituras de layout: fijar tamaños (escritura), medir (lectura) y
  // ubicar (escritura).
  function fijarTamanos(e) {
    e.lineas.forEach(function (l) { l.texto.setAttribute("font-size", l.tam); });
  }

  // El ancho sale del texto real; si el lienzo no está visible y el
  // navegador no puede medir, se estima.
  function medirEtiqueta(e) {
    e.lineas.forEach(function (l) {
      var w = 0;
      try { w = l.texto.getComputedTextLength(); } catch (err) { w = 0; }
      l.ancho = w || l.texto.textContent.length * l.tam * 0.58;
    });
  }

  function ubicarEtiqueta(e) {
    var y = ETIQUETA_TOP + e.dy, ancho = 0, pad = 3;
    e.lineas.forEach(function (l) {
      var w = l.ancho;
      l.texto.setAttribute("y", Math.round(y + l.tam * 0.85));
      l.fondo.setAttribute("x", Math.round(-w / 2 - pad));
      l.fondo.setAttribute("y", Math.round(y - pad + 1));
      l.fondo.setAttribute("width", Math.round(w + pad * 2));
      l.fondo.setAttribute("height", Math.round(l.tam * 1.1 + pad * 2 - 2));
      ancho = Math.max(ancho, w + pad * 2);
      y += l.tam * 1.2;
    });
    e.caja = { x1: -ancho / 2, x2: ancho / 2, y1: ETIQUETA_TOP + e.dy - pad, y2: y + pad };
    return e.caja;
  }

  function maquetarEtiqueta(e) {
    fijarTamanos(e);
    medirEtiqueta(e);
    return ubicarEtiqueta(e);
  }

  function cajaMundo(e) {
    return { x1: e.d.x + e.caja.x1, x2: e.d.x + e.caja.x2, y1: e.d.y + e.caja.y1, y2: e.d.y + e.caja.y2 };
  }

  function seSolapan(a, b) {
    return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  }

  // Una pasada: de arriba hacia abajo, cada etiqueta que pisa a una ya
  // ubicada baja un escalón de tipografía (sin pasar del mínimo) y, si
  // todavía choca, se desplaza hacia abajo lo justo para despejarla.
  function resolverSolapes(etiquetas) {
    etiquetas.forEach(fijarTamanos);
    etiquetas.forEach(medirEtiqueta);
    etiquetas.forEach(ubicarEtiqueta);
    var orden = etiquetas.slice().sort(function (a, b) { return (a.d.y - b.d.y) || (a.d.x - b.d.x); });
    var ubicadas = [];
    orden.forEach(function (e) {
      var choca = function () {
        var c = cajaMundo(e);
        for (var i = 0; i < ubicadas.length; i++) {
          var o = cajaMundo(ubicadas[i]);
          if (seSolapan(c, o)) { return o; }
        }
        return null;
      };
      var otra = choca();
      // Primero se achica de a un escalón hasta el mínimo: un rótulo más
      // chico pero junto a su equipo se lee mejor que uno desplazado.
      while (otra && e.lineas.some(function (l) { return l.tam > e.minimo; })) {
        e.lineas.forEach(function (l) { l.tam = Math.max(e.minimo, l.tam - e.paso); });
        maquetarEtiqueta(e);
        otra = choca();
      }
      var vueltas = 0;
      while (otra && vueltas < 6) {
        e.dy += otra.y2 - cajaMundo(e).y1 + 2;
        ubicarEtiqueta(e);
        otra = choca();
        vueltas++;
      }
      ubicadas.push(e);
    });
    // El recuadro de selección abarca el ícono y todo su rótulo.
    etiquetas.forEach(function (e) {
      if (e.halo && e.caja) {
        var ancho = Math.max(68, Math.round(e.caja.x2 - e.caja.x1) + 8);
        e.halo.setAttribute("x", -ancho / 2);
        e.halo.setAttribute("width", ancho);
        e.halo.setAttribute("height", Math.round(e.caja.y2 + 32 + 4));
      }
    });
  }

  function mostrarTipNodo(ev, d) {
    var prim = primeraIp(d);
    S.tooltip.innerHTML = "<b>" + escapar(d.nombre || d.id) + "</b> (" + escapar(d.tipo) + ")<br>" +
      (prim ? escapar(prim.ip + "/" + prim.prefijo) : "sin IP") + "<br>" +
      (d.encendido ? "encendido" : "apagado");
    S.tooltip.style.display = "block";
    posicionarTip(ev);
  }

  function mostrarTipPuerto(ev, d, iface) {
    var enl = enlaceEnPuerto(d.id, iface.id);
    S.tooltip.innerHTML = "<b>" + escapar((d.nombre || d.id) + " · " + iface.id) + "</b><br>puerto " +
      escapar(palabraCable(iface.medio)) + "<br>" + (enl ? escapar("conectado a " + nombreDe(enl.a.dispositivo === d.id && enl.a.interfaz === iface.id ? enl.b.dispositivo : enl.a.dispositivo)) : "libre");
    S.tooltip.style.display = "block";
    posicionarTip(ev);
  }

  function mostrarTipEnlace(ev, e) {
    var d = "";
    if (e.tipo === "wireless") {
      var a = buscarDisp(e.a.dispositivo), b = buscarDisp(e.b.dispositivo);
      if (a && b) {
        var dist = Math.round(Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)));
        var umbral = (S.estado && S.estado.umbralWireless) || (Motor.umbralWireless || 250);
        d = "<br>distancia " + dist + " / máxima " + umbral;
      }
    }
    S.tooltip.innerHTML = "<b>" + escapar(e.id) + "</b> " + escapar(e.tipo) + "<br>" +
      "velocidad " + escapar(String(e.velocidadMbps)) + " Mbps, retardo " +
      escapar(String(e.retardoMs)) + " ms<br>estado " + escapar(e.estado) + d;
    S.tooltip.style.display = "block";
    posicionarTip(ev);
  }

  function posicionarTip(ev) {
    var rect = S.tooltip.parentElement.getBoundingClientRect();
    S.tooltip.style.left = Math.max(4, ev.clientX - rect.left + 12) + "px";
    S.tooltip.style.top = Math.max(4, ev.clientY - rect.top + 12) + "px";
  }

  function ocultarTip() { S.tooltip.style.display = "none"; }

  /* ---------------- Interacción: paleta, nodos, cable ---------------- */

  function arrastrePaleta(ev, tipo, item) {
    ev.preventDefault();
    var fant = el("div", "fantasma", escapar(tipo));
    document.body.appendChild(fant);
    fant.style.left = ev.clientX + "px"; fant.style.top = ev.clientY + "px";
    var movido = false;
    function mover(e2) {
      fant.style.left = (e2.clientX + 8) + "px"; fant.style.top = (e2.clientY + 8) + "px";
      movido = true;
    }
    function soltar(e2) {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      fant.remove();
      var rect = S.svg.getBoundingClientRect();
      if (e2.clientX >= rect.left && e2.clientX <= rect.right && e2.clientY >= rect.top && e2.clientY <= rect.bottom) {
        var p = aMundo(e2);
        agregarDispositivo(tipo, p.x, p.y);
      } else if (!movido) {
        armarColocacion(tipo, item);
      }
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function armarColocacion(tipo, item) {
    S.colocando = tipo;
    var todos = S.paleta.querySelectorAll(".palitem");
    for (var i = 0; i < todos.length; i++) { todos[i].classList.remove("armado"); }
    if (item) { item.classList.add("armado"); }
    registrar("paleta", "Clic en el lienzo para colocar: " + tipo + ". Esc cancela.");
  }

  function arrastreNodo(ev, d, gNodo) {
    if (ev.button === 1 || S.arrastrandoFondo) { return; }
    ev.stopPropagation();
    var inicio = { x: ev.clientX, y: ev.clientY, dx: d.x, dy: d.y };
    var movio = false;
    if (S.colocando || S.herramientaCable) { return; }
    function mover(e2) {
      var rect = S.svg.getBoundingClientRect();
      var k = S.vista.k;
      d.x = Math.round((inicio.dx + (e2.clientX - inicio.x) / k) / 10) * 10;
      d.y = Math.round((inicio.dy + (e2.clientY - inicio.y) / k) / 10) * 10;
      movio = true;
      gNodo.setAttribute("transform", "translate(" + d.x + " " + d.y + ")");
    }
    function soltar() {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (movio) { reconstruirEstado(); renderLienzo(); renderPropiedades(); }
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  function cablearLienzo(zona, svg) {
    svg.addEventListener("pointerdown", function (ev) {
      if (S.colocando) {
        var p = aMundo(ev);
        agregarDispositivo(S.colocando, p.x, p.y);
        S.colocando = null;
        var todos = S.paleta.querySelectorAll(".palitem");
        for (var i = 0; i < todos.length; i++) { todos[i].classList.remove("armado"); }
        return;
      }
      if (ev.button === 1 || ev.target === svg) {
        S.abajo = { x: ev.clientX, y: ev.clientY, vx: S.vista.x, vy: S.vista.y };
        S.arrastrandoFondo = true;
      }
    });
    window.addEventListener("pointermove", function (ev) {
      if (S.moviendoExtremo) { actualizarLineaTemporal(ev); }
      if (S.abajo) {
        S.vista.x = S.abajo.vx + (ev.clientX - S.abajo.x);
        S.vista.y = S.abajo.vy + (ev.clientY - S.abajo.y);
        aplicarVista();
      }
    });
    window.addEventListener("pointerup", function () { S.abajo = null; S.arrastrandoFondo = false; });
    svg.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      S.vista.k = Math.min(3, Math.max(0.3, S.vista.k * (ev.deltaY < 0 ? 1.1 : 0.9)));
      aplicarVista();
      if (S.presentacion) { renderLienzo(); }
    }, { passive: false });
    zona.addEventListener("dragover", function (ev) { ev.preventDefault(); });
    zona.addEventListener("drop", function (ev) {
      ev.preventDefault();
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) { importarTextoDeArchivo(f); }
    });
    svg.addEventListener("click", function () {
      if (S.moviendoExtremo) { cancelarMovimiento(); return; }
      if (!S.herramientaCable && !S.colocando) { seleccionar(null); }
    });
    // Alternativa de teclado al paneo y al zoom con el mouse.
    svg.addEventListener("keydown", function (ev) {
      if (ev.target !== svg) { return; }
      var paso = ev.shiftKey ? 120 : 40;
      var dx = { ArrowLeft: paso, ArrowRight: -paso }[ev.key] || 0;
      var dy = { ArrowUp: paso, ArrowDown: -paso }[ev.key] || 0;
      if (dx || dy) {
        ev.preventDefault();
        S.vista.x += dx; S.vista.y += dy; aplicarVista();
        return;
      }
      if (ev.key === "+" || ev.key === "=") { ev.preventDefault(); accionLienzo("mas"); }
      else if (ev.key === "-") { ev.preventDefault(); accionLienzo("menos"); }
    });
  }

  /* ---------------- Celular: hojas inferiores ---------------- */

  function esCelular() {
    try { return !!(window.matchMedia && window.matchMedia("(max-width:640px)").matches); }
    catch (e) { return false; }
  }

  // Las hojas reutilizan los paneles de escritorio: al abrir se mudan
  // adentro de la hoja y al cerrar vuelven a su lugar.
  function abrirHoja(tipo) {
    if (!S.hojaEl) { return; }
    devolverPaneles();
    S.hoja = tipo;
    S.hojaCuerpo.innerHTML = "";
    if (tipo === "agregar") {
      S.hojaTitulo.textContent = "Agregar";
      S.hojaCuerpo.appendChild(el("h3", "", "Dispositivos"));
      var grilla = el("div", "gridagregar");
      TIPOS.forEach(function (t) {
        var b = boton("");
        b.innerHTML = "<svg viewBox='-24 -20 48 40' aria-hidden='true' focusable='false'>" + icono(t.tipo) + "</svg><span>" + escapar(t.etiqueta) + "</span>";
        b.addEventListener("click", function () {
          armarColocacion(t.tipo, null);
          cerrarHoja();
          avisar(t.etiqueta + " armado · tocá el lienzo para colocarlo");
        });
        grilla.appendChild(b);
      });
      S.hojaCuerpo.appendChild(grilla);
      S.hojaCuerpo.appendChild(el("h3", "", "Cable"));
      var grillaCable = el("div", "gridagregar");
      [["ethernet", "Cobre", "<line x1='-18' y1='0' x2='18' y2='0' stroke='#1e7a34' stroke-width='3'/>"],
       ["fibra", "Fibra", "<line x1='-18' y1='0' x2='18' y2='0' stroke='#1e7a34' stroke-width='9' opacity='.3'/><line x1='-18' y1='0' x2='18' y2='0' stroke='#1e7a34' stroke-width='5'/>"],
       ["wireless", "Wireless", "<line x1='-18' y1='0' x2='18' y2='0' stroke='#1e7a34' stroke-width='3' stroke-dasharray='1 6' stroke-linecap='round'/>"]].forEach(function (c) {
        var b = boton("");
        b.innerHTML = "<svg viewBox='-24 -20 48 40' aria-hidden='true' focusable='false'>" + c[2] + "</svg><span>" + c[1] + "</span>";
        b.addEventListener("click", function () {
          S.cableTipo = c[0]; S.herramientaCable = true; S.cableOrigen = null; S.colocando = null;
          cerrarHoja();
          renderLienzo();
          avisar("Cable " + c[1].toLowerCase() + " armado · tocá dos puertos");
        });
        grillaCable.appendChild(b);
      });
      S.hojaCuerpo.appendChild(grillaCable);
      S.hojaCuerpo.appendChild(el("p", "", "<small>Verde: activo; rojo y cortado: caído. La forma del trazo indica el medio.</small>"));
    } else if (tipo === "configurar") {
      var d = S.seleccionado ? buscarDisp(S.seleccionado) : null;
      var eHoja = !d && S.enlaceSel ? buscarEnlace(S.enlaceSel) : null;
      S.hojaTitulo.textContent = d ? (d.nombre || d.id) : (eHoja ? mayus(cableTexto(eHoja)) : "Configurar");
      S.hojaCuerpo.appendChild(S.prop);
      renderPropiedades();
    } else {
      S.hojaTitulo.textContent = "Ping";
      S.pestañaInf = "simulacion";
      S.hojaCuerpo.appendChild(S.inf);
      renderInferior();
    }
    S.hojaEl.hidden = false;
    actualizarCelular();
    try { S.hojaCerrar.focus(); } catch (e) { /* sin foco: se sigue igual */ }
  }

  function devolverPaneles() {
    if (S.prop && S.cuerpo && S.prop.parentNode !== S.cuerpo) { S.cuerpo.appendChild(S.prop); }
    if (S.inf && S.cuerpo && S.inf.parentNode !== S.raiz) {
      S.raiz.insertBefore(S.inf, S.cuerpo.nextSibling);
    }
  }

  function cerrarHoja() {
    if (!S.hojaEl || S.hojaEl.hidden) { return; }
    devolverPaneles();
    S.hoja = null;
    S.hojaEl.hidden = true;
    S.hojaCuerpo.innerHTML = "";
    actualizarCelular();
  }

  function cancelarHerramientas() {
    S.colocando = null; S.herramientaCable = false; S.cableOrigen = null;
    var todos = S.paleta ? S.paleta.querySelectorAll(".palitem") : [];
    for (var i = 0; i < todos.length; i++) { todos[i].classList.remove("armado"); }
    renderLienzo();
    avisar("Listo, se canceló.");
  }

  // Mensaje breve sobre el lienzo; también se anuncia al lector de pantalla.
  function avisar(texto) {
    if (!S.aviso) { return; }
    S.aviso.textContent = texto;
    S.aviso.hidden = false;
    anunciar(texto);
    clearTimeout(S.temporizadorAviso);
    S.temporizadorAviso = setTimeout(function () { S.aviso.hidden = true; }, 2800);
  }

  function actualizarCelular() {
    if (S.botonAgregar) {
      S.botonAgregar.textContent = (S.colocando || S.herramientaCable) ? "Cancelar" : "+ Agregar";
    }
    if (S.pista) { S.pista.hidden = !!(S.seleccionado || S.hoja || S.colocando || S.herramientaCable); }
  }

  // Colocación desde el teclado: el equipo aparece en el centro de lo que se
  // ve del lienzo, con el foco puesto en él para moverlo con las flechas.
  function colocarEnCentro(tipo) {
    var rect = S.svg.getBoundingClientRect();
    var x = (rect.width / 2 - S.vista.x) / S.vista.k;
    var y = (rect.height / 2 - S.vista.y) / S.vista.k;
    agregarDispositivo(tipo, x, y);
    enfocarNodo(S.seleccionado);
  }

  function enfocarNodo(id) {
    if (!id) { return; }
    var nodos = S.capaNodos.querySelectorAll("g.nodo");
    for (var i = 0; i < nodos.length; i++) {
      if (nodos[i].getAttribute("data-id") === id) {
        try { nodos[i].focus(); } catch (e) { /* SVG sin foco programático: se sigue igual */ }
        return;
      }
    }
  }

  // Mover un equipo con las flechas: la alternativa de teclado al arrastre.
  function moverConTeclado(d, ev) {
    var paso = ev.shiftKey ? 50 : 10;
    var dx = { ArrowLeft: -paso, ArrowRight: paso }[ev.key] || 0;
    var dy = { ArrowUp: -paso, ArrowDown: paso }[ev.key] || 0;
    if (!dx && !dy) { return false; }
    empujarHistorialSuave();
    d.x += dx; d.y += dy;
    reconstruirEstado();
    renderLienzo();
    enfocarNodo(d.id);
    return true;
  }

  /* ---------------- Mover la punta de un cable ----------------
   * Clic en el asa de una punta: queda pegada al puntero. Clic en un puerto
   * válido: el cable se reconecta ahí. Esc o clic en el fondo: se cancela. */

  function extremoOtro(lado) { return lado === "a" ? "b" : "a"; }

  function enlacesEnPuerto(idDisp, idIf) {
    return (S.topologia.enlaces || []).filter(function (x) {
      return (x.a.dispositivo === idDisp && x.a.interfaz === idIf) ||
        (x.b.dispositivo === idDisp && x.b.interfaz === idIf);
    });
  }

  // null si el puerto sirve para esa punta; si no, el motivo en palabras.
  function motivoPuertoInvalido(e, lado, d, iface) {
    var otro = e[extremoOtro(lado)];
    if (d.id === otro.dispositivo && iface.id === otro.interfaz) {
      return "Las dos puntas del cable no pueden ir al mismo puerto.";
    }
    if (iface.medio !== e.tipo) {
      return "Ese cable es " + palabraCable(e.tipo) + " y " + puertoTexto(d.id, iface.id) + " es " + palabraCable(iface.medio) +
        ": cada puerto acepta un solo tipo de cable.";
    }
    if (!iface.habilitada) {
      return mayus(puertoTexto(d.id, iface.id)) + " está deshabilitado: habilitalo primero en la pestaña Interfaces.";
    }
    var otros = enlacesEnPuerto(d.id, iface.id).filter(function (x) { return x.id !== e.id; });
    if (otros.length && !puertoAdmiteMultiplesEnlaces(d, iface)) {
      return mayus(puertoTexto(d.id, iface.id)) + " ya tiene " + cableTexto(otros[0]) + ".";
    }
    return null;
  }

  function iniciarMovimiento(idEnlace, lado) {
    S.moviendoExtremo = { enlace: idEnlace, lado: lado };
    S.herramientaCable = false; S.cableOrigen = null; S.colocando = null;
    renderLienzo();
    avisar("Hacé clic en el puerto nuevo para esta punta del cable (Esc cancela).");
  }

  function cancelarMovimiento() {
    if (!S.moviendoExtremo) { return; }
    S.moviendoExtremo = null;
    S.lineaTemporal = null;
    renderLienzo();
  }

  function aplicarMovimiento(e, lado, idDisp, idIf) {
    var antes = e[lado].dispositivo + ":" + e[lado].interfaz;
    empujarHistorial();
    e[lado] = { dispositivo: idDisp, interfaz: idIf };
    S.moviendoExtremo = null;
    S.lineaTemporal = null;
    reconstruirEstado(); renderTodo();
    registrar("cable", "Cable " + e.id + ": la punta pasó de " + antes + " a " + idDisp + ":" + idIf + ".");
    avisar("Cable movido: ahora llega a " + nombreDe(idDisp) + " por " + idIf + ".");
  }

  function moverExtremo(d, iface) {
    var m = S.moviendoExtremo;
    var e = buscarEnlace(m.enlace);
    if (!e) { cancelarMovimiento(); return; }
    var actual = e[m.lado];
    if (actual.dispositivo === d.id && actual.interfaz === iface.id) { cancelarMovimiento(); return; }
    var motivo = motivoPuertoInvalido(e, m.lado, d, iface);
    // Si el puerto no sirve, la punta sigue pegada para elegir otro.
    if (motivo) { avisar(motivo); return; }
    aplicarMovimiento(e, m.lado, d.id, iface.id);
  }

  // Línea punteada desde la punta fija hasta el puntero.
  function actualizarLineaTemporal(ev) {
    var m = S.moviendoExtremo;
    var e = m && buscarEnlace(m.enlace);
    if (!e) { return; }
    var fija = e[extremoOtro(m.lado)];
    var dFija = buscarDisp(fija.dispositivo);
    if (!dFija) { return; }
    var desde = puntoPuerto(dFija, fija.interfaz);
    var hasta = aMundo(ev);
    if (!S.lineaTemporal || !S.lineaTemporal.isConnected) {
      S.lineaTemporal = document.createElementNS("http://www.w3.org/2000/svg", "line");
      S.lineaTemporal.setAttribute("stroke", "#1a5fb4");
      S.lineaTemporal.setAttribute("stroke-width", 3);
      S.lineaTemporal.setAttribute("stroke-dasharray", "8 6");
      S.lineaTemporal.setAttribute("pointer-events", "none");
      S.capaAsas.appendChild(S.lineaTemporal);
    }
    S.lineaTemporal.setAttribute("x1", desde.x); S.lineaTemporal.setAttribute("y1", desde.y);
    S.lineaTemporal.setAttribute("x2", hasta.x); S.lineaTemporal.setAttribute("y2", hasta.y);
  }

  // Asas en las dos puntas del cable seleccionado, un poco corridas hacia el
  // centro del cable para que el puerto siga a la vista.
  function dibujarAsas() {
    var svgNS = "http://www.w3.org/2000/svg";
    while (S.capaAsas.firstChild) { S.capaAsas.removeChild(S.capaAsas.firstChild); }
    S.lineaTemporal = null;
    var e = S.enlaceSel ? buscarEnlace(S.enlaceSel) : null;
    if (!e) { return; }
    var da = buscarDisp(e.a.dispositivo), db = buscarDisp(e.b.dispositivo);
    if (!da || !db) { return; }
    var pa = puntoPuerto(da, e.a.interfaz), pb = puntoPuerto(db, e.b.interfaz);
    [["a", pa, pb, e.a], ["b", pb, pa, e.b]].forEach(function (t) {
      var lado = t[0], aqui = t[1], alla = t[2], punta = t[3];
      var dx = alla.x - aqui.x, dy = alla.y - aqui.y;
      var largo = Math.sqrt(dx * dx + dy * dy) || 1;
      var corr = Math.min(16, largo / 3);
      var activa = S.moviendoExtremo && S.moviendoExtremo.enlace === e.id && S.moviendoExtremo.lado === lado;
      var asa = document.createElementNS(svgNS, "circle");
      asa.setAttribute("cx", aqui.x + dx / largo * corr);
      asa.setAttribute("cy", aqui.y + dy / largo * corr);
      asa.setAttribute("r", 8);
      asa.setAttribute("class", "asa");
      asa.setAttribute("fill", activa ? "#1a5fb4" : "#ffffff");
      asa.setAttribute("stroke", "#1a5fb4");
      asa.setAttribute("stroke-width", 3);
      asa.setAttribute("tabindex", "0");
      asa.setAttribute("role", "button");
      asa.setAttribute("aria-label", "Mover la punta de " + cableTexto(e) + " que está en " + puertoTexto(punta.dispositivo, punta.interfaz));
      var tit = document.createElementNS(svgNS, "title");
      tit.textContent = "Mover esta punta: clic acá y después en el puerto nuevo";
      asa.appendChild(tit);
      var accion = function (ev) {
        ev.stopPropagation();
        if (activa) { cancelarMovimiento(); } else { iniciarMovimiento(e.id, lado); }
      };
      asa.addEventListener("click", accion);
      asa.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });
      asa.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); accion(ev); }
      });
      S.capaAsas.appendChild(asa);
    });
  }

  // Los mensajes de la herramienta de cable van al registro y también a un
  // aviso en pantalla: la consola no siempre está a la vista.
  function avisoCable(codigo, texto) {
    registrar(codigo, texto);
    avisar(texto);
  }

  function clicPuerto(d, iface) {
    if (S.moviendoExtremo) { moverExtremo(d, iface); return; }
    if (!S.herramientaCable && !S.cableOrigen) { return; }
    if (!iface.habilitada) {
      avisoCable("D01", mayus(puertoTexto(d.id, iface.id)) + " está deshabilitado: habilitalo en la pestaña Interfaces.");
      S.cableOrigen = null;
      renderLienzo();
      return;
    }
    if (!S.cableOrigen) {
      // El tipo de cable se ajusta al primer puerto: si es una wlan, el cable
      // es wireless. Si la otra punta es de otro medio, sigue el D03.
      var ajustado = iface.medio !== S.cableTipo;
      if (ajustado) {
        S.cableTipo = iface.medio;
        if (S.selectCable) { S.selectCable.value = iface.medio; }
      }
      S.cableOrigen = { dispositivo: d.id, interfaz: iface.id };
      avisoCable("cable", "Cable " + palabraCable(S.cableTipo) + " desde " + (d.nombre || d.id) + " (" + iface.id + "): elegí el otro puerto." +
        (ajustado ? " El tipo de cable se ajustó a ese puerto." : ""));
      renderLienzo();
      return;
    }
    var o = S.cableOrigen;
    if (o.dispositivo === d.id && o.interfaz === iface.id) { S.cableOrigen = null; renderLienzo(); return; }
    var od = buscarDisp(o.dispositivo);
    var oi = od ? buscarIface(od, o.interfaz) : null;
    if (!oi) { S.cableOrigen = null; renderLienzo(); return; }
    var origenComparte = puertoAdmiteMultiplesEnlaces(od, oi);
    var destinoComparte = puertoAdmiteMultiplesEnlaces(d, iface);
    if (enlaceEnPuerto(d.id, iface.id) && !destinoComparte) {
      avisoCable("D02", mayus(puertoTexto(d.id, iface.id)) + " ya tiene un cable. Elegí uno libre.");
      S.cableOrigen = null; renderLienzo(); return;
    }
    if (enlaceEnPuerto(o.dispositivo, o.interfaz) && !origenComparte) {
      avisoCable("D02", mayus(puertoTexto(o.dispositivo, o.interfaz)) + " ya tiene un cable. Elegí uno libre.");
      S.cableOrigen = null; renderLienzo(); return;
    }
    if (oi.medio !== S.cableTipo || iface.medio !== S.cableTipo) {
      avisoCable("D03", "Ese cable no va: " + (oi.medio === iface.medio
        ? "los dos puertos son " + palabraCable(oi.medio) + " y el cable es " + palabraCable(S.cableTipo) + "."
        : "un puerto es " + palabraCable(oi.medio) + " y el otro " + palabraCable(iface.medio) + ". Cada puerto acepta un solo tipo de cable."));
      S.cableOrigen = null; renderLienzo(); return;
    }
    empujarHistorial();
    var n = (S.topologia.enlaces || []).length + 1;
    var nuevo = {
      id: idUnicoEnlace("l" + n),
      a: { dispositivo: o.dispositivo, interfaz: o.interfaz },
      b: { dispositivo: d.id, interfaz: iface.id },
      tipo: S.cableTipo, estado: "up",
      velocidadMbps: S.cableTipo === "fibra" ? 1000 : (S.cableTipo === "wireless" ? 54 : 100),
      retardoMs: S.cableTipo === "wireless" ? 3 : 1
    };
    S.topologia.enlaces.push(nuevo);
    S.cableOrigen = null;
    reconstruirEstado(); renderLienzo(); renderPropiedades();
    var extra = "";
    if (nuevo.tipo === "wireless") {
      var dist = Math.round(Math.sqrt(Math.pow(od.x - d.x, 2) + Math.pow(od.y - d.y, 2)));
      var umbral = (S.estado && S.estado.umbralWireless) || 250;
      if (dist > umbral) { extra = " Ojo: están a " + dist + " m y el alcance es de " + umbral + " m, así que la señal no va a llegar."; }
    }
    avisoCable("cable", "Cable " + palabraCable(nuevo.tipo) + " conectado entre " + nombreDe(o.dispositivo) + " (" + o.interfaz + ") y " +
      (d.nombre || d.id) + " (" + iface.id + ")." + extra);
  }

  function idUnicoEnlace(base) {
    var id = base, n = 1;
    var existe = function (x) { return !!buscarEnlace(x); };
    while (existe(id)) { n += 1; id = base + "-" + n; }
    return id;
  }

  function agregarDispositivo(clave, x, y) {
    empujarHistorial();
    var equipo = equipoDeClave(clave);
    var tipo = equipo.tipo;
    var nombre = nombreAutomatico(tipo);
    var id = idUnico(nombre.toLowerCase().replace(/[^a-z0-9]+/g, "") || "eq");
    var gx = Math.round(x / 10) * 10, gy = Math.round(y / 10) * 10;
    var lista = S.topologia.dispositivos || [];
    var ocupado = true, intentos = 0;
    while (ocupado && intentos < 20) {
      ocupado = false;
      for (var i = 0; i < lista.length; i++) {
        if (Math.abs(lista[i].x - gx) < 60 && Math.abs(lista[i].y - gy) < 60) {
          ocupado = true; gx += 40; gy += 30; break;
        }
      }
      intentos += 1;
    }
    var nuevo = {
      id: id, tipo: tipo, nombre: nombre, x: gx, y: gy,
      encendido: true, interfaces: interfacesPorDefecto(clave),
      gateway: null, dns: null, rutas: [], dhcp: null
    };
    if (equipo.modelo) { nuevo.modelo = equipo.modelo; }
    lista.push(nuevo);
    reconstruirEstado(); renderTodo();
    seleccionar(id);
    registrar("topologia", "Se agregó " + nombre + " (" + tipo + ").");
  }

  function borrarSeleccion() {
    if (S.enlaceSel) {
      empujarHistorial();
      S.topologia.enlaces = (S.topologia.enlaces || []).filter(function (e) { return e.id !== S.enlaceSel; });
      registrar("topologia", "Se borró el enlace " + S.enlaceSel + ".");
      S.enlaceSel = null;
    } else if (S.seleccionado) {
      empujarHistorial();
      var id = S.seleccionado;
      S.topologia.dispositivos = (S.topologia.dispositivos || []).filter(function (d) { return d.id !== id; });
      S.topologia.enlaces = (S.topologia.enlaces || []).filter(function (e) {
        return e.a.dispositivo !== id && e.b.dispositivo !== id;
      });
      registrar("topologia", "Se borró el dispositivo " + id + ".");
      S.seleccionado = null;
    } else { return; }
    reconstruirEstado(); renderTodo();
  }

  /* ---------------- Historial, atajos, modos ---------------- */

  function empujarHistorial() {
    S.deshacer.push(JSON.stringify(S.topologia));
    if (S.deshacer.length > 60) { S.deshacer.shift(); }
    S.rehacer = [];
  }

  function deshacer() {
    if (!S.deshacer.length) { return; }
    S.rehacer.push(JSON.stringify(S.topologia));
    S.topologia = JSON.parse(S.deshacer.pop());
    reconstruirEstado(); renderTodo();
  }

  function rehacer() {
    if (!S.rehacer.length) { return; }
    S.deshacer.push(JSON.stringify(S.topologia));
    S.topologia = JSON.parse(S.rehacer.pop());
    reconstruirEstado(); renderTodo();
  }

  function atajos(ev) {
    var mod = ev.ctrlKey || ev.metaKey;
    var foco = document.activeElement;
    var escribiendo = !!foco && (foco.tagName === "INPUT" || foco.tagName === "TEXTAREA");
    if (mod && escribiendo && /^[zy]$/i.test(ev.key)) { return; }
    if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); deshacer(); return; }
    if (mod && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) { ev.preventDefault(); rehacer(); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      var t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) { return; }
      ev.preventDefault(); borrarSeleccion(); return;
    }
    if (ev.key === "Escape") {
      if (S.moviendoExtremo) { cancelarMovimiento(); return; }
      if (S.hoja) { cerrarHoja(); return; }
      S.colocando = null; S.cableOrigen = null; S.herramientaCable = false;
      renderLienzo(); return;
    }
    if (ev.key.toLowerCase() === "f" && !mod && !ev.altKey) {
      var a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) { return; }
      alternarPresentacion();
    }
  }

  function alternarPresentacion() {
    S.presentacion = !S.presentacion;
    S.presExpandida = false;
    S.raiz.classList.toggle("presentacion", S.presentacion);
    if (S.botonPres) {
      S.botonPres.textContent = S.presentacion ? "Salir (F)" : "Presentación (F)";
      S.botonPres.setAttribute("aria-pressed", String(S.presentacion));
    }
    renderLienzo();
    renderInferior();
    // Al proyectar, la topología entra entera; al salir vuelve la vista que
    // había.
    if (S.presentacion) {
      S.vistaPrevia = { x: S.vista.x, y: S.vista.y, k: S.vista.k };
      ajustarVista();
      renderLienzo();
    } else if (S.vistaPrevia) {
      S.vista = S.vistaPrevia;
      S.vistaPrevia = null;
      aplicarVista();
      renderLienzo();
    }
  }

  function alternarTema() {
    S.tema = (S.tema === "claro") ? "oscuro" : "claro";
    S.raiz.classList.toggle("oscuro", S.tema === "oscuro");
    if (S.botonTema) {
      S.botonTema.textContent = S.tema === "oscuro" ? "Tema claro" : "Tema oscuro";
      S.botonTema.setAttribute("aria-pressed", String(S.tema === "oscuro"));
    }
  }

  /* ---------------- Panel derecho ---------------- */

  function renderPropiedades() {
    var c = S.prop;
    c.innerHTML = "";
    if (S.enlaceSel && !S.seleccionado) {
      var e = buscarEnlace(S.enlaceSel);
      if (!e) { S.enlaceSel = null; }
      else {
        c.appendChild(el("h2", "", escapar(mayus(cableTexto(e)))));
        var sel = document.createElement("select");
        sel.innerHTML = "<option value='up'>activo</option><option value='down'>caído</option>";
        sel.value = e.estado;
        sel.addEventListener("change", function () { empujarHistorial(); e.estado = sel.value; reconstruirEstado(); renderLienzo(); });
        c.appendChild(etiqueta("Estado", sel)); c.appendChild(sel);
        ["a", "b"].forEach(function (lado) {
          var selX = document.createElement("select");
          (S.topologia.dispositivos || []).forEach(function (dev) {
            (dev.interfaces || []).forEach(function (f) {
              if (f.medio !== e.tipo) { return; }
              var esActual = e[lado].dispositivo === dev.id && e[lado].interfaz === f.id;
              var motivo = esActual ? null : motivoPuertoInvalido(e, lado, dev, f);
              var op = document.createElement("option");
              op.value = dev.id + ":" + f.id;
              op.textContent = (dev.nombre || dev.id) + " · " + f.id + (esActual ? " (actual)" : (motivo ? " (no disponible)" : ""));
              op.disabled = !!motivo;
              selX.appendChild(op);
            });
          });
          selX.value = e[lado].dispositivo + ":" + e[lado].interfaz;
          selX.addEventListener("change", function () {
            var corte = selX.value.indexOf(":");
            aplicarMovimiento(e, lado, selX.value.slice(0, corte), selX.value.slice(corte + 1));
          });
          c.appendChild(etiqueta("Punta " + lado.toUpperCase(), selX));
          c.appendChild(selX);
        });
        c.appendChild(el("p", "leyenda", "Para mover una punta también podés hacer clic en su asa redonda, en el lienzo, y después en el puerto nuevo."));
        var extra = "";
        if (e.tipo === "wireless") {
          var da = buscarDisp(e.a.dispositivo), db = buscarDisp(e.b.dispositivo);
          if (da && db) {
            var dist = Math.round(Math.sqrt(Math.pow(da.x - db.x, 2) + Math.pow(da.y - db.y, 2)));
            var umbral = (S.estado && S.estado.umbralWireless) || 250;
            extra = "<br>Distancia: " + dist + " m (máximo " + umbral + " m)" + (dist > umbral ? ": fuera de alcance" : "");
          }
        }
        c.appendChild(el("p", "", escapar(nombreDe(e.a.dispositivo) + " (" + e.a.interfaz + ")") + " — " +
          escapar(nombreDe(e.b.dispositivo) + " (" + e.b.interfaz + ")") +
          "<br>Tipo: " + escapar(palabraCable(e.tipo)) + "<br>Velocidad: " + escapar(String(e.velocidadMbps)) + " Mbps<br>Retardo: " +
          escapar(String(e.retardoMs)) + " ms" + extra));
        var bB = boton("Borrar cable (Supr)", "borrar");
        bB.addEventListener("click", borrarSeleccion);
        c.appendChild(bB);
        return;
      }
    }
    var d = S.seleccionado ? buscarDisp(S.seleccionado) : null;
    if (!d) {
      c.innerHTML = "<h2>Propiedades</h2><p style='font-size:13px'>Seleccioná un equipo o un cable del lienzo para configurarlo. Con el teclado: Tab hasta el equipo y Enter.</p>";
      return;
    }
    var tabs = el("div", "tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Propiedades de " + (d.nombre || d.id));
    var nombres = [["config", "Configuración"], ["ifs", "Interfaces"], ["rutas", "Rutas"], ["filtrado", "Filtrado"], ["dhcp", "DHCP"], ["estado", "Estado"]];
    if (d.tipo !== "router") {
      nombres = nombres.filter(function (p) { return p[0] !== "rutas" && p[0] !== "filtrado" && p[0] !== "dhcp"; });
    }
    if (!nombres.some(function (p) { return p[0] === S.pestañaProps; })) { S.pestañaProps = "config"; }
    nombres.forEach(function (p) {
      var activa = p[0] === S.pestañaProps;
      var b = boton(p[1], activa ? "activo" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(activa));
      b.addEventListener("click", function () { S.pestañaProps = p[0]; renderPropiedades(); });
      tabs.appendChild(b);
    });
    c.appendChild(tabs);
    c.appendChild(el("h2", "", escapar(d.nombre || d.id) + " <small>" + escapar(nombreTipo(claveDe(d))) + "</small>"));

    if (S.pestañaProps === "config") { panelConfig(c, d); }
    else if (S.pestañaProps === "ifs") { panelInterfaces(c, d); }
    else if (S.pestañaProps === "rutas") { panelRutas(c, d); }
    else if (S.pestañaProps === "filtrado") { panelFiltrado(c, d); }
    else if (S.pestañaProps === "dhcp") { panelDhcp(c, d); }
    else { panelEstado(c, d); }

    var bBorrar = boton("Borrar dispositivo (Supr)", "borrar");
    bBorrar.addEventListener("click", borrarSeleccion);
    c.appendChild(bBorrar);
  }

  function campoTexto(c, titulo, valor, alCambiar, validar, esDireccion) {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.id = idCampo("prop");
    if (esDireccion) { campoDireccion(inp, titulo.toLowerCase().replace(/[^a-z]+/g, "-")); }
    else { inp.setAttribute("autocomplete", "off"); }
    var lab = etiqueta(titulo, inp);
    inp.value = valor === null || valor === undefined ? "" : String(valor);
    inp.addEventListener("input", function () {
      var ok = validar ? validar(inp.value) : true;
      inp.classList.toggle("invalido", !ok);
      inp.setAttribute("aria-invalid", String(!ok));
      if (ok) { alCambiar(inp.value); }
    });
    c.appendChild(lab); c.appendChild(inp);
    return inp;
  }

  function panelConfig(c, d) {
    campoTexto(c, "Nombre", d.nombre, function (v) {
      empujarHistorialSuave(); d.nombre = v; renderLienzo();
    });
    var habiles = (d.interfaces || []).filter(function (f) { return f.habilitada; });
    var principal = primeraIp(d);
    var selIf = document.createElement("select");
    (d.interfaces || []).forEach(function (f) {
      var op = document.createElement("option");
      op.value = f.id; op.textContent = f.id + " (" + f.medio + ")";
      selIf.appendChild(op);
    });
    var interfazInicial = S.interfazEditada[d.id] || (principal ? principal.id : (d.interfaces[0] && d.interfaces[0].id));
    if (interfazInicial) { selIf.value = interfazInicial; }
    c.appendChild(etiqueta("Interfaz que se edita", selIf)); c.appendChild(selIf);
    var editada = buscarIface(d, selIf.value) || d.interfaces[0];
    selIf.addEventListener("change", function () {
      S.interfazEditada[d.id] = selIf.value;
      renderPropiedades();
    });
    if (!editada) { return; }

    var selModo = document.createElement("select");
    selModo.innerHTML = "<option value='estatico'>estática</option><option value='dhcp'>DHCP</option>";
    selModo.value = editada.modo || "estatico";
    selModo.addEventListener("change", function () {
      // Pedir por DHCP ya guarda el historial y vuelve a dibujar todo.
      if (selModo.value === "dhcp") { solicitarDhcp(d.id, editada.id); return; }
      empujarHistorial(); editada.modo = selModo.value;
      reconstruirEstado(); renderTodo();
    });
    c.appendChild(etiqueta("Modo", selModo)); c.appendChild(selModo);

    campoTexto(c, "Dirección IP", editada.ip || "", function (v) {
      editada.ip = v.trim() === "" ? null : v.trim();
      reconstruirEstado(); renderLienzo(); refrescarCalculo();
    }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); }, true);

    var selM = document.createElement("select");
    for (var p = 8; p <= 30; p++) {
      var op = document.createElement("option");
      op.value = String(p);
      op.textContent = "/" + p + " — " + Red.prefijoAMascara(p);
      selM.appendChild(op);
    }
    selM.value = String(editada.prefijo);
    selM.addEventListener("change", function () {
      empujarHistorial(); editada.prefijo = parseInt(selM.value, 10);
      reconstruirEstado(); renderTodo();
    });
    c.appendChild(etiqueta("Máscara (prefijo y decimal)", selM)); c.appendChild(selM);
    void habiles;

    if (d.tipo !== "switch-l2") {
      campoTexto(c, "Puerta de enlace predeterminada", d.gateway || "", function (v) {
        d.gateway = v.trim() === "" ? null : v.trim();
        reconstruirEstado(); renderLienzo(); refrescarCalculo();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); }, true);
      campoTexto(c, "DNS", d.dns || "", function (v) {
        d.dns = v.trim() === "" ? null : v.trim();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); }, true);
    }
    var labE = el("label", "enlinea");
    var chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = !!d.encendido;
    chk.addEventListener("change", function () {
      empujarHistorial(); d.encendido = chk.checked; reconstruirEstado(); renderTodo();
    });
    labE.appendChild(chk); labE.appendChild(document.createTextNode("Encendido"));
    c.appendChild(labE);
  }

  var temporizadorSuave = null;
  function empujarHistorialSuave() {
    if (temporizadorSuave) { return; }
    empujarHistorial();
    temporizadorSuave = setTimeout(function () { temporizadorSuave = null; }, 1500);
  }

  function panelInterfaces(c, d) {
    (d.interfaces || []).forEach(function (f) {
      var fila = el("div", "filaif");
      var enl = enlaceEnPuerto(d.id, f.id);
      var vecinoIf = enl ? (enl.a.dispositivo === d.id && enl.a.interfaz === f.id ? enl.b.dispositivo : enl.a.dispositivo) : null;
      fila.appendChild(el("span", "datos", "<b>" + escapar(f.id) + "</b> · " + escapar(palabraCable(f.medio)) +
        "<br>" + (f.ip ? escapar(f.ip + "/" + f.prefijo) + " · " : "") + (enl ? "conectado a " + escapar(nombreDe(vecinoIf)) : "sin cable")));
      if (f.medio === "wireless") {
        // Modo de radio (Parche 1): ap sostiene la celda, cliente se asocia a
        // un ap, bridge une dos puntos.
        var selR = document.createElement("select");
        selR.innerHTML = "<option value='ap'>ap</option><option value='cliente'>cliente</option><option value='bridge'>bridge</option>";
        selR.value = f.modoRadio || ((d.tipo === "ap" || d.tipo === "router") ? "ap" : "cliente");
        selR.addEventListener("change", function () {
          empujarHistorial(); f.modoRadio = selR.value;
          reconstruirEstado(); renderTodo();
          registrar("radio", "Interfaz " + d.id + ":" + f.id + " en modo " + selR.value + ".");
        });
        var labR = etiqueta("Modo de radio de " + f.id, selR);
        labR.className = "oculto-visual";
        fila.appendChild(labR);
        fila.appendChild(selR);
      }
      var labH = el("label", "enlinea");
      var sw = document.createElement("input");
      sw.type = "checkbox"; sw.checked = !!f.habilitada;
      sw.addEventListener("change", function () {
        empujarHistorial(); f.habilitada = sw.checked;
        reconstruirEstado(); renderTodo();
        registrar("D01", "Interfaz " + d.id + ":" + f.id + (sw.checked ? " habilitada." : " deshabilitada a propósito."));
      });
      labH.appendChild(sw);
      labH.appendChild(document.createTextNode("habilitada"));
      labH.setAttribute("title", "Deshabilitarla produce D01");
      fila.appendChild(labH);
      c.appendChild(fila);
    });
  }

  function panelRutas(c, d) {
    if (d.tipo !== "router") { c.appendChild(el("p", "", "Sólo los routers tienen tabla de rutas.")); return; }
    var tabla = el("div", "");
    (d.rutas || []).forEach(function (r, i) {
      var fila = el("div", "filaif", "<span>" + escapar(r.destino + "/" + r.prefijo) + " vía " + escapar(r.siguienteSalto || "directa") + "</span>");
      var b = boton("Quitar");
      b.addEventListener("click", function () { empujarHistorial(); d.rutas.splice(i, 1); reconstruirEstado(); renderPropiedades(); });
      fila.appendChild(b);
      tabla.appendChild(fila);
    });
    c.appendChild(tabla);
    var bDef = boton("Agregar ruta por defecto 0.0.0.0/0");
    bDef.addEventListener("click", function () {
      empujarHistorial();
      d.rutas.push({ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "" });
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(bDef);
    var bUna = boton("Agregar ruta");
    bUna.addEventListener("click", function () {
      empujarHistorial();
      d.rutas.push({ destino: "10.0.0.0", prefijo: 24, siguienteSalto: "" });
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(bUna);
    (d.rutas || []).forEach(function (r) {
      campoTexto(c, "Destino", r.destino, function (v) { r.destino = v.trim(); reconstruirEstado(); }, function (v) { return Red.esIpValida(v.trim()); }, true);
      campoTexto(c, "Prefijo (0–32)", String(r.prefijo), function (v) {
        var n = parseInt(v, 10);
        if (!isNaN(n)) { r.prefijo = n; reconstruirEstado(); }
      });
      campoTexto(c, "Siguiente salto", r.siguienteSalto || "", function (v) {
        r.siguienteSalto = v.trim() === "" ? null : v.trim(); reconstruirEstado();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); }, true);
    });
  }

  function esCidr(texto) {
    var m = /^(.+)\/(\d{1,2})$/.exec(String(texto || "").trim());
    return !!m && Red.esIpValida(m[1]) && parseInt(m[2], 10) <= 32;
  }

  // Reglas de filtrado del router: una lista en orden; gana la primera que
  // coincide y lo que no coincide con ninguna pasa.
  function panelFiltrado(c, d) {
    if (!Array.isArray(d.reglas)) { d.reglas = []; }
    c.appendChild(el("p", "",
      "<span style='font-size:13px'>El router revisa cada paquete que reenvía contra estas reglas, en orden: gana la primera que coincide con su origen y su destino. " +
      "Lo que no coincide con ninguna pasa. Escribí redes como 10.45.7.0/26; 0.0.0.0/0 quiere decir cualquiera.</span>"));
    if (d.reglas.length === 0) {
      c.appendChild(el("p", "", "Sin reglas: el router deja pasar todo lo que sabe enrutar."));
    }
    d.reglas.forEach(function (r, i) {
      var completa = esCidr(r.origen) && esCidr(r.destino);
      var texto = (i + 1) + ". " + (r.accion === "permitir" ? "Permitir" : "Bloquear") + " " +
        (r.origen || "?") + " → " + (r.destino || "?") + (completa ? "" : " (incompleta: no se aplica)");
      var fila = el("div", "filaif", "<span class='datos'>" + escapar(texto) + "</span>");
      if (i > 0) {
        var bSubir = boton("Subir");
        bSubir.setAttribute("aria-label", "Subir la regla " + (i + 1));
        bSubir.addEventListener("click", function () {
          empujarHistorial();
          var mov = d.reglas.splice(i, 1)[0];
          d.reglas.splice(i - 1, 0, mov);
          reconstruirEstado(); renderPropiedades();
        });
        fila.appendChild(bSubir);
      }
      var bQuitar = boton("Quitar");
      bQuitar.setAttribute("aria-label", "Quitar la regla " + (i + 1));
      bQuitar.addEventListener("click", function () { empujarHistorial(); d.reglas.splice(i, 1); reconstruirEstado(); renderPropiedades(); });
      fila.appendChild(bQuitar);
      c.appendChild(fila);
      var sel = document.createElement("select");
      [["bloquear", "Bloquear"], ["permitir", "Permitir"]].forEach(function (op) {
        var o = document.createElement("option");
        o.value = op[0]; o.textContent = op[1];
        if ((r.accion || "bloquear") === op[0]) { o.selected = true; }
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { empujarHistorial(); r.accion = sel.value; reconstruirEstado(); renderPropiedades(); });
      c.appendChild(etiqueta("Regla " + (i + 1) + ": acción", sel));
      c.appendChild(sel);
      campoTexto(c, "Regla " + (i + 1) + ": red de origen", r.origen, function (v) {
        empujarHistorialSuave(); r.origen = v.trim(); reconstruirEstado();
      }, esCidr, true);
      campoTexto(c, "Regla " + (i + 1) + ": red de destino", r.destino, function (v) {
        empujarHistorialSuave(); r.destino = v.trim(); reconstruirEstado();
      }, esCidr, true);
    });
    var bAgregar = boton("Agregar regla");
    bAgregar.addEventListener("click", function () {
      empujarHistorial();
      d.reglas.push({ accion: "bloquear", origen: "", destino: "" });
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(bAgregar);
  }

  function panelDhcp(c, d) {
    if (d.tipo !== "router") { c.appendChild(el("p", "", "Sólo los routers son servidores DHCP.")); return; }
    var cfg = d.dhcp || { habilitado: false, desde: "", hasta: "", prefijo: 24, gateway: "" };
    var chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = !!cfg.habilitado;
    var lab = el("label", "enlinea");
    chk.addEventListener("change", function () {
      empujarHistorial(); cfg.habilitado = chk.checked; d.dhcp = cfg;
      reconstruirEstado(); renderPropiedades();
    });
    lab.appendChild(chk); lab.appendChild(document.createTextNode("Servidor DHCP habilitado"));
    c.appendChild(lab);
    [["desde", "Desde"], ["hasta", "Hasta"], ["gateway", "Puerta de enlace que entrega"]].forEach(function (par) {
      campoTexto(c, par[1], cfg[par[0]] || "", function (v) {
        cfg[par[0]] = v.trim(); d.dhcp = cfg; reconstruirEstado();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); }, true);
    });
    campoTexto(c, "Prefijo", String(cfg.prefijo === undefined ? 24 : cfg.prefijo), function (v) {
      var n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 32) { cfg.prefijo = n; d.dhcp = cfg; reconstruirEstado(); }
    });
    if (S.estado) {
      Motor.avisosDhcp(S.estado, d.id).forEach(function (a) {
        c.appendChild(el("div", "advertencia", escapar(a)));
      });
    }
    var conc = (S.estado && S.estado.concesiones && S.estado.concesiones[d.id]) || {};
    var claves = Object.keys(conc);
    c.appendChild(el("p", "", "<b>Concesiones otorgadas:</b> " + (claves.length
      ? claves.map(function (ip) { return escapar(ip + " → " + nombreDe(conc[ip].cliente)); }).join(", ")
      : "ninguna")));
  }

  function panelEstado(c, d) {
    var prim = primeraIp(d);
    c.appendChild(el("p", "", "MAC: " + escapar(prim ? (prim.mac || "—") : "—") + "<br>Enlace: " +
      escapar((function () {
        if (!prim) { return "sin interfaz con IP"; }
        var e = enlaceEnPuerto(d.id, prim.id);
        return e ? (e.id + " (" + e.estado + ")") : "sin cable";
      })())));
    if (S.estado) {
      var arp = [];
      try { arp = Motor.tablaArp(S.estado, d.id) || []; } catch (e) { arp = []; }
      c.appendChild(el("p", "", "<b>Tabla ARP:</b><br>" + (arp.length ? escapar(arp.map(function (x) { return x.ip + " → " + x.mac; }).join(", ")) : "vacía")));
      if (d.tipo === "switch-l2") {
        var mac = [];
        try { mac = Motor.tablaMac(S.estado, d.id) || []; } catch (e) { mac = []; }
        c.appendChild(el("p", "", "<b>Tabla MAC:</b><br>" + (mac.length ? escapar(mac.map(function (x) { return x.mac + " → " + x.puerto; }).join(", ")) : "vacía")));
      }
      var avisos = [];
      try {
        avisos = Motor.advertenciasDe(S.estado, d.id, S.modo === "docente" ? { modoDocente: true } : undefined) || [];
      } catch (e) { avisos = []; }
      if (S.modo === "docente") {
        c.appendChild(el("p", "", "En modo Docente no se muestran avisos: encontrar el problema es parte del ejercicio."));
      } else if (avisos.length) {
        avisos.forEach(function (a) {
          c.appendChild(el("div", "advertencia", "<b>" + escapar(a.titulo) + "</b> <small>" + escapar(a.codigo) + "</small><br>" +
            escapar(a.explicacion) + "<br><i>" + escapar(a.sugerencia) + "</i>"));
        });
      } else {
        c.appendChild(el("p", "", "Sin advertencias de configuración."));
      }
    }
  }

  /* ---------------- Franja inferior ---------------- */

  function renderInferior() {
    var c = S.inf;
    c.innerHTML = "";
    var compacta = S.presentacion && !S.presExpandida;
    c.classList.toggle("compacta", compacta);
    if (compacta) { renderEstadoPresentacion(c); return; }
    var barra = el("div", "tabs");
    var lista = el("div", "");
    lista.setAttribute("role", "tablist");
    lista.setAttribute("aria-label", "Paneles de la franja inferior");
    lista.style.display = "flex";
    lista.style.gap = "4px";
    [["simulacion", "Simulación"], ["dhcp", "DHCP"], ["calculo", "Cálculo de subred"], ["ayuda", "Ayuda"]].forEach(function (p) {
      var activa = p[0] === S.pestañaInf;
      var b = boton(p[1], activa ? "activo" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(activa));
      b.addEventListener("click", function () { S.pestañaInf = p[0]; renderInferior(); });
      lista.appendChild(b);
    });
    barra.appendChild(lista);
    barra.appendChild(el("span", "espacio"));
    var selV = document.createElement("select");
    selV.innerHTML = "<option value='lenta'>lenta</option><option value='normal'>normal</option><option value='rapida'>rápida</option>";
    selV.value = S.velocidad;
    selV.addEventListener("change", function () { S.velocidad = selV.value; });
    barra.appendChild(etiqueta("Velocidad", selV));
    barra.appendChild(selV);
    var colapsado = S.inf.classList.contains("colapsado");
    var bCol = boton(S.presentacion ? "Volver a una línea" : (colapsado ? "Expandir" : "Colapsar"));
    bCol.setAttribute("aria-expanded", String(!colapsado));
    bCol.addEventListener("click", function () {
      if (S.presentacion) { S.presExpandida = false; renderInferior(); return; }
      S.inf.classList.toggle("colapsado");
      renderInferior();
    });
    barra.appendChild(bCol);
    c.appendChild(barra);
    if (colapsado) { return; }
    var cuerpo = el("div", "cuerpoinf");
    c.appendChild(cuerpo);
    if (S.pestañaInf === "simulacion") { panelSimulacion(cuerpo); }
    else if (S.pestañaInf === "dhcp") { panelDhcpInf(cuerpo); }
    else if (S.pestañaInf === "calculo") { panelCalculo(cuerpo); }
    else { panelAyuda(cuerpo); }
  }

  // Modo presentación: la franja queda en una línea de estado para que la
  // topología entre entera en pantalla.
  function renderEstadoPresentacion(c) {
    var fila = el("div", "estadopres");
    var bExp = boton("Expandir simulación");
    bExp.addEventListener("click", function () { S.presExpandida = true; renderInferior(); });
    fila.appendChild(bExp);
    fila.appendChild(el("span", "", escapar(resumenUltimoPing())));
    fila.appendChild(el("span", "espacio"));
    fila.appendChild(el("span", "", "F para salir · flechas sobre el lienzo para desplazarlo"));
    c.appendChild(fila);
  }

  function resumenUltimoPing() {
    var u = S.ultimo;
    if (!u) { return "Todavía no se hizo ningún ping."; }
    var base = "Último ping: " + nombreDe(u.origen) + " → " + u.destino + " · ";
    if (u.res.exito) {
      var r = u.res.respuestas[0] || { ms: 1 };
      return base + "éxito en " + r.ms + " ms · " + cantidadSaltos(u.res) + " saltos";
    }
    var dg = u.res.diagnostico;
    return base + "falla" + (dg ? " " + dg.codigo + " · " + dg.titulo : "");
  }

  function nombreDe(id) {
    var d = buscarDisp(id);
    return d ? (d.nombre || d.id) : id;
  }

  var PALABRA_CABLE = { ethernet: "de cobre", fibra: "de fibra", wireless: "inalámbrico" };

  function palabraCable(medio) {
    return PALABRA_CABLE[medio] || medio;
  }

  // "el puerto fa0/2 de SW-Admin"
  function puertoTexto(idDisp, idIf) {
    return "el puerto " + idIf + " de " + nombreDe(idDisp);
  }

  // "el cable entre PC-Admin y SW-Admin"
  function cableTexto(e) {
    return (e.tipo === "wireless" ? "el enlace inalámbrico entre " : "el cable entre ") +
      nombreDe(e.a.dispositivo) + " y " + nombreDe(e.b.dispositivo);
  }

  function mayus(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  // Recorrido del paquete por nombre de equipo, sin repeticiones seguidas.
  function rutaNombres(res) {
    var nombres = [];
    (res.saltos || []).forEach(function (s) {
      var n = nombreDe(s.dispositivo);
      if (nombres[nombres.length - 1] !== n) { nombres.push(n); }
    });
    return nombres;
  }

  function cantidadSaltos(res) {
    return Math.max(0, rutaNombres(res).length - 1);
  }

  function opcionesEquipos(sel, excluirSwitches) {
    (S.topologia.dispositivos || []).forEach(function (d) {
      if (excluirSwitches && d.tipo === "switch-l2") { return; }
      var op = document.createElement("option");
      op.value = d.id; op.textContent = d.nombre || d.id;
      sel.appendChild(op);
    });
  }

  function panelSimulacion(c) {
    c.classList.add("sim");
    var ctrl = el("div", "simctrl");
    var selO = document.createElement("select");
    opcionesEquipos(selO);
    if (S.origenElegido && buscarDisp(S.origenElegido)) { selO.value = S.origenElegido; }
    else if (S.seleccionado) { selO.value = S.seleccionado; }
    selO.addEventListener("change", function () { S.origenElegido = selO.value; });
    var selD = document.createElement("input");
    selD.type = "text";
    campoDireccion(selD, "destino");
    selD.setAttribute("inputmode", "url");
    selD.placeholder = "p. ej. 10.45.7.122 o google.com…";
    selD.value = S.ultimoDestino || "";
    var bPing = boton("Ping", "primario");
    ctrl.appendChild(etiqueta("Origen", selO)); ctrl.appendChild(selO);
    ctrl.appendChild(el("span", "flecha", "→")).setAttribute("aria-hidden", "true");
    ctrl.appendChild(etiqueta("Destino", selD)); ctrl.appendChild(selD);
    ctrl.appendChild(bPing);
    ctrl.appendChild(el("span", "espacio"));
    // Los botones están siempre en el mismo lugar; si no aplican, quedan
    // deshabilitados en lugar de desaparecer.
    var esc = S.topologia.escenario;
    // Tres casos: un desafío verifica el diseño VLSM pedido; una red con
    // objetivos, los objetivos; una red armada sin enunciado, su propio
    // diseño. En un desafío el botón se destaca: es lo que el alumno busca.
    var conObjetivos = !!(esc && esc.objetivos && esc.objetivos.length);
    var bVer = esDesafioActual() ? boton("Verificar diseño VLSM", "primario")
      : (conObjetivos ? boton("Verificar") : boton("Verificar diseño"));
    bVer.disabled = !conObjetivos && !esDesafioActual() && !(S.topologia.dispositivos || []).length;
    if (bVer.disabled) { bVer.title = "Armá una red para verificar su diseño"; }
    else if (esDesafioActual() && conObjetivos) { bVer.title = "Verifica el diseño VLSM y los objetivos"; }
    else if (!esDesafioActual() && !conObjetivos) { bVer.title = "Revisa las subredes, los solapamientos y las puertas de enlace de tu red"; }
    var hayResultado = !!(S.ultimo || S.ultimaVerif);
    var bCopiar = boton("Copiar registro");
    var bExp = boton("Exportar registro");
    bCopiar.disabled = !hayResultado;
    bExp.disabled = !hayResultado;
    [bVer, bCopiar, bExp].forEach(function (b) { ctrl.appendChild(b); });
    c.appendChild(ctrl);
    c.appendChild(renderResultado());

    function hacerPing() {
      S.ultimoDestino = selD.value;
      S.origenElegido = selO.value;
      if (!S.estado) { reconstruirEstado(); }
      var res;
      try { res = Motor.ping(S.estado, selO.value, selD.value.trim()); }
      catch (e) { registrar("error", "El ping falló por un error interno: " + e.message); return; }
      pintarPing(selO.value, selD.value.trim(), res);
      animarPing(res);
    }
    bPing.addEventListener("click", hacerPing);
    selD.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); hacerPing(); }
    });
    bCopiar.addEventListener("click", function () {
      var texto = S.registro.join("\n");
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(texto).then(function () {
            registrar("registro", "Registro copiado al portapapeles.");
            anunciar("Registro copiado al portapapeles.");
          }).catch(function () { mostrarTextoCopiable(c, texto); });
        } else { throw new Error("sin portapapeles"); }
      } catch (e) {
        mostrarTextoCopiable(c, texto);
      }
    });
    bExp.addEventListener("click", function () {
      try {
        var blob = new Blob([S.registro.join("\n")], { type: "text/plain" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "registro-simulador.txt";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      } catch (e) { registrar("registro", "No se pudo exportar el registro."); }
    });
    bVer.addEventListener("click", verificarActual);
    if (S.enfocarPing) {
      S.enfocarPing = false;
      try { bPing.focus(); } catch (e) { /* sin foco: se sigue igual */ }
    }
  }

  // Si el portapapeles no está disponible, el texto queda seleccionado en
  // pantalla para copiarlo a mano.
  function mostrarTextoCopiable(c, texto) {
    var ta = document.createElement("textarea");
    ta.value = texto; ta.rows = 6; ta.style.width = "100%";
    ta.setAttribute("aria-label", "Registro para copiar");
    c.appendChild(ta); ta.select();
    registrar("registro", "El portapapeles falló: el texto quedó seleccionado abajo.");
  }

  /* ---------------- Resultado: reposo, ping, verificación ---------------- */

  function renderResultado() {
    var cont = el("div", "simres");
    if (S.panelRes === "verificacion" && S.ultimaVerif) { return renderVerificacion(cont); }
    if (!S.ultimo) {
      cont.appendChild(el("div", "vacio",
        "<b>Elegí un origen y un destino, y apretá Ping</b>" +
        "Vas a ver el recorrido paso a paso: cada cosa que el sistema operativo verifica antes de mandar el paquete. " +
        "Si algo falla, acá se indica cuál de esos pasos se rompió y por qué.<br>" +
        "Antes de configurar una IP, mirá la pestaña <b style='display:inline;font-size:inherit'>Cálculo de subred</b>."));
      return cont;
    }
    var res = S.ultimo.res;
    cont.appendChild(renderRecorrido(res));
    var lado = el("div", "lado");
    if (res.exito) {
      var r = res.respuestas[0] || { ms: 1, ttl: 64 };
      var ruta = rutaNombres(res);
      lado.appendChild(el("div", "banda-ok",
        "<b>✓ El eco volvió en " + r.ms + " ms.</b>" +
        "<div class='ruta'>" + escapar(ruta.join(" → ")) + " · " + cantidadSaltos(res) + " saltos · TTL " + r.ttl + "</div>"));
      lado.appendChild(renderConsola());
    } else {
      lado.appendChild(renderDiagnostico(res.diagnostico));
      // Con un diagnóstico a la vista, la consola se pliega a una línea.
      lado.appendChild(renderConsolaPlegable());
    }
    cont.appendChild(lado);
    return cont;
  }

  function renderDiagnostico(dg) {
    if (!dg) { return el("div", "diagnostico", "<span class='tit'>El ping falló sin diagnóstico.</span>"); }
    var caja = el("div", "diagnostico",
      "<span class='tit'>" + escapar(dg.titulo) + "</span>" +
      (dg.codigo && dg.codigo !== "ENTRADA" ? "<span class='cod' title='Código del diagnóstico'>" + escapar(dg.codigo) + "</span>" : "") +
      "<div>" + escapar(dg.explicacion) + "</div>" +
      "<div class='rev'><b>Sugerencia:</b> " + escapar(dg.sugerencia) + "</div>");
    var origen = S.ultimo && S.ultimo.origen;
    if (origen && buscarDisp(origen) && dg.codigo !== "ENTRADA") {
      var bIr = boton("Ir a configurar " + nombreDe(origen), "irconfig");
      bIr.addEventListener("click", function () {
        seleccionar(origen);
        if (esCelular()) { abrirHoja("configurar"); return; }
        var primero = S.prop.querySelector("input,select");
        if (primero) { try { primero.focus(); } catch (e) { /* se sigue igual */ } }
      });
      caja.appendChild(bIr);
    }
    return caja;
  }

  function resumenPaso(p) {
    var lineas = String(p.detalle || "").split("\n").filter(function (l) { return l.trim() !== ""; });
    return lineas.length ? lineas[lineas.length - 1].trim() : "";
  }

  var PASOS_CLAVE = /^(Averiguar la IP de|Decidir si el destino|Buscar ruta|Llegar a internet|Comprobar que la respuesta)/;

  function renderRecorrido(res) {
    var caja = el("div", "recorrido");
    var pasos = res.pasos || [];
    var fallo = -1;
    pasos.forEach(function (p, i) { if (!p.ok && fallo < 0) { fallo = i; } });
    var cab = el("div", "cab", "<span>Recorrido paso a paso</span>");
    if (res.exito) {
      cab.appendChild(el("span", "ok", pasos.length + " de " + pasos.length + " verificaciones correctas"));
    } else if (fallo >= 0) {
      cab.appendChild(el("span", "mal", "se detuvo en el paso " + pasos[fallo].n));
    }
    caja.appendChild(cab);
    var lista = el("div", "pasos");
    var visibles = [];
    if (!pasos.length) {
      lista.appendChild(el("p", "", res.diagnostico && res.diagnostico.codigo === "ENTRADA"
        ? "No se recorrió ningún paso: la dirección de destino no es válida."
        : "No se recorrió ningún paso."));
    } else if (S.verTodos) {
      visibles = pasos;
    } else if (res.exito) {
      visibles = pasos.filter(function (p) { return PASOS_CLAVE.test(p.titulo); });
    } else {
      visibles = pasos.slice(Math.max(0, fallo - 1), fallo + 1);
    }
    visibles.forEach(function (p) {
      if (p.ok) {
        var resumen = resumenPaso(p);
        lista.appendChild(el("div", "linpaso",
          "<span class='marca' aria-hidden='true'>✓</span><b>" + p.n + ".</b> " + escapar(p.titulo) +
          (resumen ? " — " + escapar(resumen) : "")));
      } else {
        var f = el("div", "pasofallo",
          "<span class='marca' aria-hidden='true'>✗</span><b>" + p.n + ". " + escapar(p.titulo) + "</b>");
        var pre = document.createElement("pre");
        // En el resumen van la primera línea del detalle (la cuenta) y la
        // última (la conclusión); los binarios, en "Ver los pasos".
        var det = String(p.detalle || "").split("\n");
        pre.textContent = (S.verTodos || det.length <= 2 ? det : [det[0], det[det.length - 1]]).join("\n");
        f.appendChild(pre);
        lista.appendChild(f);
      }
    });
    caja.appendChild(lista);
    var pie = el("div", "pie");
    if (!res.exito && fallo >= 0 && !S.verTodos) {
      pie.appendChild(el("span", "", "los pasos siguientes no se llegaron a verificar"));
    }
    if (pasos.length > visibles.length || S.verTodos) {
      var bTodos = boton(S.verTodos ? "Ver resumen" : "Ver los " + pasos.length + " pasos");
      bTodos.addEventListener("click", function () { S.verTodos = !S.verTodos; renderInferior(); });
      pie.appendChild(bTodos);
    }
    if (pie.childNodes.length) { caja.appendChild(pie); }
    return caja;
  }

  // Requisitos opcionales del diseño libre: el bloque a repartir y los
  // hosts de cada sector. Se guardan en la red (escenario.diseno), así viajan
  // al exportar, y al cambiarlos se vuelve a verificar.
  function guardarRequisito(campo, clave, valor) {
    empujarHistorial();
    var esc = S.topologia.escenario || (S.topologia.escenario = {});
    var diseno = esc.diseno || (esc.diseno = { bloqueBase: null, hosts: {} });
    if (!diseno.hosts) { diseno.hosts = {}; }
    if (campo === "bloque") { diseno.bloqueBase = valor || null; }
    else if (valor) { diseno.hosts[clave] = valor; }
    else { delete diseno.hosts[clave]; }
    reconstruirEstado();
    verificarActual();
  }

  function renderDisenoLibre(inf, cab, lista) {
    var errores = inf.resumen.errores, advertencias = inf.resumen.advertencias;
    cab.appendChild(el("span", errores ? "mal" : "ok", (errores ? errores + (errores === 1 ? " error" : " errores") : "sin errores") +
      (advertencias ? ", " + advertencias + (advertencias === 1 ? " advertencia" : " advertencias") : "")));
    var filaBloque = el("div", "requisito");
    filaBloque.appendChild(el("span", "nota", "Cada puerto de router, con sus switches, es un sector. " +
      "Para controlar también si alcanzan las direcciones, cargá los hosts de cada sector y el bloque:"));
    var inBloque = document.createElement("input");
    inBloque.type = "text"; inBloque.placeholder = "p. ej. 10.45.7.0/24"; inBloque.value = inf.bloqueBase || "";
    inBloque.addEventListener("change", function () {
      var v = inBloque.value.trim();
      if (v && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v)) { avisar("Escribí el bloque como red/prefijo, por ejemplo 10.45.7.0/24."); return; }
      guardarRequisito("bloque", null, v);
    });
    filaBloque.appendChild(etiqueta("Bloque a repartir (opcional)", inBloque));
    filaBloque.appendChild(inBloque);
    lista.appendChild(filaBloque);
    var grilla = el("div", "sectores");
    lista.appendChild(grilla);
    inf.porSector.forEach(function (sec) {
      var fila = el("div", sec.ok ? "linpaso" : "pasofallo",
        "<span class='marca' aria-hidden='true'>" + (sec.ok ? "✓" : "✗") + "</span><b>" + escapar(sec.sector) + "</b>");
      var inHosts = document.createElement("input");
      inHosts.type = "number"; inHosts.min = "0"; inHosts.className = "hosts";
      inHosts.value = sec.hosts || "";
      inHosts.setAttribute("aria-label", "Hosts que necesita " + sec.sector);
      inHosts.addEventListener("change", function () {
        var n = parseInt(inHosts.value, 10);
        guardarRequisito("hosts", sec.id, isNaN(n) || n <= 0 ? null : n);
      });
      fila.appendChild(document.createTextNode(" "));
      fila.appendChild(inHosts);
      fila.appendChild(el("span", "tenue", " hosts necesarios"));
      sec.hallazgos.forEach(function (h) {
        fila.appendChild(el("div", "", "<small>" + escapar(h.nivel + ": " + h.mensaje) + "</small>"));
      });
      grilla.appendChild(fila);
    });
  }

  function renderVerificacion(cont) {
    var v = S.ultimaVerif;
    var caja = el("div", "recorrido");
    var titulo = v.libre ? "Diseño de la red"
      : (v.vlsm && v.res ? "Diseño VLSM y objetivos" : (v.vlsm ? "Diseño VLSM" : "Objetivos del escenario"));
    var cab = el("div", "cab", "<span>" + titulo + "</span>");
    var lista = el("div", "pasos");
    if (v.error) {
      lista.appendChild(el("p", "", escapar(v.error)));
    }
    if (v.libre) { renderDisenoLibre(v.libre, cab, lista); }
    if (v.vlsm) {
      var errores = v.vlsm.resumen.errores, advertencias = v.vlsm.resumen.advertencias;
      var estado = (errores ? errores + (errores === 1 ? " error" : " errores") : "sin errores") +
        (advertencias ? ", " + advertencias + (advertencias === 1 ? " advertencia" : " advertencias") : "");
      if (v.res) { lista.appendChild(el("div", "", "<b>Diseño VLSM</b> — " + escapar(estado))); }
      else { cab.appendChild(el("span", errores ? "mal" : "ok", estado)); }
      var grillaVlsm = el("div", "sectores");
      lista.appendChild(grillaVlsm);
      v.vlsm.porSector.forEach(function (sec) {
        grillaVlsm.appendChild(el("div", sec.ok ? "linpaso" : "pasofallo",
          "<span class='marca' aria-hidden='true'>" + (sec.ok ? "✓" : "✗") + "</span><b>" + escapar(sec.sector) + "</b>" +
          sec.hallazgos.map(function (h) { return "<br><small>" + escapar(h.nivel + ": " + h.mensaje) + "</small>"; }).join("")));
      });
    }
    if (v.res) {
      var cumplidos = v.res.filter(function (r) { return r.cumple; }).length;
      var estadoObj = cumplidos + " de " + v.res.length + " cumplidos";
      if (v.vlsm) { lista.appendChild(el("div", "", "<b>Objetivos</b> — " + escapar(estadoObj))); }
      else { cab.appendChild(el("span", cumplidos === v.res.length ? "ok" : "mal", estadoObj)); }
      v.res.forEach(function (r) {
        var o = r.objetivo;
        var espera = o.esperado === "falla"
          ? (o.codigo && Motor.CATALOGO[o.codigo]
            ? "se espera que no llegue: " + Motor.CATALOGO[o.codigo].titulo.toLowerCase() + ", " + o.codigo
            : "se espera que no llegue")
          : "se espera que llegue";
        var obtenido = r.cumple ? " — cumple"
          : (r.codigo ? " — no cumple: " + r.titulo + " (" + r.codigo + ")"
            : (o.esperado === "falla" ? " — no cumple: el ping llegó" : " — no cumple"));
        lista.appendChild(el("div", r.cumple ? "linpaso" : "pasofallo",
          "<span class='marca' aria-hidden='true'>" + (r.cumple ? "✓" : "✗") + "</span><b>" +
          escapar(nombreDe(o.origen) + " → " + o.destino) + "</b> (" + escapar(espera) + ")" + escapar(obtenido) +
          (o.descripcion ? "<br><small>" + escapar(o.descripcion) + "</small>" : "")));
      });
    }
    caja.insertBefore(cab, caja.firstChild);
    caja.appendChild(lista);
    cont.appendChild(caja);
    var lado = el("div", "lado");
    lado.appendChild(renderConsola());
    cont.appendChild(lado);
    return cont;
  }

  /* ---------------- Consola ---------------- */

  function consolaAgregar(texto, error) {
    S.lineasConsola.push({ texto: texto, error: !!error });
    if (S.lineasConsola.length > 200) { S.lineasConsola.shift(); }
    refrescarConsola();
  }

  function refrescarConsola() {
    var cons = S.consola;
    if (!cons || !cons.isConnected) { return; }
    cons.innerHTML = S.lineasConsola.length
      ? S.lineasConsola.map(function (l) {
        return l.error ? "<span class='error'>" + escapar(l.texto) + "</span>" : escapar(l.texto);
      }).join("\n")
      : "La consola muestra el ping y el diagnóstico.";
    cons.scrollTop = cons.scrollHeight;
  }

  function renderConsola() {
    var cons = el("pre", "consola");
    cons.setAttribute("aria-label", "Consola");
    S.consola = cons;
    setTimeout(refrescarConsola, 0);
    return cons;
  }

  function renderConsolaPlegable() {
    var cont = el("div", "");
    cont.style.display = "flex";
    cont.style.flexDirection = "column";
    cont.style.minHeight = "0";
    cont.style.flex = S.consolaAbierta ? "1" : "0 0 auto";
    var b = boton("Consola · " + S.lineasConsola.length + " líneas " + (S.consolaAbierta ? "▾" : "▸"), "consolabtn");
    b.setAttribute("aria-expanded", String(!!S.consolaAbierta));
    b.addEventListener("click", function () { S.consolaAbierta = !S.consolaAbierta; renderInferior(); });
    cont.appendChild(b);
    if (S.consolaAbierta) { cont.appendChild(renderConsola()); }
    else { S.consola = null; }
    return cont;
  }

  function pintarPing(origen, destino, res) {
    S.ultimo = { origen: origen, destino: destino, res: res };
    S.panelRes = "ping";
    S.verTodos = false;
    S.consolaAbierta = false;
    if (res.exito) {
      var r = res.respuestas[0] || { ttl: 64, ms: 1 };
      if (res.ipResuelta) { consolaAgregar("Haciendo ping a " + destino + " [" + res.ipResuelta + "]"); }
      consolaAgregar("Respuesta desde " + (res.ipResuelta || destino) + ": bytes=32 tiempo=" + r.ms + "ms TTL=" + r.ttl);
      consolaAgregar("Estadísticas: 1 enviados, 1 recibidos, 0 perdidos.");
      anunciar("Ping a " + destino + ": el eco volvió en " + r.ms + " milisegundos.");
    } else {
      consolaAgregar("El ping de " + nombreDe(origen) + " a " + destino + " falló.", true);
      if (res.diagnostico) {
        consolaAgregar(res.diagnostico.titulo + " (" + res.diagnostico.codigo + ")", true);
      }
      anunciar("Ping a " + destino + " falló" + (res.diagnostico ? ": " + res.diagnostico.titulo : "") + ".");
    }
    registrar("resultado",
      "Ping " + origen + " → " + destino + ": " + (res.exito ? "éxito." : ("falla " + (res.diagnostico ? res.diagnostico.codigo : "") + ".")));
    S.enfocarPing = true;
    renderInferior();
    renderLienzo(); renderPropiedades();
  }

  // Hay un diseño VLSM para verificar cuando el escenario declara sus
  // sectores; el modo elegido en la barra no alcanza: sin sectores no hay
  // contra qué comparar.
  function esDesafioActual() {
    var esc = S.topologia.escenario;
    return !!(esc && (esc.sectores || esc.requerimientos));
  }

  // Verifica lo que el escenario pida: el diseño VLSM si es un desafío, los
  // objetivos de ping si los trae, o las dos cosas.
  function verificarActual() {
    var esc = S.topologia.escenario;
    var conObjetivos = !!(esc && esc.objetivos && esc.objetivos.length);
    var desafio = esDesafioActual();
    S.ultimaVerif = {};
    // Sin objetivos ni desafío se verifica el diseño propio. En una red con
    // objetivos no: sus fallas están plantadas y el informe las delataría.
    if (!conObjetivos && !desafio) {
      if (!(S.topologia.dispositivos || []).length) {
        S.ultimaVerif.error = "Armá una red para verificar su diseño.";
      } else {
        try { S.ultimaVerif.libre = Escenarios.verificarDiseno(S.topologia); }
        catch (e) { S.ultimaVerif.error = "No se pudo verificar el diseño: " + e.message; }
      }
    }
    if (desafio) {
      try { S.ultimaVerif.vlsm = Escenarios.verificarDesafio(S.topologia, esc || {}); }
      catch (e) { S.ultimaVerif.error = "No se pudo verificar el diseño: " + e.message; }
    }
    if (conObjetivos) {
      if (!S.estado) { reconstruirEstado(); }
      try { S.ultimaVerif.res = Escenarios.verificarObjetivos(S.estado, esc.objetivos); }
      catch (e) { S.ultimaVerif.error = "No se pudo verificar: " + e.message; }
      // Cada objetivo es un ping: queda en la consola como si se hubiera hecho a mano.
      if (S.ultimaVerif.res) {
        var n = S.ultimaVerif.res.length;
        consolaAgregar("Verificando " + n + (n === 1 ? " objetivo" : " objetivos") + " del escenario:");
        S.ultimaVerif.res.forEach(function (r) {
          var o = r.objetivo;
          if (!o || o.tipo !== "ping") { return; }
          consolaAgregar((r.cumple ? "✓ " : "✗ ") + "ping " + nombreDe(o.origen) + " → " + o.destino + ": " +
            (r.codigo ? "no llegó — " + r.titulo + " (" + r.codigo + ")" : "llegó"), !r.cumple);
        });
      }
    }
    S.panelRes = "verificacion";
    renderInferior();
    var partes = [];
    if (S.ultimaVerif.libre) {
      var errLibre = S.ultimaVerif.libre.resumen.errores;
      partes.push("diseño de la red " + (errLibre ? "con " + errLibre + (errLibre === 1 ? " error" : " errores") : "sin errores"));
    }
    if (S.ultimaVerif.vlsm) {
      var errores = S.ultimaVerif.vlsm.resumen.errores;
      partes.push("diseño VLSM " + (errores ? "con " + errores + (errores === 1 ? " error" : " errores") : "sin errores"));
    }
    if (S.ultimaVerif.res) {
      var ok = S.ultimaVerif.res.filter(function (r) { return r.cumple; }).length;
      partes.push(ok + " de " + S.ultimaVerif.res.length + " objetivos cumplidos");
    }
    anunciar(S.ultimaVerif.error || ("Verificación: " + partes.join(", ") + "."));
  }

  /* Cálculo de subred atado al seleccionado, con binario en dos colores. */
  function panelCalculo(c) {
    var caja = el("div", "calc");
    c.appendChild(caja);
    S.cajaCalculo = caja;
    refrescarCalculo();
  }

  function binarioColoreado(binario, corte) {
    var plano = String(binario || "").replace(/\./g, "");
    var conPuntos = "";
    for (var i = 0; i < 32; i++) {
      conPuntos += plano[i] || "0";
      if (i === 7 || i === 15 || i === 23) { conPuntos += "."; }
    }
    var corteAjust = corte;
    var html = "";
    for (var j = 0; j < conPuntos.length; j++) {
      var ch = conPuntos[j];
      if (ch === ".") { html += "."; continue; }
      var bit = j - (j > 26 ? 3 : (j > 17 ? 2 : (j > 8 ? 1 : 0)));
      var clase = bit < (S.corteBits !== undefined ? S.corteBits : 24) ? "red" : "host";
      var marca = (j === corteAjust) ? " corte" : "";
      html += "<span class='" + clase + marca + "'>" + ch + "</span>";
    }
    return html;
  }

  function refrescarCalculo() {
    var caja = S.cajaCalculo;
    if (!caja) { return; }
    var d = S.seleccionado ? buscarDisp(S.seleccionado) : null;
    if (!d) { caja.innerHTML = "<p>Seleccioná un dispositivo para ver su cálculo.</p>"; return; }
    var prim = primeraIp(d) || (d.interfaces || [])[0];
    if (!prim) { caja.innerHTML = "<p>El dispositivo no tiene interfaces.</p>"; return; }
    var ip = prim.ip || "";
    var pref = prim.prefijo;
    var gw = d.gateway || "";
    var det = null;
    try { det = (ip && Red.esIpValida(ip)) ? Red.desglose(ip, pref, gw) : null; } catch (e) { det = null; }
    if (!det) {
      caja.innerHTML = "<p><b>" + escapar(d.nombre || d.id) + "</b>: escribí una IP válida en Configuración para ver el desglose. Prefijo actual: /" + escapar(String(pref)) + ".</p>";
      return;
    }
    S.corteBits = det.bitsRed;
    // Tres tarjetas lado a lado, para que entre en la franja sin scroll:
    // el binario, el resultado y la comprobación de la puerta de enlace.
    var html = "<p class='cab'><b>Cálculo de subred — " + escapar(d.nombre || d.id) + "</b>" +
      (prim.id ? ", " + escapar(prim.id) : "") +
      " <span class='tenue'>· atado al equipo seleccionado, se actualiza mientras escribís</span></p>";
    html += "<div class='tarjetas'>";
    html += "<section><h3>IP y máscara en binario</h3><div class='grid'>";
    html += "<span>IP</span><span class='binario'>" + escapar(det.ip) + " &nbsp; Prefijo /" + det.prefijo + "</span>";
    html += "<span>Máscara</span><span class='binario'>" + escapar(det.mascaraDecimal) + "</span>";
    html += "</div>";
    html += "<div class='binario bits'>IP&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" + binarioColoreado(det.ipBinario, det.cortePosicion) + "<br>";
    html += "<span style='font-size:11px'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" +
      "bits de red".padEnd(det.bitsRed, "─") + "│" + "bits de host".padStart(det.bitsHost, "─") + "</span><br>";
    // "IP" más seis espacios y "Máscara" más uno ocupan lo mismo: los bits quedan alineados.
    html += "Máscara&nbsp;" + binarioColoreado(det.mascaraBinaria, det.cortePosicion) + "</div></section>";
    html += "<section><h3>Resultado</h3><div class='grid'>";
    html += "<span>Dirección de red</span><span>" + escapar(det.direccionDeRed) + "</span>";
    html += "<span>Broadcast</span><span>" + escapar(det.broadcast) + "</span>";
    html += "<span>Rango de hosts</span><span>" + escapar(det.rangoTexto || "—") + "</span>";
    html += "<span>Cantidad de hosts</span><span>" + escapar(String(det.cantidadHosts)) + "</span>";
    html += "</div>";
    if (det.advertencia) { html += "<div class='advertencia'>" + escapar(det.advertencia) + "</div>"; }
    html += "</section>";
    // El AND de la propia IP se muestra siempre; la comparación con el
    // gateway, sólo si el equipo tiene uno.
    html += "<section><h3>¿Tu puerta de enlace (gateway) está en tu red?</h3>";
    html += "Tu IP " + escapar(det.ip) + " «AND» máscara → " + escapar((det.gateway && det.gateway.andIp) || det.direccionDeRed) + "<br>";
    if (det.gateway) {
      html += "Puerta de enlace " + escapar(det.gateway.ip) + " «AND» máscara → " + escapar(det.gateway.andGateway || "?") +
        "<div class='veredicto'>" + escapar(det.gateway.veredicto) + "</div>";
    } else if (d.tipo === "internet") {
      html += "Internet no usa puerta de enlace: responde por las direcciones públicas.";
    } else if (d.tipo === "router") {
      html += "Un router no usa puerta de enlace para sus propias redes: para las demás decide con su tabla de rutas.";
    } else {
      html += "Sin puerta de enlace: este equipo solo puede comunicarse con los de su propia red.";
    }
    html += "</section></div>";
    caja.innerHTML = html;
  }

  // Sólo los hosts piden dirección: routers, switches, AP y la nube no.
  function esClienteDhcp(d) {
    return !!d && ["router", "switch-l2", "ap", "internet"].indexOf(d.tipo) < 0;
  }

  function panelDhcpInf(c) {
    c.innerHTML = "";
    c.appendChild(el("p", "titulodhcp", "<b>DHCP</b> <span style='font-size:12px'>— la animación DORA recorre los cables del lienzo.</span>"));
    var clientes = (S.topologia.dispositivos || []).filter(esClienteDhcp);
    if (!clientes.length) {
      c.appendChild(el("p", "", "Agregá una PC (u otro equipo final) para pedir una dirección por DHCP."));
      return;
    }
    var sel = S.dhcpSel || {};
    var inicial = buscarDisp(sel.equipo) || buscarDisp(S.seleccionado);
    if (!esClienteDhcp(inicial)) { inicial = clientes[0]; }
    var selC = document.createElement("select");
    clientes.forEach(function (d) {
      var op = document.createElement("option");
      op.value = d.id; op.textContent = (d.nombre || d.id);
      selC.appendChild(op);
    });
    selC.value = inicial.id;
    var selI = document.createElement("select");
    function cargarIfaces(preferida) {
      selI.innerHTML = "";
      var d = buscarDisp(selC.value);
      var lista = (d && d.interfaces) || [];
      lista.forEach(function (f) {
        var op = document.createElement("option");
        op.value = f.id; op.textContent = f.id + (enlaceEnPuerto(d.id, f.id) ? "" : " (sin cable)");
        selI.appendChild(op);
      });
      var conCable = lista.filter(function (f) { return enlaceEnPuerto(d.id, f.id); })[0];
      if (preferida && buscarIface(d, preferida)) { selI.value = preferida; }
      else if (conCable) { selI.value = conCable.id; }
    }
    cargarIfaces(sel.equipo === inicial.id ? sel.interfaz : null);
    function recordar() { S.dhcpSel = { equipo: selC.value, interfaz: selI.value }; }
    selC.addEventListener("change", function () { cargarIfaces(null); recordar(); });
    selI.addEventListener("change", recordar);
    var b = boton("Solicitar dirección (DORA)", "primario");
    var out = el("div", "");
    out.setAttribute("aria-live", "polite");
    var fila = el("div", "simctrl");
    fila.appendChild(etiqueta("Equipo", selC)); fila.appendChild(selC);
    fila.appendChild(etiqueta("Interfaz", selI)); fila.appendChild(selI);
    fila.appendChild(b);
    c.appendChild(fila); c.appendChild(out);
    // El resultado vive en S.ultimoDhcp: renderTodo() rehace este panel y lo
    // vuelve a mostrar.
    var u = S.ultimoDhcp;
    if (u && u.equipo === selC.value && u.interfaz === selI.value) {
      out.innerHTML = htmlResultadoDhcp(u.res, u.equipo);
    }
    b.addEventListener("click", function () {
      recordar();
      pedirDhcp(selC.value, selI.value);
    });
  }

  // Pide una dirección, guarda el resultado y anima el DORA. Lo usan el
  // panel inferior y el selector de modo del panel de propiedades.
  function pedirDhcp(idDisp, idIf) {
    if (!S.estado) { reconstruirEstado(); }
    if (!S.estado) { avisar("La topología tiene errores: no se puede simular DHCP."); return null; }
    var res;
    try { res = Motor.dhcpSolicitar(S.estado, idDisp, idIf); }
    catch (e) { registrar("D16", "DHCP falló: " + e.message); avisar("DHCP falló: " + e.message); return null; }
    empujarHistorial();
    S.topologia = clonar(S.estado.topologia);
    reconstruirEstado();
    S.dhcpSel = { equipo: idDisp, interfaz: idIf };
    S.ultimoDhcp = { equipo: idDisp, interfaz: idIf, res: res };
    renderTodo();
    avisar(res.exito
      ? nombreDe(idDisp) + " obtuvo " + res.ip + "/" + res.prefijo + " por DHCP."
      : nombreDe(idDisp) + " no obtuvo dirección por DHCP" + (res.ip ? " (quedó en " + res.ip + ")" : "") + ".");
    animarDhcp(res);
    return res;
  }

  function textoMensajeDhcp(m, res) {
    var o = escapar(nombreDe(m.origen));
    var d = escapar(nombreDe(m.destino));
    if (m.tipo === "discover") {
      return "<b>DISCOVER</b> — " + o + " pregunta en difusión a toda su red: ¿hay algún servidor DHCP?";
    }
    if (m.tipo === "offer") {
      var aceptada = res.exito && res.servidor === m.origen;
      return "<b>OFFER</b> — " + o + " le ofrece <b>" + escapar(m.ip) + "</b> a " + d +
        " (en difusión: " + d + " todavía no tiene IP)" +
        (res.mensajes.filter(function (x) { return x.tipo === "offer"; }).length > 1
          ? (aceptada ? " · <b>aceptada</b>" : " · descartada") : "");
    }
    if (m.tipo === "request") {
      return "<b>REQUEST</b> — " + o + " anuncia en difusión que acepta la oferta de " +
        escapar(nombreDe(m.servidor)) + " (" + escapar(m.ip) + ")";
    }
    if (m.tipo === "ack") {
      return "<b>ACK</b> — " + o + " confirma: " + escapar(m.ip + "/" + res.prefijo) + " queda concedida a " + d;
    }
    return "<b>" + escapar(String(m.tipo).toUpperCase()) + "</b> " + o + " → " + d;
  }

  function htmlResultadoDhcp(res, idDisp) {
    // Los pasos DORA en dos columnas: entran en la franja sin scroll.
    var html = "<div class='dora'>" + (res.mensajes || []).map(function (m) {
      var descartada = m.tipo === "offer" && res.exito && res.servidor !== m.origen;
      return "<div class='paso " + (descartada ? "" : "ok") + "'>" + textoMensajeDhcp(m, res) + "</div>";
    }).join("") + "</div>";
    if (res.exito) {
      html += "<p>Dirección otorgada a " + escapar(nombreDe(idDisp)) + ": <b>" + escapar(res.ip + "/" + res.prefijo) +
        "</b>, puerta de enlace " + escapar(res.gateway || "—") + ".</p>";
    } else {
      var dg = res.diagnostico;
      html += "<div class='diagnostico'><span class='tit'>" + escapar(dg ? dg.titulo : "No se obtuvo una IP por DHCP") + "</span>" +
        (dg ? "<span class='cod' title='Código del diagnóstico'>" + escapar(dg.codigo) + "</span>" : "") +
        "<div>" + escapar(dg ? dg.explicacion : "") + "</div>" +
        (dg && dg.sugerencia ? "<div class='rev'><b>Sugerencia:</b> " + escapar(dg.sugerencia) + "</div>" : "") + "</div>";
    }
    (res.avisos || []).forEach(function (a) {
      html += "<div class='advertencia'>" + escapar(a) + "</div>";
    });
    return html;
  }

  // Ayuda en cuatro tarjetas lado a lado, para que entre en la franja sin
  // scroll. Todo lo que dice tiene que poder hacerse en el simulador.
  function panelAyuda(c) {
    c.innerHTML = "";
    var caja = el("div", "ayuda");
    caja.appendChild(el("section", "",
      "<h3>Cómo empezar</h3><ol>" +
      "<li>Arrastrá equipos desde la paleta, o abrí una red con <i>Ejemplos…</i> o <i>Importar</i>.</li>" +
      "<li>Elegí <i>Conectar con un cable</i> y hacé clic en dos puertos.</li>" +
      "<li>Seleccioná cada equipo y cargá su IP, máscara y puerta de enlace en <i>Propiedades</i>.</li>" +
      "<li>Probá la conexión con <i>Ping</i>. Si falla, el recorrido muestra en qué paso se cortó y por qué.</li>" +
      "<li>Comprobá tu diseño con <i>Verificar</i>, en esta misma franja; si la red trae objetivos o es un desafío, también los revisa.</li></ol>"));
    caja.appendChild(el("section", "",
      "<h3>Ideas clave</h3><ul>" +
      "<li>Antes de enviar, el equipo aplica el operador lógico <b>«AND»</b> entre su máscara y cada IP, la suya y la del destino. " +
      "Si dan la misma red, lo entrega directo; si no, se lo pasa a la puerta de enlace.</li>" +
      "<li>La puerta de enlace tiene que estar <b>en la misma red</b> que el equipo.</li>" +
      "<li>El switch no mira direcciones IP ni enruta: para pasar de una subred a otra hace falta un router.</li>" +
      "<li>El ping va y vuelve: la <b>respuesta</b> también necesita una ruta.</li>" +
      "<li>El prefijo y la máscara dicen lo mismo: /24 es 255.255.255.0.</li></ul>"));
    caja.appendChild(el("section", "",
      "<h3>Teclado y mouse</h3><div class='teclas'>" +
      "<span><kbd>Ctrl</kbd>+<kbd>Z</kbd> · <kbd>Ctrl</kbd>+<kbd>Y</kbd></span><span>deshacer · rehacer</span>" +
      "<span><kbd>Supr</kbd></span><span>borra el equipo o cable seleccionado</span>" +
      "<span><kbd>Esc</kbd></span><span>cancela lo que estés haciendo</span>" +
      "<span><kbd>F</kbd></span><span>entra y sale del modo presentación</span>" +
      "<span>Arrastrar el fondo</span><span>mueve la vista; <kbd>+</kbd> <kbd>−</kbd> acercan y alejan</span>" +
      "<span><kbd>Tab</kbd> y flechas</span><span>elegí un equipo con Tab; las flechas lo mueven</span>" +
      "<span><kbd>Enter</kbd> en la paleta</span><span>agrega ese equipo en el centro</span>" +
      "<span>Cambiar un cable de puerto</span><span>seleccionalo, clic en el círculo de la punta y en el puerto nuevo</span>" +
      "</div>"));
    var alcance = (Motor && Motor.UMBRAL_WIRELESS) || 250;
    caja.appendChild(el("section", "",
      "<h3>Qué simplifica el simulador</h3><ul>" +
      "<li>Las rutas se cargan a mano: no hay OSPF, BGP ni RIP. Tampoco STP, VLAN, NAT ni IPv6.</li>" +
      "<li>El único tráfico es el ping, con tiempos aproximados: no hay TCP, HTTP ni TLS.</li>" +
      "<li>El wireless sólo mira la distancia: llega hasta " + alcance + " m.</li>" +
      "<li>El filtrado <b>no recuerda conexiones</b>: una regla puede frenar la respuesta aunque la ida haya pasado.</li>" +
      "<li>Cada router reparte por DHCP un solo rango, sólo a su propia red.</li>" +
      "<li>La nube Internet responde por cualquier IP pública. El DNS conoce google.com, www.google.com, " +
      "dns.google y one.one.one.one.</li></ul>"));
    c.appendChild(caja);
  }

  /* ---------------- Animaciones sobre el lienzo ---------------- */

  function msVelocidad() {
    if (S.velocidad === "lenta") { return 900; }
    if (S.velocidad === "rapida") { return 250; }
    return 500;
  }

  function puntoEn(d) {
    return { x: d ? d.x : 0, y: d ? d.y : 0 };
  }

  function limpiarAnim() {
    while (S.capaAnim.firstChild) { S.capaAnim.removeChild(S.capaAnim.firstChild); }
  }

  function animarPing(resultado) {
    var miToken = ++S.animToken;
    limpiarAnim();
    if (!resultado || !resultado.saltos || !resultado.saltos.length) { return; }
    var svgNS = "http://www.w3.org/2000/svg";
    var puntos = resultado.saltos.map(function (s) {
      var d = buscarDisp(s.dispositivo);
      return puntoEn(d);
    });
    if (puntos.length < 2 && !resultado.exito) {
      var solo = document.createElementNS(svgNS, "circle");
      solo.setAttribute("cx", puntos[0].x); solo.setAttribute("cy", puntos[0].y - 30);
      solo.setAttribute("r", 8); solo.setAttribute("fill", "#b42318");
      S.capaAnim.appendChild(solo);
      return;
    }
    var marca = document.createElementNS(svgNS, "circle");
    marca.setAttribute("r", 7); marca.setAttribute("fill", resultado.exito ? "#1a7f37" : "#b42318");
    marca.setAttribute("stroke", "#fff"); marca.setAttribute("stroke-width", 2);
    S.capaAnim.appendChild(marca);
    if (movimientoReducido()) {
      var fin = puntos[puntos.length - 1];
      marca.setAttribute("cx", fin.x); marca.setAttribute("cy", fin.y - 30);
      if (!resultado.exito) {
        var cruzFija = document.createElementNS(svgNS, "text");
        cruzFija.setAttribute("x", fin.x + 10); cruzFija.setAttribute("y", fin.y - 24);
        cruzFija.setAttribute("font-size", "18"); cruzFija.setAttribute("fill", "#b42318");
        cruzFija.textContent = "✗";
        S.capaAnim.appendChild(cruzFija);
      }
      return;
    }
    var tramo = 0;
    var t0 = null;
    var dur = msVelocidad();
    function cuadro(t) {
      if (miToken !== S.animToken) { return; }
      if (t0 === null) { t0 = t; }
      var avance = (t - t0) / dur;
      if (avance >= 1) {
        tramo += 1; t0 = t;
        if (tramo >= puntos.length - 1) {
          marca.setAttribute("cx", puntos[puntos.length - 1].x);
          marca.setAttribute("cy", puntos[puntos.length - 1].y - 30);
          if (!resultado.exito) {
            var cruz = document.createElementNS(svgNS, "text");
            cruz.setAttribute("x", puntos[puntos.length - 1].x + 10);
            cruz.setAttribute("y", puntos[puntos.length - 1].y - 24);
            cruz.setAttribute("font-size", "18"); cruz.setAttribute("fill", "#b42318");
            cruz.textContent = "✗";
            S.capaAnim.appendChild(cruz);
          }
          return;
        }
        avance = 0;
      }
      var a = puntos[tramo], b = puntos[tramo + 1];
      marca.setAttribute("cx", a.x + (b.x - a.x) * avance);
      marca.setAttribute("cy", (a.y + (b.y - a.y) * avance) - 30);
      requestAnimationFrame(cuadro);
    }
    requestAnimationFrame(cuadro);
    registrar("animacion", "Animación del ping sobre " + resultado.saltos.length + " saltos (" + S.velocidad + ", cancelable con Esc o nuevo ping).");
  }

  // Extremos de un enlace en el lienzo, en el sentido desde→hacia: la misma
  // geometría con la que renderLienzo dibuja el cable.
  function tramoEnlace(e, idDesde) {
    var a = buscarDisp(e.a.dispositivo), b = buscarDisp(e.b.dispositivo);
    if (!a || !b) { return null; }
    var pa = puntoPuerto(a, e.a.interfaz), pb = puntoPuerto(b, e.b.interfaz);
    return e.a.dispositivo === idDesde ? { de: pa, a: pb } : { de: pb, a: pa };
  }

  // Ondas de una trama que inunda: los enlaces se ordenan por distancia (en
  // saltos) al equipo que la emite, y cada onda avanza un enlace más.
  function ondasDifusion(idOrigen, idsEnlaces) {
    var pendientes = idsEnlaces.map(buscarEnlace).filter(Boolean);
    var alcanzados = {}; alcanzados[idOrigen] = true;
    var ondas = [];
    while (pendientes.length) {
      var onda = [], resto = [];
      pendientes.forEach(function (e) {
        if (alcanzados[e.a.dispositivo]) { onda.push({ e: e, desde: e.a.dispositivo }); }
        else if (alcanzados[e.b.dispositivo]) { onda.push({ e: e, desde: e.b.dispositivo }); }
        else { resto.push(e); }
      });
      if (!onda.length) { break; }
      onda.forEach(function (x) { alcanzados[x.e.a.dispositivo] = true; alcanzados[x.e.b.dispositivo] = true; });
      ondas.push(onda.map(function (x) { return tramoEnlace(x.e, x.desde); }).filter(Boolean));
      pendientes = resto;
    }
    return ondas;
  }

  function etiquetaDhcp(m) {
    var t = String(m.tipo).toUpperCase();
    if (m.ip && m.tipo !== "request") { t += " " + m.ip; }
    return t + (m.difusion ? " (difusión)" : "");
  }

  function animarDhcp(resultado) {
    var miToken = ++S.animToken;
    limpiarAnim();
    var svgNS = "http://www.w3.org/2000/svg";
    var msgs = (resultado && resultado.mensajes) || [];
    if (!msgs.length) { return; }
    function linea(p, q, color, ancho, punteada) {
      var l = document.createElementNS(svgNS, "line");
      l.setAttribute("x1", p.x); l.setAttribute("y1", p.y);
      l.setAttribute("x2", q.x); l.setAttribute("y2", q.y);
      l.setAttribute("stroke", color); l.setAttribute("stroke-width", ancho);
      l.setAttribute("stroke-linecap", "round");
      if (punteada) { l.setAttribute("stroke-dasharray", "6 5"); l.setAttribute("opacity", "0.7"); }
      S.capaAnim.appendChild(l);
    }
    // Dibujo fijo de un mensaje: la inundación punteada, el camino útil en
    // trazo firme y el nombre del mensaje sobre quien lo emite.
    function dibujarFijo(m, color) {
      var ondas = ondasDifusion(m.origen, (m.inundados && m.inundados.length) ? m.inundados : (m.enlaces || []));
      ondas.forEach(function (onda) { onda.forEach(function (t) { linea(t.de, t.a, color, 2, true); }); });
      var actual = m.origen;
      (m.enlaces || []).forEach(function (id) {
        var e = buscarEnlace(id);
        var t = e && tramoEnlace(e, actual);
        if (!t) { return; }
        linea(t.de, t.a, color, 4, false);
        actual = e.a.dispositivo === actual ? e.b.dispositivo : e.a.dispositivo;
      });
      var o = buscarDisp(m.origen);
      if (o) {
        var tx = document.createElementNS(svgNS, "text");
        tx.setAttribute("x", o.x + 14); tx.setAttribute("y", o.y - 38);
        tx.setAttribute("font-size", "14"); tx.setAttribute("font-weight", "700");
        tx.setAttribute("fill", color); tx.setAttribute("stroke", "#fff");
        tx.setAttribute("stroke-width", "3"); tx.setAttribute("paint-order", "stroke");
        tx.textContent = etiquetaDhcp(m);
        S.capaAnim.appendChild(tx);
      }
      return ondas;
    }
    function colorDe(m) {
      if (m.tipo === "offer" && resultado.exito && resultado.servidor !== m.origen) { return "#6b7280"; }
      // Cliente en azul, servidor en violeta: el verde ya es el de los cables en up.
      return (m.tipo === "discover" || m.tipo === "request") ? "#0b5fa5" : "#7c3aed";
    }
    if (movimientoReducido()) {
      // Sin animación: queda dibujado el último mensaje con su recorrido.
      dibujarFijo(msgs[msgs.length - 1], colorDe(msgs[msgs.length - 1]));
      return;
    }
    var i = 0;
    function siguiente() {
      if (miToken !== S.animToken) { return; }
      if (i >= msgs.length) { return; }
      limpiarAnim();
      var m = msgs[i];
      var color = colorDe(m);
      var ondas = dibujarFijo(m, color);
      registrar("dhcp", "DORA sobre el lienzo: " + etiquetaDhcp(m) + ", " + nombreDe(m.origen) + " → " +
        (m.destino === "broadcast" ? "toda la red" : nombreDe(m.destino)) + ".");
      var puntos = [];
      var dur = msVelocidad();
      var onda = 0, t0 = null;
      function cuadro(t) {
        if (miToken !== S.animToken) { return; }
        if (t0 === null) { t0 = t; }
        var avance = (t - t0) / dur;
        if (avance >= 1) { onda += 1; t0 = t; avance = 0; }
        puntos.forEach(function (p) { S.capaAnim.removeChild(p); });
        puntos = [];
        if (onda >= ondas.length) {
          i += 1;
          setTimeout(siguiente, dur);
          return;
        }
        ondas[onda].forEach(function (tr) {
          var c = document.createElementNS(svgNS, "circle");
          c.setAttribute("r", 7); c.setAttribute("fill", color);
          c.setAttribute("stroke", "#fff"); c.setAttribute("stroke-width", 2);
          c.setAttribute("cx", tr.de.x + (tr.a.x - tr.de.x) * avance);
          c.setAttribute("cy", tr.de.y + (tr.a.y - tr.de.y) * avance);
          S.capaAnim.appendChild(c);
          puntos.push(c);
        });
        requestAnimationFrame(cuadro);
      }
      requestAnimationFrame(cuadro);
    }
    siguiente();
  }

  function solicitarDhcp(idDisp, idIf) {
    S.pestañaInf = "dhcp";
    return pedirDhcp(idDisp, idIf);
  }

  /* ---------------- Registro, persistencia, importar/exportar ---------------- */

  function registrar(codigo, texto) {
    var linea = "[" + momentoAbs() + " " + momentoRel() + "] " + codigo + " — " + texto;
    S.registro.push(linea);
    if (S.registro.length > 400) { S.registro.shift(); }
    if (typeof codigo === "string" && /^D\d/.test(codigo)) {
      consolaAgregar(codigo + " — " + texto, true);
    }
  }

  // Con el lienzo vacío se explica cómo empezar y, si quedó trabajo de la
  // sesión anterior, se ofrece recuperarlo: no se carga solo, porque en una
  // PC compartida del laboratorio el siguiente no tiene por qué verlo.
  function actualizarLienzoVacio() {
    if (!S.lienzoVacio) { return; }
    var hayEquipos = (S.topologia.dispositivos || []).length > 0;
    if (hayEquipos) { S.trabajoPrevio = null; }
    S.lienzoVacio.hidden = hayEquipos;
    if (hayEquipos) { return; }
    S.lienzoVacio.innerHTML = "<b>Lienzo vacío</b>Arrastrá un dispositivo desde la paleta, o abrí una red con " +
      "<i>Ejemplos…</i> o <i>Importar</i>.";
    if (S.trabajoPrevio) {
      var n = (S.trabajoPrevio.dispositivos || []).length;
      var caja = el("div", "recuperar", "Hay una red guardada de la sesión anterior" +
        (S.trabajoPrevio.nombre ? ", «" + escapar(S.trabajoPrevio.nombre) + "»" : "") +
        " (" + n + (n === 1 ? " equipo" : " equipos") + ").");
      var fila = el("div", "");
      var bRec = boton("Recuperar el trabajo anterior", "primario");
      bRec.addEventListener("click", function () {
        var previo = S.trabajoPrevio;
        S.trabajoPrevio = null;
        cargarTopologia(previo);
        registrar("guardado", "Se recuperó el trabajo de la sesión anterior.");
        avisar("Se recuperó el trabajo de la sesión anterior.");
      });
      var bDes = boton("Descartar");
      bDes.addEventListener("click", function () {
        S.trabajoPrevio = null;
        try { localStorage.removeItem("simuladorRedes.topologia"); } catch (e) { /* sin almacenamiento: se sigue igual */ }
        actualizarLienzoVacio();
        anunciar("Se descartó el trabajo guardado.");
      });
      fila.appendChild(bRec); fila.appendChild(bDes);
      caja.appendChild(fila);
      S.lienzoVacio.appendChild(caja);
    }
  }

  function autoguardar() {
    function guardar() {
      // Un lienzo vacío no pisa lo guardado: sigue disponible para recuperarlo.
      if (!(S.topologia.dispositivos || []).length) { return; }
      try {
        localStorage.setItem("simuladorRedes.topologia", JSON.stringify(S.topologia));
      } catch (e) {
        if (!S.avisoGuardado) {
          S.avisoGuardado = true;
          registrar("guardado", "El navegador bloqueó el autoguardado; la aplicación sigue andando sin guardar.");
        }
      }
    }
    try {
      var previa = localStorage.getItem("simuladorRedes.topologia");
      if (previa && (!S.topologia || !(S.topologia.dispositivos || []).length)) {
        var imp = Escenarios.importar(previa);
        if (imp.ok && (imp.topologia.dispositivos || []).length) { S.trabajoPrevio = imp.topologia; }
      }
    } catch (e) { /* sin guardado previo: se sigue igual */ }
    setInterval(guardar, 30000);
    window.addEventListener("beforeunload", guardar);
  }

  function importarPorArchivo() {
    var inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) { importarTextoDeArchivo(inp.files[0]); }
    });
    inp.click();
  }

  function importarTextoDeArchivo(archivo) {
    var lector = new FileReader();
    lector.onload = function () {
      var res;
      try { res = Escenarios.importar(String(lector.result)); }
      catch (e) { registrar("importar", "Archivo inválido: " + e.message); return; }
      if (!res.ok) {
        registrar("importar", "El archivo no pasó la validación: " + res.errores.map(function (x) { return x.mensaje; }).join(" | "));
        return;
      }
      empujarHistorial();
      cargarTopologia(res.topologia);
      registrar("importar", "Topología importada: " + (res.topologia.nombre || "sin nombre") + ".");
    };
    lector.readAsText(archivo);
  }

  function exportarActual() {
    try {
      var blob = new Blob([Escenarios.exportar(S.topologia)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "topologia.json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    } catch (e) { registrar("exportar", "No se pudo exportar."); }
  }

  /* ---------------- API pública ---------------- */

  function renderTodo() {
    renderLienzo();
    renderPropiedades();
    renderInferior();
    refrescarCalculo();
    var botones = S.raiz.querySelectorAll("[data-modo]");
    for (var i = 0; i < botones.length; i++) {
      var esActivo = botones[i].getAttribute("data-modo") === S.modo;
      botones[i].classList.toggle("activo", esActivo);
      botones[i].setAttribute("aria-pressed", String(esActivo));
    }
  }

  function cargarTopologia(topologia) {
    S.topologia = clonar(topologia);
    S.seleccionado = null; S.enlaceSel = null;
    S.deshacer = []; S.rehacer = [];
    reconstruirEstado();
    recontarNombres();
    renderTodo();
  }

  function topologiaActual() {
    return clonar(S.topologia);
  }

  function seleccionarEnlace(idEnlace) {
    S.moviendoExtremo = null;
    S.seleccionado = null;
    S.enlaceSel = idEnlace;
    renderLienzo();
    renderPropiedades();
  }

  function seleccionar(idDispositivo) {
    S.moviendoExtremo = null;
    S.seleccionado = idDispositivo;
    S.enlaceSel = null;
    renderLienzo();
    renderPropiedades();
    refrescarCalculo();
  }

  function setModo(modo) {
    S.modo = modo;
    // Desafío abre Simulación: ahí está "Verificar diseño VLSM".
    if (modo === "subredes") { S.pestañaInf = "calculo"; }
    else { S.pestañaInf = "simulacion"; }
    renderTodo();
    registrar("modo", "Modo " + modo + ". La topología cargada no cambió." +
      (modo === "docente" ? " No se muestran avisos de configuración." : ""));
  }

  return {
    iniciar: iniciar,
    cargarTopologia: cargarTopologia,
    topologiaActual: topologiaActual,
    seleccionar: seleccionar,
    animarPing: animarPing,
    animarDhcp: animarDhcp,
    setModo: setModo,
    registrar: registrar
  };
})();
