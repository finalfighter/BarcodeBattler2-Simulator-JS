/* tests/verify_all_phases.mjs — Phase 1〜Phase 5 全フェーズ一括完全検証ランナー */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeExe = process.execPath;

const phases = [
  { name: 'Phase 1: 基礎演算・デコーダ完全検証', script: 'verify_phase1_all.mjs' },
  { name: 'Phase 2: 戦闘計算・合成完全検証', script: 'verify_phase2_all.mjs' },
  { name: 'Phase 3: ゲーム進行・状態遷移完全検証', script: 'verify_phase3_all.mjs' },
  { name: 'Phase 4: データ永続化・セーブ/ロード完全検証', script: 'verify_phase4_all.mjs' },
  { name: 'Phase 5: UI表示・演出・7セグLED完全検証', script: 'verify_phase5_all.mjs' }
];

console.log('===============================================================');
console.log('   バーコードバトラーII AS3 ↔ JS 完全網羅検算プロジェクト   ');
console.log('===============================================================\n');

let allPassed = true;
const startTime = Date.now();

for (const p of phases) {
  const file = join(__dirname, p.script);
  console.log(`\n###############################################################`);
  console.log(`▶ 実行中: [${p.name}] (${p.script})`);
  console.log(`###############################################################\n`);
  const ret = spawnSync(nodeExe, [file], { encoding: 'utf8', stdio: 'inherit' });
  if (ret.status !== 0) {
    console.error(`\n❌ FAILED: ${p.name} (exit code ${ret.status})`);
    allPassed = false;
    break;
  }
}

const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('\n===============================================================');
if (allPassed) {
  console.log(`🎉 全フェーズ (Phase 1〜5) 完全合格！ (総所要時間: ${elapsedSec} 秒)`);
  console.log('   ActionScript 3 版 ↔ JavaScript 版 の完全一致が証明されました。');
} else {
  console.error(`❌ 検証中に不一致・エラーが発生しました。`);
  process.exit(1);
}
console.log('===============================================================\n');
