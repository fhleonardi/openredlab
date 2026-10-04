// Compara el motor de una referencia de git (por defecto main) con el del disco:
// ping y Conectar TCP 80 desde cada equipo a cada IP de cada escenario.
// Uso: node herramientas/pruebas/diferencial.js [ref]
// escenarios-docente/ se usa sólo si existe (no se publica con el repo).
var fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');
var RAIZ = path.resolve(__dirname, '..', '..');
var ref = process.argv[2] || 'main';
function cargar(leer) {
  var ctx = { console: console }; ctx.window = ctx; vm.createContext(ctx);
  ['capa1-red.js', 'capa2-motor.js', 'capa3-escenarios.js'].forEach(function (f) {
    vm.runInContext(leer(f) + '\n;this.Red=typeof Red!=="undefined"?Red:this.Red;this.Motor=typeof Motor!=="undefined"?Motor:this.Motor;this.Escenarios=typeof Escenarios!=="undefined"?Escenarios:this.Escenarios;', ctx, { filename: f });
  });
  return ctx;
}
var viejo = cargar(function (f) { return cp.execFileSync('git', ['-C', RAIZ, 'show', ref + ':' + f], { encoding: 'utf8', maxBuffer: 1 << 26 }); });
var nuevo = cargar(function (f) { return fs.readFileSync(path.join(RAIZ, f), 'utf8'); });
var E = nuevo.Escenarios;
var lista = E.EJEMPLOS.map(function (e) { return { id: 'EJ:' + e.id, topo: e.topologia }; });
[path.join(RAIZ, 'escenarios'), path.join(RAIZ, 'escenarios-docente')].forEach(function (dir) {
  if (!fs.existsSync(dir)) { return; }
  fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
    var imp = E.importar(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (imp.ok) { lista.push({ id: 'JSON:' + f, topo: imp.topologia }); }
  });
});
var total = 0, difs = 0;
function resumen(r) { return (r.exito ? 'ok' : (r.diagnostico ? r.diagnostico.codigo : 'falla')); }
lista.forEach(function (x) {
  var ips = [];
  x.topo.dispositivos.forEach(function (d) { (d.interfaces || []).forEach(function (f) { if (f.ip) { ips.push(f.ip); } }); });
  ips.push('8.8.8.8', '201.2.2.99');
  x.topo.dispositivos.forEach(function (d) {
    if (d.tipo === 'switch-l2' || d.tipo === 'ap') { return; }
    ips.forEach(function (ip) {
      [['ping'], ['conectar']].forEach(function (op) {
        var a, b;
        var sv = viejo.Motor.crearEstado(JSON.parse(JSON.stringify(x.topo))), sn = nuevo.Motor.crearEstado(JSON.parse(JSON.stringify(x.topo)));
        if (op[0] === 'ping') { a = viejo.Motor.ping(sv, d.id, ip); b = nuevo.Motor.ping(sn, d.id, ip); }
        else { a = viejo.Motor.conectar(sv, d.id, ip, 'tcp', 80); b = nuevo.Motor.conectar(sn, d.id, ip, 'tcp', 80); }
        total++;
        if (resumen(a) !== resumen(b)) { difs++; console.log(x.id, op[0], (d.nombre || d.id), '->', ip, ':', resumen(a), '=>', resumen(b)); }
      });
    });
  });
});
console.log('casos:', total, 'diferencias:', difs);
