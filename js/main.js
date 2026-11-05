/* main.js — エントリーポイント(design §1.1: addedToStage="init_bb2()" → DOMContentLoaded)
 * 骨組みのため、init_bb2 の代替として 起動→状態機械初期化→表示初期化 のみ行う。
 * (sound/mute/card_reader の初期化自体は各 Phase 持ち込み: scale と mute は settings から復元済み)
 */
(function (global) {
  'use strict';

  function boot() {
    var data = BB2.Store.load();
    var state = BB2.State.create();
    BB2.State.standby(state);   /* 元 init_bb2 の power_off 呼出相当(起動→bb2_state 0) */
    BB2.View.init(state, data);
    console.info('[BB2] HTML5 skeleton ready. bb2_state shell only (game logic / barcode reader 未移植).');
  }

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
