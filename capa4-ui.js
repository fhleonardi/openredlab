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
    vista: { x: 0, y: 0, k: 1 },
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
    abajo: null
  };

  var TIPOS = [
    { tipo: "pc", etiqueta: "PC" },
    { tipo: "router", etiqueta: "Router" },
    { tipo: "switch-l2", etiqueta: "Switch" },
    { tipo: "camara", etiqueta: "Cámara" },
    { tipo: "iot", etiqueta: "IoT" },
    { tipo: "ap", etiqueta: "Punto de acceso" }
  ];

  var PREFIJOS_NOMBRES = { pc: "PC-", router: "R", "switch-l2": "SW", camara: "CAM", iot: "IOT", ap: "AP-" };

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
    var prim = primeraIp(disp);
    if (!prim) { return ["sin IP"]; }
    var lineas = [prim.ip + "/" + prim.prefijo];
    if (disp.gateway) { lineas.push("gw " + disp.gateway); }
    return lineas;
  }

  function momentoRel() {
    var ms = Date.now() - S.inicioMs;
    var seg = Math.floor(ms / 1000);
    var dec = Math.floor((ms % 1000) / 100);
    var hh = String(Math.floor(seg / 3600)).padStart(2, "0");
    var mm = String(Math.floor((seg % 3600) / 60)).padStart(2, "0");
    var ss = String(seg % 60).padStart(2, "0");
    return "+" + hh + ":" + mm + ":" + ss + "." + dec;
  }

  function momentoAbs() {
    var d = new Date();
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
    ".simraiz{font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;display:flex;flex-direction:column;width:100%;max-width:100vw;height:100%;min-height:520px;overflow:hidden;background:var(--sim-fondo);color:var(--sim-texto);--sim-fondo:#f4f6f8;--sim-texto:#182430;--sim-panel:#ffffff;--sim-borde:#c9d3dc;--sim-acento:#0b5fa5;--sim-ok:#1a7f37;--sim-mal:#b42318;--sim-aviso:#8a5a00;}",
    ".simraiz.oscuro{--sim-fondo:#141a21;--sim-texto:#e8eef4;--sim-panel:#1e2833;--sim-borde:#3a4a5a;--sim-acento:#5aa9e6;--sim-ok:#4cc38a;--sim-mal:#f0726a;--sim-aviso:#e0a63c;}",
    ".simbarra{display:flex;gap:8px;align-items:center;padding:6px 10px;background:var(--sim-panel);border-bottom:1px solid var(--sim-borde);flex-wrap:wrap;}",
    ".simbarra .modos{display:flex;gap:4px;}",
    ".simbarra button,.simprop button,.siminf button,.simtools button{font:inherit;font-size:13px;padding:4px 10px;border:1px solid var(--sim-borde);border-radius:6px;background:var(--sim-panel);color:var(--sim-texto);cursor:pointer;}",
    ".simraiz button:focus-visible,.simraiz select:focus-visible,.simraiz input:focus-visible,.palitem:focus-visible,svg .nodo:focus-visible,svg .puerto:focus-visible{outline:3px solid var(--sim-acento);outline-offset:2px;}",
    ".simraiz button:hover,.simraiz select:hover{border-color:var(--sim-acento);}",
    ".simbarra button.activo,.siminf .tabs button.activo,.simprop .tabs button.activo{background:var(--sim-acento);color:#fff;border-color:var(--sim-acento);}",
    ".simcuerpo{flex:1;display:flex;min-height:0;}",
    ".simpaleta{width:180px;flex:0 0 180px;background:var(--sim-panel);border-right:1px solid var(--sim-borde);padding:8px;overflow:auto;}",
    ".simpaleta.colapsada{width:52px;flex-basis:52px;}",
    ".simpaleta.colapsada .etiqueta,.simpaleta.colapsada .titulopal,.simpaleta.colapsada .leyenda,.simpaleta.colapsada select{display:none;}",
    ".simpaleta h3{font-size:13px;margin:4px 0 8px;}",
    ".palitem{box-sizing:border-box;border:1px solid var(--sim-borde);border-radius:8px;padding:6px;margin-bottom:8px;text-align:center;cursor:grab;touch-action:none;user-select:none;}",
    ".palitem.armado{outline:2px solid var(--sim-acento);}",
    ".palitem svg{width:40px;height:40px;}",
    ".palitem .etiqueta{display:block;font-size:12px;line-height:1.15;min-height:1.15em;overflow-wrap:anywhere;}",
    ".simlienzo{flex:1;position:relative;min-width:0;background:var(--sim-fondo);}",
    ".simlienzo svg.lienzo{width:100%;height:100%;display:block;touch-action:none;}",
    ".simtools{position:absolute;top:8px;left:8px;display:flex;gap:4px;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:8px;padding:4px;}",
    ".simtools button{padding:2px 8px;}",
    ".simprop{width:295px;max-width:100%;flex:0 0 295px;background:var(--sim-panel);border-left:1px solid var(--sim-borde);overflow:auto;padding:8px;box-sizing:border-box;}",
    ".simprop.colapsado{display:none;}",
    ".simprop .tabs,.siminf .tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;}",
    ".simprop label{display:block;font-size:12px;margin:6px 0 2px;}",
    ".simprop input,.simprop select,.siminf input,.siminf select{font:inherit;font-size:13px;width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid var(--sim-borde);border-radius:6px;background:var(--sim-panel);color:var(--sim-texto);}",
    ".simprop input.invalido{border-color:var(--sim-mal);outline:2px solid var(--sim-mal);}",
    ".filaif{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 0;border-bottom:1px dotted var(--sim-borde);}",
    ".conmutador{margin-left:auto;}",
    ".siminf{height:260px;flex:0 0 260px;background:var(--sim-panel);border-top:1px solid var(--sim-borde);padding:8px;overflow:auto;}",
    ".siminf.colapsado{height:32px;flex-basis:32px;overflow:hidden;}",
    ".siminf .columnas{display:flex;gap:12px;}",
    ".siminf .col{flex:1;min-width:0;}",
    ".consola{background:#0d1117;color:#d6f0d6;font-family:ui-monospace,Consolas,monospace;font-size:12px;border-radius:8px;padding:8px;height:150px;overflow:auto;white-space:pre-wrap;}",
    ".paso{border:1px solid var(--sim-borde);border-radius:6px;padding:4px 8px;margin-bottom:4px;font-size:12px;}",
    ".paso.ok{border-left:6px solid var(--sim-ok);}",
    ".paso.mal{border-left:6px solid var(--sim-mal);background:rgba(180,35,24,.08);}",
    ".paso.fallo{outline:2px solid var(--sim-mal);}",
    ".diagnostico{border:2px solid var(--sim-mal);border-radius:8px;padding:8px;margin-top:8px;font-size:13px;}",
    ".advertencia{border:1px solid var(--sim-aviso);border-radius:8px;padding:6px;margin:6px 0;font-size:12px;}",
    ".binario{font-family:ui-monospace,Consolas,monospace;font-size:14px;letter-spacing:1px;}",
    ".binario .red{color:var(--sim-acento);font-weight:bold;}",
    ".binario .host{color:var(--sim-aviso);font-weight:bold;}",
    ".binario .corte{border-left:2px solid var(--sim-mal);}",
    ".calc{font-size:13px;}",
    ".calc .grid{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;}",
    "svg .nodo{cursor:pointer;}",
    "svg .puerto{cursor:pointer;stroke:#333;stroke-width:1;}",
    "svg text{font-family:system-ui,Arial,sans-serif;}",
    ".simraiz.presentacion .simpaleta,.simraiz.presentacion .simprop{display:none;}",
    "svg .fondoetq{fill:var(--sim-fondo);fill-opacity:.88;}",
    ".tooltip{position:absolute;pointer-events:none;background:var(--sim-panel);border:1px solid var(--sim-borde);border-radius:6px;padding:6px 8px;font-size:12px;max-width:260px;box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:5;}",
    "@media (max-width:900px){.simpaleta{width:140px;flex-basis:140px;}.simprop{width:240px;flex-basis:240px;}.simbarra{gap:5px;padding:5px 6px;}.simbarra button{padding:4px 7px;}}",
    "@media (max-width:640px){.simraiz{min-height:100%;overflow:auto;}.simbarra{align-items:stretch;}.simbarra .modos{width:100%;overflow:auto;}.simbarra select{min-width:0;flex:1;}.simcuerpo{flex-direction:column;}.simpaleta{width:auto;flex:0 0 auto;border-right:0;border-bottom:1px solid var(--sim-borde);display:flex;align-items:center;gap:6px;overflow-x:auto;padding:6px;}.simpaleta h3,.simpaleta .leyenda{display:none;}.palitem{box-sizing:border-box;flex:0 0 68px;height:70px;margin:0;padding:4px;}.palitem svg{width:30px;height:30px;}.palitem .etiqueta{font-size:10px;line-height:1.15;min-height:2.3em;}.simpaleta select{flex:0 0 100px;}.simpaleta button{flex:0 0 auto;}.simlienzo{height:70vh;min-height:600px;flex:0 0 70vh;}.simprop{width:auto;flex:0 0 auto;max-height:35vh;border-left:0;border-top:1px solid var(--sim-borde);}.siminf{height:auto;min-height:220px;flex-basis:auto;}.siminf .columnas{flex-direction:column;gap:8px;}}",
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

  function iniciar(contenedor, topologiaInicial) {
    inyectarCss();
    S.raiz = (typeof contenedor === "string") ? document.querySelector(contenedor) : contenedor;
    if (!S.raiz) { throw new Error("UI.iniciar: contenedor no encontrado"); }
    S.raiz.innerHTML = "";
    S.raiz.classList.add("simraiz");
    S.inicioMs = Date.now();

    var barra = el("div", "simbarra");
    var modos = el("div", "modos");
    [["topologia", "Topología"], ["subredes", "Subredes"], ["desafio", "Desafío"], ["docente", "Docente"]].forEach(function (par) {
      var b = el("button", par[0] === S.modo ? "activo" : "", escapar(par[1]));
      b.setAttribute("data-modo", par[0]);
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
    var bTema = el("button", "", "Tema oscuro");
    bTema.addEventListener("click", alternarTema);
    var bPres = el("button", "", "Presentación (F)");
    bPres.addEventListener("click", alternarPresentacion);
    var bImp = el("button", "", "Importar");
    bImp.addEventListener("click", importarPorArchivo);
    var bExp = el("button", "", "Exportar");
    bExp.addEventListener("click", exportarActual);
    barra.appendChild(bTema); barra.appendChild(bPres);
    barra.appendChild(bImp); barra.appendChild(bExp);
    S.raiz.appendChild(barra);

    var cuerpo = el("div", "simcuerpo");
    var pal = el("div", "simpaleta");
    pal.innerHTML = "<h3 class='titulopal'>Dispositivos</h3>";
    TIPOS.forEach(function (t) {
      var item = el("div", "palitem");
      item.setAttribute("data-tipo", t.tipo);
      item.innerHTML = "<svg viewBox='-24 -20 48 40'>" + icono(t.tipo) + "</svg>" +
        "<div class='etiqueta'>" + escapar(t.etiqueta) + "</div>";
      item.addEventListener("pointerdown", function (ev) { arrastrePaleta(ev, t.tipo, item); });
      item.addEventListener("click", function () { armarColocacion(t.tipo, item); });
      pal.appendChild(item);
    });
    var hz = el("h3", "titulopal", "Cable");
    pal.appendChild(hz);
    var selCable = document.createElement("select");
    selCable.innerHTML = "<option value='ethernet'>ethernet</option><option value='fibra'>fibra</option><option value='wireless'>wireless</option>";
    selCable.addEventListener("change", function () { S.cableTipo = selCable.value; S.herramientaCable = true; });
    pal.appendChild(selCable);
    var bCable = el("button", "", "Cable: clic en dos puertos (Esc cancela)");
    bCable.setAttribute("aria-pressed", "false");
    bCable.addEventListener("click", function () {
      S.herramientaCable = !S.herramientaCable; S.cableOrigen = null;
      bCable.classList.toggle("activo", S.herramientaCable);
      bCable.setAttribute("aria-pressed", String(S.herramientaCable));
      registrar("cable", S.herramientaCable ? "Herramienta de cable activada (" + S.cableTipo + ")." : "Herramienta de cable desactivada.");
      renderLienzo();
    });
    pal.appendChild(bCable);
    var ley = el("div", "leyenda", "<p style='font-size:11px'>Trazo lleno: cobre.<br>Con brillo: fibra.<br>Punteado curvo: wireless.</p>");
    pal.appendChild(ley);
    var bCol = el("button", "", "Colapsar");
    bCol.addEventListener("click", function () { pal.classList.toggle("colapsada"); });
    pal.appendChild(bCol);
    cuerpo.appendChild(pal);
    S.paleta = pal;

    var zona = el("div", "simlienzo");
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "lienzo");
    var mundo = document.createElementNS(svgNS, "g");
    var cEn = document.createElementNS(svgNS, "g");
    var cNo = document.createElementNS(svgNS, "g");
    var cAn = document.createElementNS(svgNS, "g");
    mundo.appendChild(cEn); mundo.appendChild(cNo); mundo.appendChild(cAn);
    svg.appendChild(mundo);
    zona.appendChild(svg);
    var tools = el("div", "simtools");
    [["deshacer", "Deshacer"], ["rehacer", "Rehacer"], ["menos", "−"], ["porc", "100%"], ["mas", "+"], ["ajustar", "Ajustar"]].forEach(function (par) {
      var b = el("button", "", par[1]);
      b.setAttribute("data-h", par[0]);
      b.setAttribute("aria-label", par[0] === "menos" ? "Alejar" : par[0] === "mas" ? "Acercar" : par[0] === "porc" ? "Restablecer zoom" : par[1]);
      b.addEventListener("click", function () { accionLienzo(par[0]); });
      tools.appendChild(b);
    });
    zona.appendChild(tools);
    var tip = el("div", "tooltip");
    tip.style.display = "none";
    zona.appendChild(tip);
    S.tooltip = tip;
    cuerpo.appendChild(zona);
    S.svg = svg; S.capaMundo = mundo; S.capaEnlaces = cEn; S.capaNodos = cNo; S.capaAnim = cAn;

    var prop = el("div", "simprop");
    cuerpo.appendChild(prop);
    S.prop = prop;
    S.raiz.appendChild(cuerpo);

    var inf = el("div", "siminf");
    S.raiz.appendChild(inf);
    S.inf = inf;

    cablearLienzo(zona, svg);
    document.addEventListener("keydown", atajos);

    var inicial = topologiaInicial ? clonar(topologiaInicial) : clonar(Escenarios.EJEMPLOS[0].topologia);
    S.topologia = inicial;
    reconstruirEstado();
    recontarNombres();
    aplicarVista();
    renderTodo();
    autoguardar();
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

  function aplicarVista() {
    S.capaMundo.setAttribute("transform",
      "translate(" + S.vista.x + " " + S.vista.y + ") scale(" + S.vista.k + ")");
  }

  function accionLienzo(cual) {
    if (cual === "deshacer") { deshacer(); return; }
    if (cual === "rehacer") { rehacer(); return; }
    if (cual === "mas") { S.vista.k = Math.min(3, S.vista.k * 1.2); }
    if (cual === "menos") { S.vista.k = Math.max(0.3, S.vista.k / 1.2); }
    if (cual === "porc") { S.vista.k = 1; S.vista.x = 0; S.vista.y = 0; }
    if (cual === "ajustar") { ajustarVista(); }
    aplicarVista();
  }

  function ajustarVista() {
    var lista = S.topologia.dispositivos || [];
    if (!lista.length) { S.vista = { x: 0, y: 0, k: 1 }; return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    lista.forEach(function (d) {
      minX = Math.min(minX, d.x); minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x); maxY = Math.max(maxY, d.y);
    });
    var rect = S.svg.getBoundingClientRect();
    var w = Math.max(200, maxX - minX + 200);
    var h = Math.max(200, maxY - minY + 200);
    var k = Math.min(rect.width / w, rect.height / h, 1.5);
    S.vista.k = Math.max(0.3, k);
    S.vista.x = rect.width / 2 - ((minX + maxX) / 2) * S.vista.k;
    S.vista.y = rect.height / 2 - ((minY + maxY) / 2) * S.vista.k;
    aplicarVista();
  }

  function aMundo(ev) {
    var rect = S.svg.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - S.vista.x) / S.vista.k,
      y: (ev.clientY - rect.top - S.vista.y) / S.vista.k
    };
  }

  function posicionPuerto(disp, indice, total) {
    var w = 56, h = 52;
    if (total === 1) { return { x: disp.x, y: disp.y - h / 2 }; }
    var porLado = Math.ceil(total / 2);
    if (indice < porLado) {
      return { x: disp.x - w / 2 + (indice + 0.5) * (w / porLado), y: disp.y - h / 2 };
    }
    var j = indice - porLado;
    return { x: disp.x - w / 2 + (j + 0.5) * (w / (total - porLado)), y: disp.y + h / 2 };
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
    var svgNS = "http://www.w3.org/2000/svg";
    while (S.capaEnlaces.firstChild) { S.capaEnlaces.removeChild(S.capaEnlaces.firstChild); }
    while (S.capaNodos.firstChild) { S.capaNodos.removeChild(S.capaNodos.firstChild); }
    var porId = {};
    (S.topologia.dispositivos || []).forEach(function (d) { porId[d.id] = d; });

    (S.topologia.enlaces || []).forEach(function (e) {
      var a = porId[e.a.dispositivo], b = porId[e.b.dispositivo];
      if (!a || !b) { return; }
      var g = document.createElementNS(svgNS, "g");
      var pa = puntoPuerto(a, e.a.interfaz);
      var pb = puntoPuerto(b, e.b.interfaz);
      var x1 = pa.x, y1 = pa.y, x2 = pb.x, y2 = pb.y;
      var dib;
      if (e.tipo === "wireless") {
        dib = document.createElementNS(svgNS, "path");
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 30;
        dib.setAttribute("d", "M" + x1 + " " + y1 + " Q" + mx + " " + my + " " + x2 + " " + y2);
        dib.setAttribute("fill", "none");
        dib.setAttribute("stroke-dasharray", "6 5");
      } else {
        dib = document.createElementNS(svgNS, "line");
        dib.setAttribute("x1", x1); dib.setAttribute("y1", y1);
        dib.setAttribute("x2", x2); dib.setAttribute("y2", y2);
      }
      dib.setAttribute("stroke", colorEnlace(e));
      dib.setAttribute("stroke-width", e.tipo === "fibra" ? 5 : 3);
      if (e.tipo === "fibra") { dib.setAttribute("opacity", "0.85"); dib.setAttribute("stroke-linecap", "round"); }
      g.appendChild(dib);
      var mid = document.createElementNS(svgNS, "text");
      mid.setAttribute("x", (x1 + x2) / 2 + 6); mid.setAttribute("y", (y1 + y2) / 2 - 6);
      mid.setAttribute("font-size", S.presentacion ? "15" : "12");
      mid.setAttribute("fill", colorEnlace(e));
      mid.textContent = e.id + (e.estado === "down" ? " (down)" : "");
      g.appendChild(mid);
      g.addEventListener("pointerenter", function (ev) { mostrarTipEnlace(ev, e); });
      g.addEventListener("pointerleave", ocultarTip);
      g.addEventListener("click", function () {
        S.seleccionado = null; S.enlaceSel = e.id; renderPropiedades();
      });
      S.capaEnlaces.appendChild(g);
    });

    var etiquetas = [];
    (S.topologia.dispositivos || []).forEach(function (d) {
      var g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "nodo");
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", (d.nombre || d.id) + ", dispositivo " + d.tipo);
      g.setAttribute("transform", "translate(" + d.x + " " + d.y + ")");
      if (S.seleccionado === d.id) {
        var halo = document.createElementNS(svgNS, "rect");
        halo.setAttribute("x", -34); halo.setAttribute("y", -32);
        halo.setAttribute("width", 68); halo.setAttribute("height", S.presentacion ? 140 : 124);
        halo.setAttribute("rx", 10);
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", "#0b5fa5");
        halo.setAttribute("stroke-width", 2);
        halo.setAttribute("stroke-dasharray", "5 3");
        g.appendChild(halo);
      }
      var cuerpo = document.createElementNS(svgNS, "g");
      cuerpo.innerHTML = icono(d.tipo);
      if (!d.encendido) { cuerpo.setAttribute("opacity", "0.4"); }
      g.appendChild(cuerpo);

      (d.interfaces || []).forEach(function (iface, idx) {
        var p = posicionPuerto({ x: 0, y: 0 }, idx, d.interfaces.length);
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
        g.appendChild(c);
      });

      // La etiqueta va después de los puertos: queda por encima en el orden
      // de dibujado y arranca debajo del borde inferior de los marcadores.
      etiquetas.push(crearEtiqueta(g, d));

      g.addEventListener("pointerenter", function (ev) { mostrarTipNodo(ev, d); });
      g.addEventListener("pointerleave", ocultarTip);
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (S.colocando) { return; }
        seleccionar(d.id);
      });
      g.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); seleccionar(d.id); }
      });
      g.addEventListener("pointerdown", function (ev) { arrastreNodo(ev, d, g); });
      S.capaNodos.appendChild(g);
    });
    resolverSolapes(etiquetas);
    aplicarVista();
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
    var escala = S.presentacion ? 1.25 : 1;
    var textos = [d.nombre || d.id].concat(lineasResumen(d));
    var lineas = textos.map(function (t, i) {
      var fondo = document.createElementNS(svgNS, "rect");
      fondo.setAttribute("class", "fondoetq");
      fondo.setAttribute("rx", 3);
      var txt = document.createElementNS(svgNS, "text");
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("fill", "currentColor");
      if (i === 0) { txt.setAttribute("font-weight", "600"); }
      txt.textContent = t;
      grupo.appendChild(fondo);
      grupo.appendChild(txt);
      return { fondo: fondo, texto: txt, tam: Math.round((i === 0 ? 16 : 14) * escala) };
    });
    g.appendChild(grupo);
    return { d: d, grupo: grupo, lineas: lineas, dy: 0, caja: null };
  }

  // Acomoda las líneas de una etiqueta y devuelve su caja relativa al nodo.
  // El ancho sale del texto real; si el lienzo no está visible y el
  // navegador no puede medir, se estima.
  function maquetarEtiqueta(e) {
    var y = ETIQUETA_TOP + e.dy, ancho = 0, pad = 3;
    e.lineas.forEach(function (l) {
      l.texto.setAttribute("font-size", l.tam);
      l.texto.setAttribute("y", Math.round(y + l.tam * 0.85));
      var w = 0;
      try { w = l.texto.getComputedTextLength(); } catch (err) { w = 0; }
      if (!w) { w = l.texto.textContent.length * l.tam * 0.58; }
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
    etiquetas.forEach(maquetarEtiqueta);
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
      if (otra && e.lineas.some(function (l) { return l.tam > ETIQUETA_MIN; })) {
        e.lineas.forEach(function (l) { l.tam = Math.max(ETIQUETA_MIN, l.tam - 2); });
        maquetarEtiqueta(e);
        otra = choca();
      }
      var vueltas = 0;
      while (otra && vueltas < 6) {
        e.dy += otra.y2 - cajaMundo(e).y1 + 2;
        maquetarEtiqueta(e);
        otra = choca();
        vueltas++;
      }
      ubicadas.push(e);
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
    S.tooltip.innerHTML = "<b>" + escapar(d.id + ":" + iface.id) + "</b><br>medio " +
      escapar(iface.medio) + "<br>" + (enl ? "enlace " + escapar(enl.id) : "puerto libre");
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
    }, { passive: false });
    zona.addEventListener("dragover", function (ev) { ev.preventDefault(); });
    zona.addEventListener("drop", function (ev) {
      ev.preventDefault();
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) { importarTextoDeArchivo(f); }
    });
    svg.addEventListener("click", function () {
      if (!S.herramientaCable && !S.colocando) { seleccionar(null); }
    });
  }

  function clicPuerto(d, iface) {
    if (!S.herramientaCable && !S.cableOrigen) { return; }
    if (!iface.habilitada) {
      registrar("D01", "La interfaz " + d.id + ":" + iface.id + " está deshabilitada.");
      S.cableOrigen = null;
      renderLienzo();
      return;
    }
    if (!S.cableOrigen) {
      S.cableOrigen = { dispositivo: d.id, interfaz: iface.id };
      registrar("cable", "Origen " + d.id + ":" + iface.id + ". Elegí el puerto destino.");
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
    if ((enlaceEnPuerto(o.dispositivo, o.interfaz) && !origenComparte) ||
      (enlaceEnPuerto(d.id, iface.id) && !destinoComparte)) {
      registrar("D02", "Ese puerto ya tiene cable. Elegí un puerto libre.");
      S.cableOrigen = null; renderLienzo(); return;
    }
    if (oi.medio !== S.cableTipo || iface.medio !== S.cableTipo) {
      registrar("D03", "Medios incompatibles: el enlace es " + S.cableTipo +
        " pero une " + oi.medio + " con " + iface.medio + ".");
      S.cableOrigen = null; renderLienzo(); return;
    }
    empujarHistorial();
    var n = (S.topologia.enlaces || []).length + 1;
    S.topologia.enlaces.push({
      id: idUnicoEnlace("l" + n),
      a: { dispositivo: o.dispositivo, interfaz: o.interfaz },
      b: { dispositivo: d.id, interfaz: iface.id },
      tipo: S.cableTipo, estado: "up", velocidadMbps: S.cableTipo === "fibra" ? 1000 : 100, retardoMs: 1
    });
    S.cableOrigen = null;
    reconstruirEstado(); renderLienzo(); renderPropiedades();
    registrar("cable", "Enlace creado entre " + o.dispositivo + ":" + o.interfaz + " y " + d.id + ":" + iface.id + ".");
  }

  function idUnicoEnlace(base) {
    var id = base, n = 1;
    var existe = function (x) { return !!buscarEnlace(x); };
    while (existe(id)) { n += 1; id = base + "-" + n; }
    return id;
  }

  function agregarDispositivo(tipo, x, y) {
    empujarHistorial();
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
    lista.push({
      id: id, tipo: tipo, nombre: nombre, x: gx, y: gy,
      encendido: true, interfaces: interfacesPorDefecto(tipo),
      gateway: null, dns: null, rutas: tipo === "router" ? [] : [], dhcp: null
    });
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
    if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); deshacer(); return; }
    if (mod && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) { ev.preventDefault(); rehacer(); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      var t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) { return; }
      ev.preventDefault(); borrarSeleccion(); return;
    }
    if (ev.key === "Escape") {
      S.colocando = null; S.cableOrigen = null; S.herramientaCable = false;
      renderLienzo(); return;
    }
    if (ev.key.toLowerCase() === "f" && !mod) {
      var a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) { return; }
      alternarPresentacion();
    }
  }

  function alternarPresentacion() {
    S.presentacion = !S.presentacion;
    S.raiz.classList.toggle("presentacion", S.presentacion);
    renderLienzo();
  }

  function alternarTema() {
    S.tema = (S.tema === "claro") ? "oscuro" : "claro";
    S.raiz.classList.toggle("oscuro", S.tema === "oscuro");
  }

  /* ---------------- Panel derecho ---------------- */

  function renderPropiedades() {
    var c = S.prop;
    c.innerHTML = "";
    if (S.enlaceSel && !S.seleccionado) {
      var e = buscarEnlace(S.enlaceSel);
      if (!e) { S.enlaceSel = null; }
      else {
        c.appendChild(el("h3", "", "Enlace " + escapar(e.id)));
        var bB = el("button", "", "Borrar enlace (Supr)");
        bB.addEventListener("click", borrarSeleccion);
        c.appendChild(bB);
        var lab = document.createElement("label");
        lab.textContent = "Estado";
        var sel = document.createElement("select");
        sel.innerHTML = "<option value='up'>up</option><option value='down'>down</option>";
        sel.value = e.estado;
        sel.addEventListener("change", function () { empujarHistorial(); e.estado = sel.value; reconstruirEstado(); renderLienzo(); });
        c.appendChild(lab); c.appendChild(sel);
        c.appendChild(el("p", "", "Tipo: " + escapar(e.tipo) + "<br>Velocidad: " + escapar(String(e.velocidadMbps)) + " Mbps<br>Retardo: " + escapar(String(e.retardoMs)) + " ms"));
        return;
      }
    }
    var d = S.seleccionado ? buscarDisp(S.seleccionado) : null;
    if (!d) {
      c.innerHTML = "<h3>Propiedades</h3><p style='font-size:12px'>Seleccioná un dispositivo del lienzo para configurarlo. Supr lo borra.</p>";
      return;
    }
    var tabs = el("div", "tabs");
    var nombres = [["config", "Configuración"], ["ifs", "Interfaces"], ["rutas", "Rutas"], ["dhcp", "DHCP"], ["estado", "Estado"]];
    if (d.tipo !== "router") {
      nombres = nombres.filter(function (p) { return p[0] !== "rutas" && p[0] !== "dhcp"; });
    }
    nombres.forEach(function (p) {
      var b = el("button", p[0] === S.pestañaProps ? "activo" : "", p[1]);
      b.addEventListener("click", function () { S.pestañaProps = p[0]; renderPropiedades(); });
      tabs.appendChild(b);
    });
    c.appendChild(tabs);
    c.appendChild(el("h3", "", escapar(d.nombre || d.id) + " <small>(" + escapar(d.tipo) + ")</small>"));

    if (S.pestañaProps === "config") { panelConfig(c, d); }
    else if (S.pestañaProps === "ifs") { panelInterfaces(c, d); }
    else if (S.pestañaProps === "rutas") { panelRutas(c, d); }
    else if (S.pestañaProps === "dhcp") { panelDhcp(c, d); }
    else { panelEstado(c, d); }

    var bBorrar = el("button", "", "Borrar dispositivo (Supr)");
    bBorrar.addEventListener("click", borrarSeleccion);
    c.appendChild(bBorrar);
  }

  function campoTexto(c, titulo, valor, alCambiar, validar) {
    var lab = document.createElement("label");
    lab.textContent = titulo;
    var inp = document.createElement("input");
    inp.value = valor === null || valor === undefined ? "" : String(valor);
    inp.addEventListener("input", function () {
      var ok = validar ? validar(inp.value) : true;
      inp.classList.toggle("invalido", !ok);
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
    var labIf = document.createElement("label");
    labIf.textContent = "Interfaz que se edita";
    c.appendChild(labIf); c.appendChild(selIf);
    var editada = buscarIface(d, selIf.value) || d.interfaces[0];
    selIf.addEventListener("change", function () {
      S.interfazEditada[d.id] = selIf.value;
      renderPropiedades();
    });
    if (!editada) { return; }

    var labModo = document.createElement("label");
    labModo.textContent = "Modo";
    var selModo = document.createElement("select");
    selModo.innerHTML = "<option value='estatico'>estática</option><option value='dhcp'>DHCP</option>";
    selModo.value = editada.modo || "estatico";
    selModo.addEventListener("change", function () {
      empujarHistorial(); editada.modo = selModo.value;
      if (selModo.value === "dhcp") { solicitarDhcp(d.id, editada.id); }
      reconstruirEstado(); renderTodo();
    });
    c.appendChild(labModo); c.appendChild(selModo);

    campoTexto(c, "Dirección IP", editada.ip || "", function (v) {
      editada.ip = v.trim() === "" ? null : v.trim();
      reconstruirEstado(); renderLienzo(); refrescarCalculo();
    }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); });

    var labM = document.createElement("label");
    labM.textContent = "Máscara (prefijo y decimal)";
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
    c.appendChild(labM); c.appendChild(selM);
    void habiles;

    if (d.tipo !== "switch-l2") {
      campoTexto(c, "Puerta de enlace predeterminada", d.gateway || "", function (v) {
        d.gateway = v.trim() === "" ? null : v.trim();
        reconstruirEstado(); renderLienzo(); refrescarCalculo();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); });
      campoTexto(c, "DNS", d.dns || "", function (v) {
        d.dns = v.trim() === "" ? null : v.trim();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); });
    }
    var labE = document.createElement("label");
    labE.textContent = "Encendido";
    var chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = !!d.encendido;
    chk.addEventListener("change", function () {
      empujarHistorial(); d.encendido = chk.checked; reconstruirEstado(); renderTodo();
    });
    c.appendChild(labE); c.appendChild(chk);
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
      fila.innerHTML = "<span><b>" + escapar(f.id) + "</b> · " + escapar(f.medio) +
        "<br>" + (enl ? "enlace " + escapar(enl.id) : "sin enlace") + "</span>";
      var sw = document.createElement("input");
      sw.type = "checkbox"; sw.className = "conmutador"; sw.checked = !!f.habilitada;
      sw.title = "Habilitada / deshabilitada (produce D01)";
      sw.addEventListener("change", function () {
        empujarHistorial(); f.habilitada = sw.checked;
        reconstruirEstado(); renderTodo();
        registrar(sw.checked ? "D01" : "D01", "Interfaz " + d.id + ":" + f.id + (sw.checked ? " habilitada." : " deshabilitada a propósito."));
      });
      fila.appendChild(sw);
      c.appendChild(fila);
    });
  }

  function panelRutas(c, d) {
    if (d.tipo !== "router") { c.appendChild(el("p", "", "Sólo los routers tienen tabla de rutas.")); return; }
    var tabla = el("div", "");
    (d.rutas || []).forEach(function (r, i) {
      var fila = el("div", "filaif", "<span>" + escapar(r.destino + "/" + r.prefijo) + " vía " + escapar(r.siguienteSalto || "directa") + "</span>");
      var b = el("button", "", "Quitar");
      b.addEventListener("click", function () { empujarHistorial(); d.rutas.splice(i, 1); reconstruirEstado(); renderPropiedades(); });
      fila.appendChild(b);
      tabla.appendChild(fila);
    });
    c.appendChild(tabla);
    var bDef = el("button", "", "Agregar ruta por defecto 0.0.0.0/0");
    bDef.addEventListener("click", function () {
      empujarHistorial();
      d.rutas.push({ destino: "0.0.0.0", prefijo: 0, siguienteSalto: "" });
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(bDef);
    var bUna = el("button", "", "Agregar ruta");
    bUna.addEventListener("click", function () {
      empujarHistorial();
      d.rutas.push({ destino: "10.0.0.0", prefijo: 24, siguienteSalto: "" });
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(bUna);
    (d.rutas || []).forEach(function (r) {
      campoTexto(c, "Destino", r.destino, function (v) { r.destino = v.trim(); reconstruirEstado(); }, function (v) { return Red.esIpValida(v.trim()); });
      campoTexto(c, "Prefijo (0–32)", String(r.prefijo), function (v) {
        var n = parseInt(v, 10);
        if (!isNaN(n)) { r.prefijo = n; reconstruirEstado(); }
      });
      campoTexto(c, "Siguiente salto", r.siguienteSalto || "", function (v) {
        r.siguienteSalto = v.trim() === "" ? null : v.trim(); reconstruirEstado();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); });
    });
  }

  function panelDhcp(c, d) {
    if (d.tipo !== "router") { c.appendChild(el("p", "", "Sólo los routers son servidores DHCP.")); return; }
    var cfg = d.dhcp || { habilitado: false, desde: "", hasta: "", prefijo: 24, gateway: "" };
    var chk = document.createElement("input");
    chk.type = "checkbox"; chk.checked = !!cfg.habilitado;
    var lab = document.createElement("label");
    lab.textContent = "Servidor habilitado";
    chk.addEventListener("change", function () {
      empujarHistorial(); cfg.habilitado = chk.checked; d.dhcp = cfg;
      reconstruirEstado(); renderPropiedades();
    });
    c.appendChild(lab); c.appendChild(chk);
    [["desde", "Desde"], ["hasta", "Hasta"], ["gateway", "Gateway que entrega"]].forEach(function (par) {
      campoTexto(c, par[1], cfg[par[0]] || "", function (v) {
        cfg[par[0]] = v.trim(); d.dhcp = cfg; reconstruirEstado();
      }, function (v) { return v.trim() === "" || Red.esIpValida(v.trim()); });
    });
    campoTexto(c, "Prefijo", String(cfg.prefijo === undefined ? 24 : cfg.prefijo), function (v) {
      var n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 32) { cfg.prefijo = n; d.dhcp = cfg; reconstruirEstado(); }
    });
    var conc = (S.estado && S.estado.concesiones && S.estado.concesiones[d.id]) || {};
    var claves = Object.keys(conc);
    c.appendChild(el("p", "", "<b>Concesiones otorgadas:</b> " + (claves.length ? escapar(claves.join(", ")) : "ninguna")));
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
        c.appendChild(el("p", "", "Advertencias preventivas apagadas en modo docente: el alumno debe descubrir el problema."));
      } else if (avisos.length) {
        avisos.forEach(function (a) {
          c.appendChild(el("div", "advertencia", "<b>" + escapar(a.codigo + " · " + a.titulo) + "</b><br>" +
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
    var barra = el("div", "tabs");
    [["simulacion", "Simulación"], ["dhcp", "DHCP"], ["calculo", "Cálculo de subred"], ["ayuda", "Ayuda"]].forEach(function (p) {
      var b = el("button", p[0] === S.pestañaInf ? "activo" : "", p[1]);
      b.addEventListener("click", function () { S.pestañaInf = p[0]; renderInferior(); });
      barra.appendChild(b);
    });
    var bCol = el("button", "", S.inf.classList.contains("colapsado") ? "Expandir" : "Colapsar");
    bCol.addEventListener("click", function () { S.inf.classList.toggle("colapsado"); renderInferior(); });
    barra.appendChild(bCol);
    var selV = document.createElement("select");
    selV.style.width = "auto";
    selV.innerHTML = "<option value='lenta'>lenta</option><option value='normal'>normal</option><option value='rapida'>rápida</option>";
    selV.value = S.velocidad;
    selV.title = "Velocidad de animación";
    selV.addEventListener("change", function () { S.velocidad = selV.value; });
    barra.appendChild(selV);
    c.appendChild(barra);
    if (S.inf.classList.contains("colapsado")) { return; }
    if (S.pestañaInf === "simulacion") { panelSimulacion(c); }
    else if (S.pestañaInf === "dhcp") { panelDhcpInf(c); }
    else if (S.pestañaInf === "calculo") { panelCalculo(c); }
    else { panelAyuda(c); }
  }

  function opcionesEquipos(sel, excluirSwitches) {
    (S.topologia.dispositivos || []).forEach(function (d) {
      if (excluirSwitches && d.tipo === "switch-l2") { return; }
      var op = document.createElement("option");
      op.value = d.id; op.textContent = (d.nombre || d.id) + " (" + d.id + ")";
      sel.appendChild(op);
    });
  }

  function panelSimulacion(c) {
    var cont = el("div", "columnas");
    var izq = el("div", "col");
    var selO = document.createElement("select");
    var selD = document.createElement("input");
    opcionesEquipos(selO);
    if (S.seleccionado) { selO.value = S.seleccionado; }
    selD.placeholder = "IP destino, p. ej. 10.45.7.122";
    selD.value = S.ultimoDestino || "";
    var bPing = el("button", "", "Ping");
    var bCopiar = el("button", "", "Copiar registro");
    var bExp = el("button", "", "Exportar registro");
    var bVer = el("button", "", "Verificar");
    var bAuto = el("button", "", "Autotest");
    izq.appendChild(el("p", "", "<b>Origen:</b>"));
    izq.appendChild(selO);
    izq.appendChild(el("p", "", "<b>Destino (IP):</b>"));
    izq.appendChild(selD);
    [bPing, bCopiar, bExp, bVer, bAuto].forEach(function (b) { izq.appendChild(b); });
    var cons = el("div", "consola", "La consola muestra el ping y el diagnóstico.\n");
    S.consola = cons;
    izq.appendChild(cons);
    var der = el("div", "col");
    der.innerHTML = "<b>Recorrido paso a paso</b>";
    var lista = el("div", "");
    S.listaPasos = lista;
    der.appendChild(lista);
    var diag = el("div", "");
    S.cajaDiag = diag;
    der.appendChild(diag);
    cont.appendChild(izq); cont.appendChild(der);
    c.appendChild(cont);

    bPing.addEventListener("click", function () {
      S.ultimoDestino = selD.value;
      if (!S.estado) { reconstruirEstado(); }
      var res;
      try { res = Motor.ping(S.estado, selO.value, selD.value.trim()); }
      catch (e) { registrar("error", "El ping falló por un error interno: " + e.message); return; }
      pintarPing(selO.value, selD.value.trim(), res);
      animarPing(res);
    });
    bCopiar.addEventListener("click", function () {
      var texto = S.registro.join("\n");
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(texto).then(function () {
            registrar("registro", "Registro copiado al portapapeles.");
          }).catch(function () { throw new Error("permiso de portapapeles"); });
        } else { throw new Error("sin portapapeles"); }
      } catch (e) {
        var ta = document.createElement("textarea");
        ta.value = texto; ta.rows = 8; ta.style.width = "100%";
        izq.appendChild(ta); ta.select();
        registrar("registro", "El portapapeles falló: el texto quedó seleccionado abajo.");
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
    bVer.addEventListener("click", function () { verificarActual(der); });
    bAuto.addEventListener("click", function () {
      var r1 = Red.autopruebas(), r2 = Motor.autopruebas(), r3 = Escenarios.autopruebas();
      var total = r1.total + r2.total + r3.total;
      var ok = r1.pasadas + r2.pasadas + r3.pasadas;
      cons.textContent += "Autotest: " + ok + "/" + total + " pruebas pasadas.\n";
      (r1.fallos.concat(r2.fallos).concat(r3.fallos)).slice(0, 10).forEach(function (f) {
        cons.textContent += "- " + f.nombre + "\n";
      });
      cons.scrollTop = cons.scrollHeight;
    });
  }

  function pintarPing(origen, destino, res) {
    var cons = S.consola;
    if (cons) {
      if (res.exito) {
        var r = res.respuestas[0] || { ttl: 64, ms: 1 };
        cons.textContent += "Respuesta desde " + destino + ": bytes=32 tiempo=" + r.ms + "ms TTL=" + r.ttl + "\n";
        cons.textContent += "Estadísticas: 1 enviados, 1 recibidos, 0 perdidos.\n";
      } else {
        cons.textContent += "El ping de " + origen + " a " + destino + " falló.\n";
        if (res.diagnostico) {
          cons.textContent += res.diagnostico.codigo + " · " + res.diagnostico.titulo + "\n";
        }
      }
      cons.scrollTop = cons.scrollHeight;
    }
    var lista = S.listaPasos;
    if (lista) {
      lista.innerHTML = "";
      var fallado = -1;
      (res.pasos || []).forEach(function (p, i) { if (!p.ok && fallado < 0) { fallado = i; } });
      (res.pasos || []).forEach(function (p, i) {
        var dv = el("div", "paso " + (p.ok ? "ok" : "mal") + (i === fallado ? " fallo" : ""),
          "<b>" + p.n + ". " + escapar(p.titulo) + "</b> " + (p.ok ? "✓" : "✗") +
          "<br>" + escapar(p.detalle || "").replace(/\n/g, "<br>"));
        lista.appendChild(dv);
      });
    }
    var diag = S.cajaDiag;
    if (diag) {
      diag.innerHTML = "";
      if (res.diagnostico) {
        diag.appendChild(el("div", "diagnostico",
          "<b>" + escapar(res.diagnostico.codigo + " · " + res.diagnostico.titulo) + "</b><br>" +
          escapar(res.diagnostico.explicacion) + "<br><i>" + escapar(res.diagnostico.sugerencia) + "</i>"));
      } else {
        diag.appendChild(el("p", "", "Ping exitoso: el eco volvió sin problemas."));
      }
    }
    registrar(res.exito ? "ping" : (res.diagnostico ? res.diagnostico.codigo : "ping"),
      "Ping " + origen + " → " + destino + ": " + (res.exito ? "éxito." : ("falla " + (res.diagnostico ? res.diagnostico.codigo : "") + ".")));
    renderLienzo(); renderPropiedades();
  }

  function verificarActual(donde) {
    var esc = S.topologia.escenario;
    if (!esc || !esc.objetivos) {
      donde.appendChild(el("p", "", "Esta topología no trae objetivos. Cargá el ejemplo docente para practicar."));
      return;
    }
    if (!S.estado) { reconstruirEstado(); }
    var res;
    try { res = Escenarios.verificarObjetivos(S.estado, esc.objetivos); }
    catch (e) { donde.appendChild(el("p", "", "No se pudo verificar: " + escapar(e.message))); return; }
    res.forEach(function (r) {
      donde.appendChild(el("div", "paso " + (r.cumple ? "ok" : "mal"),
        "<b>" + escapar(r.objetivo.origen + " → " + r.objetivo.destino) + "</b> " +
        (r.cumple ? "cumple ✓" : "no cumple ✗ " + escapar(r.codigo || ""))));
    });
  }

  /* Cálculo de subred atado al seleccionado, con binario en dos colores. */
  function panelCalculo(c) {
    c.appendChild(el("div", "", "<b>Cálculo de subred</b> <span style='font-size:12px'>— atado al dispositivo seleccionado, se actualiza mientras se escribe.</span>"));
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
    var html = "<p><b>Cálculo de subred — " + escapar(d.nombre || d.id) + "</b></p>";
    html += "<div class='grid'>";
    html += "<span>IP</span><span class='binario'>" + escapar(det.ip) + " &nbsp; Prefijo /" + det.prefijo + "</span>";
    html += "<span>Máscara</span><span class='binario'>" + escapar(det.mascaraDecimal) + "</span>";
    html += "</div>";
    html += "<p class='binario'>IP&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" + binarioColoreado(det.ipBinario, det.cortePosicion) + "<br>";
    html += "<span style='font-size:11px'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" +
      "bits de red".padEnd(det.bitsRed, "─") + "│" + "bits de host".padStart(det.bitsHost, "─") + "</span><br>";
    html += "Máscara&nbsp;&nbsp;" + binarioColoreado(det.mascaraBinaria, det.cortePosicion) + "</p>";
    html += "<div class='grid'>";
    html += "<span>Dirección de red</span><span>" + escapar(det.direccionDeRed) + "</span>";
    html += "<span>Broadcast</span><span>" + escapar(det.broadcast) + "</span>";
    html += "<span>Rango de hosts</span><span>" + escapar(det.rangoTexto || "—") + "</span>";
    html += "<span>Cantidad de hosts</span><span>" + escapar(String(det.cantidadHosts)) + "</span>";
    html += "</div>";
    if (det.advertencia) { html += "<div class='advertencia'>" + escapar(det.advertencia) + "</div>"; }
    html += "<p><b>¿Tu gateway está en tu subred?</b><br>";
    if (det.gateway) {
      html += "IP&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" + escapar(det.ip) + " AND máscara → " + escapar(det.gateway.andIp || "?") + "<br>";
      html += "Gateway " + escapar(det.gateway.ip) + " AND máscara → " + escapar(det.gateway.andGateway || "?") + "<br>";
      html += escapar(det.gateway.veredicto) + "</p>";
    } else { html += "Sin gateway configurado.</p>"; }
    caja.innerHTML = html;
  }

  function panelDhcpInf(c) {
    c.innerHTML = "";
    c.appendChild(el("div", "", "<b>DHCP</b> <span style='font-size:12px'>— la animación DORA ocurre sobre la topología del lienzo.</span>"));
    var selC = document.createElement("select");
    (S.topologia.dispositivos || []).forEach(function (d) {
      var op = document.createElement("option");
      op.value = d.id; op.textContent = (d.nombre || d.id);
      selC.appendChild(op);
    });
    if (S.seleccionado) { selC.value = S.seleccionado; }
    var selI = document.createElement("select");
    function cargarIfaces() {
      selI.innerHTML = "";
      var d = buscarDisp(selC.value);
      ((d && d.interfaces) || []).forEach(function (f) {
        var op = document.createElement("option");
        op.value = f.id; op.textContent = f.id;
        selI.appendChild(op);
      });
    }
    cargarIfaces();
    selC.addEventListener("change", cargarIfaces);
    var b = el("button", "", "Solicitar dirección (DORA)");
    var out = el("div", "");
    c.appendChild(selC); c.appendChild(selI); c.appendChild(b); c.appendChild(out);
    b.addEventListener("click", function () {
      if (!S.estado) { reconstruirEstado(); }
      var res;
      try { res = Motor.dhcpSolicitar(S.estado, selC.value, selI.value); }
      catch (e) { out.textContent = "Error: " + e.message; return; }
      S.topologia = clonar(S.estado.topologia);
      reconstruirEstado();
      var orden = { discover: 0, offer: 1, request: 2, ack: 3 };
      var msgs = (res.mensajes || []).slice().sort(function (a, b2) { return (orden[a.tipo] || 0) - (orden[b2.tipo] || 0); });
      out.innerHTML = msgs.map(function (m) {
        return "<div class='paso ok'><b>" + escapar(m.tipo) + "</b> " + escapar(m.origen) + " → " + escapar(m.destino) + "</div>";
      }).join("") + (res.exito
        ? "<p>Dirección otorgada: <b>" + escapar(res.ip + "/" + res.prefijo) + "</b> gateway " + escapar(res.gateway || "—") + ".</p>"
        : "<div class='diagnostico'><b>" + escapar(res.diagnostico ? res.diagnostico.codigo : "D16") + "</b> " +
          escapar(res.diagnostico ? res.diagnostico.explicacion : "") + "</div>");
      renderTodo();
      animarDhcp(res);
    });
  }

  function panelAyuda(c) {
    c.innerHTML = "<b>Ayuda</b>" +
      "<p><b>Ideas clave:</b> el sistema operativo decide con IP AND máscara; el gateway debe estar en tu subred; " +
      "el switch no mira IP y no enruta; la vuelta del ping también necesita camino; el prefijo es la fuente de verdad.</p>" +
      "<p><b>Simplificaciones declaradas:</b> sin STP ni bucles reales, sin enrutamiento dinámico (OSPF, BGP, RIP), " +
      "sin VLAN ni switch L3, sin NAT, sin HTTP, sin fragmentación, sin IPv6, sin TCP real, sin cifrado ni TLS, " +
      "sin QoS real, sin 802.1X y sin radiofrecuencia: el wireless es una abstracción por distancia.</p>" +
      "<p><b>Atajos:</b> Ctrl+Z deshacer, Ctrl+Y rehacer, Supr borra, Esc cancela, F presenta. Paneo: arrastrar el fondo o botón central.</p>";
    if (S.modo === "desafio" || (S.topologia.escenario && S.topologia.escenario.sectores)) {
      var b = el("button", "", "Verificar diseño VLSM");
      var out = el("div", "");
      c.appendChild(b); c.appendChild(out);
      b.addEventListener("click", function () {
        var inf;
        try { inf = Escenarios.verificarDesafio(S.topologia, S.topologia.escenario || {}); }
        catch (e) { out.textContent = "Error: " + e.message; return; }
        out.innerHTML = "<p>Errores: " + inf.resumen.errores + ", advertencias: " + inf.resumen.advertencias + ".</p>" +
          inf.porSector.map(function (s) {
            return "<div class='paso " + (s.ok ? "ok" : "mal") + "'><b>" + escapar(s.sector) + "</b> " + (s.ok ? "✓" : "✗") +
              "<br>" + s.hallazgos.map(function (h) { return escapar(h.nivel + ": " + h.mensaje); }).join("<br>") + "</div>";
          }).join("");
      });
    }
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

  function animarDhcp(resultado) {
    var miToken = ++S.animToken;
    limpiarAnim();
    var svgNS = "http://www.w3.org/2000/svg";
    var msgs = (resultado && resultado.mensajes) || [];
    if (!msgs.length) { return; }
    var i = 0;
    function siguiente() {
      if (miToken !== S.animToken) { return; }
      if (i >= msgs.length) { return; }
      limpiarAnim();
      var m = msgs[i];
      var o = buscarDisp(m.origen);
      var dt = (m.destino === "broadcast") ? null : buscarDisp(m.destino);
      if (m.destino === "broadcast" && o) {
        (S.topologia.dispositivos || []).forEach(function (d) {
          if (d.id === o.id) { return; }
          var l = document.createElementNS(svgNS, "line");
          l.setAttribute("x1", o.x); l.setAttribute("y1", o.y - 30);
          l.setAttribute("x2", d.x); l.setAttribute("y2", d.y - 30);
          l.setAttribute("stroke", "#0b5fa5"); l.setAttribute("stroke-width", 2);
          l.setAttribute("stroke-dasharray", "5 4");
          S.capaAnim.appendChild(l);
        });
        var t = document.createElementNS(svgNS, "text");
        t.setAttribute("x", o.x + 12); t.setAttribute("y", o.y - 36);
        t.setAttribute("font-size", "14"); t.textContent = m.tipo + " (difusión: así se ve un broadcast)";
        S.capaAnim.appendChild(t);
      } else if (o && dt) {
        var l2 = document.createElementNS(svgNS, "line");
        l2.setAttribute("x1", o.x); l2.setAttribute("y1", o.y - 30);
        l2.setAttribute("x2", dt.x); l2.setAttribute("y2", dt.y - 30);
        l2.setAttribute("stroke", "#1a7f37"); l2.setAttribute("stroke-width", 3);
        S.capaAnim.appendChild(l2);
        var t2 = document.createElementNS(svgNS, "text");
        t2.setAttribute("x", (o.x + dt.x) / 2 + 8); t2.setAttribute("y", (o.y + dt.y) / 2 - 34);
        t2.setAttribute("font-size", "14"); t2.textContent = m.tipo;
        S.capaAnim.appendChild(t2);
      }
      registrar("dhcp", "DORA sobre el lienzo: " + m.tipo + " " + m.origen + " → " + m.destino + ".");
      i += 1;
      setTimeout(siguiente, msVelocidad());
    }
    siguiente();
  }

  function solicitarDhcp(idDisp, idIf) {
    if (!S.estado) { reconstruirEstado(); }
    var res;
    try { res = Motor.dhcpSolicitar(S.estado, idDisp, idIf); }
    catch (e) { registrar("D16", "DHCP falló: " + e.message); return res; }
    S.topologia = clonar(S.estado.topologia);
    reconstruirEstado(); renderTodo();
    animarDhcp(res);
    return res;
  }

  /* ---------------- Registro, persistencia, importar/exportar ---------------- */

  function registrar(codigo, texto) {
    var linea = "[" + momentoAbs() + " " + momentoRel() + "] " + codigo + " — " + texto;
    S.registro.push(linea);
    if (S.registro.length > 400) { S.registro.shift(); }
    if (S.consola && (codigo === "ping" || (typeof codigo === "string" && codigo[0] === "D"))) {
      S.consola.textContent += linea + "\n";
      S.consola.scrollTop = S.consola.scrollHeight;
    }
  }

  function autoguardar() {
    function guardar() {
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
        if (imp.ok) { S.topologia = imp.topologia; reconstruirEstado(); }
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
      botones[i].classList.toggle("activo", botones[i].getAttribute("data-modo") === S.modo);
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

  function seleccionar(idDispositivo) {
    S.seleccionado = idDispositivo;
    S.enlaceSel = null;
    renderLienzo();
    renderPropiedades();
    refrescarCalculo();
  }

  function setModo(modo) {
    S.modo = modo;
    if (modo === "subredes") { S.pestañaInf = "calculo"; }
    else if (modo === "desafio") { S.pestañaInf = "ayuda"; }
    else { S.pestañaInf = "simulacion"; }
    renderTodo();
    registrar("modo", "Modo " + modo + ". La topología cargada no cambió." +
      (modo === "docente" ? " Advertencias preventivas apagadas." : ""));
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
