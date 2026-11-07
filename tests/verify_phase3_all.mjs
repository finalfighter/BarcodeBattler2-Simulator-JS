/* tests/verify_phase3_all.mjs — Phase 3 総合実行スクリプト */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeExe = process.execPath;

const suites = [
  'verify_phase3_c2.mjs',
  'verify_phase3_c1.mjs',
  'verify_phase3_state.mjs'
];

console.log('=== [Phase 3: ゲーム進行・状態遷移完全検証] 総合テスト開始 ===\n');

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
  console.log('=== [Phase 3: ゲーム進行・状態遷移完全検証] 全スイート合格 (不一致 0) ===');
} else {
  console.error('=== [Phase 3: ゲーム進行・状態遷移完全検証] エラーが発生しました ===');
  process.exit(1);
}
