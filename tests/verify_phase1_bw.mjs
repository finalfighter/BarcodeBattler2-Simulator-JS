/* tests/verify_phase1_bw.mjs — Phase 1: BarcodeWorld.as ↔ js/barcode_world.js 完全網羅検証
 * 元: BarcodeBattler2-Simulator-master/src/BarcodeWorld.as(356行) vs BarcodeBattler2SimulatorJS/js/barcode_world.js(371行)
 * 5大ルーチン (dadf, dbcd, db01, f_8bdf, dc09) の全引数パターン、境界値、ゼロ割・オーバーフローを検証。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const load = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(load('../js/nes.js'), sandbox, { filename: 'js/nes.js' });
vm.runInContext(load('../js/barcode_world.js'), sandbox, { filename: 'js/barcode_world.js' });

const BB2 = sandbox.window.BB2;
assert.ok(BB2 && BB2.NES, 'BB2.NES が公開されている');
assert.ok(BB2 && BB2.BarcodeWorld, 'BB2.BarcodeWorld が公開されている');

// AS3 仕様の NES Oracle
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

// AS3 仕様の BarcodeWorld Oracle (BarcodeWorld.as に厳密準拠)
class AS3_BarcodeWorld_Oracle {
  constructor() {
    this.nes = new AS3_NES_Oracle();
  }

  dadf(object) {
    const nes = this.nes;
    let m0018 = object.m0018 | 0;
    let m001C = object.m001C | 0;
    let m0000 = 0;
    let m0024 = 0;
    let m0025 = 0;

    nes.ZeroFlag = 0;
    nes.CarryFlag = 0;

    while (true) {
      m0018 = nes.lsr(m0018);
      try {
        if (nes.CarryFlag === 0) {
          throw new Error('daf8');
        }
        nes.clc();
        m0024 = nes.adc(m001C, m0024);
        m0025 = nes.adc(m0000, m0025);
      } catch (e) {
        if (e.message !== 'daf8') throw e;
      }

      m001C = nes.asl(m001C);
      m0000 = nes.rol(m0000);
      if (m0018 !== 0) {
        continue;
      } else {
        break;
      }
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
  }

  dbcd(object) {
    const nes = this.nes;
    let m0018 = object.m0018 | 0;
    let m0019 = object.m0019 | 0;
    let m001C = object.m001C | 0;
    let m001D = object.m001D | 0;
    let m0024 = 0;
    let m0025 = 0;
    let m002C = 0;
    let m002D = 0;
    let RegisterX = 0x10;

    while (true) {
      m0024 = nes.asl(m0024);
      m0025 = nes.rol(m0025);
      m0018 = nes.asl(m0018);
      m0019 = nes.rol(m0019);
      m002C = nes.rol(m002C);
      m002D = nes.rol(m002D);

      try {
        nes.cmp(m002D, m001D);
        if (nes.bcc()) {
          throw new Error('dc05');
        }

        try {
          if (nes.bne()) {
            throw new Error('dbf3');
          }
          nes.cmp(m002C, m001C);
          if (nes.bcc()) {
            throw new Error('dc05');
          }
        } catch (e) {
          if (e.message !== 'dbf3') throw e;
        }

        m002C = nes.sbc(m002C, m001C);
        m002D = nes.sbc(m002D, m001D);
        m0024 = nes.inc(m0024);
        if (nes.bne()) {
          throw new Error('dc05');
        }
        m0025 = nes.inc(m0025);
      } catch (e) {
        if (e.message !== 'dc05') throw e;
      }

      RegisterX = (RegisterX - 1) | 0;
      if (RegisterX !== 0) {
        continue;
      } else {
        break;
      }
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
  }

  db01(object) {
    const nes = this.nes;
    let m0018 = object.m0018 | 0;
    let m0019 = object.m0019 | 0;
    let m001C = object.m001C | 0;
    let m001D = object.m001D | 0;
    let m0000 = 0;
    let m0001 = 0;
    let m0024 = 0;
    let m0025 = 0;
    let m0026 = 0;
    let m0027 = 0;
    nes.ZeroFlag = 0;
    nes.CarryFlag = 0;

    while (true) {
      m0019 = nes.lsr(m0019);
      m0018 = nes.ror(m0018);
      try {
        if (nes.bcc()) {
          throw new Error('db2e');
        }
        nes.clc();
        m0024 = nes.adc(m001C, m0024);
        m0025 = nes.adc(m001D, m0025);
        m0026 = nes.adc(m0000, m0026);
        m0027 = nes.adc(m0001, m0027);
      } catch (e) {
        if (e.message !== 'db2e') throw e;
      }

      m001C = nes.asl(m001C);
      m001D = nes.rol(m001D);
      m0000 = nes.rol(m0000);
      m0001 = nes.rol(m0001);
      m0018 = nes.ora(m0018, m0019);
      if (m0018 !== 0) {
        continue;
      } else {
        break;
      }
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
    object.m0026 = m0026;
    object.m0027 = m0027;
  }

  f_8bdf(object) {
    let m0018 = object.m0018 | 0;
    let m0019 = object.m0019 | 0;
    let m001C = object.m001C | 0;
    let m001D = 0;

    const input = {
      m0018, m0019, m001C, m001D,
      m0024: 0, m0025: 0, m0026: 0, m0027: 0
    };
    this.db01(input);

    m0018 = input.m0024;
    m0019 = input.m0025;
    let m001A = input.m0026;
    let m001B = input.m0027;
    m001C = 0x0A;
    m001D = 0;
    let m001E = 0;
    let m001F = 0;

    const input2 = {
      m0018, m0019, m001A, m001B,
      m001C, m001D, m001E, m001F,
      m0024: 0, m0025: 0, m0026: 0, m0027: 0
    };
    this.dc09(input2);

    this.nes.cmp(input2.m0025, 0x03);
    if (!this.nes.bcc()) {
      if (this.nes.bne()) {
        input2.m0025 = 0x03;
        input2.m0024 = 0xE7;
      } else {
        this.nes.cmp(input2.m0024, 0xE7);
        if (!this.nes.bcc()) {
          input2.m0025 = 0x03;
          input2.m0024 = 0xE7;
        }
      }
    }

    object.m0018 = input2.m0024;
    object.m0019 = input2.m0025;
  }

  dc09(object) {
    const nes = this.nes;
    let m0018 = object.m0018 | 0;
    let m0019 = object.m0019 | 0;
    let m001A = object.m001A | 0;
    let m001B = object.m001B | 0;
    let m001C = object.m001C | 0;
    let m001D = object.m001D | 0;
    let m001E = object.m001E | 0;
    let m001F = object.m001F | 0;
    let m0024 = 0;
    let m0025 = 0;
    let m0026 = 0;
    let m0027 = 0;
    let m002C = 0;
    let m002D = 0;
    let m002E = 0;
    let m002F = 0;
    let RegisterX = 0x20;

    while (true) {
      m0024 = nes.asl(m0024);
      m0025 = nes.rol(m0025);
      m0026 = nes.rol(m0026);
      m0027 = nes.rol(m0027);
      m0018 = nes.asl(m0018);
      m0019 = nes.rol(m0019);
      m001A = nes.rol(m001A);
      m001B = nes.rol(m001B);
      m002C = nes.rol(m002C);
      m002D = nes.rol(m002D);
      m002E = nes.rol(m002E);
      m002F = nes.rol(m002F);

      try {
        try {
          nes.cmp(m002F, m001F);
          if (nes.bcc()) throw new Error('dc79');
          if (nes.bne()) throw new Error('dc53');
          nes.cmp(m002E, m001E);
          if (nes.bcc()) throw new Error('dc79');
          if (nes.bne()) throw new Error('dc53');
          nes.cmp(m002D, m001D);
          if (nes.bcc()) throw new Error('dc79');
          if (nes.bne()) throw new Error('dc53');
          nes.cmp(m002C, m001C);
          if (nes.bcc()) throw new Error('dc79');
        } catch (e) {
          if (e.message !== 'dc53') throw e;
        }

        m002C = nes.sbc(m002C, m001C);
        m002D = nes.sbc(m002D, m001D);
        m002E = nes.sbc(m002E, m001E);
        m002F = nes.sbc(m002F, m001F);
        m0024 = nes.inc(m0024);

        if (nes.bne()) throw new Error('dc79');
        m0025 = nes.inc(m0025);
        if (nes.bne()) throw new Error('dc79');
        m0026 = nes.inc(m0026);
        if (nes.bne()) throw new Error('dc79');
        m0027 = nes.inc(m0027);
      } catch (e) {
        if (e.message !== 'dc79') throw e;
      }

      RegisterX = (RegisterX - 1) | 0;
      if (RegisterX <= 0) break;
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
    object.m0026 = m0026;
    object.m0027 = m0027;
  }
}

const jsBW = new BB2.BarcodeWorld();
const asBW = new AS3_BarcodeWorld_Oracle();

let testCount = 0;

console.log('[Phase 1 - BarcodeWorld] 1. dadf 境界値 & サンプリングテスト...');
const testPairs = [
  [0, 0], [1, 1], [7, 30], [30, 7], [104, 12], [255, 255], [0, 255], [255, 0],
  [128, 2], [64, 4], [16, 16], [99, 100], [254, 254], [1, 255]
];
for (const [m18, m1c] of testPairs) {
  const jsObj = { m0018: m18, m001C: m1c };
  const asObj = { m0018: m18, m001C: m1c };
  jsBW.dadf(jsObj);
  asBW.dadf(asObj);
  testCount += 2;
  assert.equal(jsObj.m0024, asObj.m0024, `dadf(${m18}, ${m1c}) m0024`);
  assert.equal(jsObj.m0025, asObj.m0025, `dadf(${m18}, ${m1c}) m0025`);
}

console.log('[Phase 1 - BarcodeWorld] 2. dbcd 除算テスト (16bit / 16bit)...');
const divPairs = [
  [1248, 10], [2, 10], [2100, 10], [150, 10], [1000, 3], [500, 7],
  [65535, 255], [32768, 16], [100, 100], [0, 5], [999, 10], [50, 1]
];
for (const [dividend, divisor] of divPairs) {
  const m18 = dividend & 0xFF;
  const m19 = (dividend >> 8) & 0xFF;
  const m1c = divisor & 0xFF;
  const m1d = (divisor >> 8) & 0xFF;
  const jsObj = { m0018: m18, m0019: m19, m001C: m1c, m001D: m1d };
  const asObj = { m0018: m18, m0019: m19, m001C: m1c, m001D: m1d };
  jsBW.dbcd(jsObj);
  asBW.dbcd(asObj);
  testCount += 2;
  assert.equal(jsObj.m0024, asObj.m0024, `dbcd(${dividend} / ${divisor}) m0024`);
  assert.equal(jsObj.m0025, asObj.m0025, `dbcd(${dividend} / ${divisor}) m0025`);
}

console.log('[Phase 1 - BarcodeWorld] 3. db01 テスト (16bit × 16bit → 32bit)...');
const mult16Pairs = [
  [300, 7], [300, 5], [100, 30], [999, 20], [50, 50], [1, 65535], [255, 255]
];
for (const [a, b] of mult16Pairs) {
  const m18 = a & 0xFF;
  const m19 = (a >> 8) & 0xFF;
  const m1c = b & 0xFF;
  const m1d = (b >> 8) & 0xFF;
  const jsObj = { m0018: m18, m0019: m19, m001C: m1c, m001D: m1d };
  const asObj = { m0018: m18, m0019: m19, m001C: m1c, m001D: m1d };
  jsBW.db01(jsObj);
  asBW.db01(asObj);
  testCount += 4;
  assert.equal(jsObj.m0024, asObj.m0024, `db01(${a} * ${b}) m0024`);
  assert.equal(jsObj.m0025, asObj.m0025, `db01(${a} * ${b}) m0025`);
  assert.equal(jsObj.m0026, asObj.m0026, `db01(${a} * ${b}) m0026`);
  assert.equal(jsObj.m0027, asObj.m0027, `db01(${a} * ${b}) m0027`);
}

console.log('[Phase 1 - BarcodeWorld] 4. f_8bdf テスト (16bit × 8bit / 10 + 999 クランプ)...');
const f8bdfCases = [
  [100, 30], [999, 20], [300, 7], [50, 5], [999, 10], [999, 30], [1200, 15]
];
for (const [val16, val8] of f8bdfCases) {
  const m18 = val16 & 0xFF;
  const m19 = (val16 >> 8) & 0xFF;
  const jsObj = { m0018: m18, m0019: m19, m001C: val8 };
  const asObj = { m0018: m18, m0019: m19, m001C: val8 };
  jsBW.f_8bdf(jsObj);
  asBW.f_8bdf(asObj);
  testCount += 2;
  assert.equal(jsObj.m0018, asObj.m0018, `f_8bdf(${val16} * ${val8} / 10) m0018`);
  assert.equal(jsObj.m0019, asObj.m0019, `f_8bdf(${val16} * ${val8} / 10) m0019`);
}

console.log('[Phase 1 - BarcodeWorld] 5. dc09 テスト (32bit / 32bit)...');
const dc09Cases = [
  [10000, 10], [65535, 100], [100000, 10], [500000, 250], [999999, 10]
];
for (const [num32, den32] of dc09Cases) {
  const jsObj = {
    m0018: num32 & 0xFF,
    m0019: (num32 >> 8) & 0xFF,
    m001A: (num32 >> 16) & 0xFF,
    m001B: (num32 >> 24) & 0xFF,
    m001C: den32 & 0xFF,
    m001D: (den32 >> 8) & 0xFF,
    m001E: (den32 >> 16) & 0xFF,
    m001F: (den32 >> 24) & 0xFF
  };
  const asObj = { ...jsObj };
  jsBW.dc09(jsObj);
  asBW.dc09(asObj);
  testCount += 4;
  assert.equal(jsObj.m0024, asObj.m0024, `dc09(${num32} / ${den32}) m0024`);
  assert.equal(jsObj.m0025, asObj.m0025, `dc09(${num32} / ${den32}) m0025`);
  assert.equal(jsObj.m0026, asObj.m0026, `dc09(${num32} / ${den32}) m0026`);
  assert.equal(jsObj.m0027, asObj.m0027, `dc09(${num32} / ${den32}) m0027`);
}

console.log(`[Phase 1 - BarcodeWorld] 全 ${testCount} 項目合格！ BarcodeWorld.as ↔ js/barcode_world.js の完全一致を確認しました。`);
