/* js/barcode_world.js — BarcodeWorld.as の 1:1 移植(作業8 Phase 4・工程2)
 * 元: BarcodeBattler2-Simulator-master/src/BarcodeWorld.as(355 行)。
 * public 関数は dadf/dbcd/db01/f_8bdf/dc09 の 5 群のみ(元 16・58・127・180・247 行)。すべて移植。
 * 方針(roadmap リスク表「意味解釈での再実装禁止」・design §64): ラベル対応の try/catch 例外(「daf8」等)・
 * nes のインスタンスごとに 1 個の NES を持つ(元 10-12 の if(!nes){nes=new NES()})・int 代入箇所は toInt で切り捨て。
 * golden: scratch_bb4/phase4_golden.py(AS 仕様準拠 oracle)→ tests/fighting.mjs 接続(期待値 12 件)。
 * nes.js の 1:1 移植(js/nes.js)が golden 突合済みのため、その上にこの層を載せる(index.html・テストとも nes.js の後に読込む)。 */
(function () {
  'use strict';
  if (!window.BB2) { window.BB2 = {}; }

  /* AS int() 相当(nes.js・decoder.js と同じ) */
  function toInt(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : Math.trunc(n);
  }

  function BarcodeWorld() {
    /* 元 9-13: if(!nes){ nes = new NES(); } — インスタンスごとに NES を持つ */
    if (!this.nes) {
      this.nes = new window.BB2.NES();
    }
  }

  /* 元 15-55://$18*$1C={$25$24} */
  BarcodeWorld.prototype.dadf = function (object) {
    var nes = this.nes;
    /* 元 18-22:var m0018:int …(int 宣言への object 参照渡し) */
    var m0018 = toInt(object.m0018);
    var m001C = toInt(object.m001C);
    var m0000 = 0;
    var m0024 = 0;
    var m0025 = 0;

    nes.ZeroFlag = 0;
    nes.CarryFlag = 0;

    while (true) {
      /* 元 27-28://dae7 */
      m0018 = nes.lsr(m0018);
      try {
        /* 元 31-34:if(nes.CarryFlag==0){ goto daf8(ラベル例外) */
        if (nes.CarryFlag === 0) {
          throw new Error('daf8');
        }
        nes.clc();
        m0024 = nes.adc(m001C, m0024);
        m0025 = nes.adc(m0000, m0025);
        /* 元 37:m0000 は rol で流れる下位キャバイトの受け皿 */
      } catch (e) {
        /* 元 39-40:ダフト catch — daf8 の受け先 */
      }

      /* 元 42-44://daf8 */
      m001C = nes.asl(m001C);
      m0000 = nes.rol(m0000);
      if (m0018 !== 0) {
        /* 元 45-47:goto dae7( continues ループ) */
        continue;
      } else {
        /* 元 48:break */
        break;
      }
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
  };

  /* 元 57-124://{$19$18}/{$1D$1C}={$25$24} */
  BarcodeWorld.prototype.dbcd = function (object) {
    var nes = this.nes;
    var m0018 = toInt(object.m0018);
    var m0019 = toInt(object.m0019);
    var m001C = toInt(object.m001C);
    var m001D = toInt(object.m001D);
    var m0024 = 0;
    var m0025 = 0;
    var m002C = 0;
    var m002D = 0;
    var RegisterX = 0x10;

    while (true) {
      /* 元 69-70://dbd9 */
      m0024 = nes.asl(m0024);
      m0025 = nes.rol(m0025);
      m0018 = nes.asl(m0018);
      m0019 = nes.rol(m0019);
      m002C = nes.rol(m002C);
      m002D = nes.rol(m002D);

      try {
        /* 元 79-83:cmp(m002D,m001D)・bcc→ goto dc05 */
        nes.cmp(m002D, m001D);
        if (nes.bcc()) {
          throw new Error('dc05');
        }

        try {
          /* 元 86-88:bne 真なら dbf3(減算開始)へ */
          if (nes.bne()) {
            throw new Error('dbf3');
          }
          /* 元 89-92:下位比較。bcc 真なら dc05(減算スキップ) */
          nes.cmp(m002C, m001C);
          if (nes.bcc()) {
            throw new Error('dc05');
          }
        } catch (e) {
          /* 元 94-98:dbf3 以外は再 throw(dc05 群は外側 catch へ) */
          if (e.message !== 'dbf3') {
            throw e;
          }
        }

        /* 元 100://daf3(実際は dbf3 の受け位置) */
        m002C = nes.sbc(m002C, m001C);
        m002D = nes.sbc(m002D, m001D);
        m0024 = nes.inc(m0024);
        if (nes.bne()) {
          throw new Error('dc05');
        }
        m0025 = nes.inc(m0025);
      } catch (e) {
        /* 元 109-110:外側 catch — dc05 の受け先 */
      }

      /* 元 112-118://dc05 */
      RegisterX = RegisterX - 1;
      if (RegisterX !== 0) {
        continue; /* goto dbd9 */
      } else {
        break;
      }
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
  };

  /* 元 126-177://{$19$18}*{$1D$1C}={$27$26$25$24} */
  BarcodeWorld.prototype.db01 = function (object) {
    var nes = this.nes;
    var m0018 = toInt(object.m0018);
    var m0019 = toInt(object.m0019);
    var m001C = toInt(object.m001C);
    var m001D = toInt(object.m001D);
    var m0000 = 0;
    var m0001 = 0;
    var m0024 = 0;
    var m0025 = 0;
    var m0026 = 0;
    var m0027 = 0;
    nes.ZeroFlag = 0;
    nes.CarryFlag = 0;

    while (true) {
      /* 元 141-144://db0f */
      m0019 = nes.lsr(m0019);
      m0018 = nes.ror(m0018);
      try {
        /* 元 145-148:bcc 真なら db2e(加算スキップ) */
        if (nes.bcc()) {
          throw new Error('db2e');
        }
        nes.clc();
        m0024 = nes.adc(m001C, m0024);
        m0025 = nes.adc(m001D, m0025);
        m0026 = nes.adc(m0000, m0026);
        m0027 = nes.adc(m0001, m0027);
      } catch (e) {
        /* 元 155-156:ダフト catch — db2e の受け先 */
      }

      /* 元 158-163://db2e */
      m001C = nes.asl(m001C);
      m001D = nes.rol(m001D);
      m0000 = nes.rol(m0000);
      m0001 = nes.rol(m0001);
      m0018 = nes.ora(m0018, m0019);
      if (m0018 !== 0) {
        continue; /* goto db0f */
      } else {
        break;
      }
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
    object.m0026 = m0026;
    object.m0027 = m0027;
  };

  /* 元 179-244://{$19$18}*$1C/0A={$19$18} */
  BarcodeWorld.prototype.f_8bdf = function (object) {
    var nes = this.nes;
    var m0018 = toInt(object.m0018);
    var m0019 = toInt(object.m0019);
    var m001A = 0;
    var m001B = 0;
    var m001C = toInt(object.m001C);
    var m001D = 0;
    var m001E = 0;
    var m001F = 0;

    /* 元 190-200:input — db01 用の 8×0x18 + 0x24..0x27 */
    var input = {};
    input.m0018 = m0018;
    input.m0019 = m0019;
    input.m001C = m001C;
    input.m001D = m001D;
    input.m0024 = 0;
    input.m0025 = 0;
    input.m0026 = 0;
    input.m0027 = 0;
    this.db01(input);

    /* 元 202-209:積 → ×0x0A 除算(0x1C/0x0A)の dividend へ */
    m0018 = input.m0024;
    m0019 = input.m0025;
    m001A = input.m0026;
    m001B = input.m0027;
    m001C = 0x0A;
    m001D = 0;
    m001E = 0;
    m001F = 0;

    /* 元 211-224:dc09 用の 8×0x18 + 0x24..0x27 */
    input = {};
    input.m0018 = m0018;
    input.m0019 = m0019;
    input.m001A = m001A;
    input.m001B = m001B;
    input.m001C = m001C;
    input.m001D = m001D;
    input.m001E = m001E;
    input.m001F = m001F;
    input.m0024 = 0;
    input.m0025 = 0;
    input.m0026 = 0;
    input.m0027 = 0;
    this.dc09(input);

    /* 元 226-239://8C13(999 より大きかった判定) */
    nes.cmp(input.m0025, 0x03);
    if (!nes.bcc()) {
      if (nes.bne()) {
        input.m0025 = 0x03;
        input.m0024 = 0xE7;
      } else {
        nes.cmp(input.m0024, 0xE7);
        if (!nes.bcc()) {
          input.m0025 = 0x03;
          input.m0024 = 0xE7;
        }
      }
    }

    object.m0018 = input.m0024;
    object.m0019 = input.m0025;
  };

  /* 元 246-352://{$1B$1A$19$18}/{$1F$1E$1D1C}={$27$26$25$24} */
  BarcodeWorld.prototype.dc09 = function (object) {
    var nes = this.nes;
    var m0018 = toInt(object.m0018);
    var m0019 = toInt(object.m0019);
    var m001A = toInt(object.m001A);
    var m001B = toInt(object.m001B);
    var m001C = toInt(object.m001C);
    var m001D = toInt(object.m001D);
    var m001E = toInt(object.m001E);
    var m001F = toInt(object.m001F);
    var m0024 = 0;
    var m0025 = 0;
    var m0026 = 0;
    var m0027 = 0;
    var m002C = 0;
    var m002D = 0;
    var m002E = 0;
    var m002F = 0;
    var RegisterX = 0x20;

    while (true) {
      /* 元 266-267://dc1d */
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
          /* 元 283-308:上位から比較。bc→ dc79(減算スキップ)、bne→ dc53(減算開始) */
          nes.cmp(m002F, m001F);
          if (nes.bcc()) {
            throw new Error('dc79');
          }
          if (nes.bne()) {
            throw new Error('dc53');
          }
          nes.cmp(m002E, m001E);
          if (nes.bcc()) {
            throw new Error('dc79');
          }
          if (nes.bne()) {
            throw new Error('dc53');
          }
          nes.cmp(m002D, m001D);
          if (nes.bcc()) {
            throw new Error('dc79');
          }
          if (nes.bne()) {
            throw new Error('dc53');
          }
          nes.cmp(m002C, m001C);
          if (nes.bcc()) {
            throw new Error('dc79');
          }
        } catch (e) {
          /* 元 310-314:dc53 以外は再 throw(dc79 群は外側 catch へ) */
          if (e.message !== 'dc53') {
            throw e;
          }
        }

        /* 元 316-334://dc53(実際は dc53 の受け位置) */
        m002C = nes.sbc(m002C, m001C);
        m002D = nes.sbc(m002D, m001D);
        m002E = nes.sbc(m002E, m001E);
        m002F = nes.sbc(m002F, m001F);
        m0024 = nes.inc(m0024);
        if (nes.bne()) {
          throw new Error('dc79');
        }
        m0025 = nes.inc(m0025);
        if (nes.bne()) {
          throw new Error('dc79');
        }
        m0026 = nes.inc(m0026);
        if (nes.bne()) {
          throw new Error('dc79');
        }
        m0027 = nes.inc(m0027);
      } catch (e) {
        /* 元 336-337:外側 catch — dc79 の受け先 */
      }

      /* 元 339-344://dc79 */
      RegisterX = RegisterX - 1;
      if (RegisterX <= 0) {
        break;
      }
      /* goto dc1d */
    }

    object.m0024 = m0024;
    object.m0025 = m0025;
    object.m0026 = m0026;
    object.m0027 = m0027;
  };

  window.BB2.BarcodeWorld = BarcodeWorld;
})();
