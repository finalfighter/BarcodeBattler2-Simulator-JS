/* js/nes.js — NES.as の 1:1 移植(作業8 Phase 4・工程1)
 * 元: BarcodeBattler2-Simulator-master/src/NES.as(183 行)。public/protected/private の区別は JS では fields のみ。
 * 方針(roadmap リスク表「意味解釈での再実装禁止」): 元の癖(>255 の wrap が -255 である・rol の CarryFlag 再設定の
 * 位置・文字列 substr による bit 処理のオーバーフロー時の末尾切れ)もそのまま写す。golden: tests/fighting.mjs
 * (期待値は scratch_bb4/phase4_golden.py の AS 仕様リファレンス写し)。int() は decoder.js と同じ toInt で受ける。 */
(function () {
  'use strict';
  if (!window.BB2) { window.BB2 = {}; }

  /* AS int() 相当(decoder.js と同じ扱い) */
  function toInt(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : Math.trunc(n);
  }

  /* --- NES.as(6502 フラグ類・ADC/SBC/INC・LSR/ASL/ROL/ROR・ORA。元行準拠) --- */
  function NES() {
    this.CarryFlag = 0;
    this.ZeroFlag = 0;
  }

  NES.prototype.clc = function () { this.CarryFlag = 0; };

  NES.prototype.sec = function () { this.CarryFlag = 1; };

  NES.prototype.inc = function (num) {
    num = num + 1;
    if (num > 255) {
      num = num - 255;
      this.CarryFlag = 1;
    } else {
      this.CarryFlag = 0;
    }
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  NES.prototype.cmp = function (num, num2) {
    num = num - num2;
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    if (num < 0) { this.CarryFlag = 0; } else { this.CarryFlag = 1; }
  };

  NES.prototype.bcc = function () { if (this.CarryFlag === 0) { return true; } return false; };
  NES.prototype.bcs = function () { if (this.CarryFlag === 1) { return true; } return false; };
  NES.prototype.bne = function () { if (this.ZeroFlag === 0) { return true; } return false; };

  NES.prototype.adc = function (num, num2) {
    num = num + num2 + this.CarryFlag;
    if (num > 255) {
      num = num - 255;
      this.CarryFlag = 1;
    } else {
      this.CarryFlag = 0;
    }
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  NES.prototype.sbc = function (num, num2) {
    var UnCarryFlag = (this.CarryFlag) ? 0 : 1;
    num = num - num2 - UnCarryFlag;
    if (num >= 0) {
      this.CarryFlag = 1;
    } else {
      num = num + 255;
      this.CarryFlag = 0;
    }
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  /* 8 桁の 2 進数算出(元 101〜107)。256 以上の値は 8 桁超の文字列となる(元の挙動のまま) */
  NES.prototype.decbin8 = function (num) {
    var bin8 = num.toString(2);
    while (bin8.length < 8) {
      bin8 = "0" + bin8;
    }
    return bin8;
  };

  NES.prototype.lsr = function (num) {
    var bin8 = this.decbin8(num);
    if (toInt(bin8.charAt(7)) === 1) { this.CarryFlag = 1; } else { this.CarryFlag = 0; }
    bin8 = "0" + bin8.substr(0, 7);
    num = parseInt(bin8, 2);
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  NES.prototype.asl = function (num) {
    var bin8 = this.decbin8(num);
    if (toInt(bin8.charAt(0)) === 1) { this.CarryFlag = 1; } else { this.CarryFlag = 0; }
    bin8 = bin8.substr(1, 7) + "0";
    num = parseInt(bin8, 2);
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  NES.prototype.rol = function (num) {
    var bin8 = this.decbin8(num);
    bin8 = bin8.substr(1, 7) + this.CarryFlag.toString();
    if (toInt(this.decbin8(num).charAt(0)) === 1) { this.CarryFlag = 1; } else { this.CarryFlag = 0; }
    num = parseInt(bin8, 2);
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  NES.prototype.ror = function (num) {
    var bin8 = this.decbin8(num);
    bin8 = this.CarryFlag.toString() + bin8.substr(0, 7);
    if (toInt(this.decbin8(num).substr(7, 1)) === 1) { this.CarryFlag = 1; } else { this.CarryFlag = 0; }
    num = parseInt(bin8, 2);
    if (num === 0) { this.ZeroFlag = 1; } else { this.ZeroFlag = 0; }
    return num;
  };

  NES.prototype.ora = function (num, num2) { return (num | num2) | 0; };

  window.BB2.NES = NES;
})();
