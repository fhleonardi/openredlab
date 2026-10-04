// Verifica el aviso de registro truncado: llena el registro más allá de sus 400
// entradas, exporta con el botón real y comprueba el archivo que se descarga.
// Uso: node herramientas/pruebas/verificar-registro.js   (requiere Chrome)
var fs = require('fs'), os = require('os'), path = require('path'), url = require('url');
var { abrirPagina } = require('./cdp.js');
var INDEX = path.resolve(__dirname, '..', '..', 'index.html');
var EXTRA = 450;

(async () => {
  var perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'openredlab-registro-'));
  var pag = await abrirPagina(url.pathToFileURL(INDEX).href, perfil);
  var fallos = [];
  try {
    // Carga un ejemplo y hace un ping real: "Exportar registro" sólo se habilita con un resultado.
    await pag.evaluar(`(function(){
      var ej = Escenarios.EJEMPLOS[0];
      UI.cargarTopologia(JSON.parse(JSON.stringify(ej.topologia)));
      var origen = ej.topologia.dispositivos.filter(function (d) { return d.tipo === 'pc'; })[0].id;
      var sel = Array.prototype.filter.call(document.querySelectorAll('select'), function (s) {
        return Array.prototype.some.call(s.options, function (o) { return o.value === origen; }); })[0];
      sel.value = origen; sel.dispatchEvent(new Event('change', { bubbles: true }));
      var input = document.querySelector('input[placeholder^="p. ej. 10.45.7.122"]');
      var fijar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      fijar.call(input, '10.45.7.122'); input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
    await new Promise(r => setTimeout(r, 300));

    // Captura el Blob que genera "Exportar registro" sin descargar nada.
    await pag.evaluar(`(function(){ window.__blobs = []; var orig = URL.createObjectURL;
      URL.createObjectURL = function(b){ window.__blobs.push(b); return orig.call(URL, b); }; return true; })()`);

    var exportar = `(async function(){
      var boton = Array.prototype.find.call(document.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Exportar registro'; });
      if (!boton) { return 'NO_BOTON'; }
      if (boton.disabled) { return 'BOTON_DESHABILITADO'; }
      window.__blobs = []; boton.click();
      await new Promise(function(r){ setTimeout(r, 100); });
      return window.__blobs.length ? await window.__blobs[window.__blobs.length - 1].text() : 'SIN_BLOB';
    })()`;

    // Línea base: el registro antes de la prueba, sin aviso (la página recién carga).
    var antes = await pag.evaluar(exportar);
    if (/^(NO_BOTON|BOTON_DESHABILITADO|SIN_BLOB)$/.test(antes)) { throw new Error(antes); }
    var previas = antes.split('\n').filter(function (l) { return l !== '' && l.indexOf('[AVISO]') !== 0; }).length;

    // Empuja entradas numeradas con la función real de registro.
    await pag.evaluar(`(function(){ for (var i = 0; i < ${EXTRA}; i++) { UI.registrar('prueba', 'entrada ' + i); } return true; })()`);

    var despues = await pag.evaluar(exportar);
    var lineas = despues.split('\n');
    var esperadoDescartadas = previas + EXTRA - 400;
    var aviso = lineas[0];
    var contenido = lineas.slice(1);
    var marca = 'se descartaron ' + esperadoDescartadas + ' entradas anteriores';

    if (aviso.indexOf('[AVISO] Registro truncado') !== 0) { fallos.push('falta el aviso en la primera línea'); }
    if (aviso.indexOf(marca) === -1) { fallos.push('el aviso no dice "' + marca + '": ' + aviso); }
    if (contenido.length !== 400) { fallos.push('quedaron ' + contenido.length + ' entradas, deberían ser 400'); }
    if (!/entrada 449$/.test(contenido[contenido.length - 1] || '')) { fallos.push('la última entrada no es "entrada 449"'); }
    if (!/entrada 50$/.test(contenido[0] || '')) { fallos.push('la primera entrada conservada no es "entrada 50"'); }

    if (fallos.length) {
      console.log('FALLA:\n - ' + fallos.join('\n - '));
    } else {
      console.log('OK: aviso con ' + esperadoDescartadas + ' descartadas, 400 entradas, de "entrada 50" a "entrada 449".');
    }
  } catch (e) {
    console.error('FALLA: ' + e.message);
    fallos.push(e.message);
  } finally {
    pag.cerrar();
  }
  process.exit(fallos.length ? 1 : 0);
})();
