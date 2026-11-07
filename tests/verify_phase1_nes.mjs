/* tests/verify_phase1_nes.mjs — Phase 1: NES.as ↔ js/nes.js 完全網羅検証
 * 元: BarcodeBattler2-Simulator-master/src/NES.as(184行) vs BarcodeBattler2SimulatorJS/js/nes.js(121行)
 * 全15命令の境界値・全分岐・フラグ動作をActionScript 3仕様と完全突合検証する。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const load = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.NES, 'BB2.NES が公開されている');

// AS3 仕様の Oracle 実装 (NES.as に厳密準拠)
class AS3_NES_Oracle {
  constructor() {
    this.CarryFlag = 0;
    this.ZeroFlag = 0;
  }
  clc() { this.CarryFlag = 0; }
  sec() { this.CarryFlag = 1; }
  inc(num) {
    num = (num + 1) | 0;
    if (num > 255) {
      num = (num - 255) | 0;
      this.CarryFlag = 1;
    } else {
      this.CarryFlag = 0;
    }
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  cmp(num, num2) {
    num = (num - num2) | 0;
    this.ZeroFlag = (num === 0) ? 1 : 0;
    this.CarryFlag = (num < 0) ? 0 : 1;
  }
  bcc() { return this.CarryFlag === 0; }
  bcs() { return this.CarryFlag === 1; }
  bne() { return this.ZeroFlag === 0; }
  adc(num, num2) {
    num = (num + num2 + this.CarryFlag) | 0;
    if (num > 255) {
      num = (num - 255) | 0;
      this.CarryFlag = 1;
    } else {
      this.CarryFlag = 0;
    }
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  sbc(num, num2) {
    const un = this.CarryFlag ? 0 : 1;
    num = (num - num2 - un) | 0;
    if (num >= 0) {
      this.CarryFlag = 1;
    } else {
      num = (num + 255) | 0;
      this.CarryFlag = 0;
    }
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  decbin8(num) {
    let bin8 = (num >>> 0).toString(2);
    while (bin8.length < 8) {
      bin8 = '0' + bin8;
    }
    return bin8;
  }
  lsr(num) {
    let bin8 = this.decbin8(num);
    this.CarryFlag = (bin8.charAt(7) === '1') ? 1 : 0;
    bin8 = '0' + bin8.substr(0, 7);
    num = parseInt(bin8, 2);
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  asl(num) {
    let bin8 = this.decbin8(num);
    this.CarryFlag = (bin8.charAt(0) === '1') ? 1 : 0;
    bin8 = bin8.substr(1, 7) + '0';
    num = parseInt(bin8, 2);
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  rol(num) {
    let bin8 = this.decbin8(num);
    bin8 = bin8.substr(1, 7) + this.CarryFlag.toString();
    this.CarryFlag = (this.decbin8(num).charAt(0) === '1') ? 1 : 0;
    num = parseInt(bin8, 2);
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  ror(num) {
    let bin8 = this.decbin8(num);
    bin8 = this.CarryFlag.toString() + bin8.substr(0, 7);
    this.CarryFlag = (this.decbin8(num).substr(7, 1) === '1') ? 1 : 0;
    num = parseInt(bin8, 2);
    this.ZeroFlag = (num === 0) ? 1 : 0;
    return num;
  }
  ora(num, num2) {
    return (num | num2) | 0;
  }
}

const jsNes = new BB2.NES();
const asNes = new AS3_NES_Oracle();

let testCount = 0;

function assertMatch(opName, jsVal, asVal) {
  testCount++;
  assert.equal(jsVal, asVal, `${opName} 戻り値不一致: JS=${jsVal}, AS3=${asVal}`);
  assert.equal(jsNes.CarryFlag, asNes.CarryFlag, `${opName} CarryFlag不一致: JS=${jsNes.CarryFlag}, AS3=${asNes.CarryFlag}`);
  assert.equal(jsNes.ZeroFlag, asNes.ZeroFlag, `${opName} ZeroFlag不一致: JS=${jsNes.ZeroFlag}, AS3=${asNes.ZeroFlag}`);
}

console.log('[Phase 1 - NES] 1. decbin8 網羅テスト (0〜255 + 境界値)...');
for (let i = 0; i <= 255; i++) {
  assert.equal(jsNes.decbin8(i), asNes.decbin8(i), `decbin8(${i})`);
  testCount++;
}

console.log('[Phase 1 - NES] 2. inc 全入力テスト (0〜255)...');
for (let i = 0; i <= 255; i++) {
  jsNes.clc(); asNes.clc();
  assertMatch(`inc(${i}) [clc]`, jsNes.inc(i), asNes.inc(i));
  jsNes.sec(); asNes.sec();
  assertMatch(`inc(${i}) [sec]`, jsNes.inc(i), asNes.inc(i));
}

console.log('[Phase 1 - NES] 3. lsr 全入力テスト (0〜255)...');
for (let i = 0; i <= 255; i++) {
  jsNes.clc(); asNes.clc();
  assertMatch(`lsr(${i}) [clc]`, jsNes.lsr(i), asNes.lsr(i));
  jsNes.sec(); asNes.sec();
  assertMatch(`lsr(${i}) [sec]`, jsNes.lsr(i), asNes.lsr(i));
}

console.log('[Phase 1 - NES] 4. asl 全入力テスト (0〜255)...');
for (let i = 0; i <= 255; i++) {
  jsNes.clc(); asNes.clc();
  assertMatch(`asl(${i}) [clc]`, jsNes.asl(i), asNes.asl(i));
  jsNes.sec(); asNes.sec();
  assertMatch(`asl(${i}) [sec]`, jsNes.asl(i), asNes.asl(i));
}

console.log('[Phase 1 - NES] 5. rol 全入力テスト (0〜255 × Carry 0/1)...');
for (let i = 0; i <= 255; i++) {
  jsNes.clc(); asNes.clc();
  assertMatch(`rol(${i}) [clc]`, jsNes.rol(i), asNes.rol(i));
  jsNes.sec(); asNes.sec();
  assertMatch(`rol(${i}) [sec]`, jsNes.rol(i), asNes.rol(i));
}

console.log('[Phase 1 - NES] 6. ror 全入力テスト (0〜255 × Carry 0/1)...');
for (let i = 0; i <= 255; i++) {
  jsNes.clc(); asNes.clc();
  assertMatch(`ror(${i}) [clc]`, jsNes.ror(i), asNes.ror(i));
  jsNes.sec(); asNes.sec();
  assertMatch(`ror(${i}) [sec]`, jsNes.ror(i), asNes.ror(i));
}

console.log('[Phase 1 - NES] 7. adc 境界値 & 全マトリクステスト...');
const boundaryValues = [0, 1, 2, 127, 128, 129, 254, 255];
for (const a of boundaryValues) {
  for (const b of boundaryValues) {
    for (const c of [0, 1]) {
      if (c) { jsNes.sec(); asNes.sec(); } else { jsNes.clc(); asNes.clc(); }
      assertMatch(`adc(${a}, ${b}) [c=${c}]`, jsNes.adc(a, b), asNes.adc(a, b));
    }
  }
}
// 疑似乱数での追加サンプリング (1000回)
let seed = 123456789;
function pseudoRand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % 256;
}
for (let i = 0; i < 1000; i++) {
  const a = pseudoRand();
  const b = pseudoRand();
  const c = pseudoRand() % 2;
  if (c) { jsNes.sec(); asNes.sec(); } else { jsNes.clc(); asNes.clc(); }
  assertMatch(`adc_rand(${a}, ${b})`, jsNes.adc(a, b), asNes.adc(a, b));
}

console.log('[Phase 1 - NES] 8. sbc 境界値 & 全マトリクステスト...');
for (const a of boundaryValues) {
  for (const b of boundaryValues) {
    for (const c of [0, 1]) {
      if (c) { jsNes.sec(); asNes.sec(); } else { jsNes.clc(); asNes.clc(); }
      assertMatch(`sbc(${a}, ${b}) [c=${c}]`, jsNes.sbc(a, b), asNes.sbc(a, b));
    }
  }
}
for (let i = 0; i < 1000; i++) {
  const a = pseudoRand();
  const b = pseudoRand();
  const c = pseudoRand() % 2;
  if (c) { jsNes.sec(); asNes.sec(); } else { jsNes.clc(); asNes.clc(); }
  assertMatch(`sbc_rand(${a}, ${b})`, jsNes.sbc(a, b), asNes.sbc(a, b));
}

console.log('[Phase 1 - NES] 9. cmp 境界値 & 全マトリクステスト...');
for (const a of boundaryValues) {
  for (const b of boundaryValues) {
    jsNes.cmp(a, b);
    asNes.cmp(a, b);
    testCount++;
    assert.equal(jsNes.CarryFlag, asNes.CarryFlag, `cmp(${a}, ${b}) CarryFlag`);
    assert.equal(jsNes.ZeroFlag, asNes.ZeroFlag, `cmp(${a}, ${b}) ZeroFlag`);
    assert.equal(jsNes.bcc(), asNes.bcc(), `bcc() after cmp(${a}, ${b})`);
    assert.equal(jsNes.bcs(), asNes.bcs(), `bcs() after cmp(${a}, ${b})`);
    assert.equal(jsNes.bne(), asNes.bne(), `bne() after cmp(${a}, ${b})`);
  }
}

console.log('[Phase 1 - NES] 10. ora テスト...');
for (const a of boundaryValues) {
  for (const b of boundaryValues) {
    testCount++;
    assert.equal(jsNes.ora(a, b), asNes.ora(a, b), `ora(${a}, ${b})`);
  }
}

console.log(`[Phase 1 - NES] 全 ${testCount} 項目合格！ NES.as ↔ js/nes.js の完全一致を確認しました。`);
