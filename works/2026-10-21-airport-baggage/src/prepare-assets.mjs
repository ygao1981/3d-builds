import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(path.join(app, 'src/simready-assets.json'), 'utf8'));
const worker = JSON.parse(await readFile(path.join(app, 'src/cargo/worker-asset.json'), 'utf8'));
const argument = process.argv[2];
const localRoot = path.resolve(argument && !argument.startsWith('--') ? argument :
  process.env.SIMREADY_ROOT || path.join(app, '../../../../assets/simready'));
const destination = path.join(app, 'public/simready');

function verify(bytes, model) {
  if (bytes.length !== model.bytes || createHash('sha256').update(bytes).digest('hex') !== model.sha256) {
    throw new Error('模型校验失败：' + model.id);
  }
}

async function prepared(file, model) {
  try {
    verify(await readFile(file), model);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function prepare(model, file, localFile, url) {
  if (await prepared(file, model)) return true;
  if (argument === '--check' && model.optional) return false;
  if (argument === '--check') throw new Error('缺少 ' + model.id + '，请先运行 npm run assets。');
  let bytes;
  if (argument === '--download') {
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('下载 ' + model.id + ' 失败，HTTP ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    bytes = await readFile(localFile);
  }
  verify(bytes, model);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return prepared(file, model);
}

try {
  let checked=0;
  for (const model of manifest.models) {
    const url = manifest.source.datasetUrl + '/resolve/' + manifest.source.revision + '/' + model.file;
    if(await prepare(model,path.join(destination,path.basename(model.file)),path.join(localRoot,model.file),url))checked++;
  }
  console.log('已校验 ' + checked + ' 个 NVIDIA SimReady 模型。');
  if(checked<manifest.models.length)console.log('部分可选资产尚未就绪，可运行 npm run assets 补齐。');
  const localWorker = path.resolve(localRoot, '..', worker.libraryFile);
  const installed = await prepare(worker,path.join(app,'public',worker.file),localWorker,worker.url)
    .catch(error=>{if(error.code==='ENOENT')return false;throw error;});
  console.log(installed?'已校验 tevy 货站作业员模型。':'人物配套文件未就绪，可运行 npm run assets -- --download 补齐。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
