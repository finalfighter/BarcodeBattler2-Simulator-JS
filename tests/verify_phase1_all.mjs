/* tests/verify_phase1_all.mjs — Phase 1 総合実行スクリプト */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeExe = process.execPath;

const suites = [
  'verify_phase1_nes.mjs',
  'verify_phase1_bw.mjs',
  'verify_phase1_decoder.mjs'
];

console.log('=== [Phase 1: 基礎演算・デコーダ完全検証] 総合テスト開始 ===\n');

let allPassed = true;
for (const s of suites) {
  const file = join(__dirname, s);
  console.log(`>>> 実行中: ${s} ...`);
  const ret = spawnSync(nodeExe, [file], { encoding: 'utf8', stdio: 'inherit' });
  if (ret.status !== 0) {
    console.error(`FAILED: ${s} (exit code ${ret.status})`);
    allPassed = false;
    break;
  }
  console.log('');
}

if (allPassed) {
  console.log('=== [Phase 1: 基礎演算・デコーダ完全検証] 全スイート合格 (不一致 0) ===');
} else {
  console.error('=== [Phase 1: 基礎演算・デコーダ完全検証] エラーが発生しました ===');
  process.exit(1);
}
