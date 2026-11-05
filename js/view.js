/* view.js — 表示層(design §2.3 view モジュール相当)
 * core(state.js)を呼ぶが、core は view を呼ばない(一方向依存の原則維持)。
 *
 * 対応(design §1.1/§1.2):
 *  - ImageButtonSprite → <button> + pointerdown/pointerup + .selected(押下表現のみ。意味は仮)
 *  - mx:Application scale → #bb2-stage への CSS transform scale(fit scale × CHANGE_SCALE プラグ)
 *  - 7セグ合成(TextInputSprite)は 2026-11-04 作業6 工程2 で移植(js/textdisplay.js・BB2.Digits)。
 *      仕様確定(design §8 解消・TextInputSprite.as 実測):
 *      disp_val(172-194: String は space 継ぎ・数値は abs+「00」付与で右詰め 5 桁・195→"19500"・199→"19900")
 *      display_str(201-325: 1 列 25×40 の bb2digits PNG 28 種・文字小文字化照合・マッピング外はセル保持)
 *      pp_text(327-341)/mp_text(343-349): value<10 なら space2・以上なら space1 個先頭に付与→String 分支
 *      digits 書き込みは View.setDigit/setMpDigit/setPpDigit 経由(text/mp/pp setter 相当)。
 *  - Timer 演出は 2026-11-04 作業6 工程1 で状態 1〜8 を移植(元 barcode2.as の行番号をコメントに明記)。
 *      - startFx は元 new Timer(delay, repeatCount) の semantics を忠実移植(Adobe livedocs 準拠):
 *        TIMER イベントは delay ms ごとに repeatCount+1 回発生し、その後に完了(=onDone)。
 *        repeatCount 省略(=0)は無制限(select_mode(676)/card_insert_wait(858) など)。
 *      - 演出関数の写し: power_on_animation(623)/select_mode_animation(685)/decide_star_animation(762)/
 *        card_insert_wait_animation(924)/card_insert_animation(1212)/card_skip_animation(1436)/
 *        card_insert_error_animation(1610)/special_down_animation(1836-1886)/
 *        decide_first_player_animation(1928-1952)(工程4 で追加) — digits/label/ライトへの書き込みを忠実に写す。
 *      - 状態遷移は演出完了(TIMER_complete 相当: select_mode(660)/mode_start(790)/
 *        card_insert_next(1461)/card_insert_error_back(1772))で発火する(従来の「演出なし即実行」は廃止)。
 *      - 演出中は元の実装どおり入力受付を止める(CARD_IN 1006-1009・SET 1401 相当。
 *        元 card_insert(1006-1009) に card_skip リスナー解除の行は確認できず — HTML では
 *        演出中の SET 受付を保守的に不可とする(work-log 2026-11-04 工程1 に記録)。
 *        special_down 演出(1836-1886)・先攻決定演出(1928-1952)でも bb2_state 8 では元からカードリスナが
 *        付与されない(1596-1597 で enabled=false 実測)ため同じ理由で受付けない(工程4)。
 *      - SE 再生(se/*.mp3)は未移植(Phase 7)。元の st_X.mp_text/df_X_pp_text(TextInputSprite 7セグ)
 *        相当は 7 セグ移植済み(setMpDigit/setPpDigit)で mp_label/pp_label の表示と合わせて処理。
 *        warrior/magician ラベルの mx enabled 意味(1264-1270 等)は未移植(HTML は visible のみ)。
 *        special_down(1798〜)・CreateFightingData(1520-1607)は 2026-11-04 工程4(演出一体化)で配線:
 *        合成表示(case6 1527-1559・case7 1562-1603)→special_down 演出(1798-1907・State 側本体は State.specialDown)→
 *        先攻決定演出(1913-1952・light1↔light5)→battle_waiting(1957-2035)は 2026-11-05 工程5-1 で接続済
 *        (待機表示・500ms gauge・入力窓 note 接続・battle/power/select/escape/auto/call_battle_end 本体は 5 以降の弧)。
 *        「END」プレースホルダは合成済表示へ置換(防御経路 — 互換ラッパ data 省略時のみ — では維持)。
 *  - 起動時(状態 -1/0)のラベル表示は元 init_bb2/power_off の display 初期化行を未計測。
 *    HTML ではすべての .label を隠す(文書化された仮定・work-log 2026-11-04 工程1 参照)。
 *  - 待機演出 case6/7 の barcode_data[0]/[1].job 参照(961・981)は 1枚目の失敗後に originalが
 *    NPE になる経路を含む可能性があり、HTML は cards[0/1] null 時に warrior 側を表示(防御)。
 */
(function (global) {
  'use strict';

  var BB2 = global.BB2;
  var STAGE_W = 1544, STAGE_H = 795;          /* MXML width/height 実測値 */
  var SCALE_PRESETS = [1, 0.75, 0.5];        /* CHANGE_SCALE 相当(design §1.1: 保存キー scale) */
  /* SoundEffect.as(1-76) の17プロパティと assets/se/*.mp3 対応表(Phase 7-1・card_in_mp3 と power_mp3 は同一ファイル) */
  var SE_SRC = {
    battle_critical_mp3: 'assets/se/battle_critical.mp3',
    critical_mp3: 'assets/se/critical.mp3',
    battle_end_mp3: 'assets/se/battle_end.mp3',
    battle_end_c2_mp3: 'assets/se/battle_end_c2.mp3',
    battle_miss_mp3: 'assets/se/battle_miss.mp3',
    battle_mp3: 'assets/se/battle.mp3',
    card_in_error_mp3: 'assets/se/card_in_error.mp3',
    card_in_mp3: 'assets/se/card_in_power.mp3',
    power_mp3: 'assets/se/card_in_power.mp3',
    change_mp3: 'assets/se/change.mp3',
    decide_first_player_mp3: 'assets/se/decide_first_player.mp3',
    decide_mp3: 'assets/se/decide.mp3',
    miss_mp3: 'assets/se/miss.mp3',
    on_mp3: 'assets/se/on.mp3',
    select_mp3: 'assets/se/select.mp3',
    status_down_mp3: 'assets/se/status_down.mp3',
    passcode_mp3: 'assets/se/passcode.mp3'
  };

  var View = {
    el: {},
    state: null,
    data: null,        /* store.load() の結果 {version, settings, save} */
    scaleIdx: 0,
    sePool: null,      /* Audio インスタンスプール(Phase 7-1) */
    lastSe: null,      /* 直近再生 SE 名(Phase 7-1 テスト・診断用) */
    /* 演出タイマー {id, kind}。kind: power/select/decide/insert/error/skip/wait。
       演出中は digits/label/light を演出側が所有し、render はそれらを書き換えない */
    fx: null,
    /* 工程5-1(2026-11-05): 元 1955 / 1956 の宣言行 battle_waiting_timer・auto_battle_timer は独立 member。
       演出スロット this.fx(decide_first は完了自後片付け済・1960-1965 解放相当)とは別に保つ */
    battleFx: null,      /* gauge Timer(500) 無制限(1996-2000 相当・1996 guard 付き・startBattleGauge) */
    autoFx: null,        /* auto_battle_timer Timer(200,4) の TIMER_COMPLETE 相当(2028-2032 相当・startAutoBattle) */
    battleWin: null,     /* battle_waiting 2005-2034 の listener 割当相当(State.battleWaiting 返し写し) */

    init: function (state, data) {
      this.state = state;
      this.data = data;
      var e = this.el;
      var id = function (name) { return document.getElementById(name); };

      e.stage = id('bb2-stage');
      e.viewport = id('viewport');
      e.card_in = id('card_in');
      e.card_in_button = id('card_in_button');
      e.init_card_reader_button = id('init_card_reader_button');
      e.change_scale_button = id('change_scale_button');
      e.on_off = id('on_off');
      e.select_button = id('select_button');
      e.set_button = id('set_button');
      e.sound_indicator = id('sound_indicator');
      e.auto_input = id('auto_input');
      e.camera_reader = id('camera_reader');
      e.select_image_button = id('select_image_button');
      e.get_camera_button = id('get_camera_button');
      e.video_display = id('video_display');
      e.reader_canvas = id('reader_canvas');
      e.image_file_input = id('image_file_input');
      e.reader_status = id('reader_status');
      e.screen_note = id('screen_note');
      e.status_note = id('status_note');
      e.lights = [id('light1'), id('light2'), id('light3'), id('light4'), id('light5')];
      e.digits = {
        hp_1p: id('hp_1p'), st_1p: id('st_1p'), df_1p: id('df_1p'),
        hp_2p: id('hp_2p'), st_2p: id('st_2p'), df_2p: id('df_2p')
      };
      /* mx:Label 相当(img .label)。元の visible=true/false 相当は hidden 属性で写す。
         battle/escape/power/critical/key/infomation/damage は Phase 4/5 未移植のため常時隠す */
      e.labels = {};
      ['battle_label', 'card_input_label', 'escape_label', 'power_label', 'critical_label',
       'miss_label', 'magician_1p_label', 'warrior_1p_label', 'key_label', 'item_label',
       'infomation_label', 'warrior_2p_label', 'magician_2p_label', 'hp_label', 'damage_label',
       'st_label', 'mp_label', 'df_label', 'pp_label'].forEach(function (name) {
        e.labels[name] = id(name);
      });

      /* 裏技スイッチ(value_shift — 2026-11-04 実測済み・下記配線) */
      var shiftButtons = ['l_power', 'l_battle', 'r_power', 'r_battle'];

      /* 初期設定(保存キー scale / sound_mute / auto_input の復元) */
      var idx = SCALE_PRESETS.indexOf(data.settings.scale);
      this.scaleIdx = idx < 0 ? 0 : idx;
      e.auto_input.checked = !!data.settings.auto_input;

      var S = BB2.State, self = this;

      /* --- 電源(元 power_on(611)/power_off(136) 相当) ---
         元 power_off は演出中に clickable(614 で即 power_off リスナー付与)。OFF は演出停止を伴う(136〜) */
      this.bind(e.on_off, function () {
        if (S.isOn(self.state)) {
          self.stopFx();                              /* 元の 144〜235 の Timer/演出停止相当 */
          self.stopAllSe();                           /* 297 SoundMixer.stopAll() 相当(Phase 7-1) */
          if (BB2.Reader) {
            BB2.Reader.stopCamera(e.video_display);
            BB2.Reader.card_reader_visible = true;
          }
          if (e.camera_reader) e.camera_reader.hidden = true;  /* 元 141 camera_reader.visible = false */
          S.powerOff(self.state);                     /* 完全初期化: 0 に戻す・mode=0 */
          self.note('電源OFF(bb2_state 0・演出停止・元 power_off(136) 相当)');
          self.render();
        } else if (self.state.state === S.STATES.STANDBY) {
          S.powerOn(self.state);                      /* 619 bb2_state=1 */
          self.fxPowerOn();                           /* 615-617 Timer(150,9)+演出開始(忠実) */
          self.render();
        } else {
          self.note('遷移(' + S.modeName(self.state) + ' 以外)中は電源操作できない(元は処理完了待ち)');
        }
      });

      /* --- SELECT(元 inc_mode(708)・select(3187)・select_state(3435)・add_passcode(5492)・add_friend_state(5901)・select_end_state(6433)・card_enemy_insert_wait_c2(6807)) --- */
      this.bind(e.select_button, function () {
        if (self.state.state === S.STATES.MODE_SELECT) {
          self.playSe('select_mp3');                  /* 709 se.select_mp3.play() */
          S.incMode(self.state);                      /* 元の 709-713 と同じく mode だけ変わる(表示は演出の次 tick) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1StageSelectActive) {
          self.fxC1StageEnemySelect();                /* 7540 / 7606-7616 c1_stage_enemy_select(工程7-1) */
          return;
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1PasscodeActive) {
          self.fxC1InputAddPasscode();                /* 8155 / 8194-8217 c1_input_add_passcode(工程7-2) */
          return;
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1FriendSelectActive) {
          self.fxAddFriendStateC1();                  /* 7755 / 7896-7926 add_friend_state_c1(工程7-2) */
          return;
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARD_3 && self.state.passcodeActive) {
          self.fxAddPasscode();                       /* 5388 / 5492-5536 add_passcode(工程6-1) */
          return;
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARD_4 && self.state.c2FriendSelectActive) {
          self.fxAddFriendState();                    /* 4994 / 5901-5931 add_friend_state(工程6-2) */
          return;
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARDS_DONE && self.state.c1BattleGetActive && !self.state.selectMagicPpUse) {
          self.fxSelectEndState();                    /* 8618 / 9248 / 9315 select_end_state(工程7-3) */
          return;
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARDS_DONE && self.state.c1LoseChoiceActive) {
          self.fxC1StageSelectClick();                /* 8695 c1_stage_select_click(工程7-3) */
          return;
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARDS_DONE && self.state.c2BattleGetActive && !self.state.selectMagicPpUse) {
          self.fxSelectEndState();                    /* 6802 / 6433-6494 select_end_state(工程6-3) */
          return;
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARDS_DONE && self.state.c2LoseChoiceActive) {
          self.fxCardEnemyWaitC2();                   /* 6807 card_enemy_insert_wait_c2(工程6-3) */
          return;
        } else if (self.state.state === S.STATES.CARDS_DONE && self.state.selectActive) {
          self.fxSelectState();                       /* 3259 / 3435-3488 select_state(工程5-4) */
          return;
        } else if (self.state.state === S.STATES.CARDS_DONE && self.battleWin) {
          /* 工程5-4: battle_waiting 2013-2014・2024-2025 の select_button listener → select(3187)。cpu 側 2026-2033 は付与なし */
          if (self.battleWin.select) {
            self.fxSelect();
            return;
          }
          self.note('SELECT は battle_waiting 2019-2025 の cpu 側(2026-2033 で listener 付与なし相当・応答なし)');
        } else {
          self.note('SELECT は bb2_state 2(モード選択)・または戦闘中/C2 SELECT 受付時のみ有効');
        }
        self.render();                                /* 演出中は digits を書き換えない(演出側が所有) */
      });

      /* --- SET(元 set_mode(717)・card_skip(1394)・set_state(3491)・restart_mode(2955)・C2 set(4960/5540/5933/5966/6497/6808)) --- */
      this.bind(e.set_button, function () {
        if (self.fx && (self.fx.kind === 'insert' || self.fx.kind === 'error' || self.fx.kind === 'skip')) {
          self.note('SET は演出中(CARD IN 直後)は受付けない(元 1006-1009 相当・HTML は保守的・work-log 2026-11-04)');
          return;
        }
        if (self.state.state === S.STATES.MODE_SELECT) {
          self.playSe('decide_mp3');                  /* 718 se.decide_mp3.play() */
          self.stopFx();                              /* 721-725 select_mode_timer 停止 */
          S.setMode(self.state);                      /* 726 bb2_state=3 */
          self.fxDecideStar();                        /* 727→736: 守護星決定演出開始 */
          self.render();
        } else if (self.state.mode === 1 && self.state.c1SaveAnimCompleteReady) {
          self.fxSaveAnimationComplete();             /* 8922 / 8942-8958 save_animation_complete(Phase 6) */
        } else if (self.state.mode === 1 && self.state.c1LoadAnimCompleteReady) {
          self.fxLoadAnimationComplete();             /* 9017 / 9037-9067 load_animation_complete(Phase 6) */
        } else if (self.state.mode === 1 && (self.state.state === S.STATES.CARD_1 || self.state.state === S.STATES.CARD_2) && self.state.c1CardSkipActive) {
          self.fxCardInsertSkipC1();                  /* 6879 / 7110-7136 card_insert_skip_c1(工程7-1) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1WaitStageSelectSet) {
          self.fxC1StageSelectClick();                /* 7133 / 7203 / 7446-7480 c1_stage_select_click(工程7-1) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1StageSelectActive) {
          self.fxC1StageEnemySet();                   /* 7541 / 7628-7652 c1_stage_enemy_set(工程7-1) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1PasscodeActive) {
          self.fxC1InputSetPasscode();                /* 8156 / 8220-8315 c1_input_set_passcode(工程7-2) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1FriendSetReady) {
          self.fxSetFriendStateC1();                  /* 7925 / 7928-7960 set_friend_state_c1(工程7-2) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARD_3 && self.state.c1ItemWaitActive) {
          self.fxCardInsertNextSetC1();               /* 7954 / 7963-7978 card_insert_next_set_c1(工程7-2) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARDS_DONE && self.state.c1BattleGetActive) {
          self.fxGetMpPpC1();                         /* 8619 / 9249 / 9316 get_mp_pp_c1(工程7-3) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARDS_DONE && self.state.c1LoseChoiceActive) {
          self.fxCardInsertWaitC1Back();              /* 8696 card_insert_wait_c1_back(工程7-3) */
        } else if (self.state.mode === 1 && self.state.state === S.STATES.CARDS_DONE && self.state.c1DefeatBossActive && self.state.c1WorldData && self.state.c1WorldData.select_stage <= 2) {
          self.fxDefeatBossComplete();                /* 8743 defeat_boss_animation_complete(工程7-3) */
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARD_3 && self.state.c2WaitEnemySet) {
          self.fxCardEnemyWaitC2Se();                 /* 4960 / 5288-5302 card_enemy_insert_wait_c2_se(工程6-1) */
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARD_3 && self.state.passcodeActive) {
          self.fxSetPasscode();                       /* 5389 / 5540-5576 set_passcode(工程6-1) */
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARD_4 && self.state.c2FriendSetReady) {
          self.fxSetFriendState();                    /* 5929 / 5933-5963 set_friend_state(工程6-2) */
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARD_4 && self.state.c2ItemWaitActive) {
          self.fxCardInsertNextSetC2();               /* 5955 / 5966-5975 card_insert_next_set_c2(工程6-2) */
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARDS_DONE && self.state.c2BattleGetActive) {
          self.fxGetMpPp();                           /* 6803 / 6497-6709 get_mp_pp(工程6-3) */
        } else if (self.state.mode === 2 && self.state.state === S.STATES.CARDS_DONE && self.state.c2LoseChoiceActive) {
          self.fxCardInsertWaitC2Back();              /* 6808 / 4686-4707 card_insert_wait_c2_back(工程6-3) */
        } else if (self.state.mode === 0 && (self.state.state === S.STATES.CARD_3 || self.state.state === S.STATES.CARD_4)) {
          self.stopFx();                              /* 1403-1407 card_insert_wait_timer 停止 */
          S.saveCard(self.state, null);               /* 1414・1424 barcode_data[2/3]=null(演出開始時) */
          self.fxCardSkip();
          self.render();
        } else if (self.state.state === S.STATES.CARDS_DONE && self.state.selectActive) {
          self.fxSetState();                          /* 3260 / 3491-3569 set_state(工程5-4) */
        } else if (self.state.state === S.STATES.CARDS_DONE && self.state.restartReady) {
          self.fxRestartMode();                       /* 2907 / 2955-2985 restart_mode(工程5-2b) */
        } else {
          self.note('SET は bb2_state 2・6・7・SELECT選択中(3491)・C2進行中・または戦闘終了後 restart_mode 受付中(2907)でのみ有効(元実装どおり)');
        }
      });

      /* --- CARD_IN(button)。元 card_insert(1001〜1169)・card_insert_c2(4800)・card_enemy_insert_c2(5616)・card_item_insert_c2(6013) 相当 --- */
      this.bind(e.card_in_button, function () { self.onCardIn(); });

      /* --- カメラリーダ面板(ActionScript barcode_reader.as / barcode2.as:125・Phase 7-3 で Reader に委譲) --- */

      /* --- CHANGE_SCALE(保存キー scale) fit × プラグ の乗算で適用 --- */
      this.bind(e.change_scale_button, function () {
        self.scaleIdx = (self.scaleIdx + 1) % SCALE_PRESETS.length;
        self.data.settings.scale = SCALE_PRESETS[self.scaleIdx];
        BB2.Store.saveSettings(self.data);
        self.applyScale();
        self.note('scale=' + self.data.settings.scale);
      });

      /* --- サウンド表示切替(元 84-119 sound_mute_load / change_mute_load・Phase 7-1 で SE 再生接続済) --- */
      this.bind(e.sound_indicator, function () {
        self.data.settings.sound_mute = !self.data.settings.sound_mute;
        if (self.data.settings.sound_mute) self.stopAllSe();
        BB2.Store.saveSettings(self.data);
        self.render();
        self.note('sound_mute=' + self.data.settings.sound_mute);
      });

      /* --- auto_input(設定保存のみ。読み取り挙動の再現は Phase 2) --- */
      e.auto_input.addEventListener('change', function () {
        self.data.settings.auto_input = e.auto_input.checked;
        BB2.Store.saveSettings(self.data);
        self.note('auto_input=' + e.auto_input.checked + '(読み取り挙動は未移植 Phase 2)');
      });

      /* --- 裏技スイッチ(value_shift 1173 相当)。元は card_insert 成功時にリスナ付与(1038-1041)し
         card_insert_next 冒頭(1463-1466)で解除 = 受付窓は挿入演出中のみ(演出移植で忠実化済み)。
         shift_card は演出開始(saveCard)で開き演出終了(advanceCardFx)で閉じる。
         shift 値は元 1176-1191 と同じ(l_battle:-2/l_power:-1/r_battle:+1/r_power:+2) */
      var SHIFT = { l_battle: -2, l_power: -1, r_battle: 1, r_power: 2 };
      shiftButtons.forEach(function (name) {
        self.bind(id(name), function () {
          var s = self.state;
          /* 工程5-1: battle_waiting 入力窓の listener 相当(2005-2034)。窓の解除は元 2345-2350(battle() 内 listener 解除・5-2)と
             power off の stopFx で行う(5-1 では过渡 note のため battle() 本体未接続) */
          if (s.state === S.STATES.CARDS_DONE && self.battleWin) { self.battleClick(name); return; }
          if (name === 'l_power' && s.mode === 1 && s.state === S.STATES.CARDS_DONE && s.c1ShowPasscodeHold) {
            self.fxDefeatBoss();                      /* 8747 MOUSE_UP→defeat_boss(工程7-3) */
            return;
          }
          if (name === 'l_power' && s.mode === 1 && s.state === S.STATES.CARDS_DONE && s.c1DefeatBossActive) {
            self.fxShowPasscodeC1();                  /* 8746 CLICK→show_passcode_c1(工程7-3) */
            return;
          }
          if (name === 'l_power' && s.mode === 1 && s.state === S.STATES.CARDS_DONE && s.c1LPowerReady) {
            self.fxBattleEndLPower();                 /* 8616 CLICK→battle_end_l_power(工程7-3) */
            return;
          }
          if (name === 'l_power' && s.mode === 2 && s.state === S.STATES.CARDS_DONE && s.c2ShowPasscodeHold) {
            self.fxBattleEndC2();                     /* 6826 MOUSE_UP→battle_end_c2(工程6-3) */
            return;
          }
          if (name === 'l_power' && s.mode === 2 && s.state === S.STATES.CARDS_DONE && s.c2PasscodeAvailable) {
            self.fxShowPasscode();                    /* 6799 / 6814-6858 show_passcode(工程6-3) */
            return;
          }
          if (name === 'l_power' && s.mode === 1 && s.state === S.STATES.CARD_3 && s.c1StageSelectActive) {
            self.fxCardInsertRetryC1();               /* 7542 / 6865-6881 card_insert_retry_c1(工程7-1) */
            return;
          }
          if (name === 'l_battle' && s.mode === 1 && s.state === S.STATES.CARD_3 && s.c1StageSelectActive) {
            self.fxC1InputPasscode();                 /* 7543 / 8107-8158 c1_input_passcode(工程7-2) */
            return;
          }
          if (name === 'r_power' && s.mode === 1 && s.state === S.STATES.CARD_3 && s.c1EscapeFromBattleReady) {
            self.fxEscapeFromBattle();                /* 7754 / 7761-7789 escape_from_battle(工程7-2) */
            return;
          }
          if (name === 'r_battle' && s.mode === 1 && s.c1SaveReady) {
            self.fxSave();                            /* 7537 / 8615 / 8854-8896 save(Phase 6) */
            return;
          }
          if (name === 'r_battle' && s.mode === 1 && s.state === S.STATES.CARD_1 && (!self.fx || self.fx.kind === 'wait')) {
            self.fxLoad();                            /* 6913 / 8961-8991 load(Phase 6) */
            return;
          }
          if (name === 'l_power' && s.mode === 2 && s.state === S.STATES.CARD_3 && s.c2EnemyWaitActive) {
            self.fxSelectPasscode();                  /* 5356 / 5385-5430 select_passcode(工程6-1) */
            return;
          }
          if (s.shift_card === null) { self.note(name + ': 裏技(value_shift)の受付窓が閉じています(元 1038-1041 で付与・1463-1466 で解除 — 挿入演出中のみ)。次のカード入力で窓は閉じます'); return; }
          var card = s.cards[s.shift_card];
          var reader = new BB2.BarcodeRead();
          reader.init(card ? card.barcode : '', 1, null, SHIFT[name]);  /* 元 1198・1203。失敗時 null 代入も元と同じ */
          S.valueShift(s, reader.barcode_data);
          self.note(name + ': 裏技 shift ' + SHIFT[name] + ' を ' + (s.shift_card + 1) + '枚目に適用');
          self.render();
        });
      });

      /* 6827 l_power MOUSE_OUT→battle_end_c2(工程6-3)・8748 l_power MOUSE_OUT→defeat_boss(工程7-3) */
      id('l_power').addEventListener('pointerleave', function () {
        var s = self.state;
        if (s.mode === 2 && s.state === S.STATES.CARDS_DONE && s.c2ShowPasscodeHold) {
          self.fxBattleEndC2();
        } else if (s.mode === 1 && s.state === S.STATES.CARDS_DONE && s.c1ShowPasscodeHold) {
          self.fxDefeatBoss();
        }
      });

      /* リサイズで再 fit */
      global.addEventListener('resize', function () { self.applyScale(); });

      /* 48: barcode_reader_init()(Phase 7-3 カメラ・画像リーダー初期化) */
      if (BB2.Reader && typeof BB2.Reader.init === 'function') {
        BB2.Reader.init(this);
      }

      /* 49: barcode_cards_init()(Phase 7-2 カードブラウザ初期化) */
      if (BB2.Cards && typeof BB2.Cards.initBrowser === 'function') {
        BB2.Cards.initBrowser(this);
      }

      this.render();
      this.applyScale();
      return this;
    },

    /* --- CARD_IN 実行本体(手動ボタン押下・または Reader の Immediately 自動入力から呼出)
       元 card_insert(1001〜1169)・card_insert_c2(4800)・card_enemy_insert_c2(5616)・card_item_insert_c2(6013) 相当 --- */
    onCardIn: function () {
      var self = this;
      var S = BB2.State;
      var s = this.state;
      var e = this.el;
      if (!S.isCardWait(s)) { this.note('CARD_IN は bb2_state 4〜7(カード待ち)でのみ有効'); this.render(); return; }
      if (this.fx && this.fx.kind !== 'wait') {     /* 待機演出は受付可(元 875-917 でリスナ付与済み)・それ中は不可(1006-1009) */
        this.note('演出中(insert/error/skip)は CARD IN 受付けない(元 1006-1009 相当)');
        return;
      }
      if (s.mode === 1) {
        if (s.state === S.STATES.CARD_1 || s.state === S.STATES.CARD_2) {
          this.fxCardInsertTriggerC1();             /* 6976-7105 card_insert_c1(工程7-1) */
          return;
        }
        if (s.state === S.STATES.CARD_3 && s.c1ItemWaitActive) {
          this.fxCardItemInsertTriggerC1();         /* 7949 / 8016-8101 card_item_insert_c1(工程7-2) */
          return;
        }
        this.note('C1 モードの現在の状態では CARD_IN リスナーは未付与です');
        return;
      }
      if (s.mode === 2) {
        if (s.state === S.STATES.CARD_1 || s.state === S.STATES.CARD_2) {
          this.fxCardInsertTriggerC2();             /* 4800-4902 card_insert_c2(工程6-1) */
          return;
        }
        if (s.state === S.STATES.CARD_3 && s.c2EnemyWaitActive) {
          this.fxCardEnemyInsertTriggerC2();        /* 5616-5670 card_enemy_insert_c2(工程6-1) */
          return;
        }
        if (s.state === S.STATES.CARD_4 && s.c2ItemWaitActive) {
          this.fxCardItemInsertTriggerC2();         /* 6013-6062 card_item_insert_c2(工程6-2) */
          return;
        }
        this.note('C2 モードの現在の状態では CARD_IN リスナーは未付与です');
        return;
      }
      this.stopFx();                                /* 1013-1016 card_insert_wait_timer 停止 */
      var before = s.state;                          /* 4/5/6/7 = 1〜4枚目待ち(演出の分支は元の bb2_state と同じ) */
      var barcode = e.card_in.value;
      var reader = new BB2.BarcodeRead();
      var ret = (before === S.STATES.CARD_1 || before === S.STATES.CARD_2)
        ? reader.init(barcode, 1)                    /* 元 1023・1066 */
        : reader.init(barcode, 2, s.cards[before === S.STATES.CARD_3 ? 0 : 1]);  /* 元 1110・1141(1枚目/2枚目のデータと合体) */
      if (ret) {
        S.saveCard(s, reader.barcode_data);          /* 1026・1067・1114 保存+1・2枚目は 1038-1041 相当の裏技窓 open */
        var d = reader.barcode_data;
        if (before === S.STATES.CARD_1) {            /* 元 1029-1035(job<=6 なら warrior/>6 なら magician) */
          this.label('warrior_1p_label', d.job <= 6); this.label('magician_1p_label', d.job > 6);
        } else if (before === S.STATES.CARD_2) {     /* 元 1071-1075(2P 側) */
          this.label('warrior_2p_label', d.job <= 6); this.label('magician_2p_label', d.job > 6);
        }
        if (before === S.STATES.CARD_3 || before === S.STATES.CARD_4) {   /* 元 1114-1115(4枚目は 1143-1148 未計測・3枚目相当とみなす) */
          this.label('item_label', true);
        }
        this.label('card_input_label', false);       /* 元 1041・1115 */
        this.note('カード ' + (before - 3) + '枚目入力成功 HP=' + d.hp + ' ST=' + d.st + ' DF=' + d.df +
          ' job=' + d.job + '(job<=6 なら warrior)>6 なら magician — 元 1029〜1035)・挿入演出(Timer 80ms×' +
          (before === S.STATES.CARD_1 || before === S.STATES.CARD_2 ? '20' : '40') + ' — 元 1044・1088・1118・1149)');
        this.fxCardInsert(before, reader.barcode_data);
      } else {
        /* 元 1050-1064・1094-1102・1125-1131・1156-1163: ラベルを隠し barcode_data[idx]=reader.barcode_data を保存 */
        if (before === S.STATES.CARD_1 || before === S.STATES.CARD_3) {
          this.label('magician_1p_label', false); this.label('warrior_1p_label', false);
        } else {
          this.label('magician_2p_label', false); this.label('warrior_2p_label', false);
        }
        S.cardInputFailed(s, reader.barcode_data);   /* 失敗時もデータ保持(元 1057 相当・null 含む)・error_back(1772) 相当で状態不変 */
        this.note('カード ' + (before - 3) + '枚目入力失敗(無効なバーコード書式)。元 error_back(1772) 相当で bb2_state ' +
          s.state + ' のまま再受付・エラー演出(Timer 150ms×6 — 元 1055・1099・1129・1163)');
        this.fxCardError(before, reader.barcode_data);
      }
      this.render();
    },

    /* --- 演出タイマー(元 flash.utils.Timer の忠実移植) -------------------------------------
       new Timer(delay, repeatCount): TIMER は delay ms ごとに repeatCount+1 回発生し(Adobe livedocs 準拠)、
       その後に TIMER_complete(onDone)。repeatCount 省略(=0)は無制限。 */

    clearFx: function () {
      if (this.fx) { global.clearInterval(this.fx.id); this.fx = null; }
    },

    stopFx: function () {
      this.clearFx();
      /* 工程5-1: 電源OFF(144-235 の Timer/演出停止相当・HTML は保守的。元の解放経路 2047-2051・2067-2071 は
         escape 側(C1・Phase 5)と battle_end 弧(5-2b)で未接続のまま) */
      if (this.battleFx) { global.clearInterval(this.battleFx.id); this.battleFx = null; }   /* battle_waiting_timer(1955)相当 */
      if (this.autoFx) { global.clearTimeout(this.autoFx.id); this.autoFx = null; }          /* auto_battle_timer(1956)相当 */
      this.battleWin = null;                                                                 /* 入力窓 2005-2034 相当 */
    },

    startFx: function (kind, delay, repeat, onTick, onDone) {
      var self = this;
      this.clearFx();                                  /* battleFx(1996-2000 gauge)は維持し単発演出タイマー(this.fx)のみ入れ替える(元 2340/2659-2672 と整合) */
      var max = repeat > 0 ? repeat + 1 : -1;          /* TIMER 発生回数(repeat+1)・-1 は無制限 */
      var n = 0;
      this.fx = { kind: kind, id: 0 };
      this.fx.id = global.setInterval(function () {
        n++;
        onTick.call(self, n);                          /* 演出関数の this=View(this.el を使うため) */
        if (max > 0 && n >= max) {
          var done = onDone;
          self.clearFx();                              /* TIMER_complete 前の自後片付け(元の removeEventListener+stop+null 相当) */
          if (done) done.call(self);
        }
      }, delay);
    },

    /* --- SE 再生(SoundEffect.as 1-76・barcode2.as 84-119 sound_mute_load / change_mute_load・Phase 7-1) --- */
    playSe: function (name) {
      var src = SE_SRC[name];
      if (!src) return false;
      if (this.data && this.data.settings && this.data.settings.sound_mute) return false;
      this.lastSe = name;
      if (typeof Audio !== 'undefined') {
        if (!this.sePool) this.sePool = {};
        try {
          var a = this.sePool[name];
          if (!a) {
            a = new Audio(src);
            this.sePool[name] = a;
          } else {
            a.pause();
            a.currentTime = 0;
          }
          var p = a.play();
          if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) {}
      }
      return true;
    },

    stopAllSe: function () {
      if (!this.sePool) return;
      var pool = this.sePool;
      Object.keys(pool).forEach(function (k) {
        try {
          pool[k].pause();
          pool[k].currentTime = 0;
        } catch (e) {}
      });
    },

    /* 電源オン演出開始(元 power_on(611) が Timer(150,9) を開始する箇所相当) */
    fxPowerOn: function () {
      var self = this;
      this.playSe('on_mp3');                           /* 612 se.on_mp3.play() */
      this.startFx('power', 150, 9, function (n) {     /* 元 623-655 power_on_animation */
        var d = this.el.digits, c = n % 3;
        if (c === 0) {                                 /* 626-633(case0) */
          this.setDigit(d.hp_1p, ' 00');   this.setDigit(d.st_1p, '');   this.setDigit(d.df_1p, '   00');
          this.setDigit(d.hp_2p, '   00'); this.setDigit(d.st_2p, '');   this.setDigit(d.df_2p, ' 00');
        } else if (c === 1) {                          /* 636-643(case1) */
          this.setDigit(d.hp_1p, '');      this.setDigit(d.st_1p, ' 0000'); this.setDigit(d.df_1p, '');
          this.setDigit(d.hp_2p, '');      this.setDigit(d.st_2p, ' 0000'); this.setDigit(d.df_2p, '');
        } else {                                       /* 645-652(case2) */
          this.setDigit(d.hp_1p, '   00'); this.setDigit(d.st_1p, '');   this.setDigit(d.df_1p, ' 00');
          this.setDigit(d.hp_2p, ' 00');   this.setDigit(d.st_2p, '');   this.setDigit(d.df_2p, '   00');
        }
      }, function () { self.fxSelectMode(); });
    },

    /* 電源演出完了→モード選択(元 select_mode(660 相当・TIMER_complete で呼ばれる)。
       662-666 の自後片付けは startFx 完了側・668-674 をここで写す */
    fxSelectMode: function () {
      var s = this.state, S = BB2.State, self = this;
      S.powerOnComplete(s);                            /* 681 bb2_state=2 */
      this.clearDigits();                              /* 元 668-673 */
      this.setLight(2, true);                          /* 元 674 light3.selected=true */
      this.startFx('select', 150, 0, function (n) {    /* 元 676-678 Timer(150) 無制限 + 685-705 演出 */
        var modeText = S.modeName(s);
        this.setDigit(this.el.digits.hp_2p, (n % 2 === 1) ? modeText : 'C-');
      }, null);
      this.note('電源ON完了→モード選択(bb2_state 2・演出点滅中・元 select_mode(660) 相当・SE 再生は未移植 Phase 7)');
      this.render();
    },

    /* 守護星決定演出(元 decide_star(736)。737-739 lazy 生成+749-752 実計算(rand は Math.random — js/fighting_calc.js
       の decideStar 78-88 移植済・実測値 0=レトフ(陸)/1=セターン(空)/2=ラト(海))を演出開始前に 1 回
       State.rollProtectionStar 経由で実行(工程4)・741-746 の static 書き込み + Timer(150,13) 点滅演出) */
    fxDecideStar: function () {
      var s = this.state, self = this;
      BB2.State.rollProtectionStar(s);                 /* 752 相当(737-739 の lazy 生成相当は State.ensureFightingCalc) */
      this.clearDigits();
      this.setDigit(this.el.digits.hp_2p, BB2.State.modeName(s));  /* 元 744 */
      this.startFx('decide', 150, 13, function (n) {   /* 元 754-757 Timer(150,13) + 762-788 演出 */
        var c = n % 3;
        var e = this.el.lights;
        e[1].classList.remove('lit'); e[2].classList.remove('lit'); e[3].classList.remove('lit');
        if (c === 1) { e[1].classList.add('lit'); }     /* 元 766-771(light2) */
        else if (c === 2) { e[2].classList.add('lit'); } /* 元 772-778(light3) */
        else { e[3].classList.add('lit'); }              /* 元 779-785(light4) */
      }, function () { self.fxModeStart(); });
    },

    /* 守護星演出完了→モード開始(元 mode_start(790 相当。795-798 の自後片付けは startFx 完了側で済・800-827 守護星点灯・
       829-850 mode 分岐は C0 のみ実装(C1/C2 分岐は未接続のまま)) */
    fxModeStart: function () {
      var s = this.state, S = BB2.State;
      S.decideStarComplete(s);                         /* 833(bb2_state+1) */
      /* 800-827 相当の実値点灯(元は switch(fighting_calc.protection_star) — 752 で決定済の実測値をそのまま使う。
          0=レトフ(陸)→light2・1=セターン→light3・2=ラト→light4。light2 プレースホルダ(固定点灯)は工程4 で解消 */
      this.setLightAll();
      var ps = s.fightingCalc ? s.fightingCalc.protection_star : 0;   /* 元 800 の fighting_calc プロパティ直参照相当 */
      this.setLight(ps + 1, true);                     /* 802-827(0→light2(index1)・1→light3(index2)・2→light4(index3)) */
      this.playSe('decide_mp3');                       /* 832 / 839 / 846 se.decide_mp3.play() */
      if (s.mode === 1) {                              /* 837-842 C1 モード分岐(工程7-1) */
        this.fxCardWaitC1();
      } else if (s.mode === 2) {                       /* 844-849 C2 モード分岐(工程6-1) */
        this.fxCardWaitC2();
      } else {
        this.fxCardWait();                             /* 834(card_insert_wait()) */
      }
      this.note('モード確定→1枚目待ち(bb2_state 4・mode=' + s.mode + '・元 mode_start(790) 相当・守護星 ' +
        ps + '(' + ['retov(land)/light2', 'setan/light3', 'ratto(umi)/light4'][ps] + ') 点灯)');
      this.render();
    },

    /* カード入力待ち演出(元 card_insert_wait(856) 相当。Timer(500) 無制限 + 863-918 の static 表示) */
    fxCardWait: function () {
      var s = this.state, S = BB2.State, self = this;
      if (!S.isCardWait(s)) return;
      this.startFx('wait', 500, 0, function (n) {      /* 元 858-860 Timer(500) 無制限 + 924-995 演出 */
        var c = n % 2, st = this.state.state;
        if (st === S.STATES.CARD_1) {                  /* 元 928-938 */
          this.label('card_input_label', c === 0);
          this.label('warrior_1p_label', c === 0);
          this.label('magician_1p_label', c === 0);
        } else if (st === S.STATES.CARD_2) {           /* 元 941-951 */
          this.label('card_input_label', c === 0);
          this.label('warrior_2p_label', c === 0);
          this.label('magician_2p_label', c === 0);
        } else if (st === S.STATES.CARD_3) {           /* 元 954-971 */
          if (c === 1) {
            this.label('warrior_1p_label', false); this.label('magician_1p_label', false);
            this.label('card_input_label', false); this.label('item_label', false);
          } else {
            var bd = this.state.cards[0];              /* 元 961-967(barcode_data[0].job — null 時は HTML 防御で warrior) */
            var j = bd ? bd.job <= 6 : true;
            this.label('warrior_1p_label', j); this.label('magician_1p_label', !j);
            this.label('card_input_label', true); this.label('item_label', true);
          }
        } else {                                       /* 元 974-991(4枚目・2P 側) */
          if (c === 1) {
            this.label('warrior_2p_label', false); this.label('magician_2p_label', false);
            this.label('card_input_label', false); this.label('item_label', false);
          } else {
            var bd2 = this.state.cards[1];             /* 元 981-987 */
            var j2 = bd2 ? bd2.job <= 6 : true;
            this.label('warrior_2p_label', j2); this.label('magician_2p_label', !j2);
            this.label('card_input_label', true); this.label('item_label', true);
          }
        }
      }, null);
      /* 元の 863-918 static 表示(case4/5 のみ digits へ「 ==」・case6/7 は書き込みなし) */
      var d = this.el.digits;
      if (s.state === S.STATES.CARD_1) {               /* 元 866-874 */
        this.setDigit(d.hp_1p, ' =='); this.setDigit(d.st_1p, ' =='); this.setDigit(d.df_1p, ' ==');
        this.setDigit(d.hp_2p, ''); this.setDigit(d.st_2p, ''); this.setDigit(d.df_2p, '');
        this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);
      } else if (s.state === S.STATES.CARD_2) {        /* 元 885-887 */
        this.setDigit(d.hp_2p, ' =='); this.setDigit(d.st_2p, ' =='); this.setDigit(d.df_2p, ' ==');
      }
    },

    /* カード挿入演出(元 card_insert 成功 1024-1044 相当。Timer(80,20) or (80,40)・演出は card_insert_animation(1212-1389)) */
    fxCardInsert: function (before, data) {
      var self = this;
      this.playSe('card_in_mp3');                      /* 1027 / 1070 / 1114 / 1145 se.card_in_mp3.play() */
      var repeat = (before === BB2.State.STATES.CARD_1 || before === BB2.State.STATES.CARD_2) ? 20 : 40;  /* 元 1044・1088・1118・1149 */
      this.startFx('insert', 80, repeat, function (n) { this.insertAnim(before, n); }, function () { self.fxCardNext(); });
    },

    insertAnim: function (before, n) {
      var s = this.state, d = this.el.digits, count = n % 2;
      if (before === BB2.State.STATES.CARD_1) {         /* 元 1219-1229(1P 側点滅) */
        var t = count === 1 ? ' ==' : '';
        this.setDigit(d.hp_1p, t); this.setDigit(d.st_1p, t); this.setDigit(d.df_1p, t);
        return;
      }
      if (before === BB2.State.STATES.CARD_2) {         /* 元 1231-1242(2P 側点滅) */
        var t2 = count === 1 ? ' ==' : '';
        this.setDigit(d.hp_2p, t2); this.setDigit(d.st_2p, t2); this.setDigit(d.df_2p, t2);
        return;
      }
      /* 3・4枚目は「点滅表示」(currentCount<=20)と「入力パラメータ表示」に分かれる(元 1246/1281/1317/1354)。
         3枚目の値は 2P 側・4枚目の値は 1P 側へ表示する元の癖(1247-1312・1317-1385)を忠実に写す */
      var card = (before === BB2.State.STATES.CARD_3) ? s.cards[2] : s.cards[3];   /* 元 barcode_data[2]/[3] */
      var prev = (before === BB2.State.STATES.CARD_3) ? s.cards[0] : s.cards[1];   /* 元 barcode_data[0]/[1] */
      var side = (before === BB2.State.STATES.CARD_3) ? '2p' : '1p';               /* 表示される面 */
      var prevSide = (before === BB2.State.STATES.CARD_3) ? '1p' : '2p';           /* 元 1255-1256・1327-1328 の面 */
      if (n <= 20) {
        /* 点滅表示(元 1247-1279)。薬草アップ・MPアップ判定は元の race==9 && job>6(1249) */
        if (card && card.race === 9 && card.job > 6) {
          this.label('hp_label', true); this.label('st_label', false); this.label('df_label', false);
          this.label('mp_label', true); this.label('pp_label', true);
          if (prev) {
            /* 元 1255-1256・1327-1328: prev カードの mp/pp を st_X.mp_text/df_X_pp_text(7セグ)に表示。
               7 セグ合成移植済み(textdisplay.js)・setMpDigit/setPpDigit は mp_text(343-349)/
               pp_text(331-341) setter 相当(space 前付後 String 分支で末尾 space 継ぎ) */
            this.setMpDigit(d['st_' + prevSide], prev.mp);
            this.setPpDigit(d['df_' + prevSide], prev.pp);
          }
        } else {
          this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);
          this.label('mp_label', false); this.label('pp_label', false);
        }
        /* 元 1264-1270 の warrior/magician の mx enabled 意味は未移植(可視性は待機演出 961-987 で扱う) */
        var blink = count === 1 ? ' ==' : '';
        if (before === BB2.State.STATES.CARD_3) {      /* 元 1271-1279(3枚目は 2P 側点滅) */
          this.setDigit(d.hp_2p, blink); this.setDigit(d.st_2p, blink); this.setDigit(d.df_2p, blink);
        } else {                                       /* 元 1344-1352(4枚目は 1P 側点滅) */
          this.setDigit(d.hp_1p, blink); this.setDigit(d.st_1p, blink); this.setDigit(d.df_1p, blink);
        }
      } else {
        /* 入力パラメータ表示(元 1281-1312・1354-1384) */
        var D = { hp: d['hp_' + side], st: d['st_' + side], df: d['df_' + side] };
        if (card && card.race === 9 && card.job > 6) {   /* 元 1283-1294・1356-1367(mp を st 欄・pp を df 欄へ。mp_text/pp_text setter 相当で描画) */
          this.setDigit(D.hp, '');
          this.setMpDigit(D.st, card.mp > 0 ? card.mp : '');
          this.setPpDigit(D.df, card.pp > 0 ? card.pp : '');
        } else if (card) {                               /* 元 1295-1311・1368-1384(hp は切上げなし・st/df は 199 切上げ・数値は disp_val で 00 付与=195→"19500"・199→"19900") */
          this.setDigit(D.hp, card.hp !== 0 ? card.hp : '');
          this.setDigit(D.st, card.st !== 0 ? ((card.st > 199) ? 199 : card.st) : '');
          this.setDigit(D.df, card.df !== 0 ? ((card.df > 199) ? 199 : card.df) : '');
        }
      }
    },

    /* 挿入演出完了→次枚目待ち(元 card_insert_next(1461-1607) 相当。1463-1466 リスナ解除・switch の bb2_state++。
       表示書き込み: case4 1484-1488(bd0→1P)・case5 1502-1506(bd1→2P)・case6 1519-1559(ラベル 1521-1525・合成 1527-1535 を
       1531-1533 で 1P 欄へ・job ラベル 1536-1542・2P 欄は 2枚目の値 1544-1547・1559 card_insert_wait())・
       case7 1562-1603(ラベル 1564-1570・合成 1572-1576 を 1573-1575 で 2P 欄へ・job ラベル 1577-1583・1585-1587 1P 欄は
       1527 合成済の値・1601-1602 で fighting_calc.fighting_data 接続+special_down 呼び出し)。
       合成そのもの(CreateFightingData.init 1527・1572・1601 接続)は State 側(advanceCardFx・工程4)で実施済 */
    fxCardNext: function () {
      var s = this.state, S = BB2.State;
      var before = s.state;                              /* bb2_state++ 前の 4-7(元 switch の分支と同じ) */
      S.advanceCardFx(s);                                /* 1463-1466(裏技窓解除)+bb2_state++・合成 1527/1572・1601 */
      /* 元 1490-1516: card_in.text はクリアされず直前値が保持される(同一カードの 1P/2P 連続入力に対応) */
      this.el.camera_reader.hidden = true;               /* 元 1492・1508・1551・1591 card_reader_visible=false */
      var d = this.el.digits;
      if (before === S.STATES.CARD_1 || before === S.STATES.CARD_2) {   /* 元 case4(1484-1488)・case5(1501-1506) */
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, s.cards[0]);   /* 1486-1488 相当(case5 では 1P 継続表示 — 同じ値を書き直す) */
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, s.cards[1]);   /* case4 は null で空欄・case5 は 1504-1506 */
        if (S.isCardWait(s)) {                           /* 元 1498・1516 card_insert_wait() 再開 */
          this.fxCardWait();
          this.note('演出完了→' + (s.state - 3) + '枚目待ち(bb2_state ' + s.state + '・元 card_insert_next(1461) 相当)');
        }
      } else if (before === S.STATES.CARD_3) {          /* 元 case6(1519-1559) */
        this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);   /* 1521-1523 */
        this.label('mp_label', false); this.label('pp_label', false);                                /* 1524-1525 */
        var fd0 = s.fightingData[0];
        var j0 = fd0 ? fd0.job <= 6 : (s.cards[0] ? s.cards[0].job <= 6 : true);   /* 1536-1542(fd.job=1枚目の job — CreateFightingData 89)。合成防御時は view ヘッダ 32-33 と同じ方針 */
        this.label('warrior_1p_label', j0); this.label('magician_1p_label', !j0);
        if (fd0) this.showCard(d.hp_1p, d.st_1p, d.df_1p, fd0);     /* 1531-1533(1P 欄=1枚+3枚の合成値・fd は 999/199 クランプ済 — 1532 の追クランプ相当を showCard 側で同じ形で行う) */
        if (fd0) this.showCard(d.hp_2p, d.st_2p, d.df_2p, s.cards[1]);  /* 1544-1547(2P 欄=2枚目の素の値・合成はまだ 2P 側へは行われない) */
        this.fxCardWait();                               /* 1559 */
        this.note('演出完了→3枚目合成(1527 相当・1P=1枚+3枚)表示→4枚目待ち(bb2_state ' + s.state + '・元 case6 相当)');
      } else {                                          /* 元 case7(1562-1603) */
        this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);   /* 1564-1566 */
        this.label('mp_label', false); this.label('pp_label', false);                                /* 1567-1568 */
        this.label('item_label', false); this.label('card_input_label', false);                      /* 1569-1570 */
        var fd1 = s.fightingData[1], fd0c = s.fightingData[0];
        var j1 = fd1 ? fd1.job <= 6 : (s.cards[1] ? s.cards[1].job <= 6 : true);   /* 1577-1583(fd1.job=2枚目の job) */
        this.label('warrior_2p_label', j1); this.label('magician_2p_label', !j1);
        if (fd1) this.showCard(d.hp_2p, d.st_2p, d.df_2p, fd1);     /* 1573-1575(2P 欄=2枚+4枚の合成値) */
        if (fd0c) this.showCard(d.hp_1p, d.st_1p, d.df_1p, fd0c);   /* 1585-1587(1P 欄=1527 合成済の値を継続表示) */
        if (fd0c && fd1) {
          this.note('演出完了→入力終了(bb2_state 8)・1601 相当(fc.fighting_data 接続済)→special_down(1798) 連鎖へ');
          var hasDown = S.specialDown(s);              /* 1602 相当(State 側本体 1798-1832 移植済) */
          this.fxAfterSpecialDown(hasDown);
        } else {
          this.note('合成防御経路(スロットの data が null・元は同経路で NPE になり得る・HTML の互換ラッパ data 省略時だけで・実機ではない): ' +
            'special_down(1798)/decide_first(1913) 連鎖をスキップ・bb2_state 8 継続表示');
        }
      }
      this.render();
    },

    /* special_down()(1798-1832)の演出分岐相当(1824-1826 の判定を State.specialDown が返しで受ける):
       ダウン flag あり → Timer(250,14)(1828-1832 相当・演出は special_down_animation 1836-1886)
       全 flag false → 演出なしで decide_first_player(10)(1826 相当・wait 10 の先攻演出) */
    fxAfterSpecialDown: function (hasDown) {
      var self = this;
      if (hasDown) {
        this.note('special_down 演出: ダウン flag あり(1824 相当)→Timer 250ms×14 点滅(1828-1831 相当・currentCount<4 非発生 1839-1841・SE status_down は 1842-1844 Phase 7 未接続)');
        this.startFx('specialdown', 250, 14, function (n) { this.specialDownAnim(n); }, function () { self.fxSpecialDownComplete(); });
      } else {
        this.note('special_down: 全 down flag false(1824-1825 相当)→演出なし→元 1826 の decide_first_player(10) 相当');
        this.fxDecideFirst(10);
      }
    },

    /* special_down_animation(1836-1886) 相当。currentCount<4 非発生(1839-1841)・currentCount==5 で SE(1842-1844・
       se.status_down_mp3 は Phase 7 未接続)・count 1(奇数)で " =="・count 0(偶数)で ''(1846・1865)。
       ダウン flag のある欄だけ書き換え・flag 無しの欄は合成値の表示を続ける(1847-1884 の元の癖) */
    specialDownAnim: function (n) {
      var fd = this.state.fightingData, d = this.el.digits;
      if (n < 4) return;                                   /* 1839-1841 */
      if (n === 5) { this.playSe('status_down_mp3'); }     /* 1842-1844: se.status_down_mp3.play() */
      var t = (n % 2 === 1) ? ' ==' : '';
      if (fd[0].down_hp_flag) this.setDigit(d.hp_1p, t);   /* 1847-1849(奇)・1866-1868(偶) */
      if (fd[0].down_st_flag) this.setDigit(d.st_1p, t);   /* 1850-1852・1869-1871 */
      if (fd[0].down_df_flag) this.setDigit(d.df_1p, t);   /* 1853-1855・1872-1874 */
      if (fd[1].down_hp_flag) this.setDigit(d.hp_2p, t);   /* 1856-1858・1875-1877 */
      if (fd[1].down_st_flag) this.setDigit(d.st_2p, t);   /* 1859-1861・1878-1880 */
      if (fd[1].down_df_flag) this.setDigit(d.df_2p, t);   /* 1862-1864・1881-1883 */
    },

    /* special_down_complete(1889-1907) 相当。自後片付け(1891-1896 の removeEventListener+stop+null)は startFx 完了側で済・
       6 欄すべてへ最終値を書き込む(1898-1903・flag 有無に関係なく hp/st/df 全部・数値は disp_val 相当の固定表記)・
       元 1905 の se.decide_first_player_mp3.play()・1906 の decide_first_player(0) 相当へ(wait 0 の演出 —
       SE は 1905 側ですでに再生済扱い・1935 の SE 条件は wait 0 では currentCount==repeatCount-15 が成立せず非発生 — その元の癖) */
    fxSpecialDownComplete: function () {
      var fd = this.state.fightingData, d = this.el.digits;
      this.setDigit(d.hp_1p, fd[0].hp); this.setDigit(d.st_1p, fd[0].st); this.setDigit(d.df_1p, fd[0].df);   /* 1898-1900 */
      this.setDigit(d.hp_2p, fd[1].hp); this.setDigit(d.st_2p, fd[1].st); this.setDigit(d.df_2p, fd[1].df);   /* 1901-1903 */
      this.playSe('decide_first_player_mp3');              /* 1905 se.decide_first_player_mp3.play() */
      this.note('special_down 完了→最終値(hp/st/df 欄の 1P・2P 全 6 枠)書き込み(1898-1903 相当)→元 1906 の decide_first_player(0) 相当');
      this.fxDecideFirst(0);
    },

    /* decide_first_player()(1913-1925)相当 + decide_first_player_animation(1928-1952)相当。
       本体(1916 の decide_first_player() 計算・1919 battle_waiting_first=true)は State 側で済(1913-1925 は bb2_state を変えない —
       実測で bb2_state 行なし)。演出は Timer(200, waitCount+15(1918)) の light1↔light5 点滅(1939-1951)。
       1932-1934 のガード: currentCount < repeatCount-15 は非発生・== で SE(1935-1937)。
       wait=10: 点滅は count 10 以降・wait=0: 点滅は count 1 以降(SE 条件は非発生 — 1905 側済扱い)。
       TIMER_COMPLETE → 元 1922 の battle_waiting()(1957)。State.battleWaiting(工程5-1 接続済)を呼び、
       1982-1993 表示・gauge・配線は view 側 fxBattleWaiting・bb2_state は 8 のまま */
    fxDecideFirst: function (waitCount) {
      var s = this.state, self = this;
      BB2.State.decideFirst(s);                            /* 1916(fc.decide_first_player() — now_player に 1=1P 側・2=2P 側を決める・コイントラ 107 含む)+1919 */
      var repeat = waitCount + 15;                         /* 1918(timer_count) */
      this.startFx('decidefirst', 200, repeat, function (n) {   /* 元 1920-1923 の Timer(200, timer_count)+演出 */
        var guard = repeat - 15;                           /* 1932-1934 相当 */
        if (n < guard) return;
        if (n === guard) { this.playSe('decide_first_player_mp3'); } /* 1935-1937: se.decide_first_player_mp3.play()。wait 0 経路では n==0 が起こらず非発生 */
        this.setLightAll();                                /* 1939-1951: 奇数→light1・偶数→light5(他消灯) */
        if (n % 2 === 1) { this.setLight(0, true); } else { this.setLight(4, true); }
      }, function () {
        /* 元 1922 TIMER_COMPLETE→battle_waiting()(1957)。1919 の battleWaitingFirst=true 代入は decideFirst(State 側)で済・
           1960-1965 の decide_first_timer 解放は startFx 完了側自後片付けで済。1967-1978 gate の HP<=0 分岐は
           call_battle_end()(2161・本体未移植 5-2)过渡 note 相当(元 1970/1975 の return 相当で 1982 以降・gauge・配線を行わず) */
        var r = BB2.State.battleWaiting(s);
        if (!r) {
          self.note('battle_waiting 防御: fightingData/fightingCalc 未接続(合成防御経路・view 側 fxCardNext の連鎖スキップと連動・実機では接続済)');
          self.render();
          return;
        }
        if (r.battleEnd) {
          self.fxCallBattleEnd();                            /* 1970/1975 call_battle_end()(2161・工程5-2b) */
          return;
        }
        self.fxBattleWaiting(r);                           /* 1982-2034 相当(view 側接続) */
      });
      this.note('先攻決定演出開始(bb2_state 8 継続・Timer 200ms×' + repeat + '(1918 相当) light1↔light5 点滅・元 1913-1925 相当)');
    },

    /* battle_waiting()(1957-2035) view 接続(工程5-1・2026-11-05)。
       1982-1987 欄実値(元 direct 代入・showCard 側 199 クランプは追加せず — fd は合成/special_down 済値)。
       1988-1993 ラベル・1996-2000 gauge(this.battleFx・Timer(500) 無制限)・2002-2004/2015-2017 light1/light5
       (light2-4 は元から書き換えなし・守護星点灯継続)・2005-2034 入力窓 listener(过渡 note・battleClick/SELECT)・
       2026-2033 auto_battle_timer(startAutoBattle)。bb2_state は 8 のまま */
    fxBattleWaiting: function (r) {
      var s = this.state, fd = s.fightingData, d = this.el.digits;
      this.battleWin = r;                            /* 2005-2034 の listener 割当相当 */
      this.setDigit(d.hp_1p, fd[0].hp); this.setDigit(d.st_1p, fd[0].st); this.setDigit(d.df_1p, fd[0].df);   /* 1982-1984 */
      this.setDigit(d.hp_2p, fd[1].hp); this.setDigit(d.st_2p, fd[1].st); this.setDigit(d.df_2p, fd[1].df);   /* 1985-1987 */
      this.label('hp_label', true); this.label('damage_label', false);   /* 1988-1989 */
      this.label('st_label', true); this.label('mp_label', false);       /* 1990-1991 */
      this.label('df_label', true); this.label('pp_label', false);       /* 1992-1993 */
      if (r.nowPlayer === 1) { this.setLight(0, true); this.setLight(4, false); }   /* 2002-2004(1P 側・light1 selected・light5 selected=false) */
      else { this.setLight(0, false); this.setLight(4, true); }                     /* 2015-2017(2P 側) */
      this.startBattleGauge();                       /* 1996-2000 Timer(500) 無制限 */
      if (r.autoCpu) this.startAutoBattle();         /* 2026-2033(cpu 側) */
      this.note('battle_waiting 待機接続(bb2_state 8 継続・元 1957-2035 相当・先攻 now_player=' + r.nowPlayer + ' 側 ' +
        (r.nowPlayer === 1 ? 'light1 点灯・light5 消灯(2003-2004)' : 'light1 消灯・light5 点灯(2016-2017)') +
        '・欄実値(1982-1987)・hp/st/df ラベル ON・damage/mp/pp OFF(1988-1993)・gauge 500ms 交互・' +
        (r.cpu ? 'cpu 側のため battle/power/select 付与なし(2019-2025)・auto 側接続注記(2026-2033・5-5)'
               : '入力窓 note 接続(l_battle/r_battle→battle 5-2・l_power/r_power→power 5-3・SELECT→select 5-4)' +
                 (r.escape ? '・r_power に escape 相当(C1・2010-2012・Phase 5 未接続)' : '・C0 のため escape 付与なし(2010 の mode==1 相当 faithful skip)')) + ')');
    },

    startBattleGauge: function () {
      if (this.battleFx) return;                     /* 1996 guard if(!battle_waiting_timer) 相当(再入時 gauge 継続)。解放 2047-2051・2067-2071 は escape 側(C1 Phase 5)と battle 弧(5-2 以降)で未接続のまま・HTML は電源OFF時 stopFx で解放(保守) */
      var self = this;
      this.battleFx = { id: 0, n: 0 };
      this.battleFx.id = global.setInterval(function () {
        self.battleFx.n++;                           /* 元 2313 currentCount%2 を n%2 で写し(n=1 開始・1998 TIMER listener 相当) */
        self.battlePowerAnim(self.battleFx.n);
      }, 500);                                       /* 1997 Timer(500) 無制限 */
    },

    /* battle_power_animation(2301-2333) の gauge 写し。元 flags(2338・3735・2990)は State フィールド过渡写し。
       2303 早期 return(battlePowerDisableFlag true)。2306-2311 固定(battleFlag・powerFlag の代入元 battle() 2342・
       power() 2992 以降は 5-2/5-3 で未接続のため 5-1 では false 継続 → 2312-2332 の交互経路)。
       2314-2316(n%2==1)・2317-2331(n==0 は pp_ignore_flag 照合 2319-2326・true 側 power_label false)。 */
    battlePowerAnim: function (n) {
      var s = this.state, fd = s.fightingData, fc = s.fightingCalc;
      if (s.battlePowerDisableFlag) return;          /* 2303-2305 */
      if (s.battleFlag) {                            /* 2306-2308 */
        this.label('battle_label', true); this.label('power_label', false);
      } else if (s.powerFlag) {                      /* 2309-2311 */
        this.label('battle_label', false); this.label('power_label', true);
      } else if (n % 2 === 1) {                      /* 2314-2316 */
        this.label('battle_label', true); this.label('power_label', false);
      } else {                                       /* 2317-2331 */
        this.label('battle_label', false);
        var ign = (fc && fc.now_player === 1) ? fd[0].pp_ignore_flag : fd[1].pp_ignore_flag;   /* 2319 */
        this.label('power_label', !ign);             /* 2320-2324・2326-2330 */
      }
    },

    /* 2026-2033 cpu 側 auto_battle_timer(元 1956 の宣言行・2029-2031 Timer(200,4)・2030 は TIMER COMPLETE のみ)。
       Timer(200,4) は livedocs semantics で 5 発生後完了(5×200ms=1000ms)→ auto_battle_cpu(2101-2158・工程5-5b で接続) */
    startAutoBattle: function () {
      if (this.autoFx) return;                       /* 2028 guard */
      var self = this;
      this.autoFx = { id: global.setTimeout(function () {
        self.fxAutoBattleCpu();
      }, 1000) };
    },

    /* auto_battle_cpu(2101-2158) view 接続(工程5-5b)。
       2102-2106: auto_battle_timer 解放(autoFx = null)。
       2108-2157: State.autoBattleCpu(s) で 0〜9(f0〜f9)・10(battle)・11(power) へ分岐 */
    fxAutoBattleCpu: function () {
      this.autoFx = null;                            /* 2102-2106 */
      var r = BB2.State.autoBattleCpu(this.state);
      if (!r) return;
      if (r.action >= 0 && r.action <= 9) {          /* 2109-2147 */
        this.fxUseMagic(r.action);
      } else if (r.action === 10) {                  /* 2149-2151 */
        this.fxBattle();
      } else if (r.action === 11) {                  /* 2153-2155 */
        this.fxPower();
      }
    },

    /* battle_waiting の入力窓 listener 相当(2005-2034)。
       窓の解除元は battle() 2345-2350(工程5-2a 接続済)と電源OFFの stopFx。
       power(2992 は 5-3)・select(3187 は 5-4)・escape(2038-2079 は C1/C2・Phase 5)・auto_battle_cpu(2101 は 5-5) */
    battleClick: function (name) {
      var w = this.battleWin, side1 = w.nowPlayer === 1;
      var isL = (name === 'l_battle' || name === 'l_power'), isR = (name === 'r_battle' || name === 'r_power');
      if (name === 'r_power' && w.escape) {          /* 2010-2012(C1・mode==1 のとき r_power に逃走窓 → escape 2038-2079・工程7-2) */
        this.fxEscape();
        return;
      }
      if (!((side1 && isL) || (!side1 && isR))) {    /* 2002-2034 の listener 割当相当(自側面外は付与なし) */
        this.note(name + ' は battle_waiting で listener 付与なし(現在先攻 1P 側は l_* のみ・2P 側は r_* のみ・応答なし)');
        return;
      }
      if (w.cpu) { this.note('2019-2025 の cpu ゲートで battle/power/select 付与なし(r_battle/r_power 側・応答なし)・auto 側は startAutoBattle 接続済(2028-2032)'); return; }
      if ((side1 && name === 'l_battle') || (!side1 && name === 'r_battle')) {   /* 2005 l_battle / 2020 r_battle → battle()(2340) */
        this.fxBattle();
        return;
      }
      if (w.power) {                                 /* 2006-2008 l_power / 2021-2023 r_power → power()(2992) */
        this.fxPower();
        return;
      }
      this.note(name + ' は battle_waiting 2006-2008/2021-2023 の pp_ignore_flag ゲートで listener 付与なし(応答なし・gauge 継続)');
    },

    /* battle()(2340-2434) view 接続(工程5-2a・2026-11-05)。
       2342-2428 の計算と battleFlag/battleEndCount 設定は State.battle。
       2343-2344 battle_label=true / power_label=false。
       2345-2350 l_battle/r_battle/l_power/r_power/escape/select listener 解除(this.battleWin=null)。
       2410-2413 damage_label=true / hp・st・df_label=false。
       2429-2432 Timer(40, time) → battle_animation(2437) / TIMER_COMPLETE → battle_complete(2657) */
    fxBattle: function () {
      var s = this.state, self = this;
      this.battleWin = null;                         /* 2345-2350 listener 解除 */
      var r = BB2.State.battle(s);
      if (!r) return;
      this.playSe(r.hit ? (r.critical ? 'battle_critical_mp3' : 'battle_mp3') : 'battle_miss_mp3'); /* 2368-2377 / 2395-2403 */
      this.label('battle_label', true); this.label('power_label', false);               /* 2343-2344 */
      this.label('damage_label', true);                                                 /* 2410 */
      this.label('hp_label', false); this.label('st_label', false); this.label('df_label', false);   /* 2411-2413 */
      this.startFx('battle', 40, r.time, function (n) {                                 /* 2429-2432 Timer(40, time) */
        this.battleAnim(n);
      }, function () {
        self.fxBattleComplete();
      });
      this.note('battle 開始(now_player=' + r.nowPlayer + '・hit=' + r.hit + '・critical=' + r.critical +
        '・damage=' + r.displayDamage + '・Timer 40ms×' + r.time + '(end_count=' + r.battleEndCount + ')・元 2340-2434 相当)');
    },

    /* battle_animation(2437-2652) 相当(工程5-2a)。
       n <= battleEndCount: 攻撃側の光線巡回(light 0..4 または 4..0)と '-'/' -'/'  -'/'' 表示(2489-2650)。
       n > battleEndCount: 全 light 消灯(2443-2447)・light_count<=4 で critical/miss ラベルと display_damage 表示、
         >4 でラベル false と空文字点滅(2448-2486) */
    battleAnim: function (n) {
      var s = this.state, fd = s.fightingData, fc = s.fightingCalc, d = this.el.digits;
      var lightCount = n % 10;                       /* 2439 */
      var side1 = (fc.now_player === 1);
      if (n > s.battleEndCount) {                    /* 2442-2487 ダメージ表示フェーズ */
        this.setLightAll();                          /* 2443-2447 */
        var crit = fc.criticalHit(side1 ? fd[0] : fd[1]);   /* 2450 / 2468 */
        var hpEl = side1 ? d.hp_1p : d.hp_2p;
        if (lightCount <= 4) {                       /* 2451 / 2469 */
          if (crit) this.label('critical_label', true);     /* 2453-2455 / 2471-2473 */
          this.setDigit(hpEl, fc.display_damage);           /* 2457 / 2474 */
          if (fc.display_damage === 0) this.label('miss_label', true);   /* 2459-2461 / 2476-2478 */
        } else {                                     /* 2462-2466 / 2480-2484 */
          this.label('critical_label', false);
          this.label('miss_label', false);
          this.setDigit(hpEl, '');
        }
        return;
      }
      var bucket = Math.floor(lightCount / 2);       /* 0,1→0 / 2,3→1 / 4,5→2 / 6,7→3 / 8,9→4 */
      this.setLightAll();
      if (side1) {                                   /* 2489-2569(1P 攻撃) */
        this.setLight(bucket, true);                 /* 2491-2536 */
        var bar1 = lightCount <= 2 ? '-' : (lightCount <= 5 ? ' -' : (lightCount <= 8 ? '  -' : ''));   /* 2538-2568 */
        this.setDigit(d.hp_1p, bar1); this.setDigit(d.st_1p, ''); this.setDigit(d.df_1p, '');
      } else {                                       /* 2570-2650(2P 攻撃) */
        this.setLight(4 - bucket, true);             /* 2571-2616 */
        var bar2 = lightCount <= 2 ? '  -' : (lightCount <= 5 ? ' -' : (lightCount <= 8 ? '-' : ''));   /* 2618-2648 */
        this.setDigit(d.hp_2p, bar2); this.setDigit(d.st_2p, ''); this.setDigit(d.df_2p, '');
      }
    },

    /* battle_complete(2657-2739) view 接続(工程5-2a)。
       2677-2693: アイテム破壊ありなら Timer(250,10) で fxItemBroke へ。
       2695-2738: ターン交代後の light1/light5 点灯・miss/critical/damage ラベル消灯・hp/st/df ラベル点灯 → battle_waiting 再入 */
    fxBattleComplete: function (precomputed) {
      var s = this.state;
      var r = precomputed || BB2.State.battleComplete(s);
      if (!r) return;
      if (r.itemBroken) {                            /* 2683-2692 */
        this.playSe('status_down_mp3');              /* 2685 se.status_down_mp3.play() */
        this.fxItemBroke();
        return;
      }
      this.setLightAll();                            /* 2697-2701 / 2719-2723 */
      this.setLight(r.nowPlayer === 2 ? 4 : 0, true);
      this.playSe('change_mp3');                     /* 2704 / 2726 se.change_mp3.play() */
      this.label('miss_label', false);               /* 2707 / 2729 */
      this.label('critical_label', false);           /* 2708 / 2730 */
      this.label('damage_label', false);             /* 2709 / 2731 */
      this.label('hp_label', true);                  /* 2710 / 2732 */
      this.label('st_label', true);                  /* 2711 / 2733 */
      this.label('df_label', true);                  /* 2712 / 2734 */
      var w = BB2.State.battleWaiting(s);            /* 2714 / 2736 */
      if (!w) return;
      if (w.battleEnd) {                             /* 1967-1978 gate: HP<=0 → call_battle_end()(2161・工程5-2b) */
        this.fxCallBattleEnd();
        return;
      }
      this.fxBattleWaiting(w);
    },

    /* item_broke_animation_timer(2686-2690: Timer(250,10)) → item_broke_animation(2741-2806) / item_broke_complete(2809-2834) */
    fxItemBroke: function () {
      var self = this;
      this.startFx('itembroke', 250, 10, function (n) {
        this.itemBrokeAnim(n);
      }, function () {
        self.fxItemBrokeComplete();
      });
      this.note('アイテム破壊演出開始(Timer 250ms×10・元 2684-2691 / 2741-2806 相当)');
    },

    itemBrokeAnim: function (n) {
      var fd = this.state.fightingData, fc = this.state.fightingCalc, d = this.el.digits;
      var count = n % 2;                             /* 2743 */
      var hp1 = fd[0].hp, st1 = fd[0].st, df1 = fd[0].df;   /* 2745-2747 */
      var hp2 = fd[1].hp, st2 = fd[1].st, df2 = fd[1].df;   /* 2748-2750 */
      var blink = (count === 0) ? ' ==' : '';        /* 2752 / 2772 */
      if (fc.now_player === 1) {                     /* 2753-2761 / 2773-2781 */
        if (fd[0].race2 === 5 && !fd[0].st_item_broke_flag) st1 = blink;
        if (fd[1].race2 === 7 && !fd[1].df_item_broke_flag) df2 = blink;
      } else {                                       /* 2762-2771 / 2782-2791 */
        if (fd[1].race2 === 5 && !fd[1].st_item_broke_flag) st2 = blink;
        if (fd[0].race2 === 7 && !fd[0].df_item_broke_flag) df1 = blink;
      }
      this.setDigit(d.hp_1p, hp1); this.setDigit(d.st_1p, st1); this.setDigit(d.df_1p, df1);   /* 2794-2796 */
      this.setDigit(d.hp_2p, hp2); this.setDigit(d.st_2p, st2); this.setDigit(d.df_2p, df2);   /* 2797-2799 */
      this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);         /* 2800-2802 */
      this.label('damage_label', false); this.label('mp_label', false); this.label('pp_label', false);  /* 2803-2805 */
    },

    fxItemBrokeComplete: function () {
      var r = BB2.State.itemBrokeComplete(this.state);   /* 2809-2833(減算・フラグ更新 + battle_complete 再呼出) */
      this.fxBattleComplete(r);
    },

    /* call_battle_end()(2161-2297) view 接続(工程5-2b・2026-11-05)。
       2163-2167: battle_waiting_timer 停止・null 化(this.battleFx 解放)。
       2169-2173: 全 light 消灯。
       2174-2181: battle/power/miss/critical/damage ラベル false・hp/st/df ラベル true。
       2183-2194: mode==0(C0) は Timer(120, 15) → battle_end_animation(2838) → COMPLETE: battle_end(2898)。
       2196-2294: mode==1/2(C1/C2) は Phase 5 過渡 note 併記のうえ共通の battle_end_animation へ接続 */
    fxCallBattleEnd: function () {
      var s = this.state, self = this;
      if (this.battleFx) { global.clearInterval(this.battleFx.id); this.battleFx = null; }   /* 2163-2167 */
      if (this.autoFx) { global.clearTimeout(this.autoFx.id); this.autoFx = null; }
      this.battleWin = null;
      this.setLightAll();                            /* 2169-2173 */
      this.label('battle_label', false);             /* 2174 */
      this.label('power_label', false);              /* 2175 */
      this.label('miss_label', false);               /* 2176 */
      this.label('critical_label', false);           /* 2177 */
      this.label('damage_label', false);             /* 2178 */
      this.label('hp_label', true);                  /* 2179 */
      this.label('st_label', true);                  /* 2180 */
      this.label('df_label', true);                  /* 2181 */
      var info = BB2.State.callBattleEnd(s);
      if (!info) return;
      if (info.mode === 2) {                         /* 2245-2295(工程6-3) */
        this.playSe(info.c2BothDead ? 'battle_end_mp3' : 'battle_end_c2_mp3'); /* 2268 / 2280 */
        this.note('call_battle_end 開始(C2・敗北側 now_player=' + info.nowPlayer + '・c2BothDead=' + info.c2BothDead +
          '・Timer 120ms×15・元 2245-2295 相当)');
      } else if (info.mode === 1) {                  /* 2196-2243(工程7-3) */
        this.playSe(info.c1BothDead ? 'battle_end_mp3' : 'battle_end_c2_mp3'); /* 2218 / 2230 */
        this.note('call_battle_end 開始(C1・敗北側 now_player=' + info.nowPlayer + '・c1BothDead=' + info.c1BothDead +
          '・Timer 120ms×15・元 2196-2243 相当)');
      } else {
        this.playSe('battle_end_mp3');               /* 2186 se.battle_end_mp3.play() */
        this.note('call_battle_end 開始(C0・敗北側 now_player=' + info.nowPlayer + '・勝者=' + info.winner +
          'P・Timer 120ms×15・元 2161-2194 相当)');
      }
      this.startFx('battleend', info.timerDelay, info.timerRepeat, function (n) {   /* 2189-2192 / 2271-2274 / 2287-2290 Timer(120, 15) */
        this.battleEndAnim(n);
      }, function () {
        if (info.mode === 2 && !info.c2BothDead) {
          self.fxBattleEndC2();                      /* 2289 battle_end_c2 */
        } else if (info.mode === 1 && !info.c1BothDead) {
          self.fxBattleEndC1();                      /* 2239 battle_end_c1 */
        } else {
          self.fxBattleEnd();                        /* 2191 / 2223 / 2273 battle_end */
        }
      });
    },

    /* battle_end_animation(2838-2894) 相当(工程5-2b)。
       now_player==2(1P 勝利・2P 敗北): 1P 欄は常時 hp/st/df 表示、2P 欄は n<=10 かつ偶数で hp=0, st, df、奇数および n>10 で空欄。
       now_player!=2(2P 勝利・1P 敗北): 2P 欄は常時 hp/st/df 表示、1P 欄は n<=10 かつ偶数で hp=0, st, df、奇数および n>10 で空欄 */
    battleEndAnim: function (n) {
      var fd = this.state.fightingData, fc = this.state.fightingCalc, d = this.el.digits;
      var win1 = (fc.now_player === 2);              /* 2843 / 2862 / 2878 */
      var showZero = (n <= 10 && (n % 2 === 0));     /* 2842 / 2861 */
      if (win1) {
        this.setDigit(d.hp_1p, fd[0].hp); this.setDigit(d.st_1p, fd[0].st); this.setDigit(d.df_1p, fd[0].df);
        if (showZero) {                              /* 2866-2868 */
          this.setDigit(d.hp_2p, 0); this.setDigit(d.st_2p, fd[1].st); this.setDigit(d.df_2p, fd[1].df);
        } else {                                     /* 2847-2849 / 2882-2884 */
          this.setDigit(d.hp_2p, ''); this.setDigit(d.st_2p, ''); this.setDigit(d.df_2p, '');
        }
      } else {
        this.setDigit(d.hp_2p, fd[1].hp); this.setDigit(d.st_2p, fd[1].st); this.setDigit(d.df_2p, fd[1].df);
        if (showZero) {                              /* 2873-2875 */
          this.setDigit(d.hp_1p, 0); this.setDigit(d.st_1p, fd[0].st); this.setDigit(d.df_1p, fd[0].df);
        } else {                                     /* 2854-2856 / 2889-2891 */
          this.setDigit(d.hp_1p, ''); this.setDigit(d.st_1p, ''); this.setDigit(d.df_1p, '');
        }
      }
    },

    /* battle_end()(2898-2915) + end_text_animation(2917-2952) view 接続(工程5-2b)。
       2907: set_button に restart_mode 受付付与(State.battleEnd で restartReady=true)。
       2910-2912: Timer(150) 無制限で勝者側 hp/st/df 表示・敗北側 hp 欄に "End" 点滅 */
    fxBattleEnd: function () {
      var s = this.state;
      BB2.State.battleEnd(s);                        /* 2907 restartReady = true */
      this.startFx('endtext', 150, 0, function (n) { /* 2910-2912 Timer(150) 無制限 */
        this.endTextAnim(n);
      }, null);
      this.note('戦闘終了(battle_end 2898-2915)・"End" 点滅中(150ms)・SET ボタンで restart_mode(2955) 再スタート受付中');
    },

    endTextAnim: function (n) {
      var fd = this.state.fightingData, fc = this.state.fightingCalc, d = this.el.digits;
      var count = n % 2;                             /* 2918 */
      var win1 = (fc.now_player === 2);              /* 2920 / 2936 */
      var endStr = (count === 0) ? 'End' : '';       /* 2924 / 2931 / 2940 / 2947 */
      if (win1) {
        this.setDigit(d.hp_1p, fd[0].hp); this.setDigit(d.st_1p, fd[0].st); this.setDigit(d.df_1p, fd[0].df);
        this.setDigit(d.hp_2p, endStr); this.setDigit(d.st_2p, ''); this.setDigit(d.df_2p, '');
      } else {
        this.setDigit(d.hp_2p, fd[1].hp); this.setDigit(d.st_2p, fd[1].st); this.setDigit(d.df_2p, fd[1].df);
        this.setDigit(d.hp_1p, endStr); this.setDigit(d.st_1p, ''); this.setDigit(d.df_1p, '');
      }
    },

    /* restart_mode()(2955-2985) view 接続(工程5-2b)。
       2958: restart_mode listener 解除(State.restartMode)。
       2959-2963: end_text_animation_timer 停止・null 化(this.clearFx)。
       2966-2973(mode==0): magician/warrior 4 ラベル false・bb2_state=4・card_insert_wait()(fxCardWait)。
       2975-2982(mode==2): C2 ラベル切替・bb2_state=4・card_insert_wait_c2(Phase 5 未接続) */
    fxRestartMode: function () {
      var s = this.state;
      this.clearFx();                                /* 2959-2963 */
      var ok = BB2.State.restartMode(s);             /* 2958 + 2971/2980 bb2_state = 4 */
      if (!ok) return;
      this.playSe('decide_mp3');                     /* 2956 se.decide_mp3.play() */
      if (s.mode === 0) {                            /* 2966-2973 */
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', false);
        this.label('warrior_2p_label', false);
        this.label('magician_2p_label', false);
        this.fxCardWait();                           /* 2972 card_insert_wait() */
        this.note('restart_mode(2955-2973): C0 再スタート→1枚目待ち(bb2_state 4)');
      } else if (s.mode === 1) {                     /* 2970-2974(工程7-3: card_insert_wait_c1 接続) */
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', true);
        this.label('warrior_2p_label', false);
        this.label('magician_2p_label', true);
        this.fxCardWaitC1();                         /* 2973 card_insert_wait_c1() */
        this.note('restart_mode(2970-2974): C1 再スタート→1枚目(戦士)待ち(bb2_state 4)');
      } else if (s.mode === 2) {                     /* 2975-2982(工程6-3: card_insert_wait_c2 接続) */
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', true);
        this.label('warrior_2p_label', false);
        this.label('magician_2p_label', true);
        this.fxCardWaitC2();                         /* 2981 card_insert_wait_c2() */
        this.note('restart_mode(2975-2982): C2 再スタート→1枚目(戦士)待ち(bb2_state 4)');
      }
      this.render();
    },

    /* power()(2992-3029) view 接続(工程5-3・2026-11-05)。
       2994 power_flag=true・3005-3016 basic_power 算出と display_power 代入は State.power。
       2995-2996 battle_label=false / power_label=true。
       2997-3002 l_battle/r_battle/l_power/r_power/escape/select listener 解除(this.battleWin=null)。
       3018-3021 damage/hp/st/df ラベル false。
       3023-3028 Timer(80, 40) → power_animation(3032) / COMPLETE → power_complete(3141) */
    fxPower: function () {
      var s = this.state, self = this;
      this.battleWin = null;                         /* 2997-3002 listener 解除 */
      var r = BB2.State.power(s);
      if (!r) return;
      this.label('battle_label', false);             /* 2995 */
      this.label('power_label', true);               /* 2996 */
      this.label('damage_label', false);             /* 3018 */
      this.label('hp_label', false);                 /* 3019 */
      this.label('st_label', false);                 /* 3020 */
      this.label('df_label', false);                 /* 3021 */
      this.startFx('powerheal', r.timerDelay, r.timerRepeat, function (n) {   /* 3024-3027 Timer(80, 40) */
        this.powerAnim(n);
      }, function () {
        self.fxPowerComplete();
      });
      this.note('power 開始(now_player=' + r.nowPlayer + '・hasPp=' + r.hasPp +
        (r.hasPp ? '・display_power=' + r.displayPower : '・薬草0個') + '・Timer 80ms×40・元 2992-3029 相当)');
    },

    /* power_animation(3032-3138) 相当(工程5-3)。
       3037-3038 battle_label=false / power_label=true。
       pp > 0(回復アニメーション 3042-3065 / 3090-3112):
         hp_label=true, st/df_label=false。相手側の欄(1P 時は 2P 欄・2P 時は 1P 欄)の hp に n<=20 で " =="/"" 交互、n>20 で display_power 表示(st/df は空欄)。
       pp <= 0(薬草0個アニメーション 3067-3087 / 3114-3134):
         hp/st/df_label=false, pp_label=true。全欄空にし、n%4===0 のときだけ相手側 df 欄に pp_text=0 表示 */
    powerAnim: function (n) {
      var fd = this.state.fightingData, fc = this.state.fightingCalc, d = this.el.digits;
      var count = n % 2, failCount = n % 4;          /* 3034-3035 */
      var side1 = (fc.now_player === 1);             /* 3040 / 3088 */
      var att = side1 ? fd[0] : fd[1];
      this.label('battle_label', false);             /* 3037 */
      this.label('power_label', true);               /* 3038 */
      if (att.pp > 0) {                              /* 3042-3065 / 3090-3112 */
        if (n === 1) { this.playSe('power_mp3'); }   /* 3044 / 3092 se.power_mp3.play() */
        this.label('hp_label', true);
        this.label('st_label', false);
        this.label('df_label', false);
        var oppHp = side1 ? d.hp_2p : d.hp_1p;
        var oppSt = side1 ? d.st_2p : d.st_1p;
        var oppDf = side1 ? d.df_2p : d.df_1p;
        if (n <= 20) {                               /* 3050-3059 / 3097-3106 */
          this.setDigit(oppHp, (count === 0) ? ' ==' : '');
          this.setDigit(oppSt, '');
          this.setDigit(oppDf, '');
        } else {                                     /* 3060-3064 / 3107-3111 */
          this.setDigit(oppHp, fc.display_power);
          this.setDigit(oppSt, '');
          this.setDigit(oppDf, '');
        }
      } else {                                       /* 3067-3087 / 3114-3134(薬草0個アニメーション) */
        this.label('hp_label', false);
        this.label('st_label', false);
        this.label('df_label', false);
        this.label('pp_label', true);
        this.setDigit(d.hp_1p, ''); this.setDigit(d.st_1p, '');
        this.setDigit(d.hp_2p, ''); this.setDigit(d.st_2p, '');
        if (side1) {                                 /* 3072-3086 */
          this.setDigit(d.df_1p, '');
          if (failCount === 0) this.setPpDigit(d.df_2p, 0);   /* 3078 df_2p.pp_text = 0 */
          else this.setDigit(d.df_2p, '');                    /* 3085 df_2p.text = "" */
        } else {                                     /* 3119-3133 */
          this.setDigit(d.df_2p, '');
          if (failCount === 0) this.setPpDigit(d.df_1p, 0);   /* 3125 df_1p.pp_text = 0 */
          else this.setDigit(d.df_1p, '');                    /* 3132 df_1p.text = "" */
        }
      }
    },

    /* power_complete()(3141-3175) view 接続(工程5-3)。
       3143-3148: power_timer 解放は clearFx で済。
       3150-3174: State.powerComplete で HP 加算・PP 減算・now_player 反転(pp>0 時)・battleWaitingFirst=false → battle_waiting 再入 */
    fxPowerComplete: function () {
      var s = this.state;
      var r = BB2.State.powerComplete(s);
      if (!r) return;
      var w = BB2.State.battleWaiting(s);            /* 3160 / 3172 */
      if (!w) return;
      if (w.battleEnd) {
        this.fxCallBattleEnd();
        return;
      }
      this.fxBattleWaiting(w);
    },

    /* select()(3187-3262) view 接続(工程5-4)。
       3193-3195: battle_waiting の 3 リスナー解除(battleWin = null)。
       3202-3260: State.select(s) で selectMpPp=1, selectMpFunction=-2, selectPpState=-2, powerFlag=true, selectMpEnable, selectActive=true を設定。
       3206-3211: select_animation_timer = new Timer(150)(無限リピート 0) → selectAnim。
       3215-3257: ラベル・7セグ初期表示(1P / 2P・job<=6 の戦士と魔法使い分岐)を元どおりに反映 */
    fxSelect: function () {
      var self = this, s = this.state, d = this.el.digits;
      this.battleWin = null;                         /* 3193-3195 */
      var r = BB2.State.select(s);
      if (!r) return;
      this.label('battle_label', false);             /* 3215 */
      this.label('power_label', true);               /* 3216 */
      this.label('hp_label', true);                  /* 3217 */
      this.label('damage_label', false);             /* 3218 */
      this.label('st_label', false);                 /* 3219 */
      this.label('df_label', false);                 /* 3220 */
      this.label('pp_label', true);                  /* 3221 */
      this.label('mp_label', r.selectMpEnable);      /* 3234 / 3239 / 3250 / 3255 */
      if (r.nowPlayer === 1) {                       /* 3224-3240 */
        this.setDigit(d.hp_1p, r.hp);
        this.setPpDigit(d.df_1p, r.pp);
        this.setDigit(d.hp_2p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_2p, '');
        if (r.selectMpEnable) this.setMpDigit(d.st_1p, r.mp);
        else this.setDigit(d.st_1p, '');
      } else {                                       /* 3241-3257 */
        this.setDigit(d.hp_2p, r.hp);
        this.setPpDigit(d.df_2p, r.pp);
        this.setDigit(d.hp_1p, '');
        this.setDigit(d.st_1p, '');
        this.setDigit(d.df_1p, '');
        if (r.selectMpEnable) this.setMpDigit(d.st_2p, r.mp);
        else this.setDigit(d.st_2p, '');
      }
      this.startFx('select', 150, 0, function (n) {  /* 3206-3211 Timer(150) */
        self.selectAnim(n);
      });
      this.note('select 開始(now_player=' + r.nowPlayer + '・selectMpEnable=' + r.selectMpEnable +
        '・Timer 150ms・元 3187-3262 相当)');
    },

    /* select_animation(3265-3431) 相当(工程5-4)。
       count = n % 2(3267)。
       select_mp_pp == 0(魔法 3269-3345):
         select_mp_function == -2: 自分 df=pp_text、自分 st は count==0 で mp_text / 1 で ""、相手 df=""。
         select_mp_function == -1: 自分 st=mp_text、自分 df=pp_text、相手 st は count==0 で " ==" / 1 で ""、相手 df=""。
         select_mp_function >= 0: 自分 st=mp_text、自分 df=pp_text、相手 st は count==0 で " F"+fn / 1 で ""、相手 df=""。
       select_mp_pp != 0(薬草 3346-3430):
         自分 st は select_mp_enable なら mp_text / false なら mp_text=""。
         select_pp_state == -2: 自分 df は count==0 で pp_text / 1 で ""、相手 st=""、相手 df=""。
         select_pp_state == -1: 自分 df=pp_text、相手 st=""、相手 df は count==0 で " ==" / 1 で ""。
         select_pp_state >= 1: 自分 df=pp_text、相手 st=""、相手 df は count==0 で pp_text=String(ppState) / 1 で pp_text="" */
    selectAnim: function (n) {
      var s = this.state, fd = s.fightingData, fc = s.fightingCalc, d = this.el.digits;
      if (!fd || !fd[0] || !fd[1] || !fc) return;
      var count = n % 2;                             /* 3267 */
      var side1 = (fc.now_player === 1);
      var att = side1 ? fd[0] : fd[1];
      var ownSt = side1 ? d.st_1p : d.st_2p;
      var ownDf = side1 ? d.df_1p : d.df_2p;
      var oppSt = side1 ? d.st_2p : d.st_1p;
      var oppDf = side1 ? d.df_2p : d.df_1p;
      if (s.selectMpPp === 0) {                      /* 3269-3345(魔法選択中) */
        if (s.selectMpFunction === -2) {             /* 3272-3282 / 3310-3320 */
          this.setPpDigit(ownDf, att.pp);
          if (count === 0) this.setMpDigit(ownSt, att.mp);
          else this.setDigit(ownSt, '');
          this.setDigit(oppDf, '');
        } else if (s.selectMpFunction === -1) {      /* 3284-3294 / 3322-3332 */
          this.setMpDigit(ownSt, att.mp);
          this.setPpDigit(ownDf, att.pp);
          this.setDigit(oppSt, (count === 0) ? ' ==' : '');
          this.setDigit(oppDf, '');
        } else {                                     /* 3296-3306 / 3334-3344 */
          this.setMpDigit(ownSt, att.mp);
          this.setPpDigit(ownDf, att.pp);
          this.setDigit(oppSt, (count === 0) ? (' F' + s.selectMpFunction) : '');
          this.setDigit(oppDf, '');
        }
      } else {                                       /* 3346-3430(薬草選択中) */
        if (s.selectMpEnable) this.setMpDigit(ownSt, att.mp);   /* 3350-3351 / 3391-3392 */
        else this.setMpDigit(ownSt, '');                        /* 3354 / 3395 */
        if (s.selectPpState === -2) {                /* 3356-3366 / 3397-3407 */
          if (count === 0) this.setPpDigit(ownDf, att.pp);
          else this.setDigit(ownDf, '');
          this.setDigit(oppSt, '');
          this.setDigit(oppDf, '');
        } else if (s.selectPpState === -1) {         /* 3368-3377 / 3409-3418 */
          this.setPpDigit(ownDf, att.pp);
          this.setDigit(oppSt, '');
          this.setDigit(oppDf, (count === 0) ? ' ==' : '');
        } else {                                     /* 3379-3388 / 3420-3429 */
          this.setPpDigit(ownDf, att.pp);
          this.setDigit(oppSt, '');
          if (count === 0) this.setPpDigit(oppDf, String(s.selectPpState));
          else this.setPpDigit(oppDf, '');
        }
      }
    },

    /* select_state()(3435-3488) view 接続(工程5-4) */
    fxSelectState: function () {
      var r = BB2.State.selectState(this.state);
      if (!r) return;
      this.playSe('select_mp3');                     /* 3440 / 3448 / 3465 / 3473 se.select_mp3.play() */
      this.note('select_state(mp_pp=' + r.selectMpPp + '・mp_fn=' + r.selectMpFunction +
        '・pp_state=' + r.selectPpState + '・元 3435-3488 相当)');
    },

    /* set_state()(3491-3569) view 接続(工程5-4)。
       start_mp / start_pp: select_animation 継続。
       cancel_to_waiting: select_animation_timer 解放(clearFx)→battle_waiting 再入(3512-3514 / 3549-3551)。
       cancel_to_c2_end: select_animation_timer 解放→C2 select_end_state(Phase 5 予定)。
       use_magic: select_animation_timer 解放→use_magic()(工程5-5 で接続予定)。
       use_pp: select_animation_timer 解放→fxUsePp()(3565) */
    fxSetState: function () {
      var s = this.state;
      var r = BB2.State.setState(s);
      if (!r) return;
      this.playSe('decide_mp3');                     /* 3497 / 3501 / 3534 / 3538 se.decide_mp3.play() */
      if (r.action === 'start_mp' || r.action === 'start_pp') {
        this.note('set_state(' + r.action + '・対象選択開始・元 3497 / 3534 相当)');
        return;
      }
      this.clearFx();                                /* 3504-3509 / 3521-3526 / 3541-3546 / 3558-3563 select_animation_timer 停止 */
      if (r.action === 'cancel_to_waiting') {
        var w = BB2.State.battleWaiting(s);          /* 3514 / 3551 */
        if (!w) return;
        if (w.battleEnd) {
          this.fxCallBattleEnd();
          return;
        }
        this.fxBattleWaiting(w);
        this.note('set_state(キャンセル→battle_waiting 再入・元 3512-3514 / 3549-3551 相当)');
      } else if (r.action === 'cancel_to_c2_end') {
        this.fxSelectEndState();                     /* 3517 / 3554 select_end_state(工程6-3) */
      } else if (r.action === 'use_magic') {
        this.fxUseMagic(r.mpFunction);               /* 3528 → use_magic()(3689) */
      } else if (r.action === 'use_pp') {
        this.fxUsePp();                              /* 3565 */
      }
    },

    /* use_magic()(3689-3732) view 接続(工程5-5a/5-5b: F0〜F9 全接続) */
    fxUseMagic: function (fn) {
      var mpFn = (typeof fn === 'number') ? fn : this.state.selectMpFunction;
      switch (mpFn) {
        case 0: this.fxF0(); break;                  /* 3691-3693 */
        case 1: this.fxF1(); break;                  /* 3695-3697 */
        case 2: this.fxF2(); break;                  /* 3699-3701 */
        case 3: this.fxF3(); break;                  /* 3703-3705 */
        case 4: this.fxF4(); break;                  /* 3707-3709 */
        case 5: this.fxF5(); break;                  /* 3711-3713 */
        case 6: this.fxF6(); break;                  /* 3715-3717 */
        case 7: this.fxF7(); break;                  /* 3719-3721 */
        case 8: this.fxF8(); break;                  /* 3723-3725 */
        case 9: this.fxF9(); break;                  /* 3727-3729 */
      }
    },

    /* f0()(3737-3755: トルマ・消費0) view 接続(工程5-5a) */
    fxF0: function () {
      var self = this, s = this.state;
      var r = BB2.State.f0(s);
      if (!r) return;
      this.playSe('status_down_mp3');                /* 3754 se.status_down_mp3.play() */
      this.label('battle_label', false);             /* 3739 */
      this.label('power_label', false);              /* 3740 */
      this.startFx('f0', r.timerDelay, r.timerRepeat, function (n) {   /* 3749-3752 Timer(150,20) */
        self.f0Anim(n);
      }, function () {
        self.fxF0Complete();
      });
      this.note('f0(トルマ)開始(now_player=' + r.nowPlayer + '・display_f0_mp=' + r.displayF0Mp +
        '・Timer 150ms×20・元 3737-3755 相当)');
    },

    /* f0_animation(3757-3823) 相当(工程5-5a)。
       n == 12 で MP 変更(State.f0ApplyMp)。
       n < 12 では count==0 で全員の hp / mp_text / pp_text、count==1 で相手側 st を "" にして点滅。
       n >= 12 では全員の hp / mp_text / pp_text を表示 */
    f0Anim: function (n) {
      var s = this.state, fd = s.fightingData, fc = s.fightingCalc, d = this.el.digits;
      if (!fd || !fd[0] || !fd[1] || !fc) return;
      if (n === 12) {                                /* 3762-3777 */
        this.playSe('change_mp3');                   /* 3763 se.change_mp3.play() */
        BB2.State.f0ApplyMp(s);
      }
      var count = n % 2;                             /* 3759 */
      this.setDigit(d.hp_1p, fd[0].hp);
      this.setPpDigit(d.df_1p, fd[0].pp);
      this.setDigit(d.hp_2p, fd[1].hp);
      this.setPpDigit(d.df_2p, fd[1].pp);
      if (n < 12) {                                  /* 3779-3812 */
        if (fc.now_player === 1) {
          this.setMpDigit(d.st_1p, fd[0].mp);
          if (count === 0) this.setMpDigit(d.st_2p, fd[1].mp);
          else this.setDigit(d.st_2p, '');
        } else {
          this.setMpDigit(d.st_2p, fd[1].mp);
          if (count === 0) this.setMpDigit(d.st_1p, fd[0].mp);
          else this.setDigit(d.st_1p, '');
        }
      } else {                                       /* 3813-3820 */
        this.setMpDigit(d.st_1p, fd[0].mp);
        this.setMpDigit(d.st_2p, fd[1].mp);
      }
    },

    /* f0_complete()(3825-3842) view 接続(工程5-5a) */
    fxF0Complete: function () {
      var s = this.state;
      var r = BB2.State.f0Complete(s);
      if (!r) return;
      var w = BB2.State.battleWaiting(s);            /* 3841 */
      if (!w) return;
      if (w.battleEnd) {
        this.fxCallBattleEnd();
        return;
      }
      this.fxBattleWaiting(w);
    },

    /* f1()(3850-3961: ガンツ・消費2) / f2()(3966-4076: デガンツ・消費5) 共通 view 接続(工程5-5a) */
    _fxMagicAttack: function (fnNum) {
      var self = this, s = this.state, fd = s.fightingData, d = this.el.digits;
      if (!fd || !fd[0] || !fd[1]) return;
      this.label('battle_label', true);              /* 3854 / 3970 */
      this.label('power_label', false);              /* 3855 / 3971 */
      this.setDigit(d.hp_1p, fd[0].hp);              /* 3858-3863 / 3974-3979 */
      this.setDigit(d.st_1p, fd[0].st);
      this.setDigit(d.df_1p, fd[0].df);
      this.setDigit(d.hp_2p, fd[1].hp);
      this.setDigit(d.st_2p, fd[1].st);
      this.setDigit(d.df_2p, fd[1].df);
      this.label('mp_label', false);                 /* 3867 / 3983 */
      this.label('pp_label', false);                 /* 3869 / 3985 */
      var r = (fnNum === 1) ? BB2.State.f1(s) : BB2.State.f2(s);
      if (!r) return;
      this.playSe(r.hit ? (r.critical ? 'battle_critical_mp3' : 'battle_mp3') : 'battle_miss_mp3'); /* 3887-3922 / 4003-4038 */
      this.label('damage_label', true);              /* 3927 / 4043 */
      this.label('hp_label', false);                 /* 3928 / 4044 */
      this.label('st_label', false);                 /* 3929 / 4045 */
      this.label('df_label', false);                 /* 3930 / 4046 */
      this.startFx('battle', r.timerDelay, r.timerRepeat, function (n) {   /* 3945-3949 / 4061-4065 */
        self.battleAnim(n);
      }, function () {
        var c = (fnNum === 1) ? BB2.State.f1Complete(s) : BB2.State.f2Complete(s);
        self.fxBattleComplete(c);
      });
      this.note('f' + fnNum + ' 開始(now_player=' + r.nowPlayer + '・hit=' + r.hit +
        '・critical=' + r.critical + '・dmg=' + r.displayDamage + '・Timer 40ms×' + r.timerRepeat + ')');
    },

    fxF1: function () { this._fxMagicAttack(1); },
    fxF2: function () { this._fxMagicAttack(2); },

    /* f3()(4080-4137: リーモ・消費2) / f4()(4141-4199: デリーモ・消費4) 共通 view 接続(工程5-5a) */
    _fxMagicHeal: function (fnNum) {
      var self = this, s = this.state;
      var r = (fnNum === 3) ? BB2.State.f3(s) : BB2.State.f4(s);
      if (!r) return;
      this.playSe('power_mp3');                      /* 4097 / 4158 se.power_mp3.play() */
      this.startFx('use_pp', r.timerDelay, r.timerRepeat, function (n) {   /* 4098-4101 / 4159-4162 Timer(80,40) */
        self.usePpAnim(n);
      }, function () {
        var c = (fnNum === 3) ? BB2.State.f3Complete(s) : BB2.State.f4Complete(s);
        if (!c) return;
        if (c.toWaiting) {                           /* 4127-4129 / 4189-4191 */
          var w = BB2.State.battleWaiting(s);
          if (!w) return;
          if (w.battleEnd) {
            self.fxCallBattleEnd();
            return;
          }
          self.fxBattleWaiting(w);
        } else {
          self.fxSelectEndState();                   /* 4134 / 4196 select_end_state(工程6-3) */
        }
      });
      this.note('f' + fnNum + ' 開始(now_player=' + r.nowPlayer + '・display_power=' + r.displayPower +
        '・Timer 80ms×40)');
    },

    fxF3: function () { this._fxMagicHeal(3); },
    fxF4: function () { this._fxMagicHeal(4); },

    /* f5(4204: 相手DFダウン) / f6(4303: 自分DFアップ) / f7(4409: 相手STダウン) / f8(4508: 自分STアップ) 共通 view 接続(工程5-5b)。
       Timer(150, 12) で対象欄(count==1 のとき空文字 "")を点滅させ、COMPLETE で State.f5Complete〜f8Complete → battle_waiting 再入 */
    _fxMagicStatChange: function (fnNum) {
      var self = this, s = this.state, fd = s.fightingData, fc = s.fightingCalc, d = this.el.digits;
      if (!fd || !fd[0] || !fd[1] || !fc) return;
      var r = BB2.State['f' + fnNum](s);
      if (!r) return;
      this.playSe('status_down_mp3');                /* 4222 / 4321 / 4427 / 4526 se.status_down_mp3.play() */
      this.label('battle_label', false);             /* 4206 / 4305 / 4411 / 4510 */
      this.label('power_label', false);              /* 4207 / 4306 / 4412 / 4511 */
      this.label('hp_label', true);                  /* 4215 / 4314 / 4420 / 4519 */
      this.label('damage_label', false);             /* 4216 / 4315 / 4421 / 4520 */
      this.label('st_label', true);                  /* 4217 / 4316 / 4422 / 4521 */
      this.label('mp_label', false);                 /* 4218 / 4317 / 4423 / 4522 */
      this.label('df_label', true);                  /* 4219 / 4318 / 4424 / 4523 */
      this.label('pp_label', false);                 /* 4220 / 4319 / 4425 / 4524 */
      this.startFx('f' + fnNum, r.timerDelay, r.timerRepeat, function (n) {   /* Timer(150,12) */
        var count = n % 2;
        var side1 = (fc.now_player === 1);
        self.setDigit(d.hp_1p, fd[0].hp);
        self.setDigit(d.st_1p, fd[0].st);
        self.setDigit(d.df_1p, fd[0].df);
        self.setDigit(d.hp_2p, fd[1].hp);
        self.setDigit(d.st_2p, fd[1].st);
        self.setDigit(d.df_2p, fd[1].df);
        if (count === 1) {
          if (fnNum === 5) self.setDigit(side1 ? d.df_2p : d.df_1p, '');      /* 4243 / 4259 相手DF点滅 */
          else if (fnNum === 6) self.setDigit(side1 ? d.df_1p : d.df_2p, ''); /* 4339 / 4355 自分DF点滅 */
          else if (fnNum === 7) self.setDigit(side1 ? d.st_2p : d.st_1p, ''); /* 4447 / 4463 相手ST点滅 */
          else if (fnNum === 8) self.setDigit(side1 ? d.st_1p : d.st_2p, ''); /* 4545 / 4561 自分ST点滅 */
        }
      }, function () {
        var c = BB2.State['f' + fnNum + 'Complete'](s);
        if (!c) return;
        self.playSe('change_mp3');                   /* 4266 / 4364 / 4471 / 4571 se.change_mp3.play() */
        var w = BB2.State.battleWaiting(s);          /* 4297 / 4402 / 4502 / 4609 */
        if (!w) return;
        if (w.battleEnd) {
          self.fxCallBattleEnd();
          return;
        }
        self.fxBattleWaiting(w);
      });
      this.note('f' + fnNum + ' 開始(now_player=' + r.nowPlayer + '・Timer 150ms×12)');
    },

    fxF5: function () { this._fxMagicStatChange(5); },
    fxF6: function () { this._fxMagicStatChange(6); },
    fxF7: function () { this._fxMagicStatChange(7); },
    fxF8: function () { this._fxMagicStatChange(8); },

    /* f9()(4616-4680: マミロージャ・消費3・相手薬草封印) view 接続(工程5-5b)。
       4617-4638: ラベル・全6欄初期表示、Timer(150, 12) で power_label を count==0 点灯 / 1 消灯(4648-4652) → f9Complete */
    fxF9: function () {
      var self = this, s = this.state, fd = s.fightingData, d = this.el.digits;
      if (!fd || !fd[0] || !fd[1]) return;
      var r = BB2.State.f9(s);
      if (!r) return;
      this.playSe('status_down_mp3');                /* 4640 se.status_down_mp3.play() */
      this.label('battle_label', false);             /* 4618 */
      this.label('power_label', false);              /* 4619 */
      this.label('hp_label', true);                  /* 4627 */
      this.label('damage_label', false);             /* 4628 */
      this.label('st_label', true);                  /* 4629 */
      this.label('mp_label', false);                 /* 4630 */
      this.label('df_label', true);                  /* 4631 */
      this.label('pp_label', false);                 /* 4632 */
      this.setDigit(d.hp_1p, fd[0].hp);              /* 4633-4638 */
      this.setDigit(d.st_1p, fd[0].st);
      this.setDigit(d.df_1p, fd[0].df);
      this.setDigit(d.hp_2p, fd[1].hp);
      this.setDigit(d.st_2p, fd[1].st);
      this.setDigit(d.df_2p, fd[1].df);
      this.startFx('f9', r.timerDelay, r.timerRepeat, function (n) {   /* 4621-4624 Timer(150,12) */
        self.label('power_label', (n % 2) === 0);    /* 4648-4652 */
      }, function () {
        var c = BB2.State.f9Complete(s);
        if (!c) return;
        self.playSe('change_mp3');                   /* 4657 se.change_mp3.play() */
        var w = BB2.State.battleWaiting(s);          /* 4679 */
        if (!w) return;
        if (w.battleEnd) {
          self.fxCallBattleEnd();
          return;
        }
        self.fxBattleWaiting(w);
      });
      this.note('f9(マミロージャ)開始(now_player=' + r.nowPlayer + '・Timer 150ms×12・元 4616-4680 相当)');
    },

    /* use_pp()(3575-3599) view 接続(工程5-4)。
       3578-3589: State.usePp(s) で usePpPower を算出し display_power に設定。
       3591-3597: use_pp_animation_timer = new Timer(80, 40) → usePpAnim / COMPLETE → fxUsePpComplete */
    fxUsePp: function () {
      var self = this, s = this.state;
      var r = BB2.State.usePp(s);
      if (!r) return;
      this.playSe('power_mp3');                      /* 3592 se.power_mp3.play() */
      this.startFx('use_pp', r.timerDelay, r.timerRepeat, function (n) {   /* 3591-3596 Timer(80,40) */
        self.usePpAnim(n);
      }, function () {
        self.fxUsePpComplete();
      });
      this.note('use_pp 開始(now_player=' + r.nowPlayer + '・ppState=' + s.selectPpState +
        '・display_power=' + r.displayPower + '・Timer 80ms×40・元 3575-3599 相当)');
    },

    /* use_pp_animation(3603-3648) 相当(工程5-4)。
       3608-3609: battle_label=false / power_label=true。
       相手側(now_player==1 なら 2P 欄・!=1 なら 1P 欄)の hp に n<=20 で " =="/"" 交互、n>20 で display_power 表示(st/df は空欄) */
    usePpAnim: function (n) {
      var fc = this.state.fightingCalc, d = this.el.digits;
      var count = n % 2;                             /* 3605 */
      var side1 = (fc.now_player === 1);             /* 3611 / 3629 */
      this.label('battle_label', false);             /* 3608 */
      this.label('power_label', true);               /* 3609 */
      var oppHp = side1 ? d.hp_2p : d.hp_1p;
      var oppSt = side1 ? d.st_2p : d.st_1p;
      var oppDf = side1 ? d.df_2p : d.df_1p;
      if (n <= 20) {                                 /* 3614-3622 / 3632-3640 */
        this.setDigit(oppHp, (count === 0) ? ' ==' : '');
        this.setDigit(oppSt, '');
        this.setDigit(oppDf, '');
      } else {                                       /* 3623-3627 / 3641-3645 */
        this.setDigit(oppHp, fc.display_power);
        this.setDigit(oppSt, '');
        this.setDigit(oppDf, '');
      }
    },

    /* use_pp_complete()(3651-3684) view 接続(工程5-4)。
       3653-3672: State.usePpComplete(s) で powerFlag=false・HP 加算・PP 減算・now_player 反転。
       3675-3677: select_battle_magic が true なら battle_waiting 再入 */
    fxUsePpComplete: function () {
      var s = this.state;
      var r = BB2.State.usePpComplete(s);
      if (!r) return;
      if (r.toWaiting) {                             /* 3675-3677 */
        var w = BB2.State.battleWaiting(s);
        if (!w) return;
        if (w.battleEnd) {
          this.fxCallBattleEnd();
          return;
        }
        this.fxBattleWaiting(w);
      } else {
        this.fxSelectEndState();                     /* 3682 select_end_state(工程6-3) */
      }
    },

    /* カードスキップ演出(元 card_skip(1394)。Timer(50,2)・演出は card_skip_animation(1436-1456)・完了時は card_insert_next(1417/1427)) */
    fxCardSkip: function () {
      var self = this;
      this.playSe('decide_mp3');                       /* 1413 / 1423 se.decide_mp3.play() */
      this.startFx('skip', 50, 2, function () {        /* 元 1415-1418・1425-1428 Timer(50,2) */
        /* 元 1439-1455: 3枚目・4枚目のどちらも 2P 側を空にする(元の癖のまま) */
        var d = this.el.digits;
        this.setDigit(d.hp_2p, ''); this.setDigit(d.st_2p, ''); this.setDigit(d.df_2p, '');
      }, function () {
        /* 元 1417・1427: card_skip_timer TIMER_COMPLETE は card_insert_next を呼び出す */
        self.fxCardNext();
      });
    },

    /* カード挿入エラー演出(元 card_insert 失敗 1050-1064 相当。Timer(150,6)・演出は card_insert_error_animation(1610-1769)) */
    fxCardError: function (before, data) {
      var s = this.state, S = BB2.State, self = this;
      this.playSe('card_in_error_mp3');                /* 1051 / 1095 / 1125 / 1156 se.card_in_error_mp3.play() */
      /* 演出の分支は元の failure 分岐の表示引数と同じ。reason 分類は元 1619(アイテム race>4)・1675(同バーコード) 相当 */
      var reason = 'miss';
      if (data) {
        if (data.race > 4) { reason = 'item'; }
        else if (before === S.STATES.CARD_3 && s.cards[0] && s.cards[0].barcode === data.barcode) { reason = 'dupe'; }
        else if (before === S.STATES.CARD_4 && s.cards[1] && s.cards[1].barcode === data.barcode) { reason = 'dupe'; }
      }
      this.startFx('error', 150, 6, function (n) {
        var on = n % 2 === 1;
        if (before === S.STATES.CARD_1 || before === S.STATES.CARD_2) {   /* 元 1616-1664 */
          if (on) {
            this.label('card_input_label', true);
            this.label('item_label', reason === 'item');
            this.label('miss_label', false);
          } else {
            this.label('card_input_label', reason === 'item');
            this.label('item_label', false);
            this.label('miss_label', true);
          }
        } else if (before === S.STATES.CARD_3) {                          /* 元 1666-1715(3枚目・1P 側ラベル) */
          if (on) {
            if (reason === 'dupe') {
              this.label('card_input_label', false); this.label('item_label', false);
              var j = data && data.job <= 6;
              this.label('warrior_1p_label', j); this.label('magician_1p_label', !j);
              this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('item_label', false);
              this.label('miss_label', false);
            }
          } else {
            if (reason === 'item') {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (reason === 'dupe') {
              this.label('card_input_label', false); this.label('item_label', false);
              this.label('warrior_1p_label', false); this.label('magician_1p_label', false);
              this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('item_label', false); this.label('miss_label', true);
            }
          }
        } else {                                          /* 元 1717-1766(4枚目・2P 側ラベル) */
          if (on) {
            if (reason === 'dupe') {
              this.label('card_input_label', false); this.label('item_label', false);
              var j2 = data && data.job <= 6;
              this.label('warrior_2p_label', j2); this.label('magician_2p_label', !j2);
              this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', false);
            }
          } else {
            if (reason === 'item') {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (reason === 'dupe') {
              this.label('card_input_label', false); this.label('item_label', false);
              this.label('warrior_2p_label', false); this.label('magician_2p_label', false);
              this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('item_label', false); this.label('miss_label', true);
            }
          }
        }
      }, function () { self.fxErrorBack(); });
    },

    /* エラー演出完了(元 card_insert_error_back(1772 相当)。1781-1793 を写す) */
    fxErrorBack: function () {
      this.label('item_label', false);                  /* 元 1781-1783 */
      this.label('card_input_label', false);
      this.label('miss_label', false);
      this.el.camera_reader.hidden = true;              /* 元 1785-1786(card_reader_visible=false+init_card_reader) */
      this.fxCardWait();                                /* 元 1793 */
      this.note('エラー演出完了・同じ枚数のまま再受付(bb2_state ' + this.state.state + ' 不変・元 card_insert_error_back(1772) 相当)');
      this.render();
    },

    /* --- C2 モード固有演出(工程6-1: 4711-5690) --- */

    /* card_insert_wait_c2(4711-4760) + card_insert_wait_animation_c2(4764-4794) 相当(工程6-1) */
    fxCardWaitC2: function () {
      var s = this.state, S = BB2.State, d = this.el.digits;
      if (s.state === S.STATES.CARD_1) {               /* 4724-4744(1枚目: 戦士(主人公)) */
        this.setDigit(d.hp_1p, ' =='); this.setDigit(d.st_1p, ' =='); this.setDigit(d.df_1p, ' ==');
        this.setDigit(d.hp_2p, ' =='); this.setDigit(d.st_2p, ' =='); this.setDigit(d.df_2p, ' ==');
        this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);
        this.label('warrior_1p_label', true); this.label('warrior_2p_label', false);
        this.label('magician_1p_label', false); this.label('magician_2p_label', true);
      } else if (s.state === S.STATES.CARD_2) {        /* 4747-4757(2枚目: 魔法使い(主人公)) */
        this.setDigit(d.hp_2p, ' =='); this.setDigit(d.st_2p, ' =='); this.setDigit(d.df_2p, ' ==');
      }
      this.startFx('wait', 500, 0, function (n) {      /* 4717-4719 Timer(500) → card_insert_wait_animation_c2 */
        var count = n % 2, st = this.state.state;
        if (st === S.STATES.CARD_1) {                  /* 4768-4778 */
          this.label('card_input_label', count === 0);
          this.label('warrior_1p_label', count === 0);
          this.label('magician_1p_label', false);
        } else if (st === S.STATES.CARD_2) {           /* 4781-4791 */
          this.label('card_input_label', count === 0);
          this.label('warrior_2p_label', false);
          this.label('magician_2p_label', count === 0);
        }
      }, null);
    },

    /* card_insert_c2(4800-4902) view 接続(工程6-1) */
    fxCardInsertTriggerC2: function () {
      var self = this, s = this.state, S = BB2.State;
      this.stopFx();                                   /* 4811-4815 */
      var r = S.cardInsertC2(s, this.el.card_in.value);
      if (!r) return;
      var bd = r.data;
      if (r.ok) {                                      /* 4825-4843 / 4866-4885 */
        this.playSe('card_in_mp3');                    /* 4826 / 4867 se.card_in_mp3.play() */
        if (r.before === S.STATES.CARD_1) {
          this.label('warrior_1p_label', bd.job <= 6);
          this.label('magician_1p_label', bd.job > 6);
        } else {
          this.label('warrior_2p_label', bd.job <= 6);
          this.label('magician_2p_label', bd.job > 6);
        }
        this.label('card_input_label', false);
        this.startFx('insert', 80, 20, function (n) {  /* 4839-4842 / 4881-4884 Timer(80,20) → card_insert_animation */
          self.insertAnim(r.before, n);
        }, function () {
          self.fxCardNextC2();
        });
        this.note('C2 主人公カード(' + (r.before - 3) + '枚目)入力成功・Timer 80ms×20(元 4800-4902 相当)');
      } else {                                         /* 4845-4856 / 4887-4899 */
        if (r.before === S.STATES.CARD_1) {
          this.label('magician_1p_label', false); this.label('warrior_1p_label', false);
        } else {
          this.label('magician_2p_label', false); this.label('warrior_2p_label', false);
        }
        this.fxCardErrorC2(r.before, bd);
      }
    },

    /* card_insert_next_c2(4910-5087) view 接続(工程6-1・6-2: case 4/5/6/7) */
    fxCardNextC2: function () {
      var s = this.state, S = BB2.State;
      var r = S.cardInsertNextC2(s);
      if (!r) return;
      this.fxAfterCardNextC2(r);
    },

    fxAfterCardNextC2: function (r) {
      var s = this.state, S = BB2.State, d = this.el.digits;
      this.el.card_in.value = '';
      this.el.camera_reader.hidden = true;
      if (r.before === S.STATES.CARD_1) {              /* 4928-4943 */
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, r.bd);
        this.fxCardWaitC2();
        this.note('C2 1枚目(戦士)完了→2枚目(魔法使い)待ち(bb2_state 5・元 4928-4943 相当)');
      } else if (r.before === S.STATES.CARD_2) {       /* 4946-4961 */
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.bd);
        this.note('C2 2枚目(魔法使い)完了→SET ボタンで敵カード入力待ちへ(bb2_state 6・元 4946-4961 相当)');
      } else if (r.before === S.STATES.CARD_3) {       /* 4964-5011 */
        this.setDigit(d.hp_1p, ' =='); this.setDigit(d.st_1p, ' =='); this.setDigit(d.df_1p, ' ==');
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.bd);
        this.label('warrior_1p_label', !!(s.barcodeDataC2[4] && s.barcodeDataC2[4].live));
        this.label('magician_1p_label', !!(s.barcodeDataC2[5] && s.barcodeDataC2[5].live));
        this.label('warrior_2p_label', r.bd.job <= 6);
        this.label('magician_2p_label', r.bd.job > 6);
        this.fxFriendSelectWaitC2();                   /* 4990-4994 Timer(300) → friend_select_animation_c2 */
      } else if (r.before === S.STATES.CARD_4) {       /* 5014-5084 */
        this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);
        this.label('mp_label', false); this.label('pp_label', false);
        this.label('item_label', false); this.label('card_input_label', false);
        this.label('warrior_1p_label', r.fd0.job <= 6);
        this.label('magician_1p_label', r.fd0.job > 6);
        this.label('warrior_2p_label', r.fd1.job <= 6);
        this.label('magician_2p_label', r.fd1.job > 6);
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.fd1);
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, r.fd0);
        var hasDown = S.specialDown(s);                /* 5082 special_down() */
        this.fxAfterSpecialDown(hasDown);
      }
    },

    /* card_insert_error_animation_c2(5091-5252) + card_insert_error_back_c2(5256-5285) 相当(工程6-1) */
    fxCardErrorC2: function (before, bd) {
      var self = this, S = BB2.State;
      this.playSe('card_in_error_mp3');                /* 4846 / 4888 / 5659 / 6053 se.card_in_error_mp3.play() */
      this.startFx('error', 150, 6, function (n) {     /* 4852 / 4895 / 5663 Timer(150,6) */
        var on = (n % 2) === 1;
        if (before === S.STATES.CARD_1) {              /* 5097-5136 */
          if (on) {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', true); this.label('miss_label', false);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_1p_label', bd.job < 7); this.label('magician_1p_label', bd.job >= 7); this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('miss_label', false);
            }
          } else {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_1p_label', false); this.label('magician_1p_label', false); this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('miss_label', true);
            }
          }
        } else if (before === S.STATES.CARD_2) {       /* 5139-5178 */
          if (on) {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', true); this.label('miss_label', false);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', bd.job < 7); this.label('magician_2p_label', bd.job >= 7); this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('miss_label', false);
            }
          } else {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', false); this.label('magician_2p_label', false); this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('miss_label', true);
            }
          }
        } else if (before === S.STATES.CARD_3) {       /* 5180-5202 */
          if (on) {
            this.label('card_input_label', true);
            this.label('item_label', !!(bd && bd.race > 4));
            this.label('miss_label', false);
          } else {
            this.label('card_input_label', !!(bd && bd.race > 4));
            this.label('item_label', false);
            this.label('miss_label', true);
          }
        } else {                                       /* 5205-5249 */
          if (on) {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', true); this.label('miss_label', false);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', bd.job < 7); this.label('magician_2p_label', bd.job >= 7);
              this.label('item_label', false); this.label('miss_label', false);
            } else {
              this.label('item_label', false); this.label('card_input_label', true); this.label('miss_label', false);
            }
          } else {
            this.label('card_input_label', !!(bd && bd.race > 4));
            this.label('warrior_2p_label', false); this.label('magician_2p_label', false);
            this.label('item_label', false); this.label('miss_label', true);
          }
        }
      }, function () { self.fxErrorBackC2(); });
    },

    fxErrorBackC2: function () {
      var s = this.state, S = BB2.State;
      this.label('item_label', false);                 /* 5265-5267 */
      this.label('card_input_label', false);
      this.label('miss_label', false);
      this.el.camera_reader.hidden = true;
      if (s.state < S.STATES.CARD_3) {                 /* 5278-5279 */
        this.fxCardWaitC2();
      } else if (s.state === S.STATES.CARD_3) {        /* 5280-5281 */
        this.fxCardEnemyWaitC2();
      } else if (s.state === S.STATES.CARD_4) {        /* 5282-5284 */
        this.fxSetFriendState();
      }
      this.note('C2 カード入力エラー完了・再受付(bb2_state ' + s.state + '・元 5256-5285 相当)');
    },

    /* card_enemy_insert_wait_c2_se(5288-5302) + card_enemy_insert_wait_c2(5306-5360) + animation(5363-5378) 相当(工程6-1) */
    fxCardEnemyWaitC2Se: function () {
      this.label('mp_label', false);                   /* 5296 */
      this.label('pp_label', false);                   /* 5297 */
      this.playSe('decide_mp3');                       /* 5300 se.decide_mp3.play() */
      this.fxCardEnemyWaitC2();
    },

    fxCardEnemyWaitC2: function () {
      var s = this.state, d = this.el.digits;
      BB2.State.cardEnemyInsertWaitC2(s);              /* 5311-5356 */
      this.setDigit(d.hp_1p, ''); this.setDigit(d.st_1p, ''); this.setDigit(d.df_1p, '');       /* 5332-5334 */
      this.setDigit(d.hp_2p, ' =='); this.setDigit(d.st_2p, ' =='); this.setDigit(d.df_2p, ' =='); /* 5335-5337 */
      this.label('card_input_label', false);           /* 5338 */
      this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true); /* 5339-5341 */
      this.label('warrior_1p_label', false); this.label('magician_1p_label', false);            /* 5342-5345 */
      this.label('warrior_2p_label', false); this.label('magician_2p_label', false);
      this.startFx('wait', 500, 0, function (n) {      /* 5317-5319 Timer(500) → card_enemy_insert_wait_animation_c2 */
        var on = (n % 2) === 1;                        /* 5368 */
        this.label('warrior_2p_label', on);
        this.label('magician_2p_label', on);
        this.label('card_input_label', on);
      }, null);
      this.note('C2 敵カード入力待ち(bb2_state 6・l_power でパスコード入力へ・元 5306-5360 相当)');
    },

    /* select_passcode(5385-5430) + passcode_wait_animation_c2(5434-5489) 相当(工程6-1) */
    fxSelectPasscode: function () {
      var self = this, s = this.state, d = this.el.digits;
      this.clearFx();                                  /* 5398-5402 */
      BB2.State.selectPasscode(s);
      this.label('warrior_1p_label', false);           /* 5410-5418 */
      this.label('magician_1p_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('card_input_label', false);
      this.label('hp_label', false);
      this.label('st_label', false);
      this.label('df_label', false);
      this.setDigit(d.hp_1p, 'p00');                   /* 5420-5426 */
      this.setDigit(d.st_1p, '');
      this.setDigit(d.df_1p, '');
      this.setDigit(d.hp_2p, '000');
      this.setDigit(d.st_2p, '');
      this.setDigit(d.df_2p, '');
      this.startFx('passcode_wait', 150, 0, function (n) {   /* 5405-5407 Timer(150) */
        self.passcodeWaitAnimC2(n);
      }, null);
      this.note('C2 パスコード入力画面(SELECT で加算・SET で次の桁へ・元 5385-5430 相当)');
    },

    passcodeWaitAnimC2: function (n) {
      var s = this.state, d = this.el.digits, pc = s.passcode || '00000';
      var count = n % 2;                               /* 5436 */
      var c0 = pc.charAt(0), c1 = pc.charAt(1), c2 = pc.charAt(2), c3 = pc.charAt(3), c4 = pc.charAt(4);
      if (count === 1) {
        this.setDigit(d.hp_1p, 'p' + c0 + c1);
        this.setDigit(d.hp_2p, c2 + c3 + c4);
      } else {
        if (s.passcodeState === 0) {
          this.setDigit(d.hp_1p, 'p ' + c1);
          this.setDigit(d.hp_2p, c2 + c3 + c4);
        } else if (s.passcodeState === 1) {
          this.setDigit(d.hp_1p, 'p' + c0 + ' ');
          this.setDigit(d.hp_2p, c2 + c3 + c4);
        } else if (s.passcodeState === 2) {
          this.setDigit(d.hp_1p, 'p' + c0 + c1);
          this.setDigit(d.hp_2p, ' ' + c3 + c4);
        } else if (s.passcodeState === 3) {
          this.setDigit(d.hp_1p, 'p' + c0 + c1);
          this.setDigit(d.hp_2p, c2 + ' ' + c4);
        } else {
          this.setDigit(d.hp_1p, 'p' + c0 + c1);
          this.setDigit(d.hp_2p, c2 + c3 + ' ');
        }
      }
    },

    fxAddPasscode: function () {
      var r = BB2.State.addPasscode(this.state);
      if (!r) return;
      this.playSe('select_mp3');                       /* 5494 se.select_mp3.play() */
      this.note('C2 add_passcode(state=' + r.passcodeState + '・passcode=' + r.passcode + ')');
    },

    fxSetPasscode: function () {
      var self = this, s = this.state;
      var r = BB2.State.setPasscode(s);
      if (!r) return;
      this.playSe('decide_mp3');                       /* 5542 se.decide_mp3.play() */
      if (!r.done) {
        this.note('C2 set_passcode(桁進行 state=' + r.passcodeState + '・passcode=' + r.passcode + ')');
        return;
      }
      this.clearFx();
      if (!r.valid) {                                  /* 5555-5556(間違い→敵カード入力待ちへ戻る) */
        this.fxCardEnemyWaitC2();
        this.note('C2 パスコード不一致→敵カード入力待ちへ戻る(元 5555-5556 相当)');
        return;
      }
      this.label('hp_label', true);                    /* 5565-5567 */
      this.label('st_label', true);
      this.label('df_label', true);
      this.playSe('card_in_mp3');                      /* 5568 se.card_in_mp3.play() */
      this.startFx('passcode_up', 60, 70, function (n) {   /* 5569-5572 Timer(60,70) → passcode_power_up_animation_c2 */
        self.passcodePowerUpAnimC2(n);
      }, function () {
        self.fxCardEnemyWaitC2();                      /* 5571 */
      });
      this.note('C2 パスコード一致(No.' + r.passcodeNumber + ')→パワーアップ演出 Timer 60ms×70(元 5558-5574 相当)');
    },

    passcodePowerUpAnimC2: function (n) {
      var c2 = this.state.barcodeDataC2, d = this.el.digits;
      var count = n % 2;                               /* 5581 */
      if (n <= 30) {                                   /* 5583-5602 */
        if (count === 1) {
          this.setDigit(d.hp_1p, c2[2].hp); this.setDigit(d.st_1p, c2[2].st); this.setDigit(d.df_1p, c2[2].df);
          this.setDigit(d.hp_2p, c2[3].hp); this.setDigit(d.st_2p, c2[3].st); this.setDigit(d.df_2p, c2[3].df);
          this.label('warrior_1p_label', true);
          this.label('magician_2p_label', true);
        } else {
          this.setDigit(d.hp_1p, ''); this.setDigit(d.st_1p, ''); this.setDigit(d.df_1p, '');
          this.setDigit(d.hp_2p, ''); this.setDigit(d.st_2p, ''); this.setDigit(d.df_2p, '');
          this.label('warrior_1p_label', false);
          this.label('magician_2p_label', false);
        }
      } else {                                         /* 5603-5612 */
        this.setDigit(d.hp_1p, c2[4].hp); this.setDigit(d.st_1p, c2[4].st); this.setDigit(d.df_1p, c2[4].df);
        this.setDigit(d.hp_2p, c2[5].hp); this.setDigit(d.st_2p, c2[5].st); this.setDigit(d.df_2p, c2[5].df);
        this.label('warrior_1p_label', true);
        this.label('magician_2p_label', true);
      }
    },

    /* card_enemy_insert_c2(5616-5670) + card_insert_animation_c2 case 6(5673-5690) 相当(工程6-1) */
    fxCardEnemyInsertTriggerC2: function () {
      var self = this, s = this.state, d = this.el.digits;
      this.stopFx();                                   /* 5626-5630 */
      var r = BB2.State.cardEnemyInsertC2(s, this.el.card_in.value);
      if (!r) return;
      var bd = r.data;
      if (r.ok) {                                      /* 5640-5656 */
        this.playSe('card_in_mp3');                    /* 5641 se.card_in_mp3.play() */
        this.label('warrior_2p_label', bd.job <= 6);
        this.label('magician_2p_label', bd.job > 6);
        this.label('card_input_label', false);
        this.startFx('insert', 80, 20, function (n) {  /* 5652-5655 Timer(80,20) */
          var t = (n % 2) === 1 ? ' ==' : '';          /* 5680-5690 */
          self.setDigit(d.hp_2p, t); self.setDigit(d.st_2p, t); self.setDigit(d.df_2p, t);
        }, function () {
          self.fxCardNextC2();
        });
        this.note('C2 敵カード入力成功・Timer 80ms×20(元 5640-5656 相当)');
      } else {                                         /* 5658-5667 */
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', false);
        this.fxCardErrorC2(BB2.State.STATES.CARD_3, bd);
      }
    },

    /* --- 工程6-2: C2 仲間選択・アイテム入力/スキップ・戦闘突入(4686-4707, 4964-5086, 5692-6062) --- */

    /* card_insert_next_c2 case 6(4964-5011) → friend_select_animation_c2(5785-5834) */
    fxFriendSelectWaitC2: function () {
      var self = this;
      this.startFx('friend_select', 300, 0, function (n) {   /* 4990-4994 Timer(300) */
        self.friendSelectAnimC2(n);
      }, null);
      this.note('C2 仲間選択待ち(SELECT で切替・SET で決定・元 4964-5011 / 5785-5834 相当)');
    },

    friendSelectAnimC2: function (n) {
      var s = this.state, c2 = s.barcodeDataC2, d = this.el.digits;
      var count = n % 2;                               /* 5787 */
      if (s.friendSelectState === 0) {                 /* 5790-5801 */
        if (count === 1) {
          this.label('warrior_1p_label', !!(c2[4] && c2[4].live));
          this.label('magician_1p_label', !!(c2[5] && c2[5].live));
        } else {
          this.label('warrior_1p_label', false);
          this.label('magician_1p_label', false);
        }
      } else if (s.friendSelectState === 1) {          /* 5803-5816 */
        this.label('warrior_1p_label', count === 1);
        this.label('magician_1p_label', false);
        this.setDigit(d.hp_1p, c2[4].hp);
        this.setDigit(d.st_1p, c2[4].st);
        this.setDigit(d.df_1p, c2[4].df);
      } else if (s.friendSelectState === 2) {          /* 5818-5831 */
        this.label('magician_1p_label', count === 1);
        this.label('warrior_1p_label', false);
        this.setDigit(d.hp_1p, c2[5].hp);
        this.setDigit(d.st_1p, c2[5].st);
        this.setDigit(d.df_1p, c2[5].df);
      }
    },

    /* add_friend_state(5901-5931) */
    fxAddFriendState: function () {
      var r = BB2.State.addFriendState(this.state);
      if (!r) return;
      this.playSe('select_mp3');                       /* 5902 se.select_mp3.play() */
      this.note('C2 add_friend_state(friend_select_state=' + r.friendSelectState + '・SET で決定可・元 5901-5931 相当)');
    },

    /* set_friend_state(5933-5963) + set_friend_item_animation(5979-6011) */
    fxSetFriendState: function () {
      var r = BB2.State.setFriendState(this.state);
      if (!r) return;
      this.playSe('decide_mp3');                       /* 5934 se.decide_mp3.play() */
      this.clearFx();                                  /* 5944-5948 */
      this.fxSetFriendItemWaitC2();
    },

    fxSetFriendItemWaitC2: function () {
      var self = this;
      this.startFx('wait', 200, 0, function (n) {      /* 5951-5953 / 5888-5890 Timer(200) */
        self.setFriendItemAnimC2(n);
      }, null);
      this.note('C2 アイテムカード待ち(CARD IN で合体・SET でスキップ・元 5933-6011 相当)');
    },

    setFriendItemAnimC2: function (n) {
      var s = this.state, on = (n % 2) === 1;          /* 5981 */
      if (s.friendSelectState === 1) {                 /* 5983-5995 */
        this.label('item_label', on);
        this.label('warrior_1p_label', on);
        this.label('card_input_label', on);
        this.label('magician_1p_label', false);
      } else if (s.friendSelectState === 2) {          /* 5997-6009 */
        this.label('item_label', on);
        this.label('magician_1p_label', on);
        this.label('card_input_label', on);
        this.label('warrior_1p_label', false);
      }
    },

    /* card_insert_wait_c2_back(4686-4707) + friend_animation_c2(5836-5871) + friend_animation_c2_complete(5873-5899) */
    fxCardInsertWaitC2Back: function () {
      var self = this, s = this.state;
      this.clearFx();
      var r = BB2.State.cardInsertWaitC2Back(s);       /* 4686-4707 */
      if (!r) return;
      this.playSe('card_in_mp3');                      /* 4698 se.card_in_mp3.play() */
      this.startFx('friend_back', 80, 20, function (n) {   /* 4700-4704 Timer(80,20) */
        self.friendAnimC2(n);
      }, function () {
        self.fxFriendAnimC2Complete();                 /* 4702 */
      });
      this.note('C2 敗北後・残存仲間登場演出(friend_select_state=' + r.friendSelectState + '・Timer 80ms×20・元 4686-4707 相当)');
    },

    friendAnimC2: function (n) {
      var s = this.state, c2 = s.barcodeDataC2, d = this.el.digits;
      if (s.friendSelectState === 1) {                 /* 5839-5845 */
        this.label('warrior_1p_label', true);
        this.label('magician_1p_label', false);
      } else {
        this.label('warrior_1p_label', false);
        this.label('magician_1p_label', true);
      }
      if (n < 20) {                                    /* 5847-5857 */
        var t = (n % 2) === 1 ? ' ==' : '';
        this.setDigit(d.hp_1p, t); this.setDigit(d.st_1p, t); this.setDigit(d.df_1p, t);
      } else {                                         /* 5859-5869 */
        var bd = s.friendSelectState === 1 ? c2[4] : c2[5];
        this.setDigit(d.hp_1p, bd.hp); this.setDigit(d.st_1p, bd.st); this.setDigit(d.df_1p, bd.df);
      }
    },

    fxFriendAnimC2Complete: function () {
      this.clearFx();                                  /* 5881-5885 */
      BB2.State.friendAnimationC2Complete(this.state);
      this.fxSetFriendItemWaitC2();                    /* 5888-5897 */
    },

    /* card_insert_next_set_c2(5966-5975) */
    fxCardInsertNextSetC2: function () {
      this.playSe('decide_mp3');                       /* 5967 se.decide_mp3.play() */
      this.stopFx();                                   /* 5972 → 5027-5031 */
      var r = BB2.State.cardInsertNextSetC2(this.state);
      if (!r) return;
      this.fxAfterCardNextC2(r);
    },

    /* card_item_insert_c2(6013-6062) + card_insert_animation_c2 case 7(5692-5776) */
    fxCardItemInsertTriggerC2: function () {
      var self = this, s = this.state;
      this.stopFx();                                   /* 6021-6025 */
      var r = BB2.State.cardItemInsertC2(s, this.el.card_in.value);
      if (!r) return;
      var bd = r.data;
      if (r.ok) {                                      /* 6034-6050 */
        this.playSe('card_in_mp3');                    /* 6035 se.card_in_mp3.play() */
        this.label('warrior_2p_label', bd.job <= 6);
        this.label('magician_2p_label', bd.job > 6);
        this.label('card_input_label', false);
        this.startFx('insert', 80, 40, function (n) {  /* 6046-6049 Timer(80,40) */
          self.cardInsertItemAnimC2(n);
        }, function () {
          self.fxCardNextC2();                         /* 6048 */
        });
        this.note('C2 アイテムカード合体成功・Timer 80ms×40(元 6034-6050 / 5692-5776 相当)');
      } else {                                         /* 6052-6061 */
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', false);
        this.fxCardErrorC2(BB2.State.STATES.CARD_4, bd);
      }
    },

    cardInsertItemAnimC2: function (n) {
      var s = this.state, c2 = s.barcodeDataC2, bd = c2[7], d = this.el.digits;
      var count = n % 2;                               /* 5675 */
      if (n <= 20) {                                   /* 5694-5743 */
        if (bd.race === 9 && bd.job > 6) {             /* 5696-5711 */
          this.label('hp_label', true); this.label('st_label', false); this.label('df_label', false);
          this.label('mp_label', true); this.label('pp_label', true);
          this.setMpDigit(d.st_2p, bd.mp);
          this.setPpDigit(d.df_2p, bd.pp);
          var hero = (s.friendSelectState === 1) ? c2[4] : c2[5];
          this.setMpDigit(d.st_1p, hero.mp);
          this.setPpDigit(d.df_1p, hero.pp);
        } else {                                       /* 5712-5718 */
          this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);
          this.label('mp_label', false); this.label('pp_label', false);
        }
        if (bd.race <= 4) {                            /* 5720-5727 */
          this.label('warrior_2p_label', bd.job <= 6);
          this.label('magician_2p_label', bd.job > 6);
        } else {                                       /* 5728-5732 */
          this.label('warrior_2p_label', false);
          this.label('magician_2p_label', false);
          this.label('item_label', true);
        }
        var t = (count === 1) ? ' ==' : '';            /* 5734-5742 */
        this.setDigit(d.hp_2p, t); this.setDigit(d.st_2p, t); this.setDigit(d.df_2p, t);
      } else {                                         /* 5744-5775 */
        if (bd.race === 9 && bd.job > 6) {             /* 5746-5757 */
          this.setDigit(d.hp_2p, '');
          if (bd.mp > 0) this.setMpDigit(d.st_2p, bd.mp); else this.setDigit(d.st_2p, '');
          if (bd.pp > 0) this.setPpDigit(d.df_2p, bd.pp); else this.setDigit(d.df_2p, '');
        } else {                                       /* 5758-5774 */
          this.setDigit(d.hp_2p, bd.hp > 0 ? bd.hp : '');
          this.setDigit(d.st_2p, bd.st > 0 ? (bd.st > 199 ? 199 : bd.st) : '');
          this.setDigit(d.df_2p, bd.df > 0 ? (bd.df > 199 ? 199 : bd.df) : '');
        }
      }
    },

    /* --- 工程6-3: C2 戦闘終了・戦利品獲得・戦闘後薬草/魔法回復・パスコード表示(6064-6858) --- */

    /* battle_end_c2(6780-6810) + battle_get_animation_c2(6064-6402) */
    fxBattleEndC2: function () {
      var self = this, s = this.state;
      this.clearFx();                                  /* 6784-6789 */
      var r = BB2.State.battleEndC2(s);
      if (!r) return;
      if (r.enemyDefeated) {                           /* 6791-6804(敵撃破→戦利品獲得演出) */
        this.startFx('battle_get', 120, 0, function (n) {   /* 6793-6795 Timer(120) */
          self.battleGetAnimC2(n);
        }, null);
        this.note('C2 敵撃破・戦利品表示(SELECT で回復・SET で獲得' +
          (r.passcodeAvailable ? '・l_power でパスコード表示可' : '') + '・元 6780-6804 相当)');
      } else {                                         /* 6805-6809(味方1人敗北・片方健在) */
        this.note('C2 味方1人敗北(SELECT で新敵カード待ち・SET で残存仲間交代・元 6805-6809 相当)');
      }
    },

    /* battle_get_animation_c2(6064-6402) */
    battleGetAnimC2: function (n) {
      var s = this.state, c2 = s.barcodeDataC2, d = this.el.digits;
      if (!c2 || !c2[6]) return;
      var count = n % 2;                               /* 6066 */
      var bd = (s.friendSelectState === 1) ? c2[4] : c2[5]; /* 6069-6073 */
      var enemy = c2[6];
      if (!bd) return;
      this.setDigit(d.hp_1p, bd.hp);                   /* 6075 */
      if (count !== 1) {                               /* 6397-6401 */
        this.setDigit(d.hp_2p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_2p, '');
        return;
      }
      var sp = enemy.special;
      var bothMag = (bd.job > 6 && enemy.job > 6);
      var hasMpGain = (enemy.mp > 0 && enemy.job > 6 && bd.job > 6);
      if (sp >= 70 && sp <= 74) {                      /* 6194-6257(ST+200〜1000) */
        this.label('mp_label', false);
        this.label('st_label', true);
        this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', true);
        this.label('df_label', false);
        this.setPpDigit(d.df_1p, bd.pp);
        this.setDigit(d.hp_2p, '');
        var stBonus = { 70: 2, 71: 4, 72: 6, 73: 8, 74: 10 }[sp];
        this.setDigit(d.st_2p, stBonus);
        this.setPpDigit(d.df_2p, 5);
      } else if (sp >= 75 && sp <= 79) {               /* 6259-6372(DF+200〜1000) */
        this.label('mp_label', bothMag);
        this.label('st_label', !bothMag);
        if (bothMag) this.setMpDigit(d.st_1p, bd.mp);
        else this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', false);
        this.label('df_label', true);
        this.setDigit(d.df_1p, bd.df);
        this.setDigit(d.hp_2p, '');
        if (hasMpGain) this.setMpDigit(d.st_2p, 5);
        else this.setDigit(d.st_2p, '');
        var dfBonus = { 75: 2, 76: 4, 77: 6, 78: 8, 79: 10 }[sp];
        this.setDigit(d.df_2p, dfBonus);
      } else {                                         /* 6079-6192(HP+1000〜10000) & default(6374-6396) */
        this.label('mp_label', bothMag);
        this.label('st_label', !bothMag);
        if (bothMag) this.setMpDigit(d.st_1p, bd.mp);
        else this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', true);
        this.label('df_label', false);
        this.setPpDigit(d.df_1p, bd.pp);
        var hpBonusMap = { 65: 10, 66: 30, 67: 40, 68: 50, 69: 100 };
        if (hpBonusMap[sp] !== undefined) this.setDigit(d.hp_2p, hpBonusMap[sp]);
        else this.setDigit(d.hp_2p, '');
        if (hasMpGain) this.setMpDigit(d.st_2p, 5);
        else this.setDigit(d.st_2p, '');
        this.setPpDigit(d.df_2p, 5);
      }
    },

    /* select_end_state(6433-6494) */
    fxSelectEndState: function () {
      var self = this, s = this.state, d = this.el.digits;
      var isBattleGetRunning = !!(this.fx && this.fx.kind === 'battle_get');
      this.clearFx();                                  /* 6440-6442 */
      var r = BB2.State.selectEndState(s, isBattleGetRunning);
      if (!r) return;
      if (r.action === 'enter_select') {               /* 6463-6465 select() 起動 */
        var sel = r.selectInfo;
        if (!sel) return;
        this.label('battle_label', false);
        this.label('power_label', true);
        this.label('hp_label', true);
        this.label('damage_label', false);
        this.label('st_label', false);
        this.label('df_label', false);
        this.label('pp_label', true);
        this.label('mp_label', sel.selectMpEnable);
        this.setDigit(d.hp_1p, sel.hp);
        this.setPpDigit(d.df_1p, sel.pp);
        this.setDigit(d.hp_2p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_2p, '');
        if (sel.selectMpEnable) this.setMpDigit(d.st_1p, sel.mp);
        else this.setDigit(d.st_1p, '');
        this.startFx('select', 150, 0, function (n) {
          self.selectAnim(n);
        }, null);
        this.note('C2 戦闘後回復選択開始(F3/F4 または薬草・元 6437-6465 相当)');
      } else {                                         /* 6469-6493 戦利品表示復帰 */
        if (s.mode === 1) {                            /* 6481-6492(工程7-3) */
          this.startFx('battle_get', 120, 0, function (n) {
            self.battleGetAnimC1(n);
          }, null);
          this.note('C1 戦利品表示復帰(select_magic_pp_use=' + s.selectMagicPpUse + '・SET で獲得・元 6481-6492 相当)');
        } else {                                       /* 6469-6480(工程6-3) */
          this.startFx('battle_get', 120, 0, function (n) {
            self.battleGetAnimC2(n);
          }, null);
          this.note('C2 戦利品表示復帰(select_magic_pp_use=' + s.selectMagicPpUse + '・SET で獲得・元 6469-6480 相当)');
        }
      }
    },

    /* get_mp_pp(6497-6709) + display_mp_pp(6711-6776) */
    fxGetMpPp: function () {
      var self = this, s = this.state;
      this.clearFx();                                  /* 6506-6510 */
      var r = BB2.State.getMpPp(s);
      if (!r) return;
      this.playSe('decide_mp3');                       /* 6498 se.decide_mp3.play() */
      this.startFx('display_mp_pp', r.timerDelay, r.timerRepeat, function (n) {   /* 6704-6707 Timer(100,20) */
        self.displayMpPpAnimC2(n);
      }, function () {
        self.fxCardEnemyWaitC2Se();                    /* 6706 card_enemy_insert_wait_c2_se */
      });
      this.note('C2 get_mp_pp(special=' + r.special + '・Timer 100ms×20→敵カード待ちへ・元 6497-6709 相当)');
    },

    displayMpPpAnimC2: function () {
      var s = this.state, c2 = s.barcodeDataC2, d = this.el.digits;
      if (!c2 || !c2[6]) return;
      var bd = (s.friendSelectState === 1) ? c2[4] : c2[5]; /* 6714-6718 */
      var enemy = c2[6];
      if (!bd) return;
      var sp = enemy.special;
      var bothMag = (bd.job > 6 && enemy.job > 6);
      this.setDigit(d.hp_1p, bd.hp);                   /* 6727 / 6742 / 6758 */
      if (sp >= 70 && sp <= 74) {                      /* 6722-6734 */
        this.label('mp_label', false);
        this.label('st_label', true);
        this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', true);
        this.label('df_label', false);
        this.setPpDigit(d.df_1p, bd.pp);
      } else if (sp >= 75 && sp <= 79) {               /* 6737-6755 */
        this.label('mp_label', bothMag);
        this.label('st_label', !bothMag);
        if (bothMag) this.setMpDigit(d.st_1p, bd.mp);
        else this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', false);
        this.label('df_label', true);
        this.setDigit(d.df_1p, bd.df);
      } else {                                         /* 6757-6771 */
        this.label('mp_label', bothMag);
        this.label('st_label', !bothMag);
        if (bothMag) this.setMpDigit(d.st_1p, bd.mp);
        else this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', true);
        this.label('df_label', false);
        this.setPpDigit(d.df_1p, bd.pp);
      }
      this.setDigit(d.hp_2p, '');                      /* 6773-6775 */
      this.setDigit(d.st_2p, '');
      this.setDigit(d.df_2p, '');
    },

    /* show_passcode(6814-6858) */
    fxShowPasscode: function () {
      var s = this.state, d = this.el.digits;
      this.clearFx();                                  /* 6817-6821 */
      var r = BB2.State.showPasscode(s);
      if (!r) return;
      this.playSe('passcode_mp3');                     /* 6815 se.passcode_mp3.play() */
      var pc = r.passcode;
      this.setDigit(d.hp_1p, 'p' + pc.charAt(0) + pc.charAt(1));          /* 6834 */
      this.setDigit(d.hp_2p, pc.charAt(2) + pc.charAt(3) + pc.charAt(4)); /* 6835 */
      this.setDigit(d.st_1p, '');                      /* 6836-6839 */
      this.setDigit(d.st_2p, '');
      this.setDigit(d.df_1p, '');
      this.setDigit(d.df_2p, '');
      this.label('warrior_1p_label', false);           /* 6840-6849 */
      this.label('warrior_2p_label', false);
      this.label('magician_1p_label', false);
      this.label('magician_2p_label', false);
      this.label('hp_label', false);
      this.label('st_label', false);
      this.label('df_label', false);
      this.label('mp_label', false);
      this.label('pp_label', false);
      this.note('C2 パスコード表示(p' + pc + '・No.' + r.passcodeNumber + ' 適用・l_power 離す/再押下で戦利品表示へ・元 6814-6858 相当)');
    },

    /* ======================================================================================
     * 工程7-1: C1 モード 主人公入力・ワールド/ステージ/敵選択・敵出現弧(barcode2.as 6865-7756・7845-7894)
     * ====================================================================================== */

    /* 6865-6881 card_insert_retry_c1(ステージ選択中 l_power 押下で主人公カード再入力へ) */
    fxCardInsertRetryC1: function () {
      var s = this.state;
      this.clearFx();                                  /* 6873-6877 */
      BB2.State.cardInsertRetryC1(s);                  /* 6878-6879 bb2_state=4・c1CardSkipActive=true */
      this.fxCardWaitC1();                             /* 6880 */
      this.note('C1 主人公カード再入力(card_insert_retry_c1・SET でスキップ可能・元 6865-6881 相当)');
    },

    /* 6884-6967 card_insert_wait_c1 + card_insert_wait_animation_c1(Timer 500ms 無制限) */
    fxCardWaitC1: function () {
      var s = this.state, S = BB2.State, d = this.el.digits;
      if (!S.isCardWait(s)) return;
      if (s.state === S.STATES.CARD_1) {               /* 6896-6917 case 4(戦士(主人公)) */
        this.setDigit(d.hp_1p, ' =='); this.setDigit(d.st_1p, ' =='); this.setDigit(d.df_1p, ' ==');
        this.setDigit(d.hp_2p, ' =='); this.setDigit(d.st_2p, ' =='); this.setDigit(d.df_2p, ' ==');
        this.label('hp_label', true); this.label('st_label', true); this.label('df_label', true);
        this.label('warrior_1p_label', true); this.label('warrior_2p_label', false);
        this.label('magician_1p_label', false); this.label('magician_2p_label', true);
        this.label('item_label', false);
      } else if (s.state === S.STATES.CARD_2) {        /* 6920-6932 case 5(魔法使い(主人公)) */
        this.setDigit(d.hp_2p, ' =='); this.setDigit(d.st_2p, ' =='); this.setDigit(d.df_2p, ' ==');
        this.label('warrior_2p_label', false);
      }
      this.startFx('wait', 500, 0, function (n) {      /* 6888-6892 Timer(500) + 6937-6967 */
        var count = n % 2, st = this.state.state;
        if (st === S.STATES.CARD_1) {                  /* 6941-6950 case 4(戦士) */
          this.label('card_input_label', count === 0);
          this.label('warrior_1p_label', count === 0);
          this.label('magician_1p_label', false);
        } else if (st === S.STATES.CARD_2) {           /* 6951-6960 case 5(魔法使い) */
          this.label('card_input_label', count === 0);
          this.label('warrior_2p_label', false);
          this.label('magician_2p_label', count === 0);
        }
      }, null);
      this.note('C1 主人公カード入力待ち(bb2_state ' + s.state + '・Timer 500ms 点滅中・元 card_insert_wait_c1(6884) 相当)');
    },

    /* 6889-6935 card_insert_wait_c1 の静的表示設定(互換性維持ラッパー) */
    applyCardWaitStaticC1: function () {
      this.fxCardWaitC1();
    },

    /* 6976-7105 card_insert_c1(CARD_IN 押下: 主人公1枚目(戦士)・2枚目(魔法使い)) */
    fxCardInsertTriggerC1: function () {
      var s = this.state, self = this, S = BB2.State;
      this.clearFx();                                  /* 6983-6987 */
      var barcode = this.el.card_in.value;
      var r = S.cardInsertC1(s, barcode);
      if (r.ok) {
        this.playSe('card_in_mp3');                    /* 7007 / 7061 se.card_in_mp3.play() */
        if (r.before === S.STATES.CARD_1) {            /* 7021-7027 */
          this.label('warrior_1p_label', r.data.job <= 6);
          this.label('magician_1p_label', r.data.job > 6);
          this.label('card_input_label', false);
        } else {                                       /* 7075-7083 */
          this.label('warrior_2p_label', r.data.job <= 6);
          this.label('magician_2p_label', r.data.job > 6);
          this.label('card_input_label', false);
        }
        this.startFx('insert', 80, 20, function (n) {  /* 7030-7033・7084-7087 Timer(80,20) */
          self.insertAnim(r.before, n);                /* 1210-1305 card_insert_animation */
        }, function () { self.fxCardNextC1(); });
        this.note('C1 主人公カード ' + (r.before - 3) + '枚目入力成功(HP=' + r.data.hp + ' ST=' + r.data.st + ' DF=' + r.data.df + '・元 6976-7105 相当)');
      } else {
        if (r.before === S.STATES.CARD_1) {
          this.label('magician_1p_label', false);      /* 7038-7039 */
          this.label('warrior_1p_label', false);
        } else {
          this.label('magician_2p_label', false);      /* 7092-7093 */
          this.label('warrior_2p_label', false);
        }
        this.fxCardErrorC1(r.before, r.data);
      }
      this.render();
    },

    /* 7110-7136 card_insert_skip_c1(再入力時 SET で既存主人公カードをスキップ) */
    fxCardInsertSkipC1: function () {
      var s = this.state, d = this.el.digits;
      this.clearFx();                                  /* 7112-7116 */
      var r = BB2.State.cardInsertSkipC1(s);
      if (!r) return;
      if (r.nextState === BB2.State.STATES.CARD_2) {   /* 7113-7120 */
        this.label('warrior_1p_label', true);
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, r.bd);
        this.fxCardWaitC1();
        this.note('C1 1枚目(戦士)スキップ→2枚目(魔法使い)待ち(元 7113-7120 相当)');
      } else if (r.nextState === BB2.State.STATES.CARD_3) { /* 7122-7135 */
        this.label('card_input_label', false);
        this.label('magician_2p_label', true);
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.bd);
        this.label('hp_label', true);
        this.label('st_label', true);
        this.label('df_label', true);
        this.note('C1 2枚目(魔法使い)スキップ→SET でステージ選択へ(元 7122-7135 相当)');
      }
    },

    /* 7140-7279 card_insert_next_c1(カード挿入/合体演出完了) */
    fxCardNextC1: function () {
      var s = this.state, d = this.el.digits;
      var r = BB2.State.cardInsertNextC1(s);
      if (!r) return;
      if (r.before === BB2.State.STATES.CARD_1) {      /* 7159-7174 case 4 */
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, r.bd);
        this.label('hp_label', true);
        this.label('st_label', true);
        this.label('df_label', true);
        this.fxCardWaitC1();
      } else if (r.before === BB2.State.STATES.CARD_2) { /* 7177-7205 case 5 */
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, r.bd0);
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.bd1);
        this.label('hp_label', true);
        this.label('st_label', true);
        this.label('df_label', true);
        this.label('card_input_label', false);
        this.note('C1 2枚目(魔法使い)確定→SET でステージ選択へ(元 7177-7205 相当)');
      } else if (r.before === BB2.State.STATES.CARD_3) { /* 7207-7276 case 6(アイテム合体/スキップ完了→戦闘開始) */
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, r.fd0);
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.fd1);
        this.label('hp_label', true);                  /* 7208-7214 */
        this.label('st_label', true);
        this.label('df_label', true);
        this.label('mp_label', false);
        this.label('pp_label', false);
        this.label('item_label', false);
        this.label('card_input_label', false);
        if (r.hasKey) {                                /* 7216-7218 key_number()>0 なら key_label 点灯 */
          this.label('key_label', true);
        }
        this.label('warrior_1p_label', r.fd0.job <= 6);
        this.label('magician_1p_label', r.fd0.job > 6);
        this.label('warrior_2p_label', r.fd1.job <= 6);
        this.label('magician_2p_label', r.fd1.job > 6);
        var hasDown = BB2.State.specialDown(s);        /* 7274 special_down() */
        this.fxAfterSpecialDown(hasDown);
      }
    },

    /* 7282-7444 card_insert_error_animation_c1(Timer 150ms×6) + card_insert_error_back_c1 */
    fxCardErrorC1: function (before, bd) {
      var self = this, S = BB2.State;
      this.playSe('card_in_error_mp3');                /* 7037 / 7091 / 8089 se.card_in_error_mp3.play() */
      this.startFx('error', 150, 6, function (n) {     /* 7043 / 7096 / 8096 Timer(150,6) */
        var on = (n % 2) === 1;
        if (before === S.STATES.CARD_1) {              /* 7288-7327 case 4 */
          if (on) {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', true); this.label('miss_label', false);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_1p_label', bd.job < 7); this.label('magician_1p_label', bd.job >= 7); this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('miss_label', false);
            }
          } else {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_1p_label', false); this.label('magician_1p_label', false); this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('miss_label', true);
            }
          }
        } else if (before === S.STATES.CARD_2) {       /* 7330-7369 case 5 */
          if (on) {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', true); this.label('miss_label', false);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', bd.job < 7); this.label('magician_2p_label', bd.job >= 7); this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('miss_label', false);
            }
          } else {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', false); this.label('magician_2p_label', false); this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('miss_label', true);
            }
          }
        } else {                                       /* 7371-7410 case 6(アイテム) */
          if (on) {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', true); this.label('miss_label', false);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', bd.job < 7); this.label('magician_2p_label', bd.job >= 7); this.label('miss_label', false);
            } else {
              this.label('card_input_label', true); this.label('miss_label', false);
            }
          } else {
            if (bd && bd.race > 4) {
              this.label('card_input_label', true); this.label('item_label', false); this.label('miss_label', true);
            } else if (bd && bd.race <= 4) {
              this.label('warrior_2p_label', false); this.label('magician_2p_label', false); this.label('miss_label', true);
            } else {
              this.label('card_input_label', false); this.label('miss_label', true);
            }
          }
        }
      }, function () { self.fxErrorBackC1(); });
      this.note('C1 カード入力エラー(Timer 150ms×6 → card_insert_error_back_c1・元 7282-7444 相当)');
    },

    /* 7417-7444 card_insert_error_back_c1 */
    fxErrorBackC1: function () {
      var s = this.state;
      this.label('item_label', false);                 /* 7426-7428 */
      this.label('card_input_label', false);
      this.label('miss_label', false);
      if (s.state < BB2.State.STATES.CARD_3) {         /* 7439-7443 */
        this.fxCardWaitC1();
      } else {
        this.fxSetFriendStateC1();
      }
      this.render();
    },

    /* 7446-7484 c1_stage_select_click(2枚目確定後 SET でワールド選択へ) */
    fxC1StageSelectClick: function () {
      var s = this.state;
      BB2.State.c1StageSelectClick(s);
      this.fxC1StageSelect();
    },

    /* 7489-7544 c1_stage_select(ステージ/ワールド選択ループ: SELECT=次ワールド・SET=決定・l_power=主人公再入力) */
    fxC1StageSelect: function () {
      var s = this.state, d = this.el.digits;
      var r = BB2.State.c1StageSelect(s);
      if (!r) return;
      this.playSe('critical_mp3');                     /* 7490 se.critical_mp3.play() */
      this.clearDigits();                              /* 7517-7524 */
      this.setDigit(d.hp_1p, r.stageText);
      this.setDigit(d.hp_2p, r.worldText);
      this.label('battle_label', false);               /* 7493-7511 */
      this.label('card_input_label', false);
      this.label('escape_label', false);
      this.label('power_label', false);
      this.label('critical_label', false);
      this.label('miss_label', false);
      this.label('magician_1p_label', false);
      this.label('warrior_1p_label', false);
      this.label('key_label', false);
      this.label('item_label', false);
      this.label('infomation_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('hp_label', false);
      this.label('damage_label', false);
      this.label('st_label', false);
      this.label('mp_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.startFx('c1_stage_enemy', 150, 0, function (n) { /* 7529-7533 Timer(150) */
        this.stageEnemyAnimC1(n);
      }, null);
      this.note('C1 ステージ選択(Stage=' + r.stageText + ' World=' + r.worldText +
        '・SELECT でワールド切替・SET で決定・l_power で主人公再入力・元 7489-7544 相当)');
      this.render();
    },

    /* 7547-7589 c1_stage_select_from_escape(にげる成功後にステージ選択へ復帰) */
    fxC1StageSelectFromEscape: function () {
      var s = this.state, d = this.el.digits;
      var r = BB2.State.c1StageSelectFromEscape(s);
      if (!r) return;
      this.clearDigits();                              /* 7571-7578 */
      this.setDigit(d.hp_1p, r.stageText);
      this.setDigit(d.hp_2p, r.worldText);
      this.label('battle_label', false);               /* 7550-7568 */
      this.label('card_input_label', false);
      this.label('escape_label', false);
      this.label('power_label', false);
      this.label('critical_label', false);
      this.label('miss_label', false);
      this.label('magician_1p_label', false);
      this.label('warrior_1p_label', false);
      this.label('key_label', false);
      this.label('item_label', false);
      this.label('infomation_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('hp_label', false);
      this.label('damage_label', false);
      this.label('st_label', false);
      this.label('mp_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.startFx('c1_stage_enemy', 150, 0, function (n) { /* 7583-7587 Timer(150) */
        this.stageEnemyAnimC1(n);
      }, null);
      this.note('C1 逃走後ステージ選択復帰(Stage=' + r.stageText + ' World=' + r.worldText + '・元 7547-7589 相当)');
      this.render();
    },

    /* 7593-7602 stage_enemy_animation */
    stageEnemyAnimC1: function (n) {
      var w = this.state.c1WorldData, d = this.el.digits;
      if (!w) return;
      var wt = String(w.world[w.select_world]);
      if (n % 2 === 1) {                               /* 7595-7597 */
        this.setDigit(d.hp_2p, wt);
      } else {                                         /* 7598-7600 */
        this.setDigit(d.hp_2p, wt.slice(0, 2));
      }
    },

    /* 7606-7620 c1_stage_enemy_select(SELECT 押下でワールド切替) */
    fxC1StageEnemySelect: function () {
      var s = this.state, d = this.el.digits;
      var r = BB2.State.c1StageEnemySelect(s);
      if (r) {
        this.playSe('select_mp3');                     /* 7607 se.select_mp3.play() */
        this.setDigit(d.hp_2p, r.worldText);
        this.note('C1 ワールド切替(World=' + r.worldText + '・元 7606-7620 相当)');
      }
    },

    /* 7622-7625 c1_stage_select_set(逃走後等に即座に敵決定へ) */
    fxC1StageSelectSet: function () {
      this.fxC1StageSelectFromEscape();
      this.fxC1StageEnemySet();
    },

    /* 7628-7680 c1_stage_enemy_set + call_enemy(SET 押下で敵抽選・呼び出し演出 Timer 120ms×15) */
    fxC1StageEnemySet: function () {
      var s = this.state, self = this, d = this.el.digits;
      this.clearFx();                                  /* 7647-7651 */
      var r = BB2.State.c1StageEnemySet(s);
      if (!r) return;
      this.playSe('decide_mp3');                       /* 7629 se.decide_mp3.play() */
      this.setDigit(d.hp_2p, r.worldText);             /* 7661 */
      this.setDigit(d.st_2p, r.enemyText);             /* 7662 */
      this.startFx('call_enemy', r.timerDelay, r.timerRepeat, function (n) { /* 7664-7669 Timer(120,15) */
        this.callEnemyAnimC1(n, r.enemyText);
      }, function () { self.fxAppearEnemyC1(); });
      this.note('C1 敵呼び出し演出(World=' + r.worldText + ' Enemy=' + r.enemyText + '・Timer 120ms×15 → appear_enemy・元 7628-7680 相当)');
    },

    /* 7673-7680 call_enemy_animation */
    callEnemyAnimC1: function (n, enemyText) {
      var d = this.el.digits;
      if (n % 2 === 1) {                               /* 7675-7676 */
        this.setDigit(d.st_2p, enemyText);
      } else {                                         /* 7677-7679 */
        this.setDigit(d.st_2p, '');
      }
    },

    /* 7685-7721 appear_enemy + appear_enemy_animation_c1(Timer 80ms×20 → select_friend_c1) */
    fxAppearEnemyC1: function () {
      var s = this.state, self = this, d = this.el.digits;
      var r = BB2.State.appearEnemy(s);                /* 7693 */
      if (!r) return;
      this.playSe('card_in_mp3');                      /* 7694 se.card_in_mp3.play() */
      this.setDigit(d.hp_1p, '');                      /* 7696-7698 */
      this.setDigit(d.st_1p, '');
      this.setDigit(d.df_1p, '');
      this.startFx('appear_enemy', r.timerDelay, r.timerRepeat, function (n) { /* 7699-7704 Timer(80,20) */
        this.appearEnemyAnimC1(n);
      }, function () { self.fxSelectFriendC1(); });
      this.note('C1 敵出現(HP=' + r.enemy.hp + ' ST=' + r.enemy.st + ' DF=' + r.enemy.df + ' job=' + r.enemy.job +
        '・Timer 80ms×20 → select_friend_c1・元 7685-7721 相当)');
      this.render();
    },

    /* 7709-7721 appear_enemy_animation_c1 */
    appearEnemyAnimC1: function (n) {
      var d = this.el.digits;
      if (n % 2 === 1) {                               /* 7711-7714 */
        this.setDigit(d.hp_2p, ' ==');
        this.setDigit(d.st_2p, ' ==');
        this.setDigit(d.df_2p, ' ==');
      } else {                                         /* 7715-7719 */
        this.setDigit(d.hp_2p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_2p, '');
      }
    },

    /* 7724-7756 select_friend_c1 + 7845-7894 friend_select_animation_c1(Timer 300ms 無制限・SELECT/SET は工程7-2で接続) */
    fxSelectFriendC1: function () {
      var s = this.state, d = this.el.digits;
      var r = BB2.State.selectFriendC1(s);             /* 7724-7755 */
      if (!r) return;
      var e = r.enemy;
      this.setDigit(d.hp_1p, ' ==');                   /* 7734-7736 */
      this.setDigit(d.st_1p, ' ==');
      this.setDigit(d.df_1p, ' ==');
      this.showCard(d.hp_2p, d.st_2p, d.df_2p, e);     /* 7737-7739 */
      this.label('warrior_2p_label', e.job <= 6);      /* 7740-7746 */
      this.label('magician_2p_label', e.job > 6);
      this.startFx('c1_friend', 300, 0, function (n) { /* 7748-7752 Timer(300) */
        this.friendSelectAnimC1(n);
      }, null);
      this.note('C1 出撃キャラ選択待ち(friend=' + s.friendSelectStateC1 + '・SELECT切替/SET決定・アイテム/パスコード/戦闘終了は工程7-2・元 7724-7756/7845-7894 相当)');
      this.render();
    },

    /* 7845-7894 friend_select_animation_c1 */
    friendSelectAnimC1: function (n) {
      var s = this.state, d = this.el.digits, c = n % 2;
      var c1 = s.barcodeDataC1;
      if (!c1) return;
      if (s.friendSelectStateC1 === 0) {               /* 7849-7866 case 0 */
        if (c === 1) {
          this.label('warrior_1p_label', !!(c1[4] && c1[4].live));
          this.label('magician_1p_label', !!(c1[5] && c1[5].live));
        } else {
          this.label('warrior_1p_label', false);
          this.label('magician_1p_label', false);
        }
      } else if (s.friendSelectStateC1 === 1) {        /* 7868-7879 case 1 */
        this.label('warrior_1p_label', c === 1);
        this.label('magician_1p_label', false);
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, c1[4]);
      } else if (s.friendSelectStateC1 === 2) {        /* 7881-7892 case 2 */
        this.label('magician_1p_label', c === 1);
        this.label('warrior_1p_label', false);
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, c1[5]);
      }
    },

    /* ======================================================================================
     * 工程7-2: C1 逃走・出撃キャラ決定・アイテム入力/スキップ・パスコード入力弧(2038-2098, 7761-8515)
     * ====================================================================================== */

    /* 2038-2079 escape(戦闘中 r_power 押下で逃走試行) */
    fxEscape: function () {
      var s = this.state, self = this;
      this.battleWin = null;                           /* 2039-2042 */
      if (this.battleFx) {                             /* 2047-2051 / 2067-2071 */
        global.clearInterval(this.battleFx.id);
        this.battleFx = null;
      }
      this.label('battle_label', false);               /* 2052-2053 / 2068-2069 */
      this.label('power_label', false);
      var r = BB2.State.escape(s);
      if (r.escaped) {                                 /* 2045-2063 逃走成功 */
        this.label('escape_label', true);              /* 2054 */
        this.playSe('status_down_mp3');                /* 2057 se.status_down_mp3.play() */
        this.startFx('escape', r.timerDelay, r.timerRepeat, function (n) { /* 2059-2062 Timer(150,15) */
          this.escapeAnimC1(n);
        }, function () { self.fxC1StageSelectSet(); });
        this.note('C1 戦闘中逃走成功(Timer 150ms×15 → c1_stage_select_set・元 2045-2063 相当)');
      } else {                                         /* 2064-2077 逃走失敗 */
        this.playSe('card_in_error_mp3');              /* 2066 se.card_in_error_mp3.play() */
        this.startFx('escape_fail', r.timerDelay, r.timerRepeat, function (n) { /* 2072-2075 Timer(100,8) */
          this.escapeFailedAnimC1(n);
        }, function () { self.fxEscapeFailedBattleWaiting(); });
        this.note('C1 戦闘中逃走失敗(Timer 100ms×8 → escape_failed_battle_waiting・元 2064-2077 相当)');
      }
    },

    /* 2082-2098 escape_failed_battle_waiting(戦闘中逃走失敗後、敵ターンで battle_waiting 再開) */
    fxEscapeFailedBattleWaiting: function () {
      var s = this.state;
      this.label('escape_label', false);               /* 2084-2085 */
      this.label('miss_label', false);
      var r = BB2.State.escapeFailedBattleWaiting(s);  /* 2083, 2097 */
      if (!r) return;
      if (r.battleEnd) {
        this.fxCallBattleEnd();
        return;
      }
      this.fxBattleWaiting(r);
    },

    /* 7761-7789 escape_from_battle(出撃キャラ選択前の r_power 押下で逃走試行) */
    fxEscapeFromBattle: function () {
      var s = this.state, self = this;
      this.clearFx();                                  /* 7765-7769 */
      var r = BB2.State.escapeFromBattle(s);
      if (!r) return;
      this.label('escape_label', true);                /* 7763 */
      if (r.escaped) {                                 /* 7772-7779 逃走成功 */
        this.playSe('status_down_mp3');                /* 7774 se.status_down_mp3.play() */
        this.startFx('escape', r.timerDelay, r.timerRepeat, function (n) { /* Timer(150,15) */
          this.escapeAnimC1(n);
        }, function () { self.fxC1StageSelectClick(); });
        this.note('C1 戦闘前逃走成功(Timer 150ms×15 → c1_stage_select_click・元 7772-7779 相当)');
      } else {                                         /* 7780-7788 逃走失敗 */
        this.playSe('card_in_error_mp3');              /* 7782 se.card_in_error_mp3.play() */
        this.startFx('escape_fail', r.timerDelay, r.timerRepeat, function (n) { /* Timer(100,8) */
          this.escapeFailedAnimC1(n);
        }, function () { self.fxEscapeFromBattleFailedComplete(); });
        this.note('C1 戦闘前逃走失敗(Timer 100ms×8 → escape_from_battle_failed_animaton_complete・元 7780-7788 相当)');
      }
    },

    /* 7792-7801 escape_from_battle_failed_animaton */
    escapeFailedAnimC1: function (n) {
      var on = (n % 2) === 1;
      this.label('escape_label', on);                  /* 7795 / 7798 */
      this.label('miss_label', !on);                   /* 7796 / 7799 */
    },

    /* 7804-7820 escape_from_battle_failed_animaton_complete */
    fxEscapeFromBattleFailedComplete: function () {
      this.label('escape_label', false);               /* 7805-7806 */
      this.label('miss_label', false);
      this.startFx('c1_friend', 300, 0, function (n) { /* 7815-7819 Timer(300) */
        this.friendSelectAnimC1(n);
      }, null);
      this.note('C1 戦闘前逃走失敗完了→出撃キャラ選択アニメーション再開(元 7804-7820 相当)');
    },

    /* 7823-7839 escape_from_battle_animation */
    escapeAnimC1: function (n) {
      var d = this.el.digits;
      this.label('warrior_1p_label', false);           /* 7824-7826 */
      this.label('magician_1p_label', false);
      this.label('key_label', false);
      var t = (n % 2) === 1 ? ' ==' : '';              /* 7829-7837 */
      this.setDigit(d.hp_1p, t);
      this.setDigit(d.st_1p, t);
      this.setDigit(d.df_1p, t);
    },

    /* 7896-7926 add_friend_state_c1(SELECT 押下で出撃キャラ切替) */
    fxAddFriendStateC1: function () {
      var r = BB2.State.addFriendStateC1(this.state);
      if (!r) return;
      this.playSe('select_mp3');                       /* 7897 se.select_mp3.play() */
      this.note('C1 出撃キャラ切替(friend=' + r.friendSelectStateC1 + '・SET で決定・元 7896-7926 相当)');
    },

    /* 7928-7960 set_friend_state_c1(SET 押下で出撃キャラ決定→アイテムカード入力待ち) */
    fxSetFriendStateC1: function () {
      var s = this.state;
      this.playSe('decide_mp3');                       /* 7929 se.decide_mp3.play() */
      this.clearFx();                                  /* 7934-7938 */
      BB2.State.setFriendStateC1(s);
      this.startFx('wait', 200, 0, function (n) {      /* 7940-7944 Timer(200) */
        this.setFriendItemAnimC1(n);
      }, null);
      this.note('C1 アイテムカード入力待ち(CARD_IN でアイテム入力・SET でスキップ・元 7928-7960 相当)');
      this.render();
    },

    /* 7963-7978 card_insert_next_set_c1(SET 押下でアイテムスキップ→戦闘突入) */
    fxCardInsertNextSetC1: function () {
      this.playSe('decide_mp3');                       /* 7964 se.decide_mp3.play() */
      this.clearFx();                                  /* 7971-7975 */
      this.state.c1ItemWaitActive = false;
      this.state.barcodeDataC1[6] = null;              /* 7969 */
      this.fxCardNextC1();                             /* 7977 */
    },

    /* 7982-8014 set_friend_item_animation_c1 */
    setFriendItemAnimC1: function (n) {
      var s = this.state, on = (n % 2) === 1;
      if (s.friendSelectStateC1 === 1) {               /* 7986-7997 case 1(戦士) */
        this.label('item_label', on);
        this.label('warrior_1p_label', on);
        this.label('card_input_label', on);
        this.label('magician_1p_label', false);
      } else if (s.friendSelectStateC1 === 2) {        /* 7999-8010 case 2(魔法使い) */
        this.label('item_label', on);
        this.label('magician_1p_label', on);
        this.label('card_input_label', on);
        this.label('warrior_1p_label', false);
      }
    },

    /* 8016-8101 card_item_insert_c1(CARD_IN 押下でアイテム/情報カード入力) */
    fxCardItemInsertTriggerC1: function () {
      var s = this.state, self = this;
      this.clearFx();                                  /* 8022-8026 */
      var r = BB2.State.cardItemInsertC1(s, this.el.card_in.value);
      if (!r) return;
      if (r.ok) {                                      /* 8062-8086 */
        this.playSe('card_in_mp3');                    /* 8063 se.card_in_mp3.play() */
        this.label('warrior_2p_label', r.item.job <= 6);
        this.label('magician_2p_label', r.item.job > 6);
        this.label('warrior_1p_label', s.friendSelectStateC1 === 1);
        this.label('magician_1p_label', s.friendSelectStateC1 !== 1);
        this.label('hp_label', true);
        this.label('st_label', true);
        this.label('df_label', true);
        this.label('card_input_label', false);
        this.startFx('insert', 80, 40, function (n) {  /* 8082-8085 Timer(80,40) */
          this.cardInsertItemAnimC1(n);
        }, function () { self.fxCardNextC1(); });
        this.note('C1 アイテムカード入力成功(Timer 80ms×40 → card_insert_next_c1・元 8016-8086 相当)');
      } else {                                         /* 8088-8100 */
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', false);
        this.label('hp_label', true);
        this.label('st_label', true);
        this.label('df_label', true);
        this.fxCardErrorC1(BB2.State.STATES.CARD_3, r.item);
      }
      this.render();
    },

    /* 8388-8509 card_insert_animation_c1(case 6: アイテム/情報カード挿入演出) */
    cardInsertItemAnimC1: function (n) {
      var s = this.state, d = this.el.digits, c = n % 2;
      var item = s.barcodeDataC1 ? s.barcodeDataC1[6] : null;
      if (!item) return;
      var hero = (s.friendSelectStateC1 === 1) ? s.barcodeDataC1[4] : s.barcodeDataC1[5];
      if (n <= 20) {                                   /* 8396-8455 点滅表示 */
        if (item.race === 9 && item.job > 6) {         /* 8398-8411 薬草アップ/MPアップ */
          this.label('hp_label', true);
          this.label('st_label', false);
          this.label('df_label', false);
          this.label('mp_label', true);
          this.label('pp_label', true);
          if (hero) {
            this.setMpDigit(d.st_1p, hero.mp);
            this.setPpDigit(d.df_1p, hero.pp);
          }
        } else if (item.race === 9 && (item.job === 5 || item.job === 6)) { /* 8413-8424 情報カード */
          this.setDigit(d.hp_1p, '');
          this.setDigit(d.st_1p, '');
          this.setDigit(d.df_1p, '');
          this.label('warrior_1p_label', false);
          this.label('magician_1p_label', false);
          this.label('hp_label', false);
          this.label('st_label', false);
          this.label('df_label', false);
          this.label('mp_label', false);
          this.label('pp_label', false);
        } else {                                       /* 8425-8431 通常アイテム */
          this.label('hp_label', true);
          this.label('st_label', true);
          this.label('df_label', true);
          this.label('mp_label', false);
          this.label('pp_label', false);
        }
        if (item.race > 4) {                           /* 8441-8445 */
          this.label('warrior_2p_label', false);
          this.label('magician_2p_label', false);
          this.label('item_label', true);
        }
        var t = (c === 1) ? ' ==' : '';                /* 8447-8455 */
        this.setDigit(d.hp_2p, t);
        this.setDigit(d.st_2p, t);
        this.setDigit(d.df_2p, t);
      } else {                                         /* 8457-8504 入力パラメータ表示 */
        if (item.race === 9 && item.job > 6) {         /* 8459-8470 薬草アップ/MPアップ */
          this.setDigit(d.hp_2p, '');
          if (item.mp > 0) this.setMpDigit(d.st_2p, item.mp); else this.setDigit(d.st_2p, '');
          if (item.pp > 0) this.setPpDigit(d.df_2p, item.pp); else this.setDigit(d.df_2p, '');
        } else if (item.race === 9 && (item.job === 5 || item.job === 6)) { /* 8472-8486 情報カード */
          if (n % 8 >= 4 && s.c1WorldData) {
            var ik = s.c1WorldData.infomation_key();
            this.label('infomation_label', true);
            this.label('key_label', true);
            this.setDigit(d.hp_2p, 'L-' + ik.charAt(1));
            this.setDigit(d.st_2p, item.job === 6 ? (' 0' + ik.slice(-1)) : '');
            this.setDigit(d.df_2p, '');
          } else {
            this.label('infomation_label', false);
            this.label('key_label', false);
          }
        } else {                                       /* 8487-8503 通常アイテム */
          this.setDigit(d.hp_2p, item.hp > 0 ? item.hp : '');
          this.setDigit(d.st_2p, item.st > 0 ? (item.st > 199 ? 199 : item.st) : '');
          this.setDigit(d.df_2p, item.df > 0 ? (item.df > 199 ? 199 : item.df) : '');
        }
      }
    },

    /* 8107-8158 c1_input_passcode(ステージ選択中 l_battle 押下で3桁パスコード入力開始) */
    fxC1InputPasscode: function () {
      var s = this.state, d = this.el.digits;
      this.clearFx();                                  /* 8114-8118 */
      var r = BB2.State.c1InputPasscode(s);
      this.label('battle_label', false);               /* 8121-8139 */
      this.label('card_input_label', false);
      this.label('escape_label', false);
      this.label('power_label', false);
      this.label('critical_label', false);
      this.label('miss_label', false);
      this.label('magician_1p_label', false);
      this.label('warrior_1p_label', false);
      this.label('key_label', false);
      this.label('item_label', false);
      this.label('infomation_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('hp_label', false);
      this.label('damage_label', false);
      this.label('st_label', false);
      this.label('mp_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.setDigit(d.hp_1p, ' F-');                   /* 8141-8146 */
      this.setDigit(d.st_1p, '');
      this.setDigit(d.df_1p, '');
      this.setDigit(d.hp_2p, r.passcode);
      this.setDigit(d.st_2p, '');
      this.setDigit(d.df_2p, '');
      this.startFx('c1_passcode', 100, 0, function (n) { /* 8148-8152 Timer(100) */
        this.c1InputAnim(n);
      }, null);
      this.note('C1 パスコード入力開始(F- / 000・SELECT で加算・SET で桁確定・元 8107-8158 相当)');
    },

    /* 8163-8191 c1_input_animation */
    c1InputAnim: function (n) {
      var s = this.state, d = this.el.digits, pc = s.c1Passcode;
      if (n % 2 === 1) {                               /* 8168 / 8176 / 8184 */
        this.setDigit(d.hp_2p, pc);
      } else if (s.c1PasscodeState === 0) {            /* 8171 */
        this.setDigit(d.hp_2p, ' ' + pc.charAt(1) + pc.charAt(2));
      } else if (s.c1PasscodeState === 1) {            /* 8179 */
        this.setDigit(d.hp_2p, pc.charAt(0) + ' ' + pc.charAt(2));
      } else if (s.c1PasscodeState === 2) {            /* 8187 */
        this.setDigit(d.hp_2p, pc.charAt(0) + pc.charAt(1) + ' ');
      }
    },

    /* 8194-8217 c1_input_add_passcode */
    fxC1InputAddPasscode: function () {
      var r = BB2.State.c1InputAddPasscode(this.state);
      if (!r) return;
      this.playSe('select_mp3');                       /* 8196 se.select_mp3.play() */
      this.note('C1 パスコード加算(' + r.passcode + '・桁=' + r.passcodeState + '・元 8194-8217 相当)');
    },

    /* 8220-8315 c1_input_set_passcode + execute_c1_passcode */
    fxC1InputSetPasscode: function () {
      var s = this.state, self = this, d = this.el.digits;
      var r = BB2.State.c1InputSetPasscode(s);
      if (!r) return;
      this.playSe('decide_mp3');                       /* 8221 se.decide_mp3.play() */
      if (!r.done) {
        this.note('C1 パスコード桁確定(次桁=' + r.passcodeState + '・現在=' + r.passcode + '・元 8220-8233 相当)');
        return;
      }
      this.clearFx();                                  /* 8224-8228 */
      this.setDigit(d.hp_2p, r.passcode);              /* 8238 */
      if (r.result === 'powerup') {                    /* 8243-8263 */
        this.label('hp_label', true);
        this.label('st_label', true);
        this.label('df_label', true);
        this.playSe('card_in_mp3');                    /* 8254 se.card_in_mp3.play() */
        this.startFx('c1_powerup', r.timerDelay, r.timerRepeat, function (n) { /* Timer(60,70) */
          this.passcodePowerUpAnimC1(n);
        }, function () { self.fxPasscodePowerUpCompleteC1(); });
        this.note('C1 パワーアップパスコード成功(' + r.passcode + '・Timer 60ms×70 → c1_stage_select・元 8243-8263 相当)');
      } else if (r.result === 'jump') {                /* 8266-8303 */
        this.fxC1StageSelect();
        this.note('C1 ステージジャンプパスコード成功(' + r.passcode + ' → Stage index ' + r.selectStage + '・元 8266-8303 相当)');
      } else {                                         /* 8306-8314 エラー */
        this.playSe('card_in_error_mp3');              /* 8308 se.card_in_error_mp3.play() */
        this.startFx('c1_passcode_err', r.timerDelay, r.timerRepeat, function (n) { /* Timer(150,10) */
          this.c1PasscodeErrorAnim(n);
        }, function () { self.fxC1StageSelectClick(); });
        this.note('C1 パスコードエラー(' + r.passcode + '・Timer 150ms×10 → c1_stage_select_click・元 8306-8314 相当)');
      }
    },

    /* 8319-8354 passcode_power_up_animation_c1 */
    passcodePowerUpAnimC1: function (n) {
      var c1 = this.state.barcodeDataC1, d = this.el.digits;
      if (!c1) return;
      if (n <= 30) {                                   /* 8323-8342 */
        if (n % 2 === 1) {
          this.showCard(d.hp_1p, d.st_1p, d.df_1p, c1[2]);
          this.showCard(d.hp_2p, d.st_2p, d.df_2p, c1[3]);
          this.label('warrior_1p_label', true);
          this.label('magician_2p_label', true);
        } else {
          this.clearDigits();
          this.label('warrior_1p_label', false);
          this.label('magician_2p_label', false);
        }
      } else {                                         /* 8343-8352 */
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, c1[4]);
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, c1[5]);
        this.label('warrior_1p_label', true);
        this.label('magician_2p_label', true);
      }
    },

    /* 8356-8372 passcode_power_up_complete */
    fxPasscodePowerUpCompleteC1: function () {
      this.fxC1StageSelect();
    },

    /* 8378-8385 c1_passcode_error_animation */
    c1PasscodeErrorAnim: function (n) {
      this.label('miss_label', (n % 2) === 1);
    },

    /* =======================================================================================
       C1 モード 工程7-3: 戦闘終了(battle_end_c1・鍵取得/喪失・defeat_boss・show_passcode_c1・
       battle_end_l_power(復活/情報抽選)・card_insert_wait_c1_back(仲間交代)・get_mp_pp_c1)
       ======================================================================================= */

    /* 8518-8699 battle_end_c1 */
    fxBattleEndC1: function () {
      var self = this, s = this.state, d = this.el.digits;
      this.clearFx();
      var r = BB2.State.battleEndC1(s);
      if (!r) return;
      if (r.action === 'get_key') {                    /* 8531-8599 鍵入手演出→完了時 battle_end_c1 再入 */
        this.label('battle_label', false);
        this.label('st_label', false);
        this.label('df_label', false);
        this.label('power_label', false);
        this.label('hp_label', false);
        this.label('damage_label', false);
        this.label('pp_label', false);
        this.label('mp_label', false);
        this.label('magician_1p_label', false);
        this.label('warrior_1p_label', false);
        this.label('warrior_2p_label', false);
        this.label('magician_2p_label', false);
        this.label('item_label', true);
        if (s.friendSelectStateC1 === 1) {
          this.label('warrior_1p_label', true);
        } else {
          this.label('magician_1p_label', true);
        }
        this.clearDigits();
        if (r.hadKey === 1) this.setDigit(d.df_1p, '  *  ');
        else if (r.hadKey === 2) this.setDigit(d.df_1p, ' **  ');
        this.setDigit(d.df_2p, '  *  ');
        this.playSe('status_down_mp3');                /* 8587 se.status_down_mp3.play() */
        this.startFx('get_key_c1', r.timerDelay, r.timerRepeat, function (n) {
          self.getKeyAnimC1(n);
        }, function () {
          self.fxBattleEndC1();
        });
        this.note('C1 鍵取得演出開始(hadKey=' + r.hadKey + '→hasKey=' + r.hasKey + '・Timer 150ms×20・元 8531-8599 相当)');
        return;
      }
      if (r.action === 'defeat_boss') {                /* 8604-8612 L-H ボス HH 撃破 */
        this.fxDefeatBoss(r);
        return;
      }
      if (r.action === 'battle_get') {                 /* 8613-8620 戦利品獲得待ち */
        this.startFx('battle_get', r.timerDelay, 0, function (n) {
          self.battleGetAnimC1(n);
        }, null);
        this.note('C1 戦闘勝利・戦利品獲得待ち(l_power=復活/情報抽選・SELECT=回復・SET=獲得・元 8613-8620 相当)');
        return;
      }
      if (r.action === 'lose_key') {                   /* 8630-8668 鍵喪失演出→完了時 battle_end_c1 再入 */
        this.label('battle_label', false);
        this.label('st_label', false);
        this.label('df_label', false);
        this.label('power_label', false);
        this.label('hp_label', false);
        this.label('damage_label', false);
        this.label('pp_label', false);
        this.label('mp_label', false);
        this.label('item_label', true);
        this.clearDigits();
        if (r.hadKey === 1) this.setDigit(d.df_1p, '  *  ');
        else if (r.hadKey === 2) this.setDigit(d.df_1p, ' **  ');
        else if (r.hadKey === 3) this.setDigit(d.df_1p, '***  ');
        this.playSe('status_down_mp3');                /* 8665 se.status_down_mp3.play() */
        this.startFx('get_key_c1', r.timerDelay, r.timerRepeat, function (n) {
          self.getKeyAnimC1(n);
        }, function () {
          self.fxBattleEndC1();
        });
        this.note('C1 鍵喪失演出開始(hadKey=' + r.hadKey + '→hasKey=' + r.hasKey + '・Timer 150ms×20・元 8630-8668 相当)');
        return;
      }
      if (r.action === 'lose_choice') {                /* 8672-8697 敗北後選択(SELECT=ステージ選択 / SET=仲間交代) */
        this.label('battle_label', false);
        this.label('st_label', true);
        this.label('df_label', true);
        this.label('power_label', false);
        this.label('hp_label', true);
        this.label('damage_label', false);
        this.label('pp_label', false);
        this.label('mp_label', false);
        this.label('item_label', r.hasKey);
        this.setDigit(d.hp_1p, '');
        this.setDigit(d.st_1p, '');
        this.setDigit(d.df_1p, '');
        this.showCard(d.hp_2p, d.st_2p, d.df_2p, r.enemy);
        this.note('C1 味方1人敗北・選択待ち(SELECT=ステージ選択 / SET=残存仲間交代・元 8672-8697 相当)');
      }
    },

    /* 9321-9345 get_key_animation */
    getKeyAnimC1: function (n) {
      var s = this.state, d = this.el.digits;
      if (n % 2 === 1) {
        if (s.hasKeyNumber === 0) this.setDigit(d.df_1p, '');
        else if (s.hasKeyNumber === 1) this.setDigit(d.df_1p, '  *  ');
        else if (s.hasKeyNumber === 2) this.setDigit(d.df_1p, ' **  ');
        else if (s.hasKeyNumber === 3) this.setDigit(d.df_1p, '***  ');
        this.setDigit(d.df_2p, '');
      } else {
        if (s.hadKeyNumber === 1) this.setDigit(d.df_1p, '  *  ');
        else if (s.hadKeyNumber === 2) this.setDigit(d.df_1p, ' **  ');
        else if (s.hadKeyNumber === 3) this.setDigit(d.df_1p, '***  ');
        this.setDigit(d.df_2p, '  *  ');
      }
    },

    /* 9375-9451 battle_get_animation_c1(Timer 120ms 無制限: 2P側に獲得ボーナス点滅) */
    battleGetAnimC1: function (n) {
      var s = this.state, c1 = s.barcodeDataC1, w = s.c1WorldData, enemy = s.barcodeDataEnemy, d = this.el.digits;
      if (!c1 || !w || !enemy) return;

      this.label('key_label', w.key_number() > 0);     /* 9376-9380 */
      this.label('infomation_label', false);           /* 9381 */
      this.label('battle_label', false);
      this.label('power_label', false);
      this.label('damage_label', false);
      this.label('item_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);

      var isHero1 = (s.friendSelectStateC1 === 1);
      this.label('warrior_1p_label', isHero1);
      this.label('magician_1p_label', !isHero1);

      var bd = isHero1 ? c1[4] : c1[5];                /* 9386-9390 */
      if (!bd) return;

      this.setDigit(d.hp_1p, bd.hp);                   /* 9392 */
      this.label('hp_label', true);                    /* 9393 */

      var count = n % 2;                               /* 9383 */
      if (count === 1) {
        var bossEn = w.generate_boss_energy();
        if (bossEn !== -1) {                           /* 9397-9406 ボス */
          this.setDigit(d.hp_2p, bossEn);
          this.setDigit(d.st_2p, w.generate_st_df());
          this.setDigit(d.st_1p, bd.st);
          this.label('st_label', true);
          this.label('mp_label', false);
          this.setDigit(d.df_2p, w.generate_st_df());
          this.setDigit(d.df_1p, bd.df);
          this.label('df_label', true);
          this.label('pp_label', false);
        } else if (enemy.job <= 6) {                   /* 9408-9419 敵戦士: ST＋PP */
          this.setDigit(d.hp_2p, '');
          this.setDigit(d.st_2p, w.generate_st_df());
          this.setDigit(d.st_1p, bd.st);
          this.label('st_label', true);
          this.label('mp_label', false);
          this.setPpDigit(d.df_2p, 5);
          this.setPpDigit(d.df_1p, bd.pp);
          this.label('df_label', false);
          this.label('pp_label', true);
        } else {                                       /* 9420-9444 敵魔法使い */
          if (bd.job > 6) {                            /* 9422-9431 主人公魔法使い: MP＋DF */
            this.setDigit(d.hp_2p, '');
            this.setMpDigit(d.st_2p, 5);
            this.setMpDigit(d.st_1p, bd.mp);
            this.label('st_label', false);
            this.label('mp_label', true);
            this.setDigit(d.df_2p, w.generate_st_df());
            this.setDigit(d.df_1p, bd.df);
            this.label('df_label', true);
            this.label('pp_label', false);
          } else {                                     /* 9433-9443 主人公戦士: DF のみ */
            this.setDigit(d.hp_2p, '');
            this.setDigit(d.st_2p, '');
            this.setDigit(d.st_1p, bd.st);
            this.label('st_label', true);
            this.label('mp_label', false);
            this.setDigit(d.df_2p, w.generate_st_df());
            this.setDigit(d.df_1p, bd.df);
            this.label('df_label', true);
            this.label('pp_label', false);
          }
        }
      } else {                                         /* 9446-9450 消灯フェーズ */
        this.setDigit(d.hp_2p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_2p, '');
      }
    },

    /* 8703-8749 defeat_boss + 8788-8815 defeat_boss_animation */
    fxDefeatBoss: function (preResult) {
      var self = this, s = this.state, d = this.el.digits;
      this.clearFx();
      var r = preResult || BB2.State.defeatBoss(s);
      if (!r) return;
      this.label('battle_label', false);
      this.label('st_label', false);
      this.label('df_label', false);
      this.label('power_label', false);
      this.label('hp_label', false);
      this.label('damage_label', false);
      this.label('pp_label', false);
      this.label('mp_label', false);
      this.label('magician_1p_label', false);
      this.label('warrior_1p_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('item_label', false);
      this.clearDigits();
      this.setDigit(d.hp_1p, r.hp1Text);
      this.setDigit(d.st_1p, ' go');
      this.setDigit(d.st_2p, ' od');
      this.startFx('defeat_boss_c1', r.timerDelay, 0, function (n) {
        self.defeatBossAnimC1(n);
      }, null);
      this.note('C1 ボス撃破(hp_1p=' + r.hp1Text + '・l_power=パスコード表示・' +
        (r.canAdvanceStage ? 'SET=次ステージへ' : '最終ステージクリア') + '・元 8703-8749 相当)');
    },

    /* 8788-8815 defeat_boss_animation */
    defeatBossAnimC1: function (n) {
      var w = this.state.c1WorldData, d = this.el.digits;
      if (!w) return;
      this.clearDigits();
      if (n % 2 === 0) {
        this.setDigit(d.hp_1p, (w.select_stage <= 2) ? w.stage[w.select_stage] : 'fin');
        this.setDigit(d.st_1p, ' go');
        this.setDigit(d.st_2p, ' od');
      }
    },

    /* 8752-8786 show_passcode_c1 */
    fxShowPasscodeC1: function () {
      var s = this.state, d = this.el.digits;
      this.clearFx();
      var r = BB2.State.showPasscodeC1(s);
      if (!r || !r.passcode) return;
      this.playSe('passcode_mp3');                     /* 8753 se.passcode_mp3.play() */
      this.label('power_label', false);
      this.label('hp_label', false);
      this.label('damage_label', false);
      this.label('st_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.label('mp_label', false);
      this.label('battle_label', false);
      this.label('warrior_1p_label', false);
      this.label('magician_1p_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('item_label', false);
      this.setDigit(d.hp_1p, r.passcode.charAt(0));
      this.setDigit(d.hp_2p, '');
      this.setDigit(d.st_1p, r.passcode.charAt(1));
      this.setDigit(d.st_2p, r.passcode.charAt(2));
      this.setDigit(d.df_1p, r.passcode.charAt(3));
      this.setDigit(d.df_2p, r.passcode.charAt(4));
      this.note('C1 パスコード表示(passcodeNumber=' + r.passcodeNumber + '・l_power 離しで defeat_boss 復帰・元 8752-8786 相当)');
    },

    /* 8818-8847 defeat_boss_animation_complete */
    fxDefeatBossComplete: function () {
      var s = this.state;
      this.clearFx();
      var r = BB2.State.defeatBossComplete(s);
      if (!r || !r.stage) return;
      this.fxC1StageSelect(r.stage);
      this.note('C1 ステージクリア進行(次 select_stage=' + r.selectStage + '・パスコード強化適用・元 8818-8847 相当)');
    },

    /* 9100-9168 battle_end_l_power */
    fxBattleEndLPower: function () {
      var self = this, s = this.state, d = this.el.digits;
      this.clearFx();
      var r = BB2.State.battleEndLPower(s);
      if (!r) return;
      if (r.outcome === 'rebirth_anim') {              /* 9119-9124 相方復活演出 */
        this.startFx('rebirth_c1', r.timerDelay, r.timerRepeat, function (n) {
          self.rebirthAnimC1(n);
        }, function () {
          self.fxRebirthEndC1();
        });
        this.note('C1 相方復活演出開始(Timer 150ms×20・元 9119-9124 / 9170-9223 相当)');
        return;
      }
      if (r.outcome === 'rebirth_done') {              /* 9126 両者生存時の即時 rebirth_end */
        this.startFx('battle_get', 120, 0, function (n) {
          self.battleGetAnimC1(n);
        }, null);
        this.note('C1 rebirth_end(両者生存・戦利品獲得待ち継続・元 9126 / 9226-9250 相当)');
        return;
      }
      if (r.outcome === 'info_anim') {                 /* 9137-9141 / 9152-9156 敵鍵情報演出 */
        this.startFx('enemy_info_c1', r.timerDelay, r.timerRepeat, function (n) {
          self.enemyInfoAnimC1(n, r.enemyNumber);
        }, function () {
          self.fxEnemyInfoEndC1();
        });
        this.note('C1 敵情報演出開始(enemyNumber=' + r.enemyNumber + '・Timer 80ms×70・元 9137-9156 / 9253-9298 相当)');
        return;
      }
      if (r.outcome === 'info_skip') {                 /* 鍵3つ所持時は情報演出なし(戦利品待ち継続) */
        s.c1BattleGetActive = true;
        this.startFx('battle_get', 120, 0, function (n) {
          self.battleGetAnimC1(n);
        }, null);
        this.note('C1 l_power 情報抽選(鍵3個所持済みのためスキップ)');
        return;
      }
      /* 9129 / 9144 / 9159 / 9165 抽選外れ等で battle_end_c1 再開(c1LPowerReady=false) */
      this.startFx('battle_get', 120, 0, function (n) {
        self.battleGetAnimC1(n);
      }, null);
      this.note('C1 l_power 抽選外れ(戦利品獲得待ち継続・l_power 再押下不可・元 9129-9166 相当)');
    },

    /* 9170-9223 rebirth_animation */
    rebirthAnimC1: function (n) {
      var s = this.state, c1 = s.barcodeDataC1, d = this.el.digits;
      if (!c1) return;
      this.label('power_label', false);
      this.label('hp_label', true);
      this.label('damage_label', false);
      this.label('st_label', true);
      this.label('df_label', true);
      this.label('pp_label', false);
      this.label('mp_label', false);
      this.label('battle_label', true);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.setDigit(d.hp_2p, '');
      this.setDigit(d.st_2p, '');
      this.setDigit(d.df_2p, '');
      if (n % 2 === 1) {
        var revived = (s.friendSelectStateC1 === 1) ? c1[3] : c1[2];
        this.showCard(d.hp_1p, d.st_1p, d.df_1p, revived);
        if (s.friendSelectStateC1 === 1) {
          this.label('warrior_1p_label', false);
          this.label('magician_1p_label', true);
        } else {
          this.label('warrior_1p_label', true);
          this.label('magician_1p_label', false);
        }
      } else {
        this.setDigit(d.hp_1p, '');
        this.setDigit(d.st_1p, '');
        this.setDigit(d.df_1p, '');
      }
    },

    /* 9226-9250 rebirth_end */
    fxRebirthEndC1: function () {
      var self = this, s = this.state;
      this.clearFx();
      BB2.State.rebirthEnd(s);
      this.startFx('battle_get', 120, 0, function (n) {
        self.battleGetAnimC1(n);
      }, null);
      this.note('C1 相方復活完了(rebirth_end・戦利品獲得待ち再開・元 9226-9250 相当)');
    },

    /* 9253-9298 enemy_infomation_animation_1 / enemy_infomation_animation_2 */
    enemyInfoAnimC1: function (n, enemyNumber) {
      var w = this.state.c1WorldData, d = this.el.digits;
      if (!w) return;
      this.label('power_label', false);
      this.label('hp_label', false);
      this.label('damage_label', false);
      this.label('st_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.label('mp_label', false);
      this.label('battle_label', false);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('warrior_1p_label', false);
      this.label('magician_1p_label', false);
      this.label('item_label', true);
      var info = (enemyNumber === 1)
        ? w.get_key_enemy_infomation_1(Math.floor(n / 15))
        : w.get_key_enemy_infomation_2(Math.floor(n / 15));
      if (n % 15 <= 11) {
        this.setDigit(d.hp_1p, info[0]);
        this.setDigit(d.hp_2p, info[1]);
        this.setDigit(d.df_2p, '  *  ');
      } else {
        this.clearDigits();
      }
    },

    /* 9301-9317 enemy_infomation_end */
    fxEnemyInfoEndC1: function () {
      var self = this, s = this.state;
      this.clearFx();
      BB2.State.enemyInfomationEnd(s);
      this.startFx('battle_get', 120, 0, function (n) {
        self.battleGetAnimC1(n);
      }, null);
      this.note('C1 敵情報演出完了(enemy_infomation_end・戦利品獲得待ち再開・元 9301-9317 相当)');
    },

    /* 9348-9373 card_insert_wait_c1_back */
    fxCardInsertWaitC1Back: function () {
      var self = this, s = this.state;
      this.clearFx();
      var r = BB2.State.cardInsertWaitC1Back(s);
      if (!r) return;
      this.playSe('card_in_mp3');                      /* 9359 se.card_in_mp3.play() */
      if (r.friendSelectStateC1 === 1) {
        this.label('warrior_1p_label', true);
        this.label('magician_1p_label', false);
      } else {
        this.label('warrior_1p_label', false);
        this.label('magician_1p_label', true);
      }
      this.startFx('friend_c1', r.timerDelay, r.timerRepeat, function (n) {
        self.friendAnimC1(n);
      }, function () {
        self.fxFriendAnimC1Complete();
      });
      this.note('C1 残存仲間交代演出開始(friend_select_state_c1=' + r.friendSelectStateC1 +
        '・Timer 80ms×20・元 9348-9373 相当)');
    },

    /* 9454-9488 friend_animation_c1 */
    friendAnimC1: function (n) {
      var s = this.state, c1 = s.barcodeDataC1, d = this.el.digits;
      if (!c1) return;
      var hero = (s.friendSelectStateC1 === 1) ? c1[4] : c1[5];
      if (!hero) return;
      var hp = String(hero.hp);
      if (hero.hp < 10) hp = '  ' + hp + '00';
      else if (hero.hp < 100) hp = ' ' + hp + '00';
      else hp = hp + '00';
      var st = String((hero.st > 199) ? 199 : hero.st);
      if (hero.st < 10) st = '  ' + st + '00';
      else if (hero.st < 100) st = ' ' + st + '00';
      else st = st + '00';
      var df = String((hero.df > 199) ? 199 : hero.df);
      if (hero.df < 10) df = '  ' + df + '00';
      else if (hero.df < 100) df = ' ' + df + '00';
      else df = df + '00';
      var str = '     ';
      this.setDigit(d.hp_1p, (str + hp).substr(Math.floor(n / 4), 5));
      this.setDigit(d.st_1p, (str + st).substr(Math.floor(n / 4), 5));
      this.setDigit(d.df_1p, (str + df).substr(Math.floor(n / 4), 5));
    },

    /* 9491-9519 friend_animation_c1_complete */
    fxFriendAnimC1Complete: function () {
      var self = this, s = this.state, c1 = s.barcodeDataC1, d = this.el.digits;
      this.clearFx();
      var r = BB2.State.friendAnimationC1Complete(s);
      if (!r || !c1) return;
      var hero = (r.friendSelectStateC1 === 1) ? c1[4] : c1[5];
      this.showCard(d.hp_1p, d.st_1p, d.df_1p, hero);
      this.startFx('wait', 150, 0, function (n) {
        self.cardWaitAnimC1(n);
      }, null);
      this.note('C1 残存仲間交代完了→アイテムカード待ち(CARD_IN または SET でスキップ・元 9491-9519 相当)');
      this.render();
    },

    /* 9522-9605 get_mp_pp_c1 */
    fxGetMpPpC1: function () {
      var self = this, s = this.state;
      this.clearFx();
      var r = BB2.State.getMpPpC1(s);
      if (!r) return;
      this.playSe('decide_mp3');                       /* 9523 se.decide_mp3.play() */
      this.startFx('display_mp_pp_c1', r.timerDelay, r.timerRepeat, function (n) {
        self.displayMpPpAnimC1(n);
      }, function () {
        self.fxDisplayMpPpC1Complete();
      });
      this.note('C1 get_mp_pp_c1(bossEnergy=' + r.bossEnergy + ' stDf=' + r.stDf +
        '・Timer 100ms×20→ステージ選択へ・元 9522-9605 相当)');
    },

    /* 9614-9664 display_mp_pp_c1(Timer 100ms×20: ボーナス加算後の確定値表示) */
    displayMpPpAnimC1: function (n) {
      var s = this.state, c1 = s.barcodeDataC1, w = s.c1WorldData, enemy = s.barcodeDataEnemy, d = this.el.digits;
      if (!c1 || !w || !enemy) return;
      var isHero1 = (s.friendSelectStateC1 === 1);
      this.label('warrior_1p_label', isHero1);
      this.label('magician_1p_label', !isHero1);
      this.label('warrior_2p_label', false);
      this.label('magician_2p_label', false);
      this.label('battle_label', false);
      this.label('power_label', false);
      this.label('damage_label', false);
      this.label('item_label', false);

      var bd = isHero1 ? c1[4] : c1[5];
      if (!bd) return;

      var bossEn = w.generate_boss_energy();
      if (bossEn !== -1) {                             /* 9623-9631 */
        this.setDigit(d.hp_1p, bd.hp);
        this.label('mp_label', false);
        this.label('st_label', true);
        this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', false);
        this.label('df_label', true);
        this.setDigit(d.df_1p, bd.df);
      } else if (enemy.job > 6) {                      /* 9632-9649 */
        if (bd.job > 6) {                              /* 9633-9641 */
          this.setDigit(d.hp_1p, bd.hp);
          this.label('mp_label', true);
          this.label('st_label', false);
          this.setMpDigit(d.st_1p, bd.mp);
          this.label('pp_label', false);
          this.label('df_label', true);
          this.setDigit(d.df_1p, bd.df);
        } else {                                       /* 9642-9649 */
          this.setDigit(d.hp_1p, bd.hp);
          this.label('mp_label', false);
          this.label('st_label', true);
          this.setDigit(d.st_1p, bd.st);
          this.label('pp_label', false);
          this.label('df_label', true);
          this.setDigit(d.df_1p, bd.df);
        }
      } else {                                         /* 9650-9659 */
        this.setDigit(d.hp_1p, bd.hp);
        this.label('mp_label', false);
        this.label('st_label', true);
        this.setDigit(d.st_1p, bd.st);
        this.label('pp_label', true);
        this.label('df_label', false);
        this.setPpDigit(d.df_1p, bd.pp);
      }

      this.setDigit(d.hp_2p, '');                      /* 9661-9663 */
      this.setDigit(d.st_2p, '');
      this.setDigit(d.df_2p, '');
    },

    /* 9608-9612 display_mp_pp_c1_complete */
    fxDisplayMpPpC1Complete: function () {
      var s = this.state;
      this.clearFx();
      var stg = BB2.State.displayMpPpC1Complete(s);
      if (stg) this.fxC1StageSelect(stg);
    },

    /* =======================================================================================
       Phase 6: セーブ・ロード(save / save_animation / save_animation_complete /
       load / load_animation / load_animation_complete / load_status_animation: 8852-9098)
       ======================================================================================= */

    /* 8854-8896 save */
    fxSave: function () {
      var self = this, s = this.state;
      this.clearFx();                                  /* 8858-8862 / 8867-8871 */
      var r = BB2.State.save(s);
      if (!r) return;
      this.playSe('card_in_mp3');                      /* 8856 se.card_in_mp3.play() */
      this.label('warrior_1p_label', false);           /* 8879-8888 */
      this.label('warrior_2p_label', false);
      this.label('magician_1p_label', false);
      this.label('magician_2p_label', false);
      this.label('card_input_label', false);
      this.label('hp_label', false);
      this.label('st_label', false);
      this.label('mp_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.startFx('save_c1', r.timerDelay, 0, function (n) { /* 8890-8894 Timer(200) */
        self.saveAnimC1(n);
      }, null);
      this.note('C1 セーブ演出開始(Timer 200ms・10カウント後 SET で保存確定・元 8854-8896 相当)');
    },

    /* 8899-8939 save_animation */
    saveAnimC1: function (n) {
      var s = this.state, d = this.el.digits;
      var count = n % 2;                               /* 8901 */
      this.setDigit(d.hp_1p, ' sa');                   /* 8903 */
      this.setDigit(d.hp_2p, ' ve');                   /* 8904 */
      if (n <= 10) {                                   /* 8906-8918 */
        if (count === 1) {
          this.setDigit(d.st_1p, ' oo');
          this.setDigit(d.st_2p, ' oo');
          this.setDigit(d.df_1p, ' qq');
          this.setDigit(d.df_2p, ' qq');
        } else {
          this.setDigit(d.st_1p, ' qq');
          this.setDigit(d.st_2p, ' qq');
          this.setDigit(d.df_1p, ' oo');
          this.setDigit(d.df_2p, ' oo');
        }
      }
      if (n === 10) {                                  /* 8920-8927 */
        this.playSe('decide_mp3');                     /* 8921 se.decide_mp3.play() */
        s.c1SaveAnimCompleteReady = true;              /* 8922 set_button→save_animation_complete */
        this.setDigit(d.st_1p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_1p, '');
        this.setDigit(d.df_2p, '');
      }
      if (n >= 10) {                                   /* 8929-8937 */
        if (n % 4 >= 2) {
          this.setDigit(d.df_1p, '  e');
          this.setDigit(d.df_2p, ' nd');
        } else {
          this.setDigit(d.df_1p, '');
          this.setDigit(d.df_2p, '');
        }
      }
    },

    /* 8942-8958 save_animation_complete */
    fxSaveAnimationComplete: function () {
      var self = this, s = this.state;
      this.clearFx();                                  /* 8944-8948 */
      var r = BB2.State.saveAnimationComplete(s);
      if (!r) return;
      this.note('C1 セーブ完了(saved=' + r.saved + '・復帰先=' + r.target + '・元 8942-8958 相当)');
      if (r.target === 'battle_end_c1') {              /* 8957 call_save_function */
        this.startFx('battle_get', 120, 0, function (n) {
          self.battleGetAnimC1(n);
        }, null);
      } else if (r.stage) {
        this.fxC1StageSelect(r.stage);
      }
    },

    /* 8961-8991 load */
    fxLoad: function () {
      var self = this, s = this.state;
      this.clearFx();                                  /* 8965-8969 */
      var r = BB2.State.load(s);
      if (!r) return;
      this.playSe('card_in_mp3');                      /* 8963 se.card_in_mp3.play() */
      this.label('warrior_1p_label', false);           /* 8974-8983 */
      this.label('warrior_2p_label', false);
      this.label('magician_1p_label', false);
      this.label('magician_2p_label', false);
      this.label('card_input_label', false);
      this.label('hp_label', false);
      this.label('st_label', false);
      this.label('mp_label', false);
      this.label('df_label', false);
      this.label('pp_label', false);
      this.startFx('load_c1', r.timerDelay, 0, function (n) { /* 8985-8989 Timer(200) */
        self.loadAnimC1(n);
      }, null);
      this.note('C1 ロード演出開始(Timer 200ms・10カウント後 SET でロード確定・元 8961-8991 相当)');
      this.render();
    },

    /* 8994-9033 load_animation */
    loadAnimC1: function (n) {
      var s = this.state, d = this.el.digits;
      var count = n % 2;                               /* 8996 */
      this.setDigit(d.hp_1p, ' lo');                   /* 8998 */
      this.setDigit(d.hp_2p, ' ad');                   /* 8999 */
      if (n <= 10) {                                   /* 9001-9013 */
        if (count === 1) {
          this.setDigit(d.st_1p, ' oo');
          this.setDigit(d.st_2p, ' oo');
          this.setDigit(d.df_1p, ' qq');
          this.setDigit(d.df_2p, ' qq');
        } else {
          this.setDigit(d.st_1p, ' qq');
          this.setDigit(d.st_2p, ' qq');
          this.setDigit(d.df_1p, ' oo');
          this.setDigit(d.df_2p, ' oo');
        }
      }
      if (n === 10) {                                  /* 9015-9022 */
        this.playSe('decide_mp3');                     /* 9016 se.decide_mp3.play() */
        s.c1LoadAnimCompleteReady = true;              /* 9017 set_button→load_animation_complete */
        this.setDigit(d.st_1p, '');
        this.setDigit(d.st_2p, '');
        this.setDigit(d.df_1p, '');
        this.setDigit(d.df_2p, '');
      }
      if (n >= 10) {                                   /* 9024-9032 */
        if (n % 4 >= 2) {
          this.setDigit(d.df_1p, '  e');
          this.setDigit(d.df_2p, ' nd');
        } else {
          this.setDigit(d.df_1p, '');
          this.setDigit(d.df_2p, '');
        }
      }
    },

    /* 9037-9067 load_animation_complete */
    fxLoadAnimationComplete: function () {
      var self = this, s = this.state;
      this.clearFx();                                  /* 9040-9044 */
      var r = BB2.State.loadAnimationComplete(s);
      if (!r) return;
      this.playSe('card_in_mp3');                      /* 9059 se.card_in_mp3.play() */
      this.startFx('load_status_c1', r.timerDelay, r.timerRepeat, function (n) { /* 9061-9066 Timer(80, 20) */
        self.loadStatusAnimC1(n);
      }, function () {
        self.fxCardNextC1();                           /* 9064 TIMER_COMPLETE→card_insert_next_c1 */
      });
      this.note('C1 ロード実行完了(loaded=' + r.loaded + '・Timer 80ms×20→card_insert_next_c1・元 9037-9067 相当)');
    },

    /* 9069-9097 load_status_animation */
    loadStatusAnimC1: function (n) {
      var d = this.el.digits;
      this.label('hp_label', true);                    /* 9073-9079 */
      this.label('st_label', true);
      this.label('mp_label', false);
      this.label('df_label', true);
      this.label('pp_label', false);
      this.label('warrior_1p_label', true);
      this.label('magician_2p_label', true);
      if (n % 2 === 1) {                               /* 9081-9095 */
        this.setDigit(d.hp_1p, ' ==');
        this.setDigit(d.st_1p, ' ==');
        this.setDigit(d.df_1p, ' ==');
        this.setDigit(d.hp_2p, ' ==');
        this.setDigit(d.st_2p, ' ==');
        this.setDigit(d.df_2p, ' ==');
      } else {
        this.clearDigits();
      }
    },

    /* --- 表示の補助 --- */
    clearDigits: function () {
      /* 元 668-673 の text="" 相当・7 セグでは disp_val("") の 5 文字 space 継ぎ =
        space PNG 5 列の書き込み(元 bitmapData への space コピーと同じ結果) */
      var digits = this.el.digits, self = this;
      Object.keys(digits).forEach(function (k) { self.setDigit(digits[k], ''); });
    },
    /* 7 セグ書き出し(BB2.Digits — textdisplay.js・TextInputSprite.as の各 setter 相当) */
    setDigit: function (el, v) { BB2.Digits.setText(el, v); },     /* text setter(352-359)相当 */
    setMpDigit: function (el, v) { BB2.Digits.setMpText(el, v); }, /* mp_text(343-349)→pp_text setter 相当 */
    setPpDigit: function (el, v) { BB2.Digits.setPpText(el, v); }, /* pp_text(327-341) setter 相当 */
    label: function (name, on) {
      var el = this.el.labels[name];
      if (el) el.hidden = !on;
    },
    setLight: function (i, on) { this.el.lights[i].classList.toggle('lit', on); },
    setLightAll: function () {
      this.el.lights.forEach(function (el) { el.classList.remove('lit'); });
    },
    showCard: function (hpEl, stEl, dfEl, c) {          /* 元 1486-1488・1504-1506 の表示相当(c=null で空欄) */
      if (!c) { this.setDigit(hpEl, ''); this.setDigit(stEl, ''); this.setDigit(dfEl, ''); return; }
      this.setDigit(hpEl, c.hp);                       /* 数値は disp_val で abs+00 付与(195→"19500")・0 は "   00" */
      this.setDigit(stEl, (c.st > 199) ? 199 : c.st);  /* 199 切上げは 19900 表示(TextInputSprite 351 行コメント仕様) */
      this.setDigit(dfEl, (c.df > 199) ? 199 : c.df);
    },

    /* 押下表現(design §1.1: ImageButtonSprite → pointerdown/pointerup + .selected) + click 配線 */
    bind: function (el, onClick) {
      el.addEventListener('pointerdown', function () { el.classList.add('selected'); });
      el.addEventListener('pointerup', function () { el.classList.remove('selected'); });
      el.addEventListener('pointerleave', function () { el.classList.remove('selected'); });
      el.addEventListener('pointercancel', function () { el.classList.remove('selected'); });
      el.addEventListener('click', onClick);
    },

    /* 画面切り替え: 表示/非表示の切替 + 関数ディスパッチ(design §1.2)。
       演出中は digits/label/light を書き換えない(演出側が所有 — startFx 参照) */
    render: function () {
      var S = BB2.State, s = this.state, e = this.el;
      e.stage.dataset.state = String(s.state);
      e.stage.dataset.mute = this.data.settings.sound_mute ? 'true' : 'false';
      e.card_in.disabled = !S.isCardWait(s) || (!!this.fx && this.fx.kind !== 'wait');   /* card_in は bb2_state 4〜7 で受付可(元 878-917)・演出中は不可(元 1010) */
      e.screen_note.textContent = 'bb2_state: ' + s.state +
        (S.isOn(s) ? ' / mode: ' + S.modeName(s) : '(電源OFF)');

      if (this.fx || this.battleFx) return;   /* 演出中と battle_waiting gauge 中(工程5-1・1996-2000)は digits/label/light を演出側へ委ねる */

      /* 起動・電源OFF(状態 -1/0): ラベル表示は元 init_bb2/power_off で未計測のため HTML は隠す(仮定) */
      if (s.state <= S.STATES.STANDBY) {
        var self = this;
        Object.keys(e.labels).forEach(function (k) { self.label(k, false); });
        this.setLightAll();
        this.clearDigits();
        return;
      }

      var digits = e.digits;
      this.clearDigits();
      if (s.state === S.STATES.MODE_SELECT || s.state === S.STATES.DECIDE_STAR) {
        this.setDigit(digits.hp_2p, S.modeName(s));    /* static 分(演出 select 点滅側が同じ内容を書く) */
      } else if (s.state === S.STATES.CARD_1) {         /* 1枚目待ち(元 866-871・fxCardWait の static と同内容) */
        this.setDigit(digits.hp_1p, ' =='); this.setDigit(digits.st_1p, ' =='); this.setDigit(digits.df_1p, ' ==');
      } else if (s.state === S.STATES.CARD_2) {         /* 2枚目待ち(元 885-887)。1P 側は 1枚目の値が続く(1486-1488) */
        this.setDigit(digits.hp_2p, ' =='); this.setDigit(digits.st_2p, ' =='); this.setDigit(digits.df_2p, ' ==');
        this.showCard(digits.hp_1p, digits.st_1p, digits.df_1p, s.cards[0]);
      } else if (s.state === S.STATES.CARD_3 || s.state === S.STATES.CARD_4) {  /* 元 897-917 は digits 書き込みなし・継続表示 */
        this.showCard(digits.hp_1p, digits.st_1p, digits.df_1p, s.cards[0]);
        this.showCard(digits.hp_2p, digits.st_2p, digits.df_2p, s.cards[1]);
      } else if (s.state === S.STATES.CARDS_DONE) {
        var fd = s.fightingData;
        if (fd[0] && fd[1]) {   /* 元 case7 相当の合成表示(1531-1533・1585-1587=1P欄・1573-1575=2P欄)。special_down 演出(1836-1886)・完了(1898-1903)・
           先攻演出(battle_waiting 接続済・工程5-1)の後も合成値の表示を継続(工程4・END プレースホルダ解消) */
          this.showCard(digits.hp_1p, digits.st_1p, digits.df_1p, fd[0]);   /* 1P=1527 合成済値(数値は disp_val 相当の固定表記) */
          this.showCard(digits.hp_2p, digits.st_2p, digits.df_2p, fd[1]);   /* 2P=1572 合成済値 */
        } else {
          this.setDigit(digits.hp_1p, 'END');   /* 防御経路(互換ラッパ cardInserted の data 省略時のみ・実機では合成済): e・n・d の PNG 描画のまま */
        }
      }

      /* ライト: select_mode は light3 点灯(674 相当)。守護星の点灯は mode_start(800-827 相当)の実値 —
         protection_star 0=レトフ(陸)→light2・1=セターン→light3・2=ラト→light4。light2 プレースホルダ(固定点灯)は工程4 で解消。
         4枚目以降(状態 4-8)も点灯継続(元の card_insert_wait_animation 924-995・card_skip_animation 1436-1456・
       card_insert_error_animation 1610-1769 はライトを書き換えない — mode_start の点灯が続く)。演出中(fx 分で return 済)は
         演出側が所有(decide_star_animation 762-788 の巡回・special_down 演出は欄のみ・decide_first 1928-1952 の light1↔light5)。
         先攻演出完了後の render 静的分は gauge 接続済(battleFx)の場は gauge 側へ委ねる(this.fx/battleFx ガード・工程5-1)。
         gauge 未接続の防御経路では元の 1957-2034 の light1/light5 代入が走らないため守護星点灯継続とする(工程4 注記) */
      var ps = s.fightingCalc ? s.fightingCalc.protection_star : null;   /* 元 735 の fighting_calc フィールド相当・752 で決定済 */
      e.lights.forEach(function (el, i) {
        var lit = (s.state === S.STATES.MODE_SELECT && i === 2) ||
                  (s.state >= S.STATES.DECIDE_STAR && ps !== null && i === ps + 1);
        el.classList.toggle('lit', lit);
      });
    },

    /* fit scale × CHANGE_SCALE プラグ を transform: scale で適用(design §1.1 対応表) */
    applyScale: function () {
      var vw = this.el.viewport.clientWidth || STAGE_W;
      var vh = this.el.viewport.clientHeight || STAGE_H;
      var base = Math.min(vw / STAGE_W, vh / STAGE_H, 1);      /* 収まる範囲まで自動縮小(PC/スマホ対応) */
      var eff = base * SCALE_PRESETS[this.scaleIdx];
      var tx = Math.max((vw - STAGE_W * eff) / 2, 0);
      var ty = Math.max((vh - STAGE_H * eff) / 2, 0);
      this.el.stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + eff + ')';
    },

    note: function (msg) { this.el.status_note.textContent = msg; }
  };

  BB2.View = View;
})(typeof window !== 'undefined' ? window : this);
