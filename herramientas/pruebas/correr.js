// Corre las autopruebas de las capas 1 a 3 en Node, sin UI (vm).
// Uso: node herramientas/pruebas/correr.js
// También sirve de módulo: require('./correr.js') devuelve {Red, Motor, Escenarios}.
var fs = require('fs'), vm = require('vm'), path = require('path');
var RAIZ = path.resolve(__dirname, '..', '..');
var ctx = { console: console }; ctx.window = ctx; vm.createContext(ctx);
['capa1-red.js', 'capa2-motor.js', 'capa3-escenarios.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8') + '\n;this.Red=typeof Red!=="undefined"?Red:this.Red;this.Motor=typeof Motor!=="undefined"?Motor:this.Motor;this.Escenarios=typeof Escenarios!=="undefined"?Escenarios:this.Escenarios;', ctx, { filename: f });
});
module.exports = ctx;
if (require.main === module) {
  ['Red', 'Motor', 'Escenarios'].forEach(function (n) {
    if (ctx[n] && ctx[n].autopruebas) { var r = ctx[n].autopruebas(); console.log(n, JSON.stringify(r).slice(0, 2000)); }
  });
}
