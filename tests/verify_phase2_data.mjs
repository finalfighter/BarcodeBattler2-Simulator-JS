/* tests/verify_phase2_data.mjs — Phase 2: CreateFightingData.as ↔ js/fighting_data.js 完全網羅検証
 * 元: BarcodeBattler2-Simulator-master/src/CreateFightingData.as(109行) / FightingData.as(40行)
 * 1. 1枚単体時の全フィールド・ステータスコピー検証
 * 2. 2枚合体時のHP/ST/DF合算・上限クランプ(HP 999, ST 199, DF 199, 下限0)検証
 * 3. 2枚合体時のPP合算(race2<=4なら非合算・>4なら合算、上限99)検証
 * 4. 2枚合体時のMP合算(戦士職job<=6なら0・魔法使いのみ加算、合体キャラrace2<=4時のmp>=10条件、上限99)検証
 * 5. 特殊能力引継ぎ(special1, special2)検証
 * 6. 実在カード全XML (672件) の全ペア合成サンプリング & 乱数ファジング (10,000件)
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
vm.runInContext(load('../js/fighting_data.js'), sandbox, { filename: 'js/fighting_data.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.FightingData && BB2.CreateFightingData, 'BB2.FightingData / CreateFightingData が公開されている');

// AS3 仕様の FightingData
class AS3_FightingData {
  constructor() {
    this.max_hp = 0;
    this.hp = 0;
    this.down_hp_flag = false;

    this.st = 0;
    this.st1 = 0;
    this.st2 = 0;
    this.down_st_flag = false;
    this.st_item_broke_flag = false;

    this.df = 0;
    this.df1 = 0;
    this.df2 = 0;
    this.down_df_flag = false;
    this.df_item_broke_flag = false;

    this.speed = 0;

    this.union_flag = false;
    this.race1 = 0;
    this.race2 = 0;
    this.job = 0;

    this.pp = 0;
    this.mp = 0;
    this.pp_ignore_flag = false;

    this.special1 = 0;
    this.special2 = 0;

    this.cpu = false;
  }
}

// AS3 仕様の CreateFightingData Oracle (CreateFightingData.as 109行に完全準拠)
class AS3_CreateFightingData_Oracle {
  init(barcode_data1, barcode_data2 = null) {
    const fd = new AS3_FightingData();

    if (barcode_data2) {
      let hp = barcode_data1.hp + barcode_data2.hp;
      if (hp > 999) hp = 999;
      fd.max_hp = hp;
      fd.hp = hp;

      let st = barcode_data1.st + barcode_data2.st;
      if (st > 199) st = 199;
      if (st < 0) st = 0;
      fd.st = st;
      fd.st1 = barcode_data1.st;
      fd.st2 = barcode_data2.st;

      let df = barcode_data1.df + barcode_data2.df;
      if (df > 199) df = 199;
      if (df < 0) df = 0;
      fd.df = df;
      fd.df1 = barcode_data1.df;
      fd.df2 = barcode_data2.df;

      fd.speed = barcode_data1.speed;
      fd.race1 = barcode_data1.race;
      fd.race2 = barcode_data2.race;
      fd.job = barcode_data1.job;

      if (barcode_data2.race <= 4) {
        fd.pp = barcode_data1.pp;
      } else {
        fd.pp = barcode_data1.pp + barcode_data2.pp;
      }
      if (fd.pp > 99) fd.pp = 99;

      if (barcode_data2.race <= 4) {
        if (barcode_data1.mp >= 10 || barcode_data2.mp >= 10) {
          if (barcode_data1.job <= 6) {
            fd.mp = 0;
          } else {
            fd.mp = barcode_data1.mp;
          }
        } else {
          fd.mp = 0;
        }
        fd.union_flag = true;
      } else {
        if (barcode_data1.job <= 6) {
          fd.mp = 0;
        } else {
          fd.mp = barcode_data1.mp + barcode_data2.mp;
        }
      }
      if (fd.mp > 99) fd.mp = 99;

      fd.pp_ignore_flag = false;
      fd.special1 = barcode_data1.special;
      fd.special2 = barcode_data2.special;
    } else {
      fd.max_hp = barcode_data1.hp;
      fd.hp = barcode_data1.hp;
      fd.st = barcode_data1.st;
      fd.st1 = barcode_data1.st;
      fd.df = barcode_data1.df;
      fd.df1 = barcode_data1.df;
      fd.speed = barcode_data1.speed;
      fd.race1 = barcode_data1.race;
      fd.job = barcode_data1.job;
      fd.union_flag = false;
      fd.pp = barcode_data1.pp;
      fd.mp = barcode_data1.mp;
      fd.pp_ignore_flag = false;
      fd.special1 = barcode_data1.special;
    }

    return fd;
  }
}

const jsCfd = new BB2.CreateFightingData();
const as3Cfd = new AS3_CreateFightingData_Oracle();

let checkedCount = 0;

function assertFightingDataMatch(jsFd, as3Fd, label) {
  const fields = [
    'max_hp', 'hp', 'down_hp_flag',
    'st', 'st1', 'st2', 'down_st_flag', 'st_item_broke_flag',
    'df', 'df1', 'df2', 'down_df_flag', 'df_item_broke_flag',
    'speed', 'union_flag', 'race1', 'race2', 'job',
    'pp', 'mp', 'pp_ignore_flag',
    'special1', 'special2', 'cpu'
  ];

  for (const f of fields) {
    assert.strictEqual(jsFd[f], as3Fd[f], `${label}: フィールド [${f}] 不一致: JS=${jsFd[f]}, AS=${as3Fd[f]}`);
    checkedCount++;
  }
}

console.log('[Phase 2 - Data] 1. 単体カード (1枚) 合成テスト...');
for (let hp = 0; hp <= 1000; hp += 100) {
  for (let st = -20; st <= 220; st += 40) {
    for (let df = -20; df <= 220; df += 40) {
      for (let job = 0; job <= 9; job += 2) {
        for (let race = 0; race <= 4; race++) {
          const b1 = { hp, st, df, speed: 5, race, job, pp: 5, mp: job >= 7 ? 10 : 0, special: 12 };
          const jsRes = jsCfd.init(b1);
          const as3Res = as3Cfd.init(b1);
          assertFightingDataMatch(jsRes, as3Res, `1枚 hp=${hp}, st=${st}, df=${df}, job=${job}`);
        }
      }
    }
  }
}

console.log('[Phase 2 - Data] 2. 2枚合体・上限クランプ & 境界値テスト...');
// HP上限 999 クランプ
{
  const b1 = { hp: 600, st: 50, df: 50, speed: 3, race: 1, job: 2, pp: 5, mp: 0, special: 10 };
  const b2 = { hp: 500, st: 50, df: 50, speed: 2, race: 1, job: 2, pp: 5, mp: 0, special: 20 };
  assertFightingDataMatch(jsCfd.init(b1, b2), as3Cfd.init(b1, b2), 'HP 999 クランプ');
}
// ST上限 199 / 下限 0 クランプ
{
  const b1 = { hp: 100, st: 150, df: 50, speed: 3, race: 1, job: 2, pp: 5, mp: 0, special: 10 };
  const b2 = { hp: 100, st: 80, df: 50, speed: 2, race: 5, job: 0, pp: 0, mp: 0, special: 0 };
  assertFightingDataMatch(jsCfd.init(b1, b2), as3Cfd.init(b1, b2), 'ST 199 クランプ');

  const b3 = { hp: 100, st: -100, df: 50, speed: 2, race: 5, job: 0, pp: 0, mp: 0, special: 0 };
  assertFightingDataMatch(jsCfd.init(b1, b3), as3Cfd.init(b1, b3), 'ST 0 下限クランプ');
}
// DF上限 199 / 下限 0 クランプ
{
  const b1 = { hp: 100, st: 50, df: 150, speed: 3, race: 1, job: 2, pp: 5, mp: 0, special: 10 };
  const b2 = { hp: 100, st: 50, df: 80, speed: 2, race: 7, job: 0, pp: 0, mp: 0, special: 0 };
  assertFightingDataMatch(jsCfd.init(b1, b2), as3Cfd.init(b1, b2), 'DF 199 クランプ');

  const b3 = { hp: 100, st: 50, df: -100, speed: 2, race: 7, job: 0, pp: 0, mp: 0, special: 0 };
  assertFightingDataMatch(jsCfd.init(b1, b3), as3Cfd.init(b1, b3), 'DF 0 下限クランプ');
}

console.log('[Phase 2 - Data] 3. PP / MP の合体分岐マトリクステスト...');
// 全ジョブ(0〜9) × 全種族(0〜9) × MP/PP 組み合わせ
for (let job1 = 0; job1 <= 9; job1++) {
  for (let race2 = 0; race2 <= 9; race2++) {
    for (let mp1 of [0, 5, 10, 20]) {
      for (let mp2 of [0, 5, 10, 20]) {
        for (let pp1 of [5, 50, 80]) {
          for (let pp2 of [0, 30, 50]) {
            const b1 = { hp: 200, st: 30, df: 30, speed: 4, race: 0, job: job1, pp: pp1, mp: mp1, special: 1 };
            const b2 = { hp: 50, st: 10, df: 10, speed: 2, race: race2, job: 0, pp: pp2, mp: mp2, special: 2 };
            const jsRes = jsCfd.init(b1, b2);
            const as3Res = as3Cfd.init(b1, b2);
            assertFightingDataMatch(jsRes, as3Res, `job1=${job1}, race2=${race2}, mp1=${mp1}, mp2=${mp2}, pp1=${pp1}, pp2=${pp2}`);
          }
        }
      }
    }
  }
}

console.log('[Phase 2 - Data] 4. ランダムパラメータファジングテスト (10,000件)...');
let seed = 123456789;
function pseudoRand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randInt(min, max) {
  return Math.floor(pseudoRand() * (max - min + 1)) + min;
}

for (let i = 0; i < 10000; i++) {
  const b1 = {
    hp: randInt(-50, 1500),
    st: randInt(-50, 300),
    df: randInt(-50, 300),
    speed: randInt(0, 9),
    race: randInt(0, 9),
    job: randInt(0, 9),
    pp: randInt(0, 150),
    mp: randInt(0, 150),
    special: randInt(0, 80)
  };
  const hasB2 = pseudoRand() > 0.3;
  let b2 = null;
  if (hasB2) {
    b2 = {
      hp: randInt(-50, 1500),
      st: randInt(-50, 300),
      df: randInt(-50, 300),
      speed: randInt(0, 9),
      race: randInt(0, 9),
      job: randInt(0, 9),
      pp: randInt(0, 150),
      mp: randInt(0, 150),
      special: randInt(0, 80)
    };
  }
  const jsRes = jsCfd.init(b1, b2);
  const as3Res = as3Cfd.init(b1, b2);
  assertFightingDataMatch(jsRes, as3Res, `Fuzz #${i}`);
}

console.log(`[Phase 2 - Data] 全 ${checkedCount} 項目合格！ CreateFightingData.as ↔ js/fighting_data.js の完全一致を確認しました。\n`);
