/* tests/smoke.mjs — 純粋ロジック層(state.js/store.js/decoder.js/textdisplay.js 純関数)のスモークテスト
 * jsdom 等が無いため node:vm + window スタブで実行する(この段階での検証基盤)。
 * 工程4(演出一体化)用に nes/barcode_world/fighting_data/fighting_calc も読む(読み込み順 nes→BW→FD→FC・index.html と同じ)。
 * golden 実測(calcSpecialDown・decideStar・decideFirstPlayer の連鎖)は tests/fighting.mjs(104 行接続済)側で実施済 —
 * ここでは State 側の結線(合成 1527/1572・1601 相当・specialDown 1798-1832・decideFirst 1916-1919・rollProtectionStar 752)を検証する。
 * view.js/main.js は DOM 前提のため本テスト対象外(ブラウザ手動確認で代替 — 04-implementation-status に記載)。
 * 実行: node tests/smoke.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const load = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const lsData = Object.create(null);
const sandbox = {
  window: {
    localStorage: {
      getItem: (k) => (k in lsData ? lsData[k] : null),
      setItem: (k, v) => { lsData[k] = String(v); }
    }
  },
  console
};
vm.createContext(sandbox);
vm.runInContext(load('../js/state.js'), sandbox, { filename: 'js/state.js' });
vm.runInContext(load('../js/store.js'), sandbox, { filename: 'js/store.js' });
vm.runInContext(load('../js/decoder.js'), sandbox, { filename: 'js/decoder.js' });
vm.runInContext(load('../js/textdisplay.js'), sandbox, { filename: 'js/textdisplay.js' });
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });
vm.runInContext(load('../js/barcode_world.js'), sandbox, { filename: 'js/barcode_world.js' });
vm.runInContext(load('../js/fighting_data.js'), sandbox, { filename: 'js/fighting_data.js' });
vm.runInContext(load('../js/fighting_calc.js'), sandbox, { filename: 'js/fighting_calc.js' });
vm.runInContext(load('../js/cards.js'), sandbox, { filename: 'js/cards.js' });
vm.runInContext(load('../js/reader.js'), sandbox, { filename: 'js/reader.js' });

const BB2 = sandbox.window.BB2;
const { State, Store, BarcodeRead, Digits } = BB2;

/* vmsandbox で作られたオブジェクトは main realm とプロトタイプが異なるため、
 * deepEqual 比較は JSON round-trip して main realm の素のオブジェクトにして行う */
const mainRealm = (o) => JSON.parse(JSON.stringify(o));

/* --- 状態遷移(元 barcode2.as 実測の仕様に整合 — state.js 冒頭コメント根拠) --- */
let s = State.create();
assert.equal(s.state, -1, '作成直後のみ -1(init 前)');

State.standby(s);
assert.equal(s.state, 0, 'standby(init_bb2→power_off 相当)で 0(電源投入前)');

/* 無効遷移: standby では incMode 無効(元は select/set のリスナが電源投入前に付かない) */
State.incMode(s);
assert.equal(s.mode, 0, 'standby では incMode 無効(mode 不変)');
State.powerOn(s);
assert.equal(s.state, 1, 'powerOn: 0→1(電源投入演出中)');
State.incMode(s);
assert.equal(s.mode, 0, '状態1(電源投入)でも incMode 無効');
State.powerOnComplete(s);
assert.equal(s.state, 2, 'powerOnComplete(select_mode 相当): 1→2(モード選択)');

/* inc_mode(708 相当): C-0→C-1→C-2→C-0 の cyclic */
State.incMode(s);
assert.equal(State.modeName(s), 'C-1', 'incMode: C-0→C-1');
State.incMode(s); State.incMode(s);
assert.equal(State.modeName(s), 'C-0', 'incMode は C-0/C-1/C-2 を cyclic(3 で 0 折返し)');

/* set_mode → 守護星決定 → 1枚目待ち */
State.setMode(s);
assert.equal(s.state, 3, 'setMode: 2→3(守護星決定)');
State.setMode(s);
assert.equal(s.state, 3, 'setMode はモード選択中のみ(2 以外では無効)');
State.decideStarComplete(s);
assert.equal(s.state, 4, 'decideStarComplete(mode_start 相当): 3→4(1枚目待ち)');

/* カード進行 1P→2P→1P→2P(card_insert_next 相当) */
State.cardInserted(s);
assert.equal(s.state, 5, 'cardInserted: 4→5(2枚目待ち)');
State.cardInserted(s);
assert.equal(s.state, 6, 'cardInserted: 5→6(3枚目待ち)');
State.cardSkip(s);
assert.equal(s.state, 7, 'cardSkip(card_skip 相当): 6→7(4枚目待ちへスキップ)');
State.cardInserted(s);
assert.equal(s.state, 8, 'cardInserted: 7→8(入力終了)');
State.cardInserted(s);
assert.equal(s.state, 8, 'cardInserted は 4〜7 のみ(8 以上では無効)');
State.cardSkip(s);
assert.equal(s.state, 8, 'cardSkip は 6/7 のみ(8 では無効)');

/* power_off(完全初期化): どの状態からでも 0・mode=0 */
s = State.create(); State.standby(s); State.powerOn(s); State.powerOnComplete(s);
State.incMode(s); State.incMode(s); State.powerOff(s);
assert.equal(s.state, 0, 'powerOff → 0(電源投入前)');
assert.equal(s.mode, 0, 'powerOff で mode=0 にリセット(barcode2.as:567)');
State.powerOff(s);
assert.equal(s.state, 0, 'powerOff は 0 からも 0');

/* --- store: 既定値・保存・壊れた JSON からの復旧 --- */
let d = Store.load();
assert.deepEqual(mainRealm(d.settings), { scale: 1, sound_mute: false, auto_input: false, show_debug: false, cards_collapsed: false, card_animation: true }, '既定 settings');
assert.equal(d.save, null, 'save は Phase 6 まで null');

d.settings.scale = 0.75;
d.settings.sound_mute = true;
d.settings.show_debug = true;
d.settings.cards_collapsed = true;
d.settings.card_animation = false;
assert.equal(Store.saveSettings(d), true, 'saveSettings 成功');
let d2 = Store.load();
assert.equal(d2.settings.scale, 0.75, 'scale 永続化');
assert.equal(d2.settings.sound_mute, true, 'sound_mute 永続化');
assert.equal(d2.settings.show_debug, true, 'show_debug 永続化');
assert.equal(d2.settings.cards_collapsed, true, 'cards_collapsed 永続化');
assert.equal(d2.settings.card_animation, false, 'card_animation 永続化');

lsData[Store.KEY] = '{{{壊れたJSON';
let d3 = Store.load();
assert.equal(d3.settings.scale, 1, '壊れた JSON でも既定値に戻る');
assert.equal(d3.settings.card_animation, true, 'card_animation 既定値復帰');
assert.equal(d3.settings.show_debug, false, 'show_debug 既定値復帰');
assert.equal(d3.settings.cards_collapsed, false, 'cards_collapsed 既定値復帰');
assert.equal(d3.version, 1, 'version 既定');

lsData[Store.KEY] = JSON.stringify({ version: 1, settings: { scale: 0.5, unknown_key: 1 }, save: null });
let d4 = Store.load();
assert.equal(d4.settings.scale, 0.5, '保存済み値の復元');

/* --- decoder(BarcodeRead.as 1:1 移植)。期待値は元 BarcodeRead.as の読解から手計算した値
   (Flash SWF oracle が動かないため golden 導出をコード読解に切替 — roadmap リスク表対応) --- */

/* 13 桁後読み経路(shift 既定 0)。元 309〜501 の 13 桁分支 */
let r = new BarcodeRead();
assert.equal(r.init('4901234567894', 1), true, '13 桁有効(後読み・race4 頭値0/1 以外 c2≠9)');
let d1 = mainRealm(r.barcode_data);
assert.equal(d1.race, 4, '13 桁 race=c12');
assert.equal(d1.hp, 487, '後読み HP=floor(c11/2)→c10,c9 連結');
assert.equal(d1.st, 52, '後読み ST');
assert.equal(d1.df, 43, '後読み DF');
assert.equal(d1.speed, 8, '13 桁 speed=c10');
assert.equal(d1.job, 3, '13 桁 job=c5');
assert.equal(d1.pp, 5, 'PP 既定 5');
assert.equal(d1.mp, 0, 'MP(job<6 で 0)');
assert.equal(d1.special, 18, '特殊=「1」+c10(c8=6 は 0〜3/8〜9 のいずれか)');

/* 拒否: デジット不一致・桁数 */
assert.equal(new BarcodeRead().init('4901234567890', 1), false, 'デジット不一致(期待 4・実際 0)');
assert.equal(new BarcodeRead().init('490123456789', 1), false, '桁数 12 は false');

/* 前読み経路(頭 0/1 かつ c7 が 0..4 → 元 184〜186) */
r = new BarcodeRead();
assert.equal(r.init('0000000000000', 1), true, '前読み有効');
assert.equal(mainRealm(r.barcode_data).race, 0, '前読み race=c7');

/* 8 桁キャラクター(check デジット 1 となる '49011111')。元 409〜498 の 8 桁分支 */
r = new BarcodeRead();
assert.equal(r.init('49011111', 1), true, '8 桁有効');
let d8 = mainRealm(r.barcode_data);
assert.equal(d8.race, 1, '8 桁 race=c7');
assert.equal(d8.hp, 11, '8 桁後読み HP');
assert.equal(d8.st, 86, '8 桁 ST');
assert.equal(d8.df, 88, '8 桁 DF');
assert.equal(d8.job, 4, '8 桁 character job 既定 4');
assert.equal(d8.speed, 1, '8 桁 speed=c5');
assert.equal(d8.special, 1, '8 桁特殊');

/* 1 枚目はアイテム不可(元 35〜37): race7 のカードを count1 で拒否 */
assert.equal(new BarcodeRead().init('49012347', 1), false, '1 枚目で race>4 は拒否');

/* 3・4 枚目は count=2 + barcode1_data(card_insert 1110・1141 相当) */
r = new BarcodeRead();
assert.equal(r.init('49012347', 2, null), true, '3 枚目は count2 ならアイテム受付');
let dItem = mainRealm(r.barcode_data);
assert.equal(dItem.race, 7, 'DF アイテム race');
assert.equal(dItem.df, 28, 'DF アイテム分岐(8 桁・c4=2 → 「2」+ (c3+7)%10)');
assert.equal(dItem.special, 3, '8 桁特殊(c3=1 → special=c5)');
/* 同じバーコードは合体不可(元 80〜98) */
assert.equal(new BarcodeRead().init('49012347', 2, r.barcode_data), false, '同一バーコード合体拒否');

/* 裏技 value_shift 相当(barcode2.as 1173〜1207): shift を渡して再読み込み */
r = new BarcodeRead();
assert.equal(r.init('4901234567894', 1, null, -2), true, 'shift 付き init');
let dShift = mainRealm(r.barcode_data);
assert.equal(dShift.hp, 365, 'shift=-2(l_battle 相当) HP');
assert.equal(dShift.st, 30, 'shift=-2 ST');
assert.equal(dShift.df, 21, 'shift=-2 DF');

/* --- state.js 拡張(2026-11-04 工程A: data 保存・cardInputFailed・valueShift・shift_card 窓)。
   2026-11-04 作業6 工程1 で saveCard/advanceCardFx に分割されたため、忠実フロー(saveCard 演出開始→
   advanceCardFx 演出完了)で検証し、互換ラッパ cardInserted は末尾で別に検証する。
   data は素のオブジェクトでよい(state.js は BarcodeData 相当の opaque な値として保存・置換以上の操作をしない —
   vm realm と main realm の deepEqual 問題は生じない)。根拠は barcode2.as 実測(state.js 冒頭コメント参照) */
{
  const st = State.create();
  State.standby(st);
  assert.equal(st.cards.length, 4, 'create で cards[4]');
  assert.ok(st.cards.every(c => c === null), '初期 cards はすべて null');
  assert.equal(st.shift_card, null, '初期 shift_card は閉じている');

  State.powerOn(st); State.powerOnComplete(st);
  State.setMode(st); State.decideStarComplete(st);
  assert.equal(st.state, 4, 'decideStarComplete 後 1枚目待ち(4)');

  /* 2026-11-04 作業6 工程1(saveCard/advanceCardFx 分割)整合済みの忠実フロー:
     演出開始相当の saveCard で保存・裏技窓 open(元 1038-1041)→演出完了相当の advanceCardFx
     で窓閉・進行(元 card_insert_next 冒頭 1463-1466 リスナー解除・bb2_state++) */
  const c1 = { barcode: '4901234567890', hp: 100, st: 150, df: 199 };
  State.saveCard(st, c1);
  assert.equal(st.cards[0], c1, 'saveCard(演出開始相当): cards[0] に保存');
  assert.equal(st.state, 4, 'saveCard では bb2_state はまだ 4(進行は演出完了時)');
  assert.equal(st.shift_card, 0, 'saveCard で 1枚目の裏技受付窓(shift_card=0)が開く');

  /* valueShift: 演出中(窓開)。元 1199 と同じ「再デコード結果で置換」 */
  const c1s = { barcode: '4901234567890', hp: 110, st: 150, df: 199 };
  State.valueShift(st, c1s);
  assert.equal(st.cards[0], c1s, 'valueShift が cards[0] を置換');

  State.advanceCardFx(st);
  assert.equal(st.state, 5, 'advanceCardFx で 2枚目待ちへ進行');
  assert.equal(st.shift_card, null, 'advanceCardFx で窓閉(元 1463-1466 リスナー解除相当)');

  const c2 = { barcode: '4901234567891', hp: 90, st: 12, df: 44 };
  State.saveCard(st, c2);
  assert.equal(st.shift_card, 1, '2枚目の saveCard で受付窓(shift_card=1・元 1038-1041 と同じ対象');

  State.valueShift(st, null);   /* init 失敗時 null 代入は元 1204 と同じ */
  assert.equal(st.cards[1], null, 'valueShift 失敗時 null 上書き(元 1204 と同じ挙動)');
  State.valueShift(st, c2);     /* 再代入(元は演出中複数回押下可だったのに対応) */
  State.advanceCardFx(st);
  assert.equal(st.state, 6, '2枚目演出完了 → 3枚目待ち');
  assert.equal(st.shift_card, null, '演出完了で 2枚目の窓閉');
  assert.equal(st.cards[1], c2, 'valueShift 再代入で cards[1] 復旧');

  /* 3 枚目は元から裏技窓なし(元 1116〜1121・1147 でリスナ付与なし)。SET スキップ(card_skip 1394 相当):
     演出開始時の cards[2]=null 代入(元 1414・1424 相当)込みで cardSkip(進行+窓閉) */
  State.cardSkip(st);
  assert.equal(st.state, 7, 'cardSkip(card_skip 1394 相当)で 4枚目待ち');
  assert.equal(st.cards[2], null, 'スキップ枚は null のまま(元 1414・1424 相当)');
  assert.equal(st.shift_card, null, 'スキップで窓閉');

  /* 失敗 → error_back(1772 相当): bb2_state を変えず同じ枚数で再受付。data 引数(2026-11-04
   作業6 工程1 で追加・元 1057 相当で reader.barcode_data をそのまま保存)を両方向で検証 */
  const c4f = { barcode: '4901234567893', hp: 5, st: 5, df: 5 };
  State.cardInputFailed(st, c4f);
  assert.equal(st.state, 7, 'cardInputFailed(data 付き): bb2_state 7 のまま(リトライ可)');
  assert.equal(st.cards[3], c4f, 'data 付き失敗はカードを保持(元 1057 相当・アイテム・同バーコード失敗で data が残る挙動)');
  State.cardInputFailed(st);
  assert.equal(st.cards[3], null, 'data 無しの旧呼び出しは null 代入のまま');
  assert.equal(st.shift_card, null, '失敗で shift 窓閉');

  /* 4 枚目は忠実フロー(saveCard→advanceCardFx)。裏技窓なし・進行 */
  State.saveCard(st, { barcode: '4901234567894', hp: 1, st: 1, df: 1 });
  assert.equal(st.shift_card, null, '4 枚目に裏技窓なし(元 1147 でリスナ付与なし)');
  State.advanceCardFx(st);
  assert.equal(st.state, 8, '4枚目演出完了 → 入力終了');

  State.powerOff(st);
  assert.equal(st.state, 0, 'powerOff で 0');
  assert.ok(st.cards.every(c => c === null), 'powerOff で cards クリア(HTML 側は保守的 — 元 136〜200 に未確認)');
  assert.equal(st.shift_card, null, 'powerOff で shift_card も閉じる');

  /* 互換ラッパ cardInserted(=saveCard+advanceCardFx の即実行)。旧スモーク互換のまま:
     保存して即進行・窓は演出完了相当で即閉じる・data 省略可(スロット null のまま進行のみ) */
  const st2 = State.create();
  State.standby(st2); State.powerOn(st2); State.powerOnComplete(st2);
  State.setMode(st2); State.decideStarComplete(st2);
  State.cardInserted(st2, c1);
  assert.equal(st2.state, 5, 'cardInserted(ラッパ)で 2枚目待ち');
  assert.equal(st2.cards[0], c1, 'cardInserted でも cards[0] に保存');
  assert.equal(st2.shift_card, null, 'ラッパは窓を開いた直後に閉じる(演出完了即実行相当');
  State.cardInserted(st2);
  assert.equal(st2.state, 6, 'cardInserted(data 省略)でも進行');
  assert.equal(st2.cards[1], null, 'data 省略では cards[1] は null のまま');
}

/* --- textdisplay.js 7 セグ合成(TextInputSprite.as 実測: disp_val 172-194・display_str 201-325・
       pp_text/mp_text 327-349。DOM 描画は view.js 側・純関数と写し表のみ検証) --- */
{
  assert.equal(Digits.dispVal(195), '19500', '数値は abs+00 付与で 5 桁ちょうど(184 相当・固定小数表記相当)');
  assert.equal(Digits.dispVal(95), ' 9500', '数値は先頭 space 詰め・右寄せ(189-191 相当');
  assert.equal(Digits.dispVal(0), '   00', 'num==0 は "00"(186 相当)→ "   00"');
  assert.equal(Digits.dispVal(-3), '  300', '負数値は abs して表示(181-183 相当・負号なし');
  assert.equal(Digits.dispVal(199), '19900', '199 は 19900(351 行コメント「19900 表示」仕様と一致');
  assert.equal(Digits.dispVal('END'), 'END  ', 'END は e/n/d の 7 セグで描画可(マッピング内');
  assert.equal(Digits.dispVal('00000'), '00000', '5 文字列は space 継ぎなし(MXML initial text="00000 相当');
  assert.equal(Digits.dispVal('C-0'), 'C-0  ', 'モード表示 C-0 は 5 文字まで space 継ぎ(c-/0 マッピング内');
  assert.equal(Digits.dispVal(' =='), ' ==  ', '文字列は末尾 space 継ぎ(175-177 相当・点滅 "==" 表示相当');
  assert.equal(Digits.charSrc('C'), 'assets/bb2digits/c.png', 'display_str(209 相当)は文字小文字化して照合');
  assert.equal(Digits.charSrc('='), 'assets/bb2digits/=.png', '「=」PNG は点滅演出の描画に使う');
  assert.equal(Digits.charSrc(' '), 'assets/bb2digits/space.png', 'space PNG は空セルの描画(消去相当)');
  assert.equal(Digits.charSrc('w'), null, 'w はマッピング外(元 copyPixels 非実行でセル保持となる文字');
  assert.equal(Object.keys(Digits.CHAR_SRC).length, 28, 'CHAR_SRC は bb2digits 28 ファイルの全写し(数字10+英文字15+「-」「=」「space」)');
  assert.equal(Digits.ppPad(8), '  8', 'pp_text(333-334 相当)は value<10 なら space2 個');
  assert.equal(Digits.ppPad(10), ' 10', 'pp_text(335-336 相当)は value>=10 なら space1 個');
  assert.equal(Digits.dispVal(Digits.ppPad(8)), '  8  ', 'mp_text/pp_text は String 化後 String 分支(space 末尾継ぎ)');
}

/* --- 工程4(演出一体化・2026-11-04) State 側結線(合成 1527・1572 相当・1601 相当・specialDown 1798-1832・decideFirst 1913-1919 相当・rollProtectionStar 752 相当)。
 *     view 側演出(fxCardNext 合成表示・special_down_animation 1836-1886・decide_first 演出 1928-1952・render 合成表示)は vm 対象外
 *     (ブラウザ手動確認・status doc §5 手順)。実計算の golden 連鎖(calcSpecialDown 158-332 等)は tests/fighting.mjs(FC 63 件)済 —
 *     ここでは State 側ラッパー挙動と CreateFightingData 実呼び出しの合成(1527・1572 相当)を検証する */
{
  const mkBd = (hp, st, df, speed, race, job, mp, pp, special) =>
    ({ barcode: 'BD', hp: hp, st: st, df: df, speed: speed, race: race, job: job, mp: mp, pp: pp, special: special });
  const c1 = mkBd(30, 120, 10, 300, 2, 7, 12, 40, 23);   /* 1枚目(1P 合成 1枚目側・job 7・magic) */
  const c2 = mkBd(40, 10, 5, 100, 5, 6, 8, 9, 11);       /* 2枚目(2P 合成 1枚目側・job 6) */
  const c3 = mkBd(80, 90, 95, 100, 7, 3, 14, 41, 24);    /* 3枚目(race 7>4 側 branch) */
  const c4 = mkBd(60, 20, 15, 100, 3, 5, 7, 6, 12);      /* 4枚目(race 3<=4・mp 両側<10 側 branch) */

  /* advanceCardFx 合成: CARD_3(6) で 1527 相当・CARD_4(7) で 1572+1601 相当(1549・1589 の bb2_state++ と同じ進行) */
  const s = State.create();
  State.standby(s);
  s.cards = [c1, c2, c3, c4];
  s.state = State.STATES.CARD_3;                            /* 直指定(3枚目の演出完了後進行相当・cardSkip 経路と同じ) */
  State.advanceCardFx(s);                                   /* 1527 相当 1P=c1(1枚目)+c3(3枚目) 合成 */
  assert.equal(s.state, State.STATES.CARD_4, '3枚目進行→4枚目待ち(1549 相当 bb2_state++)');
  /* 期待値は CreateFightingData.as 実測の手計算: hp 30+80=110(55-60)・st 120+90=210→199(62-68)・df 10+95=105(73-79)・
     speed=c1.speed 300(84)・race1 2・race2 7(86-87)・job=c1.job 7(89)・race2 7>4 側で pp=bc1.pp+bc2.pp=40+41=81(95・99 未満でクランプ対象外)・
     mp は race2>4 かつ job 7>6 で bc1.mp+bc2.mp=12+14=26(118・121-123 未満でクランプ対象外)・union_flag は race2<=4 分岐(113)のみ true でこの branch では false のまま・
     special1=c1.special 23・special2=c3.special 24(126-127)・st1 120・st2 90・df1 10・df2 95・max_hp 110・pp_ignore false・cpu は既定 false */
  assert.deepEqual(mainRealm(s.fightingData[0]), { max_hp: 110, hp: 110, down_hp_flag: false, st: 199, st1: 120, st2: 90, down_st_flag: false, st_item_broke_flag: false, df: 105, df1: 10, df2: 95, down_df_flag: false, df_item_broke_flag: false, speed: 300, union_flag: false, race1: 2, race2: 7, job: 7, pp: 81, mp: 26, pp_ignore_flag: false, special1: 23, special2: 24, cpu: false }, '3枚目合成 1527 相当(24 フィールド全一致・FightingData コンストラクタ既定含む)');
  assert.equal(s.fightingData[1], null, '3枚目合成直後は 2P 合成未(1572 相当は 4枚目進行で実施)');
  State.advanceCardFx(s);
  assert.equal(s.state, State.STATES.CARDS_DONE, '4枚目合成→bb2_state 8(1589 相当 bb2_state++)');
  assert.deepEqual(mainRealm(s.fightingData[1]), { max_hp: 100, hp: 100, down_hp_flag: false, st: 30, st1: 10, st2: 20, down_st_flag: false, st_item_broke_flag: false, df: 20, df1: 5, df2: 15, down_df_flag: false, df_item_broke_flag: false, speed: 100, union_flag: true, race1: 5, race2: 3, job: 6, pp: 9, mp: 0, pp_ignore_flag: false, special1: 11, special2: 12, cpu: false }, '4枚目合成 1572 相当(c2 の race1 5/c4 の race2 3<=4 側・113 で union_flag true・pp は 1枚目のみ代入 9(92-93 相当)・mp は両側<10 で 0(110-112 相当)・special1 11/special2 12)');
  assert.notEqual(s.fightingCalc, null, '1601 相当の ensureFightingCalc が 4枚目合成で走る(737-739 相当 lazy 生成・nes→BW→FD→FC の読み込み順に依存・FC コンストラクタは元 27-28 相当で barcode_world/nes を new)');
  assert.equal(s.fightingCalc.fighting_data, s.fightingData, '1601 相当: fighting_calc ← fighting_data 接続(1916 の decideFirstPlayer・1821-1822 の calcSpecialDown で参照)');
  assert.equal(s.fightingCalc.protection_star, 0, 'FC 既定の protection_star は AS int 既定 0(元 17・js/fighting_calc.js 33 で写し・decideStar 実行前)');

  /* スキップ相当(3・4枚目スロット null → 1527・1572 相当は CreateFightingData 1枚分岐 84-101 で合成 — 元 card_skip でも同じ) */
  const s2 = State.create();
  State.standby(s2);
  s2.cards = [c1, c2, null, null];
  s2.state = State.STATES.CARD_3;
  State.advanceCardFx(s2);
  const fdS = mainRealm(s2.fightingData[0]);
  assert.equal(fdS.hp, 30, '1枚分岐(84-101 相当): max_hp=hp=c1 素値(131-132)');
  assert.equal(fdS.union_flag, false, '1枚分岐は union_flag false(140)');
  assert.equal(fdS.pp, 40, '1枚分岐は mp/pp 素値のまま(141-142)');
  assert.equal(fdS.mp, 12, '1枚分岐 mp=c1.mp(142)');
  assert.equal(fdS.special1, 23, '1枚分岐 special1 のみ代入(144 相当・special2 は FightingData 既定 0 のまま 41 相当)');
  assert.equal(fdS.special2, 0);
  assert.equal(mainRealm(s2.fightingData)[1], null, '3枚目相当進行の時点では 2P 合成未のまま');
  State.advanceCardFx(s2);
  const fdT = mainRealm(s2.fightingData[1]);
  assert.equal(fdT.hp, 40, '4枚目スキップ相当の 2P 側 1枚合成 hp=c2 素値');
  assert.equal(fdT.special1, 11);
  assert.equal(fdT.union_flag, false, '1枚分岐(スロット null はスキップ相当)');
  assert.notEqual(s2.fightingCalc, null, '1572+1601 相当(1枚合成)でも ensureFightingCalc 走る');
  /* HTML 防御(1枚目・2枚目スロット null は互換ラッパ cardInserted の data 省略時のみで実機経路でない — 元 1527 相当は同経路で barcode_data[0] 参照になり得るため合成しない方針・state.js advanceCardFx コメント) */
  const s3 = State.create();
  State.standby(s3);
  s3.state = State.STATES.CARD_1;
  State.advanceCardFx(s3);
  assert.equal(s3.state, State.STATES.CARD_2, '1枚目進行・2枚目進行(CARD_1・CARD_2 は合成対象 6/7 相当でないので合成なし)');
  s3.state = State.STATES.CARD_3;
  State.advanceCardFx(s3);
  assert.equal(s3.fightingData[0], null, '1枚目スロット null で 1527 相当合成スキップ(HTML 防御)・進行は走る(1549 相当)');
  State.advanceCardFx(s3);
  assert.equal(s3.state, State.STATES.CARDS_DONE, '1572 相当ガードスキップでも進行(1589 相当 bb2_state++)');
  assert.equal(s3.fightingData[1], null, '2枚目スロット null で 2P 合成なし(view 側 1544/1572 相当の special_down・decide_first 連鎖防御スキップと連動)');
  assert.equal(s3.fightingCalc, null, '合成ガード時 ensureFightingCalc 走らない(1601 相当は 1572 相当合成の実行時のみ)');
  /* specialDown(1798-1832 相当)。実測 calcSpecialDown(158-332)の golden 連鎖は tests/fighting.mjs(FC 63 件)側で実施済のため
     ここは stub で決定化し State 側のラッパー(45 無効化 1804-1818・対呼び 1821-1822 の癖・1824-1826 返し)だけ検証する */
  const mkStubFc = (downFlag) => {
    const calls = [];
    const fc = {
      calls: calls,
      calcSpecialDown: (a, b) => {
        const out = { id: 'c' + (calls.length + 1), max_hp: 7, hp: 7, down_hp_flag: false, st: 7, st1: 7, st2: 7,
          down_st_flag: downFlag, down_df_flag: false, st_item_broke_flag: false, df: 7, df1: 7, df2: 7,
          union_flag: false, race1: 1, race2: 1, job: 1, pp: 1, mp: 1, pp_ignore_flag: false, speed: 7,
          special1: a.special1, special2: a.special2, cpu: false };
        calls.push([a, b, out]);
        return out;
      }
    };
    return fc;
  };
  /* A) 1P 側(=fighting_data[0])が 45 を持つ → 2P 能力無効化(1804-1806→1815-1818)。1822 の癖: 2 件目は 1821 再代入済 fd[0] を第1引数 */
  const fa = { special1: 45, special2: 0 };
  const fb = { special1: 30, special2: 40 };
  const sA = State.create();
  State.standby(sA);
  const fcA = mkStubFc(true);
  sA.fightingCalc = fcA;
  sA.fightingData = [fa, fb];
  assert.equal(State.specialDown(sA), true, '1824-1826 相当: flag あり→演出要すの true(view 側 1828-1832 相当 Timer 250ms×14 へ');
  assert.equal(fb.special1, 0, '1804-1806 相当(1P 側 45→special_2p_enabled=false)→1815-1818 で 2P 能力清零');
  assert.equal(fb.special2, 0);
  assert.equal(fa.special1, 45, '1811-1814 は special_1p_enabled (false は 2P 側 45 の時)側の清零 — 45 保持側 1P はそのまま');
  assert.equal(fcA.calls.length, 2, '1821-1822 の対呼び 2 件');
  assert.equal(fcA.calls[0][0], fb, '1821 相当 calc_special_down(fd[1], fd[0]) — 第1引数は 2P 側');
  assert.equal(fcA.calls[0][1], fa, '1821 相当 第2引数は 1P 側');
  assert.equal(fcA.calls[1][0], fcA.calls[0][2], '1822 相当 第1引数=1821 再代入済 fd[0](元の癖保持・1821 の返し代入後の再参照); 2 件目へ渡す');
  assert.equal(fcA.calls[1][1], fb, '1822 相当 第2引数=fd[1](1821 前の参照値のまま — 1821 の再代入は fd[0] のみ); 元の癖');
  assert.equal(sA.fightingData[0], fcA.calls[0][2], '1821 相当 fd[0]=再代入');
  assert.equal(sA.fightingData[1], fcA.calls[1][2], '1822 相当 fd[1]=再代入');
  /* B) 2P 側(=fighting_data[1])が 45 を持つ → 1P 能力無効化(1807-1809→1811-1814)。2P 保持側はそのまま */
  const faB = { special1: 30, special2: 31 };
  const fbB = { special1: 0, special2: 45 };
  const sB = State.create();
  State.standby(sB);
  sB.fightingCalc = mkStubFc(false);
  sB.fightingData = [faB, fbB];
  assert.equal(State.specialDown(sB), false, '1824-1826 相当: 全 flag false(stub の down_st_flag false の為 flat)→演出なし(true 返しでない・view 側 1826 相当の decide_first(10) 経路へ');
  assert.equal(faB.special1, 0, '1811-1814(special_1p_enabled false は 2P 側 45 側の為)1P 能力清零');
  assert.equal(faB.special2, 0);
  assert.equal(fbB.special2, 45, '45 保持側 2P は清零されない');
  /* C) 両側 45 → 1804・1807 の読み取りが 1811-1818 の適用前に両側を見るので相互無効化(元の順・その順序) */
  const faC = { special1: 45, special2: 0 };
  const fbC = { special1: 0, special2: 45 };
  const sC = State.create();
  State.standby(sC);
  sC.fightingCalc = mkStubFc(true);
  sC.fightingData = [faC, fbC];
  State.specialDown(sC);
  assert.equal(faC.special1, 0, '両側 45 で相互無効化(1P 側も 2P 側 45 の読取 1807 で無効対象');
  assert.equal(fbC.special2, 0, '2P 側も 1P 側 45 の読取 1804 で無効対象');
  /* D) 45 なしのペアは無変更(読み取りは special 判定のみで書き換えなし・1811-1818 発動せず); flat false で返し true */
  const faD = { special1: 23, special2: 24 };
  const fbD = { special1: 24, special2: 23 };
  const sD = State.create();
  State.standby(sD);
  sD.fightingCalc = mkStubFc(true);
  sD.fightingData = [faD, fbD];
  assert.equal(State.specialDown(sD), true, 'stub の down_st_flag true→演出要す');
  assert.equal(faD.special1, 23, '45 判定のみで special は書き換えない(1811-1818 の代入は 45 検出時のみ');
  assert.equal(fbD.special1, 24, '元の special1/2 のまま(calcSpecialDown の stub 側返しの fd 代入後の癖とは別・入力は無変更');

  /* decideFirst(1913-1919 相当)。bb2_state 不変(元 1913-1925 に bb2_state 行無し)・1919 で battle_waiting_first=true */
  const sE = State.create();
  State.standby(sE);
  let decCount = 0;
  sE.fightingCalc = { decideFirstPlayer: () => { decCount++; } };
  State.decideFirst(sE);
  assert.equal(decCount, 1, '1916 相当: decideFirstPlayer 1 回(now_player 1/2 の決定・コイントラ 107 実測の連鎖は tests/fighting.mjs golden 済); stub');
  assert.equal(sE.battleWaitingFirst, true, '1919 相当 battle_waiting_first=true(元 1912 フィールド・battle_waiting 1957 以降の結線は Phase 4/5 続き); true');
  assert.equal(sE.state, State.STATES.STANDBY, 'bb2_state を変えない(1913-1925 相当・view 側演出でも 8 継続の実測根拠と同じ); STANDBY のまま確認');

  /* rollProtectionStar(752 相当)。lazy 生成ガード 737-739 相当・複数呼びでも同じインスタンスを持ち回す(元 member 構造) */
  const sF = State.create();
  State.standby(sF);
  assert.equal(sF.fightingCalc, null, 'create() 後 fightingCalc は null(lazy 生成 737-739 相当');
  State.rollProtectionStar(sF);
  const fcRef = sF.fightingCalc;
  assert.notEqual(fcRef, null, '752 相当で実 BB2.FightingCalc 生成(nes→BW→FD→FC 読み込み済・FC コンストラクタ元 27-28 で barcode_world/nes を new・protection_star 既定 0 確認済');
  State.rollProtectionStar(sF);
  assert.equal(sF.fightingCalc, fcRef, '2 回目も再生成しない(lazy ガード if(!fighting_calc) 相当の元 737 のガードと同じ・使い回す');
  const psV = fcRef.protection_star;
  assert.ok(psV === 0 || psV === 1 || psV === 2, 'decideStar 実行後の protection_star は実値 0-2(元 78-88・rand は Math.random の為この場は 0-2 の範囲確認のみ・randOverride 注入の golden 11 件は tests/fighting.mjs 42-52 行接続済・0=レトフ 110/500・1=セターン 256/500・2=ラト 134/500');

  /* powerOff(136 相当・powerOff 保守的 cards クリアは既存テスト検証済)で fightingData もクリア・fightingCalc インスタンはそのまま */
  assert.notEqual(s.fightingCalc, null, 's の合成テストで 1601 相当の実インスタンス生成済');
  State.powerOff(s);
  assert.equal(s.state, State.STATES.STANDBY, 'powerOff 相当で 0(136 相当); mode=0 は既存');
  assert.ok(s.fightingData.every((f) => f === null), 'powerOff で fightingData もクリア(HTML 側は保守的・fightingData クリア元の 136-200 に観測できず・state.js powerOff コメント参照); cards は既存');
  assert.notEqual(s.fightingCalc, null, 'powerOff でも fightingCalc インスタンは保持(元の 136-200 に生成し直し/クリアは観測できず・737 lazy ガードで次回 cycle は同じインスタンスを使い 752 で decideStar し直し protection_star は更新される');
}

/* --- 工程5-1(2026-11-05・battle_waiting 接続・State.battleWaiting 分岐・1957-2035)---
 *     view 側 gauge/battlePowerAnim・ラベル・light・battleClick/SELECT 配線は vm 対象外(browser manual check・
 *     proc4 header 285-288 same method)。now_player 決定(decideFirstPlayer 91-101)と golden(FC 63 件)は
 *     tests/fighting.mjs 接続済。assert messages ASCII(2026-11-05 note: proc5 messages ASCII) */
{
  const mkF = (hp, ppIg, cpu) => ({ hp: hp, st: 5, df: 5, pp_ignore_flag: ppIg, cpu: cpu });
  const mkS = (now, mode, bwf) => {
    const s = State.create(); State.standby(s);
    s.state = State.STATES.CARDS_DONE;
    s.fightingData = [mkF(100, false, false), mkF(100, false, false)];
    s.fightingCalc = { now_player: now };
    s.mode = mode;
    s.battleWaitingFirst = bwf;
    return s;
  };
  /* A 初回: hp<=0 あっても battleWaitingFirst=true(1919)で 1967 gate 非発動 */
  {
    const s = mkS(1, 0, true);
    s.fightingData[0].hp = 0;
    const r = State.battleWaiting(s);
    assert.equal(r.battleEnd, false, 'gate 1967 no(1919 true)');
    assert.equal(r.nowPlayer, 1);
    assert.equal(r.battle, true, '2005 l_battle');
    assert.equal(r.power, true, '2006 l_power');
    assert.equal(r.escape, false, '2010 mode!=1 C0 faithful skip');
    assert.equal(r.select, true, '2013 select');
    assert.equal(s.selectBattleMagic, true, '2013 true');
    assert.equal(s.battleFlag, false, '1958 false');
    assert.equal(s.battleWaitingFirst, true, 'gate read-only');
    assert.equal(s.state, State.STATES.CARDS_DONE, 'bb2_state unchanged');
  }
  /* B gate: HP<=0 で 1970/1975 相当 return(call_battle_end 2161・5-2)*/
  {
    const s = mkS(1, 0, false);
    s.fightingData[0].hp = 0;
    const r = State.battleWaiting(s);
    assert.equal(r.battleEnd, true, '1968-1972 HP<=0');
    assert.equal(r.battle, undefined, '1970 return path(1982 onward no gauge no window)');
    assert.equal(s.battleWaitingFirst, false, 'gate read-only unchanged');
  }
  {
    const s = mkS(2, 0, false);
    s.fightingData[1].hp = 0;
    const r = State.battleWaiting(s);
    assert.equal(r.battleEnd, true, '1973-1978 HP<=0');
    assert.equal(r.nowPlayer, 2);
  }
  /* C 2P cpu=true: 2019-2025 で battle/power/select 付与なし */
  {
    const s = mkS(2, 0, true);
    s.fightingData[1].cpu = true;
    const r = State.battleWaiting(s);
    assert.equal(r.cpu, true, '2019 cpu branch');
    assert.equal(r.battle, undefined, '2020 no attach');
    assert.equal(r.power, undefined, '2021 no attach');
    assert.equal(r.select, undefined, '2024 no attach');
    assert.equal(s.selectBattleMagic, true, '3185 initial true(2024 not reached)');
  }
  /* D mode==1 escape */
  {
    const s = mkS(1, 1, true);
    const r = State.battleWaiting(s);
    assert.equal(r.escape, true, '2011 mode 1');
    assert.equal(r.battle, true, '2005 unchanged');
  }
  /* E pp_ignore gate */
  {
    const s = mkS(1, 0, true);
    s.fightingData[0].pp_ignore_flag = true;
    const r = State.battleWaiting(s);
    assert.equal(r.power, false, '2006-2008 gate');
    assert.equal(r.battle, true, '2005 separate gate');
  }
  /* F 宣言初期値(2338・2339・3735・2990・3185) */
  {
    const s = State.create();
    assert.equal(s.battleFlag, false, '2338 initial');
    assert.equal(s.battleEndCount, 0, '2339 initial');
    assert.equal(s.battlePowerDisableFlag, false, '3735 initial');
    assert.equal(s.powerFlag, false, '2990 initial');
    assert.equal(s.selectBattleMagic, true, '3185 initial true');
  }
  /* G 工程5-2a: State.battle / battleComplete / itemBrokeComplete(2340-2834) */
  {
    const mkFD = (hp, st, df, race2, st2, df2) => {
      const fd = new BB2.FightingData();
      fd.hp = hp; fd.max_hp = hp;
      fd.st = st; fd.st1 = st - (st2 || 0); fd.st2 = st2 || 0;
      fd.df = df; fd.df1 = df - (df2 || 0); fd.df2 = df2 || 0;
      fd.speed = 10; fd.race1 = 0; fd.race2 = race2 || 0;
      return fd;
    };
    const s = State.create(); State.standby(s);
    s.state = State.STATES.CARDS_DONE;
    const fc = State.ensureFightingCalc(s);
    fc.protection_star = 0;
    fc.now_player = 1;
    s.fightingData = [mkFD(100, 40, 20, 7, 0, 8), mkFD(100, 30, 25, 5, 10, 0)];
    fc.fighting_data = s.fightingData;
    s.battleWaitingFirst = true;

    /* G1: 1P 攻撃的外れ(hitRand=255) → displayDamage=0, time=130, battleEndCount=80 */
    const rMiss = State.battle(s, { hitRand: 255 });
    assert.equal(s.battleFlag, true, '2342 battleFlag true');
    assert.equal(rMiss.hit, false, '2355 miss');
    assert.equal(rMiss.critical, false, 'miss critical false');
    assert.equal(rMiss.displayDamage, 0, '2377 display_damage=0');
    assert.equal(rMiss.time, 130, '2426 miss time 130');
    assert.equal(rMiss.battleEndCount, 80, '2427 miss endCount 80');
    assert.equal(s.fightingData[1].hp, 100, 'miss hp unchanged');

    /* 外れ完了 → checkItemBroken 非発動 → now_player 1→2 反転・battleWaitingFirst=false */
    const cMiss = State.battleComplete(s);
    assert.equal(cMiss.itemBroken, false, '2677 display_damage==0 no item broken');
    assert.equal(cMiss.nowPlayer, 2, '2696 now_player 1->2');
    assert.equal(s.battleWaitingFirst, false, '2713 battleWaitingFirst false');

    /* G2: 2P 攻撃命中(hitRand=0, dmgRand=[0,0]) → 通常命中 time=110, endCount=60, 2P STアイテム(race2=5)/1P DFアイテム(race2=7)破壊検知 */
    const rHit2 = State.battle(s, { hitRand: 0, dmgRand: [0, 0] });
    assert.equal(rHit2.nowPlayer, 2, '2P attack');
    assert.equal(rHit2.hit, true, '2382 hit');
    assert.equal(rHit2.displayDamage > 0, true, 'damage > 0');
    assert.equal(rHit2.critical, false, 'normal hit');
    assert.equal(rHit2.time, 110, '2422 normal hit time 110');
    assert.equal(rHit2.battleEndCount, 60, '2423 normal hit endCount 60');
    assert.equal(s.fightingData[0].hp, 100 - rHit2.displayDamage, '2389 1P hp reduced');

    /* 2P 攻撃完了 → 2P(att)が race2==5・1P(def)が race2==7 かつ hp>0 のため itemBroken=true(ターン交代まだしない) */
    const cBroke = State.battleComplete(s);
    assert.equal(cBroke.itemBroken, true, '2681-2683 itemBroken true');
    assert.equal(fc.now_player, 2, 'now_player stays 2 during item broke anim');

    /* itemBrokeComplete → 2P st から st2(10) 減算 + 1P df から df2(8) 減算 + 両フラグ true + battleComplete 再呼出で now_player 2→1 */
    const cAfterBroke = State.itemBrokeComplete(s);
    assert.equal(s.fightingData[1].st, 20, '2824 st 30-10=20');
    assert.equal(s.fightingData[1].st_item_broke_flag, true, '2825 st_item_broke_flag true');
    assert.equal(s.fightingData[0].df, 12, '2829 df 20-8=12');
    assert.equal(s.fightingData[0].df_item_broke_flag, true, '2830 df_item_broke_flag true');
    assert.equal(cAfterBroke.itemBroken, false, '2833 re-entry battleComplete itemBroken false');
    assert.equal(cAfterBroke.nowPlayer, 1, '2718 now_player 2->1');

    /* G3: 1P 会心の一撃(dmgRand=[4,1]) + 2P HP 0 クランプ + 終了判定(HP<=0 でアイテム破壊せずターン交代→battleWaiting battleEnd:true) */
    s.fightingData[1].hp = 10;
    const rKill = State.battle(s, { hitRand: 0, dmgRand: [4, 1] });
    assert.equal(rKill.hit, true, '1P hit');
    assert.equal(rKill.critical, true, '2367 critical true');
    assert.equal(rKill.time, 90, '2419 critical time 90');
    assert.equal(rKill.battleEndCount, 40, '2420 critical endCount 40');
    assert.equal(s.fightingData[1].hp, 0, '2363-2365 hp clamped to 0');

    /* 相手 HP<=0 のとき checkItemBroken(702-704: fd2.hp<=0 return false)は false → ターン交代で 2P へ → battleWaiting が battleEnd:true */
    const cKill = State.battleComplete(s);
    assert.equal(cKill.itemBroken, false, '702 fd2.hp<=0 no item break on KO');
    assert.equal(cKill.nowPlayer, 2, 'now_player 1->2');
    const wEnd = State.battleWaiting(s);
    assert.equal(wEnd.battleEnd, true, '1973-1976 2P HP<=0 battleEnd true');
    assert.equal(wEnd.nowPlayer, 2);

    /* H 工程5-2b: callBattleEnd(2161) / battleEnd(2898) / restartMode(2955) */
    assert.equal(s.restartReady, false, 'initial restartReady false');
    assert.equal(State.restartMode(s), false, 'restartMode ignored before battleEnd');
    const infoEnd = State.callBattleEnd(s);
    assert.equal(infoEnd.mode, 0, '2185 mode 0');
    assert.equal(infoEnd.nowPlayer, 2, '2P defeated');
    assert.equal(infoEnd.winner, 1, '2843 1P winner when now_player==2');
    assert.equal(infoEnd.timerDelay, 120, '2189 120ms');
    assert.equal(infoEnd.timerRepeat, 15, '2189 repeat 15');
    assert.equal(infoEnd.c0, true, 'C0 branch');

    State.battleEnd(s);
    assert.equal(s.restartReady, true, '2907 restartReady true');
    const okRestart = State.restartMode(s);
    assert.equal(okRestart, true, '2966-2973 mode 0 restart');
    assert.equal(s.restartReady, false, '2958 listener removed');
    assert.equal(s.state, State.STATES.CARD_1, '2971 bb2_state = 4');
    assert.equal(fc.protection_star, 0, 'protection_star preserved across restart_mode');

    /* I 工程5-3: power(2992) / powerComplete(3141) */
    s.state = State.STATES.CARDS_DONE;
    fc.now_player = 1;
    s.fightingData[0].hp = 40;
    s.fightingData[0].max_hp = 100;
    s.fightingData[0].pp = 1;
    s.fightingData[1].hp = 80;
    s.battleWaitingFirst = true;

    /* I1: 1P pp=1 で回復 → display_power 算出、powerComplete で hp 加算・pp=0・now_player 1→2 */
    const rPow1 = State.power(s, 4, 0);
    assert.equal(s.powerFlag, true, '2994 powerFlag true');
    assert.equal(rPow1.nowPlayer, 1, '1P power');
    assert.equal(rPow1.hasPp, true, '3006 pp > 0');
    assert.equal(rPow1.displayPower > 0, true, '3007-3008 basic_power > 0');
    assert.equal(rPow1.timerDelay, 80, '3024 80ms');
    assert.equal(rPow1.timerRepeat, 40, '3024 repeat 40');

    const cPow1 = State.powerComplete(s);
    assert.equal(s.powerFlag, false, '3151 powerFlag false');
    assert.equal(cPow1.recovered, true, 'recovered true');
    assert.equal(s.fightingData[0].hp, 40 + rPow1.displayPower, '3153 hp increased');
    assert.equal(s.fightingData[0].pp, 0, '3154 pp decremented to 0');
    assert.equal(cPow1.nowPlayer, 2, '3155 now_player 1->2');
    assert.equal(s.battleWaitingFirst, false, '3159 battleWaitingFirst false');

    /* I2: 2P pp=0(薬草0個) → hasPp=false、powerComplete で hp/pp 不変・now_player も 2 のまま(ターン交代しない) */
    s.fightingData[1].pp = 0;
    const hpBefore = s.fightingData[1].hp;
    const rPow0 = State.power(s, 0, 0);
    assert.equal(rPow0.nowPlayer, 2, '2P power');
    assert.equal(rPow0.hasPp, false, '3012 pp <= 0');
    const cPow0 = State.powerComplete(s);
    assert.equal(s.powerFlag, false, '3164 powerFlag false');
    assert.equal(cPow0.recovered, false, 'not recovered when pp==0');
    assert.equal(s.fightingData[1].hp, hpBefore, 'hp unchanged when pp==0');
    assert.equal(cPow0.nowPlayer, 2, '3168 not reached: now_player stays 2');

    /* J 工程5-4: select(3187) / selectState(3435) / setState(3491) / usePp(3575) / usePpComplete(3651) */
    fc.now_player = 1;
    s.fightingData[0].job = 7;           /* 魔法使い (job > 6 → selectMpEnable = true) */
    s.fightingData[0].hp = 30;
    s.fightingData[0].max_hp = 100;
    s.fightingData[0].mp = 20;
    s.fightingData[0].pp = 3;
    s.selectBattleMagic = true;

    /* J1: select → selectState(薬草1↔魔法0) → setState(-2→-1 開始) → setState(-1 キャンセル) */
    const rSel = State.select(s);
    assert.equal(rSel.nowPlayer, 1, '3224 1P select');
    assert.equal(rSel.selectMpEnable, true, '3239 job>6 selectMpEnable');
    assert.equal(s.selectActive, true, '3259-3260 selectActive');
    assert.equal(s.selectMpPp, 1, '3202 initial selectMpPp=1 (pp)');
    assert.equal(s.selectMpFunction, -2, '3203 initial -2');
    assert.equal(s.selectPpState, -2, '3204 initial -2');
    assert.equal(s.powerFlag, true, '3213 powerFlag true');

    /* 未選択で SELECT → 魔法(0)へ切替、もう一度で薬草(1)へ戻る */
    State.selectState(s);
    assert.equal(s.selectMpPp, 0, '3442 toggle to mp(0)');
    State.selectState(s);
    assert.equal(s.selectMpPp, 1, '3444 toggle back to pp(1)');

    /* 薬草(1)で SET → start_pp(selectPpState = -1)、そのまま SET → cancel_to_waiting */
    const stStartPp = State.setState(s);
    assert.equal(stStartPp.action, 'start_pp', '3534 start_pp');
    assert.equal(s.selectPpState, -1, '3534 selectPpState=-1');
    const stCancelPp = State.setState(s);
    assert.equal(stCancelPp.action, 'cancel_to_waiting', '3549-3551 cancel_to_waiting');
    assert.equal(s.powerFlag, false, '3539 powerFlag false');
    assert.equal(s.selectActive, false, 'selectActive false on cancel');

    /* J2: 薬草 2 個選択 → use_pp → usePp → usePpComplete */
    State.select(s);
    State.setState(s);                   /* -2 → -1 */
    State.selectState(s);                /* -1 → 1 */
    State.selectState(s);                /* 1 → 2 */
    assert.equal(s.selectPpState, 2, '3458 selectNextPpState -> 2');
    const stUsePp = State.setState(s);
    assert.equal(stUsePp.action, 'use_pp', '3565 use_pp');
    assert.equal(stUsePp.ppState, 2, 'ppState=2');
    assert.equal(s.powerFlag, true, '3557 powerFlag true');

    const rUsePp = State.usePp(s);
    assert.equal(rUsePp.nowPlayer, 1, '3578 1P usePp');
    assert.equal(rUsePp.displayPower, 40, 'usePpPower(max_hp=100, pp=2) = 40');
    assert.equal(rUsePp.timerDelay, 80, '3591 80ms');
    assert.equal(rUsePp.timerRepeat, 40, '3591 repeat 40');

    const cUsePp = State.usePpComplete(s);
    assert.equal(s.powerFlag, false, '3653 powerFlag false');
    assert.equal(s.fightingData[0].hp, 70, '3665 hp 30+40=70');
    assert.equal(s.fightingData[0].pp, 1, '3666 pp 3-2=1');
    assert.equal(cUsePp.nowPlayer, 2, '3667 now_player 1->2');
    assert.equal(cUsePp.toWaiting, true, '3675-3677 toWaiting true');

    /* K 工程5-5a: f0(3737) / f1(3850) / f2(3966) / f3(4080) / f4(4141) */
    /* K1: F0(トルマ・消費0): 1P(mp=98) が 2P(mp=10) から randOverride=5 奪う → 99 クランプ・2P mp=5・now_player 1→2 */
    fc.now_player = 1;
    s.fightingData[0].mp = 98;
    s.fightingData[1].mp = 10;
    const rF0 = State.f0(s, 5);
    assert.equal(s.battlePowerDisableFlag, true, '3738 battlePowerDisableFlag true');
    assert.equal(rF0.displayF0Mp, 5, '3743 display_f0_mp=5');
    assert.equal(rF0.timerDelay, 150, '3749 150ms');
    assert.equal(rF0.timerRepeat, 20, '3749 repeat 20');
    const mpAfterF0 = State.f0ApplyMp(s);
    assert.equal(mpAfterF0.mp1p, 99, '3766-3768 98+5 clamped to 99');
    assert.equal(mpAfterF0.mp2p, 5, '3769 10-5=5');
    const cF0 = State.f0Complete(s);
    assert.equal(s.battlePowerDisableFlag, false, '3826 battlePowerDisableFlag false');
    assert.equal(cF0.nowPlayer, 2, '3834-3838 now_player 1->2');

    /* K2: F1(ガンツ・消費2) & F2(デガンツ・消費5): 命中+MP減算+ターン反転 */
    fc.now_player = 1;
    s.fightingData[0].mp = 20;
    s.fightingData[1].hp = 100;
    const rF1 = State.f1(s, { hitRand: 0, dmgRand: [0, 0] });
    assert.equal(s.battleFlag, true, '3852 battleFlag true');
    assert.equal(rF1.hit, true, '3874 hit');
    assert.equal(rF1.displayDamage > 0, true, '3878 multi_damage > 0');
    const cF1 = State.f1Complete(s);
    assert.equal(s.fightingData[0].mp, 18, '3956 mp 20-2=18');
    assert.equal(cF1.nowPlayer, 2, 'battleComplete flips 1->2');

    const rF2 = State.f2(s, { hitRand: 0, dmgRand: [0, 0] });
    assert.equal(rF2.nowPlayer, 2, '2P f2');
    assert.equal(rF2.hit, true, '4017 hit');
    s.fightingData[1].mp = 15;
    const cF2 = State.f2Complete(s);
    assert.equal(s.fightingData[1].mp, 10, '4073 mp 15-5=10');
    assert.equal(cF2.nowPlayer, 1, 'battleComplete flips 2->1');

    /* K3: F3(リーモ・消費2・30%回復) & F4(デリーモ・消費4・50%回復) */
    fc.now_player = 1;
    s.fightingData[0].hp = 20;
    s.fightingData[0].max_hp = 100;
    s.fightingData[0].mp = 10;
    s.selectBattleMagic = true;
    const rF3 = State.f3(s);
    assert.equal(rF3.displayPower, 30, '4085 calcF3(100)=30');
    const cF3 = State.f3Complete(s);
    assert.equal(s.fightingData[0].hp, 50, '4117 hp 20+30=50');
    assert.equal(s.fightingData[0].mp, 8, '4118 mp 10-2=8');
    assert.equal(cF3.nowPlayer, 2, '4119 1->2');
    assert.equal(cF3.toWaiting, true, '4127-4129 toWaiting');

    s.fightingData[1].hp = 30;
    s.fightingData[1].max_hp = 100;
    s.fightingData[1].mp = 10;
    const rF4 = State.f4(s);
    assert.equal(rF4.displayPower, 50, '4152 calcF4(100)=50');
    const cF4 = State.f4Complete(s);
    assert.equal(s.fightingData[1].hp, 80, '4183 hp 30+50=80');
    assert.equal(s.fightingData[1].mp, 6, '4184 mp 10-4=6');
    assert.equal(cF4.nowPlayer, 1, '4185 2->1');
    assert.equal(cF4.toWaiting, true, '4189-4191 toWaiting');

    /* L 工程5-5b: f5〜f9(4204-4680) + autoBattleCpu(2101-2158) */
    /* L1: F5(ニャーヘ・消費3・相手DFダウン) → 1P が 2P(df1=10, df2=5) に使用 */
    fc.now_player = 1;
    s.fightingData[0].mp = 20;
    s.fightingData[1].df1 = 10;
    s.fightingData[1].df2 = 5;
    s.fightingData[1].df = 15;
    const rF5 = State.f5(s);
    assert.equal(s.battlePowerDisableFlag, true, '4205 battlePowerDisableFlag true');
    assert.equal(rF5.timerDelay, 150, '4209 150ms');
    assert.equal(rF5.timerRepeat, 12, '4209 repeat 12');
    const cF5 = State.f5Complete(s);
    assert.equal(s.battlePowerDisableFlag, false, '4267 battlePowerDisableFlag false');
    assert.equal(cF5.calcVal, 3, 'calcF5(df1=10)=3');
    assert.equal(s.fightingData[1].df1, 7, '4278 df1 10-3=7');
    assert.equal(s.fightingData[1].df, 12, '4279 df 5+7=12');
    assert.equal(s.fightingData[0].mp, 17, '4283 mp 20-3=17');
    assert.equal(cF5.nowPlayer, 2, '4284 1->2');

    /* L2: F6(カチコム・消費5・自分DFアップ・199クランプ) → 2P(df1=160, df2=10) が使用 */
    s.fightingData[1].df1 = 160;
    s.fightingData[1].df2 = 10;
    s.fightingData[1].mp = 20;
    State.f6(s);
    const cF6 = State.f6Complete(s);
    assert.equal(cF6.calcVal, 48, 'calcF6(df1=160)=48');
    assert.equal(s.fightingData[1].df1, 199, '4390-4392 df1 160+48 clamped to 199');
    assert.equal(s.fightingData[1].df, 199, '4394-4396 df 10+199 clamped to 199');
    assert.equal(s.fightingData[1].mp, 15, '4397 mp 20-5=15');
    assert.equal(cF6.nowPlayer, 1, '4398 2->1');

    /* L3: F7(ヘヘンダ・消費4・相手STダウン) & F8(タフニ・消費6・自分STアップ・199クランプ) */
    s.fightingData[1].st1 = 20;
    s.fightingData[1].st2 = 5;
    s.fightingData[1].st = 25;
    State.f7(s);
    const cF7 = State.f7Complete(s);
    assert.equal(cF7.calcVal, 6, 'calcF7(st1=20)=6');
    assert.equal(s.fightingData[1].st1, 14, '4483 st1 20-6=14');
    assert.equal(s.fightingData[1].st, 19, '4484 st 5+14=19');
    assert.equal(s.fightingData[0].mp, 13, '4488 mp 17-4=13');
    assert.equal(cF7.nowPlayer, 2, '4489 1->2');

    s.fightingData[1].st1 = 160;
    s.fightingData[1].st2 = 10;
    State.f8(s);
    const cF8 = State.f8Complete(s);
    assert.equal(cF8.calcVal, 48, 'calcF8(st1=160)=48');
    assert.equal(s.fightingData[1].st1, 199, '4597-4599 st1 160+48 clamped to 199');
    assert.equal(s.fightingData[1].st, 199, '4601-4603 st clamped to 199');
    assert.equal(s.fightingData[1].mp, 9, '4604 mp 15-6=9');
    assert.equal(cF8.nowPlayer, 1, '4605 2->1');

    /* L4: F9(マミロージャ・消費3・相手 pp_ignore_flag = true) */
    s.fightingData[1].pp_ignore_flag = false;
    State.f9(s);
    const cF9 = State.f9Complete(s);
    assert.equal(s.fightingData[1].pp_ignore_flag, true, '4667 pp_ignore_flag true');
    assert.equal(s.fightingData[0].mp, 10, '4668 mp 13-3=10');
    assert.equal(cF9.nowPlayer, 2, '4669 1->2');

    /* L5: autoBattleCpu(2101-2158) */
    s.fightingData[1].hp = 10;
    s.fightingData[1].max_hp = 100;
    s.fightingData[1].pp = 1;
    assert.equal(State.autoBattleCpu(s, 60, 50).action, 11, '1070-1075 hp<20% & pp>0 & rand>50 -> 11(power)');
    assert.equal(State.autoBattleCpu(s, 30, 50).action, 10, '1082-1083 rand<70 -> 10(battle)');
    s.fightingData[0].df = 5;
    s.fightingData[1].mp = 10;
    assert.equal(State.autoBattleCpu(s, 40, 50).action, 10, 'rand<70 still 10');
    s.fightingData[1].hp = 50;
    assert.equal(State.autoBattleCpu(s, 80, 50).action, 5, '1087-1091 rand>=70 & randMagic in [40,60) & df<=5 -> 5(F5)');

    /* M 工程6-1: C2PassCode + C2 主人公1・2枚目・敵カード待ち・パスコード入力・敵カード入力 */
    s.mode = 2;
    s.state = State.STATES.CARD_1;

    /* M1: 1枚目(戦士 '4901234567894' job=3) → 成功、2枚目待ち(state=5)へ */
    const rC2_1 = State.cardInsertC2(s, '4901234567894');
    assert.equal(rC2_1.ok, true, '4822 warrior hero ok');
    assert.equal(s.barcodeDataC2[0].job, 3, 'warrior job=3');
    assert.equal(s.barcodeDataC2[4].hp, s.barcodeDataC2[0].hp, '4827-4829 cloned into [0,2,4]');
    const nextC2_1 = State.cardInsertNextC2(s);
    assert.equal(nextC2_1.nextState, State.STATES.CARD_2, '4933 bb2_state 4->5');

    /* M2: 2枚目(戦士を入れると失敗・魔法使い '4901274567892' job=7 で成功) */
    const rC2_2fail = State.cardInsertC2(s, '4901234567894');
    assert.equal(rC2_2fail.ok, false, '4863 warrior rejected on magician slot');
    const rC2_2 = State.cardInsertC2(s, '4901274567892');
    assert.equal(rC2_2.ok, true, '4863 magician hero ok');
    assert.equal(s.barcodeDataC2[1].job, 7, 'magician job=7');
    const nextC2_2 = State.cardInsertNextC2(s);
    assert.equal(nextC2_2.nextState, State.STATES.CARD_3, '4951 bb2_state 5->6');
    assert.equal(s.c2WaitEnemySet, true, '4960 c2WaitEnemySet true');

    /* M3: 敵カード入力待ち → パスコード入力(C2PassCode 検証含む) */
    State.cardEnemyInsertWaitC2(s);
    assert.equal(s.c2WaitEnemySet, false, 'c2WaitEnemySet cleared');
    assert.equal(s.c2EnemyWaitActive, true, '5348/5356 c2EnemyWaitActive true');

    const c2p = new BB2.C2PassCode();
    c2p.init(s.barcodeDataC2[0], s.barcodeDataC2[1]);
    /* '4901234567894'(c12=4) + '4901274567892'(c12=2) -> unioncheckdigit = 6 */
    assert.equal(c2p.unioncheckdigit, 6, '25 unioncheckdigit 4+2=6');
    const pcStr = c2p.generate_passcode(80); /* special=80 -> passcode_number=5 -> 0055 + (6+2)=8 -> '00558' */
    assert.equal(pcStr, '00558', '54-60 generate_passcode(80) == 00558');

    /* selectPasscode → '00558' を addPasscode/setPasscode で入力 → パワーアップ適用 */
    State.selectPasscode(s);
    assert.equal(s.passcodeActive, true, '5388-5389 passcodeActive');
    assert.equal(s.passcode, '00000', '5429 initial 00000');
    State.setPasscode(s); /* 桁0('0')確定 → state=1 */
    State.setPasscode(s); /* 桁1('0')確定 → state=2 */
    for (let i = 0; i < 5; i++) State.addPasscode(s); /* 桁2 = '5' */
    State.setPasscode(s); /* 桁2確定 → state=3 */
    for (let i = 0; i < 5; i++) State.addPasscode(s); /* 桁3 = '5' */
    State.setPasscode(s); /* 桁3確定 → state=4 */
    for (let i = 0; i < 8; i++) State.addPasscode(s); /* 桁4 = '8' */
    const hp0Before = s.barcodeDataC2[4].hp;
    const resPc = State.setPasscode(s); /* 桁4確定 → state=5 判定 */
    assert.equal(resPc.done, true, '5546 done');
    assert.equal(resPc.valid, true, '5558 valid passcode');
    assert.equal(resPc.passcodeNumber, 5, 'passcodeNumber=5');
    assert.equal(s.barcodeDataC2[4].hp > hp0Before, true, '5562 powered up hp');

    /* M4: 敵カード入力(5616-5670) */
    State.cardEnemyInsertWaitC2(s);
    const rEnemy = State.cardEnemyInsertC2(s, '49011111');
    assert.equal(rEnemy.ok, true, '5637 enemy card ok');
    assert.equal(s.barcodeDataC2[6].barcode, '49011111', '5642 stored in barcodeDataC2[6]');
    const nextC2_3 = State.cardInsertNextC2(s);
    assert.equal(nextC2_3.nextState, State.STATES.CARD_4, '4994 bb2_state 6->7');
    assert.equal(s.friendSelectState, 0, '5002 friendSelectState=0');
    assert.equal(s.c2FriendSelectActive, true, '4994 c2FriendSelectActive=true');

    /* --- N. 工程6-2: C2 仲間選択・アイテム入力/スキップ・戦闘突入(4686-4707, 4964-5086, 5692-6062) --- */
    /* N1: addFriendState(5901-5931) — 0->1->2->1 切替と c2FriendSetReady=true */
    const af1 = State.addFriendState(s);
    assert.equal(af1.friendSelectState, 1, '5909-5910 0->1');
    assert.equal(s.c2FriendSetReady, true, '5929 c2FriendSetReady=true');
    const af2 = State.addFriendState(s);
    assert.equal(af2.friendSelectState, 2, '5913-5915 1->2');
    const af3 = State.addFriendState(s);
    assert.equal(af3.friendSelectState, 1, '5921-5923 2->1');

    /* N2: setFriendState(5933-5963) → アイテムスキップ cardInsertNextSetC2(5966-5975) → CARDS_DONE(8) */
    const sf1 = State.setFriendState(s);
    assert.equal(sf1.friendSelectState, 1, 'setFriendState keeps 1');
    assert.equal(s.c2FriendSelectActive, false, '5936-5939 friend select closed');
    assert.equal(s.c2ItemWaitActive, true, '5955-5962 c2ItemWaitActive=true');

    const skipRes = State.cardInsertNextSetC2(s);
    assert.equal(skipRes.before, State.STATES.CARD_4, '5014 case 7');
    assert.equal(skipRes.nextState, State.STATES.CARDS_DONE, '5025 bb2_state=8');
    assert.equal(s.barcodeDataC2[7], null, '5969 barcodeDataC2[7]=null');
    assert.equal(s.fightingData[0].hp, s.barcodeDataC2[4].hp, '5044 fightingData[0] is hero 1');
    assert.equal(s.fightingData[1].hp, s.barcodeDataC2[6].hp, '5059 fightingData[1] is enemy');

    /* N3: 敗北後残存仲間交代 cardInsertWaitC2Back(4686-4707) + friendAnimationC2Complete(5873-5899) + アイテム合体 cardItemInsertC2(6013-6062) */
    const backRes = State.cardInsertWaitC2Back(s);
    assert.equal(backRes.friendSelectState, 2, '4695 1->2 switched to magician');
    assert.equal(s.state, State.STATES.CARD_4, '4699 bb2_state=7');
    State.friendAnimationC2Complete(s);
    assert.equal(s.c2ItemWaitActive, true, '5892-5897 c2ItemWaitActive=true');

    const dfBeforeItem = s.barcodeDataC2[5].df;
    const itemRes = State.cardItemInsertC2(s, '49012347'); /* DF アイテム(df=28)合体 */
    assert.equal(itemRes.ok, true, '6032 item merge ok');
    assert.equal(s.barcodeDataC2[7].df, 28, '6036 item df in barcodeDataC2[7]');
    const nextC2_4 = State.cardInsertNextC2(s);
    assert.equal(nextC2_4.nextState, State.STATES.CARDS_DONE, '5025 bb2_state=8');
    assert.equal(s.fightingData[0].df, dfBeforeItem + 28, '5039 fightingData[0] merges hero + barcodeDataC2[7]');

    /* --- O. 工程6-3: C2 戦闘終了・戦利品獲得・戦闘後薬草/魔法回復・パスコード表示(2243-2295, 6064-6858) --- */
    /* O1: 敵撃破時の callBattleEnd(2245-2295) → battleEndC2(6780-6810) */
    s.fightingData[0].hp = 40;
    s.fightingData[0].mp = 15;
    s.fightingData[0].pp = 4;
    s.fightingData[1].hp = 0; /* 敵 HP=0 */
    s.barcodeDataC2[6].special = 85; /* special 80〜99: パスコード対象 */
    s.fightingCalc.now_player = 2; /* 2P(敵)敗北 */
    const cbeWin = State.callBattleEnd(s);
    assert.equal(cbeWin.mode, 2, '2246 mode=2');
    assert.equal(cbeWin.c2BothDead, false, '2279 hero alive');
    assert.equal(s.barcodeDataC2[5].hp, 40, '2258-2260 copied hero2 hp/mp/pp');
    assert.equal(s.barcodeDataC2[6].hp, 0, '2282 copied enemy hp=0');

    const bec2Win = State.battleEndC2(s);
    assert.equal(bec2Win.enemyDefeated, true, '6791 enemyDefeated=true');
    assert.equal(bec2Win.passcodeAvailable, true, '6798-6800 special 85 -> passcodeAvailable=true');
    assert.equal(s.c2BattleGetActive, true, '6802-6803 c2BattleGetActive=true');
    assert.equal(s.selectMagicPpUse, false, '6801 selectMagicPpUse=false');

    /* O2: showPasscode(6814-6858) → パスコード表示＆強化適用 → battleEndC2 復帰 */
    const spRes = State.showPasscode(s);
    assert.equal(spRes.passcode.length, 5, '6831 5-digit passcode');
    assert.equal(spRes.passcodeNumber, 35, '6851 special 85 -> passcodeNumber=35');
    assert.equal(s.c2ShowPasscodeHold, true, '6826-6827 c2ShowPasscodeHold=true');
    State.battleEndC2(s); /* l_power 離す/再押下で復帰 */
    assert.equal(s.c2ShowPasscodeHold, false, '6781-6782 hold cleared');
    assert.equal(s.c2BattleGetActive, true, '6802-6803 battle_get resumed');

    /* O3: selectEndState(6433-6494) → 戦闘後薬草使用 usePp/usePpComplete(3679-3683) → magicPpUseCopy(6405-6429) */
    s.fightingData[0].hp = 30;
    s.fightingData[0].max_hp = 100;
    s.fightingData[0].pp = 3;
    const ses1 = State.selectEndState(s, true);
    assert.equal(ses1.action, 'enter_select', '6437-6465 enter_select');
    assert.equal(s.selectBattleMagic, false, '6464 selectBattleMagic=false');
    assert.equal(s.selectActive, true, '3259-3260 selectActive=true');
    State.setState(s); /* -2 -> -1 (薬草選択開始) */
    State.selectState(s); /* -1 -> 1 (薬草1個) */
    const setPp = State.setState(s);
    assert.equal(setPp.action, 'use_pp', '3565 use_pp');
    State.usePp(s);
    const upc = State.usePpComplete(s);
    assert.equal(upc.toWaiting, false, '3679 C2 post-battle');
    assert.equal(upc.toSelectEndState, true, '3682 toSelectEndState=true');
    assert.equal(s.selectMagicPpUse, true, '3680 selectMagicPpUse=true');
    assert.equal(s.barcodeDataC2[5].hp, 50, '6413 magicPpUseCopy copied recovered hp(30+20)');
    assert.equal(s.barcodeDataC2[5].pp, 2, '6415 magicPpUseCopy copied pp(3-1)');
    const ses2 = State.selectEndState(s, false);
    assert.equal(ses2.action, 'start_battle_get', '6469-6480 back to battle_get');
    assert.equal(ses2.canSelect, false, '6473 select disabled after 1 recovery');

    /* O4: getMpPp(6497-6709) — special=66(HP+3, PP+5, 魔法使いは MP+5) */
    s.barcodeDataC2[6].special = 66;
    const hpBeforeGet = s.barcodeDataC2[5].hp;
    const ppBeforeGet = s.barcodeDataC2[5].pp;
    const mpBeforeGet = s.barcodeDataC2[5].mp;
    const gmp = State.getMpPp(s);
    assert.equal(gmp.timerDelay, 100, '6704 timerDelay=100');
    assert.equal(gmp.timerRepeat, 20, '6704 timerRepeat=20');
    assert.equal(s.barcodeDataC2[5].hp, hpBeforeGet + 3, '6529 hp+3');
    assert.equal(s.barcodeDataC2[5].pp, ppBeforeGet + 5, '6530 pp+5');
    assert.equal(s.barcodeDataC2[5].mp, mpBeforeGet + 5, '6531 mp+5');

    /* O5: 味方1人敗北(片方健在) と 両方死亡(c2BothDead=true) */
    s.friendSelectState = 2;
    s.fightingData[0].hp = 0; /* 魔法使い敗北 */
    s.fightingData[1].hp = 25; /* 敵健在 */
    s.fightingCalc.now_player = 1;
    const cbeLose1 = State.callBattleEnd(s);
    assert.equal(cbeLose1.c2BothDead, false, 'warrior still alive');
    assert.equal(s.barcodeDataC2[5].live, false, '2262 magician live=false');
    const bec2Lose1 = State.battleEndC2(s);
    assert.equal(bec2Lose1.enemyDefeated, false, '6805 enemy still alive');
    assert.equal(s.c2LoseChoiceActive, true, '6807-6808 c2LoseChoiceActive=true');

    s.friendSelectState = 1;
    s.fightingData[0].hp = 0; /* 戦士も敗北 */
    const cbeLoseBoth = State.callBattleEnd(s);
    assert.equal(cbeLoseBoth.c2BothDead, true, '2267 both heroes dead');
    assert.equal(s.barcodeDataC2[4].live, false, '2255 warrior live=false');
  }

  /* --- P. 工程7-1: C1WorldData + C1 主人公入力・ステージ選択・敵出現弧(barcode2.as 6865-7756・7845-7894) --- */
  {
    const w = new BB2.C1WorldData();
    w.init(3, 5);
    assert.equal(w.unioncheckdigit, 8, 'C1WorldData init(3,5) -> unioncheckdigit=8');
    assert.equal(w.get_world_number(), 0, 'C1WorldData initial world index=0 (L-1)');
    assert.equal(w.get_enemy_number(), 0, 'C1WorldData initial enemy index=0 (01)');
    assert.equal(w.is_key(), true, 'C1WorldData initial L1-1 is in default_key[0]');

    const selIdx = w.select_enemy_number(0.5);
    assert.equal(selIdx, 2, 'select_enemy_number(0.5) returns floor(0.5 * 5) = 2');

    const ep = w.generate_enemy_paramater();
    assert.equal(ep instanceof BB2.BarcodeData, true, 'generate_enemy_paramater returns BarcodeData');
    assert.equal(ep.hp > 0, true, 'enemy hp > 0');
    assert.equal(ep.st > 0, true, 'enemy st > 0');
    assert.equal(ep.df > 0, true, 'enemy df > 0');

    assert.equal(w.get_passcode_number(0), 10, 'stage 0 passcode_number = 10');
    assert.equal(w.get_passcode_number(3), 31, 'stage 3 passcode_number = 31');

    /* パワーアップ・ジャンプパスコード検証 */
    const baseHero = new BB2.BarcodeData();
    baseHero.hp = 100; baseHero.st = 90; baseHero.df = 120; baseHero.max_hp = 100;
    assert.equal(w.c1_powerup_passcode('815'), true, 'c1_powerup_passcode(815) = true');
    const pu815 = w.generate_passcode_barcode_data(baseHero, '815');
    assert.equal(pu815.hp, 144, '815 passcode: floor(100*1.4)+4 = 144');
    assert.equal(pu815.st, 130, '815 passcode: floor(90*13/9) = 130');
    assert.equal(pu815.df, 160, '815 passcode: floor(120*16/12) = 160');

    assert.equal(w.jump_stage_passcode('319'), true, '319 jump passcode valid when unioncheckdigit=8 (1+8=9)');
    assert.equal(w.jump_stage_passcode('388'), true, '388 jump passcode valid when unioncheckdigit=8 (0+8=8)');
    assert.equal(w.jump_stage_passcode('315'), false, '315 jump passcode invalid when unioncheckdigit=8');

    /* State 工程7-1 一連遷移検証 */
    const s = State.create();
    State.standby(s);
    State.powerOn(s);
    State.powerOnComplete(s);
    State.incMode(s); /* mode=1 (C1) */
    assert.equal(s.mode, 1, 'mode=1 (C1)');
    State.setMode(s);
    State.rollProtectionStar(s);
    State.decideStarComplete(s);
    assert.equal(s.state, State.STATES.CARD_1, 'bb2_state=4 (C1 1枚目: 戦士待ち)');

    /* 1枚目(戦士)に魔法使いバーコードを入れるとエラー */
    const magCode = '4901274567892'; /* job=7(魔法使い) */
    const errJob = State.cardInsertC1(s, magCode);
    assert.equal(errJob.ok, false, 'warrior slot rejects magician card');
    assert.equal(errJob.data.job > 6, true, 'failed card is magician');

    /* 1枚目(戦士)に戦士バーコードを入力 */
    const warCode = '4901234567894'; /* job=3(戦士) */
    const res1 = State.cardInsertC1(s, warCode);
    assert.equal(res1.ok, true, 'warrior card accepted in slot 1');
    assert.equal(s.barcodeDataC1[0].hp > 0, true, 'barcodeDataC1[0] saved');
    assert.equal(s.barcodeDataC1[4].hp, s.barcodeDataC1[0].hp, 'barcodeDataC1[4] cloned');

    const next1 = State.cardInsertNextC1(s);
    assert.equal(next1.before, State.STATES.CARD_1, '7159-7174 before=4');
    assert.equal(s.state, State.STATES.CARD_2, 'bb2_state=5 (C1 2枚目: 魔法使い待ち)');

    /* 2枚目(魔法使い)に魔法使いバーコードを入力 */
    const res2 = State.cardInsertC1(s, magCode);
    assert.equal(res2.ok, true, 'magician card accepted in slot 2');
    assert.equal(s.barcodeDataC1[1].hp > 0, true, 'barcodeDataC1[1] saved');
    assert.equal(s.barcodeDataC1[5].hp, s.barcodeDataC1[1].hp, 'barcodeDataC1[5] cloned');

    const next2 = State.cardInsertNextC1(s);
    assert.equal(next2.before, State.STATES.CARD_2, '7177-7205 before=5');
    assert.equal(s.state, State.STATES.CARD_3, 'bb2_state=6');
    assert.equal(s.c1WaitStageSelectSet, true, 'c1WaitStageSelectSet=true');

    /* SET 押下でステージ選択へ(7446-7544) */
    const stg = State.c1StageSelectClick(s);
    assert.equal(stg.stageText, 'E-1', 'initial stage=E-1');
    assert.equal(stg.worldText, 'L-1', 'initial world=L-1');
    assert.equal(s.c1StageSelectActive, true, 'c1StageSelectActive=true');

    /* SELECT 押下でワールド切替(7606-7620) */
    const esel = State.c1StageEnemySelect(s);
    assert.equal(esel.worldText, 'L-2', 'world switched to L-2');

    /* l_power で主人公再入力 → SET 2回でスキップ復帰(6865-6881, 7110-7136) */
    State.cardInsertRetryC1(s);
    assert.equal(s.state, State.STATES.CARD_1, 'retry sets state=4');
    assert.equal(s.c1CardSkipActive, true, 'c1CardSkipActive=true');
    const sk1 = State.cardInsertSkipC1(s);
    assert.equal(sk1.nextState, State.STATES.CARD_2, 'skip 1 -> state=5');
    const sk2 = State.cardInsertSkipC1(s);
    assert.equal(sk2.nextState, State.STATES.CARD_3, 'skip 2 -> state=6');
    assert.equal(s.c1WaitStageSelectSet, true, 'c1WaitStageSelectSet=true after skip 2');
    State.c1StageSelectClick(s);

    /* SET 押下で敵決定 → 敵出現 → 出撃キャラ選択待ち(7628-7756, 7845-7894) */
    const eset = State.c1StageEnemySet(s, 0.0);
    assert.equal(eset.worldText, 'L-1', 'c1StageEnemySet worldText=L-1');
    assert.equal(eset.enemyText, ' 01', 'c1StageEnemySet enemyText=" 01"');
    assert.equal(s.c1StageSelectActive, false, 'c1StageSelectActive=false');
    const app = State.appearEnemy(s);
    assert.equal(app.enemy.hp > 0, true, 'appearEnemy generated enemy hp > 0');
    const sf = State.selectFriendC1(s);
    assert.equal(sf.enemy.hp, app.enemy.hp, 'selectFriendC1 enemy matches');
    assert.equal(s.c1FriendSelectActive, true, 'c1FriendSelectActive=true');
    assert.equal(s.c1EscapeFromBattleReady, true, 'c1EscapeFromBattleReady=true');

    /* --- Q. 工程7-2: C1 逃走・出撃キャラ決定・アイテム入力/スキップ・パスコード入力弧(2038-2098, 7761-8515) --- */
    /* Q1: 戦闘前逃走失敗(rand=0)と逃走成功(rand=1) */
    const efbFail = State.escapeFromBattle(s, 0);
    assert.equal(efbFail.escaped, false, '7780 escapeFromBattle rand=0 -> escaped=false');
    assert.equal(s.c1EscapeFromBattleReady, false, '7762 c1EscapeFromBattleReady cleared after 1 attempt');
    State.selectFriendC1(s); /* 再び逃走可能状態へ */
    const efbOk = State.escapeFromBattle(s, 1);
    assert.equal(efbOk.escaped, true, '7772 escapeFromBattle rand=1 -> escaped=true');
    assert.equal(s.c1FriendSelectActive, false, 'c1FriendSelectActive cleared on escape');

    /* Q2: C1 パスコード入力(8107-8315) — パワーアップ 815 / エラー / ステージジャンプ 31X */
    State.c1StageSelectClick(s);
    const pcInit = State.c1InputPasscode(s);
    assert.equal(pcInit.passcode, '000', '8154 initial passcode=000');
    assert.equal(s.c1PasscodeActive, true, '8155 c1PasscodeActive=true');

    /* 815 を入力 */
    for (let i = 0; i < 8; i++) State.c1InputAddPasscode(s);
    assert.equal(s.c1Passcode, '800', 'digit 0 -> 8');
    assert.equal(State.c1InputSetPasscode(s).done, false, 'digit 0 set');
    State.c1InputAddPasscode(s);
    assert.equal(s.c1Passcode, '810', 'digit 1 -> 1');
    assert.equal(State.c1InputSetPasscode(s).done, false, 'digit 1 set');
    for (let i = 0; i < 5; i++) State.c1InputAddPasscode(s);
    assert.equal(s.c1Passcode, '815', 'digit 2 -> 5 (815)');
    const hpBeforePu = s.barcodeDataC1[4].hp;
    const puRes = State.c1InputSetPasscode(s);
    assert.equal(puRes.done, true, '8223 3rd set executes passcode');
    assert.equal(puRes.result, 'powerup', '8243 815 -> powerup');
    assert.equal(s.barcodeDataC1[4].hp, Math.floor(hpBeforePu * 1.4) + 4, '8248 hero1 powered up by 815');

    /* 無効パスコード 000 -> error */
    State.c1StageSelect(s);
    State.c1InputPasscode(s);
    State.c1InputSetPasscode(s);
    State.c1InputSetPasscode(s);
    const errPc = State.c1InputSetPasscode(s);
    assert.equal(errPc.result, 'error', '8307 000 -> error');

    /* Q3: 出撃キャラ選択(addFriendStateC1 / setFriendStateC1) + アイテムスキップ / アイテム入力 */
    State.c1StageSelectClick(s);
    State.c1StageEnemySet(s, 0.0);
    State.appearEnemy(s);
    State.selectFriendC1(s);
    const af1 = State.addFriendStateC1(s);
    assert.equal(af1.friendSelectStateC1, 1, '7902 0 -> 1 (warrior)');
    assert.equal(s.c1EscapeFromBattleReady, false, '7898 escape disabled after SELECT');
    assert.equal(s.c1FriendSetReady, true, '7925 c1FriendSetReady=true');
    const af2 = State.addFriendStateC1(s);
    assert.equal(af2.friendSelectStateC1, 2, '7910 1 -> 2 (magician)');
    const af3 = State.addFriendStateC1(s);
    assert.equal(af3.friendSelectStateC1, 1, '7918 2 -> 1 (warrior)');

    State.setFriendStateC1(s);
    assert.equal(s.c1ItemWaitActive, true, '7949/7954 c1ItemWaitActive=true');

    /* アイテムスキップ(cardInsertNextSetC1) → CARDS_DONE(8) */
    const skipItemRes = State.cardInsertNextSetC1(s);
    assert.equal(skipItemRes.nextState, State.STATES.CARDS_DONE, '7977 -> 7265 CARDS_DONE');
    assert.equal(s.fightingData[0].hp, s.barcodeDataC1[4].hp, 'fightingData[0] created without item');
    assert.equal(s.fightingData[1].cpu, true, '7240 enemy cpu=true');

    /* Q4: 戦闘中逃走失敗(escape rand=0 -> escapeFailedBattleWaiting) と 逃走成功(escape rand=1) */
    s.fightingCalc.now_player = 1;
    const escFail = State.escape(s, 0);
    assert.equal(escFail.escaped, false, '2064 battle escape rand=0 -> escaped=false');
    const efbw = State.escapeFailedBattleWaiting(s);
    assert.equal(s.fightingCalc.now_player, 2, '2083 now_player switched to 2 (CPU)');
    assert.equal(efbw.nowPlayer, 2, '2097 battleWaiting on CPU turn');

    const escOk = State.escape(s, 1);
    assert.equal(escOk.escaped, true, '2045 battle escape rand=1 -> escaped=true');
    assert.equal(s.friendSelectStateC1, 0, '2056 friendSelectStateC1 reset to 0');
    const fromEsc = State.c1StageSelectFromEscape(s);
    assert.equal(s.state, State.STATES.CARD_3, 'returned to CARD_3 (6) from escape');
    assert.equal(fromEsc.stageText, 'E-1', '7571 stageText=E-1');

    /* Q5: アイテムカード入力(cardItemInsertC1) → 合体して戦闘突入 */
    State.c1StageEnemySet(s, 0.0);
    State.appearEnemy(s);
    State.selectFriendC1(s);
    State.addFriendStateC1(s); /* warrior(1) */
    State.setFriendStateC1(s);
    const dfBeforeC1Item = s.barcodeDataC1[4].df;
    const c1ItemRes = State.cardItemInsertC1(s, '49012347'); /* 防具アイテム df=28 */
    assert.equal(c1ItemRes.ok, true, '8038 item accepted');
    assert.equal(s.barcodeDataC1[6].df, 28, '8064 barcodeDataC1[6].df=28');
    const nextC1Battle = State.cardInsertNextC1(s);
    assert.equal(nextC1Battle.nextState, State.STATES.CARDS_DONE, 'CARDS_DONE after item');
    assert.equal(s.fightingData[0].df, dfBeforeC1Item + 28, '7235 hero df merged with item df');

    /* --- R. 工程7-3: C1 戦闘終了・鍵取得/喪失・復活/情報抽選・仲間交代・ボス撃破/クリアパスコード --- */
    /* R1: 敵撃破(鍵持ち) -> callBattleEnd -> battleEndC1(get_key) -> battleEndC1(battle_get) */
    const cw = s.c1WorldData;
    /* L-1 の 01 ('L1-1') にのみ残り1つの鍵を持たせ、すでに2つ鍵を取得済みの状態(key.length===1)にする */
    cw.key = ['L1-1'];
    assert.equal(cw.key_number(), 2, '2 keys collected before battle');
    assert.equal(cw.is_key(), true, 'current enemy holds a key');

    s.fightingData[1].hp = 0;
    s.fightingData[1].live = false;
    s.fightingCalc.now_player = 2; /* 2P(enemy) defeated */
    const cbeWin = State.callBattleEnd(s);
    assert.equal(cbeWin.mode, 1, '2196 callBattleEnd mode=1');
    assert.equal(cbeWin.c1BothDead, false, 'not both dead');
    assert.equal(s.barcodeDataEnemy.hp, 0, '2212 barcodeDataEnemy updated from fd[1]');

    const beKey = State.battleEndC1(s);
    assert.equal(beKey.action, 'get_key', '8531 enemy had key -> get_key');
    assert.equal(beKey.hadKey, 2, '8533 had_key_number=2');
    assert.equal(beKey.hasKey, 3, '8537 has_key_number=3 after delete_key');
    assert.equal(cw.world.includes('L-H'), true, '8552 L-H unlocked when has_key_number===3');

    const beGet = State.battleEndC1(s);
    assert.equal(beGet.action, 'battle_get', '8613 second battleEndC1 -> battle_get');
    assert.equal(s.c1BattleGetActive, true, '8618 c1BattleGetActive=true');
    assert.equal(s.c1LPowerReady, true, '8616 c1LPowerReady=true');

    /* R2: 勝利後 l_power 押下(battleEndLPower) — 魔法使い敵(en=0)で相方復活(rebirthEnd) & 戦士敵(en=1)で鍵情報(enemyInfomationEnd) */
    s.barcodeDataC1[5].live = false;
    s.barcodeDataC1[5].hp = 0;
    const lpRebirth = State.battleEndLPower(s, 1); /* coin=1 -> rebirth_anim */
    assert.equal(lpRebirth.outcome, 'rebirth_anim', '9121 dead ally + coin=1 -> rebirth_anim');
    assert.equal(s.c1LPowerReady, false, '9101 c1LPowerReady consumed');
    State.rebirthEnd(s);
    assert.equal(s.barcodeDataC1[5].live, true, '9235 magician revived from barcodeDataC1[3]');
    assert.equal(s.c1BattleGetActive, true, '9248 c1BattleGetActive restored');

    /* 戦士敵(en=1)の情報抽選 */
    cw.enemy[0] = ['02']; /* enemy_number = 1 */
    cw.key = ['L3-1'];    /* 鍵所持数を2に戻す(key_number() === 2 !== 3) */
    s.c1LPowerReady = true;
    const lpInfo = State.battleEndLPower(s, 1);
    assert.equal(lpInfo.outcome, 'info_anim', '9137 warrior enemy + coin=1 -> info_anim');
    assert.equal(lpInfo.enemyNumber, 1, 'enemyNumber=1');
    State.enemyInfomationEnd(s);
    assert.equal(s.c1BattleGetActive, true, '9315 c1BattleGetActive restored after info');

    /* R3: C1 戦闘後回復(selectEndState + usePpComplete -> magicPpUseCopy) & 戦利品獲得(getMpPpC1 + displayMpPpC1Complete) */
    s.fightingData[0].hp = 30;
    s.fightingData[0].max_hp = 100;
    s.fightingData[0].pp = 3;
    const sesEnter = State.selectEndState(s, true);
    assert.equal(sesEnter.action, 'enter_select', '6463 enter_select in C1');
    State.setState(s); /* -2 -> -1 (薬草選択開始) */
    State.selectState(s); /* -1 -> 1 (薬草1個) */
    const setHealC1 = State.setState(s);
    assert.equal(setHealC1.action, 'use_pp', '3565 use_pp in C1');
    State.usePp(s);
    const upcC1 = State.usePpComplete(s);
    assert.equal(upcC1.toSelectEndState, true, '3682 toSelectEndState=true in C1');
    assert.equal(s.selectMagicPpUse, true, '3680 selectMagicPpUse=true in C1');
    assert.equal(s.barcodeDataC1[4].hp, 50, '6416 barcodeDataC1[4].hp recovered (30+20)');
    assert.equal(s.barcodeDataC1[4].pp, 2, '6418 barcodeDataC1[4].pp decremented (3-1)');
    const sesResumeC1 = State.selectEndState(s, false);
    assert.equal(sesResumeC1.action, 'start_battle_get', '6481-6492 back to battle_get in C1');

    const stBeforeGet = s.barcodeDataC1[4].st;
    const ppBeforeGet = s.barcodeDataC1[4].pp;
    s.barcodeDataEnemy.job = 1; /* 戦士系敵 -> ST + stDf, PP + 5 */
    const gmpC1 = State.getMpPpC1(s);
    assert.equal(gmpC1.timerRepeat, 20, '9602 Timer(100, 20)');
    assert.equal(s.barcodeDataC1[4].st, Math.min(199, stBeforeGet + gmpC1.stDf), '9552 ST increased');
    assert.equal(s.barcodeDataC1[4].pp, Math.min(99, ppBeforeGet + 5), '9553 PP + 5');
    const afterGetStg = State.displayMpPpC1Complete(s);
    assert.equal(s.state, State.STATES.CARD_3, '9611 back to stage select (CARD_3)');
    assert.equal(afterGetStg.stageText, 'E-1', 'stage select resumed');

    /* R4: 味方1人敗北 -> 鍵喪失(lose_key) -> 残存仲間交代(cardInsertWaitC1Back -> friendAnimationC1Complete) */
    State.c1StageEnemySet(s, 0.0);
    State.appearEnemy(s);
    State.selectFriendC1(s);
    State.addFriendStateC1(s); /* warrior(1) */
    State.setFriendStateC1(s);
    State.cardInsertNextSetC1(s); /* CARDS_DONE */

    /* 1P(warrior)敗北・2P(enemy)生存・魔法使い生存・現在敵は鍵なし・手持ち鍵あり */
    cw.key = ['L3-1', 'L4-1']; /* 未取得鍵2個 = 手持ち鍵 1 個 */
    assert.equal(cw.is_key(), false, 'current L-1 enemy has no key');
    assert.equal(cw.key_number(), 1, 'player has 1 key');
    s.fightingData[0].hp = 0;
    s.fightingData[0].live = false;
    s.fightingData[1].hp = 30;
    s.fightingData[1].live = true;
    s.fightingCalc.now_player = 1;
    const cbeLose1 = State.callBattleEnd(s);
    assert.equal(cbeLose1.c1BothDead, false, 'magician still alive -> c1BothDead=false');
    assert.equal(s.barcodeDataC1[4].live, false, '2200 warrior marked dead');

    const beLoseKey = State.battleEndC1(s);
    assert.equal(beLoseKey.action, 'lose_key', '8630 enemy steals key -> lose_key');
    assert.equal(beLoseKey.hadKey, 1, 'hadKey=1');
    assert.equal(beLoseKey.hasKey, 0, 'hasKey=0 after add_key');
    assert.equal(cw.is_key(), true, 'current enemy now holds the stolen key');

    const beLoseChoice = State.battleEndC1(s);
    assert.equal(beLoseChoice.action, 'lose_choice', '8672 second battleEndC1 -> lose_choice');
    assert.equal(s.c1LoseChoiceActive, true, 'c1LoseChoiceActive=true');

    const backRes = State.cardInsertWaitC1Back(s);
    assert.equal(backRes.friendSelectStateC1, 2, '9353 switched from 1(warrior) to 2(magician)');
    assert.equal(s.state, State.STATES.CARD_4, '9357 bb2_state=7 (CARD_4)');
    const facRes = State.friendAnimationC1Complete(s);
    assert.equal(facRes.state, State.STATES.CARD_3, '9506 bb2_state=6 (CARD_3)');
    assert.equal(s.c1ItemWaitActive, true, '9509 c1ItemWaitActive=true for replacement hero');
    State.cardInsertNextSetC1(s); /* skip item -> CARDS_DONE */
    assert.equal(s.state, State.STATES.CARDS_DONE, 'back in CARDS_DONE with magician');

    /* R5: L-H ボス(HH)撃破 -> defeatBoss -> showPasscodeC1 -> defeatBossComplete(次ステージ E-2 へ) */
    cw.world.push('L-H');
    cw.select_world = cw.world.indexOf('L-H'); /* get_world_number() === 5 */
    cw.enemy[5] = ['HH'];                     /* get_enemy_number() === 4 */
    s.fightingData[1].hp = 0;
    s.fightingData[1].live = false;
    s.fightingCalc.now_player = 2;
    State.callBattleEnd(s);
    const beBoss = State.battleEndC1(s);
    assert.equal(beBoss.action, 'defeat_boss', '8604 L-H HH defeated -> defeat_boss');
    assert.equal(beBoss.hp1Text, 'E-1', '8726 stage E-1 displayed');
    assert.equal(beBoss.canAdvanceStage, true, '8742 select_stage=0 <= 2 can advance');
    assert.equal(s.c1DefeatBossActive, true, 'c1DefeatBossActive=true');

    const spc1 = State.showPasscodeC1(s);
    assert.equal(spc1.passcodeNumber, 10, '8764 E-1 passcodeNumber=10');
    assert.equal(spc1.passcode.length, 5, '8767 5-part passcode generated');
    assert.equal(s.c1ShowPasscodeHold, true, 'c1ShowPasscodeHold=true');

    /* l_power を離して defeatBoss に復帰し、SET で次ステージへ */
    State.defeatBoss(s);
    const dbc = State.defeatBossComplete(s);
    assert.equal(dbc.selectStage, 1, '8834 advanced to select_stage=1 (E-2)');
    assert.equal(s.state, State.STATES.CARD_3, '8845 back to stage select (CARD_3)');

    /* --- S. Phase 6: セーブ・ロード・クローン(8852-9098, 9666, Store.saveGameC1/loadGameC1) --- */
    /* S1: ステージ選択画面(c1StageSelect)でのセーブ(call_save_function = c1_stage_select_click) */
    assert.equal(s.c1SaveReady, true, '7537 c1SaveReady=true at stage select');
    assert.equal(s.callSaveFunction, 'c1_stage_select_click', '7536 callSaveFunction=c1_stage_select_click');
    const savedHp4 = s.barcodeDataC1[4].hp;
    const savedHp5 = s.barcodeDataC1[5].hp;
    const sv1 = State.save(s);
    assert.equal(sv1.timerDelay, 200, '8891 Timer(200)');
    assert.equal(s.c1SaveReady, false, '8855 c1SaveReady cleared');
    assert.equal(s.c1StageSelectActive, false, '8874-8877 stage select listeners cleared');
    s.c1SaveAnimCompleteReady = true; /* 8922 count===10 で受付開始 */
    const sac1 = State.saveAnimationComplete(s);
    assert.equal(sac1.saved, true, '8953-8954 saved to localStorage');
    assert.equal(sac1.target, 'c1_stage_select_click', '8957 returned to c1_stage_select_click');
    assert.equal(s.c1StageSelectActive, true, 'stage select resumed after save');

    /* S2: 戦闘勝利・戦利品待ち(battleEndC1)でのセーブ(call_save_function = battle_end_c1) */
    s.state = State.STATES.CARDS_DONE;
    s.barcodeDataEnemy.hp = 0;
    cw.key = ['L4-2']; /* 現在敵(L-1 01)は鍵なし */
    cw.select_world = 0;
    cw.select_enemy = 0;
    const beBeforeSave = State.battleEndC1(s);
    assert.equal(beBeforeSave.action, 'battle_get', '8613 battle_get');
    assert.equal(s.c1SaveReady, true, '8615 c1SaveReady=true at battle_end_c1');
    assert.equal(s.callSaveFunction, 'battle_end_c1', '8614 callSaveFunction=battle_end_c1');
    s.barcodeDataC1[4].hp = 777; /* セーブ値更新確認用 */
    State.save(s);
    s.c1SaveAnimCompleteReady = true;
    const sac2 = State.saveAnimationComplete(s);
    assert.equal(sac2.saved, true, 'saved from battle_end_c1');
    assert.equal(sac2.target, 'battle_end_c1', '8957 returned to battle_end_c1');
    assert.equal(s.c1BattleGetActive, true, 'battle_get resumed after save');

    /* S3: 電源OFF→再起動→C1 1枚目待ちでロード(load -> loadAnimationComplete -> cardInsertNextC1) */
    State.powerOff(s);
    State.powerOn(s);
    State.powerOnComplete(s);
    State.incMode(s); /* C1 */
    State.setMode(s);
    State.rollProtectionStar(s);
    State.decideStarComplete(s);
    assert.equal(s.state, State.STATES.CARD_1, 'C1 1枚目待ち(bb2_state=4)');
    assert.equal(s.c1WorldData, null, 'c1WorldData is null before load');

    const ld = State.load(s);
    assert.equal(ld.timerDelay, 200, '8986 Timer(200)');
    s.c1LoadAnimCompleteReady = true; /* 9017 count===10 で受付開始 */
    const lac = State.loadAnimationComplete(s);
    assert.equal(lac.loaded, true, '9051-9054 c1WorldData and barcodeDataC1 restored');
    assert.equal(s.state, State.STATES.CARD_2, '9057 bb2_state=5');
    assert.equal(s.c1WorldData.select_stage, 1, 'restored select_stage=1 (E-2)');
    assert.equal(s.c1WorldData.get_world_number(), 0, 'restored C1WorldData has prototype methods');
    assert.equal(s.barcodeDataC1[4].hp, 777, 'restored barcodeDataC1[4].hp=777');
    assert.equal(s.barcodeDataC1[5].hp, savedHp5, 'restored barcodeDataC1[5].hp');

    const nextAfterLoad = State.cardInsertNextC1(s); /* 9064 TIMER_COMPLETE -> card_insert_next_c1 */
    assert.equal(nextAfterLoad.nextState, State.STATES.CARD_3, '7180 bb2_state=6 after load_status_animation');
    assert.equal(s.c1WaitStageSelectSet, true, '7203 c1WaitStageSelectSet=true');

    /* S4: createCloneInstance(9666-9693) */
    assert.equal(State.createCloneInstance(null), null, '9668 null -> null');
    const clonedWorld = State.createCloneInstance(s.c1WorldData);
    assert.equal(clonedWorld.select_stage, 1, 'cloned C1WorldData select_stage=1');
    clonedWorld.select_stage = 5;
    assert.equal(s.c1WorldData.select_stage, 1, 'deep clone does not mutate original C1WorldData');
    const clonedHero = State.createCloneInstance(s.barcodeDataC1[4]);
    assert.equal(clonedHero.hp, 777, 'cloned BarcodeData hp=777');
    clonedHero.hp = 1;
    assert.equal(s.barcodeDataC1[4].hp, 777, 'deep clone does not mutate original BarcodeData');
  }

  /* ---- Section T: Phase 7-2 カードブラウザ・XML パーサ・1D EAN デコーダ(barcode_cards.as 1-146) ---- */
  {
    const Cards = BB2.Cards;
    const listItems = Cards.parseListXml(load('../assets/xml/list.xml'));
    assert.equal(listItems.length, 21, 'list.xml has 21 card series');
    assert.equal(listItems[0].name, 'バーコードバトラーII付属カード', 'list.xml[0].name');
    assert.equal(listItems[0].xml, 'bb2.xml', 'list.xml[0].xml');

    const bb2Cards = Cards.parseCardsXml(load('../assets/xml/bb2.xml'));
    assert.equal(bb2Cards.length, 26, 'bb2.xml has 26 cards');
    assert.equal(bb2Cards[0].name, 'ラーメン活武', 'bb2.xml[0].name');
    assert.equal(bb2Cards[0].front_img, 'barcode/bb2/83f.jpg', 'bb2.xml[0].front_img');
    assert.equal(bb2Cards[0].back_img, 'barcode/bb2/83b.jpg', 'bb2.xml[0].back_img');
    assert.equal(bb2Cards[0].barcode, '0401207336501', 'bb2.xml[0].barcode');

    /* デコード済バーコードが BarcodeRead.init で正常に読めることを確認 */
    const br = new BB2.BarcodeRead();
    assert.equal(br.init(bb2Cards[0].barcode, 1), true, 'bb2.xml[0] barcode decodes via BarcodeRead');
    assert.equal(br.barcode_data.hp, 40, 'ラーメン活武 hp=40 (4000)');

    /* padBarcode13(barcode_cards.as 140-142) & verifyEanChecksum */
    assert.equal(Cards.padBarcode13('49123456'), '0000049123456', 'padBarcode13 pads 8 digits to 13');
    assert.equal(Cards.verifyEanChecksum('2997971385282'), true, 'valid EAN-13 checksum');
    assert.equal(Cards.verifyEanChecksum('2997971385281'), false, 'invalid EAN-13 checksum');

    /* 合成 EAN-13 ImageData(330×50) による decodeEanFromImageData 検証(2997971385282) */
    const L_BITS = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
    const R_BITS = L_BITS.map((b) => b.replace(/0/g, 'x').replace(/1/g, '0').replace(/x/g, '1'));
    const G_BITS = R_BITS.map((b) => b.split('').reverse().join(''));
    /* 先頭 '2' のパリティは LLGGLG (001101) */
    const targetEan = '2997971385282';
    const parity = [0, 0, 1, 1, 0, 1];
    let bits = '101';
    for (let i = 0; i < 6; i++) {
      const d = Number(targetEan[i + 1]);
      bits += parity[i] ? G_BITS[d] : L_BITS[d];
    }
    bits += '01010';
    for (let i = 0; i < 6; i++) {
      const d = Number(targetEan[i + 7]);
      bits += R_BITS[d];
    }
    bits += '101';
    const w = 330, h = 50, rgba = new Uint8ClampedArray(w * h * 4);
    rgba.fill(255);
    const quietX = 20, scale = 3;
    for (let bi = 0; bi < bits.length; bi++) {
      if (bits[bi] === '1') {
        for (let y = 0; y < h; y++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = quietX + bi * scale + dx;
            const p = (y * w + x) * 4;
            rgba[p] = 0; rgba[p + 1] = 0; rgba[p + 2] = 0; rgba[p + 3] = 255;
          }
        }
      }
    }
    const decoded = Cards.decodeEanFromImageData({ width: w, height: h, data: rgba });
    assert.equal(decoded, targetEan, 'decodeEanFromImageData decodes synthetic EAN-13 bitmap');
  }

  /* --- U. Phase 7-3 (Camera & Image Barcode Reader: BB2.Reader) --- */
  {
    const Reader = BB2.Reader;
    assert.ok(Reader, 'BB2.Reader exists');
    assert.equal(Reader.WIDTH, 320, 'Reader.WIDTH is 320');
    assert.equal(Reader.HEIGHT, 240, 'Reader.HEIGHT is 240');
    assert.equal(typeof Reader.decodeBarcode, 'function', 'Reader.decodeBarcode is a function');
    assert.equal(typeof Reader.startCamera, 'function', 'Reader.startCamera is a function');
    assert.equal(typeof Reader.stopCamera, 'function', 'Reader.stopCamera is a function');
    assert.equal(typeof Reader.init, 'function', 'Reader.init is a function');

    /* 1. decodeBarcode: 空/無地ビットマップの解析 (null 返却) */
    let emptyResult = undefined;
    Reader.decodeBarcode({ width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).fill(255) }, (val) => {
      emptyResult = val;
    });
    assert.equal(emptyResult, null, 'decodeBarcode returns null on blank bitmap');

    /* 2. decodeBarcode: 合成 EAN-13 ビットマップの解析 (認識成功) */
    const L_BITS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const R_BITS = L_BITS.map((b) => b.split('').map((c) => (c === '0' ? '1' : '0')).join(''));
    const G_BITS = R_BITS.map((b) => b.split('').reverse().join(''));
    const targetEan = '2997971385282';
    const parity = [0, 0, 1, 1, 0, 1];
    let bits = '101';
    for (let i = 0; i < 6; i++) {
      const d = Number(targetEan[i + 1]);
      bits += parity[i] ? G_BITS[d] : L_BITS[d];
    }
    bits += '01010';
    for (let i = 0; i < 6; i++) {
      const d = Number(targetEan[i + 7]);
      bits += R_BITS[d];
    }
    bits += '101';
    const w = 320, h = 240, rgba = new Uint8ClampedArray(w * h * 4);
    rgba.fill(255);
    const quietX = 20, scale = 3;
    for (let bi = 0; bi < bits.length; bi++) {
      if (bits[bi] === '1') {
        for (let y = 80; y < 160; y++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = quietX + bi * scale + dx;
            const p = (y * w + x) * 4;
            rgba[p] = 0; rgba[p + 1] = 0; rgba[p + 2] = 0; rgba[p + 3] = 255;
          }
        }
      }
    }
    let decodedEan = null;
    Reader.decodeBarcode({ width: w, height: h, data: rgba }, (val) => {
      decodedEan = val;
    });
    assert.equal(decodedEan, targetEan, 'Reader.decodeBarcode recognizes synthetic EAN-13 in 320x240 image');

    /* 3. View モックを用いた Reader.init とトグル・auto_input の結合テスト */
    let cardInCalled = false;
    const notes = [];
    const mockView = {
      el: {
        init_card_reader_button: { listeners: {} },
        select_image_button: { listeners: {} },
        get_camera_button: { listeners: {} },
        camera_reader: { hidden: false },
        card_in: { value: '' },
        auto_input: { checked: false, listeners: {} },
        video_display: {},
        reader_canvas: null,
        image_file_input: { listeners: {} },
        reader_status: { textContent: '' }
      },
      data: { settings: { auto_input: false } },
      bind: function (target, handler) {
        if (target) target.handler = handler;
      },
      note: function (msg) { notes.push(msg); },
      onCardIn: function () { cardInCalled = true; }
    };

    Reader.init(mockView);
    /* 起動時に toggleCardReader が呼ばれ、初期状態 card_reader_visible=false -> true, camera_reader.hidden=true */
    assert.equal(mockView.el.camera_reader.hidden, true, 'Reader.init hides camera_reader on startup (ActionScript 46)');
    assert.equal(Reader.card_reader_visible, true, 'Reader.card_reader_visible is true (hidden)');

    /* CAMERA_IN ボタン押下で表示にトグル */
    mockView.el.init_card_reader_button.handler();
    assert.equal(mockView.el.camera_reader.hidden, false, 'init_card_reader_button toggles camera_reader visible');
    assert.equal(Reader.card_reader_visible, false, 'Reader.card_reader_visible is false (shown)');

    /* 再度 CAMERA_IN ボタン押下で非表示にトグル */
    mockView.el.init_card_reader_button.handler();
    assert.equal(mockView.el.camera_reader.hidden, true, 'init_card_reader_button toggles camera_reader hidden');
    assert.equal(Reader.card_reader_visible, true, 'Reader.card_reader_visible is true (hidden)');

    /* auto_input = false の場合: analyzeBmpData 呼び出しで card_in.value に値が入り、リーダは閉じず onCardIn は呼ばれない */
    mockView.el.init_card_reader_button.handler(); /* 表示状態にする */
    assert.equal(mockView.el.camera_reader.hidden, false);
    cardInCalled = false;
    mockView.el.auto_input.checked = false;
    Reader.analyzeBmpData({ width: w, height: h, data: rgba });
    assert.equal(mockView.el.card_in.value, targetEan, 'analyzeBmpData sets recognized barcode to card_in.value');
    assert.equal(mockView.el.camera_reader.hidden, false, 'camera_reader remains visible when auto_input is false');
    assert.equal(cardInCalled, false, 'onCardIn not called when auto_input is false');

    /* auto_input = true の場合: analyzeBmpData 呼び出しで card_in.value に値が入り、リーダが閉じ onCardIn が呼ばれる */
    mockView.el.auto_input.checked = true;
    cardInCalled = false;
    Reader.analyzeBmpData({ width: w, height: h, data: rgba });
    assert.equal(mockView.el.card_in.value, targetEan, 'analyzeBmpData sets recognized barcode');
    assert.equal(mockView.el.camera_reader.hidden, true, 'camera_reader is hidden when auto_input is true');
    assert.equal(cardInCalled, true, 'onCardIn is triggered automatically when auto_input is true');

    /* 認識失敗 (0 設定) の場合 */
    mockView.el.camera_reader.hidden = false;
    cardInCalled = false;
    Reader.analyzeBmpData({ width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).fill(255) });
    assert.equal(mockView.el.card_in.value, '0', 'analyzeBmpData sets "0" on unrecognized image (ActionScript 125)');
    assert.equal(cardInCalled, true, 'onCardIn is triggered with "0" when auto_input is true (ActionScript 138)');

    /* stopCamera の呼び出し安全性確認 */
    Reader.stopCamera(null);

    /* 4. View.prototype.onCardIn の参照安全性検証 (S is not defined の回帰防止) */
    const testState = State.create();
    State.standby(testState);
    State.powerOn(testState);
    testState.state = State.STATES.CARD_1; /* カード待ち状態 */
    let fxInsertCalled = false;
    const realViewInstance = {
      state: testState,
      el: {
        card_in: { value: '2997971385282' },
        digits: { hp_1p: {}, st_1p: {}, df_1p: {}, hp_2p: {}, st_2p: {}, df_2p: {} },
        labels: {}
      },
      note: () => {},
      render: () => {},
      label: () => {},
      stopFx: () => {},
      fxCardInsert: () => { fxInsertCalled = true; },
      fxCardError: () => {}
    };
    /* view.js のコードを直接実行して onCardIn を呼び出す */
    const viewCode = load('../js/view.js');
    const viewSandbox = {
      window: { BB2: sandbox.window.BB2 },
      document: {
        getElementById: () => ({ addEventListener: () => {}, style: {}, dataset: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} } }),
        querySelectorAll: () => []
      },
      console
    };
    viewSandbox.window.window = viewSandbox.window;
    vm.createContext(viewSandbox);
    vm.runInContext(viewCode, viewSandbox, { filename: 'js/view.js' });
    const RealView = viewSandbox.window.BB2.View;
    assert.equal(typeof RealView.onCardIn, 'function', 'View.onCardIn exists');
    /* onCardIn を実行し、ReferenceError: S is not defined が発生しないことを確認 */
    RealView.onCardIn.call(realViewInstance);
    assert.equal(fxInsertCalled, true, 'onCardIn executes successfully without ReferenceError and triggers fxCardInsert');

    /* 5. card_in.disabled 制御の検証 (カード待機中は入力可能 = false、挿入演出中や非カード待ちは true) */
    const testEl = {
      stage: { dataset: {} },
      card_in: { disabled: false },
      screen_note: { textContent: '' },
      digits: { hp_1p: {}, st_1p: {}, df_1p: {}, hp_2p: {}, st_2p: {}, df_2p: {} },
      lights: []
    };
    const renderInstance = {
      state: { state: State.STATES.CARD_2, cards: [null, null] }, /* 2枚目カード待ち */
      el: testEl,
      data: { settings: { sound_mute: false } },
      fx: { kind: 'wait' }, /* 待機演出中 */
      clearDigits: () => {},
      setDigit: () => {},
      showCard: () => {}
    };
    RealView.render.call(renderInstance);
    assert.equal(testEl.card_in.disabled, false, 'card_in is NOT disabled during card wait (kind=wait) for cards 2-4');

    renderInstance.fx = { kind: 'insert' }; /* 挿入演出中 */
    RealView.render.call(renderInstance);
    assert.equal(testEl.card_in.disabled, true, 'card_in is disabled during insert animation (kind=insert)');

    renderInstance.state.state = State.STATES.MODE_SELECT; /* モード選択中 */
    renderInstance.fx = null;
    RealView.render.call(renderInstance);
    assert.equal(testEl.card_in.disabled, true, 'card_in is disabled during MODE_SELECT');

    /* 6. C-0 モードで 1・2枚目入力後に SET, SET で 3・4枚目スキップしてバトル開始へ突入する検証 */
    const battleFlowState = State.create();
    State.standby(battleFlowState);
    State.powerOn(battleFlowState);
    battleFlowState.state = State.STATES.CARD_1;
    /* 1枚目入力 */
    const r1 = new BarcodeRead();
    r1.init('2997971385282', 1);
    State.saveCard(battleFlowState, r1.barcode_data);
    State.advanceCardFx(battleFlowState);
    assert.equal(battleFlowState.state, State.STATES.CARD_2, 'now at CARD_2');

    /* 2枚目入力 */
    const r2 = new BarcodeRead();
    r2.init('0401207336501', 1);
    State.saveCard(battleFlowState, r2.barcode_data);
    State.advanceCardFx(battleFlowState);
    assert.equal(battleFlowState.state, State.STATES.CARD_3, 'now at CARD_3');

    /* 1回目の SET: 3枚目スキップ (State.saveCard(s, null) + advanceCardFx) */
    State.saveCard(battleFlowState, null);
    State.advanceCardFx(battleFlowState);
    assert.equal(battleFlowState.state, State.STATES.CARD_4, 'after 1st SET skip: now at CARD_4');
    assert.ok(battleFlowState.fightingData[0], 'fightingData[0] created without item');

    /* 2回目の SET: 4枚目スキップ (State.saveCard(s, null) + advanceCardFx) */
    State.saveCard(battleFlowState, null);
    State.advanceCardFx(battleFlowState);
    assert.equal(battleFlowState.state, State.STATES.CARDS_DONE, 'after 2nd SET skip: state advances to CARDS_DONE (8)');
    assert.ok(battleFlowState.fightingData[1], 'fightingData[1] created without item');

    /* specialDown 実行してバトル開始フラグが立つことを検証 */
    const hasDown = State.specialDown(battleFlowState);
    assert.equal(typeof hasDown, 'boolean');
    assert.ok(battleFlowState.fightingCalc, 'fightingCalc is ready for battle');

    /* 7. C-1 モードの主人公カード(1枚目:戦士・2枚目:魔法使い)入力と待ち表示の検証 */
    const c1State = State.create();
    State.standby(c1State);
    State.powerOn(c1State);
    c1State.mode = 1; /* C-1 */
    c1State.state = State.STATES.CARD_1;

    /* 1枚目(戦士待ち): 魔法使いカード(プリンセスグミー)を入力すると拒否される */
    const c1_fail1 = State.cardInsertC1(c1State, '0320813183500');
    assert.equal(c1_fail1.ok, false, 'C-1 1st card rejects magician');

    /* 1枚目(戦士待ち): 戦士カード(ラーメン活武)を入力すると成功 */
    const c1_ok1 = State.cardInsertC1(c1State, '0401207336501');
    assert.equal(c1_ok1.ok, true, 'C-1 1st card accepts warrior');
    assert.ok(c1_ok1.data.job <= 6, '1st card is warrior');

    /* 1枚目完了演出後に CARD_2 へ遷移 */
    const c1_next1 = State.cardInsertNextC1(c1State);
    assert.equal(c1State.state, State.STATES.CARD_2, 'after 1st card next: state is CARD_2');

    /* 2枚目(魔法使い待ち): 戦士カードを入力すると拒否される */
    const c1_fail2 = State.cardInsertC1(c1State, '0401207336501');
    assert.equal(c1_fail2.ok, false, 'C-1 2nd card rejects warrior');

    /* 2枚目(魔法使い待ち): 魔法使いカードを入力すると成功 */
    const c1_ok2 = State.cardInsertC1(c1State, '0320813183500');
    assert.equal(c1_ok2.ok, true, 'C-1 2nd card accepts magician');
    assert.ok(c1_ok2.data.job > 6, '2nd card is magician');

    /* 2枚目完了演出後に CARD_3 へ遷移し、c1WorldData 生成・SET 待ち状態へ */
    const c1_next2 = State.cardInsertNextC1(c1State);
    assert.equal(c1State.state, State.STATES.CARD_3, 'after 2nd card next: state is CARD_3');
    assert.ok(c1State.c1WorldData, 'c1WorldData created');
    assert.equal(c1State.c1WaitStageSelectSet, true, 'c1WaitStageSelectSet is true');
    assert.ok(c1_next2.bd0 && c1_next2.bd0.job <= 6, 'bd0 is 1P warrior');
    assert.ok(c1_next2.bd1 && c1_next2.bd1.job > 6, 'bd1 is 2P magician');

    /* View 演出呼び出し検証(fxCardWaitC1 の " ==" 表示と insertAnim 呼び出し) */
    const c1ViewEl = {
      digits: {
        hp_1p: { text: '' }, st_1p: { text: '' }, df_1p: { text: '' },
        hp_2p: { text: '' }, st_2p: { text: '' }, df_2p: { text: '' }
      },
      labels: {},
      card_in: { value: '0401207336501', disabled: false }
    };
    const c1View = {
      state: { mode: 1, state: State.STATES.CARD_1 },
      el: c1ViewEl,
      setDigit: function (d, v) { if (d) d.text = v; },
      label: function (k, v) { c1ViewEl.labels[k] = v; },
      startFx: function (k, delay, repeat, tick, done) {
        /* insertAnim12 などの未定義関数呼び出しがないことを即時実行でテスト */
        if (tick) tick.call(this, 1);
        if (done) done.call(this);
      },
      clearFx: function () {},
      playSe: function () {},
      note: function () {},
      render: function () {},
      insertAnim: function (before, n) { /* 正常呼び出し確認 */ this.insertAnimCalled = true; },
      fxCardWaitC1: RealView.fxCardWaitC1,
      fxCardInsertTriggerC1: RealView.fxCardInsertTriggerC1,
      fxCardNextC1: function () { this.fxCardNextC1Called = true; },
      fxCardErrorC1: function () {}
    };

    /* fxCardWaitC1 呼び出し: hp_1p が "-c1" ではなく " ==" になることを検証 */
    c1View.fxCardWaitC1();
    assert.equal(c1ViewEl.digits.hp_1p.text, ' ==', 'hp_1p displays " ==" (not "-c1")');
    assert.equal(c1ViewEl.digits.hp_2p.text, ' ==', 'hp_2p displays " =="');
    /* tick 1 は消灯フェーズ(count===1 -> false) */
    assert.equal(c1ViewEl.labels.warrior_1p_label, false, 'warrior_1p_label is false on tick 1 (blink off)');
    assert.equal(c1ViewEl.labels.magician_2p_label, true, 'magician_2p_label static is true');

    /* fxCardInsertTriggerC1 呼び出し: insertAnim が正常に呼ばれ例外が出ないことを検証 */
    c1View.fxCardInsertTriggerC1();
    assert.equal(c1View.insertAnimCalled, true, 'insertAnim called successfully without insertAnim12 exception');
    assert.equal(c1View.fxCardNextC1Called, true, 'fxCardNextC1 triggered on completion');

    /* 8. C-1 モードのバトル勝利後戦利品点滅(battleGetAnimC1)の検証 */
    c1View.state.c1WorldData = c1State.c1WorldData;
    c1View.state.barcodeDataC1 = c1State.barcodeDataC1;
    c1View.state.friendSelectStateC1 = 1; /* 戦士出撃 */
    c1View.state.barcodeDataEnemy = { job: 3, hp: 50, st: 20, df: 15, special: 0 }; /* 戦士系敵 */
    c1View.battleGetAnimC1 = RealView.battleGetAnimC1;
    c1View.setPpDigit = function (d, v) { if (d) d.pp_text = v; };
    c1View.setMpDigit = function (d, v) { if (d) d.mp_text = v; };

    /* tick 1 (点灯フェーズ: count === 1): 2P 側に戦利品(ST+PP)が表示される */
    c1View.battleGetAnimC1(1);
    assert.equal(c1ViewEl.digits.hp_1p.text, c1State.barcodeDataC1[4].hp, '1P HP shows warrior HP');
    assert.ok(c1ViewEl.digits.st_2p.text !== '', '2P ST shows reward st_df (not empty)');
    assert.equal(c1ViewEl.digits.df_2p.pp_text, 5, '2P DF shows PP=5 reward');
    assert.equal(c1ViewEl.labels.pp_label, true, 'pp_label is true');
    assert.equal(c1ViewEl.labels.warrior_1p_label, true, 'warrior_1p_label is true');
    assert.equal(c1ViewEl.labels.magician_1p_label, false, 'magician_1p_label is false');

    /* tick 2 (消灯フェーズ: count === 0): 2P 側のみ消灯し空文字になる */
    c1View.battleGetAnimC1(2);
    assert.equal(c1ViewEl.digits.hp_2p.text, '', '2P HP is blank on off-phase');
    assert.equal(c1ViewEl.digits.st_2p.text, '', '2P ST is blank on off-phase');
    assert.equal(c1ViewEl.digits.df_2p.text, '', '2P DF is blank on off-phase');
    assert.equal(c1ViewEl.digits.hp_1p.text, c1State.barcodeDataC1[4].hp, '1P HP remains visible on off-phase');
  }
}

console.log('[smoke] state/store/decoder/state-ext/textdisplay/proc4/proc5/phase6/phase7-2/phase7-3: OK');

