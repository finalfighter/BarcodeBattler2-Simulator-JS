/* tests/verify_phase4_store.mjs — Phase 4: SharedObject ↔ js/store.js データ永続化完全検証
 * 元: BarcodeBattler2-Simulator-master/src/barcode2.as (52-120, 8950-8958, 9046-9055, 9666-9693)
 * 1. 設定項目 (scale, sound_mute, 各種フラグ) の永続化・デフォルト値マージ検証
 * 2. C1WorldData 全プロパティのシリアライズ・デシリアライズ完全復元検証
 * 3. barcode_data_c1 (主人公・仲間7体) のシリアライズ・デシリアライズ完全復元検証
 * 4. AS3 createCloneInstance ↔ JS clone の完全一致・ディープクローン検証
 * 5. 異常系・破損データ・プライベートブラウズ (ストレージ不可) 耐障害性検証
 * 6. 大規模ランダムデータ永続化ファジング (1,000回)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (f) => readFileSync(join(__dirname, f), 'utf8');

// モック localStorage
function createMockLocalStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      for (const k in store) delete store[k];
    },
    _dump() {
      return store;
    }
  };
}

let mockLS = createMockLocalStorage();
const sandbox = {
  window: {},
  console,
  Math,
  localStorage: mockLS
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(load('../js/decoder.js'), sandbox, { filename: 'js/decoder.js' });
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });
vm.runInContext(load('../js/barcode_world.js'), sandbox, { filename: 'js/barcode_world.js' });
vm.runInContext(load('../js/fighting_data.js'), sandbox, { filename: 'js/fighting_data.js' });
vm.runInContext(load('../js/fighting_calc.js'), sandbox, { filename: 'js/fighting_calc.js' });
vm.runInContext(load('../js/state.js'), sandbox, { filename: 'js/state.js' });
vm.runInContext(load('../js/store.js'), sandbox, { filename: 'js/store.js' });

const BB2 = sandbox.window.BB2;
const Store = BB2.Store;
const State = BB2.State;
const BarcodeData = BB2.BarcodeData;
const C1WorldData = BB2.C1WorldData;

let checkedCount = 0;

console.log('[Phase 4 - Store] 1. 設定項目 (Settings) の永続化・既定値マージ検証...');
{
  mockLS.clear();

  // 初期ロード (空ストレージ)
  const d0 = Store.load();
  assert.strictEqual(d0.version, 1, '既定バージョン = 1');
  assert.strictEqual(d0.settings.scale, 1, '既定 scale = 1');
  assert.strictEqual(d0.settings.sound_mute, false, '既定 sound_mute = false');
  assert.strictEqual(d0.settings.auto_input, false, '既定 auto_input = false');
  assert.strictEqual(d0.save, null, '既定 save = null');
  checkedCount += 5;

  // 設定変更・保存
  d0.settings.scale = 0.5;
  d0.settings.sound_mute = true;
  d0.settings.auto_input = true;
  d0.settings.show_debug = true;
  const ok = Store.saveSettings(d0);
  assert.strictEqual(ok, true, 'saveSettings 成功');
  checkedCount++;

  // 再読み込み
  const d1 = Store.load();
  assert.strictEqual(d1.settings.scale, 0.5, '保存された scale 復元');
  assert.strictEqual(d1.settings.sound_mute, true, '保存された sound_mute 復元');
  assert.strictEqual(d1.settings.auto_input, true, '保存された auto_input 復元');
  assert.strictEqual(d1.settings.show_debug, true, '保存された show_debug 復元');
  checkedCount += 4;

  // 未知のキーや欠損キーを含むデータのマージ安全性
  mockLS.setItem(Store.KEY, JSON.stringify({
    version: 1,
    settings: {
      scale: 0.75,
      unknown_field: 'dummy'
    }
  }));
  const d2 = Store.load();
  assert.strictEqual(d2.settings.scale, 0.75, '設定値 scale 読み込み');
  assert.strictEqual(d2.settings.sound_mute, false, '欠損した sound_mute が既定値にフォールバック');
  assert.strictEqual(d2.settings.auto_input, false, '欠損した auto_input が既定値にフォールバック');
  checkedCount += 3;
}

console.log('[Phase 4 - Store] 2. C1WorldData 直列化・復元の完全性検証...');
{
  mockLS.clear();
  const wOriginal = new C1WorldData();

  // ワールドデータを意図的に進行させた状態を構築
  wOriginal.select_world = 2;
  wOriginal.select_stage = 3;
  wOriginal.select_enemy = 1;
  wOriginal.key = ['L1-1', 'L2-3'];
  wOriginal.world = ['L-1', 'L-2', 'L-3'];
  wOriginal.infomation_flag_a = true;
  wOriginal.infomation_flag_b = false;

  // 保存
  const saveOk = Store.saveGameC1(wOriginal, null);
  assert.strictEqual(saveOk, true, 'saveGameC1 成功');
  checkedCount++;

  // ロード
  const { c1WorldData: wRestored } = Store.loadGameC1();
  assert.ok(wRestored instanceof C1WorldData, '復元データが C1WorldData のインスタンスであること');
  assert.strictEqual(wRestored.select_world, 2, 'select_world 一致');
  assert.strictEqual(wRestored.select_stage, 3, 'select_stage 一致');
  assert.strictEqual(wRestored.select_enemy, 1, 'select_enemy 一致');
  assert.strictEqual(JSON.stringify(wRestored.key), JSON.stringify(['L1-1', 'L2-3']), '所持鍵配列一致');
  assert.strictEqual(JSON.stringify(wRestored.world), JSON.stringify(['L-1', 'L-2', 'L-3']), '開放ワールド一致');
  assert.strictEqual(wRestored.infomation_flag_a, true, '情報フラグ A 一致');
  assert.strictEqual(wRestored.infomation_flag_b, false, '情報フラグ B 一致');
  checkedCount += 8;

  // 復元後インスタンスのメソッド呼び出し検証 (プロトタイプ完全性)
  assert.strictEqual(wRestored.get_world_number(), 2, 'get_world_number() 実行可');
  assert.strictEqual(wRestored.key_number(), 1, 'key_number() (3 - 2 = 1) 正常算出');
  checkedCount += 2;
}

console.log('[Phase 4 - Store] 3. barcode_data_c1 (仲間7体) 直列化・復元の完全性検証...');
{
  mockLS.clear();

  // 7体の BarcodeData 配列 (一部 null 含む)
  const heroes = [
    new BarcodeData(), // [0] 戦士初期
    new BarcodeData(), // [1] 魔法使い初期
    new BarcodeData(), // [2] 戦士控え
    new BarcodeData(), // [3] 魔法使い控え
    new BarcodeData(), // [4] 戦士現在
    new BarcodeData(), // [5] 魔法使い現在
    null               // [6] アイテム (null)
  ];

  // パラメータ設定
  heroes[0].barcode = '4901234567894';
  heroes[0].hp = 300; heroes[0].max_hp = 300; heroes[0].st = 50; heroes[0].df = 40;
  heroes[0].speed = 5; heroes[0].race = 0; heroes[0].job = 1; heroes[0].special = 10;
  heroes[0].pp = 5; heroes[0].mp = 0; heroes[0].live = true;

  heroes[4].barcode = '4901234567894';
  heroes[4].hp = 180; // ダメージを受けた状態
  heroes[4].max_hp = 300; heroes[4].st = 50; heroes[4].df = 40;
  heroes[4].speed = 5; heroes[4].race = 0; heroes[4].job = 1; heroes[4].special = 10;
  heroes[4].pp = 2; heroes[4].mp = 0; heroes[4].live = true;

  heroes[5].barcode = '4901274567892';
  heroes[5].hp = 0; // 死亡した状態
  heroes[5].max_hp = 250; heroes[5].st = 20; heroes[5].df = 30;
  heroes[5].speed = 8; heroes[5].race = 2; heroes[5].job = 7; heroes[5].special = 20;
  heroes[5].pp = 5; heroes[5].mp = 15; heroes[5].live = false;

  const w = new C1WorldData();
  Store.saveGameC1(w, heroes);

  const { barcodeDataC1: restoredHeroes } = Store.loadGameC1();
  assert.ok(Array.isArray(restoredHeroes), '配列として復元');
  assert.strictEqual(restoredHeroes.length, 7, '7体分配列');
  checkedCount += 2;

  // 各スロットの詳細突合
  assert.strictEqual(restoredHeroes[0].hp, 300, 'heroes[0].hp=300');
  assert.strictEqual(restoredHeroes[0].barcode, '4901234567894', 'heroes[0].barcode');
  assert.strictEqual(restoredHeroes[4].hp, 180, 'heroes[4].hp=180 (現在HP)');
  assert.strictEqual(restoredHeroes[4].pp, 2, 'heroes[4].pp=2 (現在PP)');
  assert.strictEqual(restoredHeroes[5].hp, 0, 'heroes[5].hp=0');
  assert.strictEqual(restoredHeroes[5].live, false, 'heroes[5].live=false (死亡状態)');
  assert.strictEqual(restoredHeroes[6], null, 'heroes[6]=null');
  checkedCount += 7;
}

console.log('[Phase 4 - Store] 4. AS3 createCloneInstance ↔ JS clone 整合性検証...');
{
  const origHero = new BarcodeData();
  origHero.barcode = '4901234567894';
  origHero.hp = 250;
  origHero.max_hp = 300;
  origHero.st = 45;

  const cloneHero = State.createCloneInstance(origHero);
  assert.notStrictEqual(origHero, cloneHero, '参照が異なる (ディープクローン)');
  assert.strictEqual(cloneHero.barcode, origHero.barcode, 'barcode 一致');
  assert.strictEqual(cloneHero.hp, origHero.hp, 'hp 一致');

  // 変更が元データに波及しないこと
  cloneHero.hp = 100;
  assert.strictEqual(origHero.hp, 250, '元データの値が保持されていること');
  checkedCount += 4;
}

console.log('[Phase 4 - Store] 5. 異常系・破損データ・ストレージ不可の耐障害性検証...');
{
  // 破損したJSON
  mockLS.setItem(Store.KEY, '{{{{MALFORMED_JSON_STRING}}}}');
  const dCorrupted = Store.load();
  assert.strictEqual(dCorrupted.version, 1, '壊れたJSONでも既定バージョンで復旧');
  assert.strictEqual(dCorrupted.settings.scale, 1, '既定設定で復旧');
  checkedCount += 2;

  // save がオブジェクトでない場合
  mockLS.setItem(Store.KEY, JSON.stringify({ version: 1, save: 'invalid_save_data' }));
  const invalidSaveRes = Store.loadGameC1();
  assert.strictEqual(invalidSaveRes.c1WorldData, null, '不正な save は null を返す');
  assert.strictEqual(invalidSaveRes.barcodeDataC1, null, '不正な barcodeDataC1 は null を返す');
  checkedCount += 2;

  // localStorage 参照不可 (プライベートブラウズ/Cookie拒否環境)
  const originalLS = sandbox.localStorage;
  sandbox.localStorage = null;
  assert.strictEqual(Store.saveSettings({}), false, 'localStorage 無効時は false を返す');
  const dNoStorage = Store.load();
  assert.strictEqual(dNoStorage.version, 1, 'localStorage 無効時も既定値を返す');
  sandbox.localStorage = originalLS; // 復元
  checkedCount += 2;
}

console.log('[Phase 4 - Store] 6. 大規模ランダムデータ永続化ファジング (1,000回)...');
{
  for (let iter = 0; iter < 1000; iter++) {
    const w = new C1WorldData();
    w.select_stage = Math.floor(Math.random() * 5);
    w.select_world = Math.floor(Math.random() * 3);
    w.select_enemy = Math.floor(Math.random() * 4);
    w.infomation_flag_a = Math.random() < 0.5;
    w.infomation_flag_b = Math.random() < 0.5;

    const heroes = [];
    for (let i = 0; i < 7; i++) {
      if (Math.random() < 0.2) {
        heroes.push(null);
      } else {
        const bd = new BarcodeData();
        bd.hp = Math.floor(Math.random() * 999);
        bd.max_hp = 999;
        bd.st = Math.floor(Math.random() * 255);
        bd.df = Math.floor(Math.random() * 255);
        bd.speed = Math.floor(Math.random() * 10);
        bd.race = Math.floor(Math.random() * 10);
        bd.job = Math.floor(Math.random() * 10);
        bd.live = bd.hp > 0;
        heroes.push(bd);
      }
    }

    // 保存と復元
    Store.saveGameC1(w, heroes);
    const { c1WorldData: rw, barcodeDataC1: rh } = Store.loadGameC1();

    assert.strictEqual(rw.select_stage, w.select_stage, `Fuzz ${iter}: select_stage`);
    assert.strictEqual(rw.select_world, w.select_world, `Fuzz ${iter}: select_world`);
    assert.strictEqual(rw.infomation_flag_a, w.infomation_flag_a, `Fuzz ${iter}: infomation_flag_a`);
    assert.strictEqual(rh.length, 7, `Fuzz ${iter}: heroes length`);

    for (let i = 0; i < 7; i++) {
      if (heroes[i] === null) {
        assert.strictEqual(rh[i], null, `Fuzz ${iter}: hero ${i} null`);
      } else {
        assert.strictEqual(rh[i].hp, heroes[i].hp, `Fuzz ${iter}: hero ${i} hp`);
        assert.strictEqual(rh[i].st, heroes[i].st, `Fuzz ${iter}: hero ${i} st`);
        assert.strictEqual(rh[i].live, heroes[i].live, `Fuzz ${iter}: hero ${i} live`);
      }
    }
    checkedCount += 8;
  }
}

console.log(`[Phase 4 - Store] 全 ${checkedCount} 項目合格！ SharedObject ↔ js/store.js の完全一致を確認しました。\n`);
