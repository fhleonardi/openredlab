// Verifica el aviso de registro truncado: llena el registro más allá de sus 400
// entradas, exporta con el botón real y comprueba el archivo que se descarga.
// Uso: node herramientas/verificar-registro.js   (requiere Chrome instalado)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'openredlab-registro-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + perfil, '--window-size=1400,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const esperar = ms => new Promise(r => setTimeout(r, ms));
const EXTRA = 450;

(async () => {
  let pag;
  for (let i = 0; i < 50 && !pag; i++) { await esperar(200); try { pag = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(p => p.type === 'page'); } catch (e) {} }
  const ws = new WebSocket(pag.webSocketDebuggerUrl); let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  await new Promise(r => ws.onopen = r);
  const cmd = (method, params) => new Promise(r => { const n = ++id; pend[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluar = async expresion => { const r = await cmd('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expresion }); return r.result.result ? r.result.result.value : r.result; };

  await cmd('Page.enable'); await cmd('Page.navigate', { url }); await esperar(3000);

  // Carga un ejemplo y hace un ping real: "Exportar registro" sólo se habilita con un resultado.
  await evaluar(`(function(){
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
  await esperar(300);

  // Captura el Blob que genera "Exportar registro" sin descargar nada.
  await evaluar(`(function(){ window.__blobs = []; var orig = URL.createObjectURL;
    URL.createObjectURL = function(b){ window.__blobs.push(b); return orig.call(URL, b); }; return true; })()`);

  const exportar = `(async function(){
    var boton = Array.prototype.find.call(document.querySelectorAll('button'), function(b){ return b.textContent.trim() === 'Exportar registro'; });
    if (!boton) { return 'NO_BOTON'; }
    if (boton.disabled) { return 'BOTON_DESHABILITADO'; }
    window.__blobs = []; boton.click();
    await new Promise(function(r){ setTimeout(r, 100); });
    return window.__blobs.length ? await window.__blobs[window.__blobs.length - 1].text() : 'SIN_BLOB';
  })()`;

  // Línea base: el registro antes de la prueba, sin aviso (la página recién carga).
  const antes = await evaluar(exportar);
  if (/^(NO_BOTON|BOTON_DESHABILITADO|SIN_BLOB)$/.test(antes)) { console.log('FALLA: ' + antes); ws.close(); chrome.kill(); process.exit(1); }
  const previas = antes.split('\n').filter(function (l) { return l !== '' && l.indexOf('[AVISO]') !== 0; }).length;

  // Empuja 450 entradas numeradas con la función real de registro.
  await evaluar(`(function(){ for (var i = 0; i < ${EXTRA}; i++) { UI.registrar('prueba', 'entrada ' + i); } return true; })()`);

  const despues = await evaluar(exportar);
  const lineas = despues.split('\n');
  const esperadoDescartadas = previas + EXTRA - 400;
  const aviso = lineas[0];
  const contenido = lineas.slice(1);
  const marca = 'se descartaron ' + esperadoDescartadas + ' entradas anteriores';

  const fallos = [];
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
  ws.close(); chrome.kill(); process.exit(fallos.length ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
