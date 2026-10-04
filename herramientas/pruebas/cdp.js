// Ayudas para correr código en un Chrome headless propio, por CDP (puerto 9333).
// Chrome se busca en CHROME_PATH o en las rutas habituales de cada sistema.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUERTO = 9333;
const esperar = ms => new Promise(r => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_PATH) { return process.env.CHROME_PATH; }
  if (process.platform === 'win32') {
    const candidatos = [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    return candidatos.find(p => fs.existsSync(p)) || candidatos[0];
  }
  if (process.platform === 'darwin') { return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; }
  return 'google-chrome';
}

// Abre url en un Chrome headless con el perfil dado y devuelve
// { evaluar(expresion), cerrar() }. evaluar devuelve el valor de la expresión
// (awaitPromise incluido). Llamar a cerrar() siempre, aunque falle algo.
async function abrirPagina(url, perfil, esperaCarga = 3000) {
  const chrome = spawn(chromePath(),
    ['--headless=new', '--remote-debugging-port=' + PUERTO, '--user-data-dir=' + perfil, '--window-size=1400,900', '--no-first-run', 'about:blank'],
    { stdio: 'ignore' });
  let pag;
  for (let i = 0; i < 50 && !pag; i++) {
    await esperar(200);
    try { pag = (await (await fetch('http://127.0.0.1:' + PUERTO + '/json')).json()).find(p => p.type === 'page'); } catch (e) { /* aún no escucha */ }
  }
  if (!pag) { chrome.kill(); throw new Error('Chrome no abrió el puerto ' + PUERTO + ' (CHROME_PATH: ' + chromePath() + ')'); }

  const ws = new WebSocket(pag.webSocketDebuggerUrl);
  let id = 0; const pendientes = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (pendientes[d.id]) { pendientes[d.id](d); delete pendientes[d.id]; } };
  await new Promise(r => ws.onopen = r);
  const cmd = (method, params) => new Promise(r => { const n = ++id; pendientes[n] = r; ws.send(JSON.stringify({ id: n, method, params })); });

  await cmd('Page.enable');
  await cmd('Page.navigate', { url });
  await esperar(esperaCarga);

  return {
    evaluar: async expresion => {
      const r = await cmd('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: expresion });
      return r.result.result ? r.result.result.value : r.result;
    },
    cerrar: () => { ws.close(); chrome.kill(); }
  };
}

module.exports = { abrirPagina, chromePath };
