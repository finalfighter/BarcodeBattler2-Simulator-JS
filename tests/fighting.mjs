/* tests/fighting.mjs — Phase 4 ロジック移植のゴールデンテスト(js/nes.js・js/barcode_world.js・js/fighting_data.js・js/fighting_calc.js)
 * 期待値: scratch_bb4/phase4_golden.py(NES.as/BarcodeWorld.as/FightingCalc.as の AS 仕様準拠リファレンス=oracle)
 *   が stdout へ出力する NES primitives + 追加カバレッジ + BarcodeWorld 群 12 件 + FightingCalc 群 63 件の写し。
 *        転記先: scratch_bb4/phase4_expected.txt(ゴールデン出力の全文=104 行)。接続済み: NES 29(1〜29 行)
 *        + BarcodeWorld 群 12(30〜41 行) + FightingCalc 群 63(42〜104 行・3-1 の calc_first_speed 2・special23〜29 7・pair 2
 *        + 53〜72 行・3-2 の calc_hit 6・basic_damage 3・special_multi 4・critical_hit 2・check_item_broken 5
 *        + 73〜104 行・3-3 の basic_power 3・select_next_mp_function 5・select_next_pp_state 5・use_pp_power 4・calc_f0 2・
 *        calc_f3 2・calc_f4 1・calc_f5〜f8 4・calc_action 6・工程3-1/3-2/3-3 の js/fighting_calc.js 移植で接続・104 行全て接続済)。
 * NES 状態連鎖: golden と同一。单一 NES インスタンスで逐次実行(clc/sec で明示的に reset する箇所あり)。
 * BarcodeWorld: golden と同一单一インスタンス・12 件の順序も写す(dadf/db01/dc09/dbcd は入口でフラグが
 *   自前の asl か明示 reset で決定的に設定されるため入口状態の影響なし)。
 * CreateFightingData/FightingData は golden ハーネスに期待値出力なし — 元行番号注記付きの手計算期待値
 *   (smoke の decoder セクションと同じ運用)。
 * 実行: node tests/fighting.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const load = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });
vm.runInContext(load('../js/barcode_world.js'), sandbox, { filename: 'js/barcode_world.js' });
vm.runInContext(load('../js/fighting_data.js'), sandbox, { filename: 'js/fighting_data.js' });
vm.runInContext(load('../js/fighting_calc.js'), sandbox, { filename: 'js/fighting_calc.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.NES, 'BB2.NES が公開されている');
assert.ok(BB2 && BB2.BarcodeWorld, 'BB2.BarcodeWorld が公開されている');
assert.ok(BB2 && BB2.FightingData && BB2.CreateFightingData, 'BB2.FightingData・BB2.CreateFightingData が公開されている');
assert.ok(BB2 && BB2.FightingCalc, 'BB2.FightingCalc が公開されている');
const nes = new BB2.NES();

/* 戻り値/フラグはすべてプリミティブ(number/string/boolean)。vm realm 違いの deepEqual 問題に注意(smoke 参照)。
 * 配列リテラルは main realm 側で組み立てるため OK。 */
const flags = (num, c, z) => [num, c, z];

/* golden 逐行順序(NES primitives core)。初期 Carry=0・Zero=0 */
assert.deepEqual(flags(nes.adc(255, 255), nes.CarryFlag, nes.ZeroFlag), [255, 1, 0], 'adc(255,255): 510-255=255(AS wrap の癖)');
assert.deepEqual(flags(nes.adc(128, 128), nes.CarryFlag, nes.ZeroFlag), [2, 1, 0], 'adc(128,128): 256-255=1');
assert.deepEqual(flags(nes.inc(255), nes.CarryFlag, nes.ZeroFlag), [1, 1, 0], 'inc(255): 256-255=1');
assert.deepEqual(flags(nes.sbc(10, 10), nes.CarryFlag, nes.ZeroFlag), [0, 1, 1], 'sbc(10,10): prior carry=1→un=0');
assert.deepEqual(flags(nes.lsr(1), nes.CarryFlag, nes.ZeroFlag), [0, 1, 1], 'lsr(1): bit0→Carry 1・num 0');
assert.deepEqual(flags(nes.asl(128), nes.CarryFlag, nes.ZeroFlag), [0, 1, 1], 'asl(128): bit7→Carry 1・num 0');
assert.deepEqual(flags(nes.rol(1), nes.CarryFlag, nes.ZeroFlag), [3, 0, 0], 'rol(1): carry-in 1 使用・出力 Carry は元の bit7=0');
assert.deepEqual(flags(nes.ror(1), nes.CarryFlag, nes.ZeroFlag), [0, 1, 1], 'ror(1): carry-in 0 使用・出力 Carry は元の bit0=1');
assert.equal(nes.decbin8(255), '11111111', 'decbin8(255)');

/* golden 追加(clc/sec/cmp/bcc/bcs/bne/ora・flag reset 経路)。nes.js の 15 関数を完全カバー */
nes.clc();
assert.equal(nes.CarryFlag, 0, 'clc: CarryFlag=0');
nes.sec();
assert.equal(nes.CarryFlag, 1, 'sec: CarryFlag=1');
assert.deepEqual(flags(nes.adc(255, 0), nes.CarryFlag, nes.ZeroFlag), [1, 1, 0], 'adc(255,0): 255+0+1=256→1');
nes.clc();
assert.deepEqual(flags(nes.adc(0, 0), nes.CarryFlag, nes.ZeroFlag), [0, 0, 1], 'adc(0,0): ZeroFlag=1');
nes.sec();
assert.deepEqual(flags(nes.sbc(10, 11), nes.CarryFlag, nes.ZeroFlag), [254, 0, 0], 'sbc(10,11) carry=1: un=0 → -1+255=254');
nes.clc();
assert.deepEqual(flags(nes.sbc(10, 11), nes.CarryFlag, nes.ZeroFlag), [253, 0, 0], 'sbc(10,11) carry=0: un=1 → -2+255=253');
nes.clc();
assert.deepEqual(flags(nes.sbc(0, 0), nes.CarryFlag, nes.ZeroFlag), [254, 0, 0], 'sbc(0,0) carry=0: -1+255=254');
nes.sec();
assert.deepEqual(flags(nes.rol(0), nes.CarryFlag, nes.ZeroFlag), [1, 0, 0], 'rol(0): carry-in 1 → 1・出力 Carry は元の bit7=0');
assert.deepEqual(flags(nes.rol(255), nes.CarryFlag, nes.ZeroFlag), [254, 1, 0], 'rol(255): carry-in 0 → 254・出力 Carry=1');
assert.deepEqual(flags(nes.lsr(255), nes.CarryFlag, nes.ZeroFlag), [127, 1, 0], 'lsr(255): bit0=1→Carry 1・num 127');
assert.deepEqual(flags(nes.asl(255), nes.CarryFlag, nes.ZeroFlag), [254, 1, 0], 'asl(255): bit7=1→Carry 1・num 254');
assert.deepEqual(flags(nes.ror(128), nes.CarryFlag, nes.ZeroFlag), [192, 0, 0], 'ror(128) carry-in 1: →192・出力 Carry は bit0=0');
nes.clc();
assert.deepEqual(flags(nes.ror(128), nes.CarryFlag, nes.ZeroFlag), [64, 0, 0], 'ror(128) carry-in 0: →64');
assert.equal(nes.decbin8(0), '00000000', 'decbin8(0)');
assert.deepEqual(flags(nes.inc(0), nes.CarryFlag, nes.ZeroFlag), [1, 0, 0], 'inc(0)');
nes.cmp(3, 5);
assert.deepEqual([nes.bcc(), nes.bcs(), nes.bne()], [true, false, true], 'cmp(3,5): num=-2 → Carry 0・Zero 0');
nes.cmp(4, 4);
assert.deepEqual([nes.bcc(), nes.bcs(), nes.bne()], [false, true, false], 'cmp(4,4): num=0 → Carry 1・Zero 1');
nes.cmp(5, 3);
assert.deepEqual([nes.ZeroFlag, nes.CarryFlag], [0, 1], 'cmp(5,3): num=2');
assert.equal(nes.ora(3, 12), 15, 'ora(3,12)');
assert.equal(nes.ora(15, 16), 31, 'ora(15,16)');

/* ---------- BarcodeWorld golden(工程2・12 件) ----------
 * 期待値は scratch_bb4/phase4_expected.txt 30〜41 行の写し(golden と同一順序・单一 BarcodeWorld インスタンス)。
 * 境界癖の例: db01(300*7) の積 2100 は純 16bit なら (52,8) だが NES の AS wrap(256→-255)では (53,8)。
 *   (roadmap リスク表「数値境界テスト」= design §55 の期待通り golden=oracle と一致で確定) */
const bw = new BB2.BarcodeWorld();

let o = { m0018: 7, m001C: 30 };
bw.dadf(o);
assert.deepEqual([o.m0024, o.m0025], [210, 0], 'dadf(7*30)');
o = { m0018: 30, m001C: 7 };
bw.dadf(o);
assert.deepEqual([o.m0024, o.m0025], [210, 0], 'dadf(30*7)');
o = { m0018: 104, m0019: 0, m001C: 12, m001D: 0 };
bw.dadf(o);
assert.deepEqual([o.m0024, o.m0025], [224, 4], 'dadf(104*12)=1248(0x04E0)');
o = { m0018: 0xE0, m0019: 0x04, m001C: 0x0A, m001D: 0x00 };
bw.dbcd(o);
assert.deepEqual([o.m0024, o.m0025], [124, 0], 'dbcd(1248/10)');
o = { m0018: 0, m0019: 0, m001C: 0x02, m001D: 0 };
bw.dbcd(o);
assert.deepEqual([o.m0024, o.m0025], [0, 0], 'dbcd(2/10)');
o = { m0018: 0x34, m0019: 0x08, m001C: 0x0A, m001D: 0x00 };
bw.dbcd(o);
assert.deepEqual([o.m0024, o.m0025], [210, 0], 'dbcd(2100/10)');
o = { m0018: 150, m0019: 0, m001C: 0x0A, m001D: 0 };
bw.dbcd(o);
assert.deepEqual([o.m0024, o.m0025], [15, 0], 'dbcd(150/10)');
o = { m0018: 7, m0019: 0, m001C: 0x2C, m001D: 0x01 };
bw.db01(o);
assert.deepEqual([o.m0024, o.m0025, o.m0026, o.m0027], [53, 8, 0, 0], 'db01(300*7)=2100:AS wrap 境界癖(53,8)');
o = { m0018: 5, m0019: 0, m001C: 0x2C, m001D: 0x01 };
bw.db01(o);
assert.deepEqual([o.m0024, o.m0025, o.m0026, o.m0027], [220, 5, 0, 0], 'db01(300*5)=1500(0x05DC)');
o = { m0018: 100, m0019: 0, m001C: 30 };
bw.f_8bdf(o);
assert.deepEqual([o.m0018, o.m0019], [44, 1], 'f_8bdf(100*30/10)=300(=1×0x100+44)');
o = { m0018: 999, m0019: 0, m001C: 20 };
bw.f_8bdf(o);
assert.deepEqual([o.m0018, o.m0019], [242, 1], 'f_8bdf(999*20/10=1998→clamp 分岐経路)golden 出力 (242,1)');
o = { m0018: 255, m0019: 0, m001C: 255 };
bw.dadf(o);
assert.deepEqual([o.m0024, o.m0025], [8, 254], 'dadf(255*255)境界');

/* ---------- CreateFightingData/FightingData 手計算(元 CreateFightingData.as 行番号注記) ----------
 * BarcodeData フィールド(hp/st/df/speed/race/job/pp/mp/special)は js/decoder.js 23-34(元 BarcodeData.as)と一致済み。 */
const cfd = new BB2.CreateFightingData();
const fdKeys = ['max_hp','hp','st','st1','st2','df','df1','df2','speed','union_flag','race1','race2','job','pp','mp',
  'pp_ignore_flag','special1','special2','cpu','down_hp_flag','down_st_flag','down_df_flag','st_item_broke_flag','df_item_broke_flag'];
const snap = (fd) => { const s = {}; for (const k of fdKeys) { s[k] = fd[k]; } return s; };
const base = { cpu:false, down_hp_flag:false, down_st_flag:false, down_df_flag:false, st_item_broke_flag:false, df_item_broke_flag:false };

/* 1枚のみ(元 85-101)。st2/race2/df2・special2=0 は FightingData 既定値のまま */
assert.deepEqual(snap(cfd.init({ hp:150, st:95, df:80, speed:60, race:2, job:8, pp:12, mp:20, special:23 })),
  { max_hp:150, hp:150, st:95, st1:95, st2:0, df:80, df1:80, df2:0, speed:60, union_flag:false, race1:2, race2:0,
    job:8, pp:12, mp:20, pp_ignore_flag:false, special1:23, special2:0, ...base },
  '1枚: 値写し・クランプなし・union_flag=false');

/* 2枚 union(race2<=4)・mp>=10 片側・job<=6(元 58-68: mp=0)。pp は 1枚目のみ(元 50) */
const bdA1 = { hp:300, st:30, df:30, speed:20, race:1, job:5, pp:50, mp:15, special:23 };
const bdA2 = { hp:300, st:30, df:30, speed:10, race:2, job:7, pp:30, mp:15, special:24 };
assert.deepEqual(snap(cfd.init(bdA1, bdA2)),
  { max_hp:600, hp:600, st:60, st1:30, st2:30, df:60, df1:30, df2:30, speed:20, union_flag:true, race1:1, race2:2,
    job:5, pp:50, mp:0, pp_ignore_flag:false, special1:23, special2:24, ...base },
  '2枚 union job<=6: 合成600/60/60・mp=0・speed 1枚目・pp 1枚目のみ');

/* 同上 mp>=10・job>6(元 62-64: mp=1枚目の mp) */
assert.deepEqual(snap(cfd.init({ ...bdA1, job:8 }, bdA2)),
  { ...snap(cfd.init(bdA1, bdA2)), mp:15, job:8 },
  '2枚 union job>6: mp=1枚目の mp 写し');

/* 2枚 union・mp<10 両側(元 65-67: mp=0) */
assert.deepEqual(snap(cfd.init({ ...bdA1, mp:9 }, { ...bdA2, mp:9 })),
  { ...snap(cfd.init(bdA1, bdA2)), mp:0 },
  '2枚 union mp<10: mp=0');

/* 2枚 race2>4・job>6(元 70-74 mp 合算)。hp>999→999(元 14-16)・st/df>199→199(元 21-22・32-33)・pp/mp>99→99(元 54-56・76-78) */
const bdD1 = { hp:500, st:100, df:100, speed:30, race:0, job:8, pp:60, mp:40, special:11 };
const bdD2 = { hp:500, st:100, df:100, speed:40, race:5, job:9, pp:60, mp:70, special:12 };
assert.deepEqual(snap(cfd.init(bdD1, bdD2)),
  { max_hp:999, hp:999, st:199, st1:100, st2:100, df:199, df1:100, df2:100, speed:30, union_flag:false, race1:0, race2:5,
    job:8, pp:99, mp:99, pp_ignore_flag:false, special1:11, special2:12, ...base },
  '2枚 race2>4 job>6: 全クランプ(1000→999・200→199・120→99・110→99)');

/* 2枚 race2>4・job<=6(元 70-71: mp=0) */
assert.deepEqual(snap(cfd.init({ ...bdD1, job:4 }, bdD2)),
  { ...snap(cfd.init(bdD1, bdD2)), job:4, mp:0 },
  '2枚 race2>4 job<=6: mp=0');

/* 2枚 st/df 負の合算(元 24-26・35-37: 0 クランプ)。st1/st2 は生のまま。pp 1枚目 99 クランプ(元 50・54-56) */
const bdF1 = { hp:10, st:-3, df:-4, speed:7, race:1, job:2, pp:100, mp:3, special:1 };
const bdF2 = { hp:20, st:-2, df:-5, speed:0, race:2, job:2, pp:200, mp:4, special:1 };
const fdF = snap(cfd.init(bdF1, bdF2));
assert(fdF.st === 0 && fdF.st1 === -3 && fdF.st2 === -2 && fdF.df === 0 && fdF.df1 === -4 && fdF.df2 === -5 && fdF.pp === 99,
  '2枚 負の st/df: 0 クランプ(st1/df1 は負のまま)・pp 1枚目 100→99');

/* ---------- FightingCalc golden(工程3-1・golden.py 362-381 写し・11 件) ----------
 * 期待値は scratch_bb4/phase4_expected.txt 42〜52 行の写し。golden と同一单一 FightingCalc インスタンス
 *   (protection_star は golden 逐行どおり 0→2→0)。单一 BarcodeWorld NES 連鎖も golden と同じ入口決定的化済(12 件注記参照)。
 * calcFirstSpeed 3 番目の引数は golden の rand inject(js/fighting_calc.js ヘッダ注記・省略時は元 114 の Math.random)。
 * fd2snap はプリミティブ抽出で main realm リテラル化(vm realm 違い deepEqual 回避)。 */
const fc = new BB2.FightingCalc();
assert.equal(fc.calcFirstSpeed({ speed: 20, race1: 0, special1: 0 }, { speed: 10, race1: 0, special1: 0 }, 4),
  136, 'calc_first_speed(speed20,race0,star0,rand4)');
fc.protection_star = 2;
assert.equal(fc.calcFirstSpeed({ speed: 55, race1: 4, special1: 37 }, { speed: 10, race1: 4, special1: 0 }, 8),
  80, 'calc_first_speed(speed55,race4,special37,star2,rand8)');
fc.protection_star = 0;

const mkfd2 = () => ({ st1: 30, st2: 0, st: 30, df1: 30, df2: 0, df: 30, hp: 300, max_hp: 300,
  down_st_flag: false, down_df_flag: false, down_hp_flag: false }); // golden mkfd2(369-372)写し
const fd2snap = (fd2) => ({ st1: fd2.st1, df1: fd2.df1, hp: fd2.hp, st: fd2.st, df: fd2.df,
  d_st: fd2.down_st_flag, d_df: fd2.down_df_flag, d_hp: fd2.down_hp_flag });
/* golden ループ(373-377: fd1={special1:sp, special2:既定0}・fd2 は毎回 mkfd2 新規) */
for (const [sp, kw, expected] of [
  [23, {}, { st1: 21, df1: 30, hp: 300, st: 21, df: 30, d_st: true, d_df: false, d_hp: false }],
  [24, {}, { st1: 15, df1: 30, hp: 300, st: 15, df: 30, d_st: true, d_df: false, d_hp: false }],
  [25, {}, { st1: 30, df1: 21, hp: 300, st: 30, df: 21, d_st: false, d_df: true, d_hp: false }],
  [26, {}, { st1: 30, df1: 15, hp: 300, st: 30, df: 15, d_st: false, d_df: true, d_hp: false }],
  [27, {}, { st1: 30, df1: 6, hp: 300, st: 30, df: 6, d_st: false, d_df: true, d_hp: false }],
  [28, {}, { st1: 30, df1: 30, hp: 210, st: 30, df: 30, d_st: false, d_df: false, d_hp: true }],
  [29, {}, { st1: 30, df1: 30, hp: 150, st: 30, df: 30, d_st: false, d_df: false, d_hp: true }],
  [23, { special2: 24 }, { st1: 15, df1: 30, hp: 300, st: 15, df: 30, d_st: true, d_df: false, d_hp: false }],
]) {
  const fd2 = mkfd2();
  fc.calcSpecialDown({ special1: sp, special2: (kw.special2 === undefined) ? 0 : kw.special2 }, fd2);
  assert.deepEqual(fd2snap(fd2), expected, `special${sp} pair${kw.special2 || 0}`);
}
/* 対消滅単体(golden 378-381・23+24→fd1.special1=0 となり 24 が残って ST50 ダウン) */
{
  const fd2 = mkfd2();
  fc.calcSpecialDown({ special1: 23, special2: 24 }, fd2);
  assert.deepEqual({ st1: fd2.st1, st: fd2.st }, { st1: 15, st: 15 }, 'pair(23,24)→24 のみ(ST50%)');
}

/* ---------- FightingCalc golden 3-2(工程3-2・golden.py 終端の 3-2 部 写し・20 件・expected.txt 53〜72 行) ----------
 * 期待値は scratch_bb4/phase4_expected.txt 53〜72 行の写し。golden と同じ fc 单一 nes 連鎖を続けない —
 *   3-1 の 11 件は fc.nes を使わないので nes は NES 単体セクションとは別個の单一实例でよい。
 *   golden 逐行どおりに同一 fc へ calc_hit 6 → basic_damage 3 → special_multi 4 → critical_hit 2 → check_item_broken 5 の順で呼ぶ。
 * rand/t timing inject は calcFirstSpeed と同じ方式(calcHit 4 番目引数・basicDamage 3 番目引数に [rand0-4, timing0-1]・
 *   省略時は元 403/418/528 の Math.random 生成)。
 * fc の protection_star は 3-1 末尾で 0 に戻した状態のまま golden と揃える。 */
{
  fc.now_player = 0;
  const fd1h = { speed: 100, hp: 150, race1: 0, special1: 0, special2: 0 };
  const fd2h = { speed: 50, race1: 0, special1: 0, special2: 0 };
  assert.equal(fc.calcHit(fd1h, fd2h, 0, 30), true, 'calc_hit(early hit・speed100>=50・HP150÷0x53 で speed_add=99・adc 後 Carry 1');
  assert.equal(fc.calcHit({ speed: 60, hp: 150, race1: 0, special1: 0, special2: 0 }, { speed: 80, race1: 0, special1: 0, special2: 0 }, 0, 250), false, 'calc_hit(speed60<80・rand 250 で外れ(cmp の borrow');
  assert.equal(fc.calcHit({ speed: 60, hp: 150, race1: 0, special1: 0, special2: 0 }, { speed: 80, race1: 0, special1: 0, special2: 0 }, 0, 30), true, 'calc_hit(同上 rand 30 で hit');
  assert.equal(fc.calcHit({ speed: 10, hp: 150, race1: 0, special1: 39, special2: 0 }, { speed: 20, race1: 0, special1: 0, special2: 0 }, 0, 200), false, 'calc_hit(fd1.special1=39→0x80・rand 200 で外れ');
  assert.equal(fc.calcHit({ speed: 10, hp: 150, race1: 0, special1: 0, special2: 0 }, { speed: 20, hp: 150, race1: 0, special1: 0, special2: 41 }, 0, 30), true, 'calc_hit(fd2.special2=41→0x80・rand 30 で hit');
  assert.equal(fc.calcHit({ speed: 10, hp: 150, race1: 0, special1: 39, special2: 0 }, { speed: 20, race1: 0, special1: 0, special2: 0 }, 10, 200), false, 'calc_hit(39 から magic_rate=10 引き・rand 200 で外れ');

  fc.now_player = 2;
  assert.equal(fc.basicDamage({ st: 100, race1: 0, union_flag: false }, { df: 50, race1: 0, union_flag: false, race2: 0 }, [4, 0]), 139, 'basic_damage(2P・ST100×8÷10+ST×2・DF50 越し÷2 経路');
  fc.now_player = 1;
  assert.equal(fc.basicDamage({ st: 30, race1: 2, union_flag: false }, { df: 50, race1: 0, union_flag: true, race2: 0 }, [3, 0]), 8, 'basic_damage(1P vs 合体・fd1.race1==2 で÷3 経路');
  fc.now_player = 2;
  assert.equal(fc.basicDamage({ st: 5, race1: 0, union_flag: false }, { df: 150, race1: 0, union_flag: false, race2: 0 }, [0, 1]), 2, 'basic_damage(DF150≥で最低 1・timing×2)');

  assert.equal(fc.specialMulti({ special1: 17, special2: 0 }, { special1: 20, special2: 0, job: 9, race1: 9 }, 100), 135, 'special_multi(17 倍剣→fd2 special1=20 盾 0.9x)');
  assert.equal(fc.specialMulti({ special1: 10, special2: 0 }, { special1: 0, special2: 21, job: 0, race1: 1 }, 200), 421, 'special_multi(10 職業一致 3 倍剣→fd2 special2=21 盾・AS wrap の癖で 421');
  assert.equal(fc.specialMulti({ special1: 16, special2: 18 }, { special1: 0, special2: 0, job: 9, race1: 9 }, 999), 998, 'special_multi(16 で 0.5x シフト→18 で 2.0x・clamp 999 未満の 998');
  assert.equal(fc.specialMulti({ special1: 0, special2: 0 }, { special1: 0, special2: 0, job: 9, race1: 9 }, 300, 15), 450, 'special_multi(magic_rate=15・300→450');

  fc.display_damage = 16;
  assert.equal(fc.criticalHit({ st: 10 }), true, 'critical_hit(ST10÷2=5・10+5=15・display 16→true');
  fc.display_damage = 15;
  assert.equal(fc.criticalHit({ st: 10 }), false, 'critical_hit(display 15→false');

  fc.display_damage = 0;
  assert.equal(fc.checkItemBroken({ race2: 5, st_item_broke_flag: false }, { hp: 300, race2: 7, df_item_broke_flag: false }), false, 'check_item_broken(display 0 MISS');
  fc.display_damage = 50;
  assert.equal(fc.checkItemBroken({ race2: 5, st_item_broke_flag: false }, { hp: 300, race2: 0, df_item_broke_flag: false }), true, 'check_item_broken(fd1.race2==5 ST アイテム');
  assert.equal(fc.checkItemBroken({ race2: 0, st_item_broke_flag: false }, { hp: 300, race2: 7, df_item_broke_flag: false }), true, 'check_item_broken(fd2.race2==7 DF アイテム');
  assert.equal(fc.checkItemBroken({ race2: 5, st_item_broke_flag: false }, { hp: 0, race2: 7, df_item_broke_flag: false }), false, 'check_item_broken(fd2.hp==0');
  assert.equal(fc.checkItemBroken({ race2: 5, st_item_broke_flag: true }, { hp: 300, race2: 7, df_item_broke_flag: true }), false, 'check_item_broken(破壊済・フラグ true)');
}

/* ---------- FightingCalc golden 3-3(工程3-3・golden.py 終端の 3-3 部 写し・32 件・expected.txt 73〜104 行) ----------
 * 期待値は scratch_bb4/phase4_expected.txt 73〜104 行の写し。golden の fc 自前 BarcodeWorld の連鎖は 3-2 末尾の続きのまま
 *   続行する(dadf/dbcd/db01 は入口フラグが自前 asl か明示 reset で決定的で入口状態の影響なし・上記ヘッダ注記)。
 *   同一 fc で golden 逐行どおりに basicPower 3 → selectNextMpFunction 5 → selectNextPpState 5 → usePpPower 4 →
 *   calcF0 2 → calcF3 2 → calcF4 1 → calcF5〜F8 4 → calcAction 6(golden ドライバの fighting_data 代入 5 か所の順も写す)。
 * rand 注入: basicPower は 3 番目 rand_idx(power_rand_table index)・4 番目 timing01、calcF0 は 2 番目 1-6、
 *   calcAction は 1・2 番目 1-100(元 721/724/902/1066/1067 の Math.random 生成の決定的化・忠実移植は省略時と同じ動作)。
 * fc の nes/BarcodeWorld は 3-1/3-2 からの单一实例のまま(3-3 の nes 使用は basicPower/usePpPower の 43/44 ブロック破棄呼び出しのみ)。 */
{
  assert.equal(fc.basicPower({ max_hp: 200, hp: 150, special1: 0, special2: 0 }, { special1: 0, special2: 0 }, 1, 0), 40,
    'basic_power(rand 2・timing 10・stack 20×20/10 → 40・hp_diff 50');
  assert.equal(fc.basicPower({ max_hp: 10, hp: 9, special1: 0, special2: 0 }, { special1: 0, special2: 0 }, 4, 1), 1,
    'basic_power(rand 7・timing 14・1×98/10 → hp_diff 1 clamp 1');
  assert.equal(fc.basicPower({ max_hp: 200, hp: 150, special1: 0, special2: 44 }, { special1: 43, special2: 0 }, 1, 0), 40,
    'basic_power(special43+44・nes 呼び出し全破棄で値不変 40(元 780 mm025 誤植 NaN 経路)');

  assert.equal(fc.selectNextMpFunction({ mp: 5 }, 0), 1, 'select_next_mp_function(mp5・select0・battle → 1(F1=2≤5)');
  assert.equal(fc.selectNextMpFunction({ mp: 5 }, 1), 2, 'select_next_mp_function(mp5・select1 → 2(F2=5≤5)');
  assert.equal(fc.selectNextMpFunction({ mp: 99 }, 9), -1, 'select_next_mp_function(select9 → next 10 で -1');
  assert.equal(fc.selectNextMpFunction({ mp: 1 }, 0, false), -1, 'select_next_mp_function(cure・mp1・全 1 より大きい(F3=2 含む)→ -1');
  assert.equal(fc.selectNextMpFunction({ mp: 4 }, 0, false), 3, 'select_next_mp_function(cure・mp4・select0 → 3(F3=2≤4)');

  assert.equal(fc.selectNextPpState({ pp: 0, pp_ignore_flag: false }, 1), -1, 'select_next_pp_state(pp0 → -1');
  assert.equal(fc.selectNextPpState({ pp: 3, pp_ignore_flag: true }, 1), -1, 'select_next_pp_state(pp_ignore_flag true → -1');
  assert.equal(fc.selectNextPpState({ pp: 3, pp_ignore_flag: false }, 1), 2, 'select_next_pp_state(pp3・select1 → 2');
  assert.equal(fc.selectNextPpState({ pp: 1, pp_ignore_flag: false }, 2), -1, 'select_next_pp_state(pp1・select2 → 3>pp で -1');
  assert.equal(fc.selectNextPpState({ pp: 3, pp_ignore_flag: false }, 3), -1, 'select_next_pp_state(pp3・select3 → 4>=4 で -1');

  assert.equal(fc.usePpPower({ max_hp: 200, hp: 150, special1: 0, special2: 0 }, { special1: 0, special2: 0 }, 2), 50,
    'use_pp_power(2個使用・HP200×4/10=80 → hp_diff 50 clamp');
  assert.equal(fc.usePpPower({ max_hp: 200, hp: 150, special1: 0, special2: 0 }, { special1: 0, special2: 0 }, 1), 40,
    'use_pp_power(1個使用・HP200×2/10=40');
  assert.equal(fc.usePpPower({ max_hp: 200, hp: 100, special1: 0, special2: 0 }, { special1: 43, special2: 0 }, 1), 40,
    'use_pp_power(fd2 special43・nes 呼び出し破棄で値不変 40');
  assert.equal(fc.usePpPower({ max_hp: 100, hp: 50, special1: 44, special2: 0 }, { special1: 0, special2: 0 }, 2), 40,
    'use_pp_power(fd1 special44・元 884 mm025 誤植 NaN 経路で値不変 40');

  assert.equal(fc.calcF0({ mp: 9 }, 4), 4, 'calc_f0(rand4・fd2 mp9 → 4');
  assert.equal(fc.calcF0({ mp: 3 }, 6), 3, 'calc_f0(rand6・fd2 mp3 超え → mp 合わせ 3');

  assert.equal(fc.calcF3({ max_hp: 200, hp: 150 }), 50, 'calc_f3(HP200×3/10=60 → hp_diff 50 clamp');
  assert.equal(fc.calcF3({ max_hp: 150, hp: 150 }), 0, 'calc_f3(HP150×3/10=45 → hp_diff 0 clamp 0)');
  assert.equal(fc.calcF4({ max_hp: 100, hp: 50 }), 50, 'calc_f4(HP100×5/10=50・hp_diff 50 で clamp されない');

  assert.equal(fc.calcF5({ df1: 99 }), 29, 'calc_f5(3×fd2.df1 99 → 297/10 → 29');
  assert.equal(fc.calcF6({ df1: 50 }), 15, 'calc_f6(3×fd1.df1 50 → 150/10 → 15');
  assert.equal(fc.calcF7({ st1: 33 }), 9, 'calc_f7(3×fd2.st1 33 → 99/10 → 9');
  assert.equal(fc.calcF8({ st1: 100 }), 30, 'calc_f8(3×fd1.st1 100 → 300/10 → 30');

  fc.fighting_data = [{ df: 30, st: 30 }, { hp: 1, max_hp: 10, pp: 1, mp: 5 }];
  assert.equal(fc.calcAction(80, 40), 11, 'calc_action(敵 HP10% <20%・pp>0・rand80>50 → 回復 11');
  assert.equal(fc.calcAction(40, 40), 10, 'calc_action(同データで rand40≤50 で回復 branch 不発・mp>0・rand<70 → 攻撃 10');
  fc.fighting_data = [{ df: 5, st: 30 }, { hp: 9, max_hp: 100, pp: 0, mp: 5 }];
  assert.equal(fc.calcAction(80, 45), 5, 'calc_action(rand80・rand_magic45(F5 band・mp>=3・fd0.df5≤5 → 5');
  fc.fighting_data = [{ df: 30, st: 4 }, { hp: 9, max_hp: 100, pp: 0, mp: 8 }];
  assert.equal(fc.calcAction(80, 75), 7, 'calc_action(rand_magic75(F7 band・mp8>=7・fd0.st4≤5 → 7');
  fc.fighting_data = [{ df: 6, st: 30 }, { hp: 9, max_hp: 100, pp: 0, mp: 5 }];
  assert.equal(fc.calcAction(80, 45), 10, 'calc_action(rand_magic45・fd0.df6>5 で inner return 不発 → 10 へ落ちる');
  fc.fighting_data = [{ df: 30, st: 30 }, { hp: 100, max_hp: 100, pp: 0, mp: 0 }];
  assert.equal(fc.calcAction(80, 40), 10, 'calc_action(mp0 → 10');
}

console.log('[fighting] OK: NES golden 29 + BarcodeWorld golden 12 + CreateFightingData/FightingData 手計算 7 + FightingCalc golden 63(3-1 分 11 + 3-2 分 20 + 3-3 分 32・golden 出力 104 行全接続・js/nes.js・js/barcode_world.js・js/fighting_data.js・js/fighting_calc.js))');
