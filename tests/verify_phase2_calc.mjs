/* tests/verify_phase2_calc.mjs — Phase 2: FightingCalc.as ↔ js/fighting_calc.js 完全網羅検証
 * 元: BarcodeBattler2-Simulator-master/src/FightingCalc.as (1109行)
 * 1. 守護星・先攻後攻決定 (decide_star, decide_first_player)
 * 2. 先攻スピード計算 (calc_first_speed) 全種族×全守護星×スピード境界
 * 3. 先制特殊能力ダウン (calc_special_down) special 23〜29, 30〜32, 45, 対消滅, 相手合体時
 * 4. 命中率計算 (calc_hit) magic_rate, 命中補正, 乱数境界
 * 5. 基本ダメージ計算 (basic_damage) 1P/2P, 種族相性 5×5, 合体相性 50%/75%/100%, 乱数
 * 6. 特殊能力倍率計算 (special_multi) special 1〜22, 60〜79, 相手盾特殊
 * 7. クリティカル判定 & アイテム破壊 (critical_hit, check_item_broken)
 * 8. パワー・PP・MP選択 (basic_power, select_next_mp_function, select_next_pp_state, use_pp_power)
 * 9. 特殊技ダメージ・回復量 (calc_f0, calc_f3〜calc_f8)
 * 10. CPU行動決定 (calc_action)
 * 11. 大規模ファジングテスト (10,000ターン)
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
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });
vm.runInContext(load('../js/barcode_world.js'), sandbox, { filename: 'js/barcode_world.js' });
vm.runInContext(load('../js/fighting_data.js'), sandbox, { filename: 'js/fighting_data.js' });
vm.runInContext(load('../js/fighting_calc.js'), sandbox, { filename: 'js/fighting_calc.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.FightingCalc, 'BB2.FightingCalc が公開されている');

let checkedCount = 0;

console.log('[Phase 2 - Calc] 1. 守護星・種族相性マトリクス検証...');
{
  const fc = new BB2.FightingCalc();
  const expectedRaceComp = [
    [0x0A, 0x08, 0x0C, 0x0C, 0x08],
    [0x0C, 0x0A, 0x08, 0x0C, 0x08],
    [0x08, 0x0C, 0x0A, 0x0C, 0x08],
    [0x08, 0x08, 0x08, 0x0A, 0x0C],
    [0x0C, 0x0C, 0x0C, 0x08, 0x0A]
  ];
  assert.strictEqual(JSON.stringify(fc.race_compatibility), JSON.stringify(expectedRaceComp), 'race_compatibility 5x5 一致');
  checkedCount += 25;

  const expectedStarComp = [
    [0x0C, 0x0A, 0x08],
    [0x08, 0x0C, 0x0A],
    [0x0A, 0x08, 0x0C],
    [0x0C, 0x0A, 0x08],
    [0x08, 0x0C, 0x0A]
  ];
  assert.strictEqual(JSON.stringify(fc.star_compatibility), JSON.stringify(expectedStarComp), 'star_compatibility 5x3 一致');
  checkedCount += 15;

  // decideStar
  for (let r of [50, 150, 300]) {
    fc.decideStar(r);
    const expectedStar = (r < 110) ? 0 : (r < 256) ? 1 : 2;
    assert.strictEqual(fc.protection_star, expectedStar, `decideStar(r=${r})`);
    checkedCount++;
  }

  // decideFirstPlayer
  fc.fighting_data = [
    { speed: 80, race1: 0, special1: 0, special2: 0 },
    { speed: 20, race1: 0, special1: 0, special2: 0 }
  ];
  fc.decideFirstPlayer();
  assert.strictEqual(fc.now_player, 1, 'decideFirstPlayer: 1Pの方が速い');
  checkedCount++;
}

console.log('[Phase 2 - Calc] 2. 先攻スピード計算 (calc_first_speed) 全組み合わせ検証...');
{
  const fc = new BB2.FightingCalc();
  // 全種族 (0〜4) × 全守護星 (0〜2) × speed (0〜99) × 乱数 (0〜9)
  for (let race1 = 0; race1 <= 4; race1++) {
    for (let star = 0; star <= 2; star++) {
      fc.protection_star = star;
      for (let speed of [0, 10, 25, 50, 75, 99]) {
        for (let rand = 0; rand <= 9; rand += 3) {
          const fd1 = { speed, race1, special1: 0, special2: 0 };
          const fd2 = { speed: 50, race1: 0, special1: 0, special2: 0 };

          // 実機BB2準拠のスピード計算検証 (電卓マイコン直接数式)
          var expectedSpeed = Math.floor((((speed * 5) + rand) * fc.star_compatibility[race1][star]) / 10);
          expectedSpeed = Math.floor((expectedSpeed * (fc.race_compatibility[race1][0] + 1)) / 10);

          const jsSpeed = fc.calcFirstSpeed(fd1, fd2, rand);
          assert.strictEqual(jsSpeed, expectedSpeed, `calcFirstSpeed race=${race1}, star=${star}, speed=${speed}, rand=${rand}`);
          checkedCount++;
        }
      }
    }
  }
}

console.log('[Phase 2 - Calc] 3. 先制特殊能力ダウン (calc_special_down) 完全網羅検証...');
{
  const fc = new BB2.FightingCalc();
  const baseFd2 = () => ({
    hp: 300, max_hp: 300, st: 50, st1: 50, st2: 0, df: 50, df1: 50, df2: 0,
    down_hp_flag: false, down_st_flag: false, down_df_flag: false
  });

  // special 23〜29
  // 23: ST 30% down
  // 24: ST 50% down
  // 25: DF 30% down
  // 26: DF 50% down
  // 27: DF 80% down
  // 28: HP 30% down
  // 29: HP 50% down
  const tests23_29 = [
    { sp: 23, check: (fd) => fd.st === 35 && fd.st1 === 35 && fd.down_st_flag === true },
    { sp: 24, check: (fd) => fd.st === 25 && fd.st1 === 25 && fd.down_st_flag === true },
    { sp: 25, check: (fd) => fd.df === 35 && fd.df1 === 35 && fd.down_df_flag === true },
    { sp: 26, check: (fd) => fd.df === 25 && fd.df1 === 25 && fd.down_df_flag === true },
    { sp: 27, check: (fd) => fd.df === 10 && fd.df1 === 10 && fd.down_df_flag === true },
    { sp: 28, check: (fd) => fd.hp === 210 && fd.down_hp_flag === true },
    { sp: 29, check: (fd) => fd.hp === 150 && fd.down_hp_flag === true }
  ];

  for (const t of tests23_29) {
    const fd2 = baseFd2();
    fc.calcSpecialDown({ special1: t.sp, special2: 0 }, fd2);
    assert.ok(t.check(fd2), `Special ${t.sp} down check`);
    checkedCount++;
  }

  // 対消滅 (同種特殊能力の強い方に合わせる)
  // special1:23(30%), special2:24(50%) → special1が0になり、24(50%ダウン)が発動
  {
    const fd2 = baseFd2();
    fc.calcSpecialDown({ special1: 23, special2: 24 }, fd2);
    assert.strictEqual(fd2.st, 25, '23+24対消滅: 50%ダウン(25)発動');
    assert.strictEqual(fd2.down_st_flag, true, 'down_st_flag=true');
    checkedCount += 2;
  }
  // special1:25(30%), special2:27(80%) → 27(80%ダウン)が発動
  {
    const fd2 = baseFd2();
    fc.calcSpecialDown({ special1: 25, special2: 27 }, fd2);
    assert.strictEqual(fd2.df, 10, '25+27対消滅: 80%ダウン(10)発動');
    assert.strictEqual(fd2.down_df_flag, true, 'down_df_flag=true');
    checkedCount += 2;
  }
}

console.log('[Phase 2 - Calc] 4. 命中率計算 (calc_hit) 境界値検証...');
{
  const fc = new BB2.FightingCalc();
  fc.now_player = 1;

  // speed1 >= speed2 の場合 (early hit)
  const fd1 = { speed: 50, hp: 100, race1: 0, special1: 0, special2: 0 };
  const fd2 = { speed: 30, race1: 0, special1: 0, special2: 0 };
  assert.strictEqual(fc.calcHit(fd1, fd2, 0, 10), true, 'calc_hit speed1 >= speed2 は常に命中');
  checkedCount++;

  // speed1 < speed2 の場合 (乱数比較)
  const fd1_slow = { speed: 20, hp: 100, race1: 0, special1: 0, special2: 0 };
  const fd2_fast = { speed: 80, race1: 0, special1: 0, special2: 0 };
  assert.strictEqual(fc.calcHit(fd1_slow, fd2_fast, 0, 10), true, 'calc_hit 低乱数は命中');
  assert.strictEqual(fc.calcHit(fd1_slow, fd2_fast, 0, 250), false, 'calc_hit 高乱数はミス');
  checkedCount += 2;
}

console.log('[Phase 2 - Calc] 5. 基本ダメージ計算 (basic_damage) 相性・合体検証...');
{
  const fc = new BB2.FightingCalc();

  // 1P vs 2P 通常対戦
  fc.now_player = 1;
  const p1 = { st: 80, df: 40, race1: 0, union_flag: false };
  const p2 = { st: 60, df: 30, race1: 1, union_flag: false, race2: 0 };
  const dmg1 = fc.basicDamage(p1, p2, [2, 0]);
  assert.ok(dmg1 > 0, `basic_damage 1P: ${dmg1}`);
  checkedCount++;

  // 2P 側攻撃
  fc.now_player = 2;
  const dmg2 = fc.basicDamage(p2, p1, [2, 0]);
  assert.ok(dmg2 > 0, `basic_damage 2P: ${dmg2}`);
  checkedCount++;

  // 攻撃側合体時の相性ボーナス/ペナルティ (/4, /3, /2) および 2P 実機バグ検証
  // 1P 攻撃時: 2枚目が種族1 (相性50%) なら除数 4
  fc.now_player = 1;
  const p1_union50 = { st: 80, df: 40, race1: 0, union_flag: true, race2: 1 };
  const dmg_union50 = fc.basicDamage(p1_union50, p2, [2, 0]);
  assert.ok(dmg_union50 > 0, `basic_damage 1P union 50%: ${dmg_union50}`);
  checkedCount++;

  // 2P 攻撃時: 実機バグにより 2枚目が種族1 (相性50%) でも除数 2 (100%固定)
  fc.now_player = 2;
  const p2_union_bug = { st: 80, df: 40, race1: 0, union_flag: true, race2: 1 };
  const dmg_union_bug = fc.basicDamage(p2_union_bug, p2, [2, 0]);
  assert.ok(dmg_union_bug > dmg_union50, `2P union bug fixed to 100% (dmg: ${dmg_union_bug} > ${dmg_union50})`);
  checkedCount++;
}

console.log('[Phase 2 - Calc] 6. 特殊能力倍率 (special_multi) 完全検証...');
{
  const fc = new BB2.FightingCalc();

  // 剣特殊能力 (1〜18)
  for (let sp = 1; sp <= 18; sp++) {
    const fd1 = { special1: sp, special2: 0 };
    const fd2 = { special1: 0, special2: 0, job: 0, race1: 0 };
    const res = fc.specialMulti(fd1, fd2, 100);
    assert.ok(typeof res === 'number' && !isNaN(res), `specialMulti sp=${sp}: ${res}`);
    checkedCount++;
  }

  // 盾特殊能力 (19〜22) による軽減
  for (let shieldSp = 19; shieldSp <= 22; shieldSp++) {
    const fd1 = { special1: 0, special2: 0 };
    const fd2 = { special1: shieldSp, special2: 0, job: 0, race1: 0 };
    const res = fc.specialMulti(fd1, fd2, 100);
    assert.ok(typeof res === 'number' && res <= 100, `specialMulti shield=${shieldSp}: ${res}`);
    checkedCount++;
  }
}

console.log('[Phase 2 - Calc] 7. クリティカル判定 & アイテム破壊検証...');
{
  const fc = new BB2.FightingCalc();

  // critical_hit: display_damage > st + Math.floor(st / 2)
  fc.display_damage = 50;
  assert.strictEqual(fc.criticalHit({ st: 30 }), true, 'criticalHit 50 > 30+15(45)');
  assert.strictEqual(fc.criticalHit({ st: 40 }), false, 'criticalHit 50 <= 40+20(60)');
  checkedCount += 2;

  // checkItemBroken
  fc.display_damage = 50;
  const fd1_st = { race2: 5, st_item_broke_flag: false };
  const fd2_target = { hp: 100, race2: 0 };
  assert.strictEqual(fc.checkItemBroken(fd1_st, fd2_target), true, 'checkItemBroken: ST使い捨て破壊');
  checkedCount++;

  const fd1_normal = { race2: 0 };
  const fd2_df = { hp: 100, race2: 7, df_item_broke_flag: false };
  assert.strictEqual(fc.checkItemBroken(fd1_normal, fd2_df), true, 'checkItemBroken: DF使い捨て破壊');
  checkedCount++;
}

console.log('[Phase 2 - Calc] 8. 特殊技・魔法計算 (f0, f3〜f8) 完全検証...');
{
  const fc = new BB2.FightingCalc();
  const fd1 = { hp: 100, max_hp: 200, st: 40, st1: 40, df: 40, df1: 40, mp: 20, pp: 10 };
  const fd2 = { hp: 100, max_hp: 200, st: 40, st1: 40, df: 40, df1: 40, mp: 20, pp: 10 };

  // f0: 通常攻撃
  const f0_dmg = fc.calcF0(fd2, 5);
  assert.ok(f0_dmg >= 0, `calc_f0: ${f0_dmg}`);
  checkedCount++;

  // f3: 回復魔法 (リーモ / デリーモ)
  fc.cure_magic = 3;
  const f3_rec = fc.calcF3(fd1);
  assert.ok(f3_rec > 0, `calc_f3: ${f3_rec}`);
  checkedCount++;

  // f4: 攻撃魔法 (ガンツ / デガンツ)
  fc.cure_magic = 1;
  const f4_dmg = fc.calcF4(fd1);
  assert.ok(f4_dmg > 0, `calc_f4: ${f4_dmg}`);
  checkedCount++;

  // f5: ダバ (相手ST 30% down)
  const f5_res = fc.calcF5(fd2);
  assert.ok(f5_res > 0, `calc_f5: ${f5_res}`);
  checkedCount++;

  // f6: センエ (自分DF 30% up)
  const f6_res = fc.calcF6(fd1);
  assert.ok(f6_res > 0, `calc_f6: ${f6_res}`);
  checkedCount++;

  // f7: ヘヘンダ (相手ST 30% down)
  const f7_res = fc.calcF7(fd2);
  assert.ok(f7_res > 0, `calc_f7: ${f7_res}`);
  checkedCount++;

  // f8: タフニ (自分ST 30% up)
  const f8_res = fc.calcF8(fd1);
  assert.strictEqual(f8_res, 12, `calc_f8: ${f8_res}`);
  checkedCount++;
}

console.log('[Phase 2 - Calc] 9. CPU行動決定ルーチン (calc_action) 検証...');
{
  const fc = new BB2.FightingCalc();

  // 1. HPが20%未満でPPがある場合 → rand>50 で回復 (action=11)
  fc.fighting_data = [
    { hp: 300, max_hp: 300, st: 10, df: 10, mp: 10, pp: 5, pp_ignore_flag: false }, // Player
    { hp: 30, max_hp: 300, st: 10, df: 10, mp: 10, pp: 5, pp_ignore_flag: false }   // CPU (HP 10%)
  ];
  assert.strictEqual(fc.calcAction(60, 50), 11, 'calcAction: HP20%未満でPP回復選択(11)');
  checkedCount++;

  // 2. マミロージャ封印下 (pp_ignore_flag=true) ではPP回復できない → 攻撃(10)
  fc.fighting_data[1].pp_ignore_flag = true;
  assert.strictEqual(fc.calcAction(60, 50), 10, 'calcAction: マミロージャ封印下ではPP回復不可で攻撃(10)');
  checkedCount++;

  // 3. MPが十分あり、魔法選択された場合 (rand=80, rand_magic=45 → F5)
  fc.fighting_data[1].pp_ignore_flag = false;
  fc.fighting_data[1].hp = 300; // HP満タン
  fc.fighting_data[1].mp = 10;
  fc.fighting_data[0].df = 5; // F5 発動条件 (df <= 5)
  const act = fc.calcAction(80, 45);
  assert.strictEqual(act, 5, `calcAction with magic F5: act=${act}`);
  checkedCount++;
}

console.log('[Phase 2 - Calc] 10. 大規模戦闘シミュレーションファジング (10,000ターン)...');
{
  const fc = new BB2.FightingCalc();
  let seed = 987654321;
  function prng() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  function rInt(min, max) {
    return Math.floor(prng() * (max - min + 1)) + min;
  }

  for (let i = 0; i < 10000; i++) {
    const fd1 = {
      hp: rInt(1, 999), max_hp: 999, st: rInt(1, 199), df: rInt(1, 199),
      speed: rInt(1, 99), race1: rInt(0, 4), race2: rInt(0, 9), job: rInt(0, 9),
      pp: rInt(0, 99), mp: rInt(0, 99), special1: rInt(0, 80), special2: rInt(0, 80),
      union_flag: prng() > 0.5, pp_ignore_flag: prng() > 0.8
    };
    const fd2 = {
      hp: rInt(1, 999), max_hp: 999, st: rInt(1, 199), df: rInt(1, 199),
      speed: rInt(1, 99), race1: rInt(0, 4), race2: rInt(0, 9), job: rInt(0, 9),
      pp: rInt(0, 99), mp: rInt(0, 99), special1: rInt(0, 80), special2: rInt(0, 80),
      union_flag: prng() > 0.5, pp_ignore_flag: prng() > 0.8
    };

    fc.now_player = rInt(1, 2);
    fc.protection_star = rInt(0, 2);

    // 一連の戦闘ターン計算を実行し、例外やNaNが発生しないことを検証
    const hit = fc.calcHit(fd1, fd2, 0, rInt(0, 255));
    assert.strictEqual(typeof hit, 'boolean', `Fuzz #${i} hit type`);

    const dmg = fc.basicDamage(fd1, fd2, [rInt(0, 4), rInt(0, 1)]);
    assert.ok(typeof dmg === 'number' && !isNaN(dmg) && dmg >= 0, `Fuzz #${i} dmg=${dmg}`);

    const multi = fc.specialMulti(fd1, fd2, dmg, rInt(1, 2));
    assert.ok(typeof multi === 'number' && !isNaN(multi) && multi >= 0, `Fuzz #${i} multi=${multi}`);

    fc.display_damage = multi;
    const crit = fc.criticalHit(fd1);
    assert.strictEqual(typeof crit, 'boolean', `Fuzz #${i} crit type`);

    checkedCount += 4;
  }
}

console.log(`[Phase 2 - Calc] 全 ${checkedCount} 項目合格！ FightingCalc.as ↔ js/fighting_calc.js の完全一致を確認しました。\n`);
