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
    tema: null, // hasta que se aplica uno, el del sistema
    velocidad: "normal",
    animToken: 0,
    inicioMs: Date.now(),
    registro: [],
    registroDescartadas: 0,
    avisoGuardado: false,
    interfazEditada: {},
    contadores: { pc: 0, servidor: 0, router: 0, "switch-l2": 0, camara: 0, iot: 0 },
    abajo: null,
    ultimo: null,
    ultimaVerif: null,
    dhcpSel: null,
    ultimoDhcp: null,
    panelRes: "ping",
    verTodos: false,
    verTramas: false,
    // Captura al estilo Wireshark: se inicia en un cable (o en todos) y
    // acumula lo que pasa por ahí, numerado, hasta detenerla o limpiarla.
    captura: { activa: false, enlace: "", paquetes: [], filtro: "", sel: null, n: 0, descartados: 0 },
    verEncabezados: false,
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
    { tipo: "servidor", etiqueta: "Servidor" },
    { tipo: "router", etiqueta: "Router" },
    { tipo: "firewall", etiqueta: "Firewall" },
    { tipo: "switch-l2", etiqueta: "Switch" },
    { tipo: "camara", etiqueta: "Cámara" },
    { tipo: "iot", etiqueta: "IoT" },
    { tipo: "ap", etiqueta: "Punto de acceso" },
    { tipo: "internet", etiqueta: "Internet" }
  ];

  var PREFIJOS_NOMBRES = { servidor: "SRV", pc: "PC-", router: "R", firewall: "FW-", "switch-l2": "SW", camara: "CAM", iot: "IOT", ap: "AP-", internet: "Internet-" };

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

  var NOMBRES_TIPO = { hub: "hub", servidor: "servidor", pc: "PC", router: "router", "router-8": "router de 8 puertos", firewall: "firewall", internet: "internet", "switch-l2": "switch", camara: "cámara", iot: "IoT", ap: "punto de acceso" };

  // Clave de paleta e ícono: el tipo, salvo el router de 8 puertos y el
  // firewall, que son tipo "router" con modelo "8-puertos" o "firewall".
  function claveDe(d) {
    if (d && d.tipo === "router" && d.modelo === "8-puertos") { return "router-8"; }
    if (d && d.tipo === "router" && d.modelo === "firewall") { return "firewall"; }
    if (d && d.tipo === "switch-l2" && d.modelo === "hub") { return "hub"; }
    return d ? d.tipo : "";
  }

  function equipoDeClave(clave) {
    if (clave === "router-8") { return { tipo: "router", modelo: "8-puertos" }; }
    if (clave === "firewall") { return { tipo: "router", modelo: "firewall" }; }
    return { tipo: clave, modelo: null };
  }

  // Contador de nombres automáticos: el router de 8 puertos comparte el del
  // router (R1, R2…); el firewall tiene el suyo (FW-1…).
  function claveNombre(clave) { return clave === "router-8" ? "router" : clave; }
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
    if (tipo === "servidor") {
      return [iface("eth0", "ethernet", true)];
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
    if (tipo === "firewall") {
      // Como los equipos reales, el firewall trae NAT en su puerto wan.
      return ["wan", "lan1", "lan2", "lan3", "dmz"].map(function (id) {
        var f = iface(id, "ethernet", true);
        if (id === "wan") { f.nat = true; }
        return f;
      });
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

  function nombreAutomatico(clave) {
    var k = claveNombre(clave);
    S.contadores[k] = (S.contadores[k] || 0) + 1;
    return (PREFIJOS_NOMBRES[k] || "EQ") + S.contadores[k];
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

  // «Celular»: pantalla angosta, o táctil con poca altura (un celular en
  // horizontal pasa los 640 px de ancho). La usan el CSS y esCelular().
  var MQ_CELULAR = "(max-width:640px),(max-height:500px) and (pointer:coarse)";

  // Lo que el tema cambia fuera de la raíz: la barra del navegador
  // (theme-color, igual a la cabecera) y el fondo de la página (igual a --sim-fondo).
  var TEMAS = {
    claro: { meta: "#13355e", fondo: "#f7f9fb", esquema: "light" },
    oscuro: { meta: "#0e1a2b", fondo: "#12171e", esquema: "dark" }
  };

  var CSS = [
    ".simraiz{font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;display:flex;flex-direction:column;width:100%;max-width:100vw;height:100%;min-height:520px;overflow:hidden;background:var(--sim-fondo);color:var(--sim-texto);color-scheme:light;--sim-fondo:#f7f9fb;--sim-texto:#14181f;--sim-tenue:#5a6472;--sim-panel:#ffffff;--sim-borde:#c9d1dc;--sim-acento:#1a5fb4;--sim-ok:#1e7a34;--sim-okfondo:#e7f4ea;--sim-mal:#b3261e;--sim-malfondo:#fbeae8;--sim-aviso:#8a5a00;--sim-cabecera:#13355e;--sim-sobreacento:#ffffff;}",
    ".simraiz.oscuro{color-scheme:dark;--sim-fondo:#12171e;--sim-texto:#e8eef4;--sim-tenue:#9aa5b4;--sim-panel:#1b232d;--sim-borde:#3a4a5a;--sim-acento:#5aa9e6;--sim-ok:#4cc38a;--sim-okfondo:#15301f;--sim-mal:#f0726a;--sim-malfondo:#3a1a1a;--sim-aviso:#e0a63c;--sim-cabecera:#0e1a2b;--sim-sobreacento:#0e1a2b;}",
    ".simraiz button,.simraiz select,.simraiz input{font:inherit;font-size:13px;color:var(--sim-texto);background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:6px;touch-action:manipulation;}",
    ".simraiz button{padding:4px 10px;cursor:pointer;}",
    ".simraiz button:hover:not(:disabled),.simraiz select:hover{border-color:var(--sim-acento);}",
    ".simraiz button:disabled{opacity:.45;cursor:not-allowed;}",
    ".simraiz button:focus-visible,.simraiz select:focus-visible,.simraiz input:focus-visible,svg .nodo:focus-visible,svg .puerto:focus-visible,svg .enlace:focus-visible,svg.lienzo:focus-visible{outline:3px solid var(--sim-acento);outline-offset:2px;}",
    ".simraiz button.primario{background:var(--sim-acento);border-color:var(--sim-acento);color:var(--sim-sobreacento);font-weight:600;padding:6px 22px;}",
    ".simraiz button.activo{background:var(--sim-acento);color:var(--sim-sobreacento);border-color:var(--sim-acento);}",
    ".oculto-visual{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}",
    ".simbarra{display:flex;gap:8px;align-items:center;padding:6px 12px;background:var(--sim-cabecera);color:#fff;flex-wrap:wrap;}",
    ".simbarra h1{font-size:16px;margin:0 8px 0 0;font-weight:700;color:#fff;}",
    ".simbarra .modos{display:flex;gap:4px;}",
    ".simbarra button,.simbarra select{background:transparent;color:#fff;border-color:rgba(255,255,255,.28);}",
    ".simbarra button:hover:not(:disabled),.simbarra select:hover{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.6);}",
    ".simbarra select option{color:#14181f;background:#fff;}",
    ".simbarra select{max-width:260px;min-width:0;}",
    ".simbarra button.activo,.simbarra button.activo:hover{background:#fff;color:var(--sim-cabecera);border-color:#fff;}",
    ".saltar{position:absolute;left:8px;top:-48px;z-index:30;background:var(--sim-panel);color:var(--sim-acento);border:2px solid var(--sim-acento);border-radius:6px;padding:6px 12px;font-weight:600;text-decoration:none;}",
    ".saltar:focus{top:8px;}",
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
    ".simpaleta .leyenda{font-size:11px;color:var(--sim-tenue);line-height:1.3;margin:2px 0 0;}",
    ".simpaleta .palgrid + h2{margin-top:8px;}",
    ".simlienzo{flex:1;position:relative;min-width:0;background:var(--sim-fondo);}",
    ".simlienzo svg.lienzo{width:100%;height:100%;display:block;touch-action:none;}",
    ".simtools select{font-size:12px;}",
    ".simtools .cuentadom{align-self:center;font-size:12px;font-weight:600;padding:0 4px;color:var(--sim-texto);}",
    ".simtools .cuentadom:empty{display:none;}",
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
    ".nuevoservicio{display:grid;grid-template-columns:minmax(0,1fr) 64px 72px auto;gap:4px;margin:4px 0;}",
    ".nuevoservicio input,.nuevoservicio select{min-width:0;width:100%;box-sizing:border-box;}",
    ".segmentos{font-family:ui-monospace,Consolas,monospace;font-size:12px;margin-top:4px;line-height:1.45;}",
    ".reglaextra{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 10px;}",
    ".reglaextra select,.reglaextra input{font-size:12px;min-width:0;}",
    ".reglaextra input{width:76px;}",
    ".registrosdns{margin:6px 0;font-size:12px;}",
    ".registrosdns .fila{display:grid;grid-template-columns:78px minmax(0,1fr) auto;grid-template-areas:'n n n' 't v q';gap:3px 4px;align-items:center;padding:4px 0;border-bottom:1px dotted var(--sim-borde);}",
    ".registrosdns .fila .nombre{grid-area:n;}",
    ".registrosdns .fila select{grid-area:t;}",
    ".registrosdns .fila .valor{grid-area:v;}",
    ".registrosdns .fila button{grid-area:q;}",
    ".registrosdns .fila input,.registrosdns .fila select{width:100%;min-width:0;box-sizing:border-box;font-size:12px;}",
    ".registrosdns .valor{display:flex;gap:3px;min-width:0;}",
    ".registrosdns .valor .prio{width:44px;flex:0 0 44px;}",
    ".registrosdns .errreg{color:var(--sim-mal);font-size:11.5px;margin:-1px 0 4px;}",
    ".simprop table.registros{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0;}",
    ".simprop table.registros th,.simprop table.registros td{text-align:left;padding:2px 4px;border-bottom:1px dotted var(--sim-borde);overflow-wrap:anywhere;}",
    ".simprop table.registros td:nth-child(2){white-space:nowrap;}",
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
    ".siminf .cuerpoinf.lab{display:flex;flex-direction:column;overflow:hidden;}",
    ".lab .simctrl{margin-bottom:6px;}",
    ".lab .recorrido .cab{align-items:center;}",
    ".lab .recorrido .cab select,.lab .recorrido .cab button{font-size:12px;font-weight:400;padding:2px 6px;}",
    ".lab .botoneslab{display:flex;gap:4px;}",
    ".labfila{display:flex;align-items:center;gap:4px;border-radius:6px;}",
    ".labfila .labtexto{flex:1;min-width:0;text-align:left;border:0;background:transparent;padding:2px 6px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".labfila.sel{background:var(--sim-okfondo);}",
    ".labfila.sel .labtexto{font-weight:600;}",
    ".labfila.conproblema .labtexto{color:var(--sim-mal);}",
    ".labfila button:not(.labtexto){padding:0 6px;font-size:12px;}",
    ".labsector{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 0;border-bottom:1px dotted var(--sim-borde);font-size:12px;}",
    ".labsector input.nomsector{width:150px;font-size:12px;}",
    ".labsector input.hosts{width:60px;font-size:12px;margin:0;}",
    ".labsector select{font-size:12px;max-width:150px;}",
    ".labsector .ficha{font-size:12px;padding:0 6px;border-radius:10px;}",
    ".formlab{border:1px solid var(--sim-borde);border-radius:8px;padding:6px 10px;font-size:12px;}",
    ".formlab .cablab{display:flex;align-items:center;gap:8px;margin-bottom:4px;}",
    ".formlab .cablab b{color:var(--sim-acento);}",
    ".formlab .camposlab{display:flex;flex-wrap:wrap;gap:4px 10px;}",
    ".formlab .campolab{display:flex;flex-direction:column;min-width:0;}",
    ".formlab .campolab.ancho{flex:1 1 100%;}",
    ".formlab .campolab label{font-size:11px;color:var(--sim-tenue);}",
    ".formlab .campolab select,.formlab .campolab input{font-size:12px;max-width:220px;}",
    ".formlab .campolab input[type=number]{width:80px;}",
    ".formlab .campolab.ancho input{max-width:none;width:100%;box-sizing:border-box;}",
    ".formlab p{margin:4px 0;}",
    ".avisolab{color:var(--sim-mal);font-size:12px;}",
    ".tablalab{width:100%;border-collapse:collapse;font-size:12px;}",
    ".tablalab th{text-align:left;position:sticky;top:0;background:var(--sim-panel);border-bottom:1px solid var(--sim-borde);padding:2px 6px;}",
    ".tablalab td{padding:1px 6px;}",
    ".tablalab td.ok{color:var(--sim-ok);white-space:nowrap;}",
    ".tablalab td.mal{color:var(--sim-mal);white-space:nowrap;}",
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
    ".agregarpuerto{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--sim-borde);font-size:12px;}",
    ".filaif select{max-width:120px;}",
    ".simbarra h1 .logo{width:28px;height:28px;vertical-align:-7px;margin-right:8px;}",
    ".simbarra h1 .subtitulo{font-weight:400;font-size:.72em;opacity:.8;margin-left:6px;}",
    "@media " + MQ_CELULAR + "{.simbarra h1 .subtitulo{display:none;}}",
    ".ayuda{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;padding:2px 0;font-size:12px;line-height:1.3;}",
    ".ayuda section{background:var(--sim-fondo);border:1px solid var(--sim-borde);border-radius:10px;padding:4px 10px;min-width:0;}",
    ".ayuda h3{margin:0 0 3px;font-size:12.5px;color:var(--sim-acento);}",
    ".ayuda ul,.ayuda ol{margin:0;padding-left:18px;}",
    ".ayuda li{margin:0;}",
    ".siminf .tabs .version{font-size:12px;color:var(--sim-tenue);white-space:nowrap;margin-right:16px;padding-right:16px;border-right:1px solid var(--sim-borde);}",
    ".siminf .tabs .version a{color:inherit;text-underline-offset:2px;}",
    ".siminf .tabs .version a:hover,.siminf .tabs .version a:focus-visible{color:var(--sim-acento);}",
    ".ayuda .teclas{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;align-items:baseline;}",
    ".ayuda .teclas span:nth-child(odd){white-space:nowrap;}",
    ".ayuda kbd{font-family:ui-monospace,Consolas,monospace;font-size:11px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-bottom-width:2px;border-radius:4px;padding:0 4px;}",
    ".siminf .cuerpoinf.sim{display:flex;flex-direction:column;overflow:hidden;}",
    ".modosim{display:inline-flex;border:1px solid var(--sim-borde);border-radius:6px;overflow:hidden;}",
    ".modosim button{border:0;border-radius:0;margin:0;}",
    ".simctrl input.puerto{width:72px;}",
    ".simctrl input.filtrocap{flex:1;min-width:180px;font-family:ui-monospace,Consolas,monospace;font-size:12px;}",
    ".tablacap{width:100%;border-collapse:collapse;font-family:ui-monospace,Consolas,monospace;font-size:12px;}",
    ".tablacap th{text-align:left;position:sticky;top:0;background:var(--sim-panel);border-bottom:1px solid var(--sim-borde);padding:2px 6px;}",
    ".tablacap td{padding:1px 6px;white-space:nowrap;}",
    ".tablacap td:nth-child(5){white-space:normal;}",
    ".tablacap tr{cursor:pointer;}",
    ".tablacap tr.p-icmp{background:rgba(252,224,255,.35);}",
    ".tablacap tr.p-tcp{background:rgba(231,230,255,.45);}",
    ".tablacap tr.p-udp{background:rgba(218,238,255,.45);}",
    ".tablacap tr.sel{background:var(--sim-acento);color:var(--sim-sobreacento);}",
    ".tablacap tr:focus{outline:none;}",
    ".tablacap tr:focus-visible{outline:2px solid var(--sim-acento);outline-offset:-2px;}",
    ".tablacap tr.sel:focus-visible{outline-color:var(--sim-sobreacento);}",
    ".detallecap{border:1px solid var(--sim-borde);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.6;overflow:auto;}",
    ".detallecap b{color:var(--sim-acento);}",
    ".modosim button.activo{background:var(--sim-acento);color:var(--sim-sobreacento);}",
    ".simctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}",
    ".simctrl label{font-size:12px;color:var(--sim-tenue);}",
    ".simctrl .flecha{color:var(--sim-tenue);}",
    ".simctrl input{width:170px;font-family:ui-monospace,Consolas,monospace;}",
    ".simctrl .espacio{flex:1;}",
    ".simres{display:flex;gap:12px;flex:1;min-height:0;}",
    ".simres .recorrido{flex:3;min-width:0;border:1px solid var(--sim-borde);border-radius:8px;display:flex;flex-direction:column;min-height:0;}",
    ".simres .lado{flex:2;min-width:0;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;}",
    ".simres .colconsola{flex:2;min-width:0;display:flex;flex-direction:column;min-height:0;}",
    ".recorrido .cab{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:600;color:var(--sim-tenue);padding:4px 10px;border-bottom:1px solid var(--sim-borde);}",
    ".recorrido .cab .ok{color:var(--sim-ok);font-weight:400;}",
    ".recorrido .cab .mal{color:var(--sim-mal);font-weight:400;}",
    ".recorrido .pasos{flex:1;min-height:0;overflow:auto;padding:4px 10px;}",
    ".recorrido .pie{display:flex;align-items:center;gap:8px;padding:4px 10px 6px;font-size:12px;color:var(--sim-tenue);font-style:italic;}",
    ".linpaso{font-size:13px;padding:2px 0;}",
    ".capa{display:inline-block;min-width:92px;color:var(--sim-tenue);border:1px solid var(--sim-borde);font-size:11px;border-radius:4px;padding:0 5px;margin-right:6px;text-align:center;vertical-align:1px;cursor:help;}",
    ".recorrido .nota-ttl{font-size:12px;color:var(--sim-tenue);margin:0 0 4px;}",
    ".trama{font-size:13px;padding:2px 4px;border-radius:4px;}",
    ".trama:hover{background:var(--sim-okfondo);}",
    ".trama:focus{outline:none;}",
    ".trama:focus-visible{outline:2px solid var(--sim-acento);outline-offset:1px;}",
    ".trama .sent{display:inline-block;min-width:64px;color:var(--sim-tenue);font-size:12px;}",
    ".trama .cambia{color:var(--sim-mal);}",
    ".trama .queda{color:var(--sim-ok);}",
    ".enc{display:inline-block;border:1px solid var(--sim-borde);border-radius:4px;padding:1px 6px;margin:2px 0 2px 64px;font-family:ui-monospace,Consolas,monospace;font-size:11px;}",
    ".enc .enc{margin:0 0 0 6px;}",
    ".enc b{font-family:system-ui,sans-serif;font-weight:600;color:var(--sim-tenue);margin-right:4px;}",
    ".enc mark{background:#fde68a;color:#111;border-radius:2px;padding:0 2px;}",
    ".linpaso .marca{color:var(--sim-ok);margin-right:4px;}",
    ".linpaso.pendiente{color:var(--sim-tenue);}",
    ".pasofallo{border:1px solid var(--sim-mal);background:var(--sim-malfondo);border-radius:6px;padding:6px 8px;margin:4px 0;font-size:13px;}",
    ".pasofallo .marca{color:var(--sim-mal);margin-right:4px;}",
    ".pasofallo pre{margin:4px 0 0;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre-wrap;}",
    ".banda-ok{border:1px solid var(--sim-ok);border-left:6px solid var(--sim-ok);background:var(--sim-okfondo);border-radius:8px;padding:8px 12px;}",
    ".banda-ok b{font-size:16px;color:var(--sim-ok);}",
    ".banda-ok.conperdida{border-color:var(--sim-aviso);border-left-color:var(--sim-aviso);}",
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
    ".simaviso{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:var(--sim-acento);color:var(--sim-sobreacento);border-radius:10px;padding:6px 12px;font-size:13px;z-index:6;pointer-events:none;max-width:90%;text-align:center;}",
    ".pista{position:absolute;left:10px;bottom:10px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:8px;padding:6px 10px;font-size:13px;color:var(--sim-tenue);}",
    ".diagnostico .irconfig{margin-top:8px;border-color:var(--sim-mal);color:var(--sim-mal);}",
    "@media (max-width:900px){.simpaleta{width:140px;flex-basis:140px;}.palgrid{grid-template-columns:1fr;}.simprop{width:240px;flex-basis:240px;}.simbarra{gap:5px;padding:5px 6px;}.simbarra button{padding:4px 7px;}}",
    "@media " + MQ_CELULAR + "{" +
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
    ".simraiz h2,.simraiz h3{text-wrap:balance;}",
    "@media (prefers-reduced-motion:reduce){.simraiz *,.simraiz *::before,.simraiz *::after{scroll-behavior:auto;transition:none !important;animation:none !important;}}",
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
    if (tipo === "firewall") {
      return "<rect x='-18' y='-13' width='36' height='26' rx='3' fill='#f4b8a8' stroke='#8f2d1a' stroke-width='2'/>" +
        "<path d='M-18 -4.5 H18 M-18 4.5 H18 M-6 -13 V-4.5 M8 -13 V-4.5 M-12 -4.5 V4.5 M2 -4.5 V4.5 M14 -4.5 V4.5 M-6 4.5 V13 M8 4.5 V13' " +
        "stroke='#8f2d1a' stroke-width='1.6' fill='none'/>";
    }
    if (tipo === "router-8") {
      return "<rect x='-26' y='-11' width='52' height='22' rx='4' fill='#f6d186' stroke='#8a5a00' stroke-width='2'/>" +
        "<path d='M-9 -5 L9 5 M-9 5 L9 -5' stroke='#8a5a00' stroke-width='2'/>" +
        "<circle cx='0' cy='0' r='2.5' fill='#8a5a00'/>";
    }
    if (tipo === "hub") {
      return "<rect x='-20' y='-10' width='40' height='20' rx='4' fill='#e0e0e0' stroke='#555' stroke-width='2'/>" +
        "<text x='0' y='4' text-anchor='middle' font-size='10' font-weight='700' fill='#444' font-family='system-ui,sans-serif'>HUB</text>";
    }
    if (tipo === "servidor") {
      return "<rect x='-12' y='-16' width='24' height='32' rx='2' fill='#c5cae9' stroke='#283593' stroke-width='2'/>" +
        "<path d='M-8 -7 H8 M-8 1 H8 M-8 9 H8' stroke='#283593' stroke-width='2'/>" +
        "<circle cx='6' cy='-11' r='1.6' fill='#2e7d32'/>";
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

  // Marca de OpenRedLab en blanco para la barra oscura (img/openredlab-marca-blanco.png,
  // 64 px), embebida para que el archivo siga funcionando solo y sin conexión.
  var LOGO_BLANCO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAP1klEQVR42t1be3AdV3n/fbt7H9K90pVl6foV7HGIgdRDMiEh0AkDcfqKIQ1JqEMzUEJLmgY6A20oMdQlkkjrgZCEphQySSE0lNc4nRCIjSe0wU4TTEycB4xxbFPHsh6RX4ktWZau7t2zv/5xvyMfr3clWZYYl53Zufs4e875vvN9v+91LvAbPkgKST/p3SYgICD4bT1IBs7175C859BV1z3c5+XX7F2yZP74O8D/bSPcd67bSH6BxlRIcuiqaznsN/KV1gUH+kvlv9mN83LKBI+AN9tz82aZcI+kJyKGZEDyowCeB3AbyCyA6nFjaq8KqiDLBcGXis1DW/tL5WsFiASICPizqRbebOq5iEQiEpG8EsAWAF8F8DoAtfoiIwDpe2BgADMURVVfeGFe8Mj+lnkbXiktuFgAIwBnCx+8WSA8EBHqql9I8hEAGwG8VQk3AAKMEyOIIgCgiEhQBcIRspYD3i0IfzbQ1PaVntbWRSuAUADOND54M6nnSnhIch7JuwE8A+BaJdoS7o5JgJZ8yxNfAH+YUa0G+A2e97Gs8V84UGr/u904LyeAmUl88GZYzzMkPw7gBQC3AsgBCHUcT8XeHgaAHwRBQNBInRkgQIoIIIEAPAZWjUh7g+d9sdg8+PP+4tz3WnyYCbXwZkDcrZ6/R/X8XgALHD13RVbGpcH3AwCVWmWsuznIZETEJxCSKhkCQEQgkonAaIis+oILcr736IHm9h/0trRfaNViU12ypnXIdO25iIR6fQGAzwF4r76uKdHxvqnEZ/R+I4Dbf1Uu72xl5hMIa7c2QloHSUq9nV0cEQggBAkjBIoiQQUcg8iXUZMvLjh+4KD1H/Tb2WGA6rnR63YAqwH8NYC8irokSFWkhGf1/kUAd4jII1aSRIQvt8xfkqP5jIjclIf4x2hCEBCIB08EqPNA1cQQCEriySj5Csi1O4cO3b8CCC02SH3cmWEAyXqndVEPANwE4B8ALHJWNgmdQwfxXwFwJ4D7RKRqCdeVE/F9whgMtM67FIZdAXhlBEGFUQ2AL+LV25PjswJofPGyjRBUwGeN8LOLjhx63LrVl6sJnTYD6tIIz1n1qwB0ArhYm1RPNmknAZwoU44D+BcA/ywiBy3hytQ3qmTsEpHKtptvzlzywAM1AOhrmnu1J15ngycXHY+ISFAFJKivA+vyoJOKgKhBJAMCEfjwmBd2LTly5FfTVYsk9/Uiko/yxFElGZKMYmdIsua0+y7J5U4/Gf39fZK/1LYRyf8l+VcAwI6OwIrxdiDbU2r/VH9z28CRUpn7mtujnlJ7raelHPW0lE1PS9n0lNqj3lK76Sm113qa22pHSmXub247vr9UXruzuKDNSliatZA0kVdxnw/g0wA+qisVahN/EoDbDKBDRP7HDYLUR3gbgKe0bRSzRh8WkYdI+gp9BgD2FMrzsp5Z44vckve8zDEylDoseGJVQmANqSHE4kMvEHUuGDz84LiqxVRCJiD+RgCfBzDfATI/9l2c8B0A/klEvuNIEbU/2+9GAFcCqChTRS1HAOBlAMv1HiKCTYC/QhnfX2p7iw/pCiBXGQHGIlYh8GVcHywbQBAmEMkWBThGbgiy+NOvHjo00gnQZYIkoTzJdwPYMIlZs54dABwCcBeAfxWRkQTssHrfAGAXgHOUqeJM2voIy0Vkt2WYXTkAnpWI/lL5GmHU1SBywUj9oyqBQOIkCSJEUTjPC/L7o+jOJUMHV28CghUnJPkUk2W/fr9OqpIAckYnHwAYVcIvEpE7lXjrEicBj3WJ6XiF7m+ofcYnRdcFXjR48NFdQ4W3jUb8pAAHm8XLql0wBF1KPED8o4wiklcAwOUxQPQSdBmOaCa9D1QivgfgUhH5lIj0a7grSYTr6vsiUgXwE+235jQZ02dbRaTXXf0YI8ZD5BXYV1l47PA9oW/eMmzM/T7rliAiaW0rCIFABPBwwn5OyRU2MaLpANbzAFaIyA0isl0J9wAYa9fTDQtF/YdfA2hw3jUAGATwSW0jk5ioiKRsAoLFr73Wf86xw7cY4dsrUbQ5A/EIRhE5rj8T2XvvND1GD8AtIrJZA59xkLO2PS3fZ1dURAYAvBPAfapiIYBvAvhdEXlO25g006zSQRHh5STZ0eFtAzJLBg8/V43895PRcQ/0RUhQFcIiSMIRnAZjbA+hQ7hx0D4nIiOuJUlRBRGR/QA+RnIFgDYRuTHuaqdYJzteEcDo+H1HB9jV5Q36o+FRZisBpGjBQERDzBQhSGNA4BAtMdASZyItAG4HsBJAI8kdAO4SkScmY4ITHgvJgoJfNIlfcjWAvwVwHoDjJB8FsFZEhiCCPlIoahJF6FnKBfBTXOKpMCBREkiWAPwXgEucd4sBXEnyGhH5QdqKKlYYi1cAbEgtaQEYyQ8D+Ebs9WoA7yD5B+J5o8MsSk5qAGR81eo+syAtJPCmGCO4wGRX6eNK/KhjGsf03b26qolExQA2nGDlRftoBXC3tq86jtkogMtgzEdAIrN8sc/IdlwnGwIIqGm302dAEttsV7+n1xntR/TaAFgC4Fx97icQhXWAH9Vq5ahWa8Njj/kp0uZrH28G0Op4nVaFAgARRFYCQOPoqIp9hDoAimVCJJLM5CDFD8hMoAJuG5lgVdscrAjGzWRnp6jbZ5jJPAigKO973wgAoLPTc8yl7yRdFjhxSCodEkVq861PSBIIcyL5MWHxdCTAS5AAiYnqVn0WOn6CcSb0Q5IdJMsiEooICYh0dUUCsCff8s4+kb39IjsGvMYrAEC6uqKOugttk6tlkmsBPOQsVuSc9Xwj+SQAeLk5Kokk6ukyf45IfpToo8jnebIqpyc+SG7UcNaGq8Y5l2ubRST3Mfn4MskX9Po1kp/gSy81QQR7ykvnDWQKGw9nCxzKlzicL/FIrsj9+eZNu0rlcyEC7tlTInkryaPaxxaSX0sZayePHp0DEXS3LV6wr7ntcF+pnYMtZQ40l48OlNrv2NG0cK4TU+BMGXC+0/5ckt8juZ/kEMlnSd5gY3+SN5PsthMd3rRp/l6/4afDuWb2ZQtj/dniWF+2ONaXLYwN55o4EDTu6F+9erEht+s3u0h+0OIGyZtI/kLHOkjyWyTPsZnDHY1tC3qa2jhQmlc70DLvvn3N7a+3c103lXqCw4DHExhgEx5vSih0ziG5KKUIWmClsobkl7pzjTcdzxbZky2O9maLpi9bMH2ZgunNFKLebGF0JN/Ml4Ls35O8I6xUPsN6+SwpQXMOybnjxK1a5QPAvoa5C7uL7d/eV2q7eFoVZ4cBP05hQI3kG9x6QNz1tfc2be6+6/YaNr6WKZjebKHamy2Y3mzB9GYKpidTiHoyhdrBbNHszRS2TZCZ8pNcYwd9xa0wd0zB1fdO87nrEUJjAKPEeq4f7wCZkPS5bp3vB/68sB7SSqwzCgjDyPOI1r3vujFP0mdHh+c6Uu5YNvJ0vU1FP4+aO+iaQmbYm8QTnJABrmeX5PaOHw884Mn11xuIDHn1kJY4JVITBiIRPO/o0icfqmDzZkFnZ+pYaZGnDZmnmvs83YoK03xKC1TuxBxXuEay0C25x/OZ7LtGwKoA/ok8Xj2X1yh+ZrgabiCZE5GxpAApaZzZKI0x4V5ieYF4KZxuSOzUC5tpzF0Aetq3bH78SFjZPsfz8qwnREKAIQS1liDIv1qt7G7duH4jgJ4wDNeQzGgftk+JjSNpIfO0C536+2QMBEO9HyG5xAFBcb5tItkU6++DaiJJY75LsnVnLrd0f7Zp65FckcONJR5raOFgtsiBfOkXv87lziNZNmH42LiNJ1fG+lzoWoC0WMMybKYYYBwGLI6hfas6Kf0kB0h+k+R7SP5Ev3nR5uPssQrwexpK1/QCq7uB27obSn/yo3ol2Z3LNSR7tY//IHkdyU3qAxxW/6Mcm8sykneTfF2a5ZgqAzZPUQJyJH+a4qG9qo6QuCvi1vVJ3kbys9Z4EfBci0KySPJzJMdSxthKMu8w4M3O2LdrvuIk2jCFUhhIPpUiAcMxh2elPq8ok0JlkiH5lw7h/kmYUc/j+6ZafZXV6sj2VauyrCdGJMX+36N9jjjjjOrY1zntlseY9TLJv3B9k+nmA9KswBudOqA9rWU5VweO23LaNLeXyRxAJnN4+bp1pxQxnY1VPoDXO32LEw4bAOfHQnVPf6sAlgL4OoAtJC9LkgTvDK3DLo3Z6Zx2R8huJZwTbJTMWMsyQTLVAOiORZ7WGvkAdsbmLY6JDzXxeqkWZ3mmEhCpTbdi/QSAp3UrjK9nA4BfAvhPFbl4SsyViMDmFfTZKXsLtI+vABjRvm2SJa8p+h8585FYAuZE0uTUQsxpp8QiAI0A5utk7Ypcjfr2t726Ut8A8IcicizBMbK+wQqSz+j+gnYA20hebW1+LJUuIrJb64k/03L7EQAPA/hjW1TRObXHslYunTwdEHxGQSSMlb4jkrtJXp/wbY5kPs0+O0B0mQNUxrEwJPlHKUGPxCLBcsL4q0judfq04bst1z8zkd8QZ8DWlGjQOJPdTPLyhG/9FA8t7mOMOpOs6LPnJ/DwvJQ5v53kfzvzMrEcxmkxwE5yi3JxLJYMsZJQdQb8ls0RxHMBCcxp0URGFFslK12Dmv9LJDiWZ1hG8kFHgmrOHF0G2M0cT03FCtj7DQ6YmIQ2gbPr8wOqw2tJznESmX5KzTGaAGuMUzRlXH00vC6R7ATwHIA/d7DIT8hmR052ef2k5UA1UaLe1f2xLTG1hC0xJiYNe0jeYlfKJk1iGPB9x6u0W2pG9Nn6WNuTvte+98TmFSWctdi87iOZTVOviRhyBcmnYwOaKTDiWd046QYmvjL3TSQPJLi1B0meP55AOdkTXEny59OYx9MuTp3JJqmPOMnNiTgfxlzR7+tGyvgmqWUkH9JobxfJfye5zG3jbM5aP4XNWVFsc9bLJD/kAvO0meB00kryH51UtUlRCzuZmoP2d+mGq7hJC1JAcyHJex1m1iYh3DhBUIfWLSf8e86ZSMNSkl/XwdMm5yKwbTeguf6ckzYXN3lKslHbHNRvognEPXQsgCH5bzZSPaNVn2xztHP/DpJPpOiliV27avGiG8HFkic7pqHnP9Std65Uzd4fr+KpcJJ/pt7hZPgQn/h6kpeqZ+g6MmMp4h7/fpvuXJ1+BuhM1cLBhyaSa7QMxpj4RwnFlVqCFXABLr7yLuH71Bxm4qYSZ8E/wiw+hAn4YBLAy/UsTQrA2b6G1NmaO2t6PoP48FanvuiubppOJwFcNbbneNlE7vbZwog4PtwQA7axFILT9HyzbqT6zQDcTP9f0DFtq0kemsR/cAnfTfJDM5LrP4v+MbpYffKagw81R/+tI/Np3QY3c47MWY4PViq+NquOzFnCCD9W+Pi2SsUl/+/0/AzxYWZremdw/B/fd5+6XlnaRAAAAABJRU5ErkJggg==";

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

  // Foco estable al redibujar: los paneles se vacían con innerHTML, así que
  // antes se anota qué control tenía el foco y después se lo vuelve a buscar,
  // por su data-foco o por tipo y nombre (los ids de idCampo cambian en cada
  // dibujo). Si ya no existe, el foco queda en el panel y no en <body>.
  function firmaFoco(n) {
    var nombre = n.getAttribute("aria-label") || n.name || "";
    if (!nombre && n.id) {
      var lab = document.querySelector("label[for='" + n.id + "']");
      if (lab) { nombre = lab.textContent; }
    }
    if (!nombre && n.tagName === "BUTTON") { nombre = n.textContent; }
    return n.tagName + "|" + nombre;
  }

  function enfocables(cont) {
    return cont.querySelectorAll("button,input,select,textarea,a[href],[tabindex]");
  }

  function claveFoco(cont) {
    var a = document.activeElement;
    if (!cont || !a || a === cont || !cont.contains(a)) { return null; }
    var f = a.getAttribute("data-foco");
    if (f) { return { foco: f }; }
    var firma = firmaFoco(a), lista = enfocables(cont), n = 0;
    for (var i = 0; i < lista.length && lista[i] !== a; i++) {
      if (firmaFoco(lista[i]) === firma) { n += 1; }
    }
    return { firma: firma, n: n };
  }

  function restaurarFoco(cont, clave) {
    if (!cont || !clave) { return; }
    var a = document.activeElement;
    // Un panel que ya enfocó algo a propósito (p. ej. el campo recién agregado) manda.
    if (a && a !== document.body && cont.contains(a)) { return; }
    var dest = null, i;
    if (clave.foco) {
      var conClave = cont.querySelectorAll("[data-foco]");
      for (i = 0; i < conClave.length; i++) {
        if (conClave[i].getAttribute("data-foco") === clave.foco) { dest = conClave[i]; break; }
      }
    } else {
      var lista = enfocables(cont), n = 0;
      for (i = 0; i < lista.length; i++) {
        if (firmaFoco(lista[i]) !== clave.firma) { continue; }
        dest = lista[i];
        if (n === clave.n) { break; }
        n += 1;
      }
    }
    if (!dest || dest.disabled) {
      dest = cont;
      if (!cont.hasAttribute("tabindex")) { cont.setAttribute("tabindex", "-1"); }
    }
    try { dest.focus({ preventScroll: true }); } catch (e) { /* sin foco: se sigue igual */ }
  }

  function conFoco(cont, dibujar) {
    var clave = claveFoco(cont);
    dibujar();
    restaurarFoco(cont, clave);
  }

  // Pestañas con el patrón ARIA: sólo la activa entra en el orden de Tab, y
  // las flechas, Inicio y Fin pasan de una a otra eligiéndola. Devuelve el id
  // que tiene que llevar el panel.
  function armarPestañas(lista, pares, activa, base, alElegir) {
    var idPanel = "sim-panel-" + base;
    var botones = [];
    pares.forEach(function (p, i) {
      var sel = p[0] === activa;
      var b = boton(p[1], sel ? "activo" : "");
      b.id = "sim-tab-" + base + "-" + p[0];
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(sel));
      b.setAttribute("aria-controls", idPanel);
      b.setAttribute("data-foco", "tab-" + base + "-" + p[0]);
      b.tabIndex = sel ? 0 : -1;
      b.addEventListener("click", function () { alElegir(p[0]); });
      b.addEventListener("keydown", function (ev) {
        var j = -1;
        if (ev.key === "ArrowRight") { j = (i + 1) % pares.length; }
        else if (ev.key === "ArrowLeft") { j = (i - 1 + pares.length) % pares.length; }
        else if (ev.key === "Home") { j = 0; }
        else if (ev.key === "End") { j = pares.length - 1; }
        if (j < 0) { return; }
        ev.preventDefault();
        ev.stopPropagation();
        botones[j].focus();
        alElegir(pares[j][0]);
      });
      botones.push(b);
      lista.appendChild(b);
    });
    return idPanel;
  }

  // El panel de un grupo de pestañas, anunciado con el nombre de la activa.
  function marcarPanel(panel, idPanel, base, activa) {
    panel.id = idPanel;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", "sim-tab-" + base + "-" + activa);
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

    // Primer Tab: saltear la cabecera y la paleta e ir directo al lienzo.
    var saltar = el("a", "saltar", "Saltar al lienzo");
    saltar.href = "#sim-lienzo";
    saltar.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (S.svg) { S.svg.focus(); }
    });
    S.raiz.appendChild(saltar);

    var barra = el("div", "simbarra");
    var bMenu = boton("☰", "menucel");
    bMenu.setAttribute("aria-label", "Menú");
    bMenu.setAttribute("aria-expanded", "false");
    bMenu.addEventListener("click", function () {
      var abierto = barra.classList.toggle("menuabierto");
      bMenu.setAttribute("aria-expanded", String(abierto));
    });
    barra.appendChild(bMenu);
    barra.appendChild(el("h1", "", "<img class='logo' src='" + LOGO_BLANCO + "' alt=''>OpenRedLab <span class='subtitulo'>Simulador de Redes</span>"));
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
      if (ej) { empujarHistorial(); cargarTopologiaAjustada(clonar(ej.topologia)); registrar("ejemplo", "Se cargó el ejemplo " + ej.nombre); }
      selEjemplo.value = "";
    });
    barra.appendChild(selEjemplo);
    barra.appendChild(el("span", "espacio"));
    barra.appendChild(el("span", "enpres", "Modo presentación"));
    var bImp = boton("Importar", "enedicion");
    bImp.addEventListener("click", importarPorArchivo);
    var bExp = boton("Exportar", "enedicion");
    bExp.addEventListener("click", exportarActual);
    // Sólo en modo Docente: la versión del alumno, con las fallas aplicadas
    // y sin la lista de fallas ni el modo.
    var bAlu = boton("Exportar para el alumno", "enedicion");
    bAlu.hidden = true;
    bAlu.addEventListener("click", exportarParaAlumnoActual);
    S.botonAlumno = bAlu;
    var bTema = boton("Tema oscuro", "enedicion");
    bTema.setAttribute("aria-pressed", "false");
    bTema.addEventListener("click", alternarTema);
    S.botonTema = bTema;
    aplicarTema(S.tema || temaDelSistema());
    var bPres = boton("Presentación (F)");
    bPres.setAttribute("aria-pressed", "false");
    bPres.addEventListener("click", alternarPresentacion);
    S.botonPres = bPres;
    barra.appendChild(bImp); barra.appendChild(bExp); barra.appendChild(bAlu);
    barra.appendChild(bTema); barra.appendChild(bPres);
    S.raiz.appendChild(barra);

    var cuerpo = el("main", "simcuerpo");
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
    S.botonCable = bCable;
    pal.appendChild(el("p", "leyenda", "Cobre: lleno · fibra: grueso · wireless: puntos. Verde: activo · rojo y cortado: caído."));
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
    svg.id = "sim-lienzo";
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
      b.setAttribute("aria-label", par[0] === "menos" ? "Alejar" : par[0] === "mas" ? "Acercar" : par[0] === "porc" ? "Restablecer zoom al 100%" : par[1]);
      b.addEventListener("click", function () { accionLienzo(par[0]); });
      tools.appendChild(b);
    });
    // Dominios de colisión y de broadcast pintados sobre los cables.
    var selDom = document.createElement("select");
    selDom.setAttribute("aria-label", "Mostrar dominios");
    [["", "Dominios: no mostrar"], ["colision", "Dominios de colisión"], ["broadcast", "Dominios de broadcast"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; selDom.appendChild(op);
    });
    selDom.title = "Colisión: lo cortan los switches (cada puerto es uno); un hub y una celda inalámbrica lo comparten. Broadcast: lo cortan los routers.";
    selDom.addEventListener("change", function () {
      S.verDominios = selDom.value || null;
      registrar("dominios", S.verDominios ? "Se muestran los dominios de " + (S.verDominios === "colision" ? "colisión." : "broadcast.") : "Se ocultan los dominios.");
      renderLienzo();
    });
    tools.appendChild(selDom);
    var cuentaDom = el("span", "cuentadom");
    tools.appendChild(cuentaDom);
    S.cuentaDominios = cuentaDom;
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
    hoja.setAttribute("aria-modal", "true");
    hoja.addEventListener("keydown", cicloHoja);
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
      var mq = window.matchMedia(MQ_CELULAR);
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
    S.contadores = { pc: 0, servidor: 0, router: 0, "switch-l2": 0, camara: 0, iot: 0 };
    (S.topologia.dispositivos || []).forEach(function (d) {
      var k = claveNombre(claveDe(d));
      var pre = PREFIJOS_NOMBRES[k] || "";
      if (pre && d.nombre && d.nombre.indexOf(pre) === 0) {
        var n = parseInt(d.nombre.slice(pre.length), 10);
        if (!isNaN(n) && n > (S.contadores[k] || 0)) { S.contadores[k] = n; }
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
    // Mitad arriba y mitad abajo; con muchos puertos (un switch de 48) cada
    // fila se ensancha para que no se encimen.
    var arriba = Math.ceil(total / 2);
    return { arriba: arriba, anchoArriba: Math.max(56, arriba * 12), anchoAbajo: Math.max(56, (total - arriba) * 12) };
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
    // El botón refleja el modo aunque se haya salido por Esc, por Cancelar o
    // tocando un equipo.
    if (S.botonCable) {
      S.botonCable.classList.toggle("activo", !!S.herramientaCable);
      S.botonCable.setAttribute("aria-pressed", String(!!S.herramientaCable));
    }
    var svgNS = "http://www.w3.org/2000/svg";
    while (S.capaEnlaces.firstChild) { S.capaEnlaces.removeChild(S.capaEnlaces.firstChild); }
    while (S.capaNodos.firstChild) { S.capaNodos.removeChild(S.capaNodos.firstChild); }
    var porId = {};
    (S.topologia.dispositivos || []).forEach(function (d) { porId[d.id] = d; });

    // Dominios: una franja ancha y translúcida debajo de cada cable, con el
    // color de su dominio.
    if (S.cuentaDominios) { S.cuentaDominios.textContent = ""; }
    if (S.verDominios && S.estado && Motor.dominios) {
      var COLORES_DOM = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#9a6324"];
      var doms = [];
      try { doms = Motor.dominios(S.estado)[S.verDominios] || []; } catch (e) { doms = []; }
      var palabra = S.verDominios === "colision" ? "colisión" : "broadcast";
      doms.forEach(function (dom, k) {
        dom.enlaces.forEach(function (idE) {
          var en = buscarEnlace(idE);
          var tr = en && tramoEnlace(en, en.a.dispositivo);
          if (!tr) { return; }
          var franja = document.createElementNS(svgNS, "line");
          franja.setAttribute("x1", tr.de.x); franja.setAttribute("y1", tr.de.y);
          franja.setAttribute("x2", tr.a.x); franja.setAttribute("y2", tr.a.y);
          franja.setAttribute("stroke", COLORES_DOM[k % COLORES_DOM.length]);
          franja.setAttribute("stroke-width", "14"); franja.setAttribute("stroke-linecap", "round");
          franja.setAttribute("opacity", "0.35");
          var tt = document.createElementNS(svgNS, "title");
          tt.textContent = "Dominio de " + palabra + " " + (k + 1) + ": " + dom.dispositivos.map(nombreDe).join(", ");
          franja.appendChild(tt);
          S.capaEnlaces.appendChild(franja);
        });
      });
      if (S.cuentaDominios) { S.cuentaDominios.textContent = doms.length + (doms.length === 1 ? " dominio" : " dominios"); }
    }

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
      g.addEventListener("focus", function () { mostrarTipEnlace(puntoDe(g), e); });
      g.addEventListener("blur", ocultarTip);
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
        c.addEventListener("focus", function () { mostrarTipPuerto(puntoDe(c), d, iface); });
        c.addEventListener("blur", ocultarTip);
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
      // Sólo el foco del equipo mismo: el de sus puertos muestra el del puerto.
      g.addEventListener("focus", function () { mostrarTipNodo(puntoDe(g), d); });
      g.addEventListener("blur", ocultarTip);
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        // En modo cableado, tocar el equipo fuera de sus puertos es salir del
        // modo: se selecciona el equipo y se avisa.
        if ((S.herramientaCable || S.cableOrigen) && !S.colocando && !S.moviendoExtremo) {
          salirModoCable(d);
          return;
        }
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

  // Con el teclado no hay puntero: el tooltip se ubica junto al elemento enfocado.
  function puntoDe(n) {
    var r = n.getBoundingClientRect();
    return { clientX: r.right, clientY: r.top };
  }

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
    try { return !!(window.matchMedia && window.matchMedia(MQ_CELULAR).matches); }
    catch (e) { return false; }
  }

  // Las hojas reutilizan los paneles de escritorio: al abrir se mudan
  // adentro de la hoja y al cerrar vuelven a su lugar.
  function abrirHoja(tipo) {
    if (!S.hojaEl) { return; }
    // Al cerrarse, el foco vuelve a lo que la abrió (si se pasa de una hoja a
    // otra, sigue valiendo el origen de la primera).
    if (S.hojaEl.hidden) { S.hojaOrigen = document.activeElement; }
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
    fondoInerte(true);
    actualizarCelular();
    try { S.hojaCerrar.focus(); } catch (e) { /* sin foco: se sigue igual */ }
  }

  // Con la hoja abierta, lo de atrás no se puede tocar ni recorrer con Tab.
  // El aviso para el lector de pantalla queda afuera: tiene que seguir hablando.
  function fondoInerte(si) {
    if (!si) {
      (S.inertes || []).forEach(function (n) { n.inert = false; n.removeAttribute("inert"); });
      S.inertes = [];
      return;
    }
    if (S.inertes && S.inertes.length) { return; }
    S.inertes = [];
    Array.prototype.forEach.call(S.raiz.children, function (n) {
      if (n === S.hojaEl || n === S.anuncio) { return; }
      n.inert = true;
      n.setAttribute("inert", "");
      S.inertes.push(n);
    });
  }

  // Tab y Mayús+Tab dan la vuelta dentro de la hoja, también donde no hay inert.
  function cicloHoja(ev) {
    if (ev.key !== "Tab" || S.hojaEl.hidden) { return; }
    var lista = Array.prototype.filter.call(enfocables(S.hojaEl), function (n) {
      return n.tabIndex >= 0 && !n.disabled && n.offsetParent !== null;
    });
    if (!lista.length) { return; }
    var primero = lista[0], ultimo = lista[lista.length - 1];
    if (ev.shiftKey && document.activeElement === primero) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primero.focus(); }
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
    fondoInerte(false);
    actualizarCelular();
    var origen = S.hojaOrigen;
    S.hojaOrigen = null;
    if (origen && origen !== document.body && document.contains(origen)) {
      try { origen.focus({ preventScroll: true }); } catch (e) { /* sin foco: se sigue igual */ }
    }
  }

  function salirModoCable(d) {
    var pendiente = S.cableOrigen ? buscarDisp(S.cableOrigen.dispositivo) : null;
    S.herramientaCable = false; S.cableOrigen = null;
    registrar("cable", "Herramienta de cable desactivada al tocar " + (d.nombre || d.id) + ".");
    seleccionar(d.id);
    renderLienzo();
    avisar("Saliste del modo cableado" + (pendiente ? " (el cable que empezaste en " + (pendiente.nombre || pendiente.id) + " quedó sin hacer)" : "") +
      ". Para seguir conectando, volvé a tocar «Conectar con un cable».");
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
    var nombre = nombreAutomatico(clave);
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
    // Como un firewall real: lo que entra desde internet se bloquea, salvo
    // las respuestas de lo que salió (estado).
    if (equipo.modelo === "firewall") { nuevo.reglas = [{ accion: "bloquear", origen: "0.0.0.0/0", destino: "0.0.0.0/0", entrada: "wan" }]; }
    if (tipo === "servidor") { nuevo.servicios = { dns: { zona: "red.local", recursivo: true, registros: [] } }; }
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
    aplicarTema(S.tema === "oscuro" ? "claro" : "oscuro");
    // Desde acá el tema ya no es el del sistema (lo mira el Autotest).
    if (S.botonTema) { S.botonTema.setAttribute("data-elegido", "1"); }
  }

  // El tema del sistema sólo decide al empezar: después manda el botón.
  function temaDelSistema() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
    } catch (e) {
      return "claro";
    }
  }

  // Única entrada para cambiar el tema: la raíz, el botón y lo que queda
  // fuera de la raíz (la barra del navegador y el fondo de la página).
  function aplicarTema(tema) {
    var t = TEMAS[tema] ? tema : "claro";
    S.tema = t;
    S.raiz.classList.toggle("oscuro", t === "oscuro");
    if (S.botonTema) {
      S.botonTema.textContent = t === "oscuro" ? "Tema claro" : "Tema oscuro";
      S.botonTema.setAttribute("aria-pressed", String(t === "oscuro"));
    }
    var meta = document.querySelector("meta[name=theme-color]");
    if (meta) { meta.setAttribute("content", TEMAS[t].meta); }
    document.documentElement.style.colorScheme = TEMAS[t].esquema;
    document.documentElement.style.background = TEMAS[t].fondo;
  }

  /* ---------------- Panel derecho ---------------- */

  function renderPropiedades() {
    conFoco(S.prop, dibujarPropiedades);
  }

  function dibujarPropiedades() {
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
          "<br>Tipo: " + escapar(palabraCable(e.tipo)) + "<br>Velocidad: " + escapar(String(e.velocidadMbps)) + " Mbps" + extra));
        // Calidad del enlace (QoS): la usa el ping de varios paquetes.
        c.appendChild(el("p", "leyenda", "<b>Calidad del enlace</b>: la latencia es lo que tarda en cruzarlo; el jitter, cuánto varía; la pérdida, qué parte de los paquetes no llega."));
        [["retardoMs", "Latencia (ms)", 0, 1000], ["jitterMs", "Jitter (ms)", 0, 1000], ["perdidaPct", "Pérdida (%)", 0, 100]].forEach(function (cfg) {
          var inp = document.createElement("input");
          inp.type = "number"; inp.min = String(cfg[2]); inp.max = String(cfg[3]); inp.step = "1";
          inp.value = e[cfg[0]] !== undefined && e[cfg[0]] !== null ? e[cfg[0]] : 0;
          inp.addEventListener("change", function () {
            var n = Number(inp.value);
            if (!(n >= cfg[2] && n <= cfg[3])) { avisar(cfg[1] + ": va de " + cfg[2] + " a " + cfg[3] + "."); inp.value = e[cfg[0]] || 0; return; }
            empujarHistorial();
            e[cfg[0]] = n;
            reconstruirEstado();
            registrar("calidad", cfg[1] + " del cable " + e.id + ": " + n + ".");
          });
          c.appendChild(etiqueta(cfg[1], inp)); c.appendChild(inp);
        });
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
    var nombres = [["config", "Configuración"], ["ifs", "Interfaces"], ["rutas", "Rutas"], ["filtrado", "Filtrado"], ["nat", "NAT"], ["dhcp", "DHCP"], ["estado", "Estado"]];
    if (d.tipo !== "router") {
      nombres = nombres.filter(function (p) { return ["rutas", "filtrado", "nat", "dhcp"].indexOf(p[0]) < 0; });
    }
    if (d.tipo === "servidor") { nombres.splice(2, 0, ["servicios", "Servicios"], ["dns", "DNS"]); }
    if (!nombres.some(function (p) { return p[0] === S.pestañaProps; })) { S.pestañaProps = "config"; }
    var idPanel = armarPestañas(tabs, nombres, S.pestañaProps, "prop", function (clave) { S.pestañaProps = clave; renderPropiedades(); });
    c.appendChild(tabs);
    c.appendChild(el("h2", "", escapar(d.nombre || d.id) + " <small>" + escapar(nombreTipo(claveDe(d))) + "</small>"));

    var panel = el("div", "");
    marcarPanel(panel, idPanel, "prop", S.pestañaProps);
    c.appendChild(panel);
    if (S.pestañaProps === "config") { panelConfig(panel, d); }
    else if (S.pestañaProps === "ifs") { panelInterfaces(panel, d); }
    else if (S.pestañaProps === "rutas") { panelRutas(panel, d); }
    else if (S.pestañaProps === "filtrado") { panelFiltrado(panel, d); }
    else if (S.pestañaProps === "nat") { panelNat(panel, d); }
    else if (S.pestañaProps === "dhcp") { panelDhcp(panel, d); }
    else if (S.pestañaProps === "dns") { panelDnsServidor(panel, d); }
    else if (S.pestañaProps === "servicios") { panelServicios(panel, d); }
    else { panelEstado(panel, d); }

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

  var MODELOS_UI = {
    router: [["", "Router estándar (g0/0, fib0…)"], ["8-puertos", "Router tipo MikroTik (ether1, sfp1…)"], ["firewall", "Firewall (wan, lan, dmz)"]],
    "switch-l2": [["", "Switch de 8 puertos"], ["24-puertos", "Switch de 24 puertos"], ["48-puertos", "Switch de 48 puertos"], ["hub", "Hub de 8 puertos"]]
  };

  function panelConfig(c, d) {
    campoTexto(c, "Nombre", d.nombre, function (v) {
      empujarHistorialSuave(); d.nombre = v; renderLienzo();
    });
    if (MODELOS_UI[d.tipo]) {
      // El modelo cambia el estilo de los puertos (router) o su cantidad
      // (switch), sin borrar el equipo ni sus cables.
      var selModelo = document.createElement("select");
      MODELOS_UI[d.tipo].forEach(function (m) {
        var op = document.createElement("option");
        op.value = m[0]; op.textContent = m[1];
        selModelo.appendChild(op);
      });
      selModelo.value = d.modelo || "";
      selModelo.addEventListener("change", function () {
        var copia = clonar(S.topologia);
        var res = Escenarios.cambiarModelo(copia, d.id, selModelo.value || null);
        if (!res.ok) { avisar(res.error); selModelo.value = d.modelo || ""; return; }
        empujarHistorial();
        S.topologia = copia;
        delete S.interfazEditada[d.id];
        reconstruirEstado(); renderTodo();
        registrar("topologia", (d.nombre || d.id) + " pasa a ser " + selModelo.options[selModelo.selectedIndex].textContent + ".");
      });
      c.appendChild(etiqueta("Modelo", selModelo)); c.appendChild(selModelo);
    }
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
        reconstruirEstado();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); }, true);
      if (d.tipo === "router") {
        // Como en una red hogareña: el router recibe las consultas y las pasa a su DNS.
        var labReenvio = el("label", "enlinea");
        var chkReenvio = document.createElement("input");
        chkReenvio.type = "checkbox"; chkReenvio.checked = d.reenviaDns === true;
        chkReenvio.addEventListener("change", function () {
          empujarHistorial(); d.reenviaDns = chkReenvio.checked; reconstruirEstado();
        });
        labReenvio.appendChild(chkReenvio);
        labReenvio.appendChild(document.createTextNode("Reenviar consultas DNS a su servidor DNS"));
        c.appendChild(labReenvio);
      }
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

  var PALABRA_SELECTOR_MEDIO = [["ethernet", "cobre"], ["fibra", "fibra"], ["wireless", "inalámbrico"]];

  // En routers y firewalls los puertos se eligen: medio de cada uno, quitar
  // y agregar. Un puerto con cable no cambia de medio ni se quita.
  function editarPuertos(c, d) {
    var editable = d.tipo === "router";
    if (!editable) { return null; }
    var max = Escenarios.PUERTOS_ROUTER_MAX || 16;
    var pie = el("div", "agregarpuerto");
    var selNuevo = document.createElement("select");
    PALABRA_SELECTOR_MEDIO.forEach(function (m) {
      var op = document.createElement("option"); op.value = m[0]; op.textContent = m[1]; selNuevo.appendChild(op);
    });
    var bAgregar = boton("Agregar puerto");
    bAgregar.disabled = d.interfaces.length >= max;
    if (bAgregar.disabled) { bAgregar.title = "Un router puede tener hasta " + max + " puertos"; }
    bAgregar.addEventListener("click", function () {
      var id = Escenarios.nombrePuertoLibre(d, selNuevo.value);
      if (!id) { return; }
      empujarHistorial();
      var nuevo = { id: id, nombre: id, medio: selNuevo.value, habilitada: selNuevo.value !== "wireless", modo: "estatico", ip: null, prefijo: 24, mac: null };
      if (selNuevo.value === "wireless") { nuevo.modoRadio = "ap"; }
      d.interfaces.push(nuevo);
      reconstruirEstado(); renderTodo();
      registrar("topologia", "Se agregó el puerto " + id + " a " + (d.nombre || d.id) + ".");
    });
    pie.appendChild(etiqueta("Medio del puerto nuevo", selNuevo));
    pie.appendChild(selNuevo);
    pie.appendChild(bAgregar);
    return pie;
  }

  function controlesPuerto(fila, d, f, enl) {
    if (d.tipo !== "router") { return; }
    var selMedio = document.createElement("select");
    PALABRA_SELECTOR_MEDIO.forEach(function (m) {
      var op = document.createElement("option"); op.value = m[0]; op.textContent = m[1]; selMedio.appendChild(op);
    });
    selMedio.value = f.medio;
    selMedio.disabled = !!enl;
    selMedio.title = enl ? "Desconectá el cable para cambiar el medio" : "Medio del puerto " + f.id;
    selMedio.setAttribute("aria-label", "Medio del puerto " + f.id);
    selMedio.addEventListener("change", function () {
      empujarHistorial();
      f.medio = selMedio.value;
      if (f.medio === "wireless") { f.modoRadio = f.modoRadio || "ap"; } else { delete f.modoRadio; }
      reconstruirEstado(); renderTodo();
      registrar("topologia", "El puerto " + f.id + " de " + (d.nombre || d.id) + " pasa a ser " + palabraCable(f.medio) + ".");
    });
    fila.appendChild(selMedio);
    var bQuitar = boton("Quitar");
    bQuitar.disabled = !!enl || d.interfaces.length <= 1;
    bQuitar.title = enl ? "Desconectá el cable para quitar el puerto" : (d.interfaces.length <= 1 ? "El router necesita al menos un puerto" : "Quitar el puerto " + f.id);
    bQuitar.setAttribute("aria-label", "Quitar el puerto " + f.id);
    bQuitar.addEventListener("click", function () {
      empujarHistorial();
      d.interfaces = d.interfaces.filter(function (x) { return x !== f; });
      if (S.interfazEditada[d.id] === f.id) { delete S.interfazEditada[d.id]; }
      reconstruirEstado(); renderTodo();
      registrar("topologia", "Se quitó el puerto " + f.id + " de " + (d.nombre || d.id) + ".");
    });
    fila.appendChild(bQuitar);
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
      if (d.tipo === "router") {
        // NAT de salida: lo que sale por este puerto con IP privada se va
        // con la IP de este puerto.
        var labN = el("label", "enlinea");
        var cbNat = document.createElement("input");
        cbNat.type = "checkbox"; cbNat.checked = !!f.nat;
        cbNat.addEventListener("change", function () {
          empujarHistorial();
          if (cbNat.checked) { f.nat = true; } else { delete f.nat; }
          reconstruirEstado(); renderTodo();
          registrar("NAT", "NAT " + (cbNat.checked ? "activado" : "desactivado") + " en " + (d.nombre || d.id) + ":" + f.id + ".");
        });
        labN.appendChild(cbNat);
        labN.appendChild(document.createTextNode("NAT"));
        labN.setAttribute("title", "NAT al salir por este puerto: el router cambia la IP privada de origen por la IP de este puerto, " +
          "y a la respuesta la traduce de vuelta. Se activa en el puerto que va a internet; sin NAT, la respuesta de internet no vuelve (D28).");
        fila.appendChild(labN);
      }
      controlesPuerto(fila, d, f, enl);
      c.appendChild(fila);
    });
    var pie = editarPuertos(c, d);
    if (pie) { c.appendChild(pie); }
  }

  // Puertos en escucha del servidor: los del catálogo con casillas y los
  // propios en una lista.
  function panelServicios(c, d) {
    d.servicios = d.servicios || {};
    var lista = d.servicios.escuchando || [];
    function escucha(prot, puerto) { return lista.some(function (x) { return x.protocolo === prot && Number(x.puerto) === puerto; }); }
    function guardar(texto) { d.servicios.escuchando = lista; reconstruirEstado(); registrar("servicios", texto); renderPropiedades(); }
    c.appendChild(el("p", "tenue", "Un servicio es un programa que escucha en un puerto. El cliente se conecta a IP:puerto."));
    var catalogo = (Motor.SERVICIOS_CONOCIDOS || []).filter(function (x) { return x.id !== "dns"; });
    catalogo.forEach(function (x) {
      var lab = el("label", "enlinea");
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = escucha(x.protocolo, x.puerto);
      cb.addEventListener("change", function () {
        empujarHistorial();
        if (cb.checked) { lista.push({ protocolo: x.protocolo, puerto: x.puerto, nombre: x.nombre }); }
        else { lista = lista.filter(function (y) { return !(y.protocolo === x.protocolo && Number(y.puerto) === x.puerto); }); }
        guardar(x.nombre + (cb.checked ? " activado" : " desactivado") + " en " + (d.nombre || d.id) + ".");
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(x.nombre + " (" + x.protocolo.toUpperCase() + " " + x.puerto + ")"));
      lab.style.display = "block";
      c.appendChild(lab);
    });
    c.appendChild(el("p", "", "DNS (UDP 53): " + (d.servicios.dns ? "<b>activo</b>, con la zona " + escapar(d.servicios.dns.zona || "—") + "." : "no da DNS (se activa en la pestaña DNS).")));
    var propios = lista.filter(function (x) { return !catalogo.some(function (k) { return k.protocolo === x.protocolo && k.puerto === Number(x.puerto); }); });
    c.appendChild(el("p", "", "<b>Otros servicios</b>"));
    if (!propios.length) { c.appendChild(el("p", "tenue", "Ninguno. Por ejemplo, una intranet en TCP 8080.")); }
    propios.forEach(function (x) {
      var fila = el("div", "filaif", "<span class='datos'>" + escapar(x.nombre || "Servicio") + " · " + escapar(x.protocolo.toUpperCase() + " " + x.puerto) + "</span>");
      var bQ = boton("Quitar");
      bQ.addEventListener("click", function () {
        empujarHistorial();
        lista = lista.filter(function (y) { return y !== x; });
        guardar("Se quitó " + (x.nombre || "un servicio") + " de " + (d.nombre || d.id) + ".");
      });
      fila.appendChild(bQ);
      c.appendChild(fila);
    });
    var form = el("div", "nuevoservicio");
    var inNom = document.createElement("input"); inNom.type = "text"; inNom.placeholder = "p. ej. Intranet…"; inNom.setAttribute("aria-label", "Nombre del servicio");
    var selP = document.createElement("select"); selP.innerHTML = "<option value='tcp'>TCP</option><option value='udp'>UDP</option>"; selP.setAttribute("aria-label", "Protocolo");
    var inPu = document.createElement("input"); inPu.type = "number"; inPu.min = "1"; inPu.max = "65535"; inPu.placeholder = "p. ej. 8080…"; inPu.setAttribute("aria-label", "Puerto");
    var bA = boton("Agregar");
    bA.addEventListener("click", function () {
      var n = Number(inPu.value);
      if (!(n >= 1 && n <= 65535) || Math.floor(n) !== n) { avisar("El puerto va de 1 a 65535."); return; }
      if (escucha(selP.value, n) || (selP.value === "udp" && n === 53 && d.servicios.dns)) { avisar("Ese puerto ya lo atiende otro servicio."); return; }
      empujarHistorial();
      lista.push({ protocolo: selP.value, puerto: n, nombre: inNom.value.trim() || (selP.value.toUpperCase() + " " + n) });
      guardar("Se agregó " + selP.value.toUpperCase() + " " + n + " en " + (d.nombre || d.id) + ".");
    });
    [inNom, selP, inPu, bA].forEach(function (x) { form.appendChild(x); });
    c.appendChild(form);
  }

  // La zona y los registros del servidor DNS, editables. Cada registro
  // muestra a su lado el error que le encuentra la validación.
  function panelDnsServidor(c, d) {
    var dns = d.servicios && d.servicios.dns;
    if (!dns) {
      var bActivar = boton("Activar el servicio DNS");
      bActivar.addEventListener("click", function () {
        empujarHistorial();
        d.servicios = d.servicios || {};
        d.servicios.dns = { zona: "red.local", recursivo: true, registros: [] };
        reconstruirEstado(); renderPropiedades();
      });
      c.appendChild(el("p", "", "Este servidor no da el servicio de DNS."));
      c.appendChild(bActivar);
      return;
    }
    function guardar(texto) {
      reconstruirEstado();
      if (texto) { registrar("DNS", texto); }
    }
    campoTexto(c, "Zona (el dominio del que es autoritativo)", dns.zona || "", function (v) {
      empujarHistorialSuave(); dns.zona = v.trim().toLowerCase(); guardar();
    }, function (v) { return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v.trim()); });
    var labRec = el("label", "enlinea");
    var cbRec = document.createElement("input");
    cbRec.type = "checkbox"; cbRec.checked = dns.recursivo !== false;
    cbRec.addEventListener("change", function () {
      empujarHistorial(); dns.recursivo = cbRec.checked;
      guardar((d.nombre || d.id) + (cbRec.checked ? " resuelve" : " ya no resuelve") + " nombres de afuera.");
    });
    labRec.appendChild(cbRec);
    labRec.appendChild(document.createTextNode("Resolver nombres de afuera (recursivo)"));
    labRec.setAttribute("title", "Si no conoce un nombre, le pregunta a la raíz, al TLD y al autoritativo, y guarda la respuesta en su caché.");
    c.appendChild(labRec);

    var errores = {};
    try {
      (Escenarios.validarTopologia(S.topologia).errores || []).forEach(function (e) {
        var m = /servicios\.dns\.registros\[(\d+)\]/.exec(e.campo || "");
        if (m && (e.campo || "").indexOf("dispositivos." + d.id + ".") === 0) { (errores[m[1]] = errores[m[1]] || []).push(e.mensaje); }
      });
    } catch (e) { /* sin validación: se edita igual */ }

    var lista = el("div", "registrosdns");
    var zona = dns.zona || "red.local";
    (dns.registros || []).forEach(function (x, k) {
      var fila = el("div", "fila");
      var inNombre = document.createElement("input");
      inNombre.type = "text"; inNombre.value = x.nombre || ""; inNombre.placeholder = "p. ej. www." + zona + "…"; inNombre.className = "nombre";
      inNombre.setAttribute("aria-label", "Nombre del registro " + (k + 1));
      var selTipo = document.createElement("select");
      (Motor.TIPOS_REGISTRO || ["A", "CNAME", "MX", "NS", "PTR"]).forEach(function (t) {
        var op = document.createElement("option"); op.value = t; op.textContent = t; selTipo.appendChild(op);
      });
      selTipo.value = x.tipo || "A";
      selTipo.setAttribute("aria-label", "Tipo del registro " + (k + 1));
      var inValor = document.createElement("input");
      inValor.type = "text"; inValor.value = x.valor || "";
      inValor.placeholder = x.tipo === "A" || !x.tipo ? "p. ej. 192.168.1.10…" : "p. ej. otro." + zona + "…";
      inValor.setAttribute("aria-label", "Valor del registro " + (k + 1));
      var inPrio = document.createElement("input");
      inPrio.type = "number"; inPrio.min = "0"; inPrio.className = "prio"; inPrio.value = x.prioridad !== undefined && x.prioridad !== null ? x.prioridad : "";
      inPrio.placeholder = "10…"; inPrio.hidden = x.tipo !== "MX";
      inPrio.setAttribute("aria-label", "Prioridad del MX " + (k + 1));
      function cambiar() {
        empujarHistorialSuave();
        x.nombre = inNombre.value.trim().toLowerCase().replace(/\.$/, "");
        x.tipo = selTipo.value;
        x.valor = inValor.value.trim().toLowerCase().replace(/\.$/, "");
        if (x.tipo === "MX") { x.prioridad = inPrio.value === "" ? 10 : Number(inPrio.value); } else { delete x.prioridad; }
        guardar();
      }
      [inNombre, inValor, inPrio].forEach(function (inp) { inp.addEventListener("change", function () { cambiar(); renderPropiedades(); }); });
      selTipo.addEventListener("change", function () { cambiar(); renderPropiedades(); });
      var bQuitar = boton("Quitar");
      bQuitar.setAttribute("aria-label", "Quitar el registro " + (k + 1));
      bQuitar.addEventListener("click", function () {
        empujarHistorial();
        dns.registros.splice(k, 1);
        guardar("Se quitó un registro DNS de " + (d.nombre || d.id) + ".");
        renderPropiedades();
      });
      var celdaValor = el("span", "valor");
      celdaValor.appendChild(inPrio); celdaValor.appendChild(inValor);
      fila.appendChild(inNombre); fila.appendChild(selTipo); fila.appendChild(celdaValor); fila.appendChild(bQuitar);
      lista.appendChild(fila);
      if (errores[k]) {
        inNombre.classList.add("invalido"); inValor.classList.add("invalido");
        lista.appendChild(el("div", "errreg", escapar(errores[k].join(" "))));
      }
    });
    if (!(dns.registros || []).length) {
      lista.appendChild(el("p", "tenue", "Sin registros. Por ejemplo: <code>www." + escapar(zona) + "</code> tipo A con la IP de un equipo."));
    }
    c.appendChild(lista);
    var bAgregar = boton("Agregar registro");
    bAgregar.addEventListener("click", function () {
      empujarHistorial();
      dns.registros = dns.registros || [];
      dns.registros.push({ nombre: "", tipo: "A", valor: "" });
      guardar();
      renderPropiedades();
      var nombres = S.prop ? S.prop.querySelectorAll(".registrosdns .fila input.nombre") : [];
      if (nombres.length) { try { nombres[nombres.length - 1].focus(); } catch (e) { /* sin foco */ } }
    });
    c.appendChild(bAgregar);
    c.appendChild(el("p", "tenue", "A: nombre → IP · CNAME: alias de otro nombre · MX: servidor de correo del dominio · NS: servidor DNS del dominio."));
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
      "<span style='font-size:13px'>" + (Motor.esFirewall(d)
        ? "El firewall revisa contra estas reglas los paquetes que reenvía, en orden: gana la primera que coincide. " +
          "Además <b>recuerda las conversaciones</b>: la respuesta de un paquete que dejó pasar vuelve sin revisarse. "
        : "El router revisa cada paquete que reenvía contra estas reglas, en orden: gana la primera que coincide. " +
          "No recuerda conversaciones: una regla puede frenar también la respuesta. ") +
      "Una regla mira el origen y el destino (redes como 10.45.7.0/26; 0.0.0.0/0 es cualquiera) y, si se los indicás, el protocolo, " +
      "el puerto de destino y por qué puerto entra el paquete. Lo que no coincide con ninguna lo decide la política por defecto.</span>"));
    if (d.reglas.length === 0) {
      c.appendChild(el("p", "", "Sin reglas: " + (Motor.esFirewall(d) ? "el firewall" : "el router") + " deja pasar todo lo que sabe enrutar."));
    }
    d.reglas.forEach(function (r, i) {
      var completa = esCidr(r.origen) && esCidr(r.destino);
      var texto = (i + 1) + ". " + (r.accion === "permitir" ? "Permitir" : "Bloquear") + " " +
        (r.protocolo ? r.protocolo.toUpperCase() + (r.puerto ? " " + r.puerto : "") + " " : "") +
        (r.origen || "?") + " → " + (r.destino || "?") + (r.entrada ? " (entra por " + r.entrada + ")" : "") +
        (completa ? "" : " (incompleta: no se aplica)");
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
      // Protocolo, puerto de destino y puerto de entrada: opcionales.
      var extra = el("div", "reglaextra");
      var selProt = document.createElement("select");
      [["", "Cualquier protocolo"], ["icmp", "ICMP (ping)"], ["tcp", "TCP"], ["udp", "UDP"]].forEach(function (op) {
        var o = document.createElement("option"); o.value = op[0]; o.textContent = op[1]; selProt.appendChild(o);
      });
      selProt.value = r.protocolo || "";
      selProt.setAttribute("aria-label", "Regla " + (i + 1) + ": protocolo");
      selProt.addEventListener("change", function () {
        empujarHistorial();
        if (selProt.value) { r.protocolo = selProt.value; } else { delete r.protocolo; }
        if (r.protocolo !== "tcp" && r.protocolo !== "udp") { delete r.puerto; }
        reconstruirEstado(); renderPropiedades();
      });
      extra.appendChild(selProt);
      if (r.protocolo === "tcp" || r.protocolo === "udp") {
        var inPuerto = document.createElement("input");
        inPuerto.type = "number"; inPuerto.min = "1"; inPuerto.max = "65535"; inPuerto.placeholder = "puerto…";
        inPuerto.value = r.puerto || "";
        inPuerto.setAttribute("aria-label", "Regla " + (i + 1) + ": puerto de destino");
        inPuerto.addEventListener("change", function () {
          empujarHistorial();
          var n = Number(inPuerto.value);
          if (inPuerto.value === "") { delete r.puerto; } else if (n >= 1 && n <= 65535) { r.puerto = n; } else { avisar("El puerto va de 1 a 65535."); }
          reconstruirEstado(); renderPropiedades();
        });
        extra.appendChild(inPuerto);
      }
      var selEnt = document.createElement("select");
      var oCual = document.createElement("option"); oCual.value = ""; oCual.textContent = "Entra por cualquier puerto"; selEnt.appendChild(oCual);
      (d.interfaces || []).forEach(function (f) {
        var o = document.createElement("option"); o.value = f.id; o.textContent = "Entra por " + f.id; selEnt.appendChild(o);
      });
      selEnt.value = r.entrada || "";
      selEnt.setAttribute("aria-label", "Regla " + (i + 1) + ": puerto por el que entra el paquete");
      selEnt.addEventListener("change", function () {
        empujarHistorial();
        if (selEnt.value) { r.entrada = selEnt.value; } else { delete r.entrada; }
        reconstruirEstado(); renderPropiedades();
      });
      extra.appendChild(selEnt);
      c.appendChild(extra);
    });
    var labPol = el("label", "", "Si ninguna regla coincide");
    var selPol = document.createElement("select");
    selPol.innerHTML = "<option value='permitir'>Permitir (política por defecto)</option><option value='bloquear'>Bloquear (política por defecto)</option>";
    selPol.value = d.politica === "bloquear" ? "bloquear" : "permitir";
    selPol.id = idCampo("politica"); labPol.htmlFor = selPol.id;
    selPol.addEventListener("change", function () {
      empujarHistorial();
      if (selPol.value === "bloquear") { d.politica = "bloquear"; } else { delete d.politica; }
      reconstruirEstado(); renderPropiedades();
      registrar("filtrado", "Política por defecto de " + (d.nombre || d.id) + ": " + selPol.value + ".");
    });
    c.appendChild(labPol);
    c.appendChild(selPol);
    var bAgregar = boton("Agregar regla");
    bAgregar.addEventListener("click", function () {
      empujarHistorial();
      d.reglas.push({ accion: "bloquear", origen: "", destino: "" });
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(bAgregar);
  }

  // Las dos caras del NAT (SRE-1021): qué puertos cambian el origen de lo
  // que sale (se marca en Interfaces) y qué puertos públicos se redirigen
  // hacia un equipo de adentro.
  function panelNat(c, d) {
    var lista = Array.isArray(d.redirecciones) ? d.redirecciones : [];
    var conNat = (d.interfaces || []).filter(function (f) { return f.nat; });
    c.appendChild(el("p", "", "<span style='font-size:13px'><b>NAT de origen.</b> Lo que sale a internet por un puerto con NAT " +
      "lleva como origen la IP de ese puerto, y la respuesta se traduce de vuelta. Se marca en la pestaña Interfaces.</span>"));
    c.appendChild(el("p", "", conNat.length
      ? "Hacen NAT: " + conNat.map(function (f) { return escapar(f.id) + (f.ip ? " (" + escapar(f.ip) + ")" : ""); }).join(", ") + "."
      : "Ningún puerto hace NAT: sin eso, las redirecciones no se aplican."));
    c.appendChild(el("p", "", "<span style='font-size:13px'><b>Redirección de puertos (NAT de destino).</b> Lo que llega a la IP de un puerto " +
      "con NAT por un protocolo y un puerto se reenvía a un equipo de adentro, en el puerto que elijas. Así se publica un servidor con IP privada. " +
      "El ping a esa IP lo sigue respondiendo " + (Motor.esFirewall(d) ? "el firewall" : "el router") + ".</span>"));
    if (lista.length === 0) {
      c.appendChild(el("p", "", "Sin redirecciones: lo que llega de afuera a su IP pública lo atiende " + (Motor.esFirewall(d) ? "el firewall" : "el router") + ", que no da servicios."));
    }
    function numero(r, clave, nombre, i) {
      var inp = document.createElement("input");
      inp.type = "number"; inp.min = "1"; inp.max = "65535"; inp.placeholder = "puerto…";
      inp.value = r[clave] || "";
      inp.setAttribute("aria-label", "Redirección " + (i + 1) + ": " + nombre);
      inp.addEventListener("change", function () {
        var n = Number(inp.value);
        if (n >= 1 && n <= 65535 && Math.floor(n) === n) { empujarHistorial(); r[clave] = n; reconstruirEstado(); renderPropiedades(); }
        else { avisar("El puerto va de 1 a 65535."); inp.value = r[clave] || ""; }
      });
      return inp;
    }
    lista.forEach(function (r, i) {
      var completa = (r.protocolo === "tcp" || r.protocolo === "udp") && r.puerto && r.puertoInterno && Red.esIpValida(r.ipInterna || "");
      var texto = (i + 1) + ". " + String(r.protocolo || "?").toUpperCase() + " " + (r.puerto || "?") + " → " + (r.ipInterna || "?") + ":" +
        (r.puertoInterno || "?") + (completa ? "" : " (incompleta: no se aplica)");
      var fila = el("div", "filaif", "<span class='datos'>" + escapar(texto) + "</span>");
      var bQuitar = boton("Quitar");
      bQuitar.setAttribute("aria-label", "Quitar la redirección " + (i + 1));
      bQuitar.addEventListener("click", function () { empujarHistorial(); d.redirecciones.splice(i, 1); reconstruirEstado(); renderPropiedades(); });
      fila.appendChild(bQuitar);
      c.appendChild(fila);
      var extra = el("div", "reglaextra");
      var selProt = document.createElement("select");
      [["tcp", "TCP"], ["udp", "UDP"]].forEach(function (op) {
        var o = document.createElement("option"); o.value = op[0]; o.textContent = op[1]; selProt.appendChild(o);
      });
      selProt.value = r.protocolo === "udp" ? "udp" : "tcp";
      selProt.setAttribute("aria-label", "Redirección " + (i + 1) + ": protocolo");
      selProt.addEventListener("change", function () { empujarHistorial(); r.protocolo = selProt.value; reconstruirEstado(); renderPropiedades(); });
      extra.appendChild(selProt);
      extra.appendChild(numero(r, "puerto", "puerto público", i));
      extra.appendChild(numero(r, "puertoInterno", "puerto interno", i));
      c.appendChild(extra);
      campoTexto(c, "Redirección " + (i + 1) + ": IP interna", r.ipInterna, function (v) {
        empujarHistorialSuave(); r.ipInterna = v.trim(); reconstruirEstado();
      }, function (v) { return Red.esIpValida(String(v).trim()); }, true);
    });
    var bAgregar = boton("Agregar redirección");
    bAgregar.addEventListener("click", function () {
      empujarHistorial();
      if (!Array.isArray(d.redirecciones)) { d.redirecciones = []; }
      d.redirecciones.push({ protocolo: "tcp", puerto: 80, ipInterna: "", puertoInterno: 80 });
      reconstruirEstado(); renderPropiedades();
      registrar("nat", "Redirección nueva en " + (d.nombre || d.id) + ".");
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
      if (d.tipo === "switch-l2" && d.modelo === "hub") {
        c.appendChild(el("p", "", "<b>Tabla MAC:</b> un hub no tiene. Repite cada trama por todos sus puertos, sin mirar la MAC."));
      } else if (d.tipo === "switch-l2") {
        var mac = [];
        try { mac = Motor.tablaMac(S.estado, d.id) || []; } catch (e) { mac = []; }
        c.appendChild(el("p", "", "<b>Tabla MAC:</b><br>" + (mac.length ? escapar(mac.map(function (x) { return x.mac + " → " + x.puerto; }).join(", ")) : "vacía")));
      }
      // Un laboratorio (una red con objetivos) no avisa sus fallas plantadas,
      // en ningún modo: encontrarlas es el ejercicio. El modo Docente tampoco.
      var esc = S.topologia.escenario;
      var esLaboratorio = !!(esc && esc.objetivos && esc.objetivos.length);
      var sinAvisos = S.modo === "docente" || esLaboratorio;
      var avisos = [];
      try {
        avisos = sinAvisos ? [] : (Motor.advertenciasDe(S.estado, d.id) || []);
      } catch (e) { avisos = []; }
      if (sinAvisos) {
        c.appendChild(el("p", "", (esLaboratorio ? "En un laboratorio" : "En modo Docente") +
          " no se muestran avisos: encontrar el problema es parte del ejercicio."));
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
    conFoco(S.inf, dibujarInferior);
  }

  function dibujarInferior() {
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
    // Laboratorio: sólo en modo Docente, donde se arman fallas y objetivos.
    if (S.pestañaInf === "laboratorio" && S.modo !== "docente") { S.pestañaInf = "simulacion"; }
    var pestañas = [["simulacion", "Simulación"], ["captura", "Captura"], ["dhcp", "DHCP"], ["calculo", "Cálculo de subred"], ["ayuda", "Ayuda"]];
    if (S.modo === "docente") { pestañas.push(["laboratorio", "Laboratorio"]); }
    var idPanel = armarPestañas(lista, pestañas, S.pestañaInf, "inf", function (clave) { S.pestañaInf = clave; renderInferior(); });
    barra.appendChild(lista);
    barra.appendChild(el("span", "espacio"));
    // La versión va en esta fila y no en el panel: la Ayuda entra justa, sin scroll.
    if (S.pestañaInf === "ayuda") {
      barra.appendChild(el("span", "version", "OpenRedLab " + escapar(Escenarios.VERSION_APP) +
        " · <a href='https://opentecnologia.ar' target='_blank' rel='noopener'>Open Tecnología</a>"));
    }
    var selV = document.createElement("select");
    selV.innerHTML = "<option value='lenta'>lenta</option><option value='normal'>normal</option><option value='rapida'>rápida</option>";
    selV.value = S.velocidad;
    selV.addEventListener("change", function () { S.velocidad = selV.value; });
    barra.appendChild(etiqueta("Velocidad", selV));
    barra.appendChild(selV);
    var colapsado = S.inf.classList.contains("colapsado");
    var bCol = boton(S.presentacion ? "Volver a una línea" : (colapsado ? "Expandir" : "Colapsar"));
    bCol.setAttribute("aria-expanded", String(!colapsado));
    bCol.setAttribute("data-foco", "colapsar");
    bCol.addEventListener("click", function () {
      if (S.presentacion) { S.presExpandida = false; renderInferior(); return; }
      S.inf.classList.toggle("colapsado");
      renderInferior();
    });
    barra.appendChild(bCol);
    c.appendChild(barra);
    if (colapsado) {
      // Sin panel dibujado, las pestañas no controlan nada.
      lista.querySelectorAll("[aria-controls]").forEach(function (b) { b.removeAttribute("aria-controls"); });
      return;
    }
    var cuerpo = el("div", "cuerpoinf");
    marcarPanel(cuerpo, idPanel, "inf", S.pestañaInf);
    c.appendChild(cuerpo);
    if (S.pestañaInf === "simulacion") { panelSimulacion(cuerpo); }
    else if (S.pestañaInf === "captura") { panelCaptura(cuerpo); }
    else if (S.pestañaInf === "dhcp") { panelDhcpInf(cuerpo); }
    else if (S.pestañaInf === "calculo") { panelCalculo(cuerpo); }
    else if (S.pestañaInf === "laboratorio") { panelLaboratorio(cuerpo); }
    else { panelAyuda(cuerpo); }
  }

  // Modo presentación: la franja queda en una línea de estado para que la
  // topología entre entera en pantalla.
  function renderEstadoPresentacion(c) {
    var fila = el("div", "estadopres");
    var bExp = boton("Expandir simulación");
    bExp.setAttribute("data-foco", "colapsar");
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
    var enDns = S.modoSim === "dns";
    // Dos herramientas sobre el mismo origen: el ping y la consulta DNS
    // (como nslookup), con el tipo de registro.
    var modos = el("div", "modosim");
    modos.setAttribute("role", "group");
    modos.setAttribute("aria-label", "Herramienta");
    [["ping", "Ping"], ["dns", "Consultar DNS"], ["conectar", "Conectar"]].forEach(function (m) {
      var b = boton(m[1], (S.modoSim || "ping") === m[0] ? "activo" : "");
      b.setAttribute("aria-pressed", String((S.modoSim || "ping") === m[0]));
      b.addEventListener("click", function () {
        if ((S.modoSim || "ping") === m[0]) { return; }
        S.modoSim = m[0]; renderInferior();
      });
      modos.appendChild(b);
    });
    ctrl.appendChild(modos);
    if (enDns) {
      selD.placeholder = "p. ej. google.com o www.oficina.local…";
      selD.value = S.ultimoNombre || "";
    }
    var selTipoDns = document.createElement("select");
    (Motor.TIPOS_REGISTRO || ["A", "CNAME", "MX", "NS", "PTR"]).forEach(function (t) {
      var op = document.createElement("option"); op.value = t; op.textContent = t; selTipoDns.appendChild(op);
    });
    selTipoDns.value = S.tipoDns || "A";
    selTipoDns.addEventListener("change", function () { S.tipoDns = selTipoDns.value; });
    var enConectar = S.modoSim === "conectar";
    if (enConectar) {
      selD.placeholder = "IP o nombre, p. ej. www.google.com…";
      selD.value = S.ultimoConectar || "";
    }
    // Servicio: los del catálogo o un puerto a mano.
    var selServ = document.createElement("select");
    (Motor.SERVICIOS_CONOCIDOS || []).forEach(function (x) {
      var op = document.createElement("option"); op.value = x.protocolo + ":" + x.puerto;
      op.textContent = x.nombre + " (" + x.protocolo.toUpperCase() + " " + x.puerto + ")"; selServ.appendChild(op);
    });
    var opOtro = document.createElement("option"); opOtro.value = "otro"; opOtro.textContent = "Otro puerto…"; selServ.appendChild(opOtro);
    selServ.value = S.servicioConectar || "tcp:80";
    var selProt = document.createElement("select");
    selProt.innerHTML = "<option value='tcp'>TCP</option><option value='udp'>UDP</option>";
    selProt.value = S.protConectar || "tcp";
    var inPuerto = document.createElement("input");
    inPuerto.type = "number"; inPuerto.min = "1"; inPuerto.max = "65535"; inPuerto.className = "puerto";
    inPuerto.value = S.puertoConectar || "8080";
    // Lo escrito sobrevive a cambiar de herramienta o de servicio.
    selD.addEventListener("input", function () {
      if (enConectar) { S.ultimoConectar = selD.value; } else if (enDns) { S.ultimoNombre = selD.value; } else { S.ultimoDestino = selD.value; }
    });
    selServ.addEventListener("change", function () { S.servicioConectar = selServ.value; renderInferior(); });
    selProt.addEventListener("change", function () { S.protConectar = selProt.value; });
    inPuerto.addEventListener("change", function () { S.puertoConectar = inPuerto.value; });
    var bPing = enDns ? boton("Consultar", "primario") : (enConectar ? boton("Conectar", "primario conectar") : boton("Ping", "primario"));
    ctrl.appendChild(etiqueta("Origen", selO)); ctrl.appendChild(selO);
    ctrl.appendChild(el("span", "flecha", "→")).setAttribute("aria-hidden", "true");
    ctrl.appendChild(etiqueta(enDns ? "Nombre" : "Destino", selD)); ctrl.appendChild(selD);
    if (enDns) { ctrl.appendChild(etiqueta("Tipo", selTipoDns)); ctrl.appendChild(selTipoDns); }
    // Cuántos paquetes manda el ping: como el ping real, 4 por defecto.
    var selCant = document.createElement("select");
    [["1", "1 paquete"], ["4", "4 paquetes"], ["10", "10 paquetes"], ["50", "50 paquetes"]].forEach(function (o) {
      var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; selCant.appendChild(op);
    });
    selCant.value = String(S.cantPing || 4);
    selCant.addEventListener("change", function () { S.cantPing = Number(selCant.value); });
    if (!enDns && !enConectar) { ctrl.appendChild(etiqueta("Paquetes", selCant)); ctrl.appendChild(selCant); }
    if (enConectar) {
      ctrl.appendChild(etiqueta("Servicio", selServ)); ctrl.appendChild(selServ);
      if (selServ.value === "otro") {
        ctrl.appendChild(etiqueta("Protocolo", selProt)); ctrl.appendChild(selProt);
        ctrl.appendChild(etiqueta("Puerto", inPuerto)); ctrl.appendChild(inPuerto);
      }
    }
    ctrl.appendChild(bPing);
    if (enDns) {
      var bVaciar = boton("Vaciar caché");
      bVaciar.title = "Borra lo que guardaron los servidores DNS: la próxima consulta vuelve a preguntarle a la jerarquía";
      bVaciar.addEventListener("click", function () {
        if (S.estado && Motor.vaciarCacheDns) { Motor.vaciarCacheDns(S.estado); }
        registrar("DNS", "Se vació la caché de los servidores DNS.");
        avisar("Caché DNS vaciada: la próxima consulta vuelve a preguntarle a la jerarquía.");
      });
      ctrl.appendChild(bVaciar);
    }
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

    function hacerConsulta() {
      S.ultimoNombre = selD.value;
      S.origenElegido = selO.value;
      if (!S.estado) { reconstruirEstado(); }
      var res;
      try { res = Motor.consultarDns(S.estado, selO.value, selD.value.trim(), selTipoDns.value); }
      catch (e) { registrar("error", "La consulta DNS falló por un error interno: " + e.message); return; }
      S.ultimo = { origen: selO.value, destino: selD.value.trim(), res: res, dns: true, tipo: selTipoDns.value };
      capturarTramas(res.tramas);
      S.panelRes = "ping";
      S.verTodos = true;
      S.verTramas = false;
      if (res.exito) {
        consolaAgregar("Servidor: " + res.respuesta.servidor);
        consolaAgregar(res.respuesta.autoritativa ? "Respuesta autoritativa:" : "Respuesta no autoritativa" + (res.respuesta.desdeCache ? " (desde la caché):" : ":"));
        res.respuesta.registros.forEach(function (x) { consolaAgregar(textoRegistroUI(x)); });
      } else if (res.diagnostico) {
        consolaAgregar("La consulta de " + selD.value.trim() + " falló: " + res.diagnostico.titulo + " (" + res.diagnostico.codigo + ")", true);
      }
      registrar("DNS", "Consulta " + selTipoDns.value + " de " + selD.value.trim() + " desde " + nombreDe(selO.value) + ": " +
        (res.exito ? res.respuesta.registros.map(textoRegistroUI).join("; ") : (res.diagnostico ? res.diagnostico.codigo : "falló")));
      renderInferior();
    }

    function hacerConexion() {
      S.ultimoConectar = selD.value;
      S.origenElegido = selO.value;
      if (!S.estado) { reconstruirEstado(); }
      var prot, puerto;
      if (selServ.value === "otro") { prot = selProt.value; puerto = Number(inPuerto.value); }
      else { prot = selServ.value.split(":")[0]; puerto = Number(selServ.value.split(":")[1]); }
      var res;
      try { res = Motor.conectar(S.estado, selO.value, selD.value.trim(), prot, puerto); }
      catch (e) { registrar("error", "La conexión falló por un error interno: " + e.message); return; }
      S.ultimo = { origen: selO.value, destino: selD.value.trim(), res: res, conexion: true, protocolo: prot, puerto: puerto };
      capturarTramas(res.tramas);
      S.panelRes = "ping";
      S.verTodos = true;
      S.verTramas = false;
      if (res.exito) {
        consolaAgregar("Conexión " + prot.toUpperCase() + " " + res.socket.cliente + " ↔ " + res.socket.servidor + " (" + res.servicio + ")");
      } else if (res.diagnostico) {
        consolaAgregar("La conexión a " + selD.value.trim() + ":" + puerto + " falló: " + res.diagnostico.titulo + " (" + res.diagnostico.codigo + ")", true);
      }
      registrar("conexion", "Conexión " + prot.toUpperCase() + " de " + nombreDe(selO.value) + " a " + selD.value.trim() + ":" + puerto + ": " +
        (res.exito ? "establecida" : (res.diagnostico ? res.diagnostico.codigo : "falló")));
      renderInferior();
    }

    function hacerPing() {
      if (S.modoSim === "dns") { hacerConsulta(); return; }
      if (S.modoSim === "conectar") { hacerConexion(); return; }
      S.ultimoDestino = selD.value;
      S.origenElegido = selO.value;
      if (!S.estado) { reconstruirEstado(); }
      var res, qos;
      S.semillaPing = (S.semillaPing || 0) + 1;
      try {
        qos = Motor.pingRepetido(S.estado, selO.value, selD.value.trim(), { cantidad: Number(selCant.value), semilla: S.semillaPing });
        res = qos.res;
      } catch (e) { registrar("error", "El ping falló por un error interno: " + e.message); return; }
      pintarPing(selO.value, selD.value.trim(), res, qos);
      animarPing(res);
    }
    bPing.addEventListener("click", hacerPing);
    selD.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); hacerPing(); }
    });
    bCopiar.addEventListener("click", function () {
      var texto = textoRegistro();
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
        var blob = new Blob([textoRegistro()], { type: "text/plain" });
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

  /* ---------------- Captura (al estilo Wireshark) ---------------- */

  var PROTOS_TCP = ["TCP", "HTTP", "HTTPS", "SSH", "FTP", "SMTP"];

  function transporteDe(t) {
    if (t.protocolo === "ICMP") { return "ICMP"; }
    if (PROTOS_TCP.indexOf(t.protocolo) >= 0) { return "TCP"; }
    return "UDP";
  }

  // Filtro: palabras separadas por espacios (todas tienen que cumplirse):
  // icmp, tcp, udp, dns, http…, ip.addr==, ip.src==, ip.dst==, tcp.port==,
  // udp.port==. Devuelve null si alguna no se entiende.
  function armarFiltro(texto) {
    var partes = String(texto || "").toLowerCase().replace(/&&|\band\b/g, " ").split(/\s+/).filter(Boolean);
    var pruebas = [];
    for (var i = 0; i < partes.length; i++) {
      var x = partes[i];
      var m = /^(ip\.addr|ip\.src|ip\.dst|tcp\.port|udp\.port|port)==(.+)$/.exec(x);
      if (m) {
        var v = m[2];
        if (m[1] === "ip.addr") { pruebas.push(function (v) { return function (t) { return t.ipOrigen === v || t.ipDestino === v; }; }(v)); }
        else if (m[1] === "ip.src") { pruebas.push(function (v) { return function (t) { return t.ipOrigen === v; }; }(v)); }
        else if (m[1] === "ip.dst") { pruebas.push(function (v) { return function (t) { return t.ipDestino === v; }; }(v)); }
        else {
          var pr = m[1] === "port" ? null : m[1].split(".")[0].toUpperCase();
          pruebas.push(function (v, pr) { return function (t) {
            return (!pr || transporteDe(t) === pr) && (String(t.puertoOrigen) === v || String(t.puertoDestino) === v);
          }; }(v, pr));
        }
      } else if (["icmp", "tcp", "udp"].indexOf(x) >= 0) {
        pruebas.push(function (x) { return function (t) { return transporteDe(t) === x.toUpperCase(); }; }(x));
      } else if (["dns", "http", "https", "ssh", "ftp", "smtp"].indexOf(x) >= 0) {
        pruebas.push(function (x) { return function (t) { return t.protocolo === x.toUpperCase(); }; }(x));
      } else {
        return null;
      }
    }
    return function (t) { return pruebas.every(function (f) { return f(t); }); };
  }

  function detalleCapas(t) {
    var cap = [];
    if (t.medio === "internet") {
      // El cruce de internet no es una trama: son muchos saltos entre routers
      // de los proveedores, cada uno con su trama, que no se dibujan.
      cap.push("<b>Cruce de internet</b> de " + escapar(nombreDe(t.de.dispositivo)) + " a " + escapar(nombreDe(t.a.dispositivo)) +
        ": el paquete pasa por los routers de los proveedores, y en cada salto lleva una trama distinta.");
    } else {
      cap.push("<b>Trama (capa 2)</b> MAC " + escapar(t.macOrigen || "?") + " → " + escapar(t.macDestino || "?") +
        " · de " + escapar(nombreDe(t.de.dispositivo)) + " a " + escapar(nombreDe(t.a.dispositivo)) +
        (t.atraviesa && t.atraviesa.length ? " (cruza " + t.atraviesa.map(function (id) { return escapar(nombreDe(id)); }).join(", ") + ")" : ""));
    }
    cap.push("<b>Paquete IP (capa 3)</b> " + escapar(t.ipOrigen) + " → " + escapar(t.ipDestino) + " · TTL " + t.ttl);
    var tr = transporteDe(t);
    if (tr === "ICMP") {
      cap.push("<b>ICMP</b> " + escapar(t.info || t.mensaje || ""));
    } else if (tr === "TCP") {
      cap.push("<b>Segmento TCP (capa 4)</b> puerto " + t.puertoOrigen + " → " + t.puertoDestino +
        (t.flags ? " · [" + escapar(t.flags) + "]" : "") + (t.seq !== undefined && t.seq !== null ? " · Seq=" + t.seq : "") + (t.ack ? " · Ack=" + t.ack : ""));
    } else {
      cap.push("<b>Datagrama UDP (capa 4)</b> puerto " + t.puertoOrigen + " → " + t.puertoDestino);
    }
    if (t.protocolo !== "ICMP" && t.protocolo !== "TCP" && t.protocolo !== "UDP") {
      cap.push("<b>" + escapar(t.protocolo) + " (capa 7)</b> " + escapar(t.datos || t.info || ""));
    } else if (t.datos) {
      cap.push("<b>Datos</b> " + escapar(t.datos));
    }
    return cap.map(function (x) { return "<div>" + x + "</div>"; }).join("");
  }

  function panelCaptura(c) {
    c.classList.add("captura");
    var cap = S.captura;
    if (cap.enlace && !buscarEnlace(cap.enlace)) { cap.enlace = ""; }
    var ctrl = el("div", "simctrl");
    var selE = document.createElement("select");
    var oT = document.createElement("option"); oT.value = ""; oT.textContent = "Todos los cables"; selE.appendChild(oT);
    (S.topologia.enlaces || []).forEach(function (e) {
      var o = document.createElement("option"); o.value = e.id;
      o.textContent = nombreDe(e.a.dispositivo) + " ↔ " + nombreDe(e.b.dispositivo) + " (" + e.id + ")";
      selE.appendChild(o);
    });
    if (!cap.activa && !cap.paquetes.length && S.enlaceSel && buscarEnlace(S.enlaceSel)) { cap.enlace = S.enlaceSel; }
    selE.value = cap.enlace;
    selE.disabled = cap.activa;
    selE.addEventListener("change", function () { cap.enlace = selE.value; });
    ctrl.appendChild(etiqueta("Cable", selE)); ctrl.appendChild(selE);
    var bIni = boton(cap.activa ? "Detener" : "Iniciar captura", cap.activa ? "" : "primario");
    bIni.addEventListener("click", function () {
      cap.activa = !cap.activa;
      registrar("captura", cap.activa ? "Captura iniciada en " + (cap.enlace || "todos los cables") + "." : "Captura detenida.");
      renderInferior();
    });
    ctrl.appendChild(bIni);
    var bLim = boton("Limpiar");
    bLim.disabled = !cap.paquetes.length;
    bLim.addEventListener("click", function () { cap.paquetes = []; cap.n = 0; cap.sel = null; cap.descartados = 0; renderInferior(); });
    ctrl.appendChild(bLim);
    var inF = document.createElement("input");
    inF.type = "text"; inF.value = cap.filtro; inF.className = "filtrocap";
    inF.placeholder = "Filtro: icmp, tcp, dns, ip.addr==10.0.0.1, tcp.port==80…";
    inF.setAttribute("autocomplete", "off");
    ctrl.appendChild(etiqueta("Filtro", inF)); ctrl.appendChild(inF);
    var filtro = armarFiltro(cap.filtro);
    inF.classList.toggle("invalido", !filtro);
    inF.addEventListener("change", function () { cap.filtro = inF.value; cap.sel = null; renderInferior(); });
    var visibles = filtro ? cap.paquetes.filter(function (p) { return filtro(p.t); }) : [];
    ctrl.appendChild(el("span", "tenue", cap.paquetes.length + (cap.paquetes.length === 1 ? " paquete" : " paquetes") +
      (cap.filtro && filtro ? " · " + visibles.length + " con el filtro" : "") +
      (cap.descartados ? " · se muestran los últimos " + MAX_CAPTURA : "") + (cap.activa ? " · capturando…" : "")));
    c.appendChild(ctrl);

    var cuerpo = el("div", "simres");
    var lista = el("div", "recorrido");
    lista.appendChild(el("div", "cab", "<span>Paquetes" + (cap.enlace ? " en " + escapar(cap.enlace) : " en todos los cables") + "</span>"));
    var cont = el("div", "pasos");
    if (!filtro) {
      cont.appendChild(el("p", "", "El filtro no se entiende. Usá palabras como icmp, tcp, udp, dns o http, y expresiones como ip.addr==10.45.7.66 o tcp.port==80, separadas por espacios."));
    } else if (!cap.paquetes.length) {
      cont.appendChild(el("p", "", cap.activa
        ? "Capturando. Hacé un ping, una consulta DNS o una conexión en la pestaña Simulación: lo que pase por " + (cap.enlace ? "este cable" : "los cables") + " aparece acá."
        : "Elegí un cable (o todos) y apretá <b>Iniciar captura</b>. Después hacé pings, consultas DNS y conexiones en Simulación."));
    } else {
      var tabla = el("table", "tablacap");
      tabla.setAttribute("role", "grid");
      tabla.setAttribute("aria-label", "Paquetes capturados");
      tabla.innerHTML = "<thead><tr><th>N.º</th><th>Origen</th><th>Destino</th><th>Protocolo</th><th>Info</th>" +
        (cap.enlace ? "" : "<th>Tramo</th>") + "</tr></thead>";
      var tb = document.createElement("tbody");
      visibles.forEach(function (p) {
        var t = p.t;
        var tr = document.createElement("tr");
        tr.className = (p.n === cap.sel ? "sel " : "") + "p-" + transporteDe(t).toLowerCase();
        tr.tabIndex = 0;
        tr.setAttribute("aria-selected", String(p.n === cap.sel));
        tr.setAttribute("data-foco", "cap-" + p.n);
        tr.innerHTML = "<td>" + p.n + "</td><td>" + escapar(t.ipOrigen) + "</td><td>" + escapar(t.ipDestino) + "</td><td>" +
          escapar(t.protocolo || "ICMP") + "</td><td>" + escapar(t.info || t.mensaje || "") + "</td>" +
          (cap.enlace ? "" : "<td>" + escapar(nombreDe(t.de.dispositivo) + " → " + nombreDe(t.a.dispositivo) + (t.medio === "internet" ? " (cruza internet)" : "")) + "</td>");
        function elegir() { cap.sel = p.n; renderInferior(); resaltarTrama(t); }
        tr.addEventListener("click", elegir);
        tr.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); elegir(); }
        });
        tb.appendChild(tr);
      });
      tabla.appendChild(tb);
      cont.appendChild(tabla);
    }
    lista.appendChild(cont);
    cuerpo.appendChild(lista);
    var lado = el("div", "lado");
    var elegido = cap.paquetes.filter(function (p) { return p.n === cap.sel; })[0];
    lado.appendChild(el("div", "detallecap", elegido
      ? "<b>Paquete " + elegido.n + "</b>" + detalleCapas(elegido.t)
      : "<span class='tenue'>Tocá un paquete para ver sus capas: la trama, el paquete IP, el segmento y los datos de la aplicación.</span>"));
    cuerpo.appendChild(lado);
    c.appendChild(cuerpo);
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
    // Con el resultado a la vista, la consola va en su propia columna: debajo
    // de la banda quedaba sin alto.
    var conConsola = false;
    if (S.ultimo.conexion) {
      // El socket y los segmentos, uno por línea: → del cliente, ← del servidor.
      var lineas = (res.segmentos || []).map(function (x) {
        var flecha = x.de === "cliente" ? "→" : "←";
        var cab = x.protocolo === "udp" ? "UDP" : x.flags;
        var numeros = x.protocolo === "tcp" ? " seq=" + x.seq + (x.ack ? " ack=" + x.ack : "") : "";
        return escapar(flecha + " " + cab + " " + x.puertoOrigen + "→" + x.puertoDestino + numeros + (x.datos ? " «" + x.datos + "»" : ""));
      });
      if (res.exito) {
        var sk = res.socket;
        lado.appendChild(el("div", "banda-ok",
          "<b>✓ " + escapar(res.servicio) + ": conexión " + (S.ultimo.protocolo === "tcp" ? "establecida y cerrada" : "por datagramas") + "</b>" +
          "<div>Socket: " + escapar(sk.cliente) + " ↔ " + escapar(sk.servidor) +
          (sk.vistoPorServidor !== sk.cliente ? " · el servidor la ve desde " + escapar(sk.vistoPorServidor) + " (NAT)" : "") + "</div>" +
          "<div class='segmentos'>" + lineas.join("<br>") + "</div>"));
        conConsola = true;
      } else {
        var dgC = renderDiagnostico(res.diagnostico);
        if (lineas.length) { dgC.appendChild(el("div", "segmentos", lineas.join("<br>"))); }
        lado.appendChild(dgC);
        lado.appendChild(renderConsolaPlegable());
      }
    } else if (S.ultimo.dns && res.exito) {
      // Respuesta como la de nslookup: quién respondió, si es autoritativa
      // y los registros, con la cadena de CNAME.
      var resp = res.respuesta;
      lado.appendChild(el("div", "banda-ok",
        "<b>✓ " + escapar(S.ultimo.destino) + " (" + escapar(S.ultimo.tipo) + ")</b>" +
        "<div>Servidor: " + escapar(resp.servidor) + " · " +
        (resp.autoritativa ? "respuesta autoritativa" : "respuesta no autoritativa" + (resp.desdeCache ? ", desde la caché" : "")) + "</div>" +
        "<div class='ruta'>" + resp.registros.map(function (x) { return escapar(textoRegistroUI(x)); }).join("<br>") + "</div>"));
      conConsola = true;
    } else if (res.exito && S.ultimo.qos && S.ultimo.qos.diagnostico) {
      // El camino existe, pero se perdieron todos los paquetes (D32).
      lado.appendChild(renderDiagnostico(S.ultimo.qos.diagnostico));
      lado.appendChild(renderConsolaPlegable());
    } else if (res.exito) {
      var r = res.respuestas[0] || { ms: 1, ttl: 64 };
      var ruta = rutaNombres(res);
      var q = S.ultimo.qos && S.ultimo.qos.cantidad > 1 ? S.ultimo.qos.estadisticas : null;
      lado.appendChild(el("div", q && q.perdidos ? "banda-ok conperdida" : "banda-ok",
        (q
          ? "<b>✓ Volvieron " + q.recibidos + " de " + q.enviados + " paquetes" + (q.perdidos ? " (" + q.porcentajePerdida + " % de pérdida)" : "") + ".</b>" +
            "<div>Mínimo " + q.minimo + " ms · media " + q.promedio + " ms · máximo " + q.maximo + " ms" +
            (q.maximo > q.minimo ? " · variación (jitter) " + (q.maximo - q.minimo) + " ms" : "") + "</div>"
          : "<b>✓ El eco volvió en " + r.ms + " ms.</b>") +
        "<div class='ruta'>" + escapar(ruta.join(" → ")) + " · " + cantidadSaltos(res) + " saltos · TTL " + r.ttl + "</div>"));
      conConsola = true;
    } else {
      lado.appendChild(renderDiagnostico(res.diagnostico));
      // Con un diagnóstico a la vista, la consola se pliega a una línea.
      lado.appendChild(renderConsolaPlegable());
    }
    cont.appendChild(lado);
    if (conConsola) {
      var col = el("div", "colconsola");
      col.appendChild(renderConsola());
      cont.appendChild(col);
    }
    return cont;
  }

  function textoRegistroUI(x) {
    return x.nombre + "  " + x.tipo + "  " + (x.tipo === "MX" && x.prioridad !== undefined ? x.prioridad + " " : "") + x.valor;
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

  var PASOS_CLAVE = /^(Consultar al servidor DNS|Responder (con autoridad|desde la caché|al cliente)|Decidir si el destino|Buscar ruta|Traducir la dirección|Llegar a internet|Comprobar que la respuesta)/;

  // «Capa 2 · Enlace», con el nombre TCP/IP y la unidad de datos al pasar
  // el mouse. Los pasos de configuración no son de ninguna capa.
  function etiquetaCapa(capa) {
    var c = capa && Motor.CAPAS ? Motor.CAPAS[capa] : null;
    if (!c) { return ""; }
    return "<span class='capa' title='" + escapar("Modelo OSI: capa " + capa + ", " + c.osi + ". Modelo TCP/IP: " + c.tcpip +
      ". Lo que viaja: " + c.pdu + ".") + "'>Capa " + capa + " · " + escapar(c.osi) + "</span>";
  }

  var PALABRA_MEDIO = { ethernet: "cobre", fibra: "fibra", wireless: "inalámbrico", internet: "internet (cruza las redes de los proveedores)" };

  // Cable resaltado mientras se señala una trama: el tramo completo, con
  // los switches que cruza.
  function resaltarTrama(t) {
    quitarResalteTrama();
    if (!S.capaAnim) { return; }
    var svgNS = "http://www.w3.org/2000/svg";
    var g = document.createElementNS(svgNS, "g");
    g.setAttribute("class", "resalte-trama");
    (t.enlaces || []).forEach(function (id) {
      var e = buscarEnlace(id);
      var tr = e && tramoEnlace(e, e.a.dispositivo);
      if (!tr) { return; }
      var l = document.createElementNS(svgNS, "line");
      l.setAttribute("x1", tr.de.x); l.setAttribute("y1", tr.de.y);
      l.setAttribute("x2", tr.a.x); l.setAttribute("y2", tr.a.y);
      l.setAttribute("stroke", "#f59e0b"); l.setAttribute("stroke-width", "7");
      l.setAttribute("stroke-linecap", "round"); l.setAttribute("opacity", "0.75");
      g.appendChild(l);
    });
    S.capaAnim.appendChild(g);
  }

  function quitarResalteTrama() {
    if (!S.capaAnim) { return; }
    var viejos = S.capaAnim.querySelectorAll(".resalte-trama");
    for (var i = 0; i < viejos.length; i++) { viejos[i].parentNode.removeChild(viejos[i]); }
  }

  // Una línea por trama: quién la manda, a quién, por qué medio, qué
  // switches cruza sin cambiarla, y qué cambió respecto del salto anterior.
  function renderTramas(res, lista) {
    var tramas = res.tramas || [];
    lista.appendChild(el("p", "nota-ttl", "Cada línea es una trama entre dos equipos IP; adentro va el paquete IP con el mensaje ICMP. " +
      "TTL: cuántos routers más puede cruzar el paquete (cada router le resta uno)."));
    var anterior = {};
    var cuenta = { ida: 0, vuelta: 0 };
    tramas.forEach(function (t) {
      cuenta[t.sentido] += 1;
      var prev = anterior[t.sentido];
      var cambiaMac = !prev || prev.macOrigen !== t.macOrigen || prev.macDestino !== t.macDestino;
      var cambiaIp = prev && (prev.ipOrigen !== t.ipOrigen || prev.ipDestino !== t.ipDestino);
      var cambiaTtl = prev && prev.ttl !== t.ttl;
      var partes = [escapar(nombreDe(t.de.dispositivo)) + " → " + escapar(nombreDe(t.a.dispositivo))];
      if (t.medio) { partes.push("por " + (PALABRA_MEDIO[t.medio] || escapar(t.medio))); }
      if (t.atraviesa && t.atraviesa.length) {
        var hubs = t.atraviesa.filter(function (id) { var x = buscarDisp(id); return x && x.tipo === "switch-l2" && x.modelo === "hub"; });
        partes.push("pasa por " + t.atraviesa.map(function (id) { return escapar(nombreDe(id)); }).join(" y ") +
          (t.atraviesa.length > 1 ? ", que no cambian" : ", que no cambia") + " la trama" +
          (hubs.length ? " (" + (hubs.length > 1 ? "los hubs la repiten" : "el hub la repite") + " por todos sus puertos)" : ""));
      }
      if (prev) {
        var cambia = [], queda = [];
        (cambiaMac ? cambia : queda).push("MAC");
        (cambiaIp ? cambia : queda).push("IP");
        (cambiaTtl ? cambia : queda).push("TTL");
        function enumerar(l) { return l.length > 1 ? l.slice(0, -1).join(", ") + " y " + l[l.length - 1] : l[0]; }
        partes.push((cambia.length ? "<span class='cambia'>cambia: " + enumerar(cambia) + "</span>" : "") +
          (cambia.length && queda.length ? " · " : "") +
          (queda.length ? "<span class='queda'>se mantiene: " + enumerar(queda) + "</span>" : ""));
      }
      partes.push("TTL " + t.ttl);
      var fila = el("div", "trama",
        "<span class='sent'>" + (t.sentido === "ida" ? "Ida " : "Vuelta ") + cuenta[t.sentido] + "</span>" + partes.join(" · "));
      fila.tabIndex = 0;
      fila.addEventListener("mouseenter", function () { resaltarTrama(t); });
      fila.addEventListener("focus", function () { resaltarTrama(t); });
      fila.addEventListener("mouseleave", quitarResalteTrama);
      fila.addEventListener("blur", quitarResalteTrama);
      lista.appendChild(fila);
      if (S.verEncabezados) {
        // Las capas anidadas: la trama contiene al paquete, que contiene al
        // mensaje. Lo que cambió respecto de la trama anterior, resaltado.
        function campo(texto, cambio) { return cambio ? "<mark>" + escapar(texto) + "</mark>" : escapar(texto); }
        lista.appendChild(el("div", "",
          "<span class='enc' title='Capa 2: trama'><b>Trama</b>MAC " + campo(t.macOrigen || "?", cambiaMac) + " → " +
          campo(t.macDestino || "?", cambiaMac) +
          "<span class='enc' title='Capa 3: paquete'><b>Paquete IP</b>" + campo(t.ipOrigen, cambiaIp) + " → " + campo(t.ipDestino, cambiaIp) +
          " · TTL " + campo(String(t.ttl), cambiaTtl) +
          "<span class='enc' title='Va dentro del paquete IP'><b>ICMP</b>" + escapar(t.mensaje.replace("ICMP ", "")) + "</span></span></span>"));
      }
      anterior[t.sentido] = t;
    });
  }

  function renderRecorrido(res) {
    var caja = el("div", "recorrido");
    var pasos = res.pasos || [];
    var fallo = -1;
    pasos.forEach(function (p, i) { if (!p.ok && fallo < 0) { fallo = i; } });
    var tramas = res.tramas || [];
    var enTramas = S.verTramas && tramas.length > 0;
    var cab = el("div", "cab", "<span>" + (enTramas ? "Cómo viaja el paquete" : "Recorrido paso a paso") + "</span>");
    if (enTramas) {
      cab.appendChild(el("span", "", tramas.length + (tramas.length === 1 ? " trama" : " tramas")));
    } else if (res.exito) {
      cab.appendChild(el("span", "ok", pasos.length + " de " + pasos.length + " verificaciones correctas"));
    } else if (fallo >= 0) {
      cab.appendChild(el("span", "mal", "se detuvo en el paso " + pasos[fallo].n));
    }
    caja.appendChild(cab);
    var lista = el("div", "pasos");
    var visibles = [];
    if (enTramas) {
      renderTramas(res, lista);
    } else if (!pasos.length) {
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
          "<span class='marca' aria-hidden='true'>✓</span>" + etiquetaCapa(p.capa) + "<b>" + p.n + ".</b> " + escapar(p.titulo) +
          (resumen ? " — " + escapar(resumen) : "")));
      } else {
        var f = el("div", "pasofallo",
          "<span class='marca' aria-hidden='true'>✗</span>" + etiquetaCapa(p.capa) + "<b>" + p.n + ". " + escapar(p.titulo) + "</b>");
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
    if (!res.exito && fallo >= 0 && !S.verTodos && !enTramas) {
      pie.appendChild(el("span", "", "los pasos siguientes no se llegaron a verificar"));
    }
    if (tramas.length) {
      var bTramas = boton(enTramas ? "Ver los pasos" : "Cómo viaja el paquete (" + tramas.length + (tramas.length === 1 ? " trama)" : " tramas)"));
      bTramas.setAttribute("data-foco", "tramas");
      bTramas.addEventListener("click", function () { S.verTramas = !S.verTramas; quitarResalteTrama(); renderInferior(); });
      pie.appendChild(bTramas);
    }
    if (enTramas) {
      var bEnc = boton(S.verEncabezados ? "Ocultar los encabezados" : "Ver los encabezados");
      bEnc.setAttribute("aria-expanded", String(!!S.verEncabezados));
      bEnc.setAttribute("data-foco", "encabezados");
      bEnc.addEventListener("click", function () { S.verEncabezados = !S.verEncabezados; renderInferior(); });
      pie.appendChild(bEnc);
    }
    if (!enTramas && (pasos.length > visibles.length || S.verTodos)) {
      var bTodos = boton(S.verTodos ? "Ver resumen" : "Ver los " + pasos.length + " pasos");
      bTodos.setAttribute("data-foco", "todos");
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
    inBloque.type = "text"; inBloque.placeholder = "p. ej. 10.45.7.0/24…"; inBloque.value = inf.bloqueBase || "";
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
        // Cada tipo de objetivo se describe a su manera.
        var que = o.tipo === "conectar"
          ? nombreDe(o.origen) + " → " + o.destino + " " + String(o.protocolo || "tcp").toUpperCase() + " " + o.puerto
          : (o.tipo === "resolver"
            ? nombreDe(o.origen) + " resuelve " + o.nombre + (o.valor ? " (" + o.valor + ")" : "")
            : nombreDe(o.origen) + " → " + o.destino);
        if (o.tipo === "conectar") { espera = espera.replace("que llegue", "que se conecte").replace("que no llegue", "que no se conecte"); }
        if (o.tipo === "resolver") { espera = espera.replace("que llegue", "que se resuelva").replace("que no llegue", "que no se resuelva"); }
        var hecho = o.tipo === "conectar" ? "se conectó" : (o.tipo === "resolver" ? "se resolvió" : "el ping llegó");
        var obtenido = r.cumple ? " — cumple"
          : (r.codigo ? " — no cumple: " + r.titulo + (r.codigo !== "VALOR" ? " (" + r.codigo + ")" : "")
            : (o.esperado === "falla" ? " — no cumple: " + hecho : " — no cumple"));
        lista.appendChild(el("div", r.cumple ? "linpaso" : "pasofallo",
          "<span class='marca' aria-hidden='true'>" + (r.cumple ? "✓" : "✗") + "</span><b>" +
          escapar(que) + "</b> (" + escapar(espera) + ")" + escapar(obtenido) +
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
    b.setAttribute("data-foco", "consola");
    b.addEventListener("click", function () { S.consolaAbierta = !S.consolaAbierta; renderInferior(); });
    cont.appendChild(b);
    if (S.consolaAbierta) { cont.appendChild(renderConsola()); }
    else { S.consola = null; }
    return cont;
  }

  // La captura guarda los últimos MAX_CAPTURA paquetes: en una clase larga la
  // tabla se redibuja entera y, sin tope, la pestaña se pone lenta.
  var MAX_CAPTURA = 500;

  function capturarTramas(lista) {
    var cap = S.captura;
    if (!cap.activa) { return; }
    (lista || []).forEach(function (t) {
      if (cap.enlace && (t.enlaces || []).indexOf(cap.enlace) < 0) { return; }
      cap.n += 1;
      cap.paquetes.push({ n: cap.n, t: t });
    });
    var sobra = cap.paquetes.length - MAX_CAPTURA;
    if (sobra > 0) {
      cap.paquetes.splice(0, sobra);
      cap.descartados = (cap.descartados || 0) + sobra;
      if (cap.sel !== null && cap.sel <= cap.paquetes[0].n - 1) { cap.sel = null; }
    }
  }

  function pintarPing(origen, destino, res, qos) {
    capturarTramas((res.tramasPrevias || []).concat(res.tramas || []));
    S.ultimo = { origen: origen, destino: destino, res: res, qos: qos || null };
    S.panelRes = "ping";
    S.verTodos = false;
    S.verTramas = false;
    S.consolaAbierta = false;
    if (res.exito && qos && qos.estadisticas) {
      var est = qos.estadisticas;
      var desde = res.ipResuelta || destino;
      if (res.ipResuelta) { consolaAgregar("Haciendo ping a " + destino + " [" + res.ipResuelta + "]"); }
      qos.respuestas.forEach(function (x) {
        if (x.perdido) { consolaAgregar("Tiempo de espera agotado para esta solicitud.", true); }
        else { consolaAgregar("Respuesta desde " + desde + ": bytes=32 tiempo=" + x.ms + "ms TTL=" + x.ttl); }
      });
      consolaAgregar("Estadísticas: " + est.enviados + " enviados, " + est.recibidos + " recibidos, " + est.perdidos + " perdidos (" +
        est.porcentajePerdida + " % perdidos).");
      if (est.recibidos) {
        consolaAgregar("Tiempos: mínimo = " + est.minimo + " ms, máximo = " + est.maximo + " ms, media = " + est.promedio + " ms.");
      }
      anunciar("Ping a " + destino + ": volvieron " + est.recibidos + " de " + est.enviados + " paquetes" +
        (est.recibidos ? ", media de " + est.promedio + " milisegundos." : "."));
    } else if (res.exito) {
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

  /* ---------------- Laboratorio (modo Docente) ----------------
   * Editores de fallas, objetivos y sectores sobre el escenario de la red
   * abierta, y la comparación de la red sana con la del alumno. Los campos
   * salen del catálogo de Escenarios: acá no se sabe nada de cada tipo. */
  function escenarioLab() {
    if (!S.topologia.escenario || typeof S.topologia.escenario !== "object") {
      S.topologia.escenario = { modo: "docente" };
    }
    return S.topologia.escenario;
  }

  // Sin crear: dibujar la pestaña no debe tocar la red.
  function sectoresLab(crear) {
    var esc = crear ? escenarioLab() : (S.topologia.escenario || {});
    if (Array.isArray(esc.requerimientos)) { return esc.requerimientos; }
    if (Array.isArray(esc.sectores)) { return esc.sectores; }
    if (crear) { esc.requerimientos = []; return esc.requerimientos; }
    return [];
  }

  // Después de cada cambio: la red se rearma y la franja se vuelve a dibujar.
  function cambioLab(texto) {
    reconstruirEstado();
    actualizarBotonAlumno();
    renderInferior();
    if (texto) { registrar("laboratorio", texto); }
  }

  function avisosHtml(problemas) {
    return problemas.map(function (p) { return "<div class='avisolab'>⚠ " + escapar(p) + "</div>"; }).join("");
  }

  function panelLaboratorio(c) {
    c.classList.add("lab");
    var esc = S.topologia.escenario || {};
    var rev = Escenarios.revisarEscenario(S.topologia);
    var conProblemas = function (lista) { return lista.filter(function (p) { return p.length; }).length; };
    var ctrl = el("div", "simctrl");
    var secs = el("div", "modosim");
    secs.setAttribute("role", "group");
    secs.setAttribute("aria-label", "Parte del laboratorio");
    var actual = S.seccionLab || "fallas";
    [["fallas", "Fallas (" + (esc.fallas || []).length + ")"], ["objetivos", "Objetivos (" + (esc.objetivos || []).length + ")"],
      ["desafio", "Desafío VLSM (" + sectoresLab(false).length + ")"], ["verificar", "Verificar"]].forEach(function (s) {
      var b = boton(s[1], actual === s[0] ? "activo" : "");
      b.setAttribute("aria-pressed", String(actual === s[0]));
      b.setAttribute("data-foco", "lab-" + s[0]);
      b.addEventListener("click", function () { S.seccionLab = s[0]; S.itemLab = 0; renderInferior(); });
      secs.appendChild(b);
    });
    ctrl.appendChild(secs);
    ctrl.appendChild(el("span", "espacio"));
    var nProb = conProblemas(rev.fallas) + conProblemas(rev.objetivos) + conProblemas(rev.sectores) + (rev.bloque ? 1 : 0);
    ctrl.appendChild(el("span", nProb ? "tenue avisolab" : "tenue",
      nProb ? "⚠ " + nProb + (nProb === 1 ? " ítem con problemas" : " ítems con problemas") : "Las fallas, objetivos y sectores coinciden con la red."));
    c.appendChild(ctrl);
    var cuerpo = el("div", "simres");
    c.appendChild(cuerpo);
    if (actual === "fallas") {
      editorItems(cuerpo, "fallas", Escenarios.TIPOS_FALLA, Escenarios.nuevaFalla, Escenarios.textoFalla, rev.fallas,
        "Fallas que se aplican al exportar para el alumno", "falla");
    } else if (actual === "objetivos") {
      editorItems(cuerpo, "objetivos", Escenarios.TIPOS_OBJETIVO, Escenarios.nuevoObjetivo, Escenarios.textoObjetivo, rev.objetivos,
        "Objetivos que el alumno verifica", "objetivo");
    } else if (actual === "desafio") {
      editorDesafio(cuerpo, rev);
    } else {
      verificarLaboratorio(cuerpo, rev);
    }
  }

  // Lista numerada a la izquierda; formulario del elegido a la derecha.
  function editorItems(cuerpo, clave, catalogo, nuevo, texto, problemas, titulo, palabra) {
    var items = (S.topologia.escenario && S.topologia.escenario[clave]) || [];
    if (S.itemLab >= items.length) { S.itemLab = items.length - 1; }
    if (!(S.itemLab >= 0)) { S.itemLab = 0; }
    var caja = el("div", "recorrido");
    var cab = el("div", "cab", "<span>" + escapar(titulo) + "</span>");
    var selNuevo = document.createElement("select");
    selNuevo.setAttribute("aria-label", "Agregar " + palabra);
    selNuevo.innerHTML = "<option value=''>+ Agregar " + palabra + "…</option>";
    catalogo.forEach(function (t) {
      var o = document.createElement("option"); o.value = t.tipo; o.textContent = t.nombre; selNuevo.appendChild(o);
    });
    selNuevo.addEventListener("change", function () {
      if (!selNuevo.value) { return; }
      empujarHistorial();
      var esc = escenarioLab();
      if (!Array.isArray(esc[clave])) { esc[clave] = []; }
      esc[clave].push(nuevo(S.topologia, selNuevo.value));
      S.itemLab = esc[clave].length - 1;
      cambioLab("Se agregó " + (palabra === "falla" ? "una falla" : "un objetivo") + " al laboratorio.");
    });
    cab.appendChild(selNuevo);
    caja.appendChild(cab);
    var lista = el("div", "pasos");
    if (!items.length) {
      lista.appendChild(el("p", "tenue", palabra === "falla"
        ? "Sin fallas. Armá y probá la red sana; después agregá las fallas que el alumno tiene que encontrar."
        : "Sin objetivos. Un objetivo dice qué tiene que funcionar (o fallar) cuando el alumno termine."));
    }
    items.forEach(function (it, i) {
      var p = problemas[i] || [];
      var fila = el("div", "labfila" + (i === S.itemLab ? " sel" : "") + (p.length ? " conproblema" : ""));
      var bSel = boton((i + 1) + ". " + texto(S.topologia, it) + (p.length ? " ⚠" : ""), "labtexto");
      bSel.setAttribute("aria-pressed", String(i === S.itemLab));
      if (p.length) { bSel.title = p.join(" "); }
      bSel.addEventListener("click", function () { S.itemLab = i; renderInferior(); });
      fila.appendChild(bSel);
      if (i > 0) {
        var bSubir = boton("↑");
        bSubir.setAttribute("aria-label", "Subir " + (palabra === "falla" ? "la falla " : "el objetivo ") + (i + 1));
        bSubir.addEventListener("click", function () {
          empujarHistorial();
          var arr = escenarioLab()[clave];
          arr.splice(i - 1, 0, arr.splice(i, 1)[0]);
          S.itemLab = i - 1;
          cambioLab();
        });
        fila.appendChild(bSubir);
      }
      var bQuitar = boton("✕");
      bQuitar.setAttribute("aria-label", "Quitar " + (palabra === "falla" ? "la falla " : "el objetivo ") + (i + 1));
      bQuitar.addEventListener("click", function () {
        empujarHistorial();
        escenarioLab()[clave].splice(i, 1);
        cambioLab("Se quitó " + (palabra === "falla" ? "la falla " : "el objetivo ") + (i + 1) + " del laboratorio.");
      });
      fila.appendChild(bQuitar);
      lista.appendChild(fila);
    });
    caja.appendChild(lista);
    cuerpo.appendChild(caja);
    var lado = el("div", "lado formlab");
    var it = items[S.itemLab];
    if (it) {
      formularioItem(lado, it, catalogo, problemas[S.itemLab] || [], palabra, S.itemLab);
    } else {
      lado.appendChild(el("p", "tenue", palabra === "falla"
        ? "Cada falla cambia algo de la red cuando se exporta para el alumno: un puerto, una ruta, una puerta de enlace, un servicio. " +
          "La red que ves sigue sana: es la solución."
        : "Los objetivos se verifican con el botón Verificar de Simulación (el alumno) y en la sección Verificar de acá (vos)."));
    }
    cuerpo.appendChild(lado);
  }

  function formularioItem(lado, it, catalogo, problemas, palabra, indice) {
    var tipo = null;
    catalogo.forEach(function (t) { if (t.tipo === it.tipo) { tipo = t; } });
    var cab = el("div", "cablab", "<b>" + (palabra === "falla" ? "Falla " : "Objetivo ") + (indice + 1) + "</b>");
    var selTipo = document.createElement("select");
    selTipo.setAttribute("aria-label", "Tipo de " + palabra);
    catalogo.forEach(function (t) {
      var o = document.createElement("option"); o.value = t.tipo; o.textContent = t.nombre;
      if (t.tipo === it.tipo) { o.selected = true; }
      selTipo.appendChild(o);
    });
    selTipo.addEventListener("change", function () {
      empujarHistorial();
      // Otro tipo: se conservan el equipo, el origen, el destino y la
      // descripción, sólo si el tipo nuevo los usa.
      var nuevo = { tipo: selTipo.value };
      var usa = [];
      catalogo.forEach(function (t) {
        if (t.tipo === selTipo.value) { t.campos.forEach(function (c) { usa.push(c.clave); }); }
      });
      ["dispositivo", "origen", "destino", "descripcion"].forEach(function (k) {
        if (it[k] !== undefined && usa.indexOf(k) >= 0) { nuevo[k] = it[k]; }
      });
      var arr = escenarioLab()[palabra === "falla" ? "fallas" : "objetivos"];
      var base = palabra === "falla" ? Escenarios.nuevaFalla(S.topologia, selTipo.value) : Escenarios.nuevoObjetivo(S.topologia, selTipo.value);
      Object.keys(nuevo).forEach(function (k) { base[k] = nuevo[k]; });
      arr[indice] = Escenarios.completarItem(S.topologia, base, catalogo);
      cambioLab();
    });
    cab.appendChild(selTipo);
    lado.appendChild(cab);
    if (!tipo) { lado.appendChild(el("div", "", avisosHtml(problemas))); return; }
    var campos = el("div", "camposlab");
    tipo.campos.forEach(function (campo) {
      if (campo.soloSi && Escenarios.leerCampo(it, campo.soloSi.clave) !== campo.soloSi.valor) { return; }
      var caja = el("div", "campolab" + (campo.clase === "texto" ? " ancho" : ""));
      var ops = Escenarios.opcionesCampo(S.topologia, it, campo);
      var control;
      if (ops) {
        control = document.createElement("select");
        var elegida = -1;
        ops.forEach(function (o, k) { if (o.elegida && elegida < 0) { elegida = k; } });
        if (elegida < 0) {
          var actual = Escenarios.leerCampo(it, campo.clave);
          var o0 = document.createElement("option");
          o0.value = "";
          o0.textContent = actual === undefined || actual === null || actual === "" ? "— elegí —" : "«" + actual + "» (no corresponde)";
          control.appendChild(o0);
        }
        ops.forEach(function (o, k) {
          var op = document.createElement("option"); op.value = String(k); op.textContent = o.texto;
          if (k === elegida) { op.selected = true; }
          control.appendChild(op);
        });
        if (!ops.length) { control.disabled = true; }
        control.addEventListener("change", function () {
          if (control.value === "") { return; }
          empujarHistorial();
          Escenarios.aplicarParche(it, ops[Number(control.value)].parche);
          // Otro equipo: sus puertos, rutas o servicios son otros.
          Escenarios.completarItem(S.topologia, it, catalogo);
          cambioLab();
        });
      } else {
        control = document.createElement("input");
        control.type = ["prefijo", "puerto", "numero"].indexOf(campo.clase) >= 0 ? "number" : "text";
        var v = Escenarios.leerCampo(it, campo.clave);
        control.value = v === undefined || v === null ? "" : String(v);
        control.setAttribute("autocomplete", "off");
        if (campo.clase === "destino") {
          var dl = document.createElement("datalist");
          dl.id = idCampo("destinos-lab");
          Escenarios.sugerenciasDestino(S.topologia).forEach(function (s) {
            var o = document.createElement("option"); o.value = s.valor; o.label = s.texto; dl.appendChild(o);
          });
          caja.appendChild(dl);
          control.setAttribute("list", dl.id);
        }
        if (Escenarios.normalizarCampo(campo, control.value).error && control.value !== "") { control.classList.add("invalido"); }
        control.addEventListener("change", function () {
          var n = Escenarios.normalizarCampo(campo, control.value);
          if (n.error && control.value.trim() !== "") { control.classList.add("invalido"); avisar(n.error); return; }
          empujarHistorial();
          Escenarios.escribirCampo(it, campo.clave, n.error ? null : n.valor);
          cambioLab();
        });
      }
      caja.appendChild(etiqueta(campo.etiqueta, control));
      caja.appendChild(control);
      campos.appendChild(caja);
    });
    lado.appendChild(campos);
    if (problemas.length) { lado.appendChild(el("div", "", avisosHtml(problemas))); }
  }

  // Candidatos a miembro de un sector: equipos finales y puertos de router.
  function candidatosSector() {
    var lista = [];
    (S.topologia.dispositivos || []).forEach(function (d) {
      if (d.tipo === "internet" || d.tipo === "switch-l2" || d.tipo === "ap") { return; }
      if (d.tipo === "router") {
        (d.interfaces || []).forEach(function (f) { lista.push({ valor: d.id + ":" + f.id, texto: (d.nombre || d.id) + " " + f.id }); });
      } else {
        lista.push({ valor: d.id, texto: d.nombre || d.id });
      }
    });
    return lista;
  }

  function textoMiembro(m) {
    var t = String(m);
    var corte = t.indexOf(":");
    return corte >= 0 ? nombreDe(t.slice(0, corte)) + " " + t.slice(corte + 1) : nombreDe(t);
  }

  function editorDesafio(cuerpo, rev) {
    var sectores = sectoresLab(false);
    var caja = el("div", "recorrido");
    var cab = el("div", "cab", "<span>Sectores del desafío</span>");
    var bArmar = boton("Armar desde la red");
    bArmar.title = "Un sector por cada puerto de router con su LAN; después cargás los nombres y los hosts";
    bArmar.addEventListener("click", function () {
      var hallados = Escenarios.detectarSectores(S.topologia);
      if (!hallados.length) { avisar("No hay sectores para armar: conectá equipos a los puertos de un router."); return; }
      empujarHistorial();
      var esc = escenarioLab();
      delete esc.sectores;
      // Los equipos finales van por su nombre; los routers, por puerto.
      esc.requerimientos = hallados.map(function (s) {
        return { sector: s.sector, hosts: 0, dispositivos: s.dispositivos.map(function (m) {
          var id = m.split(":")[0];
          var d = buscarDisp(id);
          return d && d.tipo !== "router" ? id : m;
        }) };
      });
      cambioLab("Se armaron " + hallados.length + " sectores desde la red. Faltan los hosts de cada uno.");
    });
    var bAgregar = boton("+ Sector");
    bAgregar.addEventListener("click", function () {
      empujarHistorial();
      var arr = sectoresLab(true);
      arr.push({ sector: "Sector " + (arr.length + 1), hosts: 0, dispositivos: [] });
      cambioLab();
    });
    var botones = el("span", "botoneslab");
    botones.appendChild(bArmar); botones.appendChild(bAgregar);
    cab.appendChild(botones);
    caja.appendChild(cab);
    var lista = el("div", "pasos");
    if (!sectores.length) {
      lista.appendChild(el("p", "tenue", "Sin sectores: no es un desafío VLSM. Armalos desde la red o agregalos de a uno."));
    }
    var candidatos = candidatosSector();
    sectores.forEach(function (s, i) {
      var p = rev.sectores[i] || [];
      var fila = el("div", "labsector" + (p.length ? " conproblema" : ""));
      var inNom = document.createElement("input");
      inNom.type = "text"; inNom.className = "nomsector"; inNom.value = s.sector || s.nombre || "";
      inNom.setAttribute("aria-label", "Nombre del sector " + (i + 1));
      inNom.addEventListener("change", function () {
        empujarHistorial();
        if (s.nombre !== undefined && s.sector === undefined) { s.nombre = inNom.value.trim(); } else { s.sector = inNom.value.trim(); }
        cambioLab();
      });
      fila.appendChild(inNom);
      var inHosts = document.createElement("input");
      inHosts.type = "number"; inHosts.min = "0"; inHosts.className = "hosts"; inHosts.value = s.hosts || "";
      inHosts.setAttribute("aria-label", "Hosts que necesita el sector " + (i + 1));
      inHosts.addEventListener("change", function () {
        var n = parseInt(inHosts.value, 10);
        empujarHistorial();
        s.hosts = isNaN(n) || n < 0 ? 0 : n;
        cambioLab();
      });
      fila.appendChild(inHosts);
      fila.appendChild(el("span", "tenue", "hosts"));
      var miembros = s.dispositivos || s.equipos || [];
      miembros.forEach(function (m, k) {
        var ficha = boton(textoMiembro(m) + " ✕", "ficha");
        ficha.setAttribute("aria-label", "Sacar " + textoMiembro(m) + " del sector " + (i + 1));
        ficha.addEventListener("click", function () { empujarHistorial(); miembros.splice(k, 1); cambioLab(); });
        fila.appendChild(ficha);
      });
      var selM = document.createElement("select");
      selM.setAttribute("aria-label", "Agregar equipo o puerto al sector " + (i + 1));
      selM.innerHTML = "<option value=''>+ equipo o puerto</option>";
      candidatos.forEach(function (cand) {
        if (miembros.indexOf(cand.valor) >= 0) { return; }
        var o = document.createElement("option"); o.value = cand.valor; o.textContent = cand.texto; selM.appendChild(o);
      });
      selM.addEventListener("change", function () {
        if (!selM.value) { return; }
        empujarHistorial();
        if (!s.dispositivos && !s.equipos) { s.dispositivos = miembros; }
        miembros.push(selM.value);
        cambioLab();
      });
      fila.appendChild(selM);
      var bQ = boton("✕");
      bQ.setAttribute("aria-label", "Quitar el sector " + (i + 1));
      bQ.addEventListener("click", function () { empujarHistorial(); sectoresLab(false).splice(i, 1); cambioLab(); });
      fila.appendChild(bQ);
      lista.appendChild(fila);
      if (p.length) { lista.appendChild(el("div", "", avisosHtml(p))); }
    });
    caja.appendChild(lista);
    cuerpo.appendChild(caja);
    var lado = el("div", "lado formlab");
    var esc = S.topologia.escenario || {};
    var inB = document.createElement("input");
    inB.type = "text"; inB.placeholder = "p. ej. 10.45.7.0/24…";
    inB.value = esc.bloqueBase || esc.bloque || "";
    inB.addEventListener("change", function () {
      var v = inB.value.trim();
      if (v && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v)) { inB.classList.add("invalido"); avisar("Escribí el bloque como red/prefijo, por ejemplo 10.45.7.0/24."); return; }
      empujarHistorial();
      var e = escenarioLab();
      delete e.bloque;
      if (v) { e.bloqueBase = v; } else { delete e.bloqueBase; }
      cambioLab();
    });
    var campo = el("div", "campolab");
    campo.appendChild(etiqueta("Bloque a repartir", inB));
    campo.appendChild(inB);
    lado.appendChild(campo);
    if (rev.bloque) { lado.appendChild(el("div", "", avisosHtml([rev.bloque]))); }
    lado.appendChild(el("p", "tenue", "Armá la red con tu solución y probala. Al exportar para el alumno, la red sale " +
      "<b>sin direccionar</b>: se borran IP, máscaras, puertas de enlace, rutas, DHCP y DNS (la nube de Internet queda como está). " +
      "El alumno reparte el bloque entre los sectores y lo verifica en el modo Desafío."));
    cuerpo.appendChild(lado);
  }

  function celdaResultado(r) {
    if (!r) { return "<td>—</td>"; }
    return "<td class='" + (r.cumple ? "ok" : "mal") + "'" + (r.titulo ? " title=\"" + escapar(r.titulo) + "\"" : "") + ">" +
      (r.cumple ? "✓ cumple" : "✗ " + escapar(r.codigo && r.codigo !== "VALOR" ? r.codigo : (r.codigo === "VALOR" ? "otro valor" : "no cumple"))) + "</td>";
  }

  function verificarLaboratorio(cuerpo, rev) {
    var cmp = Escenarios.compararLaboratorio(S.topologia);
    var esc = S.topologia.escenario || {};
    var caja = el("div", "recorrido");
    var cab = el("div", "cab", "<span>Cada objetivo en la red sana (tu solución) y en la del alumno (con las fallas)</span>");
    caja.appendChild(cab);
    var lista = el("div", "pasos");
    if (!cmp.objetivos.length) {
      lista.appendChild(el("p", "tenue", "Sin objetivos para verificar."));
    } else {
      var tabla = el("table", "tablalab");
      tabla.innerHTML = "<thead><tr><th>Objetivo</th><th>Sana</th><th>Alumno</th></tr></thead>";
      var tb = document.createElement("tbody");
      cmp.objetivos.forEach(function (x, i) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td>" + (i + 1) + ". " + escapar(Escenarios.textoObjetivo(S.topologia, x.objetivo)) + "</td>" +
          celdaResultado(x.sana) + celdaResultado(x.alumno);
        tb.appendChild(tr);
      });
      tabla.appendChild(tb);
      lista.appendChild(tabla);
    }
    (esc.fallas || []).forEach(function (f, k) {
      var rotos = cmp.porFalla[k] || [];
      lista.appendChild(el("div", rotos.length ? "linpaso" : "linpaso tenue",
        "<b>Falla " + (k + 1) + "</b> · " + escapar(Escenarios.textoFalla(S.topologia, f)) + " → " +
        (rotos.length ? "rompe " + (rotos.length === 1 ? "el objetivo " : "los objetivos ") + rotos.map(function (n) { return n + 1; }).join(", ")
          : "no rompe ningún objetivo")));
    });
    caja.appendChild(lista);
    cuerpo.appendChild(caja);
    var lado = el("div", "lado formlab");
    var nRev = rev.fallas.concat(rev.objetivos, rev.sectores).filter(function (p) { return p.length; }).length + (rev.bloque ? 1 : 0);
    var avisos = cmp.advertencias.slice();
    if (nRev) { avisos.unshift(nRev + (nRev === 1 ? " ítem nombra" : " ítems nombran") + " algo que no está en la red o está incompleto: revisalos en su sección."); }
    if (cmp.desafio && !cmp.desafio.resumen.errores) { lado.appendChild(el("div", "linpaso", "<span class='marca'>✓</span>El diseño VLSM de tu solución cumple el desafío.")); }
    if (!avisos.length && (cmp.objetivos.length || cmp.desafio)) {
      lado.appendChild(el("div", "linpaso", "<span class='marca'>✓</span>El laboratorio está bien armado: en tu solución se cumple todo" +
        ((esc.fallas || []).length ? " y cada falla rompe al menos un objetivo." : ".")));
    } else if (!avisos.length) {
      lado.appendChild(el("p", "tenue", "Cargá fallas y objetivos (o los sectores de un desafío) para verificar el laboratorio."));
    }
    lado.appendChild(el("div", "", avisosHtml(avisos)));
    cuerpo.appendChild(lado);
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
    var cl = Red.clase(det.ip);
    if (cl) {
      var TIPO_IP = { privada: "privada", publica: "pública", cgnat: "compartida (CGNAT)", loopback: "loopback", apipa: "autoasignada (APIPA)" };
      var tipoIp = TIPO_IP[Red.clasificar(det.ip)];
      html += "<span>Clase</span><span>" + (cl.prefijoClasico
        ? "<b>" + cl.letra + "</b>" + (tipoIp ? " · " + tipoIp : "") + " <span class='tenue'>(con clases usaría /" + cl.prefijoClasico +
          "; hoy se usa CIDR: /" + det.prefijo + ")</span>"
        : "<b>" + cl.letra + "</b> <span class='tenue'>(" + (cl.letra === "D" ? "multicast" : "reservada") + ": no se asigna a equipos)</span>") +
        "</span>";
    }
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
    html += "<section><h3>¿Tu puerta de enlace está en tu red?</h3>";
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
      "<li>Arrastrá equipos desde la paleta, o abrí <i>Ejemplos…</i> o <i>Importar</i>.</li>" +
      "<li><i>Conectar con un cable</i> y clic en dos puertos.</li>" +
      "<li>Seleccioná cada equipo y cargá IP, máscara y puerta de enlace.</li>" +
      "<li>Probá con <i>Ping</i>: si falla, el recorrido dice dónde y por qué.</li>" +
      "<li><i>Verificar</i> revisa tu diseño y los objetivos del ejercicio.</li></ol>"));
    caja.appendChild(el("section", "",
      "<h3>Ideas clave</h3><ul>" +
      "<li>Cada equipo hace <b>«AND»</b> entre su máscara y las dos IP: misma red, entrega directa; si no, a la puerta de enlace.</li>" +
      "<li>La puerta de enlace va <b>en la misma red</b> que el equipo.</li>" +
      "<li>El switch no enruta: entre subredes hace falta un router.</li>" +
      "<li>El ping va y vuelve: la <b>respuesta</b> también necesita ruta.</li>" +
      "<li>/24 es 255.255.255.0: prefijo y máscara dicen lo mismo.</li></ul>"));
    caja.appendChild(el("section", "",
      "<h3>Topologías y alcance</h3><ul>" +
      "<li><b>Estrella:</b> todo pasa por un switch central.</li>" +
      "<li><b>Bus:</b> un medio compartido (acá, un hub).</li>" +
      "<li><b>Malla:</b> varios caminos entre nodos.</li>" +
      "<li><b>Anillo</b> y <b>árbol</b>: con los mismos equipos.</li>" +
      "<li>Alcance: <b>PAN</b>, <b>LAN</b>, <b>MAN</b>, <b>WAN</b>.</li></ul>" +
      "<p style='margin:2px 0 0'>Hay ejemplos de cada una en <i>Ejemplos…</i>.</p>"));
    caja.appendChild(el("section", "",
      "<h3>Teclado y mouse</h3><div class='teclas'>" +
      "<span><kbd>Ctrl</kbd>+<kbd>Z</kbd> · <kbd>Ctrl</kbd>+<kbd>Y</kbd></span><span>deshacer · rehacer</span>" +
      "<span><kbd>Supr</kbd></span><span>borra lo seleccionado</span>" +
      "<span><kbd>Esc</kbd></span><span>cancela</span>" +
      "<span><kbd>F</kbd></span><span>modo presentación</span>" +
      "<span>Fondo · <kbd>+</kbd> <kbd>−</kbd></span><span>mover la vista · zoom</span>" +
      "<span><kbd>Tab</kbd> y flechas</span><span>elegir y mover equipos</span>" +
      "<span><kbd>←</kbd> <kbd>→</kbd> en pestañas</span><span>cambiar de panel</span>" +
      "<span><kbd>Enter</kbd> en la paleta</span><span>agregar al centro</span>" +
      "<span>Punta del cable</span><span>clic en ella y en el puerto nuevo</span>" +
      "</div>"));
    var alcance = (Motor && Motor.UMBRAL_WIRELESS) || 250;
    caja.appendChild(el("section", "",
      "<h3>Qué simplifica el simulador</h3><ul>" +
      "<li>Rutas a mano (sin OSPF, BGP ni RIP); sin STP, VLAN ni IPv6.</li>" +
      "<li>NAT de salida y redirección de puertos; DHCP, un rango por router; wireless, sólo distancia (" + alcance + " m; la escala del dibujo es aproximada).</li>" +
      "<li>Reglas: red, protocolo, puerto y entrada.</li>" +
      "<li>TCP sin retransmisiones ni congestión; la QoS es latencia, jitter y pérdida por cable.</li>" +
      "<li>Sin colisiones en el hub; la captura no muestra ARP ni DHCP.</li>" +
      "<li>Internet: una sola para todas las nubes; jerarquía DNS y algunos sitios (IP ilustrativas).</li></ul>"));
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
    if (S.registro.length > 400) {
      S.registro.shift();
      S.registroDescartadas++;
    }
    if (typeof codigo === "string" && /^D\d/.test(codigo)) {
      consolaAgregar(codigo + " — " + texto, true);
    }
  }

  function textoRegistro() {
    var lineas = S.registro.slice();
    if (S.registroDescartadas > 0) {
      lineas.unshift("[AVISO] Registro truncado: se descartaron " + S.registroDescartadas +
        " entradas anteriores; sólo se conservan las últimas 400.");
    }
    return lineas.join("\n");
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
        cargarTopologiaAjustada(previo);
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
      cargarTopologiaAjustada(res.topologia);
      registrar("importar", "Topología importada: " + (res.topologia.nombre || "sin nombre") + ".");
    };
    lector.readAsText(archivo);
  }

  function descargarTexto(texto, nombreArchivo) {
    var blob = new Blob([texto], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombreArchivo;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function exportarActual() {
    try { descargarTexto(Escenarios.exportar(S.topologia), "topologia.json"); }
    catch (e) { registrar("exportar", "No se pudo exportar."); }
  }

  // Nombre de archivo a partir del nombre de la red: "Lab 1 — Un solo problema" → "lab-1-un-solo-problema".
  function nombreDeArchivo(texto) {
    var base = String(texto || "laboratorio").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return base || "laboratorio";
  }

  function exportarParaAlumnoActual() {
    var esc = S.topologia.escenario || {};
    var fallas = (esc.fallas || []).length;
    try {
      descargarTexto(Escenarios.exportarParaAlumno(S.topologia), nombreDeArchivo(S.topologia.nombre) + "-ALUMNO.json");
      var sectores = (esc.requerimientos || esc.sectores || []).length;
      var texto = "Se exportó la versión del alumno: " + fallas + (fallas === 1 ? " falla aplicada" : " fallas aplicadas") +
        " y " + (esc.objetivos || []).length + " objetivos, sin la lista de fallas" +
        (sectores ? "; desafío de " + sectores + " sectores, con la red sin direccionar." : ".");
      registrar("exportar", texto);
      avisar(texto);
    } catch (e) { registrar("exportar", "No se pudo exportar la versión del alumno: " + e.message); }
  }

  /* ---------------- API pública ---------------- */

  function actualizarBotonAlumno() {
    if (!S.botonAlumno) { return; }
    var escA = S.topologia.escenario;
    var hayLab = !!(escA && ((escA.fallas || []).length || (escA.objetivos || []).length ||
      (escA.requerimientos || escA.sectores || []).length));
    S.botonAlumno.hidden = S.modo !== "docente";
    S.botonAlumno.disabled = !hayLab;
    S.botonAlumno.title = hayLab ? "Baja la red con las fallas aplicadas y sin la lista de fallas (en un desafío, sin direccionar), para repartir"
      : "Esta red no tiene fallas, objetivos ni sectores: no es un laboratorio";
  }

  function renderTodo() {
    actualizarBotonAlumno();
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

  // Lo que abre el usuario (un ejemplo, un archivo importado, el trabajo
  // recuperado) aparece entero en la vista. cargarTopologia sola no mueve la
  // vista: la usa el Autotest para devolver la red tal como estaba.
  function cargarTopologiaAjustada(topologia) {
    cargarTopologia(topologia);
    ajustarVista();
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
    if (idDispositivo && idDispositivo !== S.seleccionado && claveDe(buscarDisp(idDispositivo)) === "firewall") {
      S.pestañaProps = "filtrado";
    }
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
    // Suma tramas a la captura activa, como cualquier ping o conexión; lo usa el Autotest.
    capturarTramas: capturarTramas,
    setModo: setModo,
    registrar: registrar
  };
})();
