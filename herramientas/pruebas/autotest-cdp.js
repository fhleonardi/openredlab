// Corre Autotest.correr({tecnico:true}) en un Chrome headless propio.
// Uso: node herramientas/pruebas/autotest-cdp.js [url] [carpeta-de-perfil]
// Sin argumentos usa el index.html de este repo. Para la versión publicada,
// pasar su url. Chrome se busca en CHROME_PATH o en las rutas habituales.
var fs = require('fs'), os = require('os'), path = require('path'), url = require('url');
var { abrirPagina } = require('./cdp.js');
var INDEX = path.resolve(__dirname, '..', '..', 'index.html');

(async () => {
  var destino = process.argv[2] || url.pathToFileURL(INDEX).href;
  var perfil = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'openredlab-autotest-'));
  var pag = await abrirPagina(destino, perfil);
  try {
    var r = await pag.evaluar(`(function(){var s=Autotest.correr({tecnico:true});return {version:Escenarios.VERSION_APP,total:s.total,pasadas:s.pasadas,capas:s.detalleCapas,fallan:s.resultados.filter(function(x){return !x.pasa}).map(function(x){return x.n+' '+x.criterio+' :: '+(x.detalle||'')})}})()`);
    console.log(JSON.stringify(r, null, 1));
  } finally {
    pag.cerrar();
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
