/* js/decoder.js — BarcodeRead.as / BarcodeData.as の 1:1 移植(作業5 Phase 1)
 * 元: BarcodeBattler2-Simulator-master/src/BarcodeRead.as(503 行)・BarcodeData.as(38 行)
 *   関数対応: init(12〜125) / calc_c1_reading(127〜132) / check_degit(134〜165) /
 *   check_barcode(167〜173) / prepost_check(175〜203) / pre_reading(205〜307) /
 *   post_reading(309〜501)
 * 方針(roadmap リスク表「意味解釈での再実装禁止」に沿う): 元の挙動・怪しい箇所(250 行の
 * st 参照バグ、`+ 5 % 10` の演算順、int()+文字列連結)もそのまま写す(元行番号付きコメント)。
 * zxing による画像→EAN 文字列変換(barcode_reader.as 108〜131)はカメラ/画像入力が
 * Phase 2 未実施のため、入力は文字列(card_in 欄)を直接受け取る。
 * int 換算: AS int() は Number→切り捨て。charAt 範囲外→''(範囲外 charAt は JS でも同じ)。
 */
(function () {
  'use strict';
  if (!window.BB2) { window.BB2 = {}; }

  /* AS int() 相当: Number 化して切り捨て。undefined/NaN は 0(AS int(undefined)=0 と同じ扱い) */
  function toInt(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : Math.trunc(n);
  }

  /* --- BarcodeData.as(38 行。AS の int 既定値 0・live=true) --- */
  function BarcodeData() {
    this.barcode = '';
    this.hp = 0;
    this.st = 0;
    this.df = 0;
    this.speed = 0;
    this.race = 0;
    this.job = 0;
    this.pp = 0;
    this.mp = 0;
    this.special = 0;
    this.live = true; /* 生死(C2) */
  }

  function BarcodeRead() {
    this.barcode_data = null;
  }

  /* init(barcode:String, count:int=1, barcode1_data:BarcodeData=null, shift:int=0,
   *      hero:Boolean=false, job:String=null, item:Boolean=false, c1_flag:Boolean=false) */
  BarcodeRead.prototype.init = function (barcode, count, barcode1_data, shift, hero, job, item, c1_flag) {
    if (count === undefined) { count = 1; }
    if (barcode1_data === undefined) { barcode1_data = null; }
    if (shift === undefined) { shift = 0; }
    if (hero === undefined) { hero = false; }
    if (job === undefined) { job = null; }
    if (item === undefined) { item = false; }
    if (c1_flag === undefined) { c1_flag = false; }

    if (!this.check_barcode(barcode)) { return false; }
    if (!this.check_degit(barcode)) { return false; }

    this.barcode_data = new BarcodeData();
    this.barcode_data.barcode = barcode;
    var d = this.barcode_data;

    var post_read_flag = false;
    if (this.prepost_check()) {
      this.pre_reading();
    } else {
      post_read_flag = true;
      this.post_reading(shift);
    }

    if (count === 1) {
      /* 1枚目はアイテム不可(35〜37) */
      if (d.race > 4) { return false; }

      /* 主人公フラグ(40〜42) */
      if (hero && d.special !== 18 && d.special !== 50 && !post_read_flag) { return false; }

      /* 主人公で HP6000、ST2000、DF2000 以上ははじく(45〜47) */
      if (d.special === 50 && (d.hp >= 60 || d.st >= 20 || d.df >= 20)) { return false; }

      /* hero(C1/C2 モード)で HP/ST/DF 再計算(50〜52) */
      if (hero && post_read_flag && d.race <= 4) { this.calc_c1_reading(); }

      /* job チェック(55〜65) */
      if (job === 'warrior') {
        if (d.job > 6) { return false; }
      } else if (job === 'magician') {
        if (d.job <= 6) { return false; }
      }
    }

    /* C2 アイテム固定チェック(70〜77) */
    if (barcode1_data && item) {
      if (d.race <= 4) {
        if (d.race !== barcode1_data.race || d.job !== barcode1_data.job) { return false; }
      }
    }

    if (barcode1_data) {
      /* 同じバーコードは合体不可(80〜98) */
      var barcode_check, barcode_check1;
      if (barcode.length >= 13) {
        barcode_check = barcode.charAt(6) + barcode.charAt(7) + barcode.charAt(8) +
          barcode.charAt(9) + barcode.charAt(10) + barcode.charAt(11) + barcode.charAt(12);
      } else {
        barcode_check = barcode.charAt(1) + barcode.charAt(2) + barcode.charAt(3) +
          barcode.charAt(4) + barcode.charAt(5) + barcode.charAt(6) + barcode.charAt(7);
      }
      var barcode1 = barcode1_data.barcode;
      if (barcode1.length >= 13) {
        barcode_check1 = barcode1.charAt(6) + barcode1.charAt(7) + barcode1.charAt(8) +
          barcode1.charAt(9) + barcode1.charAt(10) + barcode1.charAt(11) + barcode1.charAt(12);
      } else {
        barcode_check1 = barcode1.charAt(1) + barcode1.charAt(2) + barcode1.charAt(3) +
          barcode1.charAt(4) + barcode1.charAt(5) + barcode1.charAt(6) + barcode1.charAt(7);
      }
      if (barcode_check === barcode_check1) { return false; }

      if (d.race === 9) {
        /* 情報カードは入力不可(c1_flag のみ)(101〜107) */
        if (d.job === 5 || d.job === 6) {
          if (!c1_flag) { return false; }
        }
        /* 戦士は MP アップ不可(110〜114) */
        if (barcode1_data.job <= 6) {
          if (d.job >= 8) { return false; }
        }
      }
      /* 魔法使いは武器・防具は不可(118〜122) */
      if (d.job >= 7) {
        if (d.race >= 5 && d.race <= 8) { return false; }
      }
    }

    return true;
  };

  /* 元 127〜132: HP,ST,DF を元に再計算 */
  BarcodeRead.prototype.calc_c1_reading = function () {
    this.barcode_data.hp = Math.floor(this.barcode_data.hp / 10);
    this.barcode_data.st = Math.floor(this.barcode_data.st / 10) + 1;
    this.barcode_data.df = Math.floor(this.barcode_data.df / 10) + 3;
  };

  /* 元 134〜165: デジットチェック(8 桁は「00000」前付けで 13 桁として EAN 算定) */
  BarcodeRead.prototype.check_degit = function (barcode) {
    if (barcode.length === 8) { barcode = '00000' + barcode; }
    var odd_digit = 0;
    for (var i = 0; i <= barcode.length - 2; i = i + 2) { odd_digit += toInt(barcode.charAt(i)); }
    var even_digit = 0;
    for (var j = 1; j <= barcode.length - 1; j = j + 2) { even_digit += toInt(barcode.charAt(j)); }
    var calc_check_digit = 10 - ((odd_digit + even_digit * 3) % 10);
    if (calc_check_digit === 10) { calc_check_digit = 0; }
    var check_digit = toInt(barcode.charAt(barcode.length - 1));
    if (calc_check_digit !== check_digit) { return false; }
    return true;
  };

  /* 元 167〜173: 8 桁・13 桁簡易チェック */
  BarcodeRead.prototype.check_barcode = function (barcode) {
    if (barcode.length !== 13 && barcode.length !== 8) { return false; }
    return true;
  };

  /* 元 175〜203: 前読みか後読みか判別 true:前読み false:後読み */
  BarcodeRead.prototype.prepost_check = function () {
    var barcode = this.barcode_data.barcode;
    if (barcode.length === 8) { return false; }
    var head_digit = toInt(barcode.charAt(0));
    if (head_digit === 0 || head_digit === 1) {
      if (toInt(barcode.charAt(7)) >= 0 && toInt(barcode.charAt(7)) <= 4) {
        return true;
      } else {
        /* 前読みとして読んだ場合 HP5000、ST1900、DF1900 以下の場合は 5-9 でも前読み(187〜194) */
        var hp = toInt(barcode.charAt(0) + barcode.charAt(1) + barcode.charAt(2));
        var st = toInt(barcode.charAt(3) + barcode.charAt(4));
        var df = toInt(barcode.charAt(5) + barcode.charAt(6));
        if (hp <= 50 && st <= 19 && df <= 19) { return true; }
        return false;
      }
    } else {
      if (toInt(barcode.charAt(2)) === 9 && toInt(barcode.charAt(9)) === 5) { return true; }
      return false;
    }
  };

  /* 元 205〜307: 前読み(13 桁が前提) */
  BarcodeRead.prototype.pre_reading = function () {
    var barcode = this.barcode_data.barcode;
    var d = this.barcode_data;
    var check_stdf;

    d.race = toInt(barcode.charAt(7));
    d.special = toInt(barcode.charAt(10) + barcode.charAt(11));

    if (d.race >= 0 && d.race <= 4) {
      d.hp = toInt(barcode.charAt(0) + barcode.charAt(1) + barcode.charAt(2));
      d.st = toInt(barcode.charAt(3) + barcode.charAt(4));
      d.df = toInt(barcode.charAt(5) + barcode.charAt(6));

      if (d.race === 0 && d.hp >= 200) {
        check_stdf = toInt(barcode.charAt(3) + barcode.charAt(4));
        if (check_stdf === 13 || check_stdf === 29 || check_stdf === 45 ||
            check_stdf === 61 || check_stdf === 77 || check_stdf === 93) {
          d.st += 100; d.df += 100;
        }
        d.st += 100;
        if (d.st > 256) { d.st -= 255; }
      } else if (d.race === 1 && d.hp >= 200) {
        check_stdf = toInt(barcode.charAt(5) + barcode.charAt(6));
        if (check_stdf === 13 || check_stdf === 29 || check_stdf === 45 ||
            check_stdf === 61 || check_stdf === 77 || check_stdf === 93) {
          d.st += 100; d.df += 100;
        }
        d.df += 100;
        /* 元 250 行は「df の再計算で st を参照している」。そのまま写す */
        if (d.df > 256) { d.df = d.st - 255; }
      } else if (d.race === 2 && d.hp >= 200) {
        d.st += 100; d.df += 100;
      }

      d.speed = toInt(barcode.charAt(11));
      d.job = toInt(barcode.charAt(8));
      d.pp = 5;
      d.mp = (d.job >= 6) ? 10 : 0;
    } else if (d.race >= 5 && d.race <= 6) {
      /* ST アイテム(274〜278) */
      d.st = toInt(barcode.charAt(3) + barcode.charAt(4));
      if (d.special === 31 && Math.floor(Math.random() * 2) === 0) { d.st = 0 - d.st; }
    } else if (d.race >= 7 && d.race <= 8) {
      /* DF アイテム(280〜284) */
      d.df = toInt(barcode.charAt(5) + barcode.charAt(6));
      if (d.special === 32 && Math.floor(Math.random() * 2) === 0) { d.df = 0 - d.df; }
    } else {
      /* HP アイテム/情報カード/薬草アップ/MPアップ(286〜304) */
      d.job = toInt(barcode.charAt(8));
      if (d.job >= 0 && 4 >= d.job) {
        d.hp = toInt(barcode.charAt(0) + barcode.charAt(1) + barcode.charAt(2));
        if (d.special === 30 && Math.floor(Math.random() * 2) === 0) { d.hp = 0 - d.hp; }
      } else if (d.job === 5 || d.job === 6) {
        /* 情報カード(297 行: 値の代入なし) */
      } else if (d.job === 7) {
        d.pp = toInt(barcode.charAt(3) + barcode.charAt(4));
      } else {
        d.mp = toInt(barcode.charAt(5) + barcode.charAt(6));
      }
    }
  };

  /* 元 309〜501: 後読み(shift:13 桁で +2 なら -8、8 桁で +2 なら -3 に折替え) */
  BarcodeRead.prototype.post_reading = function (shift) {
    var barcode = this.barcode_data.barcode;
    var d = this.barcode_data;
    var tmpst, tmpst2, tmpdf, tmpdf2, tmpspecial;

    if (barcode.length === 13) {
      if (shift === +2) { shift = -8; }
      d.race = toInt(barcode.charAt(12));

      if (d.race >= 0 && d.race <= 4) {
        d.hp = toInt(Math.floor(toInt(barcode.charAt(11 + shift)) / 2).toString() +
          barcode.charAt(10 + shift) + barcode.charAt(9 + shift));
        tmpst = toInt(barcode.charAt(10 + shift)) + 7;
        if (tmpst > 11) { tmpst -= 10; }
        tmpst2 = toInt(barcode.charAt(9 + shift)) + 5 % 10; /* 元 335 の演算順のまま */
        if (tmpst2 >= 10) { tmpst2 -= 10; }
        d.st = toInt(tmpst.toString() + tmpst2.toString());
        tmpdf = toInt(barcode.charAt(9 + shift)) + 7;
        if (tmpdf >= 10) { tmpdf -= 10; }
        tmpdf2 = toInt(barcode.charAt(8 + shift)) + 7;
        if (tmpdf2 >= 10) { tmpdf2 -= 10; }
        d.df = toInt(tmpdf.toString() + tmpdf2.toString());

        d.speed = toInt(barcode.charAt(10));
        d.job = toInt(barcode.charAt(5));
        d.pp = 5;
        d.mp = (d.job >= 6) ? 10 : 0;
      } else if (d.race >= 5 && d.race <= 6) {
        if (toInt(barcode.charAt(10)) >= 5 && toInt(barcode.charAt(10)) <= 8) {
          d.st = toInt('1' + ((toInt(barcode.charAt(9)) + 5) % 10).toString());
        } else if (toInt(barcode.charAt(10)) === 3 || toInt(barcode.charAt(10)) === 4) {
          d.st = toInt('3' + ((toInt(barcode.charAt(9)) + 5) % 10).toString());
        } else {
          d.st = toInt('2' + ((toInt(barcode.charAt(9)) + 5) % 10).toString());
        }
      } else if (d.race >= 7 && d.race <= 8) {
        if (toInt(barcode.charAt(9)) >= 3 && toInt(barcode.charAt(9)) <= 6) {
          d.df = (toInt(barcode.charAt(8)) + 7) % 10;
        } else if (toInt(barcode.charAt(9)) === 1 || toInt(barcode.charAt(9)) === 2) {
          d.df = toInt('2' + ((toInt(barcode.charAt(8)) + 7) % 10).toString());
        } else {
          d.df = toInt('1' + ((toInt(barcode.charAt(8)) + 7) % 10).toString());
        }
      } else {
        d.job = 0;
        d.hp = toInt(Math.floor(toInt(barcode.charAt(11)) / 8).toString() +
          barcode.charAt(10) + barcode.charAt(9));
      }

      tmpspecial = toInt(barcode.charAt(8));
      if (tmpspecial >= 0 && tmpspecial <= 3) {
        d.special = toInt(barcode.charAt(10));
      } else if (tmpspecial >= 8 && tmpspecial <= 9) {
        d.special = toInt('2' + barcode.charAt(10));
      } else {
        d.special = toInt('1' + barcode.charAt(10));
      }
    } else {
      /* 8 桁(409〜498) */
      if (shift === +2) { shift = -3; }
      d.race = toInt(barcode.charAt(7));

      if (d.race >= 0 && d.race <= 4) {
        d.hp = toInt(Math.floor(toInt(barcode.charAt(6 + shift)) / 2).toString() +
          barcode.charAt(5 + shift) + barcode.charAt(4 + shift));
        tmpst = toInt(barcode.charAt(5 + shift)) + 7;
        if (tmpst > 11) { tmpst -= 10; }
        tmpst2 = toInt(barcode.charAt(4 + shift)) + 5 % 10; /* 元 431 の演算順のまま */
        if (tmpst2 >= 10) { tmpst2 -= 10; }
        d.st = toInt(tmpst.toString() + tmpst2.toString());
        tmpdf = toInt(barcode.charAt(4 + shift)) + 7;
        if (tmpdf >= 10) { tmpdf -= 10; }
        tmpdf2 = toInt(barcode.charAt(3 + shift)) + 7;
        if (tmpdf2 >= 10) { tmpdf2 -= 10; }
        d.df = toInt(tmpdf.toString() + tmpdf2.toString());

        d.speed = toInt(barcode.charAt(5));
        d.job = 4;
        d.pp = 5;
        d.mp = 0;
      } else if (d.race >= 5 && d.race <= 6) {
        if (toInt(barcode.charAt(5)) >= 5 && toInt(barcode.charAt(5)) <= 8) {
          d.st = toInt('1' + ((toInt(barcode.charAt(4)) + 5) % 10).toString());
        } else if (toInt(barcode.charAt(5)) === 3 || toInt(barcode.charAt(5)) === 4) {
          d.st = toInt('3' + ((toInt(barcode.charAt(4)) + 5) % 10).toString());
        } else {
          d.st = toInt('2' + ((toInt(barcode.charAt(4)) + 5) % 10).toString());
        }
      } else if (d.race >= 7 && d.race <= 8) {
        if (toInt(barcode.charAt(4)) >= 3 && toInt(barcode.charAt(4)) <= 6) {
          d.df = (toInt(barcode.charAt(3)) + 7) % 10;
        } else if (toInt(barcode.charAt(4)) === 1 || toInt(barcode.charAt(4)) === 2) {
          d.df = toInt('2' + ((toInt(barcode.charAt(3)) + 7) % 10).toString());
        } else {
          d.df = toInt('1' + ((toInt(barcode.charAt(3)) + 7) % 10).toString());
        }
      } else {
        /* 元 486 は toString 無しの int()+文字列連結。そのまま写す */
        d.job = 0;
        d.hp = toInt(Math.floor(toInt(barcode.charAt(6)) / 8) +
          barcode.charAt(5) + barcode.charAt(4));
      }

      tmpspecial = toInt(barcode.charAt(3));
      if (tmpspecial >= 0 && tmpspecial <= 3) {
        d.special = toInt(barcode.charAt(5));
      } else if (tmpspecial >= 8 && tmpspecial <= 9) {
        d.special = toInt('2' + barcode.charAt(5));
      } else {
        d.special = toInt('1' + barcode.charAt(5));
      }
    }
  };

  window.BB2.BarcodeData = BarcodeData;
  window.BB2.BarcodeRead = BarcodeRead;
})();
