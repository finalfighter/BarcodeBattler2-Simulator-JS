/* js/fighting_calc.js — FightingCalc.as 移植(作業8 Phase 4・工程3-1/3-2/3-3)
 * 対応範囲: クラスフィールド 1-77 ・ decide_star 78-88 ・ decide_first_player 91-101 ・
 *   calc_first_speed 104-156 ・ calc_special_down 158-332 ・ calc_hit 335 ・ basic_damage 413 ・
 *   special_multi 534 ・ critical_hit 684 ・ check_item_broken 697 ・ basic_power 718 ・
 *   select_next_mp_function 793 ・ select_next_pp_state 824 ・ use_pp_power 846 ・ calc_f0 897 ・
 *   calc_f3 913 ・ calc_f4 949 ・ calc_f5 984 ・ calc_f6 1004 ・ calc_f7 1023 ・ calc_f8 1043 ・
 *   calc_action 1064(FightingCalc.as の未移植区間は 718-1108 の全区間で 0 になった・工程3-3 完了)。
 * 依存: js/nes.js(BB2.NES)・js/barcode_world.js(BB2.BarcodeWorld)・js/fighting_data.js(読み取りのみ)。
 * golden 接続: scratch_bb4/phase4_golden.py の FightingCalc 群(calc_first_speed 2・special23〜29 7・pair 2 と
 *   3-2 追加の calc_hit 6・basic_damage 3・special_multi 4・critical_hit 2・check_item_broken 5 と
 *   3-3 追加の basic_power 3・select_next_mp_function 5・select_next_pp_state 5・use_pp_power 4・calc_f0 2・
 *   calc_f3 2・calc_f4 1・calc_f5〜f8 4・calc_action 6 の 63 件を tests/fighting.mjs で突合する。
 *   その際 rand 引数の override を認める(元 80/114/403/418/528/721/724/902/1066/1067 は Math.random 内部生成で
 *   忠実移植は randOverride 省略時と同じ動作・override は golden 決定的化のための試験用引数)。

 * 元行番号コメント付き・AS int 既定値 0 は JS でも同じ位置に置く。 */
(function () {
  'use strict';

  function FightingCalc() {
    // 戦闘データ(元 6: public var fighting_data:Array — 元は barcode2.as 側が外部から配列を設定。接続は戦闘配線側)
    this.fighting_data = null;

    // 種族相性(元 9-15)
    this.race_compatibility = [
      [0x0A, 0x08, 0x0C, 0x0C, 0x08],
      [0x0C, 0x0A, 0x08, 0x0C, 0x08],
      [0x08, 0x0C, 0x0A, 0x0C, 0x08],
      [0x08, 0x08, 0x08, 0x0A, 0x0C],
      [0x0C, 0x0C, 0x0C, 0x08, 0x0A]
    ];

    this.protection_star = 0; // 守護星(元 17・AS int 既定 0)

    // 守護星相性(元 20-26)
    this.star_compatibility = [
      [0x0C, 0x0A, 0x08],
      [0x08, 0x0C, 0x0A],
      [0x0A, 0x08, 0x0C],
      [0x0C, 0x0A, 0x08],
      [0x08, 0x0C, 0x0A]
    ];

    this.barcode_world = new window.BB2.BarcodeWorld(); // 元 27
    this.nes = new window.BB2.NES(); // 元 28(78-332 では未使用・calc_hit 335 ・ basic_damage 413 ・ special_multi 534 ・ critical_hit 684 で nes を使用する)

    this.now_player = 0;     // 先攻(1か2)(元 31・AS int 既定 0)
    this.display_damage = 0; // 表示ダメージ(元 34)

    // パワーのとき使う乱数(元 36-39 power_rand_table)
    this.power_rand_table = [1, 2, 3, 5, 7];

    this.display_power = 0; // 表示パワー(元 42)

    // 使用 MP の配列(元 45-56)
    this.magic_list = [
      0,  // F0トルマ
      2,  // F1ガンツ
      5,  // F2デガンツ
      2,  // F3リーモ
      4,  // F4デリーモ
      3,  // F5ニャーヘ
      5,  // F6カチコム
      4,  // F7ヘヘンダ
      6,  // F8タフニ
      3   // F9マミロージャ
    ];

    // 回復使用の配列(元 59-70)
    this.cure_magic_list = [
      100, // F0トルマ
      100, // F1ガンツ
      100, // F2デガンツ
      2,   // F3リーモ
      4,   // F4デリーモ
      100, // F5ニャーヘ
      100, // F6カチコム
      100, // F7ヘヘンダ
      100, // F8タフニ
      100  // F9マミロージャ
    ];

    this.display_f0_mp = 0; // f0 で奪う MP(元 73)
  }

  // 守護星を決定する(78-88: rand<110→0・110-255→1・それ以外→2)
  FightingCalc.prototype.decideStar = function (randOverride) {
    var rand = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 500); // 元 80
    if (rand < 110) {
      this.protection_star = 0;
    } else if (rand >= 110 && rand < 256) {
      this.protection_star = 1;
    } else {
      this.protection_star = 2;
    }
  };

  // 先攻を決定する(91-101)
  FightingCalc.prototype.decideFirstPlayer = function () {
    var first_speed1 = this.calcFirstSpeed(this.fighting_data[0], this.fighting_data[1]);
    var first_speed2 = this.calcFirstSpeed(this.fighting_data[1], this.fighting_data[0]);
    if (first_speed1 > first_speed2) {
      this.now_player = 1;
    } else if (first_speed1 < first_speed2) {
      this.now_player = 2;
    } else {
      this.now_player = Math.floor(Math.random() * 2) + 1; // 同値時はコイントラ
    }
  };

  // 先攻値を計算する(104-156)
  // randOverride: 元 114 の rand は Math.floor(Math.random()*9) の内部生成。golden 突合時のみ数値をinjectする
  FightingCalc.prototype.calcFirstSpeed = function (fd1, fd2, randOverride) {
    var input = {};
    input.m0018 = fd1.speed;
    input.m0019 = 0x00;
    input.m001C = 0x05;

    // m0024=スピード初期値×5(元 111)
    this.barcode_world.dadf(input);

    // 0-8の乱数(元 114)
    var rand = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 9);

    // スピード×5 + 乱数(元 117-119)
    input.m0018 = input.m0024 + rand;
    input.m0019 = 0x00;
    input.m001C = this.star_compatibility[fd1.race1][this.protection_star];
    this.barcode_world.dadf(input); // ×守護星相性(元 121)

    input.m0018 = input.m0024;
    input.m0019 = input.m0025;
    input.m001C = 0x0A;
    input.m001D = 0x00;
    this.barcode_world.dbcd(input); // /10(元 129)

    input.m0018 = input.m0024;
    input.m0019 = 0x00;
    input.m001C = this.race_compatibility[fd1.race1][fd2.race1] + 1;
    input.m001D = 0x00;
    this.barcode_world.dadf(input); // ×種族相性(元 137)

    input.m0018 = input.m0024;
    input.m0019 = input.m0025;
    input.m001C = 0x0A;
    input.m001D = 0x00;
    this.barcode_world.dbcd(input); // /10(元 145)

    var first_speed = input.m0024;

    // 特殊能力37 2枚目のほうは有効になるのか?(元 149-152)
    if (fd1.special1 === 37) {
      first_speed = 50 + first_speed;
    }

    return first_speed;
  };

  // 特殊能力によるステータスダウン(158-332)→ fd2 を書き換えて返す(元 331 return fd2)
  FightingCalc.prototype.calcSpecialDown = function (fd1, fd2) {
    // 同種の特殊能力だったら強いほうにあわせる(元 160-181 の if/else if 対消滅順・zero 対象スロットも元源码字どおり)
    if (fd1.special1 === 23 && fd1.special2 === 24) {
      fd1.special1 = 0;
    } else if (fd1.special1 === 24 && fd1.special2 === 23) {
      fd1.special2 = 0;
    } else if (fd1.special1 === 25 && fd1.special2 === 26) {
      fd1.special1 = 0;
    } else if (fd1.special1 === 26 && fd1.special2 === 25) {
      fd1.special2 = 0;
    } else if (fd1.special1 === 25 && fd1.special2 === 27) {
      fd1.special1 = 0;
    } else if (fd1.special1 === 27 && fd1.special2 === 25) {
      fd1.special2 = 0;
    } else if (fd1.special1 === 26 && fd1.special2 === 27) {
      fd1.special1 = 0;
    } else if (fd1.special1 === 27 && fd1.special2 === 26) {
      fd1.special2 = 0;
    } else if (fd1.special1 === 28 && fd1.special2 === 29) {
      fd1.special1 = 0;
    } else if (fd1.special1 === 29 && fd1.special2 === 28) {
      fd1.special2 = 0;
    }

    // 特殊能力23 ST30%ダウン(元 183-201)
    if (fd1.special1 === 23 || fd1.special2 === 23) {
      var input = {};
      input.m0018 = 0x07;
      input.m001C = fd2.st1;
      this.barcode_world.dadf(input); // ST×ダウン率(7)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.st1 = input.m0024;
      fd2.down_st_flag = true;
      fd2.st = fd2.st2 + fd2.st1;

    // 特殊能力24 ST50%ダウン(元 202-220)
    } else if (fd1.special1 === 24 || fd1.special2 === 24) {
      input = {};
      input.m0018 = 0x05;
      input.m001C = fd2.st1;
      this.barcode_world.dadf(input); // ST×ダウン率(5)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.st1 = input.m0024;
      fd2.down_st_flag = true;
      fd2.st = fd2.st2 + fd2.st1;

    // 特殊能力25 DF30%ダウン(元 221-239)
    } else if (fd1.special1 === 25 || fd1.special2 === 25) {
      input = {};
      input.m0018 = 0x07;
      input.m001C = fd2.df1;
      this.barcode_world.dadf(input); // DF×ダウン率(7)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.df1 = input.m0024;
      fd2.down_df_flag = true;
      fd2.df = fd2.df2 + fd2.df1;

    // 特殊能力26 DF50%ダウン(元 240-258)
    } else if (fd1.special1 === 26 || fd1.special2 === 26) {
      input = {};
      input.m0018 = 0x05;
      input.m001C = fd2.df1;
      this.barcode_world.dadf(input); // DF×ダウン率(5)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.df1 = input.m0024;
      fd2.down_df_flag = true;
      fd2.df = fd2.df2 + fd2.df1;

    // 特殊能力27 DF80%ダウン(元 259-277)
    } else if (fd1.special1 === 27 || fd1.special2 === 27) {
      input = {};
      input.m0018 = 0x02;
      input.m001C = fd2.df1;
      this.barcode_world.dadf(input); // DF×ダウン率(2)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.df1 = input.m0024;
      fd2.down_df_flag = true;
      fd2.df = fd2.df2 + fd2.df1;

    // 特殊能力28 HP30%ダウン(元 278-303)
    } else if (fd1.special1 === 28 || fd1.special2 === 28) {
      input = {};
      input.m0018 = 0x07;
      input.m0019 = 0x00;
      var hex_hp = fd2.hp.toString(16);
      while (hex_hp.length < 4) {
        hex_hp = '0' + hex_hp;
      }
      input.m001C = parseInt('0x' + hex_hp.substr(2, 2), 16); // HP下位(元 288)
      input.m001D = parseInt('0x' + hex_hp.substr(0, 2), 16); // HP上位(元 289)
      this.barcode_world.db01(input); // HP×ダウン率(7)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.hp = input.m0024 + (input.m0025 * 0x100);
      fd2.max_hp = fd2.hp;
      fd2.down_hp_flag = true;

    // 特殊能力29 HP50%ダウン(元 304-330)
    } else if (fd1.special1 === 29 || fd1.special2 === 29) {
      input = {};
      input.m0018 = 0x05;
      input.m0019 = 0x00;
      hex_hp = fd2.hp.toString(16);
      while (hex_hp.length < 4) {
        hex_hp = '0' + hex_hp;
      }
      input.m001C = parseInt('0x' + hex_hp.substr(2, 2), 16); // HP下位(元 314)
      input.m001D = parseInt('0x' + hex_hp.substr(0, 2), 16); // HP上位(元 315)
      this.barcode_world.db01(input); // HP×ダウン率(5)
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // /10
      fd2.hp = input.m0024 + (input.m0025 * 0x100);
      fd2.max_hp = fd2.hp;
      fd2.down_hp_flag = true;
    }

    return fd2;
  };

  // 攻撃が当たるときの命中判定(335-410)
  // randOverride: 元 403 の rand は Math.floor(Math.random()*256) の内部生成。golden 突合時のみ数値を inject する
  FightingCalc.prototype.calcHit = function (fd1, fd2, magicRate, randOverride) {
    var speed_add = 0;
    var speed_init = 0;
    var input = {};

    // 相手のスピードを上回ったとき(339-355: HP÷0x53(83) を速度から引く)
    if (fd1.speed >= fd2.speed) {
      this.nes.sec(); // 元 342
      var hex_hp = fd1.hp.toString(16);
      while (hex_hp.length < 4) {
        hex_hp = '0' + hex_hp;
      }
      input = {};
      input.m0018 = parseInt('0x' + hex_hp.substr(2, 2), 16); // HP下位(元 348)
      input.m0019 = parseInt('0x' + hex_hp.substr(0, 2), 16); // HP上位(元 349)
      input.m001C = 0x53;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // HP÷0x53(元 352)
      this.nes.sec(); // 元 353
      // 実機BB2仕様: 4bitマイコンのため減算で負になっても8bitアンダーフロー(256補数による必中バグ)せず0にクランプ
      var diff = fd1.speed - input.m0024;
      speed_add = (diff < 0) ? 0 : diff;
    }

    speed_init = 0xCC; // 元 357

    // 自分の命中率アップ・ダウン/相手の命中率アップ・ダウン(359-371)
    if (fd1.special1 === 38 || fd1.special2 === 38) {
      speed_init = 0xE6;
    } else if (fd1.special1 === 39 || fd1.special2 === 39) {
      speed_init = 0x80;
    } else if (fd2.special1 === 40 || fd2.special2 === 40) {
      speed_init = 0xE6;
    } else if (fd2.special1 === 41 || fd2.special2 === 41) {
      speed_init = 0x80;
    }

    if (magicRate > 0) {
      speed_init = speed_init - magicRate; // 元 373-375(魔法使用時の命中率)
    }

    // speed_init に守護星相性を適用(377-392: ×守護星相性÷10・商の下位字节のみ speed_init に代入する元の癖)
    input = {};
    input.m0018 = speed_init;
    input.m0019 = 0x00;
    input.m001C = this.star_compatibility[fd1.race1][this.protection_star];
    this.barcode_world.dadf(input); // ×守護星相性(元 383)

    input.m0018 = input.m0024;
    input.m0019 = input.m0025;
    input.m001C = 0x0A;
    input.m001D = 0x00;
    this.barcode_world.dbcd(input); // ÷10(元 391)
    speed_init = input.m0024;

    this.nes.clc(); // 元 395
    var hit_value = this.nes.adc(speed_init, speed_add); // 命中率+speed_add(元 396)
    // 255 < hit_value のとき命中(397-400: adc 後 Carry 1)
    if (this.nes.bcs()) {
      return true;
    }

    // 0-255 の乱数と比較(402-407: hit_value < rand なら外れ・cmp の borrow で bcc)
    var rand = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 256); // 元 403
    this.nes.cmp(hit_value, rand);
    if (this.nes.bcc()) {
      return false;
    }

    return true; // 元 409
  };

  // 通常攻撃のダメージ算出(413-532)
  // randOverride: 元 418 と 528 の rand は Math.random 内部生成。golden 突合時のみ [rand0-4, タイョン0-1] を inject する
  FightingCalc.prototype.basicDamage = function (fd1, fd2, randOverride) {
    var input = {};
    input.m001C = fd1.st;

    // 0-4 の乱数×2(417-421: ST×0,2,4,6,8)
    var rand_low = (Array.isArray(randOverride)) ? randOverride[0] * 2 : Math.floor(Math.random() * 5) * 2;
    input.m0018 = rand_low;
    this.barcode_world.dadf(input); // ST×(0-8)(元 421)

    input.m0018 = input.m0024;
    input.m0019 = input.m0025;
    input.m001C = 0x0A;
    input.m001D = 0x00;
    this.barcode_world.dbcd(input); // ÷10(元 429)

    var ARegister = this.nes.asl(fd1.st); // ST×2(元 432: bit7 が Carry へ移る)
    if (!this.nes.bcc()) {
      input.m0025 = this.nes.inc(input.m0025); // 元 433-435: ST が bit7 を持つとき上位字节+1
    }
    this.nes.clc(); // 元 436

    // ST×2+(ST×(0-8)/10)(438-440: adc は AS の wrap と Carry 連鎖で 16bit の和を作る)
    input.m0018 = this.nes.adc(input.m0024, ARegister);
    input.m0019 = this.nes.adc(input.m0025, 0x00);
    var basic_damage = -1; // 元 441
    if (input.m0019 <= 0) { // DF 収まり范围(下位字节だけ)
      this.nes.cmp(input.m0018, fd2.df);
      if (!this.nes.bcs()) {
        basic_damage = 0; // DF 以下は 0(→ else 分岐で 1 にする・元 444-446)
      }
    }

    if (basic_damage === -1) {
      // ST 基礎値-DF(451-454: sec 後の sbc は AS の borrow 癖)
      this.nes.sec();
      input.m0018 = this.nes.sbc(input.m0018, fd2.df);
      input.m0019 = this.nes.sbc(input.m0019, 0x00);

      // 1P かつ相手が合体(456-491: 合体相性 50%/75%/100%)
      if (this.now_player === 1 && fd2.union_flag) {
        var race = fd1.union_flag ? fd2.race1 : fd1.race1; // 元 458-464: 自分が非合体なら fd1・合体なら fd2 の race1
        if (race === 0 || race === 1) {
          // ÷4(50%)
          input.m0019 = this.nes.lsr(input.m0019);
          input.m0018 = this.nes.ror(input.m0018);
          input.m0019 = this.nes.lsr(input.m0019);
          input.m0018 = this.nes.ror(input.m0018);
        } else if (race === 2) {
          // ÷3(75%)
          input.m001C = 0x03;
          input.m001D = 0x00;
          this.barcode_world.dbcd(input);
          input.m0018 = input.m0024;
          input.m0019 = input.m0025;
        } else {
          // ÷2(100%)
          input.m0019 = this.nes.lsr(input.m0019);
          input.m0018 = this.nes.ror(input.m0018);
        }

      } else {
        // 2P(486-491: 合体相性 100%)
        input.m0019 = this.nes.lsr(input.m0019);
        input.m0018 = this.nes.ror(input.m0018);
      }

      // ×守護星(8-12)÷10(493-504: db01 の 32bit 積のうち m0024/m0025 の 16bit だけ使う元 28 箇所と同じ癖)
      input.m001C = this.star_compatibility[fd1.race1][this.protection_star];
      input.m001D = 0x00;
      this.barcode_world.db01(input);
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // ÷10
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;

      // ×種族相性差(8-12)÷10(506-515)
      input.m001C = this.race_compatibility[fd1.race1][fd2.race1];
      input.m001D = 0x00;
      this.barcode_world.db01(input);
      input.m0018 = input.m0024;
      input.m0019 = input.m0025;
      input.m001C = 0x0A;
      input.m001D = 0x00;
      this.barcode_world.dbcd(input); // ÷10

      // +1(516-519: 商の下位字节+1・AS int では m0024=255 でも 256 になって ==0 にならないため上位への桁上げ分岐は事実上飛ぶ)
      input.m0024 = input.m0024 + 1;
      if (input.m0024 === 0) {
        input.m0025 = input.m0025 + 1;
      }

      basic_damage = (input.m0025) * 0x100 + input.m0024; // 元 521

    } else {
      basic_damage = basic_damage + 1; // 元 523-525: DF 以下でも 1(最低 1)
    }

    // ×タイミング打法(1-2)(527-529)
    var timing = (Array.isArray(randOverride)) ? randOverride[1] + 1 : Math.floor(Math.random() * 2) + 1;
    basic_damage = basic_damage * timing;

    return basic_damage;
  };

  // 特殊能力倍剣・倍盾と魔法の適用(534-682)
  FightingCalc.prototype.specialMulti = function (fd1, fd2, basicDamage, magicRate) {
    if (magicRate === undefined) { magicRate = 1; } // 元 534 の既定引数
    var input = {};
    var hex_damage = basicDamage.toString(16);
    while (hex_damage.length < 4) {
      hex_damage = '0' + hex_damage;
    }
    input.m0018 = parseInt('0x' + hex_damage.substr(2, 2), 16); // ダメージ下位(元 541)
    input.m0019 = parseInt('0x' + hex_damage.substr(0, 2), 16); // ダメージ上位(元 542)

    // 自分の特殊能力(N 倍剣・特殊能力 1 つ目)(544-586)
    var rate = 0;
    var special;
    if (fd1.special1 >= 1 && fd1.special1 <= 10) {
      // 職業への 3 倍剣
      special = (fd1.special1 === 10) ? 0 : fd1.special1;
      rate = (special === fd2.job) ? 0x1E : 0;
    } else if (fd1.special1 >= 11 && fd1.special1 <= 15) {
      // 種族への 3 倍剣
      special = (fd1.special1 === 15) ? 0 : fd1.special1 - 10;
      rate = (special === fd2.race1) ? 0x1E : 0;
    } else if (fd1.special1 >= 16 && fd1.special1 <= 18) {
      // 固定倍剣
      if (fd1.special1 === 16) {
        // 0.5 倍剣(元 576-577: 16bit ペアの右_SHIFT・切り捨て)
        input.m0019 = this.nes.lsr(input.m0019);
        input.m0018 = this.nes.ror(input.m0018);
        rate = 0;
      } else if (fd1.special1 === 17) {
        rate = 0x0F; // 1.5 倍剣
      } else {
        rate = 0x14; // 2 倍剣
      }
    }

    if (rate !== 0) {
      input.m001C = rate;
      this.barcode_world.f_8bdf(input); // ×rate÷10(元 590)
    }

    // 自分の特殊能力(N 倍剣・特殊能力 2 つ目)(593-640・同上)
    rate = 0;
    if (fd1.special2 >= 1 && fd1.special2 <= 10) {
      special = (fd1.special2 === 10) ? 0 : fd1.special2;
      rate = (special === fd2.job) ? 0x1E : 0;
    } else if (fd1.special2 >= 11 && fd1.special2 <= 15) {
      special = (fd1.special2 === 15) ? 0 : fd1.special2 - 10;
      rate = (special === fd2.race1) ? 0x1E : 0;
    } else if (fd1.special2 >= 16 && fd1.special2 <= 18) {
      if (fd1.special2 === 16) {
        input.m0019 = this.nes.lsr(input.m0019);
        input.m0018 = this.nes.ror(input.m0018);
        rate = 0;
      } else if (fd1.special2 === 17) {
        rate = 0x0F;
      } else {
        rate = 0x14;
      }
    }

    if (rate !== 0) {
      input.m001C = rate;
      this.barcode_world.f_8bdf(input); // 元 639
    }

    // 魔法(642-646: 倍率をそのまま適用)
    if (magicRate > 1) {
      input.m001C = magicRate;
      this.barcode_world.f_8bdf(input);
    }

    // 相手の特殊能力(N 倍盾・特殊能力 1 つ目(648-661)と 2 つ目(663-675))
    rate = 0;
    if (fd2.special1 === 20) {
      rate = 0x09;
    } else if (fd2.special1 === 21) {
      rate = 0x07;
    } else if (fd2.special1 === 22) {
      rate = 0x05;
    }
    if (rate !== 0) {
      input.m001C = rate;
      this.barcode_world.f_8bdf(input); // 元 660
    }

    rate = 0;
    if (fd2.special2 === 20) {
      rate = 0x09;
    } else if (fd2.special2 === 21) {
      rate = 0x07;
    } else if (fd2.special2 === 22) {
      rate = 0x05;
    }
    if (rate !== 0) {
      input.m001C = rate;
      this.barcode_world.f_8bdf(input); // 元 674
    }

    var damage = (input.m0019 * 0x100) + input.m0018; // 元 677
    if (damage > 999) {
      damage = 999; // 元 678-680
    }
    return damage;
  };

  // クリティ判定(684-695: ST+ST÷2 表示ダメージ比較)
  FightingCalc.prototype.criticalHit = function (fd1) {
    var critical_st = this.nes.lsr(fd1.st); // 元 687(ST÷2・切り捨て)
    this.nes.clc(); // 元 688(演算は plain な和で nes の wrap は使わない)
    critical_st = fd1.st + critical_st; // 元 689
    if (this.display_damage > critical_st) {
      return true;
    } else {
      return false;
    }
  };

  // アイテム破壊判定(697-716: race2 5=ST アイテム/7=DF アイテム)
  FightingCalc.prototype.checkItemBroken = function (fd1, fd2) {
    if (this.display_damage <= 0) {
      return false; // 元 698-701: ダダメージが MISS
    }
    if (fd2.hp <= 0) {
      return false; // 元 702-705: 相手の HP が 0
    }
    if (fd1.race2 === 5 && !fd1.st_item_broke_flag) {
      return true; // 元 706-709: ST アイテム
    }
    if (fd2.race2 === 7 && !fd2.df_item_broke_flag) {
      return true; // 元 710-713: DF アイテム(破壊済フライトは元側で barcode2.as が立てる)
    }

    return false;
  };

  // 基本パワー算出(718-789: 乱数 rand(1-7) と timing(10-14) の積で HP/10 を掛け /10)
  FightingCalc.prototype.basicPower = function (fd1, fd2, randIdxOverride, timingOverride) {
    var hp_diff = fd1.max_hp - fd1.hp;
    // 実機BB2仕様: パワーコマンドで一定確率(約10%)または 'full'/5 指定で全回復
    if (randIdxOverride === 'full' || randIdxOverride === 5) {
      return hp_diff;
    }
    if (randIdxOverride === undefined && Math.random() < 0.1) {
      return hp_diff;
    }

    var rand = this.power_rand_table[randIdxOverride === undefined ? Math.floor(Math.random() * 5) : randIdxOverride]; // 元 721・乱数=1,2,3,5,7
    var timing01 = (timingOverride === undefined) ? Math.floor(Math.random() * 2) : timingOverride; // 元 724(Math.floor(Math.random()*2))
    var timing = (timing01 === 1) ? 0x0E : 0x0A; // 元 725/727

    var input = {}; // 元 730-732(AS では m0019/m001D は未設定のままdadf する・dadf は m0018/m001C のみ読む)
    input.m0018 = timing; // 元 731
    input.m001C = rand; // 元 732
    this.barcode_world.dadf(input); // 元 735・rand×timing の積
    var stack = input.m0024; // 元 736・下位字节のみ(上位 m0025 は取り込まない)

    var hex_max_hp = fd1.max_hp.toString(16); // 元 738-741
    while (hex_max_hp.length < 4) {
      hex_max_hp = "0" + hex_max_hp;
    }
    input.m0018 = parseInt('0x' + hex_max_hp.substr(2, 2), 16); // 元 742・HP下位
    input.m0019 = parseInt('0x' + hex_max_hp.substr(0, 2), 16); // 元 743・HP上位
    input.m001C = 0x0A; // 元 744
    input.m001D = 0x00; // 元 745
    this.barcode_world.dbcd(input); // 元 748・HP/10
    input.m0018 = input.m0024; // 元 750
    input.m0019 = input.m0025; // 元 751
    input.m001C = stack; // 元 752
    input.m001D = 0x00; // 元 753
    this.barcode_world.db01(input); // 元 756・HP/10×(rand×timing 積 stack)
    input.m0018 = input.m0024; // 元 758
    input.m0019 = input.m0025; // 元 759・16bit 範囲だけ(上位 m0026/m0027 は捨て・special_down と同じ癖)
    input.m001C = 0x0A; // 元 760
    input.m001D = 0x00; // 元 761
    this.barcode_world.dbcd(input); // 元 764・/10
    // 元 766-767 の `input.m0024; input.m0025;` は参照だけの意味のない文。JS ではコメントのみで素通し(golden と同じ)

    var basic = (input.m0025 * 0x100) + input.m0024; // 元 783
    // 実機BB2準拠: 特殊能力43(相手回復力ダウン×0.5)と特殊能力44(自分回復力アップ×2)を正常適用
    if (fd2.special1 === 43 || fd2.special2 === 43) {
      basic = Math.floor(basic / 2);
    }
    if (fd1.special1 === 44 || fd1.special2 === 44) {
      basic = basic * 2;
    }
    var hp_diff = fd1.max_hp - fd1.hp; // 元 784
    if (basic > hp_diff) {
      basic = hp_diff; // 元 785-787・hp_diff クランプ
    }
    return basic; // 元 788
  };

  // 現在選択中の魔法から MP が足りる次の魔法 index を返す(793-821・battle/cure 両 list は index 10 個)
  FightingCalc.prototype.selectNextMpFunction = function (fd1, selectMpFunction, selectBattleMagic) {
    if (selectBattleMagic === undefined) { selectBattleMagic = true; } // 元 793 の AS 既定(true)
    var next_mp = selectMpFunction + 1; // 元 795
    if (next_mp >= 10) {
      return -1; // 元 796-798
    }
    var list = selectBattleMagic ? this.magic_list : this.cure_magic_list; // 元 802-806
    while (true) {
      if (list[next_mp] <= fd1.mp) {
        break; // 元 810-812
      }
      next_mp = next_mp + 1; // 元 813
      if (next_mp >= 10) {
        return -1; // 元 814-816
      }
    }
    return next_mp; // 元 819
  };

  // 現在選択中の薬草から次の薬草 index を返す(824-843・pp 0/ignore フラグ・next>=4・next>pp(残個数オーバー)は -1)
  FightingCalc.prototype.selectNextPpState = function (fd1, selectPpState) {
    if (fd1.pp === 0 || fd1.pp_ignore_flag) {
      return -1; // 元 826-828
    }
    var next_pp = selectPpState + 1; // 元 829
    if (next_pp >= 4) {
      return -1; // 元 830-832
    }
    if (next_pp === 0) {
      next_pp = 1; // 元 834-836・元コメント「0個はないので」(select>=0 なら next>=1 で到達不能な分岐だが元源码字のまま)
    }
    if (next_pp > fd1.pp) {
      return -1; // 元 838-840・薬草残個数オーバー
    }
    return next_pp; // 元 842
  };

  // 薬草使用時の回復量算出(846-894・rand なし。使用個数×2 → HP×使用値÷10 → hp_diff クランプ)
  FightingCalc.prototype.usePpPower = function (fd1, fd2, selectPpState) {
    var basic_pp = this.nes.asl(selectPpState); // 元 849・薬草使用個数×2(ASL。戻り値は basic_pp に受ける)
    var hex_max_hp = fd1.max_hp.toString(16); // 元 851-854
    while (hex_max_hp.length < 4) {
      hex_max_hp = "0" + hex_max_hp;
    }
    var input = {}; // 元 856-860
    input.m0018 = basic_pp; // 元 857
    input.m0019 = 0x00; // 元 858
    input.m001C = parseInt('0x' + hex_max_hp.substr(2, 2), 16); // 元 859・HP下位
    input.m001D = parseInt('0x' + hex_max_hp.substr(0, 2), 16); // 元 860・HP上位
    this.barcode_world.db01(input); // 元 863・HP×薬草使用個数
    input.m0018 = input.m0024; // 元 865
    input.m0019 = input.m0025; // 元 866
    input.m001C = 0x0A; // 元 867
    input.m001D = 0x00; // 元 868
    this.barcode_world.dbcd(input); // 元 871・/10
    var pp_power = (input.m0025 * 0x100) + input.m0024; // 元 887
    // 実機BB2準拠: 特殊能力43(相手回復力ダウン×0.5)と特殊能力44(自分回復力アップ×2)を正常適用
    if (fd2.special1 === 43 || fd2.special2 === 43) {
      pp_power = Math.floor(pp_power / 2);
    }
    if (fd1.special1 === 44 || fd1.special2 === 44) {
      pp_power = pp_power * 2;
    }
    var hp_diff = fd1.max_hp - fd1.hp; // 元 888
    if (pp_power > hp_diff) {
      pp_power = hp_diff; // 元 889-891
    }
    return pp_power; // 元 892
  };

  // トルマによる奪う MP 量算出(897-911: 1-6 の乱数・相手 MP を超えていた場合は MP へ寄せる)
  FightingCalc.prototype.calcF0 = function (fd2, randOverride) {
    var get_mp = randOverride === undefined ? Math.floor(Math.random() * 6) + 1 : randOverride; // 元 902・1-6 の乱数(golden は rand 注入で決定的化・忠実移植は randOverride 省略時と同じ)
    if (fd2.mp < get_mp) {
      get_mp = fd2.mp; // 元 905-907・相手 MP を超えていた場合は MP に合わせる
    }
    return get_mp; // 元 909
  };

  // 魔法 F3 リーモ相当の回復量(913-946: HP×3÷10・use_pp_power と同構成・基本値 3 固定・special43/44 ブロックなし)
  FightingCalc.prototype.calcF3 = function (fd1) {
    var basic_pp = 3; // 元 915
    var hex_max_hp = fd1.max_hp.toString(16); // 元 917-920
    while (hex_max_hp.length < 4) {
      hex_max_hp = "0" + hex_max_hp;
    }
    var input = {}; // 元 922-926
    input.m0018 = basic_pp; // 元 923
    input.m0019 = 0x00; // 元 924
    input.m001C = parseInt('0x' + hex_max_hp.substr(2, 2), 16); // 元 925・HP下位
    input.m001D = parseInt('0x' + hex_max_hp.substr(0, 2), 16); // 元 926・HP上位
    this.barcode_world.db01(input); // 元 929・HP×薬草使用個数(元コメントのまま 3)
    input.m0018 = input.m0024; // 元 931
    input.m0019 = input.m0025; // 元 932
    input.m001C = 0x0A; // 元 933
    input.m001D = 0x00; // 元 934
    this.barcode_world.dbcd(input); // 元 937・/10
    var f3_power = (input.m0025 * 0x100) + input.m0024; // 元 939
    var hp_diff = fd1.max_hp - fd1.hp; // 元 940
    if (f3_power > hp_diff) {
      f3_power = hp_diff; // 元 941-943・hp_diff クランプ
    }
    return f3_power; // 元 944
  };

  // 魔法 F4 デリーモ相当の回復量(949-982: 基本値 5 固定の他は calc_f3 と同一・元 975-980 の変数名は元源码どおり calc_f4 でも `f3_power` のまま・機能同じ)
  FightingCalc.prototype.calcF4 = function (fd1) {
    var basic_pp = 5; // 元 951
    var hex_max_hp = fd1.max_hp.toString(16); // 元 953-956
    while (hex_max_hp.length < 4) {
      hex_max_hp = "0" + hex_max_hp;
    }
    var input = {}; // 元 958-962
    input.m0018 = basic_pp; // 元 959
    input.m0019 = 0x00; // 元 960
    input.m001C = parseInt('0x' + hex_max_hp.substr(2, 2), 16); // 元 961・HP下位
    input.m001D = parseInt('0x' + hex_max_hp.substr(0, 2), 16); // 元 962・HP上位
    this.barcode_world.db01(input); // 元 965・HP×5
    input.m0018 = input.m0024; // 元 967
    input.m0019 = input.m0025; // 元 968
    input.m001C = 0x0A; // 元 969
    input.m001D = 0x00; // 元 970
    this.barcode_world.dbcd(input); // 元 973・/10
    var f3_power = (input.m0025 * 0x100) + input.m0024; // 元 975(元源码の変数名 f3_power を写す)
    var hp_diff = fd1.max_hp - fd1.hp; // 元 976
    if (f3_power > hp_diff) {
      f3_power = hp_diff; // 元 977-979
    }
    return f3_power; // 元 980
  };

  // 魔法 F5 ニャーヘの DF ダウン量算出(984-1002: 3×相手 DF÷10・return は m0024 下位字节のみで上位 m0025 は捨て)
  FightingCalc.prototype.calcF5 = function (fd2) {
    var input = {}; // 元 986
    input.m0018 = 3; // 元 987
    input.m001C = fd2.df1; // 元 989
    this.barcode_world.dadf(input); // 元 991・3×DF
    input.m0018 = input.m0024; // 元 993(元源码はセミコレスなし・意味同じ)
    input.m0019 = input.m0025; // 元 994
    input.m001C = 0x0A; // 元 995
    input.m001D = 0x00; // 元 996
    this.barcode_world.dbcd(input); // 元 999・/10
    return input.m0024; // 元 1001・下位字节のみ
  };

  // 魔法 F6 カチコムの自分 DF(1004-1021: calc_f5 の fd1 版・3×自分 DF÷10)
  FightingCalc.prototype.calcF6 = function (fd1) {
    var input = {}; // 元 1005-1007
    input.m0018 = 3; // 元 1006
    input.m001C = fd1.df1; // 元 1007
    this.barcode_world.dadf(input); // 元 1010・3×DF
    input.m0018 = input.m0024; // 元 1012(元源码はセミコレスなし)
    input.m0019 = input.m0025; // 元 1013
    input.m001C = 0x0A; // 元 1014
    input.m001D = 0x00; // 元 1015
    this.barcode_world.dbcd(input); // 元 1018・/10
    return input.m0024; // 元 1020・下位字节のみ
  };

  // 魔法 F7 ヘヘンダの相手 ST ダウン量算出(1023-1041: 3×相手 ST÷10・return は下位字节のみ)
  FightingCalc.prototype.calcF7 = function (fd2) {
    var input = {}; // 元 1025-1027
    input.m0018 = 3; // 元 1026
    input.m001C = fd2.st1; // 元 1027
    this.barcode_world.dadf(input); // 元 1030・3×ST
    input.m0018 = input.m0024; // 元 1032(元源码はセミコレスなし)
    input.m0019 = input.m0025; // 元 1033
    input.m001C = 0x0A; // 元 1034
    input.m001D = 0x00; // 元 1035
    this.barcode_world.dbcd(input); // 元 1038・/10
    return input.m0024; // 元 1040・下位字节のみ
  };

  // 魔法 F8 タフニの自分 ST(1043-1060: calc_f7 の fd1 版・3×自分 ST÷10)
  FightingCalc.prototype.calcF8 = function (fd1) {
    var input = {}; // 元 1044-1046
    input.m0018 = 3; // 元 1045
    input.m001C = fd1.st1; // 元 1046
    this.barcode_world.dadf(input); // 元 1049・3×ST
    input.m0018 = input.m0024; // 元 1051(元源码はセミコレスなし)
    input.m0019 = input.m0025; // 元 1052
    input.m001C = 0x0A; // 元 1053
    input.m001D = 0x00; // 元 1054
    this.barcode_world.dbcd(input); // 元 1057・/10
    return input.m0024; // 元 1060・下位字节のみ
  };

  // 敵の行動算出(1064-1103・0〜9: 魔法 10: 攻撃 11: 回復・fighting_data は [0]=玩家 [1]=敵・rand/rand_magic は 1-100 の注入値で決定的化・元 1066/1067 の Math.random 相当・忠実移植は省略時と同じ動作・(hp/max_hp) の / は小数除算(AS2 の int は内部 Number の元仕様・golden=oracle と同じ)
  FightingCalc.prototype.calcAction = function (randOverride, randMagicOverride) {
    var rand = randOverride === undefined ? Math.floor(Math.random() * 100) + 1 : randOverride; // 元 1066・1〜100
    var rand_magic = randMagicOverride === undefined ? Math.floor(Math.random() * 100) + 1 : randMagicOverride; // 元 1067・1〜100

    // 元 1070・敵 MAXHP が 20% を切ったとき
    if ((this.fighting_data[1].hp / this.fighting_data[1].max_hp) < 0.2) {
      /* 実機仕様修正: F9 マミロージャ封印時(pp_ignore_flag)は薬草使用不可(元バグは pp_ignore_flag を見ずに回復していた) */
      if (this.fighting_data[1].pp > 0 && !this.fighting_data[1].pp_ignore_flag) { // 元 1071
        if (rand > 50) {
          return 11; // 元 1073-1074・50% の確率で回復
        }
      }
    }

    // 元 1080・攻撃か魔法か
    if (this.fighting_data[1].mp > 0) {
      if (rand < 70) {
        return 10; // 元 1082-1083・70% は攻撃
      }
      // 魔法(F5(20%)・F7(20%))
      if (rand_magic >= 40 && rand_magic < 60 && this.fighting_data[1].mp >= 3) { // 元 1087・F5 band
        if (this.fighting_data[0].df <= 5) {
          return 5; // 元 1089-1091・F5 DFdown(内側の if が不発なら band を抜けて 10 へ落ちる・元源码字のまま)
        }
      } else if (rand_magic >= 70 && rand_magic < 90 && this.fighting_data[1].mp >= 7) { // 元 1093・F7 band
        if (this.fighting_data[0].st <= 5) {
          return 7; // 元 1095-1097・F7 STdown
        }
      }
    }

    return 10; // 元 1102
  };

  window.BB2.FightingCalc = FightingCalc;
})();
