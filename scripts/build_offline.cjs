const fs = require('node:fs');
const path = require('node:path');
const ts = require(process.env.TYPESCRIPT_JS);

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src');
const output = path.join(root, 'out');
fs.mkdirSync(output, { recursive: true });

for (const file of fs.readdirSync(source).filter(file => file.endsWith('.ts'))) {
  const result = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    reportDiagnostics: true
  });
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    for (const error of errors) {
      process.stderr.write(ts.flattenDiagnosticMessageText(error.messageText, '\n') + '\n');
    }
    process.exit(1);
  }
  fs.writeFileSync(path.join(output, file.replace(/\.ts$/, '.js')), result.outputText);
}

process.stdout.write(`Собрано ${fs.readdirSync(source).filter(file => file.endsWith('.ts')).length} файлов в out/\n`);
