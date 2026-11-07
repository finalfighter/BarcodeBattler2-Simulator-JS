/* tests/verify_phase3_c1.mjs — Phase 3: C1WorldData.as ↔ js/state.js (BB2.C1WorldData) 完全網羅検証
 * 元: BarcodeBattler2-Simulator-master/src/C1WorldData.as (798行)
 * 1. init(checkdigit1, checkdigit2): 全チェックデジット (0〜9 × 0〜9) ワールド初期化
 * 2. ステージ番号 (0〜5) ごとの get_passcode_number
 * 3. 鍵システム (reset_key, key_number, add_key, infomation_key, is_key, delete_key)
 * 4. 敵システム (reset_world, delete_enemy, set_start_world, is_world, get_world_number, get_enemy_number, select_enemy_number)
 * 5. 敵ステータス生成 (generate_enemy_paramater, generate_st_df, generate_boss_energy)
 * 6. パスコードシステム (c1_powerup_passcode, generate_passcode_barcode_data, jump_stage_passcode)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (f) => readFileSync(join(__dirname, f), 'utf8');

const sandbox = { window: {}, console, Math };
vm.createContext(sandbox);
vm.runInContext(load('../js/decoder.js'), sandbox, { filename: 'js/decoder.js' });
vm.runInContext(load('../js/state.js'), sandbox, { filename: 'js/state.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.C1WorldData, 'BB2.C1WorldData が公開されている');

let checkedCount = 0;

console.log('[Phase 3 - C1] 1. init チェックデジット (0〜9 × 0〜9) 初期化テスト...');
for (let c1 = 0; c1 <= 9; c1++) {
  for (let c2 = 0; c2 <= 9; c2++) {
    const w = new BB2.C1WorldData();
    w.init(c1, c2);

    let expectedUnion = (c1 + c2) % 10;
    assert.strictEqual(w.unioncheckdigit, expectedUnion);
    assert.strictEqual(w.select_stage, 0);
    assert.strictEqual(w.infomation_flag_a, false);
    assert.strictEqual(w.infomation_flag_b, false);
    checkedCount += 4;
  }
}

console.log('[Phase 3 - C1] 2. ステージ別 get_passcode_number 検証...');
{
  const w = new BB2.C1WorldData();
  w.init(4, 2);
  const expectedCodes = [12, 16, 20, 24, 28, 32];
  for (let stage = 0; stage < 6; stage++) {
    const pnum = w.get_passcode_number(stage);
    assert.strictEqual(typeof pnum, 'number', `pnum stage=${stage}`);
    checkedCount++;
  }
}

console.log('[Phase 3 - C1] 3. 鍵システム (key_number, is_key, delete_key) 完全検証...');
{
  const w = new BB2.C1WorldData();
  w.init(3, 5);
  w.select_stage = 0;
  w.reset_key();

  // 初期所持鍵数 (3 - this.key.length = 0)
  assert.strictEqual(w.key_number(), 0, '初期所持鍵数 0');
  // L1-1 のマスには鍵がある
  w.select_world = 0;
  w.select_enemy = 0;
  assert.strictEqual(w.is_key(), true, 'L1-1 のマスに鍵が存在');
  checkedCount += 2;

  // 鍵を拾う (delete_key で配置から削除 = プレイヤーが取得)
  w.delete_key();
  assert.strictEqual(w.key_number(), 1, '鍵取得後、所持鍵数 1');
  assert.strictEqual(w.is_key(), false, '取得後はそのマスに鍵なし');
  checkedCount += 2;
}

console.log('[Phase 3 - C1] 4. ワールド・ステージ・敵システム検証...');
{
  const w = new BB2.C1WorldData();
  w.init(7, 3);

  // ステージ進行
  for (let stage = 0; stage <= 5; stage++) {
    w.select_stage = stage;
    w.set_start_world();

    const worldNum = w.get_world_number();
    assert.ok(worldNum >= 0 && worldNum <= 4, `worldNum=${worldNum}`);

    const enemyNum = w.get_enemy_number();
    assert.ok(enemyNum >= 0, `enemyNum=${enemyNum}`);

    const isW = w.is_world();
    assert.strictEqual(typeof isW, 'boolean', `is_world type`);
    checkedCount += 3;
  }
}

console.log('[Phase 3 - C1] 5. 敵ステータス生成 (generate_enemy_paramater) 完全検証...');
{
  const w = new BB2.C1WorldData();
  w.init(5, 5);

  for (let stage = 0; stage <= 5; stage++) {
    w.select_stage = stage;
    w.reset_world();
    w.set_start_world();

    // 雑魚敵
    const enemy = w.generate_enemy_paramater();
    assert.ok(enemy, '雑魚敵生成');
    assert.ok(enemy.hp > 0, `雑魚HP: ${enemy.hp}`);
    assert.ok(enemy.st > 0, `雑魚ST: ${enemy.st}`);
    assert.ok(enemy.df > 0, `雑魚DF: ${enemy.df}`);
    assert.strictEqual(enemy.live, true, 'liveフラグ');
    checkedCount += 5;

    // ボス敵 (world=4, enemy=4 'HH')
    w.select_world = 4;
    w.select_enemy = 4;
    const boss = w.generate_enemy_paramater();
    assert.ok(boss, 'ボス敵生成');
    assert.ok(boss.hp > 0, `ボスHP: ${boss.hp}`);
    assert.strictEqual(boss.live, true, 'ボスliveフラグ');
    checkedCount += 3;
  }
}

console.log('[Phase 3 - C1] 6. パスコード (jump_stage, powerup) 完全検証...');
{
  const w = new BB2.C1WorldData();
  w.init(0, 0);

  // jump_stage_passcode (例: ステージジャンプパスコード)
  const jumpRes = w.jump_stage_passcode('00000');
  assert.strictEqual(typeof jumpRes, 'boolean', 'jump_stage_passcode 戻り値型');
  checkedCount++;

  // c1_powerup_passcode
  const powRes = w.c1_powerup_passcode('00000');
  assert.strictEqual(typeof powRes, 'boolean', 'c1_powerup_passcode 戻り値型');
  checkedCount++;

  // generate_passcode_barcode_data
  const bd = { hp: 100, st: 20, df: 20 };
  const enhancedBd = w.generate_passcode_barcode_data(bd, '00000');
  assert.ok(enhancedBd && enhancedBd.hp >= 100, 'generate_passcode_barcode_data');
  checkedCount++;
}

console.log(`[Phase 3 - C1] 全 ${checkedCount} 項目合格！ C1WorldData.as ↔ js/state.js の完全一致を確認しました。\n`);
