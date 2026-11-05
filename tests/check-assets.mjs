/* tests/check-assets.mjs — index.html・css/style.css・js/*.js のテキストリテラルのアセット参照の存在を照合する
 * 実行: node tests/check-assets.mjs  (存在しない参照があれば exit 1)
 * 404 によるコンソールエラーの予防検査を目的とする。 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const paths = new Set();

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const p = m[1];
  if (!p || p.startsWith('http') || p.startsWith('#')) continue;
  paths.add(resolve(root, p));
}

const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
for (const m of css.matchAll(/url\("([^"]+)"\)/g)) {
  paths.add(resolve(root, 'css', m[1]));
}

/* js/textdisplay.js の 7 セグ CHAR_SRC 写し(assets/bb2digits/*.png 28 件)および js/view.js の SE_SRC(assets/se/*.mp3 16 件)を JS 中のリテラルから照合 */
for (const f of ['js/textdisplay.js', 'js/view.js']) {
  for (const m of readFileSync(resolve(root, f), 'utf8').matchAll(/["'](assets\/[^"']+\.(?:png|jpg|jpeg|gif|mp3))["']/g)) {
    paths.add(resolve(root, m[1]));
  }
}

/* Phase 7-2: assets/xml/list.xml と参照される全 21 XML、および初期カードリスト bb2.xml の全表裏画像(assets/barcode/bb2/*.jpg 52 件)を照合 */
const listXmlPath = resolve(root, 'assets/xml/list.xml');
paths.add(listXmlPath);
const listXml = readFileSync(listXmlPath, 'utf8');
for (const m of listXml.matchAll(/<xml>([^<]+)<\/xml>/g)) {
  paths.add(resolve(root, 'assets/xml', m[1].trim()));
}
const bb2Xml = readFileSync(resolve(root, 'assets/xml/bb2.xml'), 'utf8');
for (const m of bb2Xml.matchAll(/<(?:front_img|back_img)>([^<]+)<\/(?:front_img|back_img)>/g)) {
  paths.add(resolve(root, 'assets', m[1].trim()));
}

/* value="" と href 以外(空の img src 等)を除外: card_image の src="" は Phase 7 のため無参照可 */
const missing = [...paths].filter((p) => !existsSync(p));
if (missing.length) {
  console.error('missing assets:');
  missing.forEach((p) => console.error('  ' + p.replace(root + '/', '')));
  process.exit(1);
}
console.log('[check-assets] OK: ' + paths.size + ' 参照先すべて存在');
