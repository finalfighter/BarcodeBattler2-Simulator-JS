/* js/fighting_calc.js — 実機バーコードバトラーII準拠 直接数式実装
 * 
 * 経緯:
 * 従来のシミュレーターは、ファミコン用ソフト『バーコードワールド』の 6502 アセンブリ
 * 逆アセンブルを Flash/ActionScript 上でエミュレート(nes.js / barcode_world.js)していましたが、
 * 実機BB2は電卓系 4bit マイコン(10進BCD演算特化)であり、8bit 2進アセンブリとの間に
 * 端数処理順序(合体ダメージ 19,200 vs 19,800)や 8bit 減算アンダーフロー(必中バグ)などの
 * 根本的な乖離が存在していました。
 * 
 * 本ファイルは、NES アセンブリの迂回処理(文字列バイナリ変換や try/catch ループ)を全廃し、
 * 実機BB2の実測データ(powerreal.txt, page15.htm, page16.htm 等)に完全に合致する
 * 直接的な 10進数式パイプラインとして再構築したものです。
 */
(function () {
  'use strict';

  function FightingCalc() {
    this.fighting_data = null;

    // 種族相性 (5x5)
    this.race_compatibility = [
      [0x0A, 0x08, 0x0C, 0x0C, 0x08],
      [0x0C, 0x0A, 0x08, 0x0C, 0x08],
      [0x08, 0x0C, 0x0A, 0x0C, 0x08],
      [0x08, 0x08, 0x08, 0x0A, 0x0C],
      [0x0C, 0x0C, 0x0C, 0x08, 0x0A]
    ];

    this.protection_star = 0; // 守護星 (0: L, 1: C, 2: R)

    // 守護星相性 (5x3)
    this.star_compatibility = [
      [0x0C, 0x0A, 0x08],
      [0x08, 0x0C, 0x0A],
      [0x0A, 0x08, 0x0C],
      [0x0C, 0x0A, 0x08],
      [0x08, 0x0C, 0x0A]
    ];

    // 外部参照・レガシー互換性用プロパティ保持
    if (typeof window !== 'undefined' && window.BB2) {
      if (window.BB2.BarcodeWorld) { this.barcode_world = new window.BB2.BarcodeWorld(); }
      if (window.BB2.NES) { this.nes = new window.BB2.NES(); }
    }

    this.now_player = 0;     // 先攻(1か2)
    this.display_damage = 0; // 表示ダメージ

    // パワーのとき使う乱数テーブル (1, 2, 3, 5, 7)
    this.power_rand_table = [1, 2, 3, 5, 7];
    this.display_power = 0;

    // 使用 MP リスト (F0〜F9)
    this.magic_list = [0, 2, 5, 2, 4, 3, 5, 4, 6, 3];

    // 回復使用 MP リスト
    this.cure_magic_list = [100, 100, 100, 2, 4, 100, 100, 100, 100, 100];

    this.display_f0_mp = 0;
  }

  // 守護星を決定する (0: L, 1: C, 2: R)
  FightingCalc.prototype.decideStar = function (randOverride) {
    var rand = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 500);
    if (rand < 110) {
      this.protection_star = 0;
    } else if (rand < 256) {
      this.protection_star = 1;
    } else {
      this.protection_star = 2;
    }
  };

  // 先攻を決定する
  FightingCalc.prototype.decideFirstPlayer = function () {
    var first_speed1, first_speed2;
    // 実機仕様(speedtracelog.txt 89AD BEQ $8987 準拠):
    // 同値の場合は決着がつくまで乱数を引き直して再計算ループ
    do {
      first_speed1 = this.calcFirstSpeed(this.fighting_data[0], this.fighting_data[1]);
      first_speed2 = this.calcFirstSpeed(this.fighting_data[1], this.fighting_data[0]);
    } while (first_speed1 === first_speed2);

    this.now_player = (first_speed1 > first_speed2) ? 1 : 2;
  };

  // 先攻スピード値を計算する (実機BB2電卓マイコン直接数式)
  FightingCalc.prototype.calcFirstSpeed = function (fd1, fd2, randOverride) {
    var rand = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 9);
    var v = (fd1.speed * 5) + rand;
    v = Math.floor((v * this.star_compatibility[fd1.race1][this.protection_star]) / 10);
    v = Math.floor((v * (this.race_compatibility[fd1.race1][fd2.race1] + 1)) / 10);

    // 特殊能力37: 先制スピード+50 (合体カード fd1.special2 も判定)
    if (fd1.special1 === 37 || fd1.special2 === 37) {
      v = v + 50;
    }
    // 実機ROM仕様: 255クランプ (speedtracelog.txt $8DF8 LDA #$FF 準拠)
    if (v > 255) {
      v = 255;
    }
    return v;
  };

  // 特殊能力によるステータスダウン
  FightingCalc.prototype.calcSpecialDown = function (fd1, fd2) {
    // 同種の特殊能力の対消滅 (強いほうに合わせる)
    if (fd1.special1 === 23 && fd1.special2 === 24) { fd1.special1 = 0; }
    else if (fd1.special1 === 24 && fd1.special2 === 23) { fd1.special2 = 0; }
    else if (fd1.special1 === 25 && fd1.special2 === 26) { fd1.special1 = 0; }
    else if (fd1.special1 === 26 && fd1.special2 === 25) { fd1.special2 = 0; }
    else if (fd1.special1 === 25 && fd1.special2 === 27) { fd1.special1 = 0; }
    else if (fd1.special1 === 27 && fd1.special2 === 25) { fd1.special2 = 0; }
    else if (fd1.special1 === 26 && fd1.special2 === 27) { fd1.special1 = 0; }
    else if (fd1.special1 === 27 && fd1.special2 === 26) { fd1.special2 = 0; }
    else if (fd1.special1 === 28 && fd1.special2 === 29) { fd1.special1 = 0; }
    else if (fd1.special1 === 29 && fd1.special2 === 28) { fd1.special2 = 0; }

    // 特殊能力23: ST 30%ダウン (残70%)
    if (fd1.special1 === 23 || fd1.special2 === 23) {
      fd2.st1 = Math.floor((fd2.st1 * 7) / 10);
      fd2.down_st_flag = true;
      fd2.st = fd2.st2 + fd2.st1;
    // 特殊能力24: ST 50%ダウン (残50%)
    } else if (fd1.special1 === 24 || fd1.special2 === 24) {
      fd2.st1 = Math.floor((fd2.st1 * 5) / 10);
      fd2.down_st_flag = true;
      fd2.st = fd2.st2 + fd2.st1;
    // 特殊能力25: DF 30%ダウン (残70%)
    } else if (fd1.special1 === 25 || fd1.special2 === 25) {
      fd2.df1 = Math.floor((fd2.df1 * 7) / 10);
      fd2.down_df_flag = true;
      fd2.df = fd2.df2 + fd2.df1;
    // 特殊能力26: DF 50%ダウン (残50%)
    } else if (fd1.special1 === 26 || fd1.special2 === 26) {
      fd2.df1 = Math.floor((fd2.df1 * 5) / 10);
      fd2.down_df_flag = true;
      fd2.df = fd2.df2 + fd2.df1;
    // 特殊能力27: DF 80%ダウン (残20%)
    } else if (fd1.special1 === 27 || fd1.special2 === 27) {
      fd2.df1 = Math.floor((fd2.df1 * 2) / 10);
      fd2.down_df_flag = true;
      fd2.df = fd2.df2 + fd2.df1;
    // 特殊能力28: HP 30%ダウン (残70%)
    } else if (fd1.special1 === 28 || fd1.special2 === 28) {
      fd2.hp = Math.floor((fd2.hp * 7) / 10);
      fd2.max_hp = fd2.hp;
      fd2.down_hp_flag = true;
    // 特殊能力29: HP 50%ダウン (残50%)
    } else if (fd1.special1 === 29 || fd1.special2 === 29) {
      fd2.hp = Math.floor((fd2.hp * 5) / 10);
      fd2.max_hp = fd2.hp;
      fd2.down_hp_flag = true;
    }

    return fd2;
  };

  // 攻撃が当たるときの命中判定
  FightingCalc.prototype.calcHit = function (fd1, fd2, magicRate, randOverride) {
    var speed_add = 0;
    // 相手のスピード以上のとき、HPに応じた減算を行い、実機4bit仕様で0にクランプ
    if (fd1.speed >= fd2.speed) {
      var hp_pen = Math.floor(fd1.hp / 0x53);
      var diff = fd1.speed - hp_pen;
      speed_add = (diff < 0) ? 0 : diff;
    }

    var speed_init = 0xCC; // 基本値: 204
    // 実機ROM仕様(hit.txt $8E0E〜$8E35 準拠):
    // 1. 攻撃側(自分)の能力をチェック
    if (fd1.special1 === 38 || fd1.special2 === 38) {
      speed_init = 0xE6; // 38: 自分の命中率アップ (230 ≒ 約90%)
    } else if (fd1.special1 === 40 || fd1.special2 === 40) {
      speed_init = 0x80; // 40: 自分の命中率ダウン (128 ≒ 約50%)
    // 2. 攻撃側が能力を持たない場合のみ、防御側(相手)の能力をチェック
    } else if (fd2.special1 === 39 || fd2.special2 === 39) {
      speed_init = 0xE6; // 39: 相手の命中率アップ (230 ≒ 約90%)
    } else if (fd2.special1 === 41 || fd2.special2 === 41) {
      speed_init = 0x80; // 41: 相手の命中率ダウン (128 ≒ 約50%)
    }

    if (magicRate > 0) {
      speed_init = speed_init - magicRate;
    }

    // 実機・さき氏検証仕様: 命中値 ＝ (命中初期値 ＋ 命中アップ値) × 種族相性 × 守護星相性
    var hit_base = speed_init + speed_add;

    // 種族相性適用 (0.8 〜 1.2)
    hit_base = Math.floor((hit_base * this.race_compatibility[fd1.race1][fd2.race1]) / 10);

    // 守護星相性適用 (0.8 〜 1.2)
    var hit_value = Math.floor((hit_base * this.star_compatibility[fd1.race1][this.protection_star]) / 10);

    if (hit_value > 255) {
      return true; // 必中
    }

    var rand = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 256);
    return hit_value >= rand;
  };

  // 通常攻撃のダメージ算出
  FightingCalc.prototype.basicDamage = function (fd1, fd2, randOverride) {
    // 0-4 の乱数×2 (0, 2, 4, 6, 8 実機偶数乱数)
    var rand_low = (Array.isArray(randOverride)) ? randOverride[0] * 2 : Math.floor(Math.random() * 5) * 2;
    var st_base = (fd1.st * 2) + Math.floor((fd1.st * rand_low) / 10);

    // DF判定: DF以下は最低1
    if (st_base <= fd2.df) {
      var timing = (Array.isArray(randOverride)) ? randOverride[1] + 1 : Math.floor(Math.random() * 2) + 1;
      return 1 * timing;
    }

    var diff = st_base - fd2.df;
    var basic_damage;

    // 1P かつ相手が合体(合体相性 50%/75%/100%)
    if (this.now_player === 1 && fd2.union_flag) {
      var race = fd1.union_flag ? fd2.race1 : fd1.race1;
      var divisor;
      if (race === 0 || race === 1) {
        divisor = 4; // 50%
      } else if (race === 2) {
        divisor = 3; // 75%
      } else {
        divisor = 2; // 100%
      }

      // 実機BB2合体時ダメージ計算パイプライン:
      // 除数 → 種族相性 → +1 → 守護星相性 (page16実機データ 19,200 完全一致)
      var v = Math.floor(diff / divisor);
      v = Math.floor((v * this.race_compatibility[fd1.race1][fd2.race1]) / 10);
      v = v + 1;
      v = Math.floor((v * this.star_compatibility[fd1.race1][this.protection_star]) / 10);
      basic_damage = v;

    } else {
      // 通常(非合体)時
      var v = Math.floor(diff / 2);
      v = Math.floor((v * this.star_compatibility[fd1.race1][this.protection_star]) / 10);
      v = Math.floor((v * this.race_compatibility[fd1.race1][fd2.race1]) / 10);
      v = v + 1;
      basic_damage = v;
    }

    var timing = (Array.isArray(randOverride)) ? randOverride[1] + 1 : Math.floor(Math.random() * 2) + 1;
    return basic_damage * timing;
  };

  // 特殊能力倍剣・倍盾と魔法の適用
  FightingCalc.prototype.specialMulti = function (fd1, fd2, basicDamage, magicRate) {
    if (magicRate === undefined) { magicRate = 1; }
    var damage = basicDamage;

    // 特殊能力1つ目の倍剣適用
    damage = this._applySword(damage, fd1.special1, fd2);
    // 特殊能力2つ目の倍剣適用
    damage = this._applySword(damage, fd1.special2, fd2);

    // 魔法倍率適用
    if (magicRate > 1) {
      damage = Math.floor((damage * magicRate) / 10);
    }

    // 相手の特殊能力(倍盾)適用
    damage = this._applyShield(damage, fd2.special1);
    damage = this._applyShield(damage, fd2.special2);

    if (damage > 999) {
      damage = 999;
    }
    return damage;
  };

  FightingCalc.prototype._applySword = function (damage, special, fd2) {
    if (!special) return damage;
    var rate = 0;
    if (special >= 1 && special <= 10) {
      var jobTarget = (special === 10) ? 0 : special;
      if (jobTarget === fd2.job) { rate = 30; } // 3倍剣
    } else if (special >= 11 && special <= 15) {
      var raceTarget = (special === 15) ? 0 : special - 10;
      if (raceTarget === fd2.race1) { rate = 30; } // 3倍剣
    } else if (special === 16) {
      return Math.floor(damage / 2); // 0.5倍剣
    } else if (special === 17) {
      rate = 15; // 1.5倍剣
    } else if (special === 18) {
      rate = 20; // 2倍剣
    }
    if (rate !== 0) {
      damage = Math.floor((damage * rate) / 10);
    }
    return damage;
  };

  FightingCalc.prototype._applyShield = function (damage, special) {
    if (!special) return damage;
    var rate = 0;
    if (special === 20) {
      rate = 9; // 防御30%UP (×0.9)
    } else if (special === 21) {
      rate = 7; // 防御50%UP (×0.7)
    } else if (special === 22) {
      rate = 5; // 防御80%UP (×0.5)
    }
    if (rate !== 0) {
      damage = Math.floor((damage * rate) / 10);
    }
    return damage;
  };

  // 会心の一撃判定 (ダメージが ST + ST/2 を上回ったか)
  FightingCalc.prototype.criticalHit = function (fd1) {
    var critical_st = fd1.st + Math.floor(fd1.st / 2);
    return this.display_damage > critical_st;
  };

  // アイテム破壊判定
  FightingCalc.prototype.checkItemBroken = function (fd1, fd2) {
    if (this.display_damage <= 0) return false;
    if (fd2.hp <= 0) return false;
    if (fd1.race2 === 5 && !fd1.st_item_broke_flag) return true; // STアイテム
    if (fd2.race2 === 7 && !fd2.df_item_broke_flag) return true; // DFアイテム
    return false;
  };

  // 基本パワー算出 (実機BB2仕様: 全回復ルーチン追加)
  FightingCalc.prototype.basicPower = function (fd1, fd2, randIdxOverride, timingOverride) {
    var hp_diff = fd1.max_hp - fd1.hp;
    // 実機BB2仕様: パワーコマンドで一定確率(約10%)または 'full'/5 指定で全回復
    if (randIdxOverride === 'full' || randIdxOverride === 5) {
      return hp_diff;
    }
    if (randIdxOverride === undefined && Math.random() < 0.1) {
      return hp_diff;
    }

    var rand = this.power_rand_table[randIdxOverride === undefined ? Math.floor(Math.random() * 5) : randIdxOverride];
    var timing01 = (timingOverride === undefined) ? Math.floor(Math.random() * 2) : timingOverride;
    var timing = (timing01 === 1) ? 14 : 10; // 1.4倍 または 1.0倍

    var stack = (rand * timing) & 0xFF;
    var base_hp = Math.floor(fd1.max_hp / 10);
    var basic = Math.floor(Math.floor(base_hp * stack) / 10);

    // 実機BB2準拠: 特殊能力43(相手回復力ダウン×0.5)と特殊能力44(自分回復力アップ×2)
    if (fd2.special1 === 43 || fd2.special2 === 43) {
      basic = Math.floor(basic / 2);
    }
    if (fd1.special1 === 44 || fd1.special2 === 44) {
      basic = basic * 2;
    }

    if (basic > hp_diff) {
      basic = hp_diff;
    }
    return basic;
  };

  // 次の選択可能魔法インデックスを返す
  FightingCalc.prototype.selectNextMpFunction = function (fd1, selectMpFunction, selectBattleMagic) {
    if (selectBattleMagic === undefined) { selectBattleMagic = true; }
    var next_mp = selectMpFunction + 1;
    if (next_mp >= 10) return -1;
    var list = selectBattleMagic ? this.magic_list : this.cure_magic_list;
    while (true) {
      if (list[next_mp] <= fd1.mp) break;
      next_mp++;
      if (next_mp >= 10) return -1;
    }
    return next_mp;
  };

  // 次の選択可能薬草数を返す
  FightingCalc.prototype.selectNextPpState = function (fd1, selectPpState) {
    if (fd1.pp === 0 || fd1.pp_ignore_flag) return -1;
    var next_pp = selectPpState + 1;
    if (next_pp >= 4) return -1;
    if (next_pp === 0) next_pp = 1;
    if (next_pp > fd1.pp) return -1;
    return next_pp;
  };

  // 薬草使用時の回復量算出
  FightingCalc.prototype.usePpPower = function (fd1, fd2, selectPpState) {
    var basic_pp = selectPpState * 2;
    var pp_power = Math.floor((fd1.max_hp * basic_pp) / 10);

    // 実機BB2準拠: 特殊能力43と44
    if (fd2.special1 === 43 || fd2.special2 === 43) {
      pp_power = Math.floor(pp_power / 2);
    }
    if (fd1.special1 === 44 || fd1.special2 === 44) {
      pp_power = pp_power * 2;
    }

    var hp_diff = fd1.max_hp - fd1.hp;
    if (pp_power > hp_diff) {
      pp_power = hp_diff;
    }
    return pp_power;
  };

  // F0 トルマによる奪う MP 量算出
  FightingCalc.prototype.calcF0 = function (fd2, randOverride) {
    var get_mp = randOverride === undefined ? Math.floor(Math.random() * 6) + 1 : randOverride;
    return Math.min(fd2.mp, get_mp);
  };

  // F3 リーモ回復量算出
  FightingCalc.prototype.calcF3 = function (fd1) {
    var f3_power = Math.floor((fd1.max_hp * 3) / 10);
    return Math.min(fd1.max_hp - fd1.hp, f3_power);
  };

  // F4 デリーモ回復量算出
  FightingCalc.prototype.calcF4 = function (fd1) {
    var f4_power = Math.floor((fd1.max_hp * 5) / 10);
    return Math.min(fd1.max_hp - fd1.hp, f4_power);
  };

  // F5 ニャーヘの DF ダウン量算出
  FightingCalc.prototype.calcF5 = function (fd2) {
    return Math.floor((fd2.df1 * 3) / 10) & 0xFF;
  };

  // F6 カチコムの自分 DF アップ量算出
  FightingCalc.prototype.calcF6 = function (fd1) {
    return Math.floor((fd1.df1 * 3) / 10) & 0xFF;
  };

  // F7 ヘヘンダの相手 ST ダウン量算出
  FightingCalc.prototype.calcF7 = function (fd2) {
    return Math.floor((fd2.st1 * 3) / 10) & 0xFF;
  };

  // F8 タフニの自分 ST アップ量算出
  FightingCalc.prototype.calcF8 = function (fd1) {
    return Math.floor((fd1.st1 * 3) / 10) & 0xFF;
  };

  // CPU行動決定ルーチン
  FightingCalc.prototype.calcAction = function (randOverride, randMagicOverride) {
    var rand = randOverride === undefined ? Math.floor(Math.random() * 100) + 1 : randOverride;
    var rand_magic = randMagicOverride === undefined ? Math.floor(Math.random() * 100) + 1 : randMagicOverride;

    if ((this.fighting_data[1].hp / this.fighting_data[1].max_hp) < 0.2) {
      if (this.fighting_data[1].pp > 0 && !this.fighting_data[1].pp_ignore_flag) {
        if (rand > 50) return 11; // 50% 回復
      }
    }

    if (this.fighting_data[1].mp > 0) {
      if (rand < 70) return 10; // 70% 攻撃
      if (rand_magic >= 40 && rand_magic < 60 && this.fighting_data[1].mp >= 3) {
        if (this.fighting_data[0].df <= 5) return 5; // F5
      } else if (rand_magic >= 70 && rand_magic < 90 && this.fighting_data[1].mp >= 7) {
        if (this.fighting_data[0].st <= 5) return 7; // F7
      }
    }

    return 10; // 攻撃
  };

  window.BB2.FightingCalc = FightingCalc;
})();
