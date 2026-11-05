/* state.js — bb2_state 状態機械(実仕様に整合 — 2026-11-03 元 barcode2.as 実測)
 *
 * 根拠(元ファイルの実測箇所):
 *  - 状態値の凡例: barcode2.as 20〜29行 (-1 初期値 / 0 電源投入前 … 8 2Pカード入力終了)
 *  - 0→1: power_on(611)。1→2: power_on_timer TIMER_COMPLETE→select_mode(660, 681)
 *  - 2: select_button→inc_mode(708: mode+1、3 で 0 に折返し)/set_button→set_mode(717→3)
 *  - 3→4: decide_star_timer TIMER_COMPLETE→mode_start(790: bb2_state+1)
 *  - 4〜7: card_insert_wait(856) case4/5/6/7 コメント「1枚目〜4枚目」。
 *    カード順は 1P→2P→1P→2P(凡例 25〜29 行)
 *  - カード進行: card_insert(1001)/SET skip card_skip(1394: 状態6/7のみ。
 *    3枚目・4枚目をスキップ)→ card_insert_next(+1)
 *  - card_insert 成功/失敗(case4〜7): 成功→演出後 card_insert_next(1461) で +1・
 *    barcode_data[0..3] 保存。失敗→card_insert_error_back(1772): bb2_state 変更なし・
 *    入力受付再有効・barcode_data[idx]=null(「5→4 復帰」ではない — 1195〜1200 は
 *    value_shift の分岐であり status doc の旧記述は実コードと不一致でした。ログ参照)
 *  - value_shift(1173 裏技): l_battle:-2/l_power:-1/r_battle:+1/r_power:+2。
 *    受付は直近カード挿入の演出中のみ(リスナ付与は成功時・next 完了で外れる)。
 *    対象は barcode_data[0](状態4演出中)/[1](状態5演出中)
 *  - power_off(136): 完全初期化。mode=0 へリセット(567行)、状態は 0 に戻す
 *    (136〜200 に barcode_data/fighting_data のクリアは確認できない。HTML 側は保守的に
 *    cards を初期化 — ログ 2026-11-04 に記録)
 *  - mode 表示は "C-"+mode(hp_2p.text — 692 行)
 *
 * 「完了イベント」関数(powerOnComplete / decideStarComplete)を用意し、view 層が呼ぶ(元では TIMER_COMPLETE で発火)。
 * カード デコード(BarcodeRead → decoder.js)と value_shift(裏技)は 2026-11-04 の
 * 作業5 Phase 1 で移植済み(cardInserted / cardInputFailed / valueShift)。
 * Timer による演出(点灯切替・点滅・挿入/スキップ/エラー/待機)は 2026-11-04 作業6 工程1 で
 * view.js に移植済み(状態進行は演出完了時。saveCard/advanceCardFx に分割)。
 * 守護星の算出(decide_star 78-88)は js/fighting_calc.js 移植済(作業8)・2026-11-04 作業8 工程4(演出一体化)で
 * rollProtectionStar(752 相当・737-739 lazy 生成相当)として State 側接続・view 側は mode_start 800-827
 * 実値点灯。状態 8 の合成(special_down 連鎖)も同工程で接続: advanceCardFx に CreateFightingData 合成
 * (1527・1572 相当・1601 接続)・specialDown(1798-1832 の演出除く本体)・decideFirst(1916 相当)。
 * 演出側(special_down_animation 1836-1886・decide_first_player_animation 1928-1952)の view 配線は工程4 済。
 * battle_waiting(1957-2035)は 2026-11-05 工程5-1 で接続(State.battleWaiting 分岐返し・view 側 gauge 500ms と入力窓注記)。
 * battle(2340)/power(2992)/select(3187)/escape(2038・C1)/auto_battle_cpu(2101)/call_battle_end(2161) 本体は
 * 5-2 以降・5-4・5-5・Phase 5 の过渡 note 運用(05:59 placeholder と同じ運用)。
 * (game-core は view を呼ばない一方向依存 — この層は DOM を一切参照しない)
 */
(function (global) {
  'use strict';

  var BB2 = global.BB2 = global.BB2 || {};

  var STATES = {
    PRE_INIT: -1,     // init 前(bb2_state 初期値。作成直後のみ)
    STANDBY: 0,       // 電源投入前 ←「電源OFF」(power_off 完全初期化後の状態)
    POWER_ON: 1,      // 電源投入(演出中)
    MODE_SELECT: 2,   // モード選択(C-0/C-1/C2。SELECT/SET 受付)
    DECIDE_STAR: 3,   // 守護星決定(モード確定後)
    CARD_1: 4,        // 1枚目待ち(1P)
    CARD_2: 5,        // 2枚目待ち(2P)
    CARD_3: 6,        // 3枚目待ち(1P。SET でスキップ可)
    CARD_4: 7,        // 4枚目待ち(2P。SET でスキップ可)
    CARDS_DONE: 8     // 入力終了(ステータス/バトル表示は Phase 4/5 以降)
  };

  function create() {
    return {
      state: STATES.PRE_INIT, mode: 0,
      cards: [null, null, null, null],  /* barcode_data[0..3] 相当(1P→2P→1P→2P 順 — 凡例 25〜29)。BarcodeData または null */
      shift_card: null,                 /* value_shift 受付中の対象カード番号(0/1)。null で受付なし(cardInserted 参照) */
      fightingData: [null, null],       /* fighting_data[0/1] 相当(元 733)。1P=1枚+3枚・2P=2枚+4枚の合成値(1527-1535・1572-1576)。1528-1530 の lazy 確保は create() 側で写し */
      fightingCalc: null,               /* 元 735 の fighting_calc フィールド相当(737-739 lazy 生成・1601 で fighting_data 接続)。barcodata2 本体が単一インスタンスを持ち回す元の構造を state へ保持 */
      battleWaitingFirst: false,        /* 元 1912 private var battle_waiting_first:Boolean = false(宣言時 false 1:1)。1919 で true 代入は decide_first_player()(1913 本体・decideFirst 接続済)。false 化 2713・2735(battle_complete 2657 本体・5-2)・3159・3171(power_complete 3141 本体・5-3)・3513・3550(set_state 3491 本体・5-4)・3676(use_pp_complete 3651 本体・5-4)・3840(f0_complete 3825 本体・5-5) — 代入元所在は grep 実測・本体未移植。各 false 化行の直後に battle_waiting 直接呼び(再入)実測済(2714・2736・3160・3172・3514・3551・3677・3841・4129・4191・4297・4402・4502・4609・4679・5 以降の弧と魔法演出弧で接続予定・escape_failed_battle_waiting 2082-2100 からの 2097 直接呼びは C1・Phase 5 未接続)。battle_waiting 1967 gate は false のときのみ HP 照合(初回経路は 1919 代入のため HP 照合を経ない)。再入時は 1996 の timer ガードで gauge 継続・2002-2034 の再割当は各弧で view 側 fxBattleWaiting 再接続 */
      /* 工程5-1 接続フィールド(元 member 宣言行へ 1:1・AS 型既定を初期値に。代入元・参照の所在は grep 実測済・
         本体移植は 5 以降の括弧の弧・true/false 代入元の関数本体未移植分はそのまま未接続):
         battle_flag(2338・型既定 false): 1958 battle_waiting で false(State.battleWaiting 接続済)・2342 battle()(2340 本体・5-2)で true・2306-2311 gauge 参照・2345-2350 listener 解除 2345-2350(5-2)
         battle_power_disable_flag(3735・明示 = false 1:1): 2303 gauge 早期 return。true 代入 3738 / false 代入 3826 は 3737 / 3825 側 arc(5-5)で未接続
         power_flag(2990・型既定 false): 2309-2311 gauge 参照・true 代入は power()(2992 本体・5-3)以降未接続
         select_battle_magic(3185・宣言時 true 初期値 1:1・コメント「F3,F4以外を選択できるかどうか」写し): 2013・2024 battle_waiting で true 再代入(State.battleWaiting 接続済)。参照 3453・3477(select_next_mp_function 連鎖・5-4)・3512・3549・3675・4127(5-4/5-5)。4127 gate(4129 onward battle_waiting re-entry・5-5) */
      battleFlag: false,                /* 元 2338 private var battle_flag(Boolean 型既定のみ)。1958 で false 代入(battle_waiting 本体・接続済)。true 代入 2342 battle()(2340 本体・工程5-2a 接続済)・2306 gauge 参照 */
      battleEndCount: 0,                /* 元 2339 private var battle_end_count:int(int 型既定 0)。2420/2423/2427 battle() で 40/60/80 代入・2442 battle_animation 参照(工程5-2a 接続済) */
      battlePowerDisableFlag: false,    /* 元 3735 private var battle_power_disable_flag(Boolean = false 明示初期値 1:1)。2303 gauge 早期 return 窓(battle_power_animation 2301-2333 写しは工程5-1 gauge 接続済)。true 代入 3738 / false 代入 3826 は 3737 use_magic()(3737 本体)・3825 f0_complete()(3825 本体)の arc(5-5)で未接続 */
      powerFlag: false,                 /* 元 2990 private var power_flag(Boolean 型既定のみ)。2309-2311 gauge 参照・代入元は power()(2992 本体・工程5-3 接続済) */
      selectBattleMagic: true,          /* 元 3185 private var select_battle_magic(Boolean=true 宣言時初期値 1:1・F3,F4 以外を選択可か否か)。battle_waiting 2013・2024 で true 再代入(State.battleWaiting 接続済)。参照 select 弧 3453・3477・3512・3549・3675・4127(工程5-4 接続済) */
      selectMpPp: 1,                    /* 元 3181 private var select_mp_pp:int = 1(0=mp, デフォルト=pp=1・工程5-4) */
      selectMpFunction: -2,             /* 元 3182 private var select_mp_function:int = -2(-2=未選択, -1=選択開始, 0〜9=F0〜F9・工程5-4) */
      selectPpState: -2,                /* 元 3183 private var select_pp_state:int = -2(-2=未選択, -1=選択開始, 1〜3=薬草1〜3個・工程5-4) */
      selectMpEnable: false,            /* 元 3184 private var select_mp_enable:Boolean = false(魔法を選択できるか・工程5-4) */
      selectMagicPpUse: false,          /* 元 3186 private var select_magic_pp_use:Boolean = false(1度でも魔法か薬草を使ったか・工程5-4) */
      selectActive: false,              /* 元 3259-3260 select_button→select_state / set_button→set_state リスナー受付状態(工程5-4) */
      restartReady: false,              /* 元 2907 battle_end() の set_button.addEventListener(CLICK, restart_mode) / 2958 removeEventListener 相当(工程5-2b 接続済) */
      /* 工程6-1: C2 モード固有フィールド(4799-5895) */
      barcodeDataC2: [null, null, null, null, null, null, null, null], /* 元 4799 barcode_data_c2:Array(8): [0,2,4]=戦士(初期/バックアップ/現在)・[1,3,5]=魔法使い・[6]=敵・[7]=アイテム */
      passcodeState: 0,                 /* 元 5382 passcode_state:int(0〜4=各桁入力中, 5=確定) */
      passcode: '',                     /* 元 5383 passcode:String("00000") */
      passcodeActive: false,            /* 元 5388-5389 select_button→add_passcode / set_button→set_passcode 受付中フラグ */
      c2WaitEnemySet: false,            /* 元 4960 2枚目完了後の set_button→card_enemy_insert_wait_c2_se 受付中フラグ */
      c2EnemyWaitActive: false,         /* 元 5348/5356 敵カード入力待ち中の card_in_button→card_enemy_insert_c2 / l_power→select_passcode 受付中フラグ */
      friendSelectState: 0,             /* 元 5784 friend_select_state:int(0=未選択, 1=戦士, 2=魔法使い) */
      c2FriendSelectActive: false,      /* 元 5009 / 4706 select_button→add_friend_state 受付中フラグ(工程6-2) */
      c2FriendSetReady: false,          /* 元 5930 set_button→set_friend_state 受付中フラグ(工程6-2) */
      c2ItemWaitActive: false,          /* 元 5889/5894 / 5952/5957 card_in_button→card_item_insert_c2 / set_button→card_insert_next_set_c2 受付中フラグ(工程6-2) */
      c2BattleGetActive: false,         /* 元 6802-6803 / 6471-6475 戦利品演出中 select_button→select_end_state / set_button→get_mp_pp 受付中フラグ(工程6-3) */
      c2PasscodeAvailable: false,       /* 元 6798-6800 敵 special 80〜99 撃破時の l_power→show_passcode 受付中フラグ(工程6-3) */
      c2ShowPasscodeHold: false,        /* 元 6826-6827 show_passcode 表示中の l_power MOUSE_UP/MOUSE_OUT→battle_end_c2 受付中フラグ(工程6-3) */
      c2LoseChoiceActive: false,        /* 元 6807-6808 仲間片方敗北時の select_button→card_enemy_insert_wait_c2 / set_button→card_insert_wait_c2_back 受付中フラグ(工程6-3) */
      /* 工程7-1: C1 ワールドモード固有フィールド(6865-7756) */
      barcodeDataC1: [null, null, null, null, null, null, null], /* 元 6975 barcode_data_c1:Array: [0,2,4]=戦士(初期/バックアップ/現在)・[1,3,5]=魔法使い・[6]=アイテム */
      c1WorldData: null,                /* 元 7139 c1_world_data:C1WorldData */
      barcodeDataEnemy: null,           /* 元 7684 barcode_data_enemy:BarcodeData */
      friendSelectStateC1: 0,           /* 元 7475/7895 friend_select_state_c1:int(0=未選択, 1=戦士, 2=魔法使い) */
      c1CardSkipActive: false,          /* 元 6879 / 7123 set_button→card_insert_skip_c1 受付中フラグ */
      c1WaitStageSelectSet: false,      /* 元 7133 / 7203 2枚目完了後の set_button→c1_stage_select_click 受付中フラグ */
      c1StageSelectFlag: false,         /* 元 7605 c1_stage_select_flag:Boolean */
      c1StageSelectActive: false,       /* 元 7540-7543 ステージ選択中(select/set/l_power/l_battle/r_battle)受付中フラグ */
      c1FriendSelectActive: false,      /* 元 7754-7755 仲間選択待ち(select→add_friend_state_c1 / r_power→escape_from_battle)受付中フラグ */
      /* 工程7-2: C1 逃走・仲間決定・アイテム入力/スキップ・パスコード入力(7761-8515) */
      c1EscapeFromBattleReady: false,   /* 元 7754 r_power→escape_from_battle 受付中フラグ(7762/7898/7930 で解除) */
      c1FriendSetReady: false,          /* 元 7925 set_button→set_friend_state_c1 受付中フラグ */
      c1ItemWaitActive: false,          /* 元 7949/7954 card_in_button→card_item_insert_c1 / set_button→card_insert_next_set_c1 受付中フラグ */
      c1PasscodeState: 0,               /* 元 8161 c1_passcode_state:int(0〜2=各桁入力中, 3=確定) */
      c1Passcode: '000',                /* 元 8162 c1_passcode:String("000") */
      c1PasscodeActive: false,          /* 元 8155-8156 select_button→c1_input_add_passcode / set_button→c1_input_set_passcode 受付中フラグ */
      /* 工程7-3: C1 戦闘終了・ボス撃破・鍵・敵情報・復活・味方交代・戦利品獲得(8512-8850, 9100-9664) */
      hadKeyNumber: 0,                  /* 元 8513 had_key_number:int */
      hasKeyNumber: 0,                  /* 元 8515 has_key_number:int */
      c1BattleGetActive: false,         /* 元 8618-8619 / 9248-9249 / 9315-9316 select_button→select_end_state / set_button→get_mp_pp_c1 受付中フラグ */
      c1LPowerReady: false,             /* 元 8616 l_power→battle_end_l_power 受付中フラグ */
      c1LoseChoiceActive: false,        /* 元 8695-8696 味方片方敗北時の select_button→c1_stage_select_click / set_button→card_insert_wait_c1_back 受付中フラグ */
      c1DefeatBossActive: false,        /* 元 8743-8748 ボス撃破演出中 set_button→defeat_boss_animation_complete / l_power→show_passcode_c1 受付中フラグ */
      c1ShowPasscodeHold: false,        /* 元 8747-8748 show_passcode_c1 表示中の l_power MOUSE_UP/MOUSE_OUT→defeat_boss 受付中フラグ */
      /* Phase 6: セーブ・ロード(8852-9098) */
      callSaveFunction: null,           /* 元 8852 call_save_function:Function('c1_stage_select_click' | 'battle_end_c1') */
      c1SaveReady: false,               /* 元 7537 / 8615 r_battle→save 受付中フラグ */
      c1SaveAnimCompleteReady: false,   /* 元 8922 set_button→save_animation_complete 受付中フラグ */
      c1LoadAnimCompleteReady: false    /* 元 9017 set_button→load_animation_complete 受付中フラグ */
    };
  }

  /* C2PassCode.as(1-193 行) 1:1 移植(工程6-1・2026-11-05) */
  function C2PassCode() {
    this.barcode_data1 = null;
    this.barcode_data2 = null;
    this.unioncheckdigit = 0;
    this.passcode = null;
  }
  C2PassCode.prototype.init = function (bd1, bd2, pc) {
    this.barcode_data1 = bd1;
    this.barcode_data2 = bd2;
    this.passcode = (pc === undefined) ? null : pc;
    this.unioncheckdigit = (parseInt(bd1.barcode.charAt(12), 10) || 0) + (parseInt(bd2.barcode.charAt(12), 10) || 0); /* 25 */
    if (this.unioncheckdigit >= 10) {
      this.unioncheckdigit = this.unioncheckdigit - 10; /* 26-28 */
    }
  };
  C2PassCode.prototype.generate_passcode_from_passcode_number = function (passcode_number) {
    var numten = Math.trunc(passcode_number / 10);      /* 34 */
    var numone = passcode_number - numten * 10;         /* 36 */
    var passcode_checkdigit = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]; /* 40 */
    var checkdigit_key = numten + numone;               /* 41 */
    if (checkdigit_key >= 10) checkdigit_key -= 10;     /* 42-44 */
    var checkdigit = this.unioncheckdigit + passcode_checkdigit[checkdigit_key]; /* 45 */
    if (checkdigit >= 10) checkdigit -= 10;             /* 46-48 */
    return String(numten) + String(numten) + String(numone) + String(numone) + String(checkdigit); /* 50 */
  };
  C2PassCode.prototype.generate_passcode = function (special) {
    var array = [5, 10, 15, 20, 25, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49]; /* 56 */
    var passcode_number = array[special - 80];          /* 57 */
    return this.generate_passcode_from_passcode_number(passcode_number); /* 59 */
  };
  C2PassCode.prototype.generate_passcode_number = function () {
    if (!this.passcode || this.passcode.length < 5) return -1;
    if (this.passcode.charAt(0) !== this.passcode.charAt(1)) return -1; /* 65-67 */
    if (this.passcode.charAt(2) !== this.passcode.charAt(3)) return -1; /* 68-70 */
    var d0 = parseInt(this.passcode.charAt(0), 10) || 0;
    var d2 = parseInt(this.passcode.charAt(2), 10) || 0;
    var d4 = parseInt(this.passcode.charAt(4), 10) || 0;
    var passcode_number = d0 * 10 + d2;                 /* 72 */
    var passcode_checkdigit = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]; /* 75 */
    var checkdigit_key = d0 + d2;                       /* 76 */
    if (checkdigit_key >= 10) checkdigit_key -= 10;     /* 77-79 */
    var checkdigit = this.unioncheckdigit + passcode_checkdigit[checkdigit_key]; /* 81 */
    if (checkdigit >= 10) checkdigit -= 10;             /* 82-84 */
    if (d4 !== checkdigit) return -1;                   /* 86-88 */
    return passcode_number;                             /* 90 */
  };
  C2PassCode.prototype.generate_passcode_barcode_data = function (bd, passcode_number) {
    bd.hp = this.calchp(bd.hp, passcode_number - 1);    /* 94 */
    bd.st = this.calcst(bd.st, passcode_number - 1);    /* 95 */
    bd.df = this.calcdf(bd.df, passcode_number - 1);    /* 96 */
    return bd;                                          /* 97 */
  };
  C2PassCode.prototype.calchp = function (hp, passcode_number) {
    if (passcode_number === -1) return hp;              /* 101-103 */
    var floorhp = Math.floor(hp * passcode_number / 10); /* 105 */
    var count = 0;                                      /* 106 */
    while (floorhp > 655) {                             /* 107-110 */
      count = 1;
      floorhp = floorhp - 655;
    }
    var floorceilhp = Math.floor(passcode_number / 2) * Math.ceil(passcode_number / 2); /* 112 */
    while (floorceilhp > 655) {                         /* 113-116 */
      count = 1;
      floorceilhp = floorceilhp - 655;
    }
    var calchp = hp + floorhp + floorceilhp;            /* 118 */
    if (calchp > 999) {                                 /* 119-123 */
      calchp = 999;
    } else {
      calchp = calchp - count;
    }
    if (passcode_number >= 90 && passcode_number % 2 === 0) { /* 125-127 */
      calchp = calchp - 1;
    }
    return calchp;                                      /* 129 */
  };
  C2PassCode.prototype.calcst = function (st, passcode_number) {
    if (passcode_number === -1) return st;              /* 135-137 */
    var array = [
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
    if (array[passcode_number] === null) return 199;    /* 150-152 */
    var calcst = (Math.trunc(st) + Math.floor(st * passcode_number / 9) + array[passcode_number]) | 0; /* 154(AS int 変換) */
    if (calcst > 199) return 199;                       /* 155-157 */
    return calcst;                                      /* 159 */
  };
  C2PassCode.prototype.calcdf = function (df, passcode_number) {
    if (passcode_number === -1) return df;              /* 164-166 */
    var array = [
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
    if (!array[passcode_number] === null) return 199;   /* 179-181 */
    var calcdf = (Math.trunc(df) + Math.floor(df * passcode_number / 12) + array[passcode_number]) | 0; /* 183(AS int 変換) */
    if (calcdf > 199) return 199;                       /* 184-186 */
    return calcdf;                                      /* 188 */
  };
  BB2.C2PassCode = C2PassCode;

  /* C1WorldData.as(1-798 行) 1:1 移植(工程7-1・2026-11-05) */
  function C1WorldData() {
    this.unioncheckdigit = 0;                                   /* 13 */
    this.default_stage = ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6']; /* 16 */
    this.stage = ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6'];    /* 17 */
    this.select_stage = 0;                                      /* 18 */
    this.default_world = ['L-1', 'L-2', 'L-3', 'L-4', 'L-5'];   /* 21 */
    this.world = ['L-1', 'L-2', 'L-3', 'L-4', 'L-5'];           /* 22 */
    this.select_world = 0;                                      /* 23 */
    this.default_passcode_number = [10, 16, 24, 31, 38, 45];    /* 25-27 */
    this.default_enemy = [                                      /* 30-43 */
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH']
    ];
    this.enemy = [                                              /* 45-58 */
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH'],
      ['01', '02', '03', '04', 'HH']
    ];
    this.select_enemy = 0;                                      /* 60 */
    this.default_key = [                                        /* 62-68 */
      ['L1-1', 'L3-2', 'L5-3'],
      ['L2-2', 'L4-3', 'L5-1'],
      ['L1-1', 'L3-2', 'L5-3'],
      ['L2-1', 'L3-3', 'L5-4'],
      ['L1-4', 'L2-2', 'L4-3']
    ];
    this.key = ['L1-1', 'L3-2', 'L5-3'];                        /* 70 */
    this.default_race_list = [0, 1, 2, 3, 4, 4];                /* 72 */
    this.default_job_list = [7, 2, 8, 4, 5];                    /* 73 */
    this.default_enemy_paramater = [                            /* 75-244 */
      /* E1 */
      [
        [21, 27, 33, 40, 48, 56, 64, 72, 81, 91],
        [7, 8, 9, 11, 12, 15, 16, 18, 21, 23],
        [9, 10, 12, 14, 15, 18, 20, 21, 24, 27],
        [1, 1, 1, 1, 1, 2],
        [0, 0, 4, 4, 3, 3, 2, 2, 1, 1],
        [15, 18, 21, 24, 27]
      ],
      /* E2 */
      [
        [72, 81, 91, 101, 111, 121, 132, 144, 156, 168],
        [18, 21, 23, 26, 28, 30, 33, 35, 39, 41],
        [21, 24, 27, 30, 31, 34, 37, 39, 43, 46],
        [2, 2, 2, 2, 2, 2],
        [4, 4, 3, 3, 2, 2, 1, 1, 0, 0],
        [36, 39, 42, 45, 48]
      ],
      /* E3 */
      [
        [144, 156, 168, 180, 193, 207, 221, 235, 249, 264],
        [35, 39, 41, 44, 48, 51, 55, 58, 61, 65],
        [39, 43, 46, 48, 51, 55, 59, 61, 65, 69],
        [3, 2, 3, 3, 3, 2],
        [4, 4, 3, 3, 2, 2, 1, 1, 0, 0],
        [57, 60, 63, 66, 69]
      ],
      /* E4 */
      [
        [235, 249, 264, 280, 296, 312, 328, 345, 363, 381],
        [58, 61, 65, 68, 73, 76, 80, 85, 89, 94],
        [61, 65, 69, 72, 76, 80, 83, 87, 91, 96],
        [3, 4, 3, 3, 3, 4],
        [3, 3, 4, 4, 0, 0, 1, 1, 2, 2],
        [78, 81, 84, 87, 90]
      ],
      /* E5 */
      [
        [345, 363, 381, 399, 417, 436, 456, 476, 496, 516],
        [85, 89, 94, 98, 102, 107, 111, 117, 121, 126],
        [87, 91, 96, 99, 103, 108, 112, 117, 121, 125],
        [4, 4, 4, 4, 4, 4],
        [3, 3, 4, 4, 0, 0, 1, 1, 2, 2],
        [99, 102, 105, 108, 110]
      ],
      /* E6 */
      [
        [476, 496, 516, 537, 559, 581, 603, 625, 648, 672],
        [117, 121, 126, 132, 137, 143, 148, 153, 159, 164],
        [117, 121, 125, 130, 135, 141, 145, 150, 155, 160],
        [4, 4, 4, 4, 4, 4],
        [2, 2, 3, 3, 4, 4, 0, 0, 1, 1],
        [120, 123, 126, 129, 132]
      ]
    ];
    this.infomation_flag_a = false;                             /* 246 */
    this.infomation_flag_b = false;                             /* 247 */
  }
  C1WorldData.prototype.init = function (checkdigit1, checkdigit2) { /* 250-255 */
    this.unioncheckdigit = (parseInt(checkdigit1, 10) || 0) + (parseInt(checkdigit2, 10) || 0);
    if (this.unioncheckdigit >= 10) this.unioncheckdigit -= 10;
  };
  C1WorldData.prototype.get_passcode_number = function (stage_number) { /* 258-264 */
    if (stage_number === null || stage_number === undefined) {
      return this.default_passcode_number[this.select_stage];
    }
    return this.default_passcode_number[stage_number];
  };
  C1WorldData.prototype.reset_world = function () {             /* 268-273 */
    this.world = this.default_world.slice();
    this.enemy = this.default_enemy.map(function (a) { return a.slice(); });
    this.select_enemy = 0;
    this.reset_key();
  };
  C1WorldData.prototype.reset_key = function () {               /* 276-406 */
    var v = parseInt(String(this.world[this.select_world]).slice(-1), 10) || 0; /* 277 忠実保持 */
    var u = this.unioncheckdigit;
    var idx = 0;
    if (v === 0) {                                              /* 279-306 */
      if (u === 0 || u === 1) idx = 0;
      else if (u === 8 || u === 9) idx = 1;
      else if (u === 6 || u === 7) idx = 2;
      else if (u === 4 || u === 5) idx = 3;
      else idx = 4;
    } else if (v === 1 || v === 2) {                            /* 309-338 */
      if (u === 0 || u === 1) idx = 4;
      else if (u === 8 || u === 9) idx = 0;
      else if (u === 6 || u === 7) idx = 1;
      else if (u === 4 || u === 5) idx = 2;
      else idx = 3;
    } else if (v === 3 || v === 4) {                            /* 344-373 */
      if (u === 0 || u === 1) idx = 3;
      else if (u === 8 || u === 9) idx = 4;
      else if (u === 6 || u === 7) idx = 0;
      else if (u === 4 || u === 5) idx = 1;
      else idx = 2;
    } else if (v === 5) {                                       /* 377-404 */
      if (u === 0 || u === 1) idx = 2;
      else if (u === 8 || u === 9) idx = 3;
      else if (u === 6 || u === 7) idx = 4;
      else if (u === 4 || u === 5) idx = 0;
      else idx = 1;
    } else {
      return;
    }
    this.key = this.default_key[idx].slice();
  };
  C1WorldData.prototype.key_number = function () {              /* 410-412 */
    return 3 - this.key.length;
  };
  C1WorldData.prototype.add_key = function () {                 /* 416-437 */
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var es = this.enemy[wi][this.select_enemy];
    var we = (es === 'HH') ? ('L' + ws + '-H') : ('L' + ws + '-' + String((parseInt(es, 10) - 1) + 1));
    this.key.unshift(we);
  };
  C1WorldData.prototype.infomation_key = function () {          /* 439-442 */
    return String(this.key[0]);
  };
  C1WorldData.prototype.is_key = function () {                  /* 445-471 */
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var es = this.enemy[wi][this.select_enemy];
    var we = (es === 'HH') ? ('L' + ws) : ('L' + ws + '-' + String((parseInt(es, 10) - 1) + 1));
    for (var i = 0; i < this.key.length; i++) {
      if (this.key[i].indexOf(we) >= 0) return true;
    }
    return false;
  };
  C1WorldData.prototype.delete_key = function () {              /* 474-501 */
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var es = this.enemy[wi][this.select_enemy];
    var we = (es === 'HH') ? ('L' + ws) : ('L' + ws + '-' + String((parseInt(es, 10) - 1) + 1));
    var i = 0;
    var snapshot = this.key.slice();
    for (var k = 0; k < snapshot.length; k++) {
      if (snapshot[k].indexOf(we) >= 0) {
        this.key.splice(i, 1);
      }
      i = i + 1;
    }
  };
  C1WorldData.prototype.delete_enemy = function () {            /* 504-520 */
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var es = this.enemy[wi][this.select_enemy];
    if (es === 'HH') {
      this.enemy[wi].splice(0, 5);
    } else {
      this.enemy[wi].splice(this.select_enemy, 1);
    }
  };
  C1WorldData.prototype.set_start_world = function () {         /* 523-531 */
    for (var i = 0; i <= 5; i++) {
      if (this.enemy[i].length > 0) {
        this.select_world = i;
        break;
      }
    }
  };
  C1WorldData.prototype.is_world = function () {                /* 534-541 */
    return this.enemy[this.get_world_number()].length !== 0;
  };
  C1WorldData.prototype.get_world_number = function () {        /* 545-553 */
    var ws = String(this.world[this.select_world]).slice(-1);
    return (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
  };
  C1WorldData.prototype.get_enemy_number = function () {        /* 555-564 */
    var wi = this.get_world_number();
    var es = this.enemy[wi][this.select_enemy];
    return (es === 'HH') ? 4 : (parseInt(es, 10) - 1);
  };
  C1WorldData.prototype.select_enemy_number = function (randOverride) { /* 567-576 */
    var len = this.enemy[this.get_world_number()].length;
    if (len === 0) return -1;
    var r = (typeof randOverride === 'number') ? randOverride : Math.random();
    return Math.floor(r * len);
  };
  C1WorldData.prototype.generate_enemy_paramater = function () { /* 578-633 */
    var bd = (BB2.BarcodeData) ? new BB2.BarcodeData() : {};
    var stage_int = parseInt(String(this.stage[this.select_stage]).slice(-1), 10) - 1;
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var es = this.enemy[wi][this.select_enemy];
    var ei = (es === 'HH') ? 4 : (parseInt(es, 10) - 1);
    var pointer = this.default_enemy_paramater[stage_int][4][this.unioncheckdigit] + wi;
    while (pointer >= 5) pointer -= 5;
    var hp_array, st_array, df_array;
    if (ws === 'H') {
      pointer = ei;
      hp_array = this.default_enemy_paramater[stage_int][0].slice(5, 10);
      st_array = this.default_enemy_paramater[stage_int][1].slice(5, 10);
      df_array = this.default_enemy_paramater[stage_int][2].slice(5, 10);
    } else {
      hp_array = this.default_enemy_paramater[stage_int][0].slice(ei, ei + 5);
      st_array = this.default_enemy_paramater[stage_int][1].slice(ei, ei + 5);
      df_array = this.default_enemy_paramater[stage_int][2].slice(ei, ei + 5);
    }
    bd.barcode = '0000000000000';
    bd.hp = hp_array[pointer];
    bd.st = st_array[pointer];
    bd.df = df_array[pointer];
    bd.speed = (es === 'HH') ? 6 : 5;
    bd.race = this.default_race_list[wi];
    bd.job = this.default_job_list[ei];
    bd.pp = 5;
    bd.mp = (bd.job > 6) ? 10 : 0;
    bd.special = 0;
    bd.live = true;
    return bd;
  };
  C1WorldData.prototype.generate_st_df = function () {          /* 636-657 */
    var stage_int = parseInt(String(this.stage[this.select_stage]).slice(-1), 10) - 1;
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var pointer = this.default_enemy_paramater[stage_int][4][this.unioncheckdigit] + wi;
    while (pointer >= 5) pointer -= 5;
    if (wi === 5) pointer = 5;
    return this.default_enemy_paramater[stage_int][3][pointer];
  };
  C1WorldData.prototype.generate_boss_energy = function () {    /* 660-680 */
    var stage_int = parseInt(String(this.stage[this.select_stage]).slice(-1), 10) - 1;
    var ws = String(this.world[this.select_world]).slice(-1);
    var wi = (ws === 'H') ? 5 : (parseInt(ws, 10) - 1);
    var es = this.enemy[wi][this.select_enemy];
    if (es !== 'HH') return -1;
    var pointer = this.default_enemy_paramater[stage_int][4][this.unioncheckdigit] + wi;
    while (pointer >= 5) pointer -= 5;
    return this.default_enemy_paramater[stage_int][5][pointer];
  };
  C1WorldData.prototype.c1_powerup_passcode = function (passcode) { /* 686-699 */
    return passcode === '815' || passcode === '031' || passcode === '009' ||
           passcode === '099' || passcode === '077';
  };
  C1WorldData.prototype.generate_passcode_barcode_data = function (barcode_data, passcode) { /* 701-735 */
    switch (passcode) {
      case '815':
        barcode_data.hp = Math.floor(barcode_data.hp * 1.4) + 4;
        barcode_data.st = Math.floor(barcode_data.st * 13 / 9);
        barcode_data.df = Math.floor(barcode_data.df * 16 / 12);
        break;
      case '031':
        barcode_data.hp = Math.floor(barcode_data.hp * 1.6) + 9;
        barcode_data.st = Math.floor(barcode_data.st * 15 / 9) + 1;
        barcode_data.df = Math.floor(barcode_data.df * 18 / 12) + 1;
        break;
      case '009':
        barcode_data.hp = Math.floor(barcode_data.hp * 1.7) + 12;
        barcode_data.st = Math.floor(barcode_data.st * 16 / 9) + 1;
        barcode_data.df = Math.floor(barcode_data.df * 19 / 12) + 2;
        break;
      case '099':
        barcode_data.hp = Math.floor(barcode_data.hp * 1.8) + 16;
        barcode_data.st = Math.floor(barcode_data.st * 17 / 9) + 2;
        barcode_data.df = Math.floor(barcode_data.df * 20 / 12) + 3;
        break;
      case '077':
        barcode_data.hp = Math.floor(barcode_data.hp * 1.9) + 20;
        barcode_data.st = Math.floor(barcode_data.st * 18 / 9) + 3;
        barcode_data.df = Math.floor(barcode_data.df * 21 / 12) + 4;
        break;
    }
    return barcode_data;
  };
  C1WorldData.prototype.jump_stage_passcode = function (passcode) { /* 739-758 */
    var pfx = passcode.charAt(0) + passcode.charAt(1);
    var cd;
    if (pfx === '31') cd = 1 + this.unioncheckdigit;
    else if (pfx === '38') cd = 0 + this.unioncheckdigit;
    else return false;
    if (cd > 9) cd -= 10;
    return passcode.charAt(2) === String(cd);
  };
  BB2.C1WorldData = C1WorldData;

  var State = {
    STATES: STATES,
    create: create,

    /* init_bb2 相当: 起動時に power_off を呼んで standby(0) にする */
    standby: function (s) {
      s.state = STATES.STANDBY; s.mode = 0;
      return s;
    },

    /* power_on(611 相当): standby(0) でのみ有効 */
    powerOn: function (s) {
      if (s.state === STATES.STANDBY) s.state = STATES.POWER_ON;
      return s;
    },

    /* select_mode(660 相当: 元は power_on_timer TIMER_COMPLETE)。演出未移植のため即遷移 */
    powerOnComplete: function (s) {
      if (s.state === STATES.POWER_ON) s.state = STATES.MODE_SELECT;
      return s;
    },

    /* inc_mode(708 相当): モード選択中のみ。0→1→2→0 と折返す */
    incMode: function (s) {
      if (s.state === STATES.MODE_SELECT) {
        s.mode = s.mode + 1;
        if (s.mode === 3) s.mode = 0;
      }
      return s;
    },

    /* set_mode(717 相当): モード選択中のみ確定→守護星決定へ */
    setMode: function (s) {
      if (s.state === STATES.MODE_SELECT) s.state = STATES.DECIDE_STAR;
      return s;
    },

    /* mode_start(790 相当 bb2_state+1)。守護星の算出は演出開始時 rollProtectionStar(752 相当)で実施済・
       実値点灯(mode_start 800-827 相当)は view 側で行う(工程4) */
    decideStarComplete: function (s) {
      if (s.state === STATES.DECIDE_STAR) s.state = STATES.CARD_1;
      return s;
    },

    /* card_insert(1001)→card_insert_next(1461) 相当。
     * 2026-11-04 作業6 工程1(演出移植・view.js)で忠実に分割した:
     *  - saveCard(s, data) は演出開始時(card_insert 成功 1026・1067・1114 相当):
     *    cards[slot]=data 保存 + 裏技(value_shift)受付窓を開く(元 1038-1041 リスナー付与。
     *    対象は 1枚目[0]・2枚目[1]のみ。3・4枚目は元から窓なし 1116-1121・1147)。
     *  - advanceCardFx(s) は演出完了時(card_insert_next 冒頭 1463-1466 リスナー解除相当で
     *    窓を閉じ・bb2_state++)。
     *  - cardInserted は旧スモークテスト互換のラッパ(saveCard+advanceCardFx の即実行)。
     *    データ省略可(スロットは null のまま — 進行のみ).
     */
    saveCard: function (s, data) {
      if (s.state >= STATES.CARD_1 && s.state < STATES.CARDS_DONE) {
        s.cards[s.state - STATES.CARD_1] = (data === undefined) ? null : data;
        s.shift_card = (s.state === STATES.CARD_1) ? 0 : (s.state === STATES.CARD_2) ? 1 : null;
      }
      return s;
    },

    /* 演出完了→次枚目待ち(card_insert_next 1461 相当)。1463-1466 で裏技窓を閉じ・bb2_state++。
       工程4 で CreateFightingData 合成(1527・1572 相当)と 1601 接続をここへ写した:
       - 3枚目進行(case6 1527): 1P 合成 init(barcode_data[0], barcode_data[2]) → fightingData[0](1535 相当)。
       - 4枚目進行(case7 1572): 2P 合成 init(barcode_data[1], barcode_data[3]) → fightingData[1](1576 相当)。
       - 3・4枚目スロットが null(スキップ — 元 1414・1424 で barcode_data[2/3]=null)でも合成は走る(元と同じ 1枚分岐・元 84-101)。
       - HTML 防御: 1枚目スロット(1527 の barcode_data[0])・2枚目スロット(1572 の barcode_data[1])が null の場合のみ合成しない。
         元は同経路で NPE。HTML で null になり得るのは互換ラッパ cardInserted の data 省略時だけで実機経路ではない。
         合成スキップ時は fightingData[0/1] は null のまま(view 側 1544・1572 相当は特殊能力・先攻演出の防御分岐でスキップ)。 */
    advanceCardFx: function (s) {
      if (s.state >= STATES.CARD_1 && s.state < STATES.CARDS_DONE) {
        s.shift_card = null;
        if (s.state === STATES.CARD_3 && s.cards[0]) {
          s.fightingData[0] = new BB2.CreateFightingData().init(s.cards[0], s.cards[2] || null);  /* 1527 相当(1535 の fighting_data[0]=fd 相当) */
        } else if (s.state === STATES.CARD_4 && s.cards[1]) {
          s.fightingData[1] = new BB2.CreateFightingData().init(s.cards[1], s.cards[3] || null);  /* 1572 相当(1576 の fighting_data[1]=fd 相当) */
          State.ensureFightingCalc(s);                  /* 737-739 相当(lazy 生成)。元 1601 は 1528-1530 確保済の fighting_data を参照 — ここは create() 側確保で同じ */
          s.fightingCalc.fighting_data = s.fightingData; /* 1601 相当(decide_first_player 1916・calc_special_down 1821-1822 で参照) */
        }
        s.state = s.state + 1;
      }
      return s;
    },

    cardInserted: function (s, data) {   /* 互換ラッパ(=saveCard+advanceCardFx。窓は演出相当の即閉じ・忠実) */
      var st = s.state;
      if (st >= STATES.CARD_1 && st < STATES.CARDS_DONE) {
        State.saveCard(s, data);
        State.advanceCardFx(s);
      }
      return s;
    },

    /* card_insert 失敗分支(1050・1094・1125・1156)→ card_insert_error_back(1772) 相当:
     * 元は bb2_state を変えずに入力受付を再有効化し barcode_data[idx]=reader.barcode_data を
     * 保存する(元 1057・1098・1127・1157 測定済み・null 含む。アイテム・同バーコード失敗では
     * データが残り、元のエラー演出 1619・1675 が barcode_data[idx]!=null を参照するため
     * 2026-11-04 作業6 工程1 で data 引数を追加)。data 無しの旧呼び出しは null 代入のまま。
     * ここでも状態を変えない(同じ場所でリトライ可)・shift 窓も閉じる */
    cardInputFailed: function (s, data) {
      if (s.state >= STATES.CARD_1 && s.state < STATES.CARDS_DONE) {
        s.cards[s.state - STATES.CARD_1] = (data === undefined) ? null : data;
        s.shift_card = null;
      }
      return s;
    },

    /* value_shift(1173・裏技)相当: 受付対象カード(shift_card)に再デコード結果を代入する
     * (元 1199・1204 は init 失敗時も barcode_data を上書き — ここも同じ)。
     * 元は演出中のみ複数回押下可。HTML では窓は次のカード入力まで続く */
    valueShift: function (s, data) {
      if (s.shift_card !== null) s.cards[s.shift_card] = data;
      return s;
    },

    /* card_skip(1394)→ card_insert_next 相当: 元の実装どおり 3枚目(6)・4枚目(7) のみスキップ。
     * 演出移植(2026-11-04 作業6 工程1)では演出開始時に saveCard(null)(元 1414・1424 の
     * barcode_data[2/3]=null 相当)を view 側が呼び、演出完了でこの cardSkip(進行+窓閉)を呼ぶ。
     * ここでは saveCard(null)+advanceCardFx と同等の忠実動作とする
     * (advanceCardFx 側の 1527・1572 相当合成も走る — 元 card_skip でも next 側 case6/7 の合成は同じ) */
    cardSkip: function (s) {
      if (s.state === STATES.CARD_3 || s.state === STATES.CARD_4) {
        State.saveCard(s, null);
        State.advanceCardFx(s);
      }
      return s;
    },

    /* --- 工程4(演出一体化・2026-11-04)の State 側接続 --- */

    /* 元 736-739 の lazy 生成(if(!fighting_calc){ fighting_calc = new FightingCalc() })相当。
     * 単一インスタンスを持ち回す(737 のガードで初回生成・以降は使い回し) */
    ensureFightingCalc: function (s) {
      if (!s.fightingCalc) s.fightingCalc = new BB2.FightingCalc();   /* js/fighting_calc.js の BB2.FightingCalc(元 27-28 で barcode_world/nes を内包) */
      return s.fightingCalc;
    },

    /* 元 decide_star()(736)の 749-752 部: 守護星の実計算 1 回(rand は Math.random — FightingCalc 80)。
     * 0=レトフ(陸)/1=セターン(空)/2=ラト(海)。演出(Timer 150ms×13 点滅 762-788 は view 側)の開始前に 1 だけ決める(元の順) */
    rollProtectionStar: function (s) {
      var fc = State.ensureFightingCalc(s);
      fc.decideStar();              /* 752 相当(js/fighting_calc.js の decideStar 78-88 移植済) */
      return s;
    },

    /* 元 special_down()(1798-1832)の演出部(1836-1886 点滅・1889-1907 完了ハンドラ)を除いた本体相当。
     * 1804-1809: 特殊能力45 無効化 — 45 を持った側が「相手側」の能力を無効化(1811-1814 は special_1p_enabled が false 側の
     * fighting_data[0] を・1815-1818 は special_2p_enabled が false 側の fighting_data[1] を清零)。読み取りは 1804・1807 で
     * 先に両側を読み・適用は 1811-1818(両側 45 は相互無効化になる — その元の順)。
     * 1821-1822: calc_special_down 対呼び。2 件目は 1821 で再代入済の fighting_data[0] を第1引数に渡す(元の癖を保持)。
     * 1824-1826: 全 down_*_flag 判定を view へ返しで渡す(true=演出要す・false=演出なしで先攻演出 10 待ち)。 */
    specialDown: function (s) {
      var fd = s.fightingData, fc = State.ensureFightingCalc(s);
      if (!fd[0] || !fd[1]) return false;   /* HTML 防御(advanceCardFx の合成スキップと連動・実機では合成済確定 — advanceCardFx コメント参照) */
      var fd0_has45 = (fd[0].special1 === 45 || fd[0].special2 === 45);   /* 1804-1806: special_2p_enabled=false(1P 側 45) */
      var fd1_has45 = (fd[1].special1 === 45 || fd[1].special2 === 45);   /* 1807-1809: special_1p_enabled=false(2P 側 45) */
      if (fd1_has45) { fd[0].special1 = 0; fd[0].special2 = 0; }          /* 1811-1814 */
      if (fd0_has45) { fd[1].special1 = 0; fd[1].special2 = 0; }          /* 1815-1818 */
      fd[0] = fc.calcSpecialDown(fd[1], fd[0]);   /* 1821 相当(js/fighting_calc.js の calcSpecialDown 158-332 移植済) */
      fd[1] = fc.calcSpecialDown(fd[0], fd[1]);   /* 1822 相当(癖保持: 2 件目は 1821 再代入済の fd[0] を第1引数に) */
      var flat = !fd[0].down_hp_flag && !fd[0].down_st_flag && !fd[0].down_df_flag &&   /* 1824-1825 */
                 !fd[1].down_hp_flag && !fd[1].down_st_flag && !fd[1].down_df_flag;
      return !flat;   /* true=演出要す(view 側 Timer 250ms×14 — 1828-1832 相当)・false=演出なし(1826 相当で view 側が即 10 待ち演出) */
    },

    /* 元 decide_first_player()(1913-1925)の演出(1920-1923 timer・1928-1952 点滅)を除いた本体相当。
     * bb2_state は変えない(1913-1925 に bb2_state 行なし — 状態 8 のまま演出完了まで続く)。
     * 1916 で now_player 1/2 を決める(js/fighting_calc.js の decideFirstPlayer 91-101・コイントラ 107 含む・
     * fc.fighting_data は 1601 接続済前提)。1919 で battle_waiting_first=true(元 1912)。battle_waiting 本体(1957)は
     * 工程5-1 の State.battleWaiting へ接続(view 側は fxDecideFirst 完了経路から呼ぶ) */
    decideFirst: function (s) {
      var fc = State.ensureFightingCalc(s);
      fc.decideFirstPlayer();        /* 1916 相当 */
      s.battleWaitingFirst = true;   /* 1919 相当 */
      return s;
    },

    /* battle_waiting()(1957-2035)の進行分岐相当(工程5-1・2026-11-05 接続)。元行番号対応:
     *   1958 battle_flag=false → s.battleFlag=false(2338 フィールド)。
     *   1960-1965 decide_first_timer 解放(TIMER/TIMER_COMPLETE リスナ外し・stop・null)は view 側 startFx 完了時
     *     自後片付け(view 273-277 相当)で済 — battle_waiting 側呼出は view の fxDecideFirst 完了経路のみ。
     *   1967-1978 gate: battle_waiting_first が false のときだけ now_player 側の HP<=0 を照合し call_battle_end()(2161)
     *     相当で return。call_battle_end 本体未移植(5-2)のため返しの battleEnd:true を view へ返し view 側は note のみ(05:59
     *     placeholder と同じ过渡 note 運用)。初回経路は 1919 の true 代入で gate を経ない(false 化箇所は 2713 等・上記フィールドコメント)。
     *   now_player 選択: 1916(decideFirst)で決定済の値を 1968・2002・2015・2319 の分岐に使う。返しの nowPlayer・
     *     1/2 分岐ごとの listener 割当相当(2005-2025)/cpu 分岐(2019-2033)の結果を受け取る(代入は view 側 battleClick 配線)。
     *   2013・2024 select_battle_magic=true(3185 フィールド初期 true)。
     *   bb2_state は変えない(元 1957-2035 に bb2_state 行なし・実測)。1982-1993 データ表示・1996-2000 Timer(500)・
     *   2002-2017 light1/light5 は view 側(工程5-1 fxBattleWaiting)。SE は Phase 7 未接続。
     *   防御: fightingData/FightingCalc 未接続(合成防御経路・view 側 fxCardNext で連鎖スキップ済・実機では接続済)は null 返し。*/
    battleWaiting: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battleFlag = false;                          /* 1958 相当 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;   /* HTML 防御(元 1969・1974・2006・2019・2021 は直接参照・実機経路は合成済で接続済・上記) */
      var now = fc.now_player;                       /* 1=1P 側・2=2P 側(元 103-106・1916 決定済) */
      if (!s.battleWaitingFirst) {                   /* 1967 gate(false のときだけ HP 照合・初回経路は 1919 で非発動) */
        if (now === 1) {                             /* 1968-1972 */
          if (fd[0].hp <= 0) return { battleEnd: true, nowPlayer: now };   /* 1970-1971 call_battle_end()(2161・5-2)相当で return */
        } else {                                     /* 1973-1978 */
          if (fd[1].hp <= 0) return { battleEnd: true, nowPlayer: now };   /* 1975-1976 */
        }
      }
      var w = { battleEnd: false, nowPlayer: now, cpu: false };
      if (now === 1) {                               /* 2002-2014(1P 側 attack) */
        w.battle = true;                             /* 2005 l_battle → battle()(2340・5-2) */
        w.power = !fd[0].pp_ignore_flag;             /* 2006-2008 l_power → power()(2992・5-3)。pp_ignore_flag true 側は listener 付与なし */
        w.escape = (s.mode === 1);                   /* 2010-2012(C1・mode==1 のときだけ r_power → escape()(2038・C1/C2 は Phase 5)。C0 は faithful skip */
        w.select = true;                             /* 2013-2014 select_button → select()(3187・5-4) */
        s.selectBattleMagic = true;                  /* 2013 */
      } else {                                       /* 2015-2034(2P 側) */
        if (!fd[1].cpu) {                            /* 2019-2025 */
          w.battle = true;                           /* 2020 r_battle → battle()(5-2) */
          w.power = !fd[1].pp_ignore_flag;           /* 2021-2023 r_power → power()(5-3)。同 pp_ignore ゲート */
          w.select = true;                           /* 2024-2025 select_button → select()(5-4) */
          s.selectBattleMagic = true;                /* 2024 */
        } else {                                     /* 2026-2033 敵のオート行動: auto_battle_timer 2029-2031 Timer(200,4) TIMER_COMPLETE →
          auto_battle_cpu()(2101-2160・本体未読取済・5-5)。view 側 startAutoBattle で note 接続 */
          w.cpu = true;
          w.autoCpu = true;
        }
      }
      return w;
    },

    /* battle()(2340-2434) の進行・計算分岐相当(工程5-2a・2026-11-05 接続)。
     * 2342: battle_flag=true → s.battleFlag=true。
     * 2343-2350: ラベル(battle_label/power_label)と listener 解除は view 側 fxBattle。
     * 2353-2408: now_player==1(fd[0]→fd[1]) / !=1(fd[1]→fd[0]) の命中(calc_hit)・基礎ダメージ(basic_damage)・
     *   特殊倍率(special_multi)・display_damage 代入・相手 HP 減算(0 未満は 0 クランプ 2363-2365/2390-2392)・
     *   会心判定(critical_hit)。外れ時は display_damage=0(2377/2403)。SE(2368-2376/2395-2402)は Phase 7 未接続。
     * 2410-2413: damage_label=true / hp・st・df_label=false は view 側 fxBattle。
     * 2416-2433: hit && critical → time=90, battle_end_count=40 / hit && !critical → time=110, battle_end_count=60 /
     *   !hit → time=130, battle_end_count=80。Timer(40, time) は view 側 fxBattle。
     * opts(省略可・テスト用): { hitRand, dmgRand } を calcHit / basicDamage へ渡す(省略時は元の Math.random)。 */
    battle: function (s, opts) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battleFlag = true;                           /* 2342 相当 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 2353 / 2381 */
      var def = (now === 1) ? fd[1] : fd[0];
      var hit = fc.calcHit(att, def, 0, opts && opts.hitRand);   /* 2355 / 2382 */
      var critical = false;
      if (hit) {                                     /* 2356 / 2384 */
        var basic = fc.basicDamage(att, def, opts && opts.dmgRand);   /* 2357 / 2385 */
        var multi = fc.specialMulti(att, def, basic);                 /* 2358 / 2386 */
        fc.display_damage = multi;                   /* 2359 / 2387 */
        def.hp = def.hp - multi;                     /* 2362 / 2389 */
        if (def.hp < 0) def.hp = 0;                  /* 2363-2365 / 2390-2392 */
        critical = fc.criticalHit(att);              /* 2367 / 2394 */
      } else {                                       /* 2375 / 2401 */
        fc.display_damage = 0;                       /* 2377 / 2403 */
      }
      var time, endCount;                            /* 2417-2428 */
      if (hit) {
        if (critical) {
          time = 90; endCount = 40;                  /* 2419-2420 */
        } else {
          time = 110; endCount = 60;                 /* 2422-2423 */
        }
      } else {
        time = 130; endCount = 80;                   /* 2426-2427 */
      }
      s.battleEndCount = endCount;
      return {
        nowPlayer: now,
        hit: hit,
        critical: critical,
        displayDamage: fc.display_damage,
        time: time,
        battleEndCount: endCount
      };
    },

    /* battle_complete()(2657-2739) の進行・判定相当(工程5-2a・2026-11-05 接続)。
     * 2659-2672: battle_timer / item_broke_animation_timer 解放は view 側 clearFx で済。
     * 2677-2693: display_damage > 0 のとき check_item_broken(att, def) を判定し、true なら
     *   itemBroken:true で return(view 側が Timer(250,10) → item_broke_animation → item_broke_complete)。
     * 2695-2738: 破壊なし(または item_broke_complete 後の再入)では now_player を 1↔2 反転し(2696/2718)、
     *   battle_waiting_first = false(2713/2735) にして battle_waiting(2714/2736) へ進む。 */
    battleComplete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];
      var def = (now === 1) ? fd[1] : fd[0];
      if (fc.display_damage > 0) {                   /* 2677 */
        if (fc.checkItemBroken(att, def)) {          /* 2678-2683 */
          return { itemBroken: true, nowPlayer: now };   /* 2684-2691 */
        }
      }
      fc.now_player = (now === 1) ? 2 : 1;           /* 2696 / 2718 */
      s.battleWaitingFirst = false;                  /* 2713 / 2735 */
      return { itemBroken: false, nowPlayer: fc.now_player };
    },

    /* item_broke_complete()(2809-2834) の進行相当(工程5-2a・2026-11-05 接続)。
     * 2810-2832: 攻撃側 ST アイテム(race2==5 && !st_item_broke_flag)なら st -= st2, st_item_broke_flag = true。
     *   防御側 DF アイテム(race2==7 && !df_item_broke_flag)なら df -= df2, df_item_broke_flag = true。
     * 2833: battle_complete() を再呼び出し(フラグが true になっているため check_item_broken は false となりターン交代へ進む)。 */
    itemBrokeComplete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 2810 / 2821 */
      var def = (now === 1) ? fd[1] : fd[0];
      if (att.race2 === 5 && !att.st_item_broke_flag) {   /* 2812-2815 / 2823-2826 */
        att.st = att.st - att.st2;
        att.st_item_broke_flag = true;
      }
      if (def.race2 === 7 && !def.df_item_broke_flag) {   /* 2817-2820 / 2828-2831 */
        def.df = def.df - def.df2;
        def.df_item_broke_flag = true;
      }
      return State.battleComplete(s);                /* 2833 battle_complete(TimerEvent.TIMER_COMPLETE) */
    },

    /* call_battle_end()(2161-2297) の進行分岐相当(工程5-2b・工程6-3 C2 接続)。
     * 2163-2167: battle_waiting_timer 停止・null 化は view 側 fxCallBattleEnd。
     * 2169-2181: 全 light 消灯・battle/power/miss/critical/damage ラベル false・hp/st/df ラベル true は view 側。
     * 2183-2296 switch(mode):
     *   case 0(2185-2194): Timer(120, 15) → battle_end_animation(2838) → COMPLETE: battle_end(2898)。
     *   case 2(2245-2295): 戦闘中 HP/MP/PP を barcode_data_c2[4 or 5] にコピー・HP<=0 で live=false。
     *     両方死亡(!c2[4].live && !c2[5].live)なら COMPLETE: battle_end(2273)、片方健在なら c2[6] に敵 HP/MP/PP コピーし COMPLETE: battle_end_c2(2289)。
     *   case 1(2196-2243): C1 モード(Phase 5 未接続)。
     * now_player は敗北側(1968-1978 で HP<=0 だった側)・勝者側は now_player==2 なら 1P(fd[0])、!=2 なら 2P(fd[1])(2843/2920)。 */
    callBattleEnd: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var c1BothDead = false;
      var c2BothDead = false;
      if (s.mode === 1 && s.barcodeDataC1) {         /* 2196-2243(工程7-3) */
        var c1HeroIdx = (s.friendSelectStateC1 === 1) ? 4 : 5; /* 2200-2214 */
        var c1HeroBd = s.barcodeDataC1[c1HeroIdx];
        if (c1HeroBd) {
          c1HeroBd.hp = fd[0].hp;
          c1HeroBd.mp = fd[0].mp;
          c1HeroBd.pp = fd[0].pp;
          if (c1HeroBd.hp <= 0) c1HeroBd.live = false;
        }
        var c1WLive = !!(s.barcodeDataC1[4] && s.barcodeDataC1[4].live);
        var c1MLive = !!(s.barcodeDataC1[5] && s.barcodeDataC1[5].live);
        if (!c1WLive && !c1MLive) {                  /* 2217-2227 主人公両方死亡 */
          c1BothDead = true;
        } else if (s.barcodeDataEnemy) {             /* 2232-2234 主人公片方健在: 敵ステータス保存 */
          s.barcodeDataEnemy.hp = fd[1].hp;
          s.barcodeDataEnemy.mp = fd[1].mp;
          s.barcodeDataEnemy.pp = fd[1].pp;
        }
      }
      if (s.mode === 2 && s.barcodeDataC2) {         /* 2246-2294(工程6-3) */
        var heroIdx = (s.friendSelectState === 1) ? 4 : 5; /* 2250-2264 */
        var heroBd = s.barcodeDataC2[heroIdx];
        if (heroBd) {
          heroBd.hp = fd[0].hp;
          heroBd.mp = fd[0].mp;
          heroBd.pp = fd[0].pp;
          if (heroBd.hp <= 0) heroBd.live = false;
        }
        var wLive = !!(s.barcodeDataC2[4] && s.barcodeDataC2[4].live);
        var mLive = !!(s.barcodeDataC2[5] && s.barcodeDataC2[5].live);
        if (!wLive && !mLive) {                      /* 2267-2277 主人公両方死亡 */
          c2BothDead = true;
        } else if (s.barcodeDataC2[6]) {             /* 2282-2284 主人公片方健在: 敵ステータス保存 */
          s.barcodeDataC2[6].hp = fd[1].hp;
          s.barcodeDataC2[6].mp = fd[1].mp;
          s.barcodeDataC2[6].pp = fd[1].pp;
        }
      }
      return {
        mode: s.mode,
        nowPlayer: now,
        winner: (now === 2) ? 1 : 2,
        timerDelay: 120,
        timerRepeat: 15,
        c0: (s.mode === 0),
        c1BothDead: c1BothDead,
        c2BothDead: c2BothDead
      };
    },

    /* battle_end()(2898-2915) の進行相当(工程5-2b・2026-11-05 接続)。
     * 2900-2905: battle_end_animation_timer 解放は view 側 clearFx で済。
     * 2907: set_button.addEventListener(MouseEvent.CLICK, restart_mode) → s.restartReady = true。
     * 2909-2913: end_text_animation_timer = new Timer(150) 無制限は view 側 fxBattleEnd。 */
    battleEnd: function (s) {
      s.restartReady = true;                         /* 2907 相当 */
      return s;
    },

    /* restart_mode()(2955-2985) の進行相当(工程5-2b・2026-11-05 接続)。
     * 2958: set_button.removeEventListener(MouseEvent.CLICK, restart_mode) → s.restartReady = false。
     * 2959-2963: end_text_animation_timer 停止・null 化は view 側 fxRestartMode。
     * 2965-2984 switch(mode):
     *   case 0(2966-2973): warrior/magician ラベル 4 種 false・bb2_state = 4(CARD_1)・card_insert_wait()。
     *   case 2(2975-2982): C2 ラベル切替・bb2_state = 4・card_insert_wait_c2()(Phase 5)。 */
    restartMode: function (s) {
      if (!s.restartReady) return false;
      s.restartReady = false;                        /* 2958 相当 */
      if (s.mode === 0 || s.mode === 2) {            /* 2966 / 2975 */
        s.state = STATES.CARD_1;                     /* 2971 / 2980 bb2_state = 4 */
        return true;
      }
      return false;
    },

    /* power()(2992-3029) の進行・計算相当(工程5-3・2026-11-05 接続)。
     * 2994: power_flag = true → s.powerFlag = true。
     * 2995-3002: battle_label/power_label 切替と listener 解除は view 側 fxPower。
     * 3005-3016: now_player==1(fd[0].pp>0) / !=1(fd[1].pp>0) のとき basic_power(att, def) を算出し display_power に代入。
     *   pp<=0 のときは display_power を書き換えない(元の仕様)。
     * 3018-3021: damage/hp/st/df ラベル false は view 側 fxPower。
     * 3023-3028: Timer(80, 40) → power_animation(3032) / COMPLETE → power_complete(3141) は view 側 fxPower。 */
    power: function (s, randIdxOverride, timingOverride) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.powerFlag = true;                            /* 2994 相当 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 3005 / 3011 */
      var def = (now === 1) ? fd[1] : fd[0];
      var hasPp = att.pp > 0;                        /* 3006 / 3012 */
      if (hasPp) {
        fc.display_power = fc.basicPower(att, def, randIdxOverride, timingOverride);   /* 3007-3008 / 3013-3014 */
      }
      return {
        nowPlayer: now,
        hasPp: hasPp,
        displayPower: fc.display_power,
        timerDelay: 80,
        timerRepeat: 40
      };
    },

    /* power_complete()(3141-3175) の進行相当(工程5-3・2026-11-05 接続)。
     * 3143-3148: power_timer 解放は view 側 clearFx で済。
     * 3150-3174: power_flag = false(3151/3164)。
     *   att.pp > 0 のとき att.hp += display_power, att.pp -= 1, now_player を 1↔2 反転(3152-3156 / 3165-3169)。
     *   att.pp <= 0(薬草0個)のときは HP/PP/now_player 変更なし(同じプレイヤーのまま再待機)。
     *   battle_waiting_first = false(3159/3171)にして battle_waiting(3160/3172)へ進む。 */
    powerComplete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.powerFlag = false;                           /* 3151 / 3164 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 3150 / 3162 */
      var recovered = false;
      if (att.pp > 0) {                              /* 3152 / 3165 */
        att.hp = att.hp + fc.display_power;          /* 3153 / 3166 */
        att.pp = att.pp - 1;                         /* 3154 / 3167 */
        fc.now_player = (now === 1) ? 2 : 1;         /* 3155 / 3168 */
        recovered = true;
      }
      s.battleWaitingFirst = false;                  /* 3159 / 3171 */
      return {
        recovered: recovered,
        nowPlayer: fc.now_player
      };
    },

    /* select()(3187-3262) の進行相当(工程5-4・2026-11-05 接続)。
     * 3195-3200: l_battle/l_power/r_battle/r_power/escape/select listener 解除は view 側 fxSelect。
     * 3202-3204: select_mp_pp = 1(薬草)・select_mp_function = -2・select_pp_state = -2。
     * 3206-3210: select_animation_timer = new Timer(150) 無制限は view 側 fxSelect。
     * 3213: power_flag = true → s.powerFlag = true。
     * 3214-3257: ラベル切替・数値初期表示・job<=6 で select_mp_enable=false / >6 で true。
     * 3259-3260: select_button→select_state / set_button→set_state リスナー付与(s.selectActive = true)。 */
    select: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 3224 / 3241 */
      s.selectMpPp = 1;                              /* 3202 */
      s.selectMpFunction = -2;                       /* 3203 */
      s.selectPpState = -2;                          /* 3204 */
      s.powerFlag = true;                            /* 3213 */
      s.selectMpEnable = (att.job > 6);              /* 3232-3240 / 3248-3256 */
      s.selectActive = true;                         /* 3259-3260 */
      return {
        nowPlayer: now,
        selectMpEnable: s.selectMpEnable,
        hp: att.hp,
        pp: att.pp,
        mp: att.mp
      };
    },

    /* select_state()(3435-3488) の進行相当(工程5-4・2026-11-05 接続)。
     * 3439-3446 / 3464-3470(未選択: select_mp_function==-2 && select_pp_state==-2):
     *   select_mp_pp==1 && select_mp_enable なら 0(魔法)へ、それ以外は 1(薬草)へ切替。
     * 3447-3461 / 3472-3485(選択開始以降):
     *   select_mp_function >= -1 なら select_next_mp_function(att, select_mp_function, select_battle_magic)。
     *   select_pp_state >= -1 なら select_next_pp_state(att, select_pp_state)。 */
    selectState: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!s.selectActive || !fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 3437 / 3462 */
      if (s.selectMpFunction === -2 && s.selectPpState === -2) {   /* 3439 / 3464 */
        if (s.selectMpPp === 1 && s.selectMpEnable) {
          s.selectMpPp = 0;                          /* 3442 / 3467 */
        } else {
          s.selectMpPp = 1;                          /* 3444 / 3469 */
        }
      } else {                                       /* 3447 / 3472 */
        if (s.selectMpFunction >= -1) {              /* 3451 / 3475 */
          s.selectMpFunction = fc.selectNextMpFunction(att, s.selectMpFunction, s.selectBattleMagic);   /* 3453 / 3477 */
        } else if (s.selectPpState >= -1) {          /* 3456 / 3480 */
          s.selectPpState = fc.selectNextPpState(att, s.selectPpState);   /* 3458 / 3482 */
        }
      }
      return {
        selectMpPp: s.selectMpPp,
        selectMpFunction: s.selectMpFunction,
        selectPpState: s.selectPpState
      };
    },

    /* set_state()(3491-3569) の進行相当(工程5-4・2026-11-05 接続)。
     * 3494-3529(魔法選択中 select_mp_pp==0):
     *   -2(未選択) → select_mp_function = -1(選択開始)
     *   -1(選択開始のまま決定=キャンセル) → power_flag=false, リスナー/タイマー解除、
     *     select_battle_magic が true なら battle_waiting_first=false で battle_waiting 再入(3512-3514)、false なら C2 select_end_state(3517・Phase 5)。
     *   >=0(F0〜F9 決定) → リスナー/タイマー解除、use_magic()(3528・工程5-5)。
     * 3530-3567(薬草選択中 select_mp_pp!=0):
     *   -2(未選択) → select_pp_state = -1(選択開始)
     *   -1(選択開始のまま決定=キャンセル) → power_flag=false, リスナー/タイマー解除、battle_waiting 再入(3549-3551) または C2 select_end_state(3554)。
     *   >=1(薬草1〜3個決定) → power_flag=true, リスナー/タイマー解除、use_pp()(3565)。 */
    setState: function (s) {
      if (!s.selectActive) return null;
      if (s.selectMpPp === 0) {                      /* 3494 */
        if (s.selectMpFunction === -2) {             /* 3496-3498 */
          s.selectMpFunction = -1;
          return { action: 'start_mp' };
        }
        if (s.selectMpFunction === -1) {             /* 3500-3518 */
          s.powerFlag = false;
          s.selectActive = false;
          if (s.selectBattleMagic) {                 /* 3512-3514 */
            s.battleWaitingFirst = false;
            return { action: 'cancel_to_waiting' };
          }
          return { action: 'cancel_to_c2_end' };     /* 3516-3518(Phase 5) */
        }
        s.selectActive = false;                      /* 3520-3529 */
        return { action: 'use_magic', mpFunction: s.selectMpFunction };
      } else {                                       /* 3530 */
        if (s.selectPpState === -2) {                /* 3533-3535 */
          s.selectPpState = -1;
          return { action: 'start_pp' };
        }
        if (s.selectPpState === -1) {                /* 3537-3555 */
          s.powerFlag = false;
          s.selectActive = false;
          if (s.selectBattleMagic) {                 /* 3549-3551 */
            s.battleWaitingFirst = false;
            return { action: 'cancel_to_waiting' };
          }
          return { action: 'cancel_to_c2_end' };     /* 3553-3555(Phase 5) */
        }
        s.powerFlag = true;                          /* 3557 */
        s.selectActive = false;                      /* 3558-3565 */
        return { action: 'use_pp', ppState: s.selectPpState };
      }
    },

    /* use_pp()(3575-3599) の進行・計算相当(工程5-4・2026-11-05 接続)。
     * 3578-3589: now_player 側の pp > 0 のとき use_pp_power(att, def, select_pp_state) を算出し display_power に代入。
     * 3591-3597: Timer(80, 40) → use_pp_animation(3603) / COMPLETE → use_pp_complete(3651) は view 側 fxUsePp。 */
    usePp: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 3578 / 3584 */
      var def = (now === 1) ? fd[1] : fd[0];
      if (att.pp > 0) {                              /* 3579 / 3585 */
        fc.display_power = fc.usePpPower(att, def, s.selectPpState);   /* 3580-3581 / 3586-3587 */
      }
      return {
        nowPlayer: now,
        displayPower: fc.display_power,
        timerDelay: 80,
        timerRepeat: 40
      };
    },

    /* use_pp_complete()(3651-3684) の進行相当(工程5-4・2026-11-05 接続)。
     * 3653: power_flag = false → s.powerFlag = false。
     * 3654-3661: use_pp_animation_timer 解放は view 側 clearFx で済。
     * 3664-3672: att.hp += display_power, att.pp -= select_pp_state, now_player を 1↔2 反転。
     * 3675-3683: select_battle_magic が true(C0/戦闘中)なら battle_waiting_first=false で battle_waiting 再入、
     *   false(C2 戦闘後 Phase 5)なら select_magic_pp_use=true。 */
    usePpComplete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.powerFlag = false;                           /* 3653 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 3664 / 3668 */
      att.hp = att.hp + fc.display_power;            /* 3665 / 3669 */
      att.pp = att.pp - s.selectPpState;             /* 3666 / 3670 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 3667 / 3671 */
      if (s.selectBattleMagic) {                     /* 3675-3677 */
        s.battleWaitingFirst = false;
        return { nowPlayer: fc.now_player, toWaiting: true };
      }
      s.selectMagicPpUse = true;                     /* 3680-3682(C2 戦闘後・工程6-3) */
      this.magicPpUseCopy(s);
      return { nowPlayer: fc.now_player, toWaiting: false, toSelectEndState: true };
    },

    /* f0()(3737-3755) の進行・計算相当(工程5-5a・2026-11-05 接続)。
     * 3738: battle_power_disable_flag = true。
     * 3742-3746: 相手側の MP から奪う量を calc_f0 で算出し display_f0_mp に代入。
     * 3748-3753: Timer(150, 20) → f0_animation(3757) / COMPLETE → f0_complete(3825) は view 側 fxF0。 */
    f0: function (s, randOverride) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      s.battlePowerDisableFlag = true;               /* 3738 */
      var now = fc.now_player;
      var def = (now === 1) ? fd[1] : fd[0];         /* 3742-3746 */
      fc.display_f0_mp = fc.calcF0(def, randOverride);
      return {
        nowPlayer: now,
        displayF0Mp: fc.display_f0_mp,
        timerDelay: 150,
        timerRepeat: 20
      };
    },

    /* f0_animation 内の currentCount == 12(3762-3777) の MP 変更処理相当(工程5-5a)。
     * 攻撃側 mp += display_f0_mp(上限 99 クランプ 3766-3768 / 3772-3774)、防御側 mp -= display_f0_mp。 */
    f0ApplyMp: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      if (fc.now_player === 1) {                     /* 3764-3770 */
        fd[0].mp = fd[0].mp + fc.display_f0_mp;
        if (fd[0].mp > 99) fd[0].mp = 99;
        fd[1].mp = fd[1].mp - fc.display_f0_mp;
      } else {                                       /* 3770-3776 */
        fd[1].mp = fd[1].mp + fc.display_f0_mp;
        if (fd[1].mp > 99) fd[1].mp = 99;
        fd[0].mp = fd[0].mp - fc.display_f0_mp;
      }
      return { mp1p: fd[0].mp, mp2p: fd[1].mp };
    },

    /* f0_complete()(3825-3842) の進行相当(工程5-5a)。
     * 3826-3827: battle_power_disable_flag = false, power_flag = false。
     * 3834-3840: now_player を 1↔2 反転し battle_waiting_first = false。 */
    f0Complete: function (s) {
      var fc = s.fightingCalc;
      s.battlePowerDisableFlag = false;              /* 3826 */
      s.powerFlag = false;                           /* 3827 */
      if (!fc) return null;
      fc.now_player = (fc.now_player === 1) ? 2 : 1; /* 3834-3838 */
      s.battleWaitingFirst = false;                  /* 3840 */
      return { nowPlayer: fc.now_player };
    },

    /* f1()(3850-3951: ガンツ 0x0F) / f2()(3966-4067: デガンツ 0x14) の共通進行・計算相当(工程5-5a)。
     * 3852-3853 / 3968-3969: battle_flag = true, power_flag = false。
     * calc_hit(att, def, magicRate) / basic_damage / special_multi(att, def, basic, magicRate) でダメージ算出・HP 減算(0 クランプ)。
     * Timer(40, time) で battle_animation を回し、COMPLETE で f1_complete/f2_complete(MP 減算) → battle_complete の順に実行。 */
    _fAttack: function (s, magicRate, opts) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battleFlag = true;                           /* 3852 / 3968 */
      s.powerFlag = false;                           /* 3853 / 3969 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];
      var def = (now === 1) ? fd[1] : fd[0];
      var hit = fc.calcHit(att, def, magicRate, opts && opts.hitRand);   /* 3874 / 3901 / 3990 / 4017 */
      var critical = false;
      if (hit) {
        var basic = fc.basicDamage(att, def, opts && opts.dmgRand);      /* 3876 / 3904 / 3992 / 4020 */
        var multi = fc.specialMulti(att, def, basic, magicRate);         /* 3877 / 3905 / 3993 / 4021 */
        fc.display_damage = multi;
        def.hp = def.hp - multi;
        if (def.hp < 0) def.hp = 0;
        critical = fc.criticalHit(att);
      } else {
        fc.display_damage = 0;
      }
      var time, endCount;
      if (hit) {
        if (critical) {
          time = 90; endCount = 40;
        } else {
          time = 110; endCount = 60;
        }
      } else {
        time = 130; endCount = 80;
      }
      s.battleEndCount = endCount;
      return {
        nowPlayer: now,
        hit: hit,
        critical: critical,
        displayDamage: fc.display_damage,
        timerDelay: 40,
        timerRepeat: time,
        battleEndCount: endCount
      };
    },

    f1: function (s, opts) {
      return this._fAttack(s, 0x0F, opts);           /* 3850-3951 ガンツ(1.5倍・消費2) */
    },

    /* f1_complete(3953-3961) + battle_complete(2657) 連続実行相当(3947-3948 の listener 順)。 */
    f1Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      if (fc.now_player === 1) fd[0].mp = fd[0].mp - fc.magic_list[1];   /* 3955-3956 */
      else fd[1].mp = fd[1].mp - fc.magic_list[1];                       /* 3957-3959 */
      return this.battleComplete(s);                                     /* 3948 */
    },

    f2: function (s, opts) {
      return this._fAttack(s, 0x14, opts);           /* 3966-4067 デガンツ(2.0倍・消費5) */
    },

    /* f2_complete(4068-4076) + battle_complete(2657) 連続実行相当(4063-4064 の listener 順)。 */
    f2Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      if (fc.now_player === 1) fd[0].mp = fd[0].mp - fc.magic_list[2];   /* 4070-4071 */
      else fd[1].mp = fd[1].mp - fc.magic_list[2];                       /* 4072-4074 */
      return this.battleComplete(s);                                     /* 4064 */
    },

    /* f3()(4080-4103: リーモ・消費2) の進行・計算相当(工程5-5a)。
     * 4083-4094: calc_f3(att) を display_power に設定し Timer(80, 40) で use_pp_animation → f3_complete。 */
    f3: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4083 / 4089 */
      fc.display_power = fc.calcF3(att);             /* 4085-4086 / 4091-4092 */
      return {
        nowPlayer: now,
        displayPower: fc.display_power,
        timerDelay: 80,
        timerRepeat: 40
      };
    },

    /* f3_complete()(4105-4137) の進行相当(工程5-5a)。 */
    f3Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.powerFlag = false;                           /* 4106 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4116 / 4120 */
      att.hp = att.hp + fc.display_power;            /* 4117 / 4121 */
      att.mp = att.mp - fc.magic_list[3];            /* 4118 / 4122 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4119 / 4123 */
      if (s.selectBattleMagic) {                     /* 4127-4129 */
        s.battleWaitingFirst = false;
        return { nowPlayer: fc.now_player, toWaiting: true };
      }
      s.selectMagicPpUse = true;                     /* 4132-4134(C2 戦闘後・工程6-3) */
      this.magicPpUseCopy(s);
      return { nowPlayer: fc.now_player, toWaiting: false, toSelectEndState: true };
    },

    /* f4()(4141-4164: デリーモ・消費4) の進行・計算相当(工程5-5a)。 */
    f4: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4144 / 4150 */
      fc.display_power = fc.calcF4(att);             /* 4146-4147 / 4152-4153 */
      return {
        nowPlayer: now,
        displayPower: fc.display_power,
        timerDelay: 80,
        timerRepeat: 40
      };
    },

    /* f4_complete()(4166-4199) の進行相当(工程5-5a)。 */
    f4Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.powerFlag = false;                           /* 4168 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4178 / 4182 */
      att.hp = att.hp + fc.display_power;            /* 4179 / 4183 */
      att.mp = att.mp - fc.magic_list[4];            /* 4180 / 4184 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4181 / 4185 */
      if (s.selectBattleMagic) {                     /* 4189-4191 */
        s.battleWaitingFirst = false;
        return { nowPlayer: fc.now_player, toWaiting: true };
      }
      s.selectMagicPpUse = true;                     /* 4194-4196(C2 戦闘後・工程6-3) */
      this.magicPpUseCopy(s);
      return { nowPlayer: fc.now_player, toWaiting: false, toSelectEndState: true };
    },

    /* f5(4204) / f6(4303) / f7(4409) / f8(4508) / f9(4616) の共通開始(工程5-5b・2026-11-05 接続)。
     * すべて battle_power_disable_flag = true で Timer(150, 12) を開始する。 */
    _fStatusStart: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      s.battlePowerDisableFlag = true;
      return {
        nowPlayer: fc.now_player,
        timerDelay: 150,
        timerRepeat: 12
      };
    },

    f5: function (s) { return this._fStatusStart(s); },   /* 4204-4223 ニャーヘ(消費3・相手DFダウン) */

    /* f5_complete()(4264-4298) の進行相当(工程5-5b)。 */
    f5Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battlePowerDisableFlag = false;              /* 4267 */
      s.powerFlag = false;                           /* 4268 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4276 / 4285 */
      var def = (now === 1) ? fd[1] : fd[0];
      var c5 = fc.calcF5(def);                       /* 4277 / 4286 */
      def.df1 = def.df1 - c5;                        /* 4278 / 4287 */
      def.df = def.df2 + def.df1;                    /* 4279 / 4288 */
      if (def.df > 199) def.df = 199;                /* 4280-4282 / 4289-4291 */
      att.mp = att.mp - fc.magic_list[5];            /* 4283 / 4292 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4284 / 4293 */
      s.battleWaitingFirst = false;                  /* 4296 */
      return { nowPlayer: fc.now_player, calcVal: c5 };
    },

    f6: function (s) { return this._fStatusStart(s); },   /* 4303-4322 カチコム(消費5・自分DFアップ) */

    /* f6_complete()(4363-4403) の進行相当(工程5-5b)。 */
    f6Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battlePowerDisableFlag = false;              /* 4365 */
      s.powerFlag = false;                           /* 4366 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4375 / 4387 */
      var c6 = fc.calcF6(att);                       /* 4376 / 4388 */
      att.df1 = att.df1 + c6;                        /* 4377 / 4389 */
      if (att.df1 > 199) att.df1 = 199;              /* 4378-4380 / 4390-4392 */
      att.df = att.df2 + att.df1;                    /* 4381 / 4393 */
      if (att.df > 199) att.df = 199;                /* 4382-4384 / 4394-4396 */
      att.mp = att.mp - fc.magic_list[6];            /* 4385 / 4397 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4386 / 4398 */
      s.battleWaitingFirst = false;                  /* 4401 */
      return { nowPlayer: fc.now_player, calcVal: c6 };
    },

    f7: function (s) { return this._fStatusStart(s); },   /* 4409-4428 ヘヘンダ(消費4・相手STダウン) */

    /* f7_complete()(4469-4503) の進行相当(工程5-5b)。 */
    f7Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battlePowerDisableFlag = false;              /* 4472 */
      s.powerFlag = false;                           /* 4473 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4481 / 4490 */
      var def = (now === 1) ? fd[1] : fd[0];
      var c7 = fc.calcF7(def);                       /* 4482 / 4491 */
      def.st1 = def.st1 - c7;                        /* 4483 / 4492 */
      def.st = def.st2 + def.st1;                    /* 4484 / 4493 */
      if (def.st > 199) def.st = 199;                /* 4485-4487 / 4494-4496 */
      att.mp = att.mp - fc.magic_list[7];            /* 4488 / 4497 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4489 / 4498 */
      s.battleWaitingFirst = false;                  /* 4501 */
      return { nowPlayer: fc.now_player, calcVal: c7 };
    },

    f8: function (s) { return this._fStatusStart(s); },   /* 4508-4527 タフニ(消費6・自分STアップ) */

    /* f8_complete()(4570-4610) の進行相当(工程5-5b)。 */
    f8Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      s.battlePowerDisableFlag = false;              /* 4572 */
      s.powerFlag = false;                           /* 4573 */
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4582 / 4594 */
      var c8 = fc.calcF8(att);                       /* 4583 / 4595 */
      att.st1 = att.st1 + c8;                        /* 4584 / 4596 */
      if (att.st1 > 199) att.st1 = 199;              /* 4585-4587 / 4597-4599 */
      att.st = att.st2 + att.st1;                    /* 4588 / 4600 */
      if (att.st > 199) att.st = 199;                /* 4589-4591 / 4601-4603 */
      att.mp = att.mp - fc.magic_list[8];            /* 4592 / 4604 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4593 / 4605 */
      s.battleWaitingFirst = false;                  /* 4608 */
      return { nowPlayer: fc.now_player, calcVal: c8 };
    },

    f9: function (s) { return this._fStatusStart(s); },   /* 4616-4641 マミロージャ(消費3・相手薬草封印) */

    /* f9_complete()(4656-4680) の進行相当(工程5-5b)。 */
    f9Complete: function (s) {
      var fd = s.fightingData, fc = s.fightingCalc;
      if (!fd || !fd[0] || !fd[1] || !fc) return null;
      var now = fc.now_player;
      var att = (now === 1) ? fd[0] : fd[1];         /* 4666 / 4670 */
      var def = (now === 1) ? fd[1] : fd[0];
      def.pp_ignore_flag = true;                     /* 4667 / 4671 */
      att.mp = att.mp - fc.magic_list[9];            /* 4668 / 4672 */
      fc.now_player = (now === 1) ? 2 : 1;           /* 4669 / 4673 */
      s.battlePowerDisableFlag = false;              /* 4676 */
      s.powerFlag = false;                           /* 4677 */
      s.battleWaitingFirst = false;                  /* 4678 */
      return { nowPlayer: fc.now_player };
    },

    /* auto_battle_cpu()(2101-2158) の行動決定相当(工程5-5b)。
     * fc.calcAction(randOverride, randMagicOverride) を呼び、0〜9(魔法 f0〜f9)・10(battle)・11(power) を返す。 */
    autoBattleCpu: function (s, randOverride, randMagicOverride) {
      var fc = s.fightingCalc;
      if (!fc) return null;
      var act = fc.calcAction(randOverride, randMagicOverride);   /* 2108 */
      return { action: act };
    },

    /* createCloneInstance(9666) の BarcodeData クローン相当(工程6-1) */
    cloneBarcodeData: function (bd) {
      if (!bd) return null;
      var c = (BB2.BarcodeData) ? new BB2.BarcodeData() : {};
      c.barcode = bd.barcode;
      c.hp = bd.hp;
      c.st = bd.st;
      c.df = bd.df;
      c.speed = bd.speed;
      c.race = bd.race;
      c.job = bd.job;
      c.pp = bd.pp;
      c.mp = bd.mp;
      c.special = bd.special;
      c.live = bd.live;
      return c;
    },

    /* card_insert_c2()(4800-4902) の主人公1枚目(戦士 case 4)・2枚目(魔法使い case 5)入力処理相当(工程6-1)。
     * 成功・失敗いずれでも barcode_data_c2[0,2,4](case 4) または [1,3,5](case 5) にクローンを保存する(元 4827-4829 / 4849-4851 / 4868-4870 / 4891-4893 どおり)。 */
    cardInsertC2: function (s, barcode) {
      if (!s.barcodeDataC2) s.barcodeDataC2 = [null, null, null, null, null, null, null, null];
      var before = s.state;
      var reader = new BB2.BarcodeRead();
      var jobReq = (before === STATES.CARD_1) ? 'warrior' : 'magician'; /* 4822 / 4863 */
      var ok = reader.init(barcode, 1, null, 0, true, jobReq);
      var bd = reader.barcode_data;
      if (before === STATES.CARD_1) {                  /* 4827-4829 / 4849-4851 */
        s.barcodeDataC2[0] = this.cloneBarcodeData(bd);
        s.barcodeDataC2[2] = this.cloneBarcodeData(bd);
        s.barcodeDataC2[4] = this.cloneBarcodeData(bd);
        s.cards[0] = s.barcodeDataC2[0];               /* insertAnim の互換参照用 */
      } else if (before === STATES.CARD_2) {           /* 4868-4870 / 4891-4893 */
        s.barcodeDataC2[1] = this.cloneBarcodeData(bd);
        s.barcodeDataC2[3] = this.cloneBarcodeData(bd);
        s.barcodeDataC2[5] = this.cloneBarcodeData(bd);
        s.cards[1] = s.barcodeDataC2[1];
      }
      return { ok: ok, before: before, data: bd };
    },

    /* card_insert_next_c2()(4910-5087) の進行処理相当(工程6-1: case 4/5、case 6/7 も併せて用意)。 */
    cardInsertNextC2: function (s) {
      var before = s.state;
      if (before === STATES.CARD_1) {                  /* 4928-4943(1枚目完了→bb2_state=5) */
        s.state = STATES.CARD_2;
        return { before: before, nextState: s.state, bd: s.barcodeDataC2[0] };
      }
      if (before === STATES.CARD_2) {                  /* 4946-4961(2枚目完了→bb2_state=6, set_button 待ち) */
        s.state = STATES.CARD_3;
        s.c2WaitEnemySet = true;                       /* 4960 */
        return { before: before, nextState: s.state, bd: s.barcodeDataC2[1] };
      }
      if (before === STATES.CARD_3) {                  /* 4964-5011(敵カード完了→bb2_state=7, 仲間選択待ち) */
        s.state = STATES.CARD_4;
        s.friendSelectState = 0;                       /* 5002 */
        s.c2FriendSelectActive = true;                 /* 5009 */
        s.c2FriendSetReady = false;
        return { before: before, nextState: s.state, bd: s.barcodeDataC2[6] };
      }
      if (before === STATES.CARD_4) {                  /* 5014-5084(アイテムカード完了→FD作成→bb2_state=8→special_down) */
        var heroBd = (s.friendSelectState === 1) ? s.barcodeDataC2[4] : s.barcodeDataC2[5]; /* 5024-5028 */
        var itemBd = s.barcodeDataC2[7] || null;
        if (BB2.CreateFightingData) {
          s.fightingData[0] = new BB2.CreateFightingData().init(heroBd, itemBd);            /* 5035-5040 */
          s.fightingData[1] = new BB2.CreateFightingData().init(s.barcodeDataC2[6], null);  /* 5043 */
          s.fightingData[1].cpu = true;                                                     /* 5044 */
        }
        s.state = STATES.CARDS_DONE;                   /* 5069 */
        if (!s.fightingCalc && BB2.FightingCalc) s.fightingCalc = new BB2.FightingCalc();
        if (s.fightingCalc) s.fightingCalc.fighting_data = s.fightingData;                  /* 5081 */
        return { before: before, nextState: s.state, fd0: s.fightingData[0], fd1: s.fightingData[1] };
      }
      return null;
    },

    /* card_enemy_insert_wait_c2()(5306-5360) の進行相当(工程6-1・6-3) */
    cardEnemyInsertWaitC2: function (s) {
      if (s.state !== STATES.CARD_3) s.state = STATES.CARD_3; /* 5311-5313 */
      s.c2WaitEnemySet = false;
      s.passcodeActive = false;
      s.c2LoseChoiceActive = false;                    /* 5307-5309 */
      s.c2BattleGetActive = false;
      s.c2PasscodeAvailable = false;
      s.c2ShowPasscodeHold = false;
      s.c2EnemyWaitActive = true;                      /* 5348 / 5356 */
      return { state: s.state };
    },

    /* select_passcode()(5385-5430) の進行相当(工程6-1) */
    selectPasscode: function (s) {
      s.c2EnemyWaitActive = false;                     /* 5387 / 5391 */
      s.passcodeActive = true;                         /* 5388-5389 */
      s.passcodeState = 0;                             /* 5428 */
      s.passcode = '00000';                            /* 5429 */
      return { passcodeState: s.passcodeState, passcode: s.passcode };
    },

    /* add_passcode()(5492-5536) の進行相当(工程6-1) */
    addPasscode: function (s) {
      if (!s.passcodeActive || s.passcodeState < 0 || s.passcodeState > 4) return null;
      var idx = s.passcodeState;
      var plus = (parseInt(s.passcode.charAt(idx), 10) || 0) + 1; /* 5497 等 */
      if (plus > 9) plus = 0;
      s.passcode = s.passcode.substring(0, idx) + String(plus) + s.passcode.substring(idx + 1);
      return { passcodeState: s.passcodeState, passcode: s.passcode };
    },

    /* set_passcode()(5540-5576) の進行相当(工程6-1) */
    setPasscode: function (s) {
      if (!s.passcodeActive) return null;
      s.passcodeState = s.passcodeState + 1;           /* 5545 */
      if (s.passcodeState < 5) {
        return { done: false, passcodeState: s.passcodeState, passcode: s.passcode };
      }
      s.passcodeActive = false;                        /* 5547-5548 */
      var c2p = new C2PassCode();
      c2p.init(s.barcodeDataC2[0], s.barcodeDataC2[1], s.passcode); /* 5551 */
      var num = c2p.generate_passcode_number();        /* 5552 */
      if (num === -1) {                                /* 5555-5556(間違い→敵カード入力待ちへ戻る) */
        return { done: true, valid: false, passcodeNumber: -1 };
      }
      s.barcodeDataC2[2] = this.cloneBarcodeData(s.barcodeDataC2[4]); /* 5560 */
      s.barcodeDataC2[3] = this.cloneBarcodeData(s.barcodeDataC2[5]); /* 5561 */
      s.barcodeDataC2[4] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(s.barcodeDataC2[0]), num); /* 5562 */
      s.barcodeDataC2[5] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(s.barcodeDataC2[1]), num); /* 5563 */
      return { done: true, valid: true, passcodeNumber: num };
    },

    /* card_enemy_insert_c2()(5616-5670) の進行相当(工程6-1) */
    cardEnemyInsertC2: function (s, barcode) {
      s.c2EnemyWaitActive = false;                     /* 5618-5621 */
      var reader = new BB2.BarcodeRead();
      var ok = reader.init(barcode, 1, null, 0);       /* 5637 */
      s.barcodeDataC2[6] = reader.barcode_data;        /* 5642 / 5662 */
      return { ok: ok, data: reader.barcode_data };
    },

    /* add_friend_state()(5901-5931) の進行相当(工程6-2)。
     * 5904-5928: 生死(live)に応じ friend_select_state を 0→(1 or 2)、1→(2 or 1)、2→(1 or 2) に切替え、
     * 5930: set_button→set_friend_state を有効化する。 */
    addFriendState: function (s) {
      if (!s.c2FriendSelectActive) return null;
      var wLive = !!(s.barcodeDataC2[4] && s.barcodeDataC2[4].live);
      var mLive = !!(s.barcodeDataC2[5] && s.barcodeDataC2[5].live);
      if (s.friendSelectState === 0) {                 /* 5905-5911 */
        s.friendSelectState = wLive ? 1 : 2;
      } else if (s.friendSelectState === 1) {          /* 5913-5919 */
        s.friendSelectState = mLive ? 2 : 1;
      } else {                                         /* 5921-5927 */
        s.friendSelectState = wLive ? 1 : 2;
      }
      s.c2FriendSetReady = true;                       /* 5930 */
      return { friendSelectState: s.friendSelectState };
    },

    /* set_friend_state()(5933-5963) の進行相当(工程6-2)。
     * 仲間選択リスナーを解除し、アイテム入力/スキップ受付(c2ItemWaitActive = true)を開く。 */
    setFriendState: function (s) {
      s.c2FriendSelectActive = false;                  /* 5936 */
      s.c2FriendSetReady = false;                      /* 5937 */
      s.c2ItemWaitActive = true;                       /* 5952 / 5957 */
      return { friendSelectState: s.friendSelectState };
    },

    /* card_insert_wait_c2_back()(4686-4707) の進行相当(工程6-2・6-3)。
     * 敗北後に残りの主人公へ交代(1↔2)して bb2_state=7 に戻す。 */
    cardInsertWaitC2Back: function (s) {
      s.c2LoseChoiceActive = false;                    /* 4688-4689 */
      s.friendSelectState = (s.friendSelectState === 1) ? 2 : 1; /* 4691-4695 */
      s.state = STATES.CARD_4;                         /* 4696 */
      s.c2FriendSelectActive = true;                   /* 4706 */
      s.c2FriendSetReady = false;
      return { friendSelectState: s.friendSelectState, state: s.state };
    },

    /* friend_animation_c2_complete()(5873-5899) の進行相当(工程6-2)。 */
    friendAnimationC2Complete: function (s) {
      s.c2FriendSelectActive = false;                  /* 5874 */
      s.c2FriendSetReady = false;                      /* 5875 */
      s.c2ItemWaitActive = true;                       /* 5889 / 5894 */
      return { friendSelectState: s.friendSelectState };
    },

    /* card_insert_next_set_c2()(5966-5975: アイテムスキップ) の進行相当(工程6-2)。 */
    cardInsertNextSetC2: function (s) {
      s.c2ItemWaitActive = false;                      /* 5968-5971 */
      s.barcodeDataC2[7] = null;                       /* 5972 */
      return this.cardInsertNextC2(s);                 /* 5974 */
    },

    /* card_item_insert_c2()(6013-6062) の進行相当(工程6-2)。 */
    cardItemInsertC2: function (s, barcode) {
      s.c2ItemWaitActive = false;                      /* 6014 */
      var bd = (s.friendSelectState === 1) ? s.barcodeDataC2[4] : s.barcodeDataC2[5]; /* 6025-6029 */
      var reader = new BB2.BarcodeRead();
      var ok = reader.init(barcode, 2, bd, 0, false, null, true); /* 6032(item=true) */
      s.barcodeDataC2[7] = reader.barcode_data;        /* 6036 / 6056 */
      return { ok: ok, data: reader.barcode_data };
    },

    /* magic_pp_use_copy()(6405-6429) の進行相当(工程6-3・7-3)。
     * 戦闘後の魔法・薬草使用後に fighting_data[0] の HP/MP/PP を barcode_data_c2/c1[4 or 5] にコピーする。 */
    magicPpUseCopy: function (s) {
      if (!s.fightingData || !s.fightingData[0]) return s;
      if (s.mode === 2 && s.barcodeDataC2) {
        var idx = (s.friendSelectState === 1) ? 4 : 5; /* 6408-6416 */
        if (s.barcodeDataC2[idx]) {
          s.barcodeDataC2[idx].hp = s.fightingData[0].hp;
          s.barcodeDataC2[idx].mp = s.fightingData[0].mp;
          s.barcodeDataC2[idx].pp = s.fightingData[0].pp;
        }
      } else if (s.mode === 1 && s.barcodeDataC1) {
        var idx1 = (s.friendSelectStateC1 === 1) ? 4 : 5; /* 6419-6427 */
        if (s.barcodeDataC1[idx1]) {
          s.barcodeDataC1[idx1].hp = s.fightingData[0].hp;
          s.barcodeDataC1[idx1].mp = s.fightingData[0].mp;
          s.barcodeDataC1[idx1].pp = s.fightingData[0].pp;
        }
      }
      return s;
    },

    /* battle_end_c2()(6780-6810) の進行相当(工程6-3)。
     * 敵 HP<=0(勝利)なら戦利品獲得待ち(select_end_state / get_mp_pp・special 80〜99 は show_passcode)、
     * 敵 HP>0(味方1人敗北・もう1人健在)なら SELECT(新敵カード待ち) / SET(残存仲間登場) の分岐へ遷移。 */
    battleEndC2: function (s) {
      s.c2ShowPasscodeHold = false;                    /* 6781-6782 */
      if (!s.barcodeDataC2 || !s.barcodeDataC2[6]) return null;
      var enemy = s.barcodeDataC2[6];
      if (enemy.hp <= 0) {                             /* 6791-6804(勝利) */
        var sp = enemy.special;
        s.c2PasscodeAvailable = (sp >= 80 && sp <= 99); /* 6798-6800 */
        s.selectMagicPpUse = false;                    /* 6801 */
        s.c2BattleGetActive = true;                    /* 6802-6803 */
        s.c2LoseChoiceActive = false;
        return { enemyDefeated: true, passcodeAvailable: s.c2PasscodeAvailable };
      }
      s.c2PasscodeAvailable = false;                   /* 6805-6809(敗北・片方健在) */
      s.c2BattleGetActive = false;
      s.c2LoseChoiceActive = true;
      return { enemyDefeated: false, passcodeAvailable: false };
    },

    /* select_end_state()(6433-6494) の進行相当(工程6-3・7-3)。
     * 戦利品演出中かつ未回復(!selectMagicPpUse)なら now_player=1・selectBattleMagic=false で select() へ入り、
     * 回復完了後またはキャンセル復帰時は戦利品演出(battle_get_animation_c2 / c1)へ戻る。 */
    selectEndState: function (s, isBattleGetRunning) {
      s.c2ShowPasscodeHold = false;                    /* 6444-6445 */
      s.c1LPowerReady = false;                         /* 6434 */
      if (isBattleGetRunning && !s.selectMagicPpUse) { /* 6437-6465 */
        s.c2BattleGetActive = false;
        s.c1BattleGetActive = false;
        if (!s.fightingCalc && BB2.FightingCalc) s.fightingCalc = new BB2.FightingCalc();
        if (s.fightingCalc) s.fightingCalc.now_player = 1; /* 6463 */
        s.selectBattleMagic = false;                   /* 6464 */
        var sel = this.select(s);                      /* 6465 */
        return { action: 'enter_select', selectInfo: sel };
      }
      if (s.mode === 1) {                              /* 6481-6492(C1) */
        s.c1BattleGetActive = true;
      } else {                                         /* 6469-6479(C2) */
        s.c2BattleGetActive = true;
      }
      return { action: 'start_battle_get', canSelect: !s.selectMagicPpUse, mode: s.mode };
    },

    /* get_mp_pp()(6497-6709) の進行相当(工程6-3)。
     * 敵 special(65〜79 および default)に応じた HP/ST/DF/MP/PP 獲得ボーナスを適用し上限クランプ後、Timer(100,20) パラメータを返す。 */
    getMpPp: function (s) {
      if (!s.barcodeDataC2 || !s.barcodeDataC2[6]) return null;
      s.c2PasscodeAvailable = false;                   /* 6500-6504 */
      s.c2ShowPasscodeHold = false;
      s.c2BattleGetActive = false;
      var c2 = s.barcodeDataC2;
      var sp = c2[6].special;
      var isW = (s.friendSelectState === 1);
      switch (sp) {                                    /* 6512-6671 */
        case 65:
          if (isW) { c2[4].hp += 1; c2[4].pp += 5; }
          else { c2[5].hp += 1; c2[5].pp += 5; c2[5].mp += 5; }
          break;
        case 66:
          if (isW) { c2[4].hp += 3; c2[4].pp += 5; }
          else { c2[5].hp += 3; c2[5].pp += 5; c2[5].mp += 5; }
          break;
        case 67:
          if (isW) { c2[4].hp += 4; c2[4].pp += 5; }
          else { c2[5].hp += 4; c2[5].pp += 5; c2[5].mp += 5; }
          break;
        case 68:
          if (isW) { c2[4].hp += 5; c2[4].pp += 5; }
          else { c2[5].hp += 5; c2[5].pp += 5; c2[5].mp += 5; }
          break;
        case 69:
          if (isW) { c2[4].hp += 10; c2[4].pp += 5; }
          else { c2[5].hp += 10; c2[5].pp += 5; c2[5].mp += 5; }
          break;
        case 70:
          if (isW) { c2[4].st += 2; c2[4].pp += 5; }
          else { c2[5].st += 2; c2[5].pp += 5; }
          break;
        case 71:
          if (isW) { c2[4].st += 4; c2[4].pp += 5; }
          else { c2[5].st += 4; c2[5].pp += 5; }
          break;
        case 72:
          if (isW) { c2[4].st += 6; c2[4].pp += 5; }
          else { c2[5].st += 6; c2[5].pp += 5; }
          break;
        case 73:
          if (isW) { c2[4].st += 8; c2[4].pp += 5; }
          else { c2[5].st += 8; c2[5].pp += 5; }
          break;
        case 74:
          if (isW) { c2[4].st += 10; c2[4].pp += 5; }
          else { c2[5].st += 10; c2[5].pp += 5; }
          break;
        case 75:
          if (isW) { c2[4].df += 2; }
          else { c2[5].df += 2; c2[5].mp += 5; }
          break;
        case 76:
          if (isW) { c2[4].df += 4; }
          else { c2[5].df += 4; c2[5].mp += 5; }
          break;
        case 77:
          if (isW) { c2[4].df += 6; }
          else { c2[5].df += 6; c2[5].mp += 5; }
          break;
        case 78:
          if (isW) { c2[4].df += 8; }
          else { c2[5].df += 8; c2[5].mp += 5; }
          break;
        case 79:
          if (isW) { c2[4].df += 10; }
          else { c2[5].df += 1; c2[5].mp += 5; }       /* 6658 元 AS の df + 1 仕様を忠実保持 */
          break;
        default:
          if (isW) { c2[4].pp += 5; }
          else { c2[5].pp += 5; c2[5].mp += 5; }
          break;
      }
      if (c2[4]) {                                     /* 6674-6685 */
        if (c2[4].hp > 999) c2[4].hp = 999;
        if (c2[4].st > 199) c2[4].st = 199;
        if (c2[4].df > 199) c2[4].df = 199;
        if (c2[4].pp > 99) c2[4].pp = 99;
      }
      if (c2[5]) {                                     /* 6686-6700 */
        if (c2[5].hp > 999) c2[5].hp = 999;
        if (c2[5].st > 199) c2[5].st = 199;
        if (c2[5].df > 199) c2[5].df = 199;
        if (c2[5].mp > 99) c2[5].mp = 99;
        if (c2[5].pp > 99) c2[5].pp = 99;
      }
      return { timerDelay: 100, timerRepeat: 20, special: sp };
    },

    /* show_passcode()(6814-6858) の進行相当(工程6-3)。
     * 敵 special(80〜99)からパスコードを生成し、barcode_data_c2[2..5] にパスコード強化値を適用する。 */
    showPasscode: function (s) {
      if (!s.c2PasscodeAvailable || !s.barcodeDataC2 || !s.barcodeDataC2[6]) return null;
      s.c2PasscodeAvailable = false;                   /* 6823-6827 */
      s.c2BattleGetActive = false;
      s.c2ShowPasscodeHold = true;
      var c2 = s.barcodeDataC2;
      var c2p = new C2PassCode();                      /* 6829-6831 */
      c2p.init(c2[0], c2[1]);
      var pc = c2p.generate_passcode(c2[6].special);
      var pcNum = parseInt(String(pc.charAt(0)) + String(pc.charAt(2)), 10) || 0; /* 6851 */
      c2[2] = this.cloneBarcodeData(c2[4]);            /* 6854-6857 */
      c2[3] = this.cloneBarcodeData(c2[5]);
      c2[4] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(c2[0]), pcNum);
      c2[5] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(c2[1]), pcNum);
      return { passcode: pc, passcodeNumber: pcNum };
    },

    /* --- 工程7-1: C1 カード入力・ステージ選択・敵出現弧(6865-7756) --- */

    /* card_insert_retry_c1()(6865-6881) の進行相当(工程7-1) */
    cardInsertRetryC1: function (s) {
      s.c1StageSelectActive = false;                   /* 6872-6876 */
      s.state = STATES.CARD_1;                         /* 6878 bb2_state = 4 */
      s.c1CardSkipActive = true;                       /* 6879 set_button→card_insert_skip_c1 */
      s.c1WaitStageSelectSet = false;
      return { state: s.state };
    },

    /* card_insert_c1()(6976-7105) の進行相当(工程7-1) */
    cardInsertC1: function (s, barcode) {
      if (!s.barcodeDataC1) s.barcodeDataC1 = [null, null, null, null, null, null, null];
      if (!s.cards) s.cards = [null, null, null, null];
      var before = s.state;
      var reader = new BB2.BarcodeRead();
      var jobReq = (before === STATES.CARD_1) ? 'warrior' : 'magician'; /* 6999 / 7054 */
      var ok = reader.init(barcode, 1, null, 0, true, jobReq);
      var bd = reader.barcode_data;
      if (ok && s.c1WorldData) {                       /* 7003-7005 / 7058-7060 */
        s.c1WorldData.reset_world();
      }
      if (before === STATES.CARD_1) {
        s.barcodeDataC1[0] = this.cloneBarcodeData(bd); /* 7010 / 7016 / 7040 */
        if (ok && s.c1WorldData && s.c1WorldData.select_stage !== 0) { /* 7009-7014 */
          var pnum = s.c1WorldData.get_passcode_number(s.c1WorldData.select_stage - 1);
          var c2p = new C2PassCode();
          s.barcodeDataC1[2] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(bd), pnum);
          s.barcodeDataC1[4] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(bd), pnum);
        } else {                                       /* 7016-7018 / 7040-7042 */
          s.barcodeDataC1[2] = this.cloneBarcodeData(bd);
          s.barcodeDataC1[4] = this.cloneBarcodeData(bd);
        }
        s.cards[0] = s.barcodeDataC1[0];               /* insertAnim 互換用 */
      } else if (before === STATES.CARD_2) {
        s.barcodeDataC1[1] = this.cloneBarcodeData(bd); /* 7064 / 7070 / 7094 */
        if (ok && s.c1WorldData && s.c1WorldData.select_stage !== 0) { /* 7063-7068 */
          var pnum2 = s.c1WorldData.get_passcode_number(s.c1WorldData.select_stage - 1);
          var c2p2 = new C2PassCode();
          s.barcodeDataC1[3] = c2p2.generate_passcode_barcode_data(this.cloneBarcodeData(bd), pnum2);
          s.barcodeDataC1[5] = c2p2.generate_passcode_barcode_data(this.cloneBarcodeData(bd), pnum2);
        } else {                                       /* 7070-7072 / 7094-7096 */
          s.barcodeDataC1[3] = this.cloneBarcodeData(bd);
          s.barcodeDataC1[5] = this.cloneBarcodeData(bd);
        }
        s.cards[1] = s.barcodeDataC1[1];
      }
      return { ok: ok, before: before, data: bd };
    },

    /* card_insert_skip_c1()(7110-7136) の進行相当(工程7-1) */
    cardInsertSkipC1: function (s) {
      if (!s.c1CardSkipActive || !s.barcodeDataC1) return null;
      var before = s.state;
      if (before === STATES.CARD_1) {                  /* 7113-7120 */
        s.state = STATES.CARD_2;
        return { before: before, nextState: s.state, bd: s.barcodeDataC1[2] };
      }
      if (before === STATES.CARD_2) {                  /* 7122-7135 */
        s.c1CardSkipActive = false;
        s.state = STATES.CARD_3;
        s.c1WaitStageSelectSet = true;                 /* 7133 */
        return { before: before, nextState: s.state, bd: s.barcodeDataC1[3] };
      }
      return null;
    },

    /* card_insert_next_c1()(7140-7279) の進行相当(工程7-1) */
    cardInsertNextC1: function (s) {
      var before = s.state;
      if (before === STATES.CARD_1) {                  /* 7159-7174(1枚目完了→bb2_state=5) */
        s.state = STATES.CARD_2;
        return { before: before, nextState: s.state, bd: s.barcodeDataC1[4] };
      }
      if (before === STATES.CARD_2) {                  /* 7177-7205(2枚目完了→bb2_state=6・C1WorldData 生成・SET待ち) */
        s.state = STATES.CARD_3;
        s.c1CardSkipActive = false;
        if (!s.c1WorldData) {                          /* 7190-7202 */
          s.c1WorldData = new C1WorldData();
          var b1 = s.barcodeDataC1[4].barcode;
          var b2 = s.barcodeDataC1[5].barcode;
          var cd1 = (b1.length > 8) ? parseInt(b1.charAt(12), 10) : parseInt(b1.charAt(8), 10);
          var cd2 = (b2.length > 8) ? parseInt(b2.charAt(12), 10) : parseInt(b2.charAt(8), 10);
          s.c1WorldData.init(cd1, cd2);
        }
        s.c1WaitStageSelectSet = true;                 /* 7203 */
        return { before: before, nextState: s.state, bd0: s.barcodeDataC1[4], bd1: s.barcodeDataC1[5] };
      }
      if (before === STATES.CARD_3) {                  /* 7207-7276(アイテム合体/スキップ完了→FD生成→special_down) */
        var heroBd = (s.friendSelectStateC1 === 1) ? s.barcodeDataC1[4] : s.barcodeDataC1[5]; /* 7220-7224 */
        var itemBd = s.barcodeDataC1[6] || null;
        if (BB2.CreateFightingData) {
          s.fightingData[0] = new BB2.CreateFightingData().init(heroBd, itemBd);         /* 7231-7236 */
          s.fightingData[1] = new BB2.CreateFightingData().init(s.barcodeDataEnemy, null); /* 7239 */
          s.fightingData[1].cpu = true;                                                  /* 7240 */
        }
        s.state = STATES.CARDS_DONE;                   /* 戦闘ループ共通状態(8)へ遷移 */
        if (!s.fightingCalc && BB2.FightingCalc) s.fightingCalc = new BB2.FightingCalc();
        if (s.fightingCalc) s.fightingCalc.fighting_data = s.fightingData;               /* 7273 */
        return {
          before: before,
          nextState: s.state,
          fd0: s.fightingData[0],
          fd1: s.fightingData[1],
          hasKey: !!(s.c1WorldData && s.c1WorldData.key_number() > 0)                    /* 7216-7218 */
        };
      }
      return null;
    },

    /* c1_stage_select_click()(7446-7484) + c1_stage_select()(7489-7544) の進行相当(工程7-1) */
    c1StageSelectClick: function (s) {
      s.c1WaitStageSelectSet = false;                  /* 7482 */
      s.c1FriendSelectActive = false;                  /* 7478-7479 */
      s.friendSelectStateC1 = 0;                       /* 7475 */
      s.state = STATES.CARD_3;                         /* 7476 bb2_state = 6 */
      return this.c1StageSelect(s);                    /* 7483 */
    },

    c1StageSelect: function (s) {
      if (!s.c1WorldData) return null;
      s.c1WorldData.set_start_world();                 /* 7514 */
      s.callSaveFunction = 'c1_stage_select_click';    /* 7536 */
      s.c1SaveReady = true;                            /* 7537 r_battle→save */
      s.c1StageSelectFlag = false;                     /* 7539 */
      s.c1StageSelectActive = true;                    /* 7540-7543 */
      return {
        stageText: s.c1WorldData.stage[s.c1WorldData.select_stage],
        worldText: s.c1WorldData.world[s.c1WorldData.select_world]
      };
    },

    /* c1_stage_select_from_escape()(7547-7589) の進行相当(工程7-1/7-2) */
    c1StageSelectFromEscape: function (s) {
      if (!s.c1WorldData) return null;
      s.state = STATES.CARD_3;                         /* 戦闘中逃走(CARDS_DONE=8)からの復帰時に bb2_state=6 へ戻す */
      s.c1StageSelectFlag = false;                     /* 7588 */
      return {
        stageText: s.c1WorldData.stage[s.c1WorldData.select_stage],
        worldText: s.c1WorldData.world[s.c1WorldData.select_world]
      };
    },

    /* c1_stage_enemy_select()(7606-7620) の進行相当(工程7-1) */
    c1StageEnemySelect: function (s) {
      if (!s.c1StageSelectActive || !s.c1WorldData) return null;
      var w = s.c1WorldData;
      w.select_world = w.select_world + 1;             /* 7609-7612 */
      if (w.select_world >= w.world.length) w.select_world = 0;
      while (!w.is_world()) {                          /* 7614-7619 */
        w.select_world = w.select_world + 1;
        if (w.select_world >= w.world.length) w.select_world = 0;
      }
      return {
        selectWorld: w.select_world,
        worldText: w.world[w.select_world]
      };
    },

    /* c1_stage_enemy_set()(7628-7655) + call_enemy()(7659-7670) の進行相当(工程7-1) */
    c1StageEnemySet: function (s, randOverride) {
      if (!s.c1WorldData) return null;
      s.c1StageSelectActive = false;                   /* 7631-7635 */
      if (s.c1StageSelectFlag) return null;            /* 7644 */
      s.c1StageSelectFlag = true;                      /* 7645 */
      var w = s.c1WorldData;
      w.select_enemy = w.select_enemy_number(randOverride); /* 7652 */
      var worldText = w.world[w.select_world];         /* 7661 */
      var enemyText = ' ' + w.enemy[w.get_world_number()][w.select_enemy]; /* 7662 */
      return {
        selectEnemy: w.select_enemy,
        worldText: worldText,
        enemyText: enemyText,
        timerDelay: 120,
        timerRepeat: 15
      };
    },

    /* appear_enemy()(7685-7706) の進行相当(工程7-1) */
    appearEnemy: function (s) {
      if (!s.c1WorldData) return null;
      s.barcodeDataEnemy = s.c1WorldData.generate_enemy_paramater(); /* 7693 */
      return {
        enemy: s.barcodeDataEnemy,
        timerDelay: 80,
        timerRepeat: 20
      };
    },

    /* select_friend_c1()(7724-7756) の進行相当(工程7-1/7-2) */
    selectFriendC1: function (s) {
      if (!s.barcodeDataEnemy) return null;
      s.c1FriendSelectActive = true;                   /* 7755 select_button→add_friend_state_c1 */
      s.c1EscapeFromBattleReady = true;                /* 7754 r_power→escape_from_battle */
      s.c1FriendSetReady = false;
      return { enemy: s.barcodeDataEnemy };
    },

    /* --- 工程7-2: C1 逃走・出撃キャラ決定・アイテムカード入力/スキップ・パスコード入力弧(2038-2098, 7761-8515) --- */

    /* escape()(2038-2079) の進行相当(工程7-2: 戦闘中 r_power 押下時の逃走判定) */
    escape: function (s, randOverride) {
      var r = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 3); /* 2044 */
      if (r >= 1) {                                    /* 2045-2063 逃走成功 */
        s.c1StageSelectFlag = false;                   /* 2055 */
        s.friendSelectStateC1 = 0;                     /* 2056 */
        return { escaped: true, timerDelay: 150, timerRepeat: 15 };
      }
      return { escaped: false, timerDelay: 100, timerRepeat: 8 }; /* 2064-2077 逃走失敗 */
    },

    /* escape_failed_battle_waiting()(2082-2098) の進行相当(工程7-2: 戦闘中逃走失敗で敵ターンへ) */
    escapeFailedBattleWaiting: function (s) {
      if (s.fightingCalc) s.fightingCalc.now_player = 2; /* 2083 */
      return this.battleWaiting(s);                    /* 2097 */
    },

    /* escape_from_battle()(7761-7789) の進行相当(工程7-2: 出撃キャラ選択前の r_power 逃走判定) */
    escapeFromBattle: function (s, randOverride) {
      if (!s.c1EscapeFromBattleReady) return null;
      s.c1EscapeFromBattleReady = false;               /* 7762 */
      var r = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 3); /* 7771 */
      if (r >= 1) {                                    /* 7772-7779 逃走成功→c1_stage_select_click */
        s.c1FriendSelectActive = false;
        s.c1FriendSetReady = false;
        return { escaped: true, timerDelay: 150, timerRepeat: 15 };
      }
      return { escaped: false, timerDelay: 100, timerRepeat: 8 }; /* 7780-7788 逃走失敗 */
    },

    /* add_friend_state_c1()(7896-7926) の進行相当(工程7-2: 出撃キャラ切替) */
    addFriendStateC1: function (s) {
      if (!s.c1FriendSelectActive || !s.barcodeDataC1) return null;
      s.c1EscapeFromBattleReady = false;               /* 7898 */
      var c1 = s.barcodeDataC1;
      if (s.friendSelectStateC1 === 0) {               /* 7900-7906 */
        s.friendSelectStateC1 = (c1[4] && c1[4].live) ? 1 : 2;
      } else if (s.friendSelectStateC1 === 1) {        /* 7908-7914 */
        s.friendSelectStateC1 = (c1[5] && c1[5].live) ? 2 : 1;
      } else if (s.friendSelectStateC1 === 2) {        /* 7916-7922 */
        s.friendSelectStateC1 = (c1[4] && c1[4].live) ? 1 : 2;
      }
      s.c1FriendSetReady = true;                       /* 7925 */
      return { friendSelectStateC1: s.friendSelectStateC1 };
    },

    /* set_friend_state_c1()(7928-7960) の進行相当(工程7-2: 出撃キャラ決定→アイテムカード待ち) */
    setFriendStateC1: function (s) {
      s.c1EscapeFromBattleReady = false;               /* 7930-7932 */
      s.c1FriendSelectActive = false;
      s.c1FriendSetReady = false;
      s.state = STATES.CARD_3;                         /* 7946 bb2_state = 6 */
      s.c1ItemWaitActive = true;                       /* 7949 / 7954 */
      return { friendSelectStateC1: s.friendSelectStateC1, state: s.state };
    },

    /* card_insert_next_set_c1()(7963-7978) の進行相当(工程7-2: アイテムカードスキップ→戦闘突入) */
    cardInsertNextSetC1: function (s) {
      if (!s.c1ItemWaitActive || !s.barcodeDataC1) return null;
      s.c1ItemWaitActive = false;                      /* 7965-7966 */
      s.barcodeDataC1[6] = null;                       /* 7969 */
      return this.cardInsertNextC1(s);                 /* 7977 */
    },

    /* card_item_insert_c1()(8016-8101) の進行相当(工程7-2: C1 アイテム/情報カード入力) */
    cardItemInsertC1: function (s, barcode) {
      if (!s.c1ItemWaitActive || !s.barcodeDataC1) return null;
      s.c1ItemWaitActive = false;                      /* 8017-8018 */
      var bd = (s.friendSelectStateC1 === 1) ? s.barcodeDataC1[4] : s.barcodeDataC1[5]; /* 8031-8035 */
      var reader = new BB2.BarcodeRead();
      var ret = reader.init(barcode, 2, bd, 0, false, null, true, true); /* 8038 */
      var itemBd = reader.barcode_data;
      /* 8040-8058 情報カードチェック(race==9 && job==5/6) */
      if (itemBd && itemBd.race === 9 && (itemBd.job === 5 || itemBd.job === 6) && s.c1WorldData) {
        if (s.c1WorldData.key_number() === 3) {
          ret = false;
        } else if (itemBd.job === 5) {
          if (s.c1WorldData.infomation_flag_a) {
            ret = false;
          } else {
            s.c1WorldData.infomation_flag_a = true;
          }
        } else {
          if (s.c1WorldData.infomation_flag_b) {
            ret = false;
          } else {
            s.c1WorldData.infomation_flag_b = true;
          }
        }
      }
      s.barcodeDataC1[6] = itemBd;                     /* 8064 / 8095 */
      return { ok: ret, item: itemBd, hero: bd };
    },

    /* c1_input_passcode()(8107-8158) の進行相当(工程7-2: ステージ選択中 l_battle 押下で3桁パスコード入力開始) */
    c1InputPasscode: function (s) {
      s.c1StageSelectActive = false;                   /* 8108-8112 */
      s.c1PasscodeState = 0;                           /* 8153 */
      s.c1Passcode = '000';                            /* 8154 */
      s.c1PasscodeActive = true;                       /* 8155-8156 */
      return { passcodeState: s.c1PasscodeState, passcode: s.c1Passcode };
    },

    /* c1_input_add_passcode()(8194-8217) の進行相当(工程7-2: SELECT 押下で現在桁 +1) */
    c1InputAddPasscode: function (s) {
      if (!s.c1PasscodeActive) return null;
      var add;
      if (s.c1PasscodeState === 0) {                   /* 8199-8205 */
        add = (parseInt(s.c1Passcode.charAt(0), 10) || 0) + 1;
        if (add > 9) add -= 10;
        s.c1Passcode = String(add) + s.c1Passcode.charAt(1) + s.c1Passcode.charAt(2);
      } else if (s.c1PasscodeState === 1) {            /* 8207-8210(元実装の文字列連結を忠実保持) */
        add = (parseInt(s.c1Passcode.charAt(1), 10) || 0) + 1;
        s.c1Passcode = s.c1Passcode.charAt(0) + String(add) + s.c1Passcode.charAt(2);
      } else if (s.c1PasscodeState === 2) {            /* 8212-8215 */
        add = (parseInt(s.c1Passcode.charAt(2), 10) || 0) + 1;
        s.c1Passcode = s.c1Passcode.charAt(0) + s.c1Passcode.charAt(1) + String(add);
      }
      return { passcodeState: s.c1PasscodeState, passcode: s.c1Passcode };
    },

    /* c1_input_set_passcode()(8220-8233) + execute_c1_passcode()(8237-8315) の進行相当(工程7-2) */
    c1InputSetPasscode: function (s) {
      if (!s.c1PasscodeActive) return null;
      s.c1PasscodeState = s.c1PasscodeState + 1;       /* 8222 */
      if (s.c1PasscodeState === 3) {                   /* 8223-8232 */
        s.c1PasscodeActive = false;
        return this.executeC1Passcode(s);
      }
      return { done: false, passcodeState: s.c1PasscodeState, passcode: s.c1Passcode };
    },

    executeC1Passcode: function (s) {
      var pc = s.c1Passcode;
      var w = s.c1WorldData;
      var c1 = s.barcodeDataC1;
      if (w && c1 && w.select_stage === 0) {           /* 8241 E-1 のときだけ実行 */
        if (w.c1_powerup_passcode(pc)) {               /* 8243-8263 パワーアップパスコード */
          c1[2] = this.cloneBarcodeData(c1[4]);
          c1[3] = this.cloneBarcodeData(c1[5]);
          c1[4] = w.generate_passcode_barcode_data(this.cloneBarcodeData(c1[0]), pc);
          c1[5] = w.generate_passcode_barcode_data(this.cloneBarcodeData(c1[1]), pc);
          return { done: true, result: 'powerup', passcode: pc, timerDelay: 60, timerRepeat: 70 };
        }
        if (w.jump_stage_passcode(pc)) {               /* 8266-8303 ステージジャンプ(E5/E6) */
          var pfx = pc.charAt(0) + pc.charAt(1);
          var pnum = (pfx === '31') ? w.get_passcode_number(3) : w.get_passcode_number(4);
          w.select_stage = (pfx === '31') ? 4 : 5;
          w.reset_world();
          w.reset_key();
          var c2p = new C2PassCode();
          c2p.init(c1[0], c1[1]);
          c1[4] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(c1[0]), pnum);
          c1[5] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(c1[1]), pnum);
          c1[2] = this.cloneBarcodeData(c1[4]);
          c1[3] = this.cloneBarcodeData(c1[5]);
          var stg = this.c1StageSelectClick(s);        /* 8283 / 8299 */
          return { done: true, result: 'jump', passcode: pc, selectStage: w.select_stage, stage: stg };
        }
      }
      return { done: true, result: 'error', passcode: pc, timerDelay: 150, timerRepeat: 10 }; /* 8307-8314 */
    },

    /* --- 工程7-3: C1 戦闘終了・ボス撃破・鍵・敵情報・復活・味方交代・戦利品獲得弧(8518-8850, 9100-9664) --- */

    /* battle_end_c1()(8518-8699) の進行相当(工程7-3) */
    battleEndC1: function (s) {
      if (!s.barcodeDataEnemy || !s.c1WorldData || !s.barcodeDataC1) return null;
      var w = s.c1WorldData;
      var enemy = s.barcodeDataEnemy;
      s.c1BattleGetActive = false;
      s.c1LPowerReady = false;
      s.c1LoseChoiceActive = false;
      if (enemy.hp <= 0) {                             /* 8537 敵を倒した場合 */
        if (w.is_key()) {                              /* 8540-8593 敵に鍵があれば先に取得処理 */
          s.hadKeyNumber = w.key_number();             /* 8543 */
          w.delete_key();                              /* 8545 */
          s.hasKeyNumber = w.key_number();             /* 8547 */
          if (s.hasKeyNumber === 3 && w.world.indexOf('L-H') < 0) { /* 8550-8553 L-H 進入可 */
            w.world.push('L-H');
          }
          return {
            action: 'get_key',
            hadKey: s.hadKeyNumber,
            hasKey: s.hasKeyNumber,
            timerDelay: 150,
            timerRepeat: 20
          };
        }
        /* 8604 L-H のボス(HH)撃破 */
        if (w.get_world_number() === 5 && w.get_enemy_number() === 4) {
          return this.defeatBoss(s);                   /* 8612 */
        }
        /* 8613-8620 通常勝利(戦利品獲得待ち) */
        s.callSaveFunction = 'battle_end_c1';          /* 8614 */
        s.c1SaveReady = true;                          /* 8615 r_battle→save */
        s.selectMagicPpUse = false;                    /* 8617 */
        s.c1BattleGetActive = true;                    /* 8618-8619 */
        s.c1LPowerReady = true;                        /* 8616 */
        return { action: 'battle_get', timerDelay: 120 };
      }
      /* 8624-8698 味方1人敗北(片方健在) */
      s.hadKeyNumber = w.key_number();                 /* 8627 */
      if (!w.is_key() && w.get_world_number() !== 5 && w.get_enemy_number() !== 4 && s.hadKeyNumber > 0) { /* 8630 */
        w.add_key();                                   /* 8632 敵に鍵を奪われる */
        s.hasKeyNumber = w.key_number();               /* 8634 */
        return {
          action: 'lose_key',
          hadKey: s.hadKeyNumber,
          hasKey: s.hasKeyNumber,
          timerDelay: 150,
          timerRepeat: 20
        };
      }
      /* 8672-8697 敗北後選択(SELECT=ステージ選択 / SET=残存仲間交代) */
      s.c1LoseChoiceActive = true;
      return {
        action: 'lose_choice',
        enemy: enemy,
        hasKey: w.key_number() > 0
      };
    },

    /* defeat_boss()(8703-8749) の進行相当(工程7-3) */
    defeatBoss: function (s) {
      if (!s.c1WorldData) return null;
      var w = s.c1WorldData;
      var canAdvance = w.select_stage <= 2;            /* 8725 / 8742 */
      var hp1Text = canAdvance ? w.stage[w.select_stage] : 'fin';
      s.c1DefeatBossActive = true;                     /* 8743 / 8746 */
      s.c1ShowPasscodeHold = false;
      return {
        action: 'defeat_boss',
        hp1Text: hp1Text,
        canAdvanceStage: canAdvance,
        timerDelay: 300
      };
    },

    /* show_passcode_c1()(8752-8786) の進行相当(工程7-3) */
    showPasscodeC1: function (s) {
      if (!s.c1DefeatBossActive || !s.c1WorldData || !s.barcodeDataC1) return null;
      s.c1DefeatBossActive = false;                    /* 8761-8762 */
      s.c1ShowPasscodeHold = true;                     /* 8747-8748 */
      var pnum = s.c1WorldData.get_passcode_number();  /* 8764 */
      var c2p = new C2PassCode();                      /* 8765-8766 */
      c2p.init(s.barcodeDataC1[0], s.barcodeDataC1[1]);
      var pc = c2p.generate_passcode_from_passcode_number(pnum); /* 8767 */
      return { passcode: pc, passcodeNumber: pnum };
    },

    /* defeat_boss_animation_complete()(8818-8847) の進行相当(工程7-3) */
    defeatBossComplete: function (s) {
      if (!s.c1DefeatBossActive || !s.c1WorldData || !s.barcodeDataC1) return null;
      var w = s.c1WorldData;
      if (w.select_stage > 2) return null;             /* 8831 E1〜E3 のみ次ステージへ */
      s.c1DefeatBossActive = false;                    /* 8820-8823 */
      s.c1ShowPasscodeHold = false;
      var c1 = s.barcodeDataC1;
      var pnum = w.get_passcode_number();              /* 8833 */
      w.select_stage = w.select_stage + 1;             /* 8834 */
      w.reset_world();                                 /* 8835 */
      w.reset_key();                                   /* 8836 */
      var c2p = new C2PassCode();                      /* 8837-8838 */
      c2p.init(c1[0], c1[1]);
      c1[4] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(c1[0]), pnum); /* 8839 */
      c1[5] = c2p.generate_passcode_barcode_data(this.cloneBarcodeData(c1[1]), pnum); /* 8840 */
      c1[2] = this.cloneBarcodeData(c1[4]);            /* 8841 */
      c1[3] = this.cloneBarcodeData(c1[5]);            /* 8842 */
      var stg = this.c1StageSelectClick(s);            /* 8845 */
      return { selectStage: w.select_stage, passcodeNumber: pnum, stage: stg };
    },

    /* battle_end_l_power()(9100-9168) の進行相当(工程7-3: 勝利後 l_power 押下で復活または鍵情報抽選) */
    battleEndLPower: function (s, randOverride) {
      if (!s.c1LPowerReady || !s.c1WorldData || !s.barcodeDataC1) return null;
      s.c1LPowerReady = false;                         /* 9101 */
      s.c1BattleGetActive = false;                     /* 9102-9103 */
      s.c1SaveReady = false;                           /* 9104 r_battle.removeEventListener(save) */
      var w = s.c1WorldData;
      var c1 = s.barcodeDataC1;
      var en = w.get_enemy_number();                   /* 9115 */
      var coin = (typeof randOverride === 'number') ? randOverride : Math.floor(Math.random() * 2);
      if (en === 0 || en === 2) {                      /* 9117-9132 魔法使い敵(復活抽選) */
        if (coin === 1) {
          var deadHero = !(c1[4] && c1[4].live) || !(c1[5] && c1[5].live); /* 9120 */
          if (deadHero) {
            return { outcome: 'rebirth_anim', timerDelay: 150, timerRepeat: 20 };
          }
          return this.rebirthEnd(s);                   /* 9126 */
        }
        var be = this.battleEndC1(s);                  /* 9129 */
        s.c1LPowerReady = false;                       /* 9130 */
        return { outcome: 'back_to_battle_end', battleEnd: be };
      }
      if (en === 1 || en === 3) {                      /* 9135-9162 戦士敵(情報抽選) */
        if (coin === 1) {
          if (w.key_number() !== 3) {                  /* 9137 / 9152 */
            return { outcome: 'info_anim', enemyNumber: en, timerDelay: 80, timerRepeat: 70 };
          }
          return { outcome: 'info_skip' };
        }
        var be2 = this.battleEndC1(s);                 /* 9144 / 9159 */
        s.c1LPowerReady = false;                       /* 9145 / 9160 */
        return { outcome: 'back_to_battle_end', battleEnd: be2 };
      }
      var be3 = this.battleEndC1(s);                   /* 9165 */
      s.c1LPowerReady = false;                         /* 9166 */
      return { outcome: 'back_to_battle_end', battleEnd: be3 };
    },

    /* rebirth_end()(9226-9250) の進行相当(工程7-3: 相方復活適用→戦利品獲得待ち再開) */
    rebirthEnd: function (s) {
      if (!s.barcodeDataC1) return null;
      var c1 = s.barcodeDataC1;
      if (s.friendSelectStateC1 === 1) {               /* 9234-9236 魔法使い復活 */
        c1[5] = this.cloneBarcodeData(c1[3]);
      } else {                                         /* 9237-9239 戦士復活 */
        c1[4] = this.cloneBarcodeData(c1[2]);
      }
      s.c1BattleGetActive = true;                      /* 9248-9249 */
      return { outcome: 'rebirth_done', friendSelectStateC1: s.friendSelectStateC1 };
    },

    /* enemy_infomation_end()(9301-9317) の進行相当(工程7-3: 敵情報演出完了→戦利品獲得待ち再開) */
    enemyInfomationEnd: function (s) {
      s.c1BattleGetActive = true;                      /* 9315-9316 */
      return { outcome: 'info_done' };
    },

    /* card_insert_wait_c1_back()(9348-9373) の進行相当(工程7-3: 敗北後に残存仲間へ交代) */
    cardInsertWaitC1Back: function (s) {
      s.c1LoseChoiceActive = false;                    /* 9349-9350 */
      s.friendSelectStateC1 = (s.friendSelectStateC1 === 1) ? 2 : 1; /* 9352-9356 */
      s.state = STATES.CARD_4;                         /* 9357 bb2_state = 7 */
      return {
        friendSelectStateC1: s.friendSelectStateC1,
        state: s.state,
        timerDelay: 80,
        timerRepeat: 20
      };
    },

    /* friend_animation_c1_complete()(9491-9519) の進行相当(工程7-3: 交代演出完了→アイテムカード待ち) */
    friendAnimationC1Complete: function (s) {
      s.c1FriendSelectActive = false;                  /* 9492-9493 */
      s.c1FriendSetReady = false;
      s.state = STATES.CARD_3;                         /* 9506 bb2_state = 6 */
      s.c1ItemWaitActive = true;                       /* 9509 / 9514 */
      return { friendSelectStateC1: s.friendSelectStateC1, state: s.state };
    },

    /* get_mp_pp_c1()(9522-9605) の進行相当(工程7-3: C1 戦利品ボーナス加算・クランプ) */
    getMpPpC1: function (s) {
      if (!s.c1BattleGetActive || !s.c1WorldData || !s.barcodeDataC1 || !s.barcodeDataEnemy) return null;
      s.c1BattleGetActive = false;                     /* 9525-9528 */
      s.c1LPowerReady = false;
      s.c1SaveReady = false;                           /* 9528 r_battle.removeEventListener(save) */
      var w = s.c1WorldData;
      var c1 = s.barcodeDataC1;
      var idx = (s.friendSelectStateC1 === 1) ? 4 : 5;
      var bossEn = w.generate_boss_energy();           /* 9538 */
      var stDf = w.generate_st_df();
      if (bossEn !== -1) {                             /* 9538-9547 ボス */
        c1[idx].hp = c1[idx].hp + bossEn;
        c1[idx].st = c1[idx].st + stDf;
        c1[idx].df = c1[idx].df + stDf;
      } else if (s.barcodeDataEnemy.job <= 6) {        /* 9549-9557 戦士系敵: ST+PP */
        c1[idx].st = c1[idx].st + stDf;
        c1[idx].pp = c1[idx].pp + 5;
      } else {                                         /* 9558-9566 魔法使い系敵: MP+DF */
        if (s.friendSelectStateC1 === 1) {
          c1[4].df = c1[4].df + stDf;
        } else {
          c1[5].mp = c1[5].mp + 5;
          c1[5].df = c1[5].df + stDf;
        }
      }
      if (c1[4]) {                                     /* 9570-9581 */
        if (c1[4].hp > 999) c1[4].hp = 999;
        if (c1[4].st > 199) c1[4].st = 199;
        if (c1[4].df > 199) c1[4].df = 199;
        if (c1[4].pp > 99) c1[4].pp = 99;
      }
      if (c1[5]) {                                     /* 9582-9596 */
        if (c1[5].hp > 999) c1[5].hp = 999;
        if (c1[5].st > 199) c1[5].st = 199;
        if (c1[5].df > 199) c1[5].df = 199;
        if (c1[5].mp > 99) c1[5].mp = 99;
        if (c1[5].pp > 99) c1[5].pp = 99;
      }
      return { timerDelay: 100, timerRepeat: 20, bossEnergy: bossEn, stDf: stDf };
    },

    /* display_mp_pp_c1_complete()(9608-9612) の進行相当(工程7-3: 撃破した敵を削除してステージ選択へ) */
    displayMpPpC1Complete: function (s) {
      if (s.c1WorldData) s.c1WorldData.delete_enemy(); /* 9610 */
      return this.c1StageSelectClick(s);               /* 9611 */
    },

    /* --- Phase 6: セーブ・ロード・クローン(8854-9098, 9666) --- */

    /* save()(8854-8896) の進行相当(Phase 6: r_battle 押下でセーブ演出開始) */
    save: function (s) {
      if (!s.c1SaveReady) return null;
      s.c1SaveReady = false;                           /* 8855 */
      s.c1LPowerReady = false;                         /* 8863 / 8876 */
      s.c1BattleGetActive = false;                     /* 8864-8865 */
      s.c1StageSelectFlag = false;                     /* 8873 */
      s.c1StageSelectActive = false;                   /* 8874-8877 */
      s.c1SaveAnimCompleteReady = false;
      return { timerDelay: 200 };
    },

    /* save_animation_complete()(8942-8958) の進行相当(Phase 6: SET 押下で localStorage 保存＆元の画面へ復帰) */
    saveAnimationComplete: function (s) {
      if (!s.c1SaveAnimCompleteReady) return null;
      s.c1SaveAnimCompleteReady = false;               /* 8943 */
      var saved = false;
      if (BB2.Store && BB2.Store.saveGameC1) {         /* 8950-8955 */
        saved = BB2.Store.saveGameC1(s.c1WorldData, s.barcodeDataC1);
      }
      var target = s.callSaveFunction || 'c1_stage_select_click'; /* 8957 */
      if (target === 'battle_end_c1') {
        var be = this.battleEndC1(s);
        return { saved: saved, target: target, battleEnd: be };
      }
      var stg = this.c1StageSelectClick(s);
      return { saved: saved, target: target, stage: stg };
    },

    /* load()(8961-8991) の進行相当(Phase 6: C1 1枚目待ちで r_battle 押下→ロード演出開始) */
    load: function (s) {
      if (s.mode !== 1 || s.state !== STATES.CARD_1) return null;
      s.c1LoadAnimCompleteReady = false;
      return { timerDelay: 200 };
    },

    /* load_animation_complete()(9037-9067) の進行相当(Phase 6: SET 押下で localStorage から復元→bb2_state=5 でステータス表示へ) */
    loadAnimationComplete: function (s) {
      if (!s.c1LoadAnimCompleteReady) return null;
      s.c1LoadAnimCompleteReady = false;               /* 9038 */
      var loaded = (BB2.Store && BB2.Store.loadGameC1) ? BB2.Store.loadGameC1() : null; /* 9050-9054 */
      s.c1WorldData = loaded ? loaded.c1WorldData : null;
      s.barcodeDataC1 = (loaded && loaded.barcodeDataC1) ? loaded.barcodeDataC1 : [null, null, null, null, null, null, null];
      if (s.barcodeDataC1) {
        s.cards[0] = s.barcodeDataC1[0] || s.barcodeDataC1[4] || null;
        s.cards[1] = s.barcodeDataC1[1] || s.barcodeDataC1[5] || null;
      }
      s.state = STATES.CARD_2;                         /* 9057 bb2_state = 5 */
      return {
        loaded: !!(s.c1WorldData && s.barcodeDataC1 && s.barcodeDataC1[4] && s.barcodeDataC1[5]),
        state: s.state,
        timerDelay: 80,
        timerRepeat: 20
      };
    },

    /* createCloneInstance()(9666-9693) の進行相当(Phase 6: C1WorldData / BarcodeData / 任意オブジェクトの複製) */
    createCloneInstance: function (obj) {
      if (obj === null || obj === undefined) return null; /* 9668-9670 */
      if (BB2.C1WorldData && obj instanceof BB2.C1WorldData) {
        var cw = new BB2.C1WorldData();
        var raw = JSON.parse(JSON.stringify(obj));
        for (var k in raw) {
          if (Object.prototype.hasOwnProperty.call(raw, k)) cw[k] = raw[k];
        }
        return cw;
      }
      if (BB2.BarcodeData && obj instanceof BB2.BarcodeData) {
        return this.cloneBarcodeData(obj);
      }
      return JSON.parse(JSON.stringify(obj));
    },

    /* power_off(136 相当): どの状態からでも 0 に完全初期化。mode=0 リセット(567 行)。元の 136〜200 に
     * barcode_data/fighting_data クリアは確認できないが、HTML 側は保守的に cards・fightingData も初期化。
     * fightingCalc インスタンは元の member 構造上そのまま(136〜200 に生成し直し/クリアは観測できず)。
     * 次回 cycle は 736-739 の lazy ガードで同じインスタンスを使い 752 で decide_star し直しなので protection_star は更新される */
    powerOff: function (s) {
      s.state = STATES.STANDBY; s.mode = 0;
      s.cards = [null, null, null, null];
      s.fightingData = [null, null];
      s.battleWaitingFirst = false;
      s.battleFlag = false;
      s.battlePowerDisableFlag = false;
      s.powerFlag = false;
      s.battleEndCount = 0;
      s.selectMpPp = 1;
      s.selectMpFunction = -2;
      s.selectPpState = -2;
      s.selectMpEnable = false;
      s.selectMagicPpUse = false;
      s.selectActive = false;
      s.restartReady = false;
      s.barcodeDataC2 = [null, null, null, null, null, null, null, null];
      s.passcodeState = 0;
      s.passcode = '';
      s.passcodeActive = false;
      s.c2WaitEnemySet = false;
      s.c2EnemyWaitActive = false;
      s.friendSelectState = 0;
      s.c2FriendSelectActive = false;
      s.c2FriendSetReady = false;
      s.c2ItemWaitActive = false;
      s.c2BattleGetActive = false;
      s.c2PasscodeAvailable = false;
      s.c2ShowPasscodeHold = false;
      s.c2LoseChoiceActive = false;
      s.barcodeDataC1 = [null, null, null, null, null, null, null];
      s.c1WorldData = null;
      s.barcodeDataEnemy = null;
      s.friendSelectStateC1 = 0;
      s.c1CardSkipActive = false;
      s.c1WaitStageSelectSet = false;
      s.c1StageSelectFlag = false;
      s.c1StageSelectActive = false;
      s.c1FriendSelectActive = false;
      s.c1EscapeFromBattleReady = false;
      s.c1FriendSetReady = false;
      s.c1ItemWaitActive = false;
      s.c1PasscodeState = 0;
      s.c1Passcode = '000';
      s.c1PasscodeActive = false;
      s.hadKeyNumber = 0;
      s.hasKeyNumber = 0;
      s.c1BattleGetActive = false;
      s.c1LPowerReady = false;
      s.c1LoseChoiceActive = false;
      s.c1DefeatBossActive = false;
      s.c1ShowPasscodeHold = false;
      s.callSaveFunction = null;
      s.c1SaveReady = false;
      s.c1SaveAnimCompleteReady = false;
      s.c1LoadAnimCompleteReady = false;
      s.shift_card = null;
      return s;
    },

    /* 元表示 "C-"+mode に併合(hp_2p.text — 692 行) */
    modeName: function (s) { return 'C-' + s.mode; },

    /* standby(0)・init 前(-1) を除いて電源 ON 表示 */
    isOn: function (s) { return s.state > STATES.STANDBY; },

    /* カード入力待ち(1〜4枚目)かどうか */
    isCardWait: function (s) {
      return s.state >= STATES.CARD_1 && s.state <= STATES.CARD_4;
    }
  };

  BB2.State = State;
})(typeof window !== 'undefined' ? window : this);
