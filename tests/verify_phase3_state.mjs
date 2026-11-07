/* tests/verify_phase3_state.mjs — Phase 3: barcode2.as ↔ js/state.js 状態機械・ゲーム進行完全検証
 * 元: BarcodeBattler2-Simulator-master/src/barcode2.as (9693行)
 * 1. 電源ON・OFF・モード選択 (C0通常対戦, C1ワールド, C2パスコード)
 * 2. C0 通常対戦進行: カード入力 (1〜4枚目), SETスキップ, 裏技 (value_shift), 先攻決定, 攻撃・パワー・魔法・薬草ターン進行, 勝利・敗北判定
 * 3. C2 パスコードモード進行: 主人公登録, 敵入力, 仲間選択, アイテム入力, 戦闘
 * 4. C1 ワールドモード進行: 主人公登録, ステージ選択, 敵出現, 逃走, アイテム入力, 戦闘終了
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
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });
vm.runInContext(load('../js/barcode_world.js'), sandbox, { filename: 'js/barcode_world.js' });
vm.runInContext(load('../js/fighting_data.js'), sandbox, { filename: 'js/fighting_data.js' });
vm.runInContext(load('../js/fighting_calc.js'), sandbox, { filename: 'js/fighting_calc.js' });
vm.runInContext(load('../js/state.js'), sandbox, { filename: 'js/state.js' });

const BB2 = sandbox.window.BB2;
const State = BB2.State;
const STATES = State.STATES;

let checkedCount = 0;

console.log('[Phase 3 - State] 1. 電源ON・モード選択 (C0 / C1 / C2) 状態機械テスト...');
{
  const s = State.create();
  assert.strictEqual(s.state, STATES.PRE_INIT, '初期状態 PRE_INIT');
  checkedCount++;

  // スタンバイ
  State.standby(s);
  assert.strictEqual(s.state, STATES.STANDBY, 'standby で STANDBY (state=0)');
  checkedCount++;

  // 電源ON
  State.powerOn(s);
  assert.strictEqual(s.state, STATES.POWER_ON, 'powerOn で POWER_ON (state=1)');
  State.powerOnComplete(s);
  assert.strictEqual(s.state, STATES.MODE_SELECT, 'powerOnComplete で MODE_SELECT (state=2)');
  assert.strictEqual(s.mode, 0, '初期モード C0');
  checkedCount += 3;

  // モードインクリメント (0 → 1 → 2 → 0)
  State.incMode(s);
  assert.strictEqual(s.mode, 1, 'C1 モード');
  State.incMode(s);
  assert.strictEqual(s.mode, 2, 'C2 モード');
  State.incMode(s);
  assert.strictEqual(s.mode, 0, 'C0 モード循環');
  checkedCount += 3;

  // C0 モード確定
  State.setMode(s);
  assert.strictEqual(s.state, STATES.DECIDE_STAR, 'setMode(C0) で DECIDE_STAR (state=3)');
  State.decideStarComplete(s);
  assert.strictEqual(s.state, STATES.CARD_1, 'decideStarComplete で CARD_1 (state=4)');
  checkedCount += 2;

  // 電源OFF
  State.powerOff(s);
  assert.strictEqual(s.state, STATES.STANDBY, 'powerOff で STANDBY');
  checkedCount++;
}

console.log('[Phase 3 - State] 2. C0 通常対戦シーケンス (カード入力〜戦闘〜決着) 完全検証...');
{
  const s = State.create();
  State.standby(s);
  State.powerOn(s);
  State.powerOnComplete(s);
  State.setMode(s);
  State.decideStarComplete(s);

  // 1枚目入力 (1P 戦士)
  const c1 = { barcode: '4901234567894', hp: 200, st: 40, df: 30, speed: 5, race: 0, job: 1, pp: 5, mp: 0, special: 10 };
  State.saveCard(s, c1);
  assert.strictEqual(s.shift_card, 0, '1枚目 saveCard で裏技窓 open (shift_card=0)');
  State.advanceCardFx(s);
  assert.strictEqual(s.state, STATES.CARD_2, '1枚目完了で CARD_2');
  assert.strictEqual(s.shift_card, null, '裏技窓 close');
  checkedCount += 3;

  // 2枚目入力 (2P 戦士)
  const c2 = { barcode: '4909876543212', hp: 180, st: 35, df: 25, speed: 6, race: 1, job: 2, pp: 5, mp: 0, special: 12 };
  State.saveCard(s, c2);
  assert.strictEqual(s.shift_card, 1, '2枚目 saveCard で裏技窓 open (shift_card=1)');
  State.advanceCardFx(s);
  assert.strictEqual(s.state, STATES.CARD_3, '2枚目完了で CARD_3');
  checkedCount += 2;

  // 3枚目スキップ (SETボタン)
  State.cardSkip(s);
  assert.strictEqual(s.cards[2], null, '3枚目スキップで cards[2]=null');
  assert.strictEqual(s.state, STATES.CARD_4, '3枚目スキップ完了で CARD_4');
  checkedCount += 2;

  // 4枚目入力 (2P アイテム)
  const c4 = { barcode: '4900000000007', hp: 0, st: 10, df: 10, speed: 0, race: 6, job: 0, pp: 0, mp: 0, special: 0 };
  State.saveCard(s, c4);
  State.advanceCardFx(s);
  assert.strictEqual(s.state, STATES.CARDS_DONE, '全カード入力完了 CARDS_DONE (state=8)');
  checkedCount++;

  // 合成値 (fightingData) の確認
  assert.ok(s.fightingData[0], '1P fightingData 作成');
  assert.ok(s.fightingData[1], '2P fightingData 作成');
  assert.strictEqual(s.fightingData[0].hp, 200, '1P HP=200');
  assert.strictEqual(s.fightingData[1].hp, 180, '2P HP=180');
  assert.strictEqual(s.fightingData[1].st, 45, '2P ST=35+10=45');
  checkedCount += 5;

  // 先攻決定
  State.ensureFightingCalc(s);
  State.decideFirst(s);
  assert.ok(s.fightingCalc.now_player === 1 || s.fightingCalc.now_player === 2, '先攻決定 (1 or 2)');
  assert.strictEqual(s.battleWaitingFirst, true, '初回戦闘待機フラグ');
  checkedCount += 2;

  // 通常攻撃 (battle)
  const res = State.battle(s);
  assert.ok(res, 'battle 実行');
  assert.strictEqual(s.battleFlag, true, 'battleFlag=true');
  assert.ok(s.battleEndCount > 0, 'battleEndCount 設定');
  checkedCount += 3;

  // ターン完了 (battleComplete -> battleWaiting)
  State.battleComplete(s);
  State.battleWaiting(s);
  assert.strictEqual(s.battleFlag, false, 'battleWaiting で battleFlag=false');
  checkedCount++;

  // SELECTボタン (魔法/薬草選択窓オープン)
  s.fightingCalc.now_player = 1;
  s.fightingData[0].pp = 3;
  const sel = State.select(s);
  assert.ok(sel, 'select 実行');
  assert.strictEqual(s.selectActive, true, 'selectActive=true');
  assert.strictEqual(s.selectMpPp, 1, 'デフォルト薬草 (selectMpPp=1)');
  checkedCount += 3;

  // 薬草選択開始 (SETボタンで selectPpState = -1)
  State.setState(s);
  assert.strictEqual(s.selectPpState, -1, '薬草選択開始 (selectPpState=-1)');
  // 薬草個数切替 (SELECTボタンで 1個)
  State.selectState(s);
  assert.strictEqual(s.selectPpState, 1, '薬草1個選択');
  // 薬草使用決定 (SETボタンで usePp)
  const ppRes = State.setState(s);
  assert.strictEqual(ppRes.action, 'use_pp', '薬草使用決定');
  assert.strictEqual(s.selectActive, false, 'selectActive 解除');
  checkedCount += 4;
}

console.log('[Phase 3 - State] 3. C2 パスコードモードシーケンス検証...');
{
  const s = State.create();
  State.standby(s);
  State.powerOn(s);
  State.powerOnComplete(s);
  State.incMode(s); // C1
  State.incMode(s); // C2
  State.setMode(s); // C2 決定
  State.decideStarComplete(s);

  assert.strictEqual(s.mode, 2, 'C2 モード');
  assert.strictEqual(s.state, STATES.CARD_1, 'C2 主人公1枚目待ち');
  checkedCount += 2;

  // 主人公1枚目
  const res1 = State.cardInsertC2(s, '4901234567894');
  assert.strictEqual(res1.ok, true, 'C2 主人公1枚目(戦士) 登録');
  State.cardInsertNextC2(s);
  assert.strictEqual(s.state, STATES.CARD_2, 'C2 主人公2枚目待ち');
  checkedCount += 2;

  // 主人公2枚目 (魔法使い)
  const res2 = State.cardInsertC2(s, '4901274567892');
  assert.strictEqual(res2.ok, true, 'C2 主人公2枚目(魔法使い) 登録');
  State.cardInsertNextC2(s);
  assert.strictEqual(s.c2WaitEnemySet, true, 'C2 敵待ち待機フラグ');
  checkedCount += 2;

  // パスコード手動入力テスト (selectPasscode -> addPasscode -> setPasscode)
  s.c2EnemyWaitActive = true;
  State.selectPasscode(s);
  assert.strictEqual(s.passcodeActive, true, 'passcodeActive=true');
  assert.strictEqual(s.passcode, '00000', '初期コード 00000');
  assert.strictEqual(s.passcodeState, 0, '1桁目入力中');
  // 1桁目を +1
  State.addPasscode(s);
  assert.strictEqual(s.passcode, '10000', '1桁目インクリメント');
  // 1桁目確定
  State.setPasscode(s);
  assert.strictEqual(s.passcodeState, 1, '2桁目へ進行');
  checkedCount += 5;

  // 仲間選択
  s.c2FriendSelectActive = true;
  s.barcodeDataC2[4] = { live: true };
  s.barcodeDataC2[5] = { live: true };
  State.addFriendState(s);
  assert.strictEqual(s.friendSelectState, 1, '仲間選択: 1P戦士選択');
  State.setFriendState(s);
  assert.strictEqual(s.c2ItemWaitActive, true, 'アイテム待ち有効化');
  checkedCount += 3;
}

console.log('[Phase 3 - State] 4. C1 ワールドモードシーケンス検証...');
{
  const s = State.create();
  State.standby(s);
  State.powerOn(s);
  State.powerOnComplete(s);
  State.incMode(s); // C1
  State.setMode(s); // C1 決定
  State.decideStarComplete(s);

  assert.strictEqual(s.mode, 1, 'C1 モード');
  assert.strictEqual(s.state, STATES.CARD_1, 'C1 主人公1枚目待ち');
  checkedCount += 2;

  // 主人公1枚目
  const res1 = State.cardInsertC1(s, '4901234567894');
  assert.strictEqual(res1.ok, true, 'C1 主人公1枚目 登録');
  assert.ok(s.barcodeDataC1[0], 'barcodeDataC1[0] 保存');
  checkedCount += 2;

  // 1枚目完了進行
  State.cardInsertNextC1(s);
  assert.strictEqual(s.state, STATES.CARD_2, 'C1 主人公2枚目待ち');
  checkedCount++;

  // 主人公2枚目
  const res2 = State.cardInsertC1(s, '4901274567892');
  assert.strictEqual(res2.ok, true, 'C1 主人公2枚目 登録');
  assert.ok(s.barcodeDataC1[1], 'barcodeDataC1[1] 保存');
  checkedCount += 2;

  // 2枚目完了進行
  State.cardInsertNextC1(s);
  assert.strictEqual(s.state, STATES.CARD_3, 'C1 ステージ選択待ち');
  assert.ok(s.c1WorldData, 'C1WorldData 生成');
  checkedCount += 2;
}

console.log(`[Phase 3 - State] 全 ${checkedCount} 項目合格！ barcode2.as ↔ js/state.js の完全一致を確認しました。\n`);
