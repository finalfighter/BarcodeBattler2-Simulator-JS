/* js/fighting_data.js — FightingData.as / CreateFightingData.as の 1:1 移植(作業8 Phase 4・工程2)
 * 元: BarcodeBattler2-Simulator-master/src/FightingData.as(39 行・24 フィールド)・
 *      同 CreateFightingData.as(108 行)。design §4.3(移行側リネーム禁止)によりフィールド名・メソッド名一致。
 * FightingData のフィールド数は design §4.3 の「21 フィールド」ではなく元実測 24 個(int 系 17・Boolean 系 7)。
 * AS3 の型既定値(int=0・Boolean=false)を JS の初期値として同じに置く(down_*_flag 群は元の明示 false・cpu=false)。
 * golden: CreateFightingData の期待値出力は golden ハーネス側に無い — tests/fighting.mjs の手計算ケースは元行番号注記付き */
(function () {
  'use strict';
  if (!window.BB2) { window.BB2 = {}; }

  /* --- FightingData.as(元 6-36 の全 public var) --- */
  function FightingData() {
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

  /* --- CreateFightingData.as --- */
  function CreateFightingData() {}

  /* 元 6: init(barcode_data1:BarcodeData, barcode_data2:BarcodeData=null):FightingData */
  CreateFightingData.prototype.init = function (barcode_data1, barcode_data2) {
    var fighting_data = new FightingData();

    /* 元 11-83://2枚 */
    if (barcode_data2) {
      var hp = barcode_data1.hp + barcode_data2.hp;
      if (hp > 999) {
        hp = 999;
      }
      fighting_data.max_hp = hp;
      fighting_data.hp = hp;

      var st = barcode_data1.st + barcode_data2.st;
      if (st > 199) {
        st = 199;
      }
      if (st < 0) {
        st = 0;
      }
      fighting_data.st = st;
      fighting_data.st1 = barcode_data1.st;
      fighting_data.st2 = barcode_data2.st;

      var df = barcode_data1.df + barcode_data2.df;
      if (df > 199) {
        df = 199;
      }
      if (df < 0) {
        df = 0;
      }
      fighting_data.df = df;
      fighting_data.df1 = barcode_data1.df;
      fighting_data.df2 = barcode_data2.df;

      fighting_data.speed = barcode_data1.speed;

      fighting_data.race1 = barcode_data1.race;
      fighting_data.race2 = barcode_data2.race;

      fighting_data.job = barcode_data1.job;

      /* 元 49-56:pp は race2<=4 なら 1 枚目のみ(合算しない)・99 超で 99 */
      if (barcode_data2.race <= 4) {
        fighting_data.pp = barcode_data1.pp;
      } else {
        fighting_data.pp = barcode_data1.pp + barcode_data2.pp;
      }
      if (fighting_data.pp > 99) {
        fighting_data.pp = 99;
      }

      /* 元 58-75:mp。race2<=4 は union_flag=true 側の分岐(job<=6 で mp=0・mp>=10 条件なしだと mp=0)。
         race2>4 は job<=6 で mp=0、job>=7 で合算・99 超で 99(元 76-78) */
      if (barcode_data2.race <= 4) {
        if (barcode_data1.mp >= 10 || barcode_data2.mp >= 10) {
          if (barcode_data1.job <= 6) {
            fighting_data.mp = 0;
          } else {
            fighting_data.mp = barcode_data1.mp;
          }
        } else {
          fighting_data.mp = 0;
        }
        fighting_data.union_flag = true;
      } else {
        if (barcode_data1.job <= 6) {
          fighting_data.mp = 0;
        } else {
          fighting_data.mp = barcode_data1.mp + barcode_data2.mp; /* 元 73 */
        }
      }
      if (fighting_data.mp > 99) {
        fighting_data.mp = 99;
      }

      fighting_data.pp_ignore_flag = false;
      fighting_data.special1 = barcode_data1.special;
      fighting_data.special2 = barcode_data2.special;

    /* 元 84-101://1枚のみ */
    } else {
      fighting_data.max_hp = barcode_data1.hp;
      fighting_data.hp = barcode_data1.hp;
      fighting_data.st = barcode_data1.st;
      fighting_data.st1 = barcode_data1.st;
      fighting_data.df = barcode_data1.df;
      fighting_data.df1 = barcode_data1.df;
      fighting_data.speed = barcode_data1.speed;
      fighting_data.race1 = barcode_data1.race;
      fighting_data.job = barcode_data1.job;
      fighting_data.union_flag = false;
      fighting_data.pp = barcode_data1.pp;
      fighting_data.mp = barcode_data1.mp;
      fighting_data.pp_ignore_flag = false;
      fighting_data.special1 = barcode_data1.special;
    }

    return fighting_data;
  };

  window.BB2.FightingData = FightingData;
  window.BB2.CreateFightingData = CreateFightingData;
})();
