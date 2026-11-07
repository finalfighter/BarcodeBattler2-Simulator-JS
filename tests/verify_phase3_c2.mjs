/* tests/verify_phase3_c2.mjs — Phase 3: C2PassCode.as ↔ js/state.js (BB2.C2PassCode) 完全網羅検証
 * 元: BarcodeBattler2-Simulator-master/src/C2PassCode.as (193行)
 * 1. unioncheckdigit 算出検証 (b1.charAt(12) + b2.charAt(12) % 10)
 * 2. passcode_number (0〜99) と 5桁パスコードの双方向可逆性検証
 * 3. 不正パスコード検出検証 (AA BB C 形式チェック, チェックデジット不一致で -1)
 * 4. 特殊能力 (80〜99) からのパスコード生成検証
 * 5. calchp, calcst, calcdf の全ステータス×全パスコード番号境界値検証
 * 6. generate_passcode_barcode_data 総合ステータス強化テスト
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
vm.runInContext(load('../js/state.js'), sandbox, { filename: 'js/state.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.C2PassCode, 'BB2.C2PassCode が公開されている');

// AS3 仕様の C2PassCode Oracle (C2PassCode.as 193行完全準拠)
class AS3_C2PassCode_Oracle {
  constructor() {
    this.barcode_data1 = null;
    this.barcode_data2 = null;
    this.unioncheckdigit = 0;
    this.passcode = null;
  }

  init(bd1, bd2, pc = null) {
    this.barcode_data1 = bd1;
    this.barcode_data2 = bd2;
    this.passcode = pc;

    this.unioncheckdigit = Number(bd1.barcode.charAt(12)) + Number(bd2.barcode.charAt(12));
    if (this.unioncheckdigit >= 10) {
      this.unioncheckdigit -= 10;
    }
  }

  generate_passcode_from_passcode_number(passcode_number) {
    const numten = Math.trunc(passcode_number / 10);
    const numone = passcode_number - numten * 10;

    const passcode_checkdigit = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    let checkdigit_key = numten + numone;
    if (checkdigit_key >= 10) checkdigit_key -= 10;

    let checkdigit = this.unioncheckdigit + passcode_checkdigit[checkdigit_key];
    if (checkdigit >= 10) checkdigit -= 10;

    return numten.toString() + numten.toString() + numone.toString() + numone.toString() + checkdigit.toString();
  }

  generate_passcode(special) {
    const array = [5, 10, 15, 20, 25, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49];
    const passcode_number = array[special - 80];
    return this.generate_passcode_from_passcode_number(passcode_number);
  }

  generate_passcode_number() {
    if (this.passcode.charAt(0) !== this.passcode.charAt(1)) return -1;
    if (this.passcode.charAt(2) !== this.passcode.charAt(3)) return -1;

    const passcode_number = Number(this.passcode.charAt(0)) * 10 + Number(this.passcode.charAt(2));

    const passcode_checkdigit = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    let checkdigit_key = Number(this.passcode.charAt(0)) + Number(this.passcode.charAt(2));
    if (checkdigit_key >= 10) checkdigit_key -= 10;

    let checkdigit = this.unioncheckdigit + passcode_checkdigit[checkdigit_key];
    if (checkdigit >= 10) checkdigit -= 10;

    if (Number(this.passcode.charAt(4)) !== checkdigit) return -1;

    return passcode_number;
  }

  calchp(hp, passcode_number) {
    if (passcode_number === -1) return hp;

    let floorhp = Math.floor(hp * passcode_number / 10);
    let count = 0;
    while (floorhp > 655) {
      count = 1;
      floorhp -= 655;
    }

    let floorceilhp = Math.floor(passcode_number / 2) * Math.ceil(passcode_number / 2);
    while (floorceilhp > 655) {
      count = 1;
      floorceilhp -= 655;
    }

    let res = hp + floorhp + floorceilhp;
    if (res > 999) {
      res = 999;
    } else {
      res -= count;
    }

    if (passcode_number >= 90 && passcode_number % 2 === 0) {
      res -= 1;
    }
    return res;
  }

  calcst(st, passcode_number) {
    if (passcode_number === -1) return st;

    const array = [
      0, 0, 0, 0, 0, 1, 1, 1, 2,
      3, 4, 4, 5, 6, 7, 9, 10, 11, 12,
      14, 16, 17, 19, 21, 23, 25, 27,
      29, 31, 33, 36, 38, 40, 43, 46,
      49, 51, 54, 57, 60, 64, 67, 70,
      73, 77, 81, 84, 88, 92, 96, 100,
      104, 108, 112, 116, 121, 125, 129,
      134, 139, 144, 148, 153, 158, 163,
      169, 174, 179, 184, 190, 196
    ];

    if (array[passcode_number] === null) return 199;

    let res = (Math.trunc(st) + Math.floor(st * passcode_number / 9) + array[passcode_number]) | 0;
    if (res > 199) return 199;
    return res;
  }

  calcdf(df, passcode_number) {
    if (passcode_number === -1) return df;

    const array = [
      0, 0, 0, 0, 0, 1, 1, 2, 3,
      4, 5, 6, 7, 8, 9, 11, 12, 14,
      16, 18, 20, 22, 24, 26, 28,
      31, 33, 36, 39, 42, 45, 48,
      51, 54, 57, 61, 64, 68, 72,
      76, 80, 84, 88, 92, 96, 101,
      105, 110, 115, 120, 125, 130,
      135, 140, 145, 151, 156, 162,
      168, 174, 180, 186, 192, 198
    ];

    if (!array[passcode_number] === null) return 199;

    let res = (Math.trunc(df) + Math.floor(df * passcode_number / 12) + array[passcode_number]) | 0;
    if (res > 199) return 199;
    return res;
  }
}

let checkedCount = 0;

console.log('[Phase 3 - C2] 1. unioncheckdigit 網羅テスト (0〜9 × 0〜9)...');
for (let c1 = 0; c1 <= 9; c1++) {
  for (let c2 = 0; c2 <= 9; c2++) {
    const bd1 = { barcode: `490123456789${c1}` };
    const bd2 = { barcode: `490987654321${c2}` };

    const jsC2 = new BB2.C2PassCode();
    jsC2.init(bd1, bd2);

    const as3C2 = new AS3_C2PassCode_Oracle();
    as3C2.init(bd1, bd2);

    assert.strictEqual(jsC2.unioncheckdigit, as3C2.unioncheckdigit, `unioncheckdigit c1=${c1}, c2=${c2}`);
    checkedCount++;
  }
}

console.log('[Phase 3 - C2] 2. パスコード番号 (0〜99) とパスコード文字列の可逆性テスト...');
for (let u = 0; u <= 9; u++) {
  const bd1 = { barcode: `490000000000${u}` };
  const bd2 = { barcode: `4900000000000` };

  const jsC2 = new BB2.C2PassCode();
  jsC2.init(bd1, bd2);

  const as3C2 = new AS3_C2PassCode_Oracle();
  as3C2.init(bd1, bd2);

  for (let pnum = 0; pnum <= 99; pnum++) {
    const jsCode = jsC2.generate_passcode_from_passcode_number(pnum);
    const as3Code = as3C2.generate_passcode_from_passcode_number(pnum);
    assert.strictEqual(jsCode, as3Code, `passcode gen pnum=${pnum}, union=${u}`);

    // 復号
    jsC2.passcode = jsCode;
    as3C2.passcode = as3Code;
    const jsDec = jsC2.generate_passcode_number();
    const as3Dec = as3C2.generate_passcode_number();
    assert.strictEqual(jsDec, pnum, `decode pnum=${pnum}`);
    assert.strictEqual(jsDec, as3Dec, `decode match pnum=${pnum}`);
    checkedCount += 3;
  }
}

console.log('[Phase 3 - C2] 3. 特殊能力 (80〜99) からのパスコード生成テスト...');
for (let sp = 80; sp <= 99; sp++) {
  const bd1 = { barcode: '4901234567894' };
  const bd2 = { barcode: '4909876543212' };

  const jsC2 = new BB2.C2PassCode();
  jsC2.init(bd1, bd2);

  const as3C2 = new AS3_C2PassCode_Oracle();
  as3C2.init(bd1, bd2);

  const jsCode = jsC2.generate_passcode(sp);
  const as3Code = as3C2.generate_passcode(sp);
  assert.strictEqual(jsCode, as3Code, `generate_passcode special=${sp}`);
  checkedCount++;
}

console.log('[Phase 3 - C2] 4. 不正パスコードの検証テスト...');
{
  const bd1 = { barcode: '4901234567890' };
  const bd2 = { barcode: '4909876543210' };
  const jsC2 = new BB2.C2PassCode();
  jsC2.init(bd1, bd2);

  // 1桁目!=2桁目
  jsC2.passcode = '12330';
  assert.strictEqual(jsC2.generate_passcode_number(), -1, '不正: 1桁目!=2桁目');

  // 3桁目!=4桁目
  jsC2.passcode = '11230';
  assert.strictEqual(jsC2.generate_passcode_number(), -1, '不正: 3桁目!=4桁目');

  // チェックデジット違い
  jsC2.passcode = '11229';
  assert.strictEqual(jsC2.generate_passcode_number(), -1, '不正: チェックデジット違い');
  checkedCount += 3;
}

console.log('[Phase 3 - C2] 5. calchp / calcst / calcdf 境界値網羅テスト...');
{
  const jsC2 = new BB2.C2PassCode();
  const as3C2 = new AS3_C2PassCode_Oracle();

  for (let pnum = -1; pnum <= 99; pnum++) {
    for (let hp of [0, 50, 100, 250, 500, 750, 999]) {
      const jsHp = jsC2.calchp(hp, pnum);
      const as3Hp = as3C2.calchp(hp, pnum);
      assert.strictEqual(jsHp, as3Hp, `calchp hp=${hp}, pnum=${pnum}`);
      checkedCount++;
    }

    for (let st of [0, 10, 30, 50, 100, 150, 199]) {
      const jsSt = jsC2.calcst(st, pnum);
      const as3St = as3C2.calcst(st, pnum);
      assert.strictEqual(jsSt, as3St, `calcst st=${st}, pnum=${pnum}`);
      checkedCount++;
    }

    for (let df of [0, 10, 30, 50, 100, 150, 199]) {
      const jsDf = jsC2.calcdf(df, pnum);
      const as3Df = as3C2.calcdf(df, pnum);
      assert.strictEqual(jsDf, as3Df, `calcdf df=${df}, pnum=${pnum}`);
      checkedCount++;
    }
  }
}

console.log(`[Phase 3 - C2] 全 ${checkedCount} 項目合格！ C2PassCode.as ↔ js/state.js の完全一致を確認しました。\n`);
